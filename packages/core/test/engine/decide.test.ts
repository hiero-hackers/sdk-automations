/**
 * The verb, exercised on real deliveries (D92 phase 1). Parity with the
 * hand-wired slice lives in `slice.test.ts`; this file owns the paths the
 * slice does not walk — refusals, dry-run, disabled capabilities, hostile
 * shapes, and the derivation catching a stale claim the OLD API would have
 * accepted on the caller's word.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
    decide,
    describeChange,
    declareCapability,
    intentFactory,
    deriveIdempotencyKey,
    parseConfig,
    problems,
    type AnyIntent,
    type DecideExternals,
    type EngineCapability,
    type Intent,
    type RepositoryConfig,
} from "../../src/index.js";

const payload = (name: string): unknown =>
    JSON.parse(
        readFileSync(fileURLToPath(new URL(`../github/fixtures/${name}`, import.meta.url)), "utf8"),
    );

const declaration = declareCapability({
    name: "triage",
    triggers: [{ kind: "event", event: "issues" }],
    configKeys: [],
    observations: ["issueUpdated"],
    resolvers: [],
    intents: [
        {
            name: "applyMappedLabel",
            idempotencyClass: "idempotent",
            requiredPermissions: ["issues:write"],
        },
    ],
    permissions: { repository: ["issues:write"], organization: [] },
    operationalNeeds: {
        schedule: false,
        durableState: "none",
        crossItemCoordination: false,
        externalDelivery: false,
    },
});

/** The smallest real capability: triage anything with no position. */
const triage: EngineCapability = {
    declaration,
    async evaluate(observation: never): Promise<readonly AnyIntent[]> {
        const o = observation as {
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
            actionClass: "reversibleStateChange",
            expected: { meaningsPresent: [], meaningsAbsent: ["awaitingTriage"], closed: false },
            desired: { meaning: "awaitingTriage", cause: "intakeObserved" },
            cause: { cause: "issueWithoutPosition", observedAt: o.observedAt },
            explanation: {
                capability: "triage",
                summary: "New issue placed in triage.",
                detail: [],
            },
        } as const satisfies Omit<Intent<"applyMappedLabel">, "idempotencyKey">;
        return [{ ...draft, idempotencyKey: deriveIdempotencyKey(draft) }];
    },
};

function configIn(mode: "active" | "dry-run", enabled = true): RepositoryConfig {
    const result = parseConfig(
        {
            schemaVersion: 1,
            mode,
            capabilities: { triage: { enabled } },
            mappings: { labels: { awaitingTriage: "status: triage" } },
        },
        { revision: "rev-engine-1", knownCapabilities: ["triage"] },
    );
    if (!result.ok) throw new Error("config must parse");
    return result.config;
}

