/**
 * The two ladders, one row per scenario in `design.md`'s Verified-by table.
 *
 * One intent per stale thing, and it is the act: a row about a reminder
 * asserts the act's `grace.warning.body`. Every fixture is one record.
 */

import { describe, expect, it } from "vitest";
import {
    createDestructiveWarning,
    decide as engineDecide,
    handleFor,
    projectCapabilityView,
    toEngine,
    writeRequestFor,
    type AnyIntent,
    type AssigneeClock,
    type DestructiveWarning,
    type Externals,
    type MappableMeaning,
    type Projection,
} from "@hiero-hackers/automation-core";
import { inactivity } from "./capability.js";
import type { InactivityFacts, IssueLadderFacts, PullLadderFacts } from "./declaration.js";
import {
    factsFor,
    answering,
    configEnabling,
    sweptIssue,
    sweptPullRequest,
} from "@hiero-hackers/automation-core/author/testing";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const AT = new Date("2026-09-09T00:00:00.000Z");
const REPO = { owner: "hiero-hackers", repo: "sandbox" } as const;
const ISSUE = { kind: "issue", number: 40 } as const;
const PULL = { kind: "pullRequest", number: 41 } as const;

const ago = (days: number): Date => new Date(AT.getTime() - days * DAY_MS);

/** The label spellings the design's own config example states. */
const LABELS = {
    needsReview: "status: needs review",
    needsRevision: "status: changes requested",
    blocked: "status: blocked",
};

/** `design.md`'s config block, verbatim — the ladder every row below reads. */
const DESIGN_SETTINGS = {
    exemptBlocked: true,
    remindAfter: "14d",
    reap: { after: "21d" },
    issues: { enabled: true, reap: { enabled: true } },
    pullRequests: {
        enabled: true,
        reap: { after: "60d" },
        reapWhen: {
            draft: { enabled: true, reap: { enabled: true } },
            changesRequested: { enabled: true, reap: { enabled: true } },
            needsRevision: {
                enabled: true,
                remindAfter: "2d",
                reap: { enabled: true, after: "5d" },
            },
        },
    },
};

const viewWith = (settings: Readonly<Record<string, unknown>>) =>
    projectCapabilityView(
        inactivity.declaration,
        configEnabling(
            ["inactivity"],
            [inactivity.declaration],
            { inactivity: settings },
            { labels: LABELS },
        ),
    );

const view = viewWith(DESIGN_SETTINGS);

/**
 * `never` by default so one helper serves both projections: a position naming
 * no meaning suits either, and one that names a meaning infers it.
 */
function position<M extends MappableMeaning = never>(
    over: {
        readonly meaning?: M | null;
        readonly blocked?: boolean;
        readonly closed?: boolean;
    } = {},
): Projection<M> {
    return {
        kind: "position",
        state: {
            meaning: over.meaning ?? null,
            blocked: over.blocked ?? false,
            closedBy: over.closed === true ? "closedByHuman" : null,
        },
        ignored: [],
    };
}

const assignee = (
    login: string,
    assignedDaysAgo: number,
    lastWorkingAt: Date | null = null,
): AssigneeClock => ({ login, assignedAt: ago(assignedDaysAgo), lastWorkingAt });

/** The sweep reads more than this ladder declares (`locked`, `skills`), so the record is projected (D211). */
const issueRecord = (over: NonNullable<Parameters<typeof sweptIssue>[0]> = {}): IssueLadderFacts =>
    factsFor(
        inactivity.declaration,
        sweptIssue({
            repository: REPO,
            item: ISSUE,
            observedAt: AT,
            position: position(),
            assignees: [assignee("alice", 40)],
            links: { openPullRequests: [] },
            ...over,
        }),
    ) as IssueLadderFacts;

/** A stale draft, seventy days idle — the pull-request ladder's starting point. */
const REVIEW = {
    changesRequested: false,
    reapableSince: {
        needsRevision: ago(70),
        changesRequested: ago(70),
        draft: ago(70),
    },
    lastCommitAt: null,
} as const;

/**
 * The contributor-side facts take their own overrides. `draft` is spelled
 * with the review facts although it lives in its own group.
 */
