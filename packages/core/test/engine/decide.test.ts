/**
 * The verb, exercised on real deliveries (D92 phase 1). Parity with the
 * hand-wired slice lives in `slice.test.ts`; this file owns the paths the
 * slice does not walk — refusals, dry-run, disabled capabilities, hostile
 * shapes, and the derivation catching a stale claim the OLD API would have
 * accepted on the caller's word.
 */

import { describe, expect, it } from "vitest";
import { capture } from "@hiero-hackers/automation-testkit";
import {
    decide,
    describeChange,
    declareCapability,
    spec,
    deriveManagedMarker,
    intentFactory,
    deriveIdempotencyKey,
    MANAGED_MARKER_PREFIX,
    managedMarkerPayload,
    matchesManagedComment,
    problems,
    toEngine,
    UNREAD,
    type AnyIntent,
    type Capability,
    type ClosureReason,
    type EngineCapability,
    type Externals,
    type Intent,
    type IssueFacts,
    type RepositoryConfig,
} from "../../src/index.js";
import { configWith, triageConfig } from "../config/builders.js";

const payload = (name: string): unknown => capture(name).json();

const declaration = declareCapability({
    name: "triage",
    triggers: [{ kind: "event", event: "issues" }],
    settings: spec({}),
    requiredMappings: {},
    facts: ["issue"],
    needs: [],
    resolvers: [],
    intents: ["applyMappedLabel"],
});

/** The smallest real capability: triage anything with no position. */
const triage: EngineCapability = {
    declaration,
    async evaluate(facts: never): Promise<readonly AnyIntent[]> {
        const o = facts as {
            repository: { owner: string; repo: string };
            item: { kind: "issue"; number: number };
            position: { kind: string; state?: { meaning: string | null } };
            observedAt: Date;
        };
        if (o.position.kind !== "position" || o.position.state?.meaning !== null) return [];
        const draft = {
            capability: "triage",
            repository: o.repository,
            item: o.item,
            operation: "applyMappedLabel",
            claims: { meaningsPresent: [], meaningsAbsent: ["awaitingTriage"], closed: false },
            desired: { meaning: "awaitingTriage", cause: "intakeObserved" },
            cause: { cause: "issueWithoutPosition", observedAt: o.observedAt },
            explanation: {
                capability: "triage",
                summary: "New issue placed in triage.",
                detail: [],
            },
            grace: null,
        } as const satisfies Omit<Intent<"applyMappedLabel">, "idempotencyKey">;
        return [{ ...draft, idempotencyKey: deriveIdempotencyKey(draft) }];
    },
};

/**
 * A webhook-shaped issue record: the projection read, every group marked
 * unread — what `normalize/` produces (facts.md §2).
 */
const webhookIssue = (over: Partial<IssueFacts> = {}): IssueFacts => ({
    kind: "issue",
    repository: { owner: "o", repo: "r" },
    item: { kind: "issue", number: 7 },
    observedAt: new Date("2026-08-07T00:00:00Z"),
    trigger: { kind: "event", event: "issues" },
    author: "opener",
    actor: { login: "opener" },
    locked: false,
    arrival: null,
    position: {
        kind: "position",
        state: { meaning: null, blocked: false, closedBy: null },
        ignored: [],
    },
    alerts: { carried: [], arrived: [] },
    assignees: UNREAD,
    links: UNREAD,
    command: UNREAD,
    ...over,
});

const REV = "rev-engine-1";
const TRIAGE_LABELS = { awaitingTriage: "status: triage" };

/** The shared triage repository, stamped with this file's revision. */
const configIn = (mode: "active" | "dry-run" | "observe", enabled = true): RepositoryConfig =>
    triageConfig(mode, REV, enabled);

const externals: Externals = {
    killSwitchActive: false,
    installationGrants: ["issues:write"],
    latestHumanChangeAt: () => null,
};

const delivery = (name: string) =>
    ({
        kind: "delivery",
        repository: { owner: "scrubbed-1", repo: "scrubbed-2" },
        event: name.split(".")[0]!,
        payload: payload(name),
    }) as const;

describe("the apply path, on a real delivery", () => {
    it("an unpositioned issue yields one approved intent and a clean report", async () => {
        const decision = await decide(
            delivery("issues.opened.json"),
            configIn("active"),
            [triage],
            externals,
        );
        expect(decision.approved).toHaveLength(1);
        expect(decision.approved[0]).toMatchObject({
            intent: { operation: "applyMappedLabel", item: { kind: "issue", number: 164 } },
            // A label carries no comment identity, and minting one would be
            // an effect nobody asked for (D125).
            managedComment: null,
        });
        // D92 3d resolved the phase-1 note: an acting intent's explanation
        // IS a finding, beside its verdict.
        expect(decision.report.findings.map((f) => f.code)).toEqual([
            "capabilityExplained",
            "applied",
        ]);
        expect(problems(decision.report)).toEqual([]);
        expect(decision.report.revision).toBe("rev-engine-1");
    });

    it("dry-run tells the same story, names the change, and approves nothing", async () => {
        const decision = await decide(
            delivery("issues.opened.json"),
            configIn("dry-run"),
            [triage],
            externals,
        );
        expect(decision.approved).toEqual([]);
        expect(decision.report.findings.map((f) => `${f.code}:${f.severity}`)).toEqual([
            "capabilityExplained:info",
            "modeRecordsOnly:notice",
            "wouldApply:info",
        ]);
    });

    it("an already-positioned issue invites nothing — the capability's own restraint", async () => {
        const decision = await decide(
            delivery("issues.labeled.json"),
            configIn("active"),
            [triage],
            externals,
        );
        expect(decision.approved).toEqual([]);
        expect(decision.report.findings).toEqual([]);
    });
});