const externals: DecideExternals = {
    now: new Date("2026-08-07T02:00:00Z"),
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
            operation: "applyMappedLabel",
            item: { kind: "issue", number: 164 },
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

    it("dry-run tells the same story and approves nothing", async () => {
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
            declaration,
            async evaluate(observation: never): Promise<readonly AnyIntent[]> {
                const o = observation as Parameters<typeof triage.evaluate>[0] extends never
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
                    operation: "applyMappedLabel",
                    actionClass: "reversibleStateChange",
                    // The lie: claims no triage label, on a labeled issue.
                    expected: {
                        meaningsPresent: [],
                        meaningsAbsent: ["awaitingTriage"],
                        closed: false,
                    },
                    desired: { meaning: "awaitingTriage", cause: "intakeObserved" },
                    cause: { cause: "issueWithoutPosition", observedAt: o.observedAt },
                    explanation: { capability: "triage", summary: "s", detail: [] },
                } as const satisfies Omit<Intent<"applyMappedLabel">, "idempotencyKey">;
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
                        actionClass: "reversibleStateChange",
                        expected: { meaningsPresent: [], meaningsAbsent: [], closed: null },
                        desired: { meaning: "awaitingTriage", cause: "intakeObserved" },
                        cause: { cause: "c", observedAt: new Date("2026-08-07T00:00:00Z") },
                        explanation: { capability: "someoneElse", summary: "s", detail: [] },
                        idempotencyKey: "k",
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
        const decision = await decide(
            delivery("issues.opened.json"),
            configIn("active"),
            [nosy],
            externals,
        );
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
    it("an observation-kind input skips normalization and decides identically", async () => {
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
        if (normalized.kind !== "observation") throw new Error("fixture must normalize");
        const viaObservation = await decide(
            { kind: "observation", observation: normalized.observation },
            configIn("active"),
            [triage],
            externals,
        );
        expect(viaObservation.report).toEqual(viaDelivery.report);
        expect(viaObservation.approved).toEqual(viaDelivery.approved);
    });

    it("a pull-request delivery reaches a PR-observing capability", async () => {
        const watcher: EngineCapability = {
            declaration: declareCapability({
                ...declaration,
                name: "triage",
                observations: ["pullRequestUpdated"],
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
        expect(decision.report.findings).toEqual([
            expect.objectContaining({ code: "capabilityExplained", severity: "info" }),
        ]);
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

    it("staleItemsDue claims pass through — verified at act time, not decision time", async () => {
        const observation = {
            kind: "staleItemsDue",
            repository: { owner: "scrubbed-1", repo: "scrubbed-2" },
            items: [],
            observedAt: new Date("2026-08-07T00:00:00Z"),
        } as const;
        const sweeper = (expected: {
            meaningsPresent: readonly never[];
            meaningsAbsent: readonly "awaitingTriage"[];
            closed: boolean | null;
        }): EngineCapability => ({
            declaration: declareCapability({
                ...declaration,
                observations: ["staleItemsDue"],
            }) as never,
            async evaluate() {
                const draft = {
                    capability: "triage",
                    repository: observation.repository,
                    item: { kind: "issue", number: 9 },
                    operation: "applyMappedLabel",
                    actionClass: "reversibleStateChange",
                    expected,
                    desired: { meaning: "awaitingTriage", cause: "intakeObserved" },
                    cause: { cause: "sweep", observedAt: observation.observedAt },
                    explanation: { capability: "triage", summary: "s", detail: [] },
                } as const;
                return [{ ...draft, idempotencyKey: deriveIdempotencyKey(draft) } as never];
            },
        });
        /**
         * D92 3c: an unprojected observation shows the engine nothing to
         * check a claim against, so the claim rides through to the adapter,
         * which rechecks `expected` against live GitHub at write time. Both
         * the vacuous and the claiming sweep therefore pass HERE — the
         * openness claim is deferred, not waived.
         */
        for (const expected of [
            { meaningsPresent: [], meaningsAbsent: [], closed: null },
            { meaningsPresent: [], meaningsAbsent: ["awaitingTriage"], closed: false },
        ] as const) {
            const decision = await decide(
                { kind: "observation", observation },
                configIn("active"),
                [sweeper(expected as never)],
                externals,
            );
            expect(decision.report.findings.map((f) => f.code)).toEqual([
                "capabilityExplained",
                "applied",
            ]);
        }
    });

    it("a capability observing a different kind is never invoked", async () => {
        const prOnly: EngineCapability = {
            declaration: declareCapability({
                ...declaration,
                observations: ["pullRequestUpdated"],
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

describe("the destructive gate, through the engine (D92 3c)", () => {
    const WARNED = new Date("2026-07-20T00:00:00Z");
    const observation = {
        kind: "staleItemsDue",
        repository: { owner: "scrubbed-1", repo: "scrubbed-2" },
        items: [],
        observedAt: WARNED,
    } as const;

    const reclaimer = (over: { causeDrift?: boolean; activity?: boolean }): EngineCapability => ({
        declaration: declareCapability({
            ...declaration,
            observations: ["staleItemsDue"],
            intents: [
                {
                    name: "unassign",
                    idempotencyClass: "idempotent",
                    requiredPermissions: ["issues:write"],
                },
            ],
        }) as never,
        async evaluate() {
            const draft = {
                capability: "triage",
                repository: observation.repository,
                item: { kind: "issue", number: 13 },
                operation: "unassign",
                actionClass: "clockTriggeredDestructive",
                expected: { meaningsPresent: [], meaningsAbsent: [], closed: false },
                desired: { login: "contributor" },
                cause: {
                    cause: over.causeDrift === true ? "freshSweep" : "assignmentWentStale",
                    observedAt: WARNED,
                },
                destructive: {
                    warnedAt: WARNED,
                    gracePeriodDays: 7,
                    earliestActionAt: new Date("2026-07-27T00:00:00Z"),
                    cancelledBy: "a comment or commit from the assignee",
                    reversesWith: "reassigning the item to the same person",
                    qualifyingActivitySinceWarning: over.activity === true,
                    warnedCause: "assignmentWentStale",
                    warnedCauseObservedAt: WARNED,
                },
                explanation: { capability: "triage", summary: "s", detail: [] },
            } as const;
            return [{ ...draft, idempotencyKey: deriveIdempotencyKey(draft) } as never];
        },
    });

    const at = (iso: string) => ({ ...externals, now: new Date(iso) });
    const codesOf = async (cap: EngineCapability, ext: DecideExternals) => {
        const d = await decide(
            { kind: "observation", observation },
            configIn("active"),
            [cap],
            ext,
        );
        return { codes: d.report.findings.map((f) => f.code), approved: d.approved };
    };

    it("refuses while the grace period runs", async () => {
        const { codes, approved } = await codesOf(reclaimer({}), at("2026-07-22T00:00:00Z"));
        expect(codes).toEqual(["graceRunning"]);
        expect(approved).toEqual([]);
    });

    it("applies once the grace period has elapsed", async () => {
        const { codes, approved } = await codesOf(reclaimer({}), at("2026-08-03T00:00:00Z"));
        expect(codes).toEqual(["capabilityExplained", "applied"]);
        expect(approved).toHaveLength(1);
    });

    it("cancels on qualifying activity during the grace period", async () => {
        const { codes } = await codesOf(reclaimer({ activity: true }), at("2026-08-03T00:00:00Z"));
        expect(codes).toEqual(["activityCancelled"]);
    });

    /**
     * D60's teeth, now at the engine: the warning is rebuilt from the
     * STORED warned cause, so an act citing a different causal observation
     * than it warned about is not the act that was authorized.
     */
    it("refuses an act whose cause is not the one the warning authorized", async () => {
        const { codes } = await codesOf(
            reclaimer({ causeDrift: true }),
            at("2026-08-03T00:00:00Z"),
        );
        expect(codes).toEqual(["warningRequestMismatch"]);
    });
});

describe("describeChange — §2.6's exact item and value, pinned", () => {
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
                    actionClass: "humanFacingOutput",
                    desired: { marker: "<!-- m -->", body: "b" },
                    cause: "c",
                    explain: { summary: "s" },
                }),
            ),
        ).toBe("managed comment <!-- m -->");
        expect(
            describeChange(
                base({
                    operation: "applyMappedLabel",
                    actionClass: "reversibleStateChange",
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
                    actionClass: "reversibleStateChange",
                    desired: { login: "someone" },
                    cause: "c",
                    explain: { summary: "s" },
                }),
            ),
        ).toBe("unassign someone");
    });
});