const pullRecord = (
    over: NonNullable<Parameters<typeof sweptPullRequest>[0]> = {},
    review: Partial<PullLadderFacts["review"] & PullLadderFacts["readiness"]> = {},
): PullLadderFacts => {
    const { draft, ...rest } = { draft: true, ...review };
    // The sweep reads links this ladder never declared (D214), so the record is projected.
    return factsFor(
        inactivity.declaration,
        sweptPullRequest({
            repository: REPO,
            item: PULL,
            observedAt: AT,
            position: position(),
            assignees: [assignee("alice", 40)],
            ...over,
            review: { ...REVIEW, ...rest },
            readiness: { draft },
        }),
    ) as PullLadderFacts;
};

const human = answering({ ok: true, value: false });

/**
 * The engine's own handle, which every row below drives the capability through.
 * Inactivity speaks in intents, so an explanation it recorded is a failure.
 */
const decide = async (facts: InactivityFacts, on = view, source = human) => {
    const platform = handleFor(inactivity.declaration, facts, source);
    const intents = await inactivity.evaluate(facts, on, platform);
    expect(platform.explanations).toEqual([]);
    return intents;
};

const ENGINE = [toEngine(inactivity)];

const CONFIG = configEnabling(
    ["inactivity"],
    [inactivity.declaration],
    { inactivity: DESIGN_SETTINGS },
    { labels: LABELS },
);

/** The two facts the engine rows dial; everything else is the quiet default. */
interface Dialled {
    readonly killSwitchActive?: boolean;
    readonly latestHumanChangeAt?: Date | null;
    readonly warningFor?: NonNullable<Externals["warningFor"]>;
}

const externals = (over: Dialled): Externals => ({
    killSwitchActive: over.killSwitchActive ?? false,
    installationGrants: ["issues:write"],
    latestHumanChangeAt: () => over.latestHumanChangeAt ?? null,
    resolve: human,
    // Spread rather than set: absent IS the "nobody was warned" answer, and
    // an explicit `undefined` is a different thing to say (grace.md §2).
    ...(over.warningFor === undefined ? {} : { warningFor: over.warningFor }),
});

describe("the clocks reset on development activity only", () => {
    it("`/working` after the reminder", async () => {
        // A 40-day assignment, then `/working` three days ago: the clock restarts.
        const record = issueRecord({ assignees: [assignee("alice", 40, ago(3))] });

        expect(await decide(record)).toEqual([]);
    });

    it("A commit to the PR after the reminder", async () => {
        const record = pullRecord(
            {},
            { draft: false, changesRequested: true, lastCommitAt: ago(2) },
        );

        expect(await decide(record)).toEqual([]);

        // The clock starts at the newest of the commit and every `/working`.
        const mixed = pullRecord(
            {
                assignees: [assignee("alice", 80, ago(20)), assignee("bob", 80, ago(40))],
                position: position({ meaning: "needsRevision" }),
            },
            { draft: false, changesRequested: false, lastCommitAt: ago(30) },
        );

        expect(await decide(mixed)).toMatchObject([
            {
                operation: "closePullRequest",
                cause: { observedAt: ago(20) },
                grace: { activityAt: ago(20) },
            },
        ]);
    });

    it("Ordinary comments and reviews after the reminder", async () => {
        // There is no field for a comment or a review, so a clock that saw
        // nothing but chatter is a clock that has not moved — and the act is
        // asked for, carrying the warning the platform posts first.
        const record = pullRecord(
            { position: position({ meaning: "needsRevision" }) },
            { draft: false, changesRequested: false },
        );

        expect(await decide(record)).toMatchObject([
            { operation: "closePullRequest", item: PULL, grace: { hours: 3 * 24 } },
        ]);
    });
});

