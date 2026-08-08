/**
 * The edge's contract: verify before anything, accept before the 202, and
 * a truthful status for every way a delivery can be wrong. Every case runs
 * over real HTTP — the receiver's ordering is the thing under test, and a
 * unit-called handler cannot prove what a listening socket does.
 */

import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { signBody, SIGNATURE_HEADER } from "@hiero-hackers/automation-core";
import {
    createReceiver,
    type AcceptedDelivery,
    type AcceptOutcome,
    type RequestHandler,
} from "../src/receiver.js";

const SECRET = "shell-test-secret";
const GUID = "72d3162e-cc78-11e3-81ab-4c9367dc0958";
const BODY = JSON.stringify({ action: "opened" });

interface PostOverrides {
    readonly body?: string;
    readonly signature?: string | null;
    readonly guid?: string | null;
    readonly event?: string | null;
    readonly method?: string;
}

/** One request against a real listening socket; the server lives per call. */
async function post(handler: RequestHandler, overrides: PostOverrides = {}): Promise<number> {
    const server = createServer(handler);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    try {
        const { port } = server.address() as AddressInfo;
        const body = overrides.body ?? BODY;
        const headers: Record<string, string> = {};
        const signature =
            overrides.signature === undefined ? signBody(SECRET, body) : overrides.signature;
        if (signature !== null) headers[SIGNATURE_HEADER] = signature;
        const guid = overrides.guid === undefined ? GUID : overrides.guid;
        if (guid !== null) headers["x-github-delivery"] = guid;
        const event = overrides.event === undefined ? "issues" : overrides.event;
        if (event !== null) headers["x-github-event"] = event;
        const response = await fetch(`http://127.0.0.1:${String(port)}/`, {
            method: overrides.method ?? "POST",
            headers,
            ...(overrides.method === "GET" ? {} : { body }),
        });
        await response.arrayBuffer();
        return response.status;
    } finally {
        await new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
        );
    }
}

function recordingAccept(outcome: AcceptOutcome = "accepted") {
    const calls: AcceptedDelivery[] = [];
    return {
        calls,
        accept: (delivery: AcceptedDelivery): AcceptOutcome => {
            calls.push(delivery);
            return outcome;
        },
    };
}

describe("verification comes first", () => {
    it("an unsigned delivery is 401 and never reaches accept", async () => {
        const { calls, accept } = recordingAccept();
        const status = await post(createReceiver({ secret: SECRET, accept }), {
            signature: null,
        });
        expect(status).toBe(401);
        expect(calls).toEqual([]);
    });

    it("a wrongly signed delivery is 401 and never reaches accept", async () => {
        const { calls, accept } = recordingAccept();
        const status = await post(createReceiver({ secret: SECRET, accept }), {
            signature: signBody("some-other-secret", BODY),
        });
        expect(status).toBe(401);
        expect(calls).toEqual([]);
    });
});

describe("acceptance comes before the acknowledgement", () => {
    it("a verified delivery is accepted with its exact bytes, then 202", async () => {
        const { calls, accept } = recordingAccept();
        const status = await post(createReceiver({ secret: SECRET, accept }));
        expect(status).toBe(202);
        expect(calls).toHaveLength(1);
        expect(Buffer.from(calls[0]!.payload).toString("utf8")).toBe(BODY);
        expect(calls[0]!.deliveryId).toBe(GUID);
        expect(calls[0]!.eventName).toBe("issues");
    });

    it("a failed accept is 500, not 202 — unstored means unacknowledged", async () => {
        const receiver = createReceiver({
            secret: SECRET,
            accept: () => {
                throw new Error("store unavailable");
            },
        });
        expect(await post(receiver)).toBe(500);
    });

    it("a duplicate is 202 — the redelivery already has its durable row", async () => {
        const { accept } = recordingAccept("duplicate");
        expect(await post(createReceiver({ secret: SECRET, accept }))).toBe(202);
    });

    it("a conflict is 409 — same GUID, different bytes, never acknowledged", async () => {
        const { accept } = recordingAccept("conflict");
        expect(await post(createReceiver({ secret: SECRET, accept }))).toBe(409);
    });

    it("the pump fires only after an acknowledged delivery", async () => {
        let pumped = 0;
        const { accept } = recordingAccept();
        const receiver = createReceiver({
            secret: SECRET,
            accept,
            onAccepted: () => {
                pumped += 1;
            },
        });
        await post(receiver);
        expect(pumped).toBe(1);
        await post(receiver, { signature: null });
        expect(pumped).toBe(1);
    });
});

describe("malformed requests get truthful statuses", () => {
    it("a non-POST is 405", async () => {
        const { calls, accept } = recordingAccept();
        const status = await post(createReceiver({ secret: SECRET, accept }), {
            method: "GET",
            signature: null,
        });
        expect(status).toBe(405);
        expect(calls).toEqual([]);
    });

    it("a signed delivery without a GUID is 400", async () => {
        const { calls, accept } = recordingAccept();
        const status = await post(createReceiver({ secret: SECRET, accept }), {
            guid: null,
        });
        expect(status).toBe(400);
        expect(calls).toEqual([]);
    });

    it("a signed delivery with a malformed GUID is 400", async () => {
        const { accept } = recordingAccept();
        const status = await post(createReceiver({ secret: SECRET, accept }), {
            guid: "not-a-guid",
        });
        expect(status).toBe(400);
    });

    it("a signed delivery without an event name is 400", async () => {
        const { accept } = recordingAccept();
        const status = await post(createReceiver({ secret: SECRET, accept }), {
            event: null,
        });
        expect(status).toBe(400);
    });
});
