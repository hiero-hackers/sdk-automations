/**
 * The shell's HTTP edge: verify, durably accept, only then acknowledge.
 * The ordering IS the product (P9). The signature check runs before any other
 * handling, and the 202 is written only after `accept` returns, so a crash one millisecond later loses nothing. The payload is never parsed here: the exact signed bytes travel to the store, so what was verified is what is decided on.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import {
    asDeliveryGuid,
    SIGNATURE_HEADER,
    verifyBody,
    type DeliveryGuid,
} from "@hiero-hackers/automation-core";
import { detailOf, type Log } from "../log.js";

/** GitHub caps webhook payloads at 25 MB; anything larger is not GitHub. */
const MAX_BODY_BYTES = 25 * 1024 * 1024;

/** Liveness only, so a hosting platform can probe without a secret. */
const HEALTH_PATH = "/healthz";

/** Whether the process wants traffic: 200 while ready, 503 once draining. */
const READY_PATH = "/readyz";

export interface AcceptedDelivery {
    readonly deliveryId: DeliveryGuid;
    readonly eventName: string;
    readonly payload: Uint8Array;
}

/** The store's classification, minus the detail the receiver has no use for. */
export type AcceptOutcome = "accepted" | "duplicate" | "conflict";

export interface ReceiverOptions {
    readonly secret: string;
    /** Persist and classify. Must be DURABLE before returning — the 202 rides on it. */
    readonly accept: (delivery: AcceptedDelivery) => AcceptOutcome;
    /** One line per delivery that reached the store; nothing refused before that is logged. */
    readonly log: Log;
    /** Fire-and-forget processing pump, called after an acknowledgement. */
    readonly onAccepted?: () => void;
    /** Answers the readiness probe; absent means always ready. */
    readonly ready?: () => boolean;
}

export type RequestHandler = (request: IncomingMessage, response: ServerResponse) => Promise<void>;

export function createReceiver(options: ReceiverOptions): RequestHandler {
    return async (request, response) => {
        try {
            await handle(request, response, options);
        } catch {
            if (!response.headersSent) response.writeHead(500).end();
        }
    };
}

/** The whole left lane, in reading order. Every step either finishes the response itself and yields nothing, or hands its result to the next. */
async function handle(
    request: IncomingMessage,
    response: ServerResponse,
    options: ReceiverOptions,
): Promise<void> {
    if (isGetAt(request, HEALTH_PATH)) {
        response.writeHead(200, { "content-type": "text/plain" }).end("ok\n");
        return;
    }
    if (isGetAt(request, READY_PATH)) {
        const ready = options.ready?.() ?? true;
        response
            .writeHead(ready ? 200 : 503, { "content-type": "text/plain" })
            .end(ready ? "ready\n" : "draining\n");
        return;
    }
    if (request.method !== "POST") {
        response.writeHead(405).end();
        return;
    }
    if (declaresOversizeBody(request)) {
        // Refused before a byte is read; the body is never consumed here.

        response.writeHead(413).end();
        return;
    }
    const body = await readBody(request, response);
    if (body === null) return;
    if (!isVerifiedDelivery(request, body, options.secret)) {
        response.writeHead(401).end();
        return;
    }
    const identity = deliveryIdentity(request);
    if (identity === null) {
        response.writeHead(400).end();
        return;
    }
    acceptThenAck({ ...identity, payload: body }, response, options);
}

/** A GET at exactly `path`; the query string is ignored. */
function isGetAt(request: IncomingMessage, path: string): boolean {
    if (request.method !== "GET") return false;
    // Stryker disable next-line all: a server request always carries a url, so the fallback is a type obligation with no behaviour.
    const url = request.url ?? "";
    return url.split("?")[0] === path;
}

/**
 * A body the sender itself declares too large — an early exit, not the limit.
 * `content-length` is a claim: an unusable one reads as NaN and meets the streaming cap.
 */
function declaresOversizeBody(request: IncomingMessage): boolean {
    return Number(request.headers["content-length"]) > MAX_BODY_BYTES;
}

/**
 * Collect the exact bytes, capped; answers the 413 itself.
 * A failed request rejects the iteration, landing on the 500 boundary.
 */
async function readBody(
    request: IncomingMessage,
    response: ServerResponse,
): Promise<Buffer | null> {
    // Stryker disable next-line StringLiteral: the reason never leaves this function — destroy() rejects the read, the 500 boundary answers it, and nothing before the store is ever logged.
    // `aborted` is deprecated and not always accompanied by a stream error; folding
    // it into destroy() sends the lone signal through the same rejection path.

    request.once("aborted", () => request.destroy(new Error("request aborted")));
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request as AsyncIterable<Buffer>) {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
            response.writeHead(413).end();
            // Stryker disable next-line CallExpression: leaving the for-await early destroys the request anyway (node's async-iterator teardown), so this only says out loud that the connection is finished with.
            request.destroy();
            return null;
        }
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
}

/**
 * Station 1's gate: the HMAC of the raw bytes, before anything else is read.
 * Total — a missing header is `false`, never a throw.
 */
function isVerifiedDelivery(request: IncomingMessage, body: Buffer, secret: string): boolean {
    const signature = request.headers[SIGNATURE_HEADER];
    // Stryker disable next-line ConditionalExpression: node folds repeated non-set-cookie headers into one comma-joined string, so the arm never runs off a socket — it is what makes the call typecheck.
    return verifyBody(secret, body, typeof signature === "string" ? signature : undefined);
}

/**
 * Who this delivery claims to be. Past the signature a malformed header earns a
 * truthful 400, not a security decision; `null` here means exactly that.
 */
function deliveryIdentity(
    request: IncomingMessage,
): { deliveryId: DeliveryGuid; eventName: string } | null {
    const rawGuid = request.headers["x-github-delivery"];
    // Stryker disable next-line ConditionalExpression: asDeliveryGuid checks the type itself and answers undefined for anything else, so the arm decides nothing; it is what makes the call typecheck.
    const deliveryId = typeof rawGuid === "string" ? asDeliveryGuid(rawGuid) : undefined;
    const eventName = request.headers["x-github-event"];
    if (deliveryId === undefined || typeof eventName !== "string" || eventName === "") {
        return null;
    }
    return { deliveryId, eventName };
}

/**
 * Station 2: the durable row decides the status. A conflict — same GUID, different
 * bytes — is refused loudly; acknowledging would drop one of two contradictory deliveries.
 */
function acceptThenAck(
    delivery: AcceptedDelivery,
    response: ServerResponse,
    options: ReceiverOptions,
): void {
    const deliveryId = String(delivery.deliveryId);
    const eventName = delivery.eventName;
    let outcome: AcceptOutcome;
    try {
        outcome = options.accept(delivery);
    } catch (error) {
        // Not durable, so never acknowledged: GitHub redelivers.

        options.log({ event: "acceptFailed", deliveryId, detail: detailOf(error) });
        response.writeHead(500).end();
        return;
    }
    if (outcome === "conflict") {
        options.log({ event: "deliveryConflict", deliveryId, eventName });
        response.writeHead(409).end();
        return;
    }
    options.log({
        event: outcome === "duplicate" ? "deliveryDuplicate" : "deliveryAccepted",
        deliveryId,
        eventName,
    });
    if (options.onAccepted !== undefined) {
        // The pump starts only after the ack is on the wire.

        response.once("finish", options.onAccepted);
    }
    response.writeHead(202).end();
}