describe("the pull-request ladder judges the contributor's wait", () => {
    /** Each reason claims the evidence it read; a native mode is not a label. */
    it("a stale changes-requested pull request closes, claiming the mode", async () => {
        const mode = pullRecord({}, { draft: false, changesRequested: true });

        expect(await decide(mode)).toMatchObject([
            {
                item: PULL,
                operation: "closePullRequest",
                claims: { closed: false, meaningsPresent: [], pullRequestMode: "changesRequested" },
                grace: { topic: "changesRequested" },
            },
        ]);
    });

    /** The reason a reminder names, in the phrase this reason renders as. */
    it("names changes-requested in the words the warning it carries uses", async () => {
        const mode = pullRecord({}, { draft: false, changesRequested: true });

        expect(await decide(mode)).toMatchObject([
            {
                operation: "closePullRequest",
                grace: {
                    warning: {
                        body: "⏰ Hi @alice — this pull request has had **changes requested** without development activity for 14 days. Push a commit or comment `/working` to let us know you are working on it, otherwise the pull request will be closed on **2026-10-25**.",
                    },
                },
            },
        ]);
    });

    it("a stale draft pull request closes, claiming the mode", async () => {
        expect(await decide(pullRecord())).toMatchObject([
            {
                item: PULL,
                operation: "closePullRequest",
                claims: { closed: false, meaningsPresent: [], pullRequestMode: "draft" },
                grace: { topic: "draft" },
            },
        ]);
    });

    it("the label reason still claims its meaning, and claims no mode", async () => {
        const labelled = pullRecord(
            { position: position({ meaning: "needsRevision" }) },
            { draft: false, changesRequested: true },
        );

        const [intent] = await decide(labelled);

        expect(intent).toMatchObject({
            item: PULL,
            operation: "closePullRequest",
            claims: { closed: false, meaningsPresent: ["needsRevision"] },
        });
        expect(intent?.claims).not.toHaveProperty("pullRequestMode");
    });

    it("PR stale for a year in `needsReview`", async () => {
        const record = pullRecord(
            { position: position({ meaning: "needsReview" }) },
            {
                draft: false,
                reapableSince: {
                    needsRevision: ago(365),
                    changesRequested: ago(365),
                    draft: ago(365),
                },
            },
        );

        expect(await decide(record)).toEqual([]);
    });

    /** The label says the reviewers' wait; the review fact says the author's. The fact decides (D241). */
    it("PR in `needsReview` after a review requested changes", async () => {
        const sentBack = pullRecord(
            { position: position({ meaning: "needsReview" }) },
            {
                draft: false,
                changesRequested: true,
                reapableSince: {
                    needsRevision: ago(365),
                    changesRequested: ago(70),
                    draft: ago(365),
                },
            },
        );

        expect(await decide(sentBack)).toMatchObject([
            {
                operation: "closePullRequest",
                claims: { meaningsPresent: ["needsReview"], pullRequestMode: "changesRequested" },
            },
        ]);
    });

    /** The first diamond is the meaning, whatever mode the pull request is in. */
    it("leaves a draft carrying `needsReview` alone, mode or no mode", async () => {
        const awaited = pullRecord({ position: position({ meaning: "needsReview" }) });

        expect(await decide(awaited)).toEqual([]);
    });

    it("Draft PR marked ready for review, no `needsRevision`", async () => {
        // Out of draft, nothing asked of the contributor: the wait is the
        // maintainers' again and the clock stops, however long it had run.
        expect(await decide(pullRecord({}, { draft: false }))).toEqual([]);
    });

    it("Stale draft PR with `reapWhen.draft` not enabled", async () => {
        const opted = viewWith({
            ...DESIGN_SETTINGS,
            pullRequests: {
                ...DESIGN_SETTINGS.pullRequests,
                reapWhen: { changesRequested: { enabled: true, reap: { enabled: true } } },
            },
        });

        expect(await decide(pullRecord(), opted)).toEqual([]);
    });

    it("`needsRevision` override of 2d/5d", async () => {
        const quality = pullRecord(
            { position: position({ meaning: "needsRevision" }) },
            {
                draft: false,
                reapableSince: {
                    needsRevision: ago(3),
                    changesRequested: ago(3),
                    draft: ago(3),
                },
            },
        );
        // One record, one decision, so the ordinary pull request is its own
        // call: three days is nothing against the sixty-day ladder, and only
        // the label reason's own 2/5 override puts one on the ladder.
        const ordinary = pullRecord(
            { item: { kind: "pullRequest", number: 42 } },
            {
                draft: false,
                changesRequested: true,
                reapableSince: {
                    needsRevision: ago(3),
                    changesRequested: ago(3),
                    draft: ago(3),
                },
            },
        );

        expect(await decide(ordinary)).toEqual([]);
        expect(await decide(quality)).toEqual([
            {
                capability: "inactivity",
                repository: REPO,
                item: PULL,
                operation: "closePullRequest",
                desired: { reason: "This pull request was closed after 5 days of inactivity." },
                // The one reason the apply-time re-gate can re-check.
                claims: { meaningsPresent: ["needsRevision"], meaningsAbsent: [], closed: false },
                // Dated at the clock's start, so the identity outlives the sweep.
                cause: { cause: "pullRequestWentStale", observedAt: ago(3) },
                explanation: {
                    capability: "inactivity",
                    summary:
                        "Warned about a pull request stale in needsRevision; the close follows the grace.",
                    detail: ["idle 3 days", "closes after 5 days"],
                },
                idempotencyKey: expect.any(String),
                grace: {
                    // 5d − 2d: the gap between the two rungs.
                    hours: 3 * 24,
                    topic: "needsRevision",
                    warning: {
                        body: "⏰ Hi @alice — this pull request has carried the `needsRevision` label without development activity for 2 days. Push a commit or comment `/working` to let us know you are working on it, otherwise the pull request will be closed on **2026-09-12**.",
                    },
                    notice: {
                        body: "This pull request was closed after 5 days of inactivity.",
                    },
                    cancelledBy: "a commit or a /working comment",
                    reversesWith: "re-assign / reopen",
                    activityAt: null,
                },
            },
        ]);
    });

    it("Review flips a PR `needsReview` → `needsRevision`", async () => {
        const flipped = (daysAgo: number) =>
            pullRecord(
                { position: position({ meaning: "needsRevision" }) },
                {
                    draft: false,
                    reapableSince: {
                        needsRevision: ago(daysAgo),
                        changesRequested: ago(daysAgo),
                        draft: ago(daysAgo),
                    },
                },
            );

        // The clock starts at the flip, so the reason's own two days must pass.
        expect(await decide(flipped(1))).toEqual([]);
        expect(await decide(flipped(2))).toMatchObject([
            { operation: "closePullRequest", grace: { hours: 3 * 24 } },
        ]);
        // Flipped back: the wait is the maintainers' and the clock stops.
        expect(
            await decide(
                pullRecord(
                    { position: position({ meaning: "needsReview" }) },
                    {
                        draft: false,
                        reapableSince: {
                            needsRevision: ago(365),
                            changesRequested: ago(365),
                            draft: ago(365),
                        },
                    },
                ),
            ),
        ).toEqual([]);
    });

    it("Unlinked PR stale in draft mode", async () => {
        // No assignees: reminded and closed like any other, and
        // the reminder is addressed to nobody rather than to an invented name.
        expect(await decide(pullRecord({ assignees: [] }))).toMatchObject([
            {
                item: PULL,
                operation: "closePullRequest",
                claims: { pullRequestMode: "draft" },
                grace: {
                    warning: {
                        body: "⏰ This pull request has been in **draft** without development activity for 14 days. Push a commit or comment `/working` to let us know you are working on it, otherwise the pull request will be closed on **2026-10-25**.",
                    },
                },
            },
        ]);
    });

    it("Reaper closes a PR", async () => {
        // An intent names the record's own item, so the close is the only act.
        const closing = pullRecord(
            { position: position({ meaning: "needsRevision" }) },
            { draft: false },
        );

        const intents = await decide(closing);

        expect(intents).toEqual([
            expect.objectContaining({
                item: PULL,
                operation: "closePullRequest",
                desired: {
                    reason: "This pull request was closed after 5 days of inactivity.",
                },
            }),
        ]);
    });
});

