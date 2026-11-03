/**
 * What prDashboard decides, and what it refuses to decide: a resolver that
 * cannot answer is an undetermined row, never a pass, and never a fail.
 */

import { describe, expect, it } from "vitest";
import {
    handleFor,
    parseConfig,
    projectCapabilityView,
    type PrMeaning,
    type Projection,
    type ResolverAnswer,
    type ResolverName,
    type ResolverSource,
    type WorkItemState,
} from "@hiero-hackers/automation-core";
import { prDashboard, prDashboardDeclaration } from "./capability.js";
import {
    configEnabling,
    factsFor,
    OBSERVED_AT,
    REPOSITORY,
    sweptPullRequest,
    webhookPullRequest,
} from "@hiero-hackers/automation-core/author/testing";

const ITEM = { kind: "pullRequest", number: 12 } as const;
const ISSUE_11 = { kind: "issue", number: 11 } as const;
const ISSUE_9 = { kind: "issue", number: 9 } as const;

const view = (settings: Readonly<Record<string, unknown>>) =>
    projectCapabilityView(
        prDashboard.declaration,
        configEnabling(["prDashboard"], [prDashboard.declaration], { prDashboard: settings }),
    );

const on = { enabled: true } as const;
const everything = view({
    checks: {
        dcoSignoff: on,
        gpgSignature: on,
        mergeConflicts: on,
        linkedIssues: { enabled: true, assignedIssues: on },
    },
});
const linksOnly = view({ checks: { linkedIssues: on } });

const pullRequest = (state: Partial<WorkItemState<PrMeaning>> = {}, draft = false) =>
    factsFor(
        prDashboard.declaration,
        webhookPullRequest({
            item: ITEM,
            readiness: { draft },
            position: {
                kind: "position",
                state: { meaning: null, blocked: false, closedBy: null, ...state },
                ignored: [],
            } satisfies Projection<PrMeaning>,
        }),
    );

const REVIEWED_AT = new Date("2026-07-01T00:00:00.000Z");

/** A pull request as the sweep reads it: review state known, clear unless said otherwise. */
const swept = (
    state: Partial<WorkItemState<PrMeaning>> = {},
    draft = false,
    changesRequestedAt: Date | null = null,
    lastCommitAt: Date | null = null,
) =>
    factsFor(
        prDashboard.declaration,
        sweptPullRequest({
            item: ITEM,
            readiness: { draft },
            review: {
                changesRequestedAt,
                reapableSince: {
                    needsRevision: REVIEWED_AT,
                    changesRequested: REVIEWED_AT,
                    draft: REVIEWED_AT,
                },
                lastCommitAt,
            },
            position: {
                kind: "position",
                state: { meaning: null, blocked: false, closedBy: null, ...state },
                ignored: [],
            } satisfies Projection<PrMeaning>,
        }),
    );

const commit = (sha: string, summary: string, over: Partial<Commit> = {}): Commit => ({
    sha,
    summary,
    signedOff: true,
    verified: true,
    merge: false,
    ...over,
});
interface Commit {
    sha: string;
    summary: string;
    signedOff: boolean;
    verified: boolean;
    merge: boolean;
}

const RATE_LIMITED: ResolverAnswer<never> = {
    ok: false,
    reason: "rateLimited",
    detail: "secondary rate limit on this installation",
};

/** A source answering each resolver by name; an unlisted one is rate limited. */
function answers(
    scripted: Partial<Record<ResolverName, unknown>>,
    asked: { query: string; input: unknown }[] = [],
): ResolverSource {
    return async (query, input) => {
        asked.push({ query, input });
        const answer = query === "isAutomationActor" ? (scripted[query] ?? false) : scripted[query];
        return await Promise.resolve(
            (answer === undefined ? RATE_LIMITED : { ok: true, value: answer }) as never,
        );
    };
}

/** Everything answered, every check passing. */
const CLEAN: Partial<Record<ResolverName, unknown>> = {
    commitAttestations: [commit("abc1234def", "fix: handle empty payload")],
    mergeability: true,
    linkedIssues: [ISSUE_11],
    assigneesOf: ["opener"],
};