/**
 * The one thing `dry-run` says that `observe` does not (stage E). The claim is
 * narrow on purpose: a rehearsal DESCRIBES, so the mode still approves nothing
 * and still mints no identity — the pin the marker suite states as its own.
 */
describe("dry-run rehearses, observe records", () => {
    const observedAt = new Date("2026-08-07T00:00:00Z");
    const item = { kind: "issue", number: 7 } as const;
    const repository = { owner: "o", repo: "r" } as const;

    /** One capability, two intents — so "one per intent" is observable. */
    const noisy: EngineCapability = {
        declaration: declareCapability({
            ...declaration,
            intents: ["applyMappedLabel", "postManagedComment"],
        }) as never,
        async evaluate(): Promise<readonly AnyIntent[]> {
            const make = intentFactory("triage", { repository, item, observedAt });
            return [
                make({
                    operation: "applyMappedLabel",
                    desired: { meaning: "awaitingTriage", cause: "intakeObserved" },
                    claims: { meaningsAbsent: ["awaitingTriage"] },
                    cause: "issueWithoutPosition",
                    explain: { summary: "New issue placed in triage." },
                }),
                make({
                    operation: "postManagedComment",
                    desired: { kind: "notice", body: "what the App would say" },
                    cause: "issueWithoutPosition",
                    explain: { summary: "New issue announced." },
                }),
            ];
        },
    };

    const facts = webhookIssue({ repository, item, observedAt });

    const rehearse = (mode: "dry-run" | "observe", capability = noisy) =>
        decide({ kind: "facts", facts }, configIn(mode), [capability], externals);

    it("names every intent that got as far as the mode rule, one finding each", async () => {
        const decision = await rehearse("dry-run");
        expect(decision.report.findings.map((f) => f.code)).toEqual([
            "capabilityExplained",
            "modeRecordsOnly",
            "wouldApply",
            "capabilityExplained",
            "modeRecordsOnly",
            "wouldApply",
        ]);
        const rehearsed = decision.report.findings.filter((f) => f.code === "wouldApply");
        expect(rehearsed.map((f) => f.summary)).toEqual([
            "dry-run: triage would applyMappedLabel on o/r#7 — set mapped position awaitingTriage. Nothing was written.",
            "dry-run: triage would postManagedComment on o/r#7 — managed notice comment from triage. Nothing was written.",
        ]);
        // The subject is the effect arm, so an operator surface groups a
        // rehearsal with the verdict that explains why it stayed one.
        expect(rehearsed.map((f) => f.subject)).toEqual([
            { kind: "effect", capability: "triage", item, operation: "applyMappedLabel" },
            { kind: "effect", capability: "triage", item, operation: "postManagedComment" },
        ]);
    });

    it("says nothing extra in observe: that mode's promise is unchanged", async () => {
        const decision = await rehearse("observe");
        expect(decision.report.findings.map((f) => f.code)).toEqual([
            "capabilityExplained",
            "modeRecordsOnly",
            "capabilityExplained",
            "modeRecordsOnly",
        ]);
    });

    /**
     * The rehearsal is what the mode rule reached, never what an earlier rule
     * turned away. A refused intent that reported one would tell an operator
     * promoting the repository to `active` that a write is coming which the
     * ladder has already refused.
     */
    it("stays silent for an intent an earlier rule refused", async () => {
        const decision = await decide({ kind: "facts", facts }, configIn("dry-run"), [noisy], {
            ...externals,
            installationGrants: [],
        });
        expect(decision.report.findings.map((f) => f.code)).toEqual([
            "permissionMissing",
            "permissionMissing",
        ]);
    });

    /**
     * The invariant D125 fixed, restated where the rehearsal could break it:
     * a description that derived a marker would be minting the name of a write
     * nobody is going to make.
     */
    it("derives no managed identity, and prints none", async () => {
        const decision = await rehearse("dry-run");
        expect(decision.approved).toEqual([]);
        for (const found of decision.report.findings) {
            expect(found.summary).not.toContain(MANAGED_MARKER_PREFIX);
        }
    });
});