describe("the issue ladder judges each assignment on its own clock", () => {
    it("Released then re-assigned", async () => {
        // The occasion is the clock's start, so a re-assignment is a new effect.
        const record = issueRecord({ assignees: [assignee("alice", 15)] });

        expect(await decide(record)).toEqual([
            {
                capability: "inactivity",
                repository: REPO,
                item: ISSUE,
                operation: "releaseAssignment",
                desired: { login: "alice" },
                claims: { meaningsPresent: [], meaningsAbsent: [], closed: false },
                cause: { cause: "assignmentWentStale", observedAt: ago(15) },
                explanation: {
                    capability: "inactivity",
                    summary:
                        "Warned alice about a stale assignment; the release follows the grace.",
                    detail: ["idle 15 days", "releases after 21 days"],
                },
                idempotencyKey: expect.any(String),
                grace: {
                    hours: 7 * 24,
                    topic: "alice",
                    warning: {
                        body: "⏰ Hi @alice — you are assigned to this issue, but there is no pull request after 14 days. Still working on it? Comment `/working` to let us know development is active, otherwise this assignment will be released on **2026-09-16**.",
                    },
                    notice: {
                        body: "This assignment was released after 21 days of inactivity. The issue is open for anyone to pick up — you are welcome to `/assign` it again when you have capacity.",
                    },
                    cancelledBy: "a commit or a /working comment",
                    reversesWith: "re-assign / reopen",
                    activityAt: null,
                },
            },
        ]);

        // A longer run of the same assignment is a different occasion, so a
        // warning recorded against one authorizes nothing about the other.
        const older = await decide(issueRecord({ assignees: [assignee("alice", 40)] }));
        expect(older[0]?.idempotencyKey).not.toBe((await decide(record))[0]?.idempotencyKey);
    });

    /** The ladder starts AT its threshold, not an hour after it. */
    it("puts an assignment on the ladder the hour its clock reaches the threshold", async () => {
        const idleFor = (hours: number) =>
            issueRecord({
                assignees: [
                    {
                        login: "alice",
                        assignedAt: new Date(AT.getTime() - hours * HOUR_MS),
                        lastWorkingAt: null,
                    },
                ],
            });

        // `14d` resolves to 336 hours, and the comparison is the whole claim.
        expect(await decide(idleFor(335))).toEqual([]);
        expect(await decide(idleFor(336))).toMatchObject([
            { operation: "releaseAssignment", desired: { login: "alice" } },
        ]);
    });

    it("Two assignees, one recent", async () => {
        // Each assignment is judged on its own clock: alice is forty days in
        // and goes on the ladder, bob is thirteen and is not asked about at
        // all. One intent, one person, one warning naming only them.
        const record = issueRecord({
            assignees: [assignee("alice", 40), assignee("bob", 13)],
        });

        expect(await decide(record)).toEqual([
            expect.objectContaining({
                operation: "releaseAssignment",
                desired: { login: "alice" },
                cause: { cause: "assignmentWentStale", observedAt: ago(40) },
                explanation: {
                    capability: "inactivity",
                    summary:
                        "Warned alice about a stale assignment; the release follows the grace.",
                    detail: ["idle 40 days", "releases after 21 days"],
                },
                grace: expect.objectContaining({
                    warning: {
                        body: "⏰ Hi @alice — you are assigned to this issue, but there is no pull request after 14 days. Still working on it? Comment `/working` to let us know development is active, otherwise this assignment will be released on **2026-09-16**.",
                    },
                }),
            }),
        ]);
    });

    it("Issue gains an open linked PR", async () => {
        const record = issueRecord({ links: { openPullRequests: [PULL] } });

        expect(await decide(record)).toEqual([]);
    });
});

