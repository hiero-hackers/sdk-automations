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
 * `handle` below is the left lane of design/trace.md stations 1–2, one
 * named step per station, each answering for itself.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import {
    asDeliveryGuid,
    SIGNATURE_HEADER,
    verifyBody,
    type DeliveryGuid,
} from "@hiero-hackers/automation-core";

/** GitHub caps webhook payloads at 25 MB; anything larger is not GitHub. */
const MAX_BODY_BYTES = 25 * 1024 * 1024;

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
    /** Fire-and-forget processing pump, called after an acknowledgement. */
    readonly onAccepted?: () => void;
}

export type RequestHandler = (request: IncomingMessage, response: ServerResponse) => void;

export function createReceiver(options: ReceiverOptions): RequestHandler {
    return (request, response) => {
        void handle(request, response, options).catch(() => {
            if (!response.headersSent) response.writeHead(500).end();
        });
    };
}

/** The whole left lane, in reading order. Every step either finishes the
 * response itself and yields nothing, or hands its result to the next. */
async function handle(
    request: IncomingMessage,
    response: ServerResponse,
    options: ReceiverOptions,
): Promise<void> {
    if (request.method !== "POST") {
        response.writeHead(405).end();
        return;
    }
    const body = await readBody(request, response);
    if (body === null) return;
    if (!verifiedDelivery(request, body, options.secret)) {
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

/** Collect the exact bytes, capped; answers the 413 itself. */
function readBody(request: IncomingMessage, response: ServerResponse): Promise<Buffer | null> {
    return new Promise((resolve) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let capped = false;
        request.on("data", (chunk: Buffer) => {
            if (capped) return;
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                capped = true;
                response.writeHead(413).end();
                request.destroy();
                resolve(null);
                return;
            }
            chunks.push(chunk);
        });
        request.on("end", () => {
            if (!capped) resolve(Buffer.concat(chunks));
        });
    });
}

/** Station 1's gate: the HMAC of the raw bytes, checked before anything
 * else is even read. Total — a missing header is `false`, never a throw. */
function verifiedDelivery(request: IncomingMessage, body: Buffer, secret: string): boolean {
    const signature = request.headers[SIGNATURE_HEADER];
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
    let outcome: AcceptOutcome;
    try {
        outcome = options.accept(delivery);
    } catch (error) {
        // Not durable, so never acknowledged: GitHub redelivers.
        console.error(`shell: accept failed for ${delivery.deliveryId}`, error);
        response.writeHead(500).end();
        return;
    }
    if (outcome === "conflict") {
        response.writeHead(409).end();
        return;
    }
    response.writeHead(202).end();
    options.onAccepted?.();
}
