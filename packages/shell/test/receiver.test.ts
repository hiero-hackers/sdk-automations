/**
 * The edge's contract: verify before anything, accept before the 202, and
 * a truthful status for every way a delivery can be wrong. Boundary and
 * ordering cases run over real HTTP; stream failures use explicit request
 * doubles so otherwise-unreachable transport events remain deterministic.
 */

import { describe, expect, it } from "vitest";
import { createServer, request as httpRequest, type ServerResponse } from "node:http";
import { connect as netConnect, type AddressInfo, type Socket } from "node:net";
import { PassThrough } from "node:stream";
import type { IncomingMessage } from "node:http";
import { signBody, SIGNATURE_HEADER } from "@hiero-hackers/automation-core";
import {
    createReceiver,
    type AcceptedDelivery,
    type AcceptOutcome,
    type RequestHandler,
} from "../src/receiver.js";
import type { Log, ShellEvent } from "../src/log.js";

const SECRET = "shell-test-secret";

/** The log seam, for the cases that are not about what it was told. */
const silent: Log = () => undefined;

/** A log that keeps what it was told, for the cases that are. */
function recordingLog(): { events: ShellEvent[]; log: Log } {
    const events: ShellEvent[] = [];
    return { events, log: (event) => events.push(event) };
}
const GUID = "72d3162e-cc78-11e3-81ab-4c9367dc0958";
const BODY = JSON.stringify({ action: "opened" });

interface PostOverrides {
    readonly body?: string | Uint8Array;
    readonly signature?: string | null;
    readonly guid?: string | null;
    readonly event?: string | null;
    readonly method?: string;
    readonly path?: string;
}

/** One request against a real listening socket; the server lives per call. */
async function post(handler: RequestHandler, overrides: PostOverrides = {}): Promise<number> {
    const server = createServer(handler);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
        const { port } = server.address() as AddressInfo;
        const body = Buffer.from(overrides.body ?? BODY);
        const headers: Record<string, string> = {};
        const signature =
            overrides.signature === undefined ? signBody(SECRET, body) : overrides.signature;
        if (signature !== null) headers[SIGNATURE_HEADER] = signature;
        const guid = overrides.guid === undefined ? GUID : overrides.guid;
        if (guid !== null) headers["x-github-delivery"] = guid;
        const event = overrides.event === undefined ? "issues" : overrides.event;
        if (event !== null) headers["x-github-event"] = event;
        const method = overrides.method ?? "POST";
        if (method !== "GET") headers["content-length"] = String(body.length);
        return await new Promise<number>((resolve, reject) => {
            let settled = false;
            const request = httpRequest(
                {
                    host: "127.0.0.1",
                    port,
                    path: overrides.path ?? "/",
                    method,
                    headers,
                },
                (response) => {
                    response.resume();
                    response.on("end", () => {
                        settled = true;
                        resolve(response.statusCode ?? 0);
                    });
                },
            );
            request.on("error", (error) => {
                if (!settled) reject(error);
            });
            request.end(method === "GET" ? undefined : body);
        });
    } finally {
        await new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
        );
    }
}

/** A GET, with the body read: a probe's answer is the thing being judged. */
async function probe(
    handler: RequestHandler,
    path: string,
): Promise<{ status: number; body: string; contentType: string | undefined }> {
    const server = createServer(handler);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
        const { port } = server.address() as AddressInfo;
        return await new Promise<{
            status: number;
            body: string;
            contentType: string | undefined;
        }>((resolve, reject) => {
            const request = httpRequest(
                { host: "127.0.0.1", port, path, method: "GET" },
                (response) => {
                    let body = "";
                    response.setEncoding("utf8");
                    response.on("data", (chunk: string) => {
                        body += chunk;
                    });
                    response.on("end", () =>
                        resolve({
                            status: response.statusCode ?? 0,
                            body,
                            contentType: response.headers["content-type"],
                        }),
                    );
                },
            );
            request.on("error", reject);
            request.end();
        });
    } finally {
        await new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
        );
    }
}

function requestStream(): IncomingMessage & PassThrough {
    const request = new PassThrough() as IncomingMessage & PassThrough;
    request.method = "POST";
    request.headers = {};
    return request;
}