/**
 * A ladder that reminds and never acts: with no act to hang the words on, the
 * reminder is the intent.
 */
describe("a ladder with no reap block reminds and never releases", () => {
    const remindOnly = viewWith({
        remindAfter: "14d",
        issues: { enabled: true },
        pullRequests: {
            enabled: true,
            remindAfter: "2d",
            reapWhen: { needsRevision: { enabled: true } },
        },
    });

    it("posts the reminder itself, with no release beside it and no date promised", async () => {
        expect(await decide(issueRecord(), remindOnly)).toEqual([
            {
                capability: "inactivity",
                repository: REPO,
                item: ISSUE,
                operation: "postManagedComment",
                desired: {
                    kind: "warning",
                    topic: "alice",
                    body: "⏰ Hi @alice — you are assigned to this issue, but there is no pull request after 14 days. Still working on it? Comment `/working` to let us know development is active.",
                },
                claims: { meaningsPresent: [], meaningsAbsent: [], closed: false },
                cause: { cause: "assignmentWentStale", observedAt: ago(40) },
                explanation: {
                    capability: "inactivity",
                    summary:
                        "Reminded alice about a stale assignment; this ladder releases nothing.",
                    detail: ["idle 40 days"],
                },
                idempotencyKey: expect.any(String),
                // No grace: there is no act to hold (grace.md §1).
                grace: null,
            },
        ]);
    });

    it("says the same on the pull-request side, under the reason as its topic", async () => {
        const stale = pullRecord(
            { position: position({ meaning: "needsRevision" }) },
            { draft: false },
        );

        expect(await decide(stale, remindOnly)).toEqual([
            {
                capability: "inactivity",
                repository: REPO,
                item: PULL,
                operation: "postManagedComment",
                desired: {
                    kind: "warning",
                    topic: "needsRevision",
                    body: "⏰ Hi @alice — this pull request has carried the `needsRevision` label without development activity for 2 days. Push a commit or comment `/working` to let us know you are working on it.",
                },
                claims: { meaningsPresent: ["needsRevision"], meaningsAbsent: [], closed: false },
                cause: { cause: "pullRequestWentStale", observedAt: ago(70) },
                explanation: {
                    capability: "inactivity",
                    summary:
                        "Reminded about a pull request stale in needsRevision; this reason closes nothing.",
                    detail: ["idle 70 days"],
                },
                idempotencyKey: expect.any(String),
                grace: null,
            },
        ]);
    });

    /**
     * The control: the same file with the reap block consented to says what it
     * always said, so the silence above is the missing block and nothing else.
     */
    it("goes back to warning-then-releasing the moment the block consents", async () => {
        const consenting = viewWith({
            remindAfter: "14d",
            reap: { after: "21d" },
            issues: { enabled: true, reap: { enabled: true } },
        });

        expect(await decide(issueRecord(), consenting)).toMatchObject([
            { operation: "releaseAssignment", grace: { hours: 7 * 24 } },
        ]);
    });
});

