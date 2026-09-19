/**
 * The second gate: what `decide()` does with an intent that carries grace
 * (`design/guides/grace.md` §2).
 *
 * The fixture is a capability with ONE graced act, so every row below is the
 * same intent meeting a different recorded warning. That is the whole of what
 * the routing decides — the capability says the same thing on every sweep, and
 * the platform's own record is what changes.
 *
 * `decide.test.ts` owns the ordinary gate and everything above it; this file
 * owns the destructive one, including the two screens that keep the two
 * classes from wearing each other's clothes.
 */

import { describe, expect, it } from "vitest";
import {
    createDestructiveWarning,
    decide,
    declareCapability,
    spec,
    intentFactory,
    writeRequestFor,
    type AnyIntent,
    type DestructiveGrace,
    type DestructiveWarning,
    type EngineCapability,
    type Externals,
    type IssueFacts,
    type RepositoryMode,
} from "../../src/index.js";
import { configWith } from "../config/builders.js";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const AT = new Date("2026-09-09T00:00:00.000Z");
const ago = (days: number): Date => new Date(AT.getTime() - days * DAY_MS);
const REPO = { owner: "o", repo: "r" } as const;
const ITEM = { kind: "issue", number: 7 } as const;

/** The clock's start — the occasion every intent below is dated at. */
const IDLE_SINCE = ago(40);

const declaration = declareCapability({
    name: "reaper",
    triggers: [{ kind: "schedule", description: "sweep" }],
    settings: spec({}),
    requiredMappings: {},
    facts: ["issue"],
    needs: [],
    resolvers: [],
    intents: ["releaseAssignment", "postManagedComment"],
});

const GRACE: DestructiveGrace = {
    hours: 7 * 24,
    // Whose clock this is: an issue with two stale assignees earns two
    // warnings and two notices, told apart by nothing else (grace.md §3).
    topic: "alice",
    warning: { body: "This assignment will be released on **2026-09-16**." },
    notice: { body: "This assignment was released." },
    cancelledBy: "a /working comment",
    reversesWith: "re-assign",
    activityAt: null,
};

/** The same terms with the topic left to the platform's default. */
const UNTOPICED: DestructiveGrace = {
    hours: GRACE.hours,
    warning: GRACE.warning,
    notice: GRACE.notice,
    cancelledBy: GRACE.cancelledBy,
    reversesWith: GRACE.reversesWith,
    activityAt: GRACE.activityAt,
};

const make = intentFactory("reaper", { repository: REPO, item: ITEM, observedAt: IDLE_SINCE });

/** The act, with whatever this row is dialling. */
const act = (grace: DestructiveGrace | null = GRACE): AnyIntent =>
    make({
        operation: "releaseAssignment",
        desired: { login: "alice" },
        cause: "assignmentWentStale",
        claims: { closed: false },
        explain: { summary: "Alice's assignment is stale." },
        ...(grace === null ? {} : { grace }),
    });

const capabilityAsking = (intent: AnyIntent): EngineCapability => ({
    declaration: declaration as never,
    evaluate: (async () => [intent]) as never,
});

const facts: IssueFacts = {
    kind: "issue",
    repository: REPO,
    item: ITEM,
    observedAt: AT,
    trigger: { kind: "sweep" },
    author: "opener",
    actor: null,
    locked: false,
    arrival: null,
    alerts: { carried: [], arrived: [] },
    command: "unread",
    position: {
        kind: "position",
        state: { meaning: null, blocked: false, closedBy: null },
        ignored: [],
    },
    assignees: [],
    links: { openPullRequests: [] },
};

const config = (mode: RepositoryMode = "active") =>
    configWith({ mode, capabilities: ["reaper"], labels: {} });

/** The warning the platform would have recorded, had it warned at `at`. */
const warnedAt = (intent: AnyIntent, at: Date): DestructiveWarning =>
    createDestructiveWarning({
        request: writeRequestFor(intent),
        warnedAt: at,
        gracePeriodHours: GRACE.hours,
        earliestActionAt: new Date(at.getTime() + GRACE.hours * HOUR_MS),
        cancelledBy: GRACE.cancelledBy,
        reversesWith: GRACE.reversesWith,
    });

