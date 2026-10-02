/**
 * Every capability × every capture through the composed shell over the live adapter, with
 * GitHub scripted behind `fetch`: webhook → verify → accept → config → reads → decide → rows.
 * The rows are the product (D173) and `journeys.ts` is the table they are held to; a capability
 * the registry gains fails here until it has a config and its cells. `JOURNEYS_PRINT=1` prints
 * every cell as it decided.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { writeFileSync } from "node:fs";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { signBody, SIGNATURE_HEADER, type EngineCapability } from "@hiero-hackers/automation-core";
import { CAPABILITIES } from "@hiero-hackers/automation-capabilities";
import { capture, useTempDir, WEBHOOK_CAPTURES } from "@hiero-hackers/automation-testkit";
import { Store } from "../../../src/store/index.js";
import { createShell, type Log, type Shell, type ShellEvent } from "../../../src/shell/index.js";
import { liveGitHub } from "../../../src/shell/compose/live.js";
import { CONFIGS, JOURNEYS, type Row } from "./journeys.js";
import { scriptedGitHub } from "./scripted-github.js";

const SECRET = "journeys-secret";
const START = new Date("2026-09-15T10:00:00.000Z");
const GUID_PREFIX = "83e4273f-dd89-22f4-92bc-5da478ed1";

const temp = useTempDir("shell-journeys-");
let logged: ShellEvent[];
const log: Log = (event) => logged.push(event);
let store: Store;
let running: Shell[];

beforeEach(() => {
    logged = [];
    running = [];
    store = new Store(temp.file("store.sqlite"));
});
afterEach(() => {
    for (const shell of running) shell.stopTick();
    vi.unstubAllGlobals();
    store.close();
});

const configFor = (capability: string): string => `schemaVersion: 2
mode: dry-run
capabilities:
${CONFIGS[capability] ?? ""}mappings:
  labels:
    awaitingTriage: "status: triage"
  commands:
    working: /working
`;

function buildShell(capability: EngineCapability): Shell {
    const name = capability.declaration.name;
    scriptedGitHub({ now: () => START, config: () => configFor(name) });
    const privateKeyPath = temp.file("app.pem");
    writeFileSync(
        privateKeyPath,
        generateKeyPairSync("rsa", {
            modulusLength: 2048,
            publicKeyEncoding: { type: "spki", format: "pem" },
            privateKeyEncoding: { type: "pkcs8", format: "pem" },
        }).privateKey,
    );
    const built = liveGitHub({
        credentials: { appId: "123456", installationId: "789", privateKeyPath },
        writes: null,
        killSwitchActive: false,
        clock: () => START,
        share: 0.4,
        contentCreationHourly: null,
        knownCapabilities: [capability.declaration],
        ownWrites: () => () => [],
        log,
    });
    const shell = createShell({
        secret: SECRET,
        store,
        capabilities: [capability],
        seams: built.seamsFor,
        deliveryAllowance: built.deliveryAllowance,
        clock: () => START,
        tickMs: 60_000,
        log,
    });
    running.push(shell);
    return shell;
}

/** Over node's own client: `fetch` is the scripted GitHub while a journey runs. */
function post(port: number, event: string, body: Buffer, index: number): Promise<number> {
    return new Promise((resolve, reject) => {
        const sent = request(
            {
                host: "127.0.0.1",
                port,
                method: "POST",
                path: "/",
                headers: {
                    [SIGNATURE_HEADER]: signBody(SECRET, body),
                    "x-github-delivery": `${GUID_PREFIX}${String(index).padStart(3, "0")}`,
                    "x-github-event": event,
                    "content-length": body.length,
                },
            },
            (response) => {
                response.resume();
                response.on("end", () => resolve(response.statusCode ?? 0));
            },
        );
        sent.on("error", reject);
        sent.end(body);
    });
}

/** Post one capture, wait for its pass, answer the rows the store holds about its item. */
async function journey(capability: EngineCapability, name: string, index: number): Promise<Row[]> {
    const held = capture(name);
    const payload = held.json() as {
        issue?: { number: number };
        pull_request?: { number: number };
        repository: { name: string; owner: { login: string } };
    };
    const number = (payload.issue ?? payload.pull_request)?.number;
    if (number === undefined) throw new Error(`${name} names no item`);
    const repository = { owner: payload.repository.owner.login, repo: payload.repository.name };
    const item = { kind: held.event === "pull_request" ? "pullRequest" : "issue", number } as const;
    const shell = buildShell(capability);
    await new Promise<void>((resolve) => shell.server.listen(0, "127.0.0.1", resolve));
    try {
        const { port } = shell.server.address() as AddressInfo;
        expect(await post(port, held.event, held.bytes(), index)).toBe(202);
    } finally {
        await new Promise<void>((resolve, reject) =>
            shell.server.close((error) => (error ? reject(error) : resolve())),
        );
    }
    await shell.settled();
    await shell.drain();
    const completion = logged.find((event) => event.event === "deliveryCompleted");
    expect(completion, `${capability.declaration.name} × ${name} completed`).toMatchObject({
        kind: "decision",
    });
    return store.ledger
        .decisionsOn(repository, item)
        .map(({ capability: by, verdict, code }) => ({ capability: by, verdict, code }))
        .sort((a, b) =>
            `${a.capability}${a.verdict}${a.code}`.localeCompare(
                `${b.capability}${b.verdict}${b.code}`,
            ),
        );
}

const names = CAPABILITIES.map((held) => held.declaration.name);

describe("the table covers the registry", () => {
    it("has a config for every shipped capability and no other", () => {
        expect(Object.keys(CONFIGS).sort()).toEqual([...names].sort());
    });

    it("has a journey for every shipped capability and no other", () => {
        expect(Object.keys(JOURNEYS).sort()).toEqual([...names].sort());
    });
});

describe.each(CAPABILITIES.map((held) => [held.declaration.name, held] as const))(
    "%s decides every captured delivery as its cells say",
    (name, capability) => {
        it.each(WEBHOOK_CAPTURES.map((held, index) => [held.name, index] as const))(
            "%s",
            async (captureName, index) => {
                const rows = await journey(
                    capability,
                    captureName,
                    names.indexOf(name) * 100 + index,
                );
                if (process.env["JOURNEYS_PRINT"] === "1") {
                    process.stdout.write(`${name} ${captureName} ${JSON.stringify(rows)}\n`);
                }
                expect(rows).toEqual(JOURNEYS[name]?.[captureName] ?? []);
            },
        );
    },
);