describe("what pauses or ends a ladder", () => {
    it("Item gains the `blocked` meaning mid-cycle", async () => {
        const paused = issueRecord({ position: position({ blocked: true }) });
        const pausedPull = pullRecord({ position: position({ blocked: true }) });

        expect(await decide(paused)).toEqual([]);
        expect(await decide(pausedPull)).toEqual([]);
    });

    /** A position no ladder can read. */
    it("says nothing about an item it cannot judge", async () => {
        const conflicted = issueRecord({
            position: {
                kind: "conflict",
                positions: ["ready", "inProgress"],
                blocked: false,
                closedBy: null,
                ignored: [],
            },
        });

        expect(await decide(conflicted)).toEqual([]);
    });

    /** The closed item is the platform's stop: this ladder never sees one (D59). */
    it("is not woken for a closed issue at all", async () => {
        const closed = issueRecord({ position: position({ closed: true }) });

        const decision = await engineDecide(
            { kind: "facts", facts: closed },
            CONFIG,
            ENGINE,
            externals({}),
        );

        expect(decision.approved).toEqual([]);
        expect(decision.report.findings).toEqual([]);
    });

    it("leaves a ladder the repository never enabled alone", async () => {
        const parked = viewWith({});

        expect(await decide(issueRecord(), parked)).toEqual([]);
        expect(await decide(pullRecord(), parked)).toEqual([]);
    });
});

describe("never from a bot, and never on an answer it did not get", () => {
    /** A second stale issue, so the answer is seen to stop every one of them. */
    const other = issueRecord({ item: { kind: "issue", number: 44 } });

    it("never reclaims from a bot, warned or not", async () => {
        const bot = answering({ ok: true, value: true });

        expect(await decide(issueRecord(), view, bot)).toEqual([]);
        expect(await decide(other, view, bot)).toEqual([]);
    });

    it("does nothing when it cannot tell whether the assignee is a bot", async () => {
        const undetermined = answering({
            ok: false,
            reason: "unavailable",
            detail: "the actor lookup is not wired up",
        });

        expect(await decide(issueRecord(), view, undetermined)).toEqual([]);
        expect(await decide(other, view, undetermined)).toEqual([]);
    });
});

describe("nothing rides along with a close", () => {
    const closing = () =>
        pullRecord({ position: position({ meaning: "needsRevision" }) }, { draft: false });

    it("closes and says only that, with the issue ladder on", async () => {
        // The linked issues are somebody else's record: this ladder does not
        // declare links (D214), so it has no world to judge their assignments in.
        expect(await decide(closing())).toEqual([
            expect.objectContaining({
                item: PULL,
                operation: "closePullRequest",
                desired: {
                    reason: "This pull request was closed after 5 days of inactivity.",
                },
            }),
        ]);
    });

    it("says the same with the issue ladder switched off", async () => {
        const alone = await decide(
            closing(),
            viewWith({ ...DESIGN_SETTINGS, issues: { enabled: false } }),
        );

        expect(alone).toEqual([
            expect.objectContaining({
                operation: "closePullRequest",
                desired: {
                    reason: "This pull request was closed after 5 days of inactivity.",
                },
            }),
        ]);
    });
});