const externals = (warningFor?: NonNullable<Externals["warningFor"]>): Externals => ({
    killSwitchActive: false,
    installationGrants: ["issues:write"],
    latestHumanChangeAt: () => null,
    ...(warningFor === undefined ? {} : { warningFor }),
});

const decided = async (
    intent: AnyIntent,
    warningFor?: NonNullable<Externals["warningFor"]>,
    mode: RepositoryMode = "active",
) =>
    await decide(
        { kind: "facts", facts },
        config(mode),
        [capabilityAsking(intent)],
        externals(warningFor),
    );

describe("with no warning recorded", () => {
    it("approves the platform's own warning comment, and not the act", async () => {
        const intent = act();

        const decision = await decided(intent);

        expect(decision.approved).toHaveLength(1);
        const [approved] = decision.approved;
        expect(approved?.intent).toMatchObject({
            capability: "reaper",
            item: ITEM,
            operation: "postManagedComment",
            desired: { kind: "warning", topic: "alice", body: GRACE.warning.body },
            // The act's occasion, so the warning and the act are one plan
            // rather than two things that happened to the same item.
            cause: { cause: "assignmentWentStale", observedAt: IDLE_SINCE },
            claims: { closed: false },
            // The identity is the act's, suffixed: two effects the journal can
            // tell apart, under one readable name.
            idempotencyKey: `${intent.idempotencyKey}:warning`,
            grace: null,
        });
        // The comment identity is per item and purpose, and the topic is the
        // act's — so alice's warning is not bob's (D145).
        expect(approved?.managedComment?.identity).toEqual({
            capability: "reaper",
            item: ITEM,
            kind: "warning",
            topic: "alice",
        });
        // What the applier stores the moment the comment lands: the ACT's
        // authority, keyed by the ACT.
        expect(approved?.records).toEqual({
            effectId: intent.idempotencyKey,
            request: writeRequestFor({ ...intent, evaluatedAt: AT }),
            gracePeriodHours: 7 * 24,
            cancelledBy: GRACE.cancelledBy,
            reversesWith: GRACE.reversesWith,
        });
        expect(decision.report.findings.map((finding) => finding.code)).toEqual([
            "capabilityExplained",
            "applied",
        ]);
    });

    /**
     * An act that names no topic gets the default, and the default promises
     * ONE warning comment per item per purpose: two untopiced acts of one kind
     * on one item would rewrite each other's warning rather than stand beside
     * it (D145). Named here because the default is what most capabilities take.
     */
    it("stands the warning under the empty topic when the act names none", async () => {
        const decision = await decided(act(UNTOPICED));

        expect(decision.approved[0]?.intent.desired).toEqual({
            kind: "warning",
            topic: "",
            body: GRACE.warning.body,
        });
        expect(decision.approved[0]?.managedComment?.identity).toEqual({
            capability: "reaper",
            item: ITEM,
            kind: "warning",
            topic: "",
        });
    });

    it("names the WARNING in a dry-run rehearsal, not the act it is holding", async () => {
        const decision = await decided(act(), undefined, "dry-run");

        expect(decision.approved).toEqual([]);
        const rehearsal = decision.report.findings.find((finding) => finding.code === "wouldApply");
        expect(rehearsal?.summary).toContain("would postManagedComment");
        expect(rehearsal?.summary).toContain("managed warning comment from reaper");
    });

    /**
     * A lookup that threw established nothing, and "nothing" must not read as
     * "no warning": that answer posts a second warning and re-dates the
     * promise. So neither rung runs.
     */
    it("neither warns nor acts when the lookup throws", async () => {
        const decision = await decided(act(), () => {
            throw new Error("the store is gone");
        });

        expect(decision.approved).toEqual([]);
        expect(decision.report.findings).toEqual([
            expect.objectContaining({ code: "warningLookupFailed", severity: "problem" }),
        ]);
    });
});