describe("the gates, each visible in the report", () => {
    it("a disabled capability is never consulted", async () => {
        const decision = await decide(
            delivery("issues.opened.json"),
            configIn("active", false),
            [triage],
            externals,
        );
        expect(decision.report.findings).toEqual([]);
        expect(decision.approved).toEqual([]);
    });

    it("refuses an intent naming another repository", async () => {
        const foreign: EngineCapability = {
            declaration: triage.declaration,
            async evaluate(facts: never): Promise<readonly AnyIntent[]> {
                const current = facts as IssueFacts;
                return [
                    intentFactory("triage", {
                        repository: { owner: "other", repo: current.repository.repo },
                        item: current.item,
                        observedAt: current.observedAt,
                    })({
                        operation: "applyMappedLabel",
                        desired: { meaning: "awaitingTriage", cause: "intakeObserved" },
                        cause: "sawTheItem",
                        explain: { summary: "s" },
                    }),
                ];
            },
        };
        const decision = await decide(
            delivery("issues.opened.json"),
            configIn("active"),
            [foreign],
            externals,
        );
        expect(decision.approved).toEqual([]);
        expect(decision.report.findings.map((finding) => finding.code)).toEqual([
            "preconditionStale",
        ]);
    });

    /**
     * The commonest configuration of all: a capability the repository has
     * never heard of. `capabilities` is a null-prototype record, so the
     * block reads `undefined` — the admission test has to survive that
     * rather than reach into it, or every unadopted capability is a crash
     * instead of a skip.
     */
    it("a capability the file never mentions is never consulted either", async () => {
        const unmentioned = configWith({ labels: TRIAGE_LABELS, revision: REV });
        const decision = await decide(
            delivery("issues.opened.json"),
            unmentioned,
            [triage],
            externals,
        );
        expect(decision.report.findings).toEqual([]);
        expect(decision.approved).toEqual([]);
    });

    it("the kill switch refuses with its own code, ahead of everything", async () => {
        const decision = await decide(
            delivery("issues.opened.json"),
            configIn("active"),
            [triage],
            { ...externals, killSwitchActive: true },
        );
        expect(decision.approved).toEqual([]);
        expect(decision.report.findings.map((f) => f.code)).toContain("killSwitch");
    });

    it("a missing grant is a problem naming the grant", async () => {
        const decision = await decide(
            delivery("issues.opened.json"),
            configIn("active"),
            [triage],
            { ...externals, installationGrants: [] },
        );
        const problem = problems(decision.report);
        expect(problem).toHaveLength(1);
        expect(problem[0]).toMatchObject({ code: "permissionMissing" });
        expect(problem[0]!.summary).toContain("issues:write");
    });

    /**
     * The reason D92 exists: the capability claims `awaitingTriage` absent,
     * the delivery SHOWS it present, and the engine derives the mismatch —
     * no caller asserted anything, so no caller could lie. Under the old
     * API this exact run would apply if the shell said `preconditionHolds:
     * true`, and nothing checked the shell.
     */
    it("a stale claim is caught by derivation, not by caller honesty", async () => {
        const eager: EngineCapability = {
            declaration: declareCapability({ ...declaration, intents: ["postManagedComment"] }),
            async evaluate(facts: never): Promise<readonly AnyIntent[]> {
                const o = facts as Parameters<typeof triage.evaluate>[0] extends never
                    ? {
                          repository: { owner: string; repo: string };
                          item: { kind: "issue"; number: number };
                          observedAt: Date;
                      }
                    : never;
                const draft = {
                    capability: "triage",
                    repository: o.repository,
                    item: o.item,
                    operation: "postManagedComment",
                    // The lie: claims no triage label, on a labeled issue.
                    claims: {
                        meaningsPresent: [],
                        meaningsAbsent: ["awaitingTriage"],
                        closed: false,
                    },
                    desired: { kind: "summary", body: "stale claim" },
                    cause: { cause: "issueWithoutPosition", observedAt: o.observedAt },
                    explanation: { capability: "triage", summary: "s", detail: [] },
                    grace: null,
                } as const satisfies Omit<Intent<"postManagedComment">, "idempotencyKey">;
                return [{ ...draft, idempotencyKey: deriveIdempotencyKey(draft) }];
            },
        };
        const decision = await decide(
            delivery("issues.labeled.json"),
            configIn("active"),
            [eager],
            externals,
        );
        expect(decision.approved).toEqual([]);
        expect(decision.report.findings.map((f) => f.code)).toContain("preconditionStale");
    });

    it("a screened-out intent is a problem finding, and stops there", async () => {
        const rogue: EngineCapability = {
            declaration,
            async evaluate(): Promise<readonly AnyIntent[]> {
                return [
                    {
                        capability: "someoneElse",
                        repository: { owner: "o", repo: "r" },
                        item: { kind: "issue", number: 1 },
                        operation: "applyMappedLabel",
                        claims: { meaningsPresent: [], meaningsAbsent: [], closed: null },
                        desired: { meaning: "awaitingTriage", cause: "intakeObserved" },
                        cause: { cause: "c", observedAt: new Date("2026-08-07T00:00:00Z") },
                        explanation: { capability: "someoneElse", summary: "s", detail: [] },
                        idempotencyKey: "k",
                        grace: null,
                    } as AnyIntent,
                ];
            },
        };
        const decision = await decide(
            delivery("issues.opened.json"),
            configIn("active"),
            [rogue],
            externals,
        );
        expect(decision.approved).toEqual([]);
        expect(decision.report.findings.map((f) => f.code)).toEqual(["foreignCapability"]);
    });

    it("an undeclared resolver is a defect finding, not a crash", async () => {
        const nosy: EngineCapability = {
            declaration,
            async evaluate(_o: never, _c: never, platform: never): Promise<readonly AnyIntent[]> {
                const handle = platform as {
                    resolve(q: string, i: unknown): Promise<{ ok: boolean }>;
                };
                const answer = await handle.resolve("linkedIssues", {
                    item: { kind: "issue", number: 1 },
                });
                expect(answer).toMatchObject({
                    ok: false,
                    reason: "notConfigured",
                    detail: expect.stringContaining("linkedIssues"),
                });
                return [];
            },
        };
        const decision = await decide(delivery("issues.opened.json"), configIn("active"), [nosy], {
            ...externals,
            resolve: async () => {
                throw new Error("an undeclared resolver must not reach its source");
            },
        });
        expect(decision.report.findings).toEqual([
            {
                severity: "problem",
                code: "undeclaredResolver",
                summary: expect.stringContaining("linkedIssues"),
                detail: [],
                subject: { kind: "capability", capability: "triage" },
            },
        ]);
    });
});