/**
 * `decide()` with the recorded warning stubbed, so one intent can be watched
 * through warn, wait and act (grace.md §2).
 */
describe("the platform warns, waits, then acts", () => {
    /** Alice, forty days idle on a 14/21 ladder: seven days of grace. */
    const STALE = issueRecord();

    const decided = async (over: Dialled = {}) =>
        await engineDecide({ kind: "facts", facts: STALE }, CONFIG, ENGINE, externals(over));

    /** The act as the capability asks for it — what every stub below is about. */
    const actIntent = async (): Promise<AnyIntent> => (await decide(STALE))[0] as AnyIntent;

    /** The warning the platform would have recorded, had it warned at `at`. */
    const warnedAt = (act: AnyIntent, at: Date): DestructiveWarning => {
        const grace = act.grace!;
        return createDestructiveWarning({
            request: writeRequestFor(act),
            warnedAt: at,
            gracePeriodHours: grace.hours,
            earliestActionAt: new Date(at.getTime() + grace.hours * HOUR_MS),
            cancelledBy: grace.cancelledBy,
            reversesWith: grace.reversesWith,
        });
    };

    it("posts the capability's own warning first, and approves no release", async () => {
        const act = await actIntent();
        const decision = await decided();

        expect(
            decision.approved.map((effect) => ({
                operation: effect.intent.operation,
                desired: effect.intent.desired,
                kind: effect.managedComment?.identity.kind,
                topic: effect.managedComment?.identity.topic,
                records: effect.records?.effectId,
            })),
        ).toEqual([
            {
                operation: "postManagedComment",
                desired: { kind: "warning", topic: "alice", body: act.grace?.warning.body },
                kind: "warning",
                // A second assignee earns a second comment (D145).
                topic: "alice",
                // The warning carries the act's identity as what it authorizes.
                records: act.idempotencyKey,
            },
        ]);
        expect(decision.approved[0]?.intent.evaluatedAt).toEqual(AT);
        expect(decision.report.findings.map((finding) => finding.code)).toEqual([
            "capabilityExplained",
            "applied",
        ]);
    });

    it("approves the release once the grace has run and nothing happened", async () => {
        const act = await actIntent();
        const decision = await decided({
            warningFor: () => warnedAt(act, ago(8)),
        });

        expect(
            decision.approved.map((effect) => ({
                operation: effect.intent.operation,
                desired: effect.intent.desired,
                // The notice a graced act posts stands under the act's topic.
                kind: effect.managedComment?.identity.kind,
                topic: effect.managedComment?.identity.topic,
                records: effect.records,
            })),
        ).toEqual([
            {
                operation: "releaseAssignment",
                desired: { login: "alice" },
                kind: "notice",
                topic: "alice",
                records: null,
            },
        ]);
    });

    it("does not mistake the stable assignment clock for the safety cutoff", async () => {
        const act = await actIntent();
        const decision = await decided({
            latestHumanChangeAt: ago(1),
            warningFor: () => warnedAt(act, ago(8)),
        });

        expect(decision.approved).toHaveLength(1);
        expect(decision.approved[0]?.intent.operation).toBe("releaseAssignment");
        expect(decision.approved[0]?.intent.evaluatedAt).toEqual(AT);
    });

    it("says the grace is running, and says it as news rather than a fault", async () => {
        const act = await actIntent();
        const decision = await decided({ warningFor: () => warnedAt(act, ago(2)) });

        expect(decision.approved).toEqual([]);
        expect(decision.report.findings).toEqual([
            expect.objectContaining({ code: "graceRunning", severity: "info" }),
        ]);
    });

    it("Kill switch mid-grace", async () => {
        const act = await actIntent();
        const decision = await decided({
            killSwitchActive: true,
            warningFor: () => warnedAt(act, ago(8)),
        });

        expect(decision.approved).toEqual([]);
        expect(decision.report.findings.map((finding) => finding.code)).toEqual(["killSwitch"]);
    });
});
