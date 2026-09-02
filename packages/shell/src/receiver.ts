/**
 * The shell's HTTP edge: verify, durably accept, only then acknowledge.
 *
 * The ordering IS the product (P9): the signature check runs before any
 * other handling because this is the system's most attacker-reachable
 * line (packages/core/src/github/signatures.ts), and the 202 is written only after
 * `accept` returns — a crash one millisecond after the acknowledgement
 * loses nothing, because the durable row already exists. The receiver
 * never parses the payload: the exact signed bytes travel to the store
 * and are read back by the processor, so what was verified is what is
 * decided on.
 *
 * `handle` below is stations ① and ② of this package's README table, one
 * named step per station, each answering for itself. Two steps run before
 * them and answer for nothing: a liveness probe, which reads nothing about
 * the request, and the refusal of a body the sender declares too large,
 * which is the one thing worth knowing before the bytes are buffered.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import {
    asDeliveryGuid,
    SIGNATURE_HEADER,
    verifyBody,
    type DeliveryGuid,
} from "@hiero-hackers/automation-core";
import { detailOf, type Log } from "./log.js";

/** GitHub caps webhook payloads at 25 MB; anything larger is not GitHub. */
const MAX_BODY_BYTES = 25 * 1024 * 1024;

/** Liveness only, so a hosting platform can probe without a secret. */
const HEALTH_PATH = "/healthz";

export interface AcceptedDelivery {
    readonly deliveryId: DeliveryGuid;
    readonly eventName: string;
    readonly payload: Uint8Array;
}

/** The store's classification, minus the detail the receiver has no use for. */
export type AcceptOutcome = "accepted" | "duplicate" | "conflict";

export interface ReceiverOptions {
    readonly secret: string;
    /**
     * Persist the delivery and classify it. Must be DURABLE before
     * returning — the 202 is written on the strength of this return.
     */
    readonly accept: (delivery: AcceptedDelivery) => AcceptOutcome;
    /**
     * One line per delivery that got as far as the store. Nothing refused
     * before that is logged: a 401, a 400 or a 413 is reachable by anyone
     * who can open a socket, and a log an unauthenticated caller can fill
     * is a log an operator cannot read.
     */
    readonly log: Log;
    /** Fire-and-forget processing pump, called after an acknowledgement. */
    readonly onAccepted?: () => void;
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

/** The whole left lane, in reading order. Every step either finishes the
 * response itself and yields nothing, or hands its result to the next. */
async function handle(
    request: IncomingMessage,
    response: ServerResponse,
    options: ReceiverOptions,
): Promise<void> {
    if (isHealthProbe(request)) {
        response.writeHead(200, { "content-type": "text/plain" }).end("ok\n");
        return;
    }
    if (request.method !== "POST") {
        response.writeHead(405).end();
        return;
    }
    if (declaresOversizeBody(request)) {
        // Refused before a byte is read: buffering 25 MB of unverified
        // input to learn what the sender already told us is the exposure.
        // The body is never consumed here — node discards what still
        // arrives — so the sender gets a truthful status either way.
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

/**
 * The liveness probe: a GET at exactly the health path. The query string
 * is ignored, because probes append cache-busters, and nothing else about
 * the request is read — the answer is a constant, so a prober learns only
 * that a process is listening.
 */
function isHealthProbe(request: IncomingMessage): boolean {
    if (request.method !== "GET") return false;
    // Stryker disable next-line all: a server request always carries a
    // url, so the fallback is a type obligation with no behaviour.
    const url = request.url ?? "";
    return url.split("?")[0] === HEALTH_PATH;
}

/**
 * A body the sender itself declares too large. This is an early exit, not
 * the limit: `content-length` is a claim, so an absent, repeated or
 * unparsable one reads as NaN here — never greater than anything — and
 * meets the streaming cap in `readBody` as every chunked body does.
 */
function declaresOversizeBody(request: IncomingMessage): boolean {
    return Number(request.headers["content-length"]) > MAX_BODY_BYTES;
}

/**
 * Collect the exact bytes, capped; answers the 413 itself. A failed
 * request rejects the iteration, which lands on `createReceiver`'s 500
 * boundary like any other escape.
 */
async function readBody(
    request: IncomingMessage,
    response: ServerResponse,
): Promise<Buffer | null> {
    // `aborted` is deprecated and usually accompanied by a stream error,
    // but not always; folding it into destroy() sends the lone signal
    // through the same rejection path as every other failure.
    // Stryker disable next-line StringLiteral: the reason never leaves this function — destroy() rejects the read, the 500 boundary answers it, and nothing before the store is ever logged.
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

/** Station 1's gate: the HMAC of the raw bytes, checked before anything
 * else is even read. Total — a missing header is `false`, never a throw. */
function isVerifiedDelivery(request: IncomingMessage, body: Buffer, secret: string): boolean {
    const signature = request.headers[SIGNATURE_HEADER];
    // Stryker disable next-line ConditionalExpression: node folds repeated non-set-cookie headers into one comma-joined string, so the arm never runs off a socket — it is what makes the call typecheck.
    return verifyBody(secret, body, typeof signature === "string" ? signature : undefined);
}

/**
 * Who this delivery claims to be. Past the signature the sender knows the
 * secret, so a malformed header earns a truthful 400, not a security
 * decision — `null` here means exactly that.
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

/** Station 2: the durable row decides the status. 202 only after `accept`
 * returns; a conflict (same GUID, different bytes) is refused loudly —
 * acknowledging would silently drop one of two contradictory deliveries. */
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
        // The pump starts only after the ack is on the wire, so processing
        // latency can never delay the 202 GitHub is waiting for.
        response.once("finish", options.onAccepted);
    }
    response.writeHead(202).end();
}