describe("deliveries that never reach a capability", () => {
    it("an ignored event reports itself as info", async () => {
        const decision = await decide(
            { kind: "delivery", repository: { owner: "o", repo: "r" }, event: "push", payload: {} },
            configIn("active"),
            [triage],
            externals,
        );
        expect(decision.report.findings).toEqual([
            {
                severity: "info",
                code: "deliveryIgnored",
                summary: expect.stringContaining("push"),
                detail: [],
                subject: { kind: "repository" },
            },
        ]);
        expect(decision.approved).toEqual([]);
    });

    it("a malformed delivery is a problem carrying the normalizer's code", async () => {
        const decision = await decide(
            {
                kind: "delivery",
                repository: { owner: "o", repo: "r" },
                event: "issues",
                payload: null,
            },
            configIn("active"),
            [triage],
            externals,
        );
        expect(problems(decision.report)).toEqual([
            {
                severity: "problem",
                code: "payloadNotObject",
                summary: expect.stringContaining("issues"),
                detail: [],
                subject: { kind: "repository" },
            },
        ]);
        // The report still names the repository the shell routed for.
        expect(decision.report.repository).toEqual({ owner: "o", repo: "r" });
    });
});

describe("paths the delivery tests never walk", () => {
    it("a facts-kind input skips normalization and decides identically", async () => {
        const viaDelivery = await decide(
            delivery("issues.opened.json"),
            configIn("active"),
            [triage],
            externals,
        );
        const normalized = (await import("../../src/index.js")).normalizeDelivery(
            "issues",
            payload("issues.opened.json"),
            configIn("active"),
        );
        if (normalized.kind !== "facts") throw new Error("fixture must normalize");
        const viaFacts = await decide(
            { kind: "facts", facts: normalized.facts },
            configIn("active"),
            [triage],
            externals,
        );
        expect(viaFacts.report).toEqual(viaDelivery.report);
        expect(viaFacts.approved).toEqual(viaDelivery.approved);
    });

    it("a pull-request delivery reaches a PR-observing capability", async () => {
        const watcher: EngineCapability = {
            declaration: declareCapability({
                ...declaration,
                name: "triage",
                facts: ["pullRequest"],
                needs: [],
                intents: [],
            }) as never,
            async evaluate(_o: never, _c: never, platform: never) {
                (platform as { explain(e: unknown): void }).explain({
                    capability: "triage",
                    summary: "Saw the pull request.",
                    detail: [],
                });
                return [];
            },
        };
        const decision = await decide(
            delivery("pull_request.opened.json"),
            configIn("active"),
            [watcher],
            externals,
        );
        // Subject included: an explanation volunteered through the handle
        // belongs to the CAPABILITY, not to an item — that is what separates
        // it from the per-intent explanations, and the operator surface
        // groups by exactly this field.
        expect(decision.report.findings).toEqual([
            expect.objectContaining({
                code: "capabilityExplained",
                severity: "info",
                subject: { kind: "capability", capability: "triage" },
            }),
        ]);
    });

    /**
     * The erasure `decide` depends on, exercised as itself. Every capability
     * in these tests is written as an `EngineCapability` already, so the one
     * conversion a real shell performs — a typed `Capability<D>` into the
     * heterogeneous list — was never run here at all.
     */
    it("toEngine erases the declaration type without substituting anything", async () => {
        const typed: Capability<typeof declaration> = {
            declaration,
            async evaluate() {
                return [];
            },
        };
        const erased = toEngine(typed);
        expect(erased).toBe(typed);

        const decision = await decide(
            delivery("issues.opened.json"),
            configIn("active"),
            [erased],
            externals,
        );
        expect(decision.report.findings).toEqual([]);
    });

    it("a declared resolver reaches the supplied source, and its answer returns", async () => {
        const asker: EngineCapability = {
            declaration: declareCapability({
                ...declaration,
                resolvers: ["linkedIssues"],
                intents: [],
            }) as never,
            async evaluate(_o: never, _c: never, platform: never) {
                const handle = platform as {
                    resolve(q: string, i: unknown): Promise<{ ok: boolean; value?: unknown }>;
                };
                const answer = await handle.resolve("linkedIssues", {
                    item: { kind: "issue", number: 164 },
                });
                expect(answer).toEqual({ ok: true, value: [] });
                return [];
            },
        };
        let asked: string | null = null;
        const decision = await decide(delivery("issues.opened.json"), configIn("active"), [asker], {
            ...externals,
            resolve: async (query) => {
                asked = query;
                return { ok: true, value: [] } as never;
            },
        });
        expect(asked).toBe("linkedIssues");
        expect(decision.report.findings).toEqual([]);
    });

    it("a declared resolver with no source answers unavailable, quietly", async () => {
        const asker: EngineCapability = {
            declaration: declareCapability({
                ...declaration,
                resolvers: ["linkedIssues"],
                intents: [],
            }) as never,
            async evaluate(_o: never, _c: never, platform: never) {
                const handle = platform as {
                    resolve(q: string, i: unknown): Promise<{ ok: boolean; reason?: string }>;
                };
                const answer = await handle.resolve("linkedIssues", {
                    item: { kind: "issue", number: 164 },
                });
                expect(answer).toMatchObject({
                    ok: false,
                    reason: "unavailable",
                    detail: expect.stringContaining("no resolver source"),
                });
                return [];
            },
        };
        const decision = await decide(
            delivery("issues.opened.json"),
            configIn("active"),
            [asker],
            externals,
        );
        expect(decision.report.findings).toEqual([]);
    });

    /**
     * One record is one item (facts.md §4). There is no list to look an item up
     * in, so the projection every intent of one decision is judged against is
     * the record's own — and an intent naming a NEIGHBOURING item has no world
     * of its own here, so it is refused rather than judged against someone
     * else's closed, blocked and precondition facts.
     */
    const SWEPT_REPO = { owner: "scrubbed-1", repo: "scrubbed-2" } as const;

    /** One record, open and unpositioned, every group read — what a sweep hands the ladders. */
    const swept = (number: number): IssueFacts => ({
        ...webhookIssue({ repository: SWEPT_REPO, item: { kind: "issue", number } }),
        trigger: { kind: "sweep" },
        assignees: [],
        links: { openPullRequests: [] },
    });

    const sweeperNaming = (number: number): EngineCapability => ({
        declaration: declareCapability({
            ...declaration,
            needs: ["assignees"],
            intents: ["unassign"],
        }) as never,
        async evaluate() {
            const draft = {
                capability: "triage",
                repository: SWEPT_REPO,
                item: { kind: "issue", number },
                operation: "unassign",
                claims: { meaningsPresent: [], meaningsAbsent: [], closed: false },
                desired: { login: "contributor" },
                cause: { cause: "sweep", observedAt: new Date("2026-08-07T00:00:00Z") },
                explanation: { capability: "triage", summary: "s", detail: [] },
                grace: null,
            } as const;
            return [{ ...draft, idempotencyKey: deriveIdempotencyKey(draft) } as never];
        },
    });

    it("judges an intent against the record's own projection, and stops for the switch", async () => {
        const decision = await decide(
            { kind: "facts", facts: swept(8) },
            configIn("active"),
            [sweeperNaming(8)],
            externals,
        );
        expect(decision.report.findings.map((finding) => finding.code)).toEqual([
            "capabilityExplained",
            "applied",
        ]);
        expect(decision.approved.map((effect) => effect.intent.item)).toEqual([
            { kind: "issue", number: 8 },
        ]);

        const stopped = await decide(
            { kind: "facts", facts: swept(8) },
            configIn("active"),
            [sweeperNaming(8)],
            { ...externals, killSwitchActive: true },
        );
        expect(stopped.approved).toEqual([]);
        expect(stopped.report.findings.map((finding) => finding.code)).toEqual(["killSwitch"]);
    });

    it("refuses an intent on an item the record does not carry", async () => {
        const decision = await decide(
            { kind: "facts", facts: swept(8) },
            configIn("active"),
            [sweeperNaming(9)],
            externals,
        );
        expect(decision.approved).toEqual([]);
        expect(decision.report.findings.map((finding) => finding.code)).toEqual([
            "preconditionStale",
        ]);
        expect(decision.report.findings[0]?.summary).toBe(
            "the intent names an item this record does not carry",
        );
    });

    /**
     * facts.md §4's other half. A webhook record marks `assignees` unread, so a
     * capability that declared the need is skipped and SAYS so — the
     * alternative is judging a clock from a list nobody read.
     */
    it("skips a capability whose needed group this producer did not read", async () => {
        const decision = await decide(
            { kind: "facts", facts: webhookIssue({ repository: SWEPT_REPO }) },
            configIn("active"),
            [sweeperNaming(9)],
            externals,
        );
        expect(decision.approved).toEqual([]);
        expect(decision.report.findings.map((finding) => finding.code)).toEqual(["factsUnread"]);
        expect(decision.report.findings[0]).toMatchObject({
            severity: "info",
            subject: { kind: "capability", capability: "triage" },
        });
        expect(decision.report.findings[0]?.summary).toContain("assignees");
    });
    it("a capability observing a different kind is never invoked", async () => {
        const prOnly: EngineCapability = {
            declaration: declareCapability({
                ...declaration,
                facts: ["pullRequest"],
                needs: [],
            }) as never,
            async evaluate(): Promise<readonly AnyIntent[]> {
                throw new Error("must not run");
            },
        };
        const decision = await decide(
            delivery("issues.opened.json"),
            configIn("active"),
            [prOnly],
            externals,
        );
        expect(decision.report.findings).toEqual([]);
    });
});