describe("with a warning standing", () => {
    it("approves the act once the grace has run and nothing happened", async () => {
        const intent = act();

        const decision = await decided(intent, () => warnedAt(intent, ago(8)));

        expect(decision.approved).toHaveLength(1);
        expect(decision.approved[0]?.intent.operation).toBe("releaseAssignment");
        // A graced act gets an identity of its own: the notice it posts once
        // it lands stands under the act's topic, beside the warning that
        // preceded it.
        expect(decision.approved[0]?.managedComment?.identity).toEqual({
            capability: "reaper",
            item: ITEM,
            kind: "notice",
            topic: "alice",
        });
        expect(decision.approved[0]?.records).toBeNull();
    });

    /** The notice takes the same default, so the two stay one plan. */
    it("stands the notice under the empty topic when the act names none", async () => {
        const intent = act(UNTOPICED);

        const decision = await decided(intent, () => warnedAt(intent, ago(8)));

        expect(decision.approved[0]?.managedComment?.identity).toEqual({
            capability: "reaper",
            item: ITEM,
            kind: "notice",
            topic: "",
        });
    });

    it("reports a running grace as news rather than a fault", async () => {
        const intent = act();

        const decision = await decided(intent, () => warnedAt(intent, ago(2)));

        expect(decision.approved).toEqual([]);
        expect(decision.report.findings).toEqual([
            expect.objectContaining({ code: "graceRunning", severity: "info" }),
        ]);
    });

    it("refuses the act when the person acted after they were warned", async () => {
        const intent = act({ ...GRACE, activityAt: ago(5) });

        const decision = await decided(intent, () => warnedAt(intent, ago(8)));

        expect(decision.approved).toEqual([]);
        expect(decision.report.findings).toEqual([
            expect.objectContaining({ code: "activityCancelled" }),
        ]);
    });

    /** Activity BEFORE the warning is what the warning was posted about. */
    it("acts anyway when the activity predates the warning", async () => {
        const intent = act({ ...GRACE, activityAt: ago(20) });

        const decision = await decided(intent, () => warnedAt(intent, ago(8)));

        expect(decision.approved.map((effect) => effect.intent.operation)).toEqual([
            "releaseAssignment",
        ]);
    });

    /**
     * A promise made about some OTHER plan authorizes nothing here (D60), and
     * the snapshot is what says so — the gate is reached, and refuses.
     */
    it("refuses a warning recorded against a different change", async () => {
        const intent = act();
        const other = make({
            operation: "releaseAssignment",
            desired: { login: "bob" },
            cause: "assignmentWentStale",
            claims: { closed: false },
            explain: { summary: "Bob's assignment is stale." },
            grace: GRACE,
        });

        const decision = await decided(intent, () => warnedAt(other, ago(8)));

        expect(decision.approved).toEqual([]);
        expect(decision.report.findings).toEqual([
            expect.objectContaining({ code: "warningRequestMismatch" }),
        ]);
    });
});

describe("the screen keeps the two classes apart", () => {
    it("refuses a clock-triggered destructive intent carrying no grace", async () => {
        const decision = await decided(act(null));

        expect(decision.approved).toEqual([]);
        expect(decision.report.findings).toEqual([
            expect.objectContaining({ code: "graceMismatch", severity: "problem" }),
        ]);
    });

    it("refuses grace on an intent whose class would never post it", async () => {
        const comment = make({
            operation: "postManagedComment",
            desired: { kind: "summary", body: "hello" },
            cause: "assignmentWentStale",
            explain: { summary: "Said something." },
            grace: GRACE,
        });

        const decision = await decided(comment);

        expect(decision.approved).toEqual([]);
        expect(decision.report.findings).toEqual([
            expect.objectContaining({ code: "graceMismatch" }),
        ]);
    });

    it("refuses a grace below the platform's floor before any gate is reached", async () => {
        for (const hours of [0, -1]) {
            const decision = await decided(act({ ...GRACE, hours }));

            expect(decision.approved).toEqual([]);
            expect(decision.report.findings).toEqual([
                expect.objectContaining({ code: "graceBelowFloor", severity: "problem" }),
            ]);
        }
    });

    it("refuses a non-finite grace before posting its warning", async () => {
        const decision = await decided(act({ ...GRACE, hours: Number.NaN }));

        expect(decision.approved).toEqual([]);
        expect(decision.report.findings).toEqual([
            expect.objectContaining({ code: "malformedIntent", severity: "problem" }),
        ]);
    });
});