function responseRecorder(alreadySent = false): {
    readonly response: ServerResponse;
    readonly status: () => number | undefined;
    readonly ended: () => boolean;
} {
    let status: number | undefined;
    let ended = false;
    let headersSent = alreadySent;
    const response = {
        get headersSent() {
            return headersSent;
        },
        writeHead(code: number) {
            status = code;
            headersSent = true;
            return response;
        },
        end() {
            ended = true;
            return response;
        },
    } as unknown as ServerResponse;
    return { response, status: () => status, ended: () => ended };
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

/**
 * One hand-written connection, answered with its status line.
 *
 * `send` owns everything written, so a case can stop mid-body — which is
 * the point: an answer that arrives while the client is still sending is
 * an answer given without reading what was promised.
 */
async function statusLineFor(
    handler: RequestHandler,
    send: (socket: Socket, host: string) => void,
): Promise<string> {
    const server = createServer(handler);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    const socket = netConnect(port, "127.0.0.1");
    socket.on("error", () => undefined);
    try {
        await new Promise<void>((resolve) => socket.once("connect", resolve));
        send(socket, `127.0.0.1:${String(port)}`);
        return await new Promise<string>((resolve, reject) => {
            let seen = "";
            const timer = setTimeout(
                () => reject(new Error(`no status line arrived; read ${JSON.stringify(seen)}`)),
                5_000,
            );
            socket.on("data", (chunk: Buffer) => {
                seen += chunk.toString("utf8");
                const end = seen.indexOf("\r\n");
                if (end === -1) return;
                clearTimeout(timer);
                resolve(seen.slice(0, end));
            });
            socket.on("close", () => {
                clearTimeout(timer);
                reject(new Error(`the connection closed unanswered; read ${JSON.stringify(seen)}`));
            });
        });
    } finally {
        socket.destroy();
        await new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
        );
    }
}

/**
 * A POST of `size` bytes that declares no length: without content-length
 * node frames the body as chunked, which is the case no header can refuse
 * early and only the streaming cap can answer.
 *
 * `size` is one byte over the cap on purpose. The receiver destroys the
 * request the moment it caps, so a body with megabytes still to send would
 * lose its own answer to the reset — over by exactly one, the client has
 * finished writing before the cap is reached, as in the case above.
 */
async function postChunked(handler: RequestHandler, size: number): Promise<number> {
    const server = createServer(handler);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
        const { port } = server.address() as AddressInfo;
        return await new Promise<number>((resolve, reject) => {
            let settled = false;
            const request = httpRequest(
                {
                    host: "127.0.0.1",
                    port,
                    path: "/",
                    method: "POST",
                    headers: {
                        [SIGNATURE_HEADER]: signBody(SECRET, BODY),
                        "x-github-delivery": GUID,
                        "x-github-event": "issues",
                    },
                },
                (response) => {
                    response.resume();
                    response.on("end", () => {
                        settled = true;
                        resolve(response.statusCode ?? 0);
                    });
                },
            );
            request.on("error", (error) => {
                if (!settled) reject(error);
            });
            const megabyte = Buffer.alloc(1024 * 1024, 0x63);
            let written = 0;
            for (; written + megabyte.length <= size; written += megabyte.length) {
                request.write(megabyte);
            }
            request.end(Buffer.alloc(size - written, 0x64));
        });
    } finally {
        await new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
        );
    }
}

async function interruptRealRequest(mode: "client-abort" | "server-error"): Promise<number> {
    let acceptCalls = 0;
    let requestSeen!: () => void;
    const sawRequest = new Promise<void>((resolve) => {
        requestSeen = resolve;
    });
    let handlerDone!: () => void;
    const handlerCompletion = new Promise<void>((resolve) => {
        handlerDone = resolve;
    });
    const receiver = createReceiver({
        secret: SECRET,
        log: silent,
        accept: () => {
            acceptCalls += 1;
            return "accepted";
        },
    });
    const server = createServer((request, response) => {
        requestSeen();
        void receiver(request, response).then(handlerDone);
        if (mode === "server-error") {
            request.destroy(new Error("injected socket failure"));
        }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    const socket = netConnect(port, "127.0.0.1");
    socket.on("error", () => undefined);
    try {
        await new Promise<void>((resolve) => socket.once("connect", resolve));
        socket.write(
            "POST / HTTP/1.1\r\n" +
                `Host: 127.0.0.1:${port}\r\n` +
                "Content-Length: 100\r\n" +
                "Connection: close\r\n\r\n" +
                "partial",
        );
        await sawRequest;
        if (mode === "client-abort") socket.destroy();
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("receiver did not settle")), 1_000);
            void handlerCompletion.then(() => {
                clearTimeout(timer);
                resolve();
            }, reject);
        });
        return acceptCalls;
    } finally {
        socket.destroy();
        await new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
        );
    }
}