/**
 * Pause was platform-enforced and closure was not: the only thing standing
 * between a capability and a closed item was `claims.closed: false`, which
 * `intentFactory` defaults to no claim at all. These run a capability that
 * makes no claim whatsoever, so nothing but the rule can refuse it.
 */
describe("closure is a platform fact, not a capability's claim", () => {
    // `closed: true`, so the record reaches the capability and the WRITE rule refuses it.
    const commenter = declareCapability({
        ...declaration,
        closed: true,
        intents: ["postManagedComment"],
    });

    /** Every `claims` field left to its default, which is "I claim nothing". */
    const claimless: EngineCapability = {
        declaration: commenter as never,
        async evaluate(facts: never): Promise<readonly AnyIntent[]> {
            const o = facts as {
                repository: { owner: string; repo: string };
                item: { kind: "issue"; number: number };
                observedAt: Date;
            };
            return [
                intentFactory("triage", {
                    repository: o.repository,
                    item: o.item,
                    observedAt: o.observedAt,
                })({
                    operation: "postManagedComment",
                    desired: { kind: "notice", body: "b" },
                    cause: "sawTheItem",
                    explain: { summary: "Saw the item." },
                }),
            ];
        },
    };

    const observedAs = (closedBy: ClosureReason | null): IssueFacts =>
        webhookIssue({
            position: {
                kind: "position",
                state: { meaning: null, blocked: false, closedBy },
                ignored: [],
            },
        });

    it.each(["closedByHuman", "completedByLinkedMerge"] as const)(
        "refuses a write to an item closed as %s",
        async (closedBy) => {
            const decision = await decide(
                { kind: "facts", facts: observedAs(closedBy) },
                configIn("active"),
                [claimless],
                externals,
            );
            expect(decision.approved).toEqual([]);
            expect(decision.report.findings.map((f) => f.code)).toEqual(["itemClosed"]);
        },
    );

    it.each(["closedByHuman", "completedByLinkedMerge"] as const)(
        "never hands a capability that did not opt in an item closed as %s (D59)",
        async (closedBy) => {
            const decision = await decide(
                { kind: "facts", facts: observedAs(closedBy) },
                configIn("active"),
                [{ ...claimless, declaration: { ...commenter, closed: false } as never }],
                externals,
            );
            expect(decision.approved).toEqual([]);
            expect(decision.report.findings).toEqual([]);
        },
    );

    /** The other half: nothing about an OPEN item changed. */
    it("the same capability still acts on the same item while it is open", async () => {
        const decision = await decide(
            { kind: "facts", facts: observedAs(null) },
            configIn("active"),
            [claimless],
            externals,
        );
        expect(decision.approved).toHaveLength(1);
        expect(decision.report.findings.map((f) => f.code)).toEqual([
            "capabilityExplained",
            "applied",
        ]);
    });

    it("uses the record time even when a capability supplies a later cutoff", async () => {
        const spoofed: EngineCapability = {
            ...claimless,
            async evaluate(facts: never): Promise<readonly AnyIntent[]> {
                const [intent] = await claimless.evaluate(
                    facts,
                    undefined as never,
                    undefined as never,
                );
                return [{ ...intent!, evaluatedAt: new Date("2099-01-01T00:00:00Z") }];
            },
        };
        const observed = observedAs(null);
        const decision = await decide(
            { kind: "facts", facts: observed },
            configIn("active"),
            [spoofed],
            {
                ...externals,
                latestHumanChangeAt: () => observed.observedAt,
            },
        );

        expect(decision.approved).toEqual([]);
        expect(decision.report.findings.map((finding) => finding.code)).toEqual([
            "newerHumanChange",
        ]);
    });
});

