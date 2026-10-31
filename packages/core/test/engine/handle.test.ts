/**
 * The handle's three verbs: `ask` answers or ends the evaluation, `intent`
 * reads the occasion and the claims off the record, `skip` stops and says why.
 */

import { describe, expect, it } from "vitest";
import {
    decide,
    declareCapability,
    spec,
    type AnyIntent,
    type EngineCapability,
    type Externals,
} from "../../src/index.js";
import { EngineHandle, isSkipSignal } from "../../src/engine/invoke.js";
import { configEnabling, sweptIssue, webhookIssue } from "../../src/author/testing.js";

const declaration = declareCapability({
    name: "triage",
    triggers: [{ kind: "event", event: "issues" }],
    settings: spec({}),
    moves: ["intakeObserved", "triageCompleted"],
    resolvers: ["isAutomationActor"],
    intents: ["applyMappedLabel", "postManagedComment"],
});

const positioned = (meaning: "ready" | null) =>
    webhookIssue({
        position: {
            kind: "position",
            state: { meaning, blocked: false, closedBy: null },
            ignored: [],
        },
    });

const answering = (answer: unknown) => async () => answer as never;

describe("ask", () => {
    it("hands back the value of an answered question", async () => {
        const handle = new EngineHandle(
            declaration,
            webhookIssue(),
            answering({ ok: true, value: true }),
        );
        await expect(handle.ask("isAutomationActor", { login: "x" })).resolves.toBe(true);
        expect(handle.skipped).toBe(false);
    });

    it("ends the evaluation with the platform's sentinel when the question is unanswered", async () => {
        const handle = new EngineHandle(
            declaration,
            webhookIssue(),
            answering({ ok: false, reason: "rateLimited", detail: "later" }),
        );
        const thrown = await handle
            .ask("isAutomationActor", { login: "x" })
            .catch((e: unknown) => e);
        expect(isSkipSignal(thrown)).toBe(true);
        expect(handle.skipped).toBe(true);
        expect(handle.explanations).toEqual([
            {
                capability: "triage",
                summary: "Skipped: the isAutomationActor resolver could not answer.",
                detail: ["resolver reason: rateLimited", "later"],
            },
        ]);
    });

    it("records an undeclared question as a violation, then skips", async () => {
        const handle = new EngineHandle(
            declaration,
            webhookIssue(),
            answering({ ok: true, value: [] }),
        );
        const thrown = await handle
            .ask("linkedIssues", { item: { kind: "issue", number: 1 } })
            .catch((e: unknown) => e);
        expect(isSkipSignal(thrown)).toBe(true);
        expect(handle.violations).toEqual(["linkedIssues"]);
    });

    it("recognises nothing but its own sentinel, a revoked proxy included", () => {
        const revoked = Proxy.revocable({}, {});
        revoked.revoke();
        expect(isSkipSignal(revoked.proxy)).toBe(false);
        expect(isSkipSignal(new Error("x"))).toBe(false);
    });
});

describe("intent", () => {
    const comment = {
        operation: "postManagedComment",
        desired: { kind: "notice", body: "b" },
    } as const;

    it("reads the occasion off the record and the cause off the trigger", () => {
        const facts = webhookIssue();
        const intent = new EngineHandle(declaration, facts, undefined).intent({
            ...comment,
            explain: "Said.",
        });
        expect(intent.capability).toBe("triage");
        expect(intent.repository).toEqual(facts.repository);
        expect(intent.item).toEqual(facts.item);
        expect(intent.cause).toEqual({ cause: "issues", observedAt: facts.observedAt });
        expect(intent.explanation).toEqual({ capability: "triage", summary: "Said.", detail: [] });
    });

    it("names the sweep as the cause of a swept record, and keeps a cause the request states", () => {
        const handle = new EngineHandle(declaration, sweptIssue(), undefined);
        expect(handle.intent({ ...comment, explain: "s" }).cause.cause).toBe("sweep");
        expect(handle.intent({ ...comment, cause: "stale", explain: "s" }).cause.cause).toBe(
            "stale",
        );
    });

    it("claims what the record showed: closure and every meaning present", () => {
        const intent = new EngineHandle(declaration, positioned("ready"), undefined).intent({
            ...comment,
            explain: "s",
        });
        expect(intent.claims).toEqual({
            meaningsPresent: ["ready"],
            meaningsAbsent: [],
            closed: false,
        });
    });

    it("claims a label's meaning absent and takes its cause from the map", () => {
        const intent = new EngineHandle(declaration, positioned(null), undefined).intent({
            operation: "applyMappedLabel",
            desired: { meaning: "awaitingTriage" },
            explain: "s",
        });
        expect(intent.desired).toEqual({ meaning: "awaitingTriage", cause: "intakeObserved" });
        expect(intent.claims.meaningsAbsent).toEqual(["awaitingTriage"]);
    });

    it("lets a request narrow one claim and derives the rest", () => {
        const intent = new EngineHandle(declaration, positioned("ready"), undefined).intent({
            ...comment,
            claims: { meaningsPresent: [] },
            explain: "s",
        });
        expect(intent.claims).toEqual({ meaningsPresent: [], meaningsAbsent: [], closed: false });
    });

    it("skips a label with no edge from the item's position", () => {
        const handle = new EngineHandle(declaration, positioned(null), undefined);
        let thrown: unknown = null;
        try {
            handle.intent({
                operation: "applyMappedLabel",
                desired: { meaning: "ready" },
                explain: "s",
            });
        } catch (e: unknown) {
            thrown = e;
        }
        expect(isSkipSignal(thrown)).toBe(true);
        expect(handle.explanations[0]?.summary).toBe(
            "Skipped: no edge this capability owns moves this item to ready.",
        );
        expect(handle.explanations[0]?.detail).toEqual(["from no position"]);
    });
});

describe("decide contains the sentinel", () => {
    const config = configEnabling(["triage"], [declaration]);
    const externals: Externals = {
        killSwitchActive: false,
        installationGrants: ["issues:write"],
        latestHumanChangeAt: () => null,
        resolve: answering({ ok: false, reason: "unavailable", detail: "down" }),
    };

    it("reports a skipped evaluation as explained, never as failed", async () => {
        const capability: EngineCapability = {
            declaration: declaration as never,
            async evaluate(_f: never, _c: never, platform: never): Promise<readonly AnyIntent[]> {
                const handle = platform as EngineHandle;
                await handle.ask("isAutomationActor", { login: "x" });
                return [];
            },
        };
        const decision = await decide(
            { kind: "facts", facts: webhookIssue() },
            config,
            [capability],
            externals,
        );
        expect(decision.report.findings.map((f) => f.code)).toEqual(["capabilityExplained"]);
    });

    it("refuses the intents of a capability that caught the sentinel", async () => {
        const capability: EngineCapability = {
            declaration: declaration as never,
            async evaluate(_f: never, _c: never, platform: never): Promise<readonly AnyIntent[]> {
                const handle = platform as EngineHandle;
                try {
                    await handle.ask("isAutomationActor", { login: "x" });
                } catch {
                    // The malformed capability: it swallows the platform's stop.
                }
                return [
                    handle.intent({
                        operation: "postManagedComment",
                        desired: { kind: "notice", body: "b" },
                        explain: "s",
                    }),
                ];
            },
        };
        const decision = await decide(
            { kind: "facts", facts: webhookIssue() },
            config,
            [capability],
            externals,
        );
        expect(decision.approved).toEqual([]);
        expect(decision.report.findings.map((f) => f.code)).toEqual([
            "capabilityExplained",
            "intentsAfterSkip",
        ]);
    });
});