describe("verification comes first", () => {
    it("an unsigned delivery is 401 and never reaches accept", async () => {
        const { calls, accept } = recordingAccept();
        const status = await post(createReceiver({ secret: SECRET, log: silent, accept }), {
            signature: null,
        });
        expect(status).toBe(401);
        expect(calls).toEqual([]);
    });

    it("a wrongly signed delivery is 401 and never reaches accept", async () => {
        const { calls, accept } = recordingAccept();
        const status = await post(createReceiver({ secret: SECRET, log: silent, accept }), {
            signature: signBody("some-other-secret", BODY),
        });
        expect(status).toBe(401);
        expect(calls).toEqual([]);
    });
});

describe("acceptance comes before the acknowledgement", () => {
    it("a verified delivery is accepted with its exact bytes, then 202", async () => {
        const { calls, accept } = recordingAccept();
        const raw = Buffer.concat([
            Buffer.from('{\n  "action": "opened", "bytes": "', "utf8"),
            Buffer.from([0x00, 0xff, 0x80]),
            Buffer.from('"\n}', "utf8"),
        ]);
        const status = await post(createReceiver({ secret: SECRET, log: silent, accept }), {
            body: raw,
        });
        expect(status).toBe(202);
        expect(calls).toHaveLength(1);
        expect(Buffer.from(calls[0]!.payload)).toEqual(raw);
        expect(calls[0]!.deliveryId).toBe(GUID);
        expect(calls[0]!.eventName).toBe("issues");
    });

    it("a failed accept is 500, not 202 — unstored means unacknowledged", async () => {
        const receiver = createReceiver({
            secret: SECRET,
            log: silent,
            accept: () => {
                throw new Error("store unavailable");
            },
        });
        expect(await post(receiver)).toBe(500);
    });

    it("a duplicate is 202 — the redelivery already has its durable row", async () => {
        const { accept } = recordingAccept("duplicate");
        expect(await post(createReceiver({ secret: SECRET, log: silent, accept }))).toBe(202);
    });

    it("a conflict is 409 — same GUID, different bytes, never acknowledged", async () => {
        const { accept } = recordingAccept("conflict");
        expect(await post(createReceiver({ secret: SECRET, log: silent, accept }))).toBe(409);
    });

    /**
     * The three answers the store can give, and the fourth outcome where it
     * gave none, each named under the delivery they answer for. A refusal
     * BEFORE the store is deliberately silent: those are reachable without
     * the secret, and a log an anonymous caller can fill is unreadable.
     */
    it.each([
        { outcome: "accepted", event: "deliveryAccepted", status: 202 },
        { outcome: "duplicate", event: "deliveryDuplicate", status: 202 },
        { outcome: "conflict", event: "deliveryConflict", status: 409 },
    ] as const)("logs a $outcome delivery under its own id", async ({ outcome, event, status }) => {
        const { accept } = recordingAccept(outcome);
        const { events, log } = recordingLog();

        expect(await post(createReceiver({ secret: SECRET, log, accept }))).toBe(status);
        expect(events).toEqual([{ event, deliveryId: GUID, eventName: "issues" }]);
    });

    it("logs a delivery the store could not take, and says nothing about one it refused", async () => {
        const { events, log } = recordingLog();
        const receiver = createReceiver({
            secret: SECRET,
            log,
            accept: () => {
                throw new Error("store unavailable");
            },
        });

        expect(await post(receiver)).toBe(500);
        expect(await post(receiver, { signature: null })).toBe(401);
        expect(events).toEqual([
            {
                event: "acceptFailed",
                deliveryId: GUID,
                detail: expect.stringContaining("store unavailable"),
            },
        ]);
    });

    it("the pump fires only after an acknowledged delivery", async () => {
        let pumped = 0;
        const { accept } = recordingAccept();
        const receiver = createReceiver({
            secret: SECRET,
            log: silent,
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

    it("starts the processing pump only after the real response finish boundary", async () => {
        let finishObserved = false;
        let pumpCalls = 0;
        const receiver = createReceiver({
            secret: SECRET,
            log: silent,
            accept: () => "accepted",
            onAccepted: () => {
                expect(finishObserved).toBe(true);
                pumpCalls += 1;
            },
        });
        const server = createServer((request, response) => {
            response.once("finish", () => {
                finishObserved = true;
            });
            void receiver(request, response);
        });
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        try {
            const { port } = server.address() as AddressInfo;
            const body = Buffer.from(BODY);
            const status = await new Promise<number>((resolve, reject) => {
                const request = httpRequest(
                    {
                        host: "127.0.0.1",
                        port,
                        path: "/",
                        method: "POST",
                        headers: {
                            [SIGNATURE_HEADER]: signBody(SECRET, body),
                            "x-github-delivery": GUID,
                            "x-github-event": "issues",
                            "content-length": String(body.length),
                        },
                    },
                    (response) => {
                        response.resume();
                        response.on("end", () => resolve(response.statusCode ?? 0));
                    },
                );
                request.on("error", reject);
                request.end(body);
            });
            expect(status).toBe(202);
            expect(finishObserved).toBe(true);
            expect(pumpCalls).toBe(1);
        } finally {
            await new Promise<void>((resolve, reject) =>
                server.close((error) => (error ? reject(error) : resolve())),
            );
        }
    });
});

describe("body limits and interrupted streams fail closed", () => {
    it("accepts exactly 25 MiB and rejects the next byte", async () => {
        const { calls, accept } = recordingAccept();
        const receiver = createReceiver({ secret: SECRET, log: silent, accept });
        const atLimit = Buffer.alloc(25 * 1024 * 1024, 0x61);
        expect(await post(receiver, { body: atLimit })).toBe(202);
        expect(calls[0]?.payload.byteLength).toBe(atLimit.length);

        const overLimit = Buffer.alloc(atLimit.length + 1, 0x62);
        expect(await post(receiver, { body: overLimit })).toBe(413);
        expect(calls).toHaveLength(1);
    }, 30_000);

    /**
     * The exposure this closes: 25 MB of unverified input buffered per
     * connection before the signature can be checked. The proof that no
     * body was read is the timing — the answer arrives while the client
     * still owes 25 MB it never sends.
     */
    it("refuses a declared oversize body before reading it", async () => {
        const { calls, accept } = recordingAccept();
        const status = await statusLineFor(
            createReceiver({ secret: SECRET, log: silent, accept }),
            (socket, host) => {
                socket.write(
                    "POST / HTTP/1.1\r\n" +
                        `Host: ${host}\r\n` +
                        `Content-Length: ${String(25 * 1024 * 1024 + 1)}\r\n` +
                        `${SIGNATURE_HEADER}: ${signBody(SECRET, BODY)}\r\n` +
                        `x-github-delivery: ${GUID}\r\n` +
                        "x-github-event: issues\r\n\r\n" +
                        "only-these-few-bytes",
                );
            },
        );
        expect(status).toContain("413");
        expect(calls).toEqual([]);
    });

    /**
     * A chunked body declares no length to pre-refuse, so the streaming
     * cap is the only thing that can answer it — and it is still there.
     */
    it("caps an oversized chunked body that declares no length", async () => {
        const { calls, accept } = recordingAccept();
        const receiver = createReceiver({ secret: SECRET, log: silent, accept });
        expect(await postChunked(receiver, 25 * 1024 * 1024 + 1)).toBe(413);
        expect(calls).toEqual([]);
    }, 30_000);

    /**
     * What the cap does to the connection, which the case above cannot see:
     * it sizes the body at one byte over so the client finishes writing
     * first, and a sender that keeps going after a 413 is a sender still
     * spending this process's memory. The answer is written, then the
     * request is cut — and nothing downstream of the cap runs on the body
     * that was never collected.
     */
    it("cuts the connection it capped rather than reading on", async () => {
        const { calls, accept } = recordingAccept();
        const request = requestStream();
        const recorded = responseRecorder();
        const completion = createReceiver({ secret: SECRET, log: silent, accept })(
            request,
            recorded.response,
        );
        request.write(Buffer.alloc(25 * 1024 * 1024 + 1, 0x62));
        await completion;

        expect(recorded.status()).toBe(413);
        expect(request.destroyed).toBe(true);
        expect(calls).toEqual([]);
    }, 30_000);

    it.each(["client-abort", "server-error"] as const)(
        "settles a real %s request without accepting partial input",
        async (mode) => {
            expect(await interruptRealRequest(mode)).toBe(0);
        },
    );

    it.each(["aborted", "error"] as const)(
        "handles the isolated %s fallback without accepting partial input",
        async (event) => {
            const { calls, accept } = recordingAccept();
            const request = requestStream();
            const recorded = responseRecorder();
            const completion = createReceiver({ secret: SECRET, log: silent, accept })(
                request,
                recorded.response,
            );
            if (event === "aborted") request.emit(event);
            else request.emit(event, new Error("socket failed"));
            await completion;
            expect(recorded.status()).toBe(500);
            expect(calls).toEqual([]);
        },
    );

    it("does not try to replace a response whose headers were already sent", async () => {
        const request = requestStream();
        const recorded = responseRecorder(true);
        const completion = createReceiver({
            secret: SECRET,
            log: silent,
            accept: () => "accepted",
        })(request, recorded.response);
        request.emit("error", new Error("late socket error"));
        await completion;
        expect(recorded.status()).toBeUndefined();
        expect(recorded.ended()).toBe(false);
    });
});

describe("the liveness probe", () => {
    it("answers /healthz with a static body, and consults nothing", async () => {
        const { calls, accept } = recordingAccept();
        const answer = await probe(
            createReceiver({ secret: SECRET, log: silent, accept }),
            "/healthz",
        );
        // Typed, because a prober reading an untyped body is a prober whose
        // client is guessing — and the guess node makes for a bare 200 is
        // not text.
        expect(answer).toEqual({ status: 200, body: "ok\n", contentType: "text/plain" });
        expect(calls).toEqual([]);
    });

    it("ignores the query string a prober appends", async () => {
        const answer = await probe(
            createReceiver({ secret: SECRET, log: silent, accept: () => "accepted" }),
            "/healthz?ts=1755000000",
        );
        expect(answer.status).toBe(200);
    });

    /** Everything else a GET can be is the 405 it always was. */
    it.each(["/", "/healthzz", "/healthz/deep", "/HEALTHZ"])(
        "still 405s a GET %s",
        async (path) => {
            const { calls, accept } = recordingAccept();
            expect(
                await probe(createReceiver({ secret: SECRET, log: silent, accept }), path),
            ).toMatchObject({
                status: 405,
            });
            expect(calls).toEqual([]);
        },
    );

    it("keeps out of the webhook's way: a signed POST to it is a delivery", async () => {
        const { calls, accept } = recordingAccept();
        const status = await post(createReceiver({ secret: SECRET, log: silent, accept }), {
            path: "/healthz",
        });
        expect(status).toBe(202);
        expect(calls).toHaveLength(1);
    });
});

describe("malformed requests get truthful statuses", () => {
    /**
     * Each row is one malformed request and the status it earns. Reaching
     * `accept` is asserted against for every row, not just some: a delivery
     * the edge could not even address must never reach the store.
     */
    it.each([
        ["a non-POST", 405, { method: "GET", signature: null }],
        ["a signed delivery without a GUID", 400, { guid: null }],
        ["a signed delivery with a malformed GUID", 400, { guid: "not-a-guid" }],
        ["a signed delivery without an event name", 400, { event: null }],
        ["a signed delivery with an empty event name", 400, { event: "" }],
    ] as const)("%s is %i", async (_name, expectedStatus, overrides) => {
        const { calls, accept } = recordingAccept();
        const status = await post(
            createReceiver({ secret: SECRET, log: silent, accept }),
            overrides,
        );
        expect(status).toBe(expectedStatus);
        expect(calls).toEqual([]);
    });

    it.each([
        [SIGNATURE_HEADER, [signBody(SECRET, BODY)], 401],
        ["x-github-delivery", [GUID], 400],
    ] as const)("rejects a repeated %s header", async (header, value, expectedStatus) => {
        const { calls, accept } = recordingAccept();
        const request = requestStream();
        request.headers = {
            [SIGNATURE_HEADER]: signBody(SECRET, BODY),
            "x-github-delivery": GUID,
            "x-github-event": "issues",
            [header]: [...value],
        };
        const recorded = responseRecorder();
        const completion = createReceiver({ secret: SECRET, log: silent, accept })(
            request,
            recorded.response,
        );
        request.end(BODY);
        await completion;
        expect(recorded.status()).toBe(expectedStatus);
        expect(calls).toEqual([]);
    });
});