/**
 * `decide()` claims to be total, and a shell that cannot get a report back
 * reclaims the delivery for good. Three seams can throw — the capability, the
 * resolver source, the ordering lookup — and each becomes a recorded defect
 * instead. The neighbour in each run is the second half of the claim: one
 * capability's crash is not the platform's.
 */
describe("every fallible seam is contained", () => {
    const brittle = declareCapability({ ...declaration, name: "brittle", intents: [] });
    const twoCapabilities = configWith({
        capabilities: ["triage", "brittle"],
        labels: TRIAGE_LABELS,
        revision: REV,
    });

    it("a capability that throws is a problem finding, and its neighbour still decides", async () => {
        const exploding: EngineCapability = {
            declaration: brittle as never,
            async evaluate(): Promise<readonly AnyIntent[]> {
                throw new TypeError("cannot read properties of undefined");
            },
        };
        const decision = await decide(
            delivery("issues.opened.json"),
            twoCapabilities,
            [exploding, triage],
            externals,
        );
        expect(decision.report.findings.map((f) => f.code)).toEqual([
            "capabilityFailed",
            "capabilityExplained",
            "applied",
        ]);
        expect(problems(decision.report)).toHaveLength(1);
        expect(problems(decision.report)[0]).toMatchObject({
            code: "capabilityFailed",
            subject: { kind: "capability", capability: "brittle" },
            // The thrown message survives into the finding. Without it the
            // report says only that something broke, which is unactionable.
            summary: expect.stringContaining("cannot read properties of undefined"),
        });
        expect(decision.approved).toHaveLength(1);
    });

    it("contains malformed entries and a non-array result", async () => {
        const malformed: EngineCapability = {
            declaration: brittle as never,
            async evaluate(): Promise<readonly AnyIntent[]> {
                return [null] as never;
            },
        };
        const nonArray: EngineCapability = {
            declaration: brittle as never,
            async evaluate(): Promise<readonly AnyIntent[]> {
                return null as never;
            },
        };
        const decision = await decide(
            delivery("issues.opened.json"),
            twoCapabilities,
            [malformed, nonArray, triage],
            externals,
        );
        expect(decision.report.findings.map((finding) => finding.code)).toEqual([
            "malformedIntent",
            "capabilityFailed",
            "capabilityExplained",
            "applied",
        ]);
        expect(decision.approved).toHaveLength(1);
    });

    it("contains an unprintable thrown value", async () => {
        const revoked = Proxy.revocable({}, {});
        revoked.revoke();
        const capability: EngineCapability = {
            declaration: brittle as never,
            async evaluate(): Promise<readonly AnyIntent[]> {
                throw revoked.proxy;
            },
        };
        const decision = await decide(
            delivery("issues.opened.json"),
            twoCapabilities,
            [capability],
            externals,
        );
        expect(decision.report.findings[0]?.summary).toContain("an unprintable value");
    });

    it("a resolver source that rejects answers unavailable, and is a problem finding", async () => {
        const asker: EngineCapability = {
            declaration: declareCapability({
                ...brittle,
                resolvers: ["linkedIssues"],
            }) as never,
            async evaluate(_o: never, _c: never, platform: never): Promise<readonly AnyIntent[]> {
                const handle = platform as {
                    resolve(q: string, i: unknown): Promise<{ ok: boolean; reason?: string }>;
                };
                // Unknown is not an answer (`design/contracts/catalogue.md`):
                // a broken lookup is never an empty one.
                expect(
                    await handle.resolve("linkedIssues", { item: { kind: "issue", number: 1 } }),
                ).toMatchObject({ ok: false, reason: "unavailable" });
                return [];
            },
        };
        const decision = await decide(
            delivery("issues.opened.json"),
            twoCapabilities,
            [asker, triage],
            {
                ...externals,
                resolve: async () => {
                    throw new Error("socket hang up");
                },
            },
        );
        expect(decision.report.findings.map((f) => f.code)).toEqual([
            "resolverFailed",
            "capabilityExplained",
            "applied",
        ]);
        expect(problems(decision.report)[0]!.summary).toContain("socket hang up");
        expect(decision.approved).toHaveLength(1);
    });

    it("treats a malformed resolver answer as unavailable", async () => {
        const asker: EngineCapability = {
            declaration: declareCapability({ ...brittle, resolvers: ["linkedIssues"] }) as never,
            async evaluate(_o: never, _c: never, platform: never): Promise<readonly AnyIntent[]> {
                const handle = platform as {
                    resolve(q: string, i: unknown): Promise<{ ok: boolean; reason?: string }>;
                };
                expect(await handle.resolve("linkedIssues", {})).toMatchObject({
                    ok: false,
                    reason: "unavailable",
                });
                return [];
            },
        };
        const decision = await decide(delivery("issues.opened.json"), twoCapabilities, [asker], {
            ...externals,
            resolve: async () => ({ ok: true }) as never,
        });
        expect(decision.report.findings.map((finding) => finding.code)).toEqual(["resolverFailed"]);
    });

    /**
     * A lookup that threw established NOTHING, so the ordering becomes
     * `"unknown"` — D51's conflict, not `null`'s "checked and found none".
     * Reporting the absence would silently restore the unsafe behaviour the
     * package README names as a standing debt.
     */
    it.each([
        [
            "throws synchronously",
            (): never => {
                throw new Error("timeline unreadable");
            },
        ],
        ["rejects", () => Promise.reject(new Error("timeline unreadable"))],
    ])(
        "an ordering lookup that %s refuses fail-closed and records the defect",
        async (_n, fail) => {
            const decision = await decide(
                delivery("issues.opened.json"),
                configIn("active"),
                [triage],
                {
                    ...externals,
                    latestHumanChangeAt: fail,
                },
            );
            expect(decision.approved).toEqual([]);
            expect(decision.report.findings.map((f) => f.code)).toEqual([
                "humanOrderingLookupFailed",
                "humanOrderingUnknown",
            ]);
            expect(decision.report.findings[0]).toMatchObject({
                severity: "problem",
                summary: expect.stringContaining("timeline unreadable"),
                subject: { kind: "item", capability: "triage" },
            });
        },
    );

    /** Anything is throwable; a non-`Error` must still produce a report. */
    it("contains a thrown value that is not an Error", async () => {
        const rude: EngineCapability = {
            declaration: brittle as never,
            async evaluate(): Promise<readonly AnyIntent[]> {
                throw "just a string";
            },
        };
        const decision = await decide(
            delivery("issues.opened.json"),
            twoCapabilities,
            [rude],
            externals,
        );
        expect(decision.report.findings).toEqual([
            expect.objectContaining({
                code: "capabilityFailed",
                summary: expect.stringContaining("just a string"),
            }),
        ]);
    });
});