const evaluate = async (
    config: ReturnType<typeof view>,
    source: ResolverSource,
    facts = pullRequest(),
) => {
    const handle = handleFor(prDashboardDeclaration, facts, source);
    const intents = await prDashboard.evaluate(facts, config, handle);
    const first = intents[0]?.desired;
    return {
        intents,
        handle,
        body: first !== undefined && "body" in first ? first.body : null,
        label: intents.find((intent) => intent.operation === "applyMappedLabel")?.desired ?? null,
    };
};

/** A document mapping the two positions the verdict may set, beside the harness's own. */
const MAPPED = {
    labels: {
        awaitingTriage: "status: triage",
        blocked: "blocked",
        needsReview: "status: needs review",
        needsRevision: "status: needs revision",
    },
};
const labelling = (listed: readonly string[], checks: Readonly<Record<string, unknown>>) =>
    projectCapabilityView(
        prDashboard.declaration,
        configEnabling(
            ["prDashboard"],
            [prDashboard.declaration],
            { prDashboard: { checks, applyLabels: listed } },
            MAPPED,
        ),
    );
const BOTH = ["needsRevision", "needsReview"] as const;
const LINKS = { linkedIssues: on };

describe("prDashboard", () => {
    /** `claims.closed` is `false` rather than absent: an omitted claim is vacuous. */
    it("asks for one managed comment on the observed pull request, claiming it is open", async () => {
        const { intents } = await evaluate(linksOnly, answers({ linkedIssues: [] }));
        expect(intents).toEqual([
            {
                capability: "prDashboard",
                repository: REPOSITORY,
                item: ITEM,
                operation: "postManagedComment",
                desired: {
                    kind: "summary",
                    body: [
                        "Hey @opener 👋 Thanks for the PR!",
                        "❌ **Issue link** — This pull request does not reference an issue. Adding a closing reference keeps the issue and the pull request in step.",
                        "This repository requires all of these checks to pass before review.",
                    ].join("\n\n"),
                },
                claims: { meaningsPresent: [], meaningsAbsent: [], closed: false },
                cause: { cause: "pullRequestChecked", observedAt: OBSERVED_AT },
                explanation: {
                    capability: "prDashboard",
                    summary: "Reported the quality checks on this pull request.",
                    detail: ["linkedIssues: fail"],
                },
                grace: null,
                idempotencyKey: expect.any(String),
            },
        ]);
    });

    /** The dashboard stands when the checks pass, so a fixed failure is updated, not left. */
    it("renders every enabled check, in the design's order, when all pass", async () => {
        const { body, handle } = await evaluate(everything, answers(CLEAN));
        expect(body).toBe(
            [
                "Hey @opener 👋 Thanks for the PR!",
                "✅ **DCO sign-off** — Every commit carries a sign-off.",
                "✅ **GPG signature** — Every commit has a verified signature.",
                "✅ **Merge conflicts** — This branch merges cleanly.",
                "✅ **Issue link** — Linked to #11.",
                "✅ **Assignment** — You are assigned to every linked issue.",
                "✅ Every check passes.",
            ].join("\n\n"),
        );
        expect(handle.explanations).toEqual([]);
    });

    it("lists the commits that fail each commit check, with hostile subjects rendered inert", async () => {
        const commits = [
            commit("1111111aaa", "feat: hi @bob `rm -rf` *now*", {
                signedOff: false,
                verified: false,
            }),
            commit("2222222bbb", "Merge branch 'main'", { signedOff: false, merge: true }),
            commit("3333333ccc", "fix: fine"),
        ];
        const { body } = await evaluate(
            view({
                checks: {
                    dcoSignoff: { enabled: true, guide: "https://example.test/signing" },
                    gpgSignature: on,
                },
            }),
            answers({ commitAttestations: commits }),
        );
        expect(body).toBe(
            [
                "Hey @opener 👋 Thanks for the PR!",
                // The merge commit is GitHub's own and exempt from DCO.
                "❌ **DCO sign-off** — These commits carry no `Signed-off-by` trailer:\n`1111111` feat: hi @​bob \\`rm -rf\\` \\*now\\*\nSee the guide: https://example.test/signing",
                // Merges are judged for a signature like any other commit.
                "❌ **GPG signature** — These commits have no verified signature:\n`1111111` feat: hi @​bob \\`rm -rf\\` \\*now\\*",
                "This repository requires all of these checks to pass before review.",
            ].join("\n\n"),
        );
    });

    it("renders one row when only one commit check is enabled", async () => {
        const commits = [commit("1111111aaa", "chore: unsigned", { signedOff: false })];
        const dco = await evaluate(
            view({ checks: { dcoSignoff: on } }),
            answers({ commitAttestations: commits }),
        );
        expect(dco.body).toContain("❌ **DCO sign-off**");
        expect(dco.body).not.toContain("GPG");
        const gpg = await evaluate(
            view({ checks: { gpgSignature: on } }),
            answers({ commitAttestations: commits }),
        );
        expect(gpg.body).toContain("✅ **GPG signature**");
        expect(gpg.body).not.toContain("DCO");
    });

    it("reads the commits once for both commit checks, and asks each resolver about the pull request", async () => {
        const asked: { query: string; input: unknown }[] = [];
        await evaluate(everything, answers(CLEAN, asked));
        expect(asked).toEqual([
            { query: "isAutomationActor", input: { login: "opener" } },
            { query: "commitAttestations", input: { item: ITEM } },
            { query: "mergeability", input: { item: ITEM } },
            { query: "linkedIssues", input: { item: ITEM } },
            { query: "assigneesOf", input: { item: ISSUE_11 } },
        ]);
    });

    it("fails the merge check on a branch GitHub cannot merge", async () => {
        const { body } = await evaluate(
            view({ checks: { mergeConflicts: on } }),
            answers({ mergeability: false }),
        );
        expect(body).toContain(
            "❌ **Merge conflicts** — This branch has conflicts with its base branch.",
        );
    });

    /** D51: GitHub still computing is neither a conflict nor an all-clear. */
    it("renders a merge check GitHub has not resolved as undetermined, withholding the all-clear", async () => {
        const { body, handle } = await evaluate(
            everything,
            answers({
                ...CLEAN,
                mergeability: undefined,
            }),
        );
        expect(body).toContain(
            "⏳ **Merge conflicts** — GitHub has not said yet whether this branch merges cleanly.",
        );
        expect(body).toContain(
            "⏳ A check could not run this time. It runs again on the next update to this pull request.",
        );
        expect(body).not.toContain("Every check passes");
        expect(handle.explanations).toEqual([
            {
                capability: "prDashboard",
                summary: "The mergeConflicts check could not run: a resolver could not answer.",
                detail: [
                    "resolver reason: rateLimited",
                    "secondary rate limit on this installation",
                ],
            },
        ]);
    });

    it("names the linked issues the author is not assigned to", async () => {
        const { body } = await evaluate(
            view({
                checks: {
                    linkedIssues: {
                        enabled: true,
                        assignedIssues: { enabled: true, guide: "https://example.test/assign" },
                    },
                },
            }),
            async (query, input) =>
                await Promise.resolve(
                    (query === "isAutomationActor"
                        ? { ok: true, value: false }
                        : query === "linkedIssues"
                          ? { ok: true, value: [ISSUE_9, ISSUE_11] }
                          : {
                                ok: true,
                                value:
                                    (input as { item: { number: number } }).item.number === 11
                                        ? ["opener"]
                                        : ["someone"],
                            }) as never,
                ),
        );
        expect(body).toBe(
            [
                "Hey @opener 👋 Thanks for the PR!",
                "✅ **Issue link** — Linked to #9, #11.",
                "❌ **Assignment** — You are not assigned to #9.\nSee the guide: https://example.test/assign",
                "This repository requires all of these checks to pass before review.",
            ].join("\n\n"),
        );
    });

    /** Nothing linked is a failure to act on, not a wait. */
    it("fails the assignment check while no issue is linked, asking nobody's assignees", async () => {
        const asked: { query: string; input: unknown }[] = [];
        const { body, handle } = await evaluate(
            view({
                checks: {
                    linkedIssues: {
                        enabled: true,
                        assignedIssues: { enabled: true, guide: "https://example.test/assign" },
                    },
                },
            }),
            answers({ linkedIssues: [] }, asked),
        );
        expect(body).toContain(
            "❌ **Assignment** — No issue is linked, so we cannot tell whether you are assigned to it. Link the issue this pull request closes to check assignment.\nSee the guide: https://example.test/assign",
        );
        expect(asked.map(({ query }) => query)).toEqual(["isAutomationActor", "linkedIssues"]);
        expect(handle.explanations).toEqual([]);
    });

    it("matches the author to an assignee regardless of login case", async () => {
        const { body } = await evaluate(
            view({ checks: { linkedIssues: { enabled: true, assignedIssues: on } } }),
            answers({ linkedIssues: [ISSUE_11], assigneesOf: ["OPENER"] }),
        );
        expect(body).toContain("✅ **Assignment**");
    });

    it("renders an unreadable assignee list as undetermined", async () => {
        const { body, handle } = await evaluate(
            view({ checks: { linkedIssues: { enabled: true, assignedIssues: on } } }),
            answers({ linkedIssues: [ISSUE_11] }),
        );
        expect(body).toContain(
            "⏳ **Assignment** — The linked issues' assignees could not be read this time.",
        );
        expect(handle.explanations.map((e) => e.summary)).toEqual([
            "The assignedIssues check could not run: a resolver could not answer.",
        ]);
    });

    /** One unanswered read explains once; the row that depends on it is undetermined in silence. */
    it("renders both link rows undetermined when the links cannot be read, explaining once", async () => {
        const { body, handle } = await evaluate(
            everything,
            answers({ ...CLEAN, linkedIssues: undefined }),
        );
        expect(body).toContain(
            "⏳ **Issue link** — The linked issues could not be read this time.",
        );
        expect(body).toContain(
            "⏳ **Assignment** — The linked issues' assignees could not be read this time.",
        );
        expect(handle.explanations.map((e) => e.summary)).toEqual([
            "The linkedIssues check could not run: a resolver could not answer.",
        ]);
    });

    it("renders both commit checks undetermined when the commits cannot be read", async () => {
        const { body } = await evaluate(
            everything,
            answers({
                ...CLEAN,
                commitAttestations: undefined,
            }),
        );
        expect(body).toContain("⏳ **DCO sign-off** — The commits could not be read this time.");
        expect(body).toContain("⏳ **GPG signature** — The commits could not be read this time.");
    });

    /** A dashboard of question marks helps nobody: nothing is posted, and the operator is told. */
    it("skips, posting nothing, when no enabled check could run", async () => {
        const { intents, handle } = await evaluate(linksOnly, answers({}));
        expect(intents).toEqual([]);
        expect(handle.skipped).toBe(false);
        expect(handle.explanations).toEqual([
            {
                capability: "prDashboard",
                summary: "The linkedIssues check could not run: a resolver could not answer.",
                detail: [
                    "resolver reason: rateLimited",
                    "secondary rate limit on this installation",
                ],
            },
            {
                capability: "prDashboard",
                summary: "Skipped: no enabled check could run.",
                detail: ["linkedIssues: undetermined"],
            },
        ]);
    });

    /** The guide is where the design puts it: on the failure, and nowhere else. */
    it("ends the failing check with the guide the repository configured, and a passing one without", async () => {
        const withGuide = view({
            checks: { linkedIssues: { enabled: true, guide: "https://example.test/linking" } },
        });
        const failing = await evaluate(withGuide, answers({ linkedIssues: [] }));
        expect(failing.body).toContain("in step.\nSee the guide: https://example.test/linking");
        const passing = await evaluate(withGuide, answers({ linkedIssues: [ISSUE_11] }));
        expect(passing.body).not.toContain("guide");
    });

    /**
     * A check runs only where a repository wrote `enabled: true`. The throwing
     * resolver proves an unasked question rather than a discarded answer.
     */
    it("runs no check for a repository that enables none, and never asks", async () => {
        const unreachable: ResolverSource = () => {
            throw new Error("a parked check asks nothing");
        };
        expect((await evaluate(view({}), unreachable)).intents).toEqual([]);
        const parked = await evaluate(
            view({ checks: { linkedIssues: { enabled: false }, mergeConflicts: {} } }),
            unreachable,
        );
        expect(parked.intents).toEqual([]);
        expect(parked.handle.explanations).toEqual([]);
    });

    /** The spec IS the schema, so the names a maintainer writes are pinned. */
    it("declares the checks a repository may switch on, each parked until enabled", () => {
        expect(Object.keys(prDashboard.declaration.settings)).toEqual(["checks", "applyLabels"]);
        expect(view({}).settings).toEqual({
            checks: {
                dcoSignoff: { enabled: false },
                gpgSignature: { enabled: false },
                mergeConflicts: { enabled: false },
                linkedIssues: { enabled: false },
            },
            applyLabels: [],
        });
        expect(linksOnly.settings.checks.linkedIssues).toEqual({
            enabled: true,
            guide: null,
            assignedIssues: { enabled: false },
        });
    });

    /** Phase 3: the sweep re-evaluates every open pull request, so a base that moved is rechecked within the hour. */
    it("rechecks a swept pull request exactly as a delivered one", async () => {
        const swept = factsFor(
            prDashboard.declaration,
            sweptPullRequest({ item: ITEM, readiness: { draft: false } }),
        );
        const { intents, body } = await evaluate(
            view({ checks: { mergeConflicts: on } }),
            answers({ mergeability: false }),
            swept,
        );
        expect(intents).toHaveLength(1);
        expect(intents[0]?.cause).toEqual({ cause: "pullRequestChecked", observedAt: OBSERVED_AT });
        expect(body).toContain("❌ **Merge conflicts**");
    });

    /** The words ask a person to sign off and self-assign; a bot can do neither. */
    it("says nothing on a bot-authored pull request, and asks nothing else", async () => {
        const asked: { query: string; input: unknown }[] = [];
        const { intents, handle } = await evaluate(
            everything,
            answers({ ...CLEAN, isAutomationActor: true }, asked),
        );
        expect(intents).toEqual([]);
        expect(asked.map(({ query }) => query)).toEqual(["isAutomationActor"]);
        expect(handle.explanations).toEqual([]);
    });

    it("reads each linked issue's assignees once, and only issues", async () => {
        const asked: { query: string; input: unknown }[] = [];
        const { body } = await evaluate(
            view({ checks: { linkedIssues: { enabled: true, assignedIssues: on } } }),
            answers(
                {
                    linkedIssues: [ISSUE_11, ISSUE_11, { kind: "pullRequest", number: 3 }],
                    assigneesOf: ["opener"],
                },
                asked,
            ),
        );
        expect(asked.filter(({ query }) => query === "assigneesOf")).toEqual([
            { query: "assigneesOf", input: { item: ISSUE_11 } },
        ]);
        expect(body).toContain("✅ **Assignment**");
    });

    it("names at most twenty failing commits, then counts the rest", async () => {
        const commits = Array.from({ length: 25 }, (_, i) =>
            commit(`${String(i).padStart(7, "0")}abc`, `chore: ${String(i)}`, { signedOff: false }),
        );
        const { body } = await evaluate(
            view({ checks: { dcoSignoff: on } }),
            answers({ commitAttestations: commits }),
        );
        expect(body).toContain("`0000019` chore: 19\n…and 5 more");
        expect(body).not.toContain("chore: 20");
    });

    describe("labels (phase 2)", () => {
        it("asks for needsRevision on any failure, along the map's edge", async () => {
            const { intents, label } = await evaluate(
                labelling(BOTH, LINKS),
                answers({ linkedIssues: [] }),
            );
            expect(intents.map((intent) => intent.operation)).toEqual([
                "postManagedComment",
                "applyMappedLabel",
            ]);
            expect(label).toEqual({ meaning: "needsRevision", cause: "checksFailed" });
            expect(intents[1]?.explanation.summary).toBe(
                "Set the position to needsRevision from the checks' verdict.",
            );
        });

        it("asks for needsReview when every check passes on a ready pull request the sweep read clear", async () => {
            const { label } = await evaluate(
                labelling(BOTH, LINKS),
                answers({ linkedIssues: [ISSUE_11] }),
                swept(),
            );
            expect(label).toEqual({ meaning: "needsReview", cause: "checksPassed" });
        });

        /** A webhook record carries no review state (D245): the dashboard posts, the sweep asks for the label. */
        it("asks no needsReview on a webhook run, whose record holds the review state unread", async () => {
            const { intents, label, handle } = await evaluate(
                labelling(BOTH, LINKS),
                answers({ linkedIssues: [ISSUE_11] }),
            );
            expect(intents).toHaveLength(1);
            expect(label).toBeNull();
            expect(handle.explanations).toEqual([]);
        });

        it("moves needsReview to needsRevision when a review requested changes, by that cause", async () => {
            const { intents, label } = await evaluate(
                labelling(BOTH, LINKS),
                answers({ linkedIssues: [ISSUE_11] }),
                swept({ meaning: "needsReview" }, false, REVIEWED_AT),
            );
            expect(label).toEqual({ meaning: "needsRevision", cause: "reviewRequestedChanges" });
            expect(intents[1]?.explanation.summary).toBe(
                "Set the position to needsRevision: a review requested changes.",
            );
        });

        /** The map draws `reviewRequestedChanges` from `needsReview` alone. */
        it("leaves a changes-requested pull request alone from no position or readyToMerge", async () => {
            const fresh = await evaluate(
                labelling(BOTH, LINKS),
                answers({ linkedIssues: [ISSUE_11] }),
                swept({}, false, REVIEWED_AT),
            );
            expect(fresh.label).toBeNull();
            const approved = await evaluate(
                labelling(BOTH, LINKS),
                answers({ linkedIssues: [ISSUE_11] }),
                swept({ meaning: "readyToMerge" }, false, REVIEWED_AT),
            );
            expect(approved.label).toBeNull();
        });

        it("lets a failing check speak before the review", async () => {
            const { label } = await evaluate(
                labelling(BOTH, LINKS),
                answers({ linkedIssues: [] }),
                swept({ meaning: "needsReview" }, false, REVIEWED_AT),
            );
            expect(label).toEqual({ meaning: "needsRevision", cause: "checksFailed" });
        });

        /** A newer commit answers the request (D241), as inactivity reads it. */
        it("treats a change request answered by a newer commit as no longer standing", async () => {
            const answered = new Date(REVIEWED_AT.getTime() + 60_000);
            const kept = await evaluate(
                labelling(BOTH, LINKS),
                answers({ linkedIssues: [ISSUE_11] }),
                swept({ meaning: "needsReview" }, false, REVIEWED_AT, answered),
            );
            expect(kept.label).toBeNull();
            const resolved = await evaluate(
                labelling(BOTH, LINKS),
                answers({ linkedIssues: [ISSUE_11] }),
                swept({ meaning: "needsRevision" }, false, REVIEWED_AT, answered),
            );
            expect(resolved.label).toEqual({ meaning: "needsReview", cause: "revisionResolved" });
        });

        it("resolves a revision when the checks pass again and no review stands against it", async () => {
            const { label } = await evaluate(
                labelling(BOTH, LINKS),
                answers({ linkedIssues: [ISSUE_11] }),
                swept({ meaning: "needsRevision" }),
            );
            expect(label).toEqual({ meaning: "needsReview", cause: "revisionResolved" });
        });

        it("never asks for needsReview on a draft, and still posts the dashboard", async () => {
            const { intents, label } = await evaluate(
                labelling(BOTH, LINKS),
                answers({ linkedIssues: [ISSUE_11] }),
                swept({}, true),
            );
            expect(intents).toHaveLength(1);
            expect(label).toBeNull();
        });

        it("withholds needsReview while a check is undetermined, and still fails on a failure", async () => {
            const checks = { mergeConflicts: on, linkedIssues: on };
            const undetermined = await evaluate(
                labelling(BOTH, checks),
                answers({ linkedIssues: [ISSUE_11] }),
                swept(),
            );
            expect(undetermined.label).toBeNull();
            const failing = await evaluate(labelling(BOTH, checks), answers({ linkedIssues: [] }));
            expect(failing.label).toEqual({ meaning: "needsRevision", cause: "checksFailed" });
        });

        /** `readyToMerge` is the maintainers' step past review; passing checks never pull it back. */
        it("never asks for needsReview from readyToMerge, and still fails it on a failure", async () => {
            const ready = await evaluate(
                labelling(BOTH, LINKS),
                answers({ linkedIssues: [ISSUE_11] }),
                swept({ meaning: "readyToMerge" }),
            );
            expect(ready.label).toBeNull();
            expect(ready.handle.explanations).toEqual([]);
            const failing = await evaluate(
                labelling(BOTH, LINKS),
                answers({ linkedIssues: [] }),
                pullRequest({ meaning: "readyToMerge" }),
            );
            expect(failing.label).toEqual({ meaning: "needsRevision", cause: "checksFailed" });
        });

        it("sets only the positions the repository listed", async () => {
            const { label } = await evaluate(
                labelling(["needsReview"], LINKS),
                answers({ linkedIssues: [] }),
            );
            expect(label).toBeNull();
        });

        /** The engine would refuse an edge the map does not draw; nothing is asked and the operator is told. */
        it("leaves a position the map cannot move, saying so", async () => {
            const already = await evaluate(
                labelling(BOTH, LINKS),
                answers({ linkedIssues: [] }),
                pullRequest({ meaning: "needsRevision" }),
            );
            expect(already.label).toBeNull();
            expect(already.handle.explanations.map((e) => e.summary)).toEqual([
                "Left the position alone: no edge prDashboard owns moves this pull request to needsRevision.",
            ]);
            const conflicted = factsFor(
                prDashboard.declaration,
                webhookPullRequest({
                    item: ITEM,
                    readiness: { draft: false },
                    position: {
                        kind: "conflict",
                        positions: ["needsReview", "needsRevision"],
                        blocked: false,
                        closedBy: null,
                        ignored: [],
                    },
                }),
            );
            const conflict = await evaluate(
                labelling(BOTH, LINKS),
                answers({ linkedIssues: [] }),
                conflicted,
            );
            expect(conflict.intents).toHaveLength(1);
            expect(conflict.label).toBeNull();
        });

        it("tells the operator about a listed position it never sets, and sets the rest", async () => {
            const { label, handle } = await evaluate(
                labelling(["blocked", "needsRevision"], LINKS),
                answers({ linkedIssues: [] }),
            );
            expect(label).toEqual({ meaning: "needsRevision", cause: "checksFailed" });
            expect(handle.explanations).toEqual([
                {
                    capability: "prDashboard",
                    summary: "applyLabels names blocked, a position prDashboard never sets.",
                    detail: ["it sets needsRevision and needsReview only"],
                },
            ]);
        });

        /** Every meaning is mapped by default (D203); a name that is no meaning is refused with the file. */
        it("refuses a listed name that is no meaning", () => {
            const result = parseConfig(
                {
                    schemaVersion: 2,
                    capabilities: {
                        prDashboard: { enabled: true, applyLabels: ["nonsense"] },
                    },
                    mappings: { labels: { awaitingTriage: "status: triage" } },
                },
                { revision: "rev-labels", knownCapabilities: [prDashboard.declaration] },
            );
            expect(result.ok ? [] : result.errors.map((e) => `${e.code} @ ${e.path}`)).toEqual([
                "settingInvalid @ capabilities.prDashboard.applyLabels.0",
            ]);
        });
    });

    /** D125: an unknown key is a document defect, refused whether or not it runs. */
    it("refuses a configuration that still supplies a marker", () => {
        const result = parseConfig(
            {
                schemaVersion: 2,
                capabilities: { prDashboard: { enabled: false, marker: "<!-- x -->" } },
            },
            { revision: "rev-marker", knownCapabilities: [prDashboard.declaration] },
        );
        expect(result.ok ? [] : result.errors.map((e) => `${e.code} @ ${e.path}`)).toEqual([
            "unknownKey @ capabilities.prDashboard.marker",
        ]);
    });

    it("refuses a check the App does not run", () => {
        const result = parseConfig(
            {
                schemaVersion: 2,
                capabilities: {
                    prDashboard: { enabled: true, checks: { spelling: { enabled: true } } },
                },
            },
            { revision: "rev-checks", knownCapabilities: [prDashboard.declaration] },
        );
        expect(result.ok ? [] : result.errors.map((e) => `${e.code} @ ${e.path}`)).toEqual([
            "unknownKey @ capabilities.prDashboard.checks.spelling",
        ]);
    });

    /** The nesting is the dependency: a sub-check is a block inside its parent's. */
    it("refuses a sub-check written beside its parent rather than inside it", () => {
        const result = parseConfig(
            {
                schemaVersion: 2,
                capabilities: {
                    prDashboard: {
                        enabled: true,
                        checks: {
                            linkedIssues: { enabled: true },
                            assignedIssues: { enabled: true },
                        },
                    },
                },
            },
            { revision: "rev-nesting", knownCapabilities: [prDashboard.declaration] },
        );
        expect(result.ok ? [] : result.errors.map((e) => `${e.code} @ ${e.path}`)).toEqual([
            "unknownKey @ capabilities.prDashboard.checks.assignedIssues",
        ]);
    });
});
