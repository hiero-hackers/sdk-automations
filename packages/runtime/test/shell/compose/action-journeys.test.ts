/**
 * Every capability × every capture through the one-shot action composition, held to the same
 * table as the hosted journeys: one run per cell, the rows the store keeps about the item.
 * `JOURNEYS_PRINT=1` prints every cell as it decided.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { type EngineCapability } from "@hiero-hackers/automation-core";
import { CAPABILITIES } from "@hiero-hackers/automation-capabilities";
import {
    CONFIGS,
    configFor,
    JOURNEYS,
    capture,
    WEBHOOK_CAPTURES,
    type Row,
} from "@hiero-hackers/automation-testkit";
import { parseActionEnvironment, runAction, runStore } from "../../../src/shell/compose/action.js";
import { scriptedGitHub } from "./scripted-github.js";

const START = new Date("2026-09-15T10:00:00.000Z");

afterEach(() => {
    vi.unstubAllGlobals();
});

/** Run one capture as an action for one capability alone; answer the rows held about its item. */
async function journey(capability: EngineCapability, name: string): Promise<Row[]> {
    const held = capture(name);
    const payload = held.json() as {
        issue?: { number: number };
        pull_request?: { number: number };
        repository: { name: string; full_name: string; owner: { login: string } };
    };
    const number = (payload.issue ?? payload.pull_request)?.number;
    if (number === undefined) throw new Error(`${name} names no item`);
    const repository = { owner: payload.repository.owner.login, repo: payload.repository.name };
    const item = { kind: held.event === "pull_request" ? "pullRequest" : "issue", number } as const;
    const parsed = parseActionEnvironment({
        GITHUB_REPOSITORY: payload.repository.full_name,
        GITHUB_EVENT_NAME: held.event,
        GITHUB_EVENT_PATH: "/tmp/event.json",
        INPUT_TOKEN: "runner-token",
        GITHUB_RUN_ID: "42",
        GITHUB_RUN_ATTEMPT: "1",
        GITHUB_SERVER_URL: "https://github.com",
    });
    if (!parsed.ok) throw new Error(parsed.errors.join("; "));
    scriptedGitHub({ now: () => START, config: () => configFor(capability.declaration.name) });
    const store = runStore();
    try {
        const outcome = await runAction(parsed.run, {
            payload: held.bytes(),
            store,
            clock: () => START,
            log: () => undefined,
            capabilities: [capability],
        });
        expect(outcome.exitCode, `${capability.declaration.name} × ${name} exit`).toBe(0);
        expect(
            outcome.events.find((event) => event.event === "deliveryCompleted"),
            `${capability.declaration.name} × ${name} completed`,
        ).toMatchObject({ kind: "decision" });
        expect(outcome.items).toContainEqual(item);
        return store.ledger
            .decisionsOn(repository, item)
            .map(({ capability: by, verdict, code }) => ({ capability: by, verdict, code }))
            .sort((a, b) =>
                `${a.capability}${a.verdict}${a.code}`.localeCompare(
                    `${b.capability}${b.verdict}${b.code}`,
                ),
            );
    } finally {
        store.close();
    }
}

const names = CAPABILITIES.map((held) => held.declaration.name);

describe("the table covers the registry", () => {
    it("has a config for every shipped capability and no other", () => {
        expect(Object.keys(CONFIGS).sort()).toEqual([...names].sort());
    });
});

describe.each(CAPABILITIES.map((held) => [held.declaration.name, held] as const))(
    "%s decides every captured delivery as its cells say, as an action",
    (name, capability) => {
        it.each(WEBHOOK_CAPTURES.map((held) => held.name))("%s", async (captureName) => {
            const rows = await journey(capability, captureName);
            if (process.env["JOURNEYS_PRINT"] === "1") {
                process.stdout.write(`${name} ${captureName} ${JSON.stringify(rows)}\n`);
            }
            expect(rows).toEqual(JOURNEYS[name]?.[captureName] ?? []);
        });
    },
);