/**
 * D125: the capability supplies purpose and wording, the platform supplies
 * identity, and identity attaches at APPROVAL — an intent that will never be
 * written has no write to name.
 */
describe("managed-comment identity is minted here, not by the capability", () => {
    const commenter = declareCapability({ ...declaration, intents: ["postManagedComment"] });
    const observedAt = new Date("2026-08-07T00:00:00Z");
    const item = { kind: "issue", number: 7 } as const;

    const speaking = (kind: "summary" | "warning" | "notice"): EngineCapability => ({
        declaration: commenter as never,
        async evaluate(facts: never): Promise<readonly AnyIntent[]> {
            const o = facts as { repository: { owner: string; repo: string } };
            return [
                intentFactory("triage", { repository: o.repository, item, observedAt })({
                    operation: "postManagedComment",
                    desired: { kind, body: "wording nobody's identity depends on" },
                    cause: "sawTheItem",
                    explain: { summary: "Saw the item." },
                }),
            ];
        },
    });

    const facts = webhookIssue({ item, observedAt });

    const decideWith = (capability: EngineCapability, mode: "active" | "dry-run" = "active") =>
        decide({ kind: "facts", facts }, configIn(mode), [capability], externals);

    it("stamps the approved comment with the marker its own fields derive", async () => {
        const decision = await decideWith(speaking("summary"));
        expect(decision.approved).toHaveLength(1);
        const effect = decision.approved[0]!;
        const identity = { capability: "triage", item, kind: "summary", topic: "" } as const;
        expect(effect.managedComment).toEqual({
            identity,
            marker: deriveManagedMarker(identity),
        });
        expect(
            matchesManagedComment(
                { body: effect.managedComment!.marker, authoredByApp: true },
                managedMarkerPayload(effect.managedComment!.identity),
            ),
        ).toEqual({ matches: true });
    });

    /** The kind the capability chose is the kind that reaches the marker. */
    it("carries the capability's purpose into the identity, and only that", async () => {
        const warning = await decideWith(speaking("warning"));
        expect(warning.approved[0]!.managedComment!.identity.kind).toBe("warning");
        expect(warning.approved[0]!.managedComment!.marker).not.toBe(
            (await decideWith(speaking("notice"))).approved[0]!.managedComment!.marker,
        );
    });

    /** Nothing is minted for an effect that will not happen. */
    it("mints nothing in dry-run, because nothing will be written", async () => {
        expect((await decideWith(speaking("summary"), "dry-run")).approved).toEqual([]);
    });
});

describe("a comment addressed to a principal is resolved by the platform", () => {
    const commenter = declareCapability({ ...declaration, intents: ["postManagedComment"] });
    const observedAt = new Date("2026-08-07T00:00:00Z");
    const item = { kind: "issue", number: 7 } as const;

    const pinging = (mention: string | undefined): EngineCapability => ({
        declaration: commenter as never,
        async evaluate(facts: never): Promise<readonly AnyIntent[]> {
            const o = facts as { repository: { owner: string; repo: string } };
            return [
                intentFactory("triage", { repository: o.repository, item, observedAt })({
                    operation: "postManagedComment",
                    desired: {
                        kind: "notice",
                        body: "this issue was marked `critical`.",
                        ...(mention === undefined ? {} : { mention }),
                    },
                    cause: "alertArrived:critical",
                    claims: { closed: false },
                    explain: { summary: "Pinged about the critical alert." },
                }),
            ];
        },
    });

    const withPrincipals = (mode: "active" | "dry-run"): RepositoryConfig => ({
        ...configIn(mode),
        principals: { maintainerTeam: "hiero-ledger/solo-maintainers" },
    });

    const facts = webhookIssue({ item, observedAt });

    it("substitutes the handle into the approved effect's body", async () => {
        const decision = await decide(
            { kind: "facts", facts },
            withPrincipals("active"),
            [pinging("maintainerTeam")],
            externals,
        );
        expect(decision.approved).toHaveLength(1);
        expect(decision.approved[0]!.intent.desired).toMatchObject({
            body: "@hiero-ledger/solo-maintainers — this issue was marked `critical`.",
        });
    });

    it("leaves a comment naming nobody untouched", async () => {
        const decision = await decide(
            { kind: "facts", facts },
            withPrincipals("active"),
            [pinging(undefined)],
            externals,
        );
        expect(decision.approved[0]!.intent.desired).toMatchObject({
            body: "this issue was marked `critical`.",
        });
    });

    /**
     * notifications' design asks dry-run to name "the exact ping". It does not:
     * `describeChange` for a comment is deliberately the capability and the
     * purpose and never the body (D125), so a rehearsal says a notice would be
     * posted and not what it would say. Pinned as what happens, because it is
     * the design's row that is wrong about the platform rather than the other
     * way round.
     */
    it("rehearses the ping without quoting it, and approves nothing", async () => {
        const decision = await decide(
            { kind: "facts", facts },
            withPrincipals("dry-run"),
            [pinging("maintainerTeam")],
            externals,
        );
        expect(decision.approved).toEqual([]);
        const rehearsed = decision.report.findings.filter((f) => f.code === "wouldApply");
        expect(rehearsed).toHaveLength(1);
        expect(rehearsed[0]!.summary).toBe(
            "dry-run: triage would postManagedComment on o/r#7 — managed notice comment from triage. Nothing was written.",
        );
        expect(JSON.stringify(rehearsed)).not.toContain("solo-maintainers");
    });
});

describe("describeChange — safety.md's exact item and value, pinned", () => {
    it("names each operation's change precisely", () => {
        const base = intentFactory("triage", {
            repository: { owner: "o", repo: "r" },
            item: { kind: "issue", number: 1 },
            observedAt: new Date("2026-08-07T00:00:00Z"),
        });
        expect(
            describeChange(
                base({
                    operation: "postManagedComment",
                    desired: { kind: "summary", body: "b" },
                    cause: "c",
                    explain: { summary: "s" },
                }),
            ),
        ).toBe("managed summary comment from triage");
        // Both halves vary, and neither is the marker: the description names
        // who is writing and for what purpose (D125).
        expect(
            describeChange(
                intentFactory("inactivity", {
                    repository: { owner: "o", repo: "r" },
                    item: { kind: "issue", number: 1 },
                    observedAt: new Date("2026-08-07T00:00:00Z"),
                })({
                    operation: "postManagedComment",
                    desired: { kind: "warning", body: "b" },
                    cause: "c",
                    explain: { summary: "s" },
                }),
            ),
        ).toBe("managed warning comment from inactivity");
        expect(
            describeChange(
                base({
                    operation: "applyMappedLabel",
                    desired: { meaning: "ready", cause: "triageCompleted" },
                    cause: "c",
                    explain: { summary: "s" },
                }),
            ),
        ).toBe("set mapped position ready");
        expect(
            describeChange(
                base({
                    operation: "unassign",
                    desired: { login: "someone" },
                    cause: "c",
                    explain: { summary: "s" },
                }),
            ),
        ).toBe("unassign someone");
        // The clock's release reads differently from the request's, because
        // the warning snapshot compares this string and the two must not
        // authorize each other (D63, D141).
        expect(
            describeChange(
                base({
                    operation: "releaseAssignment",
                    desired: { login: "someone" },
                    cause: "c",
                    explain: { summary: "s" },
                }),
            ),
        ).toBe("release someone");
        expect(
            describeChange(
                base({
                    operation: "closePullRequest",
                    desired: { reason: "stale for 60 days" },
                    cause: "c",
                    explain: { summary: "s" },
                }),
            ),
        ).toBe("close pull request: stale for 60 days");
        expect(
            describeChange(
                base({
                    operation: "assign",
                    desired: { login: "someone" },
                    cause: "c",
                    explain: { summary: "s" },
                }),
            ),
        ).toBe("assign someone");
        // The two directions of one moderation read differently for the reason
        // the two releases do: a journal row names the direction it went, and
        // an operator never decodes a boolean to learn which.
        expect(
            describeChange(
                base({
                    operation: "lockIssue",
                    desired: { reason: "heated after the release" },
                    cause: "c",
                    explain: { summary: "s" },
                }),
            ),
        ).toBe("lock issue: heated after the release");
        expect(
            describeChange(
                base({
                    operation: "unlockIssue",
                    desired: { reason: "the thread has cooled" },
                    cause: "c",
                    explain: { summary: "s" },
                }),
            ),
        ).toBe("unlock issue: the thread has cooled");
    });
});
