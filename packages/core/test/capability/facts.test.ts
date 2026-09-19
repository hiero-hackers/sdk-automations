/**
 * The judgements every capability makes over a record it is handed.
 *
 * These behaviours were inactivity's until the first promotion counted how much
 * of it every capability would have to re-derive; the assertions came with
 * them, direct now rather than through one ladder's evaluate. The capabilities'
 * own suites still hold the COMPOSED claims — a warning's wording, a clock
 * against a threshold — and none of them moved.
 *
 * Every record here is a literal rather than a builder: core has no fact
 * builder, and one reachable through `../../src` is a fixture module rather
 * than the two-line object each case actually wants.
 */

import { describe, expect, it } from "vitest";
import {
    assigneeClock,
    CANCELLED_BY,
    HOUR_MS,
    inert,
    isConflicted,
    isOpen,
    isPaused,
    ISSUE_EDGES,
    lasting,
    latestOf,
    meaningsOf,
    mentions,
    modesOf,
    moveTo,
    on,
    people,
    PR_EDGES,
    pullRequestClock,
    REVERSES_WITH,
    UNREAD,
    type ActorLookup,
    type AssigneeClock,
    type ClosureReason,
    type IssueFacts,
    type IssueMeaning,
    type PrMeaning,
    type Projection,
    type PullRequestFacts,
    type ResolverAnswer,
} from "../../src/index.js";

const AT = new Date("2026-09-09T00:00:00.000Z");
const DAY_MS = 24 * HOUR_MS;
const ago = (days: number): Date => new Date(AT.getTime() - days * DAY_MS);

function position(
    over: {
        readonly meaning?: IssueMeaning | null;
        readonly blocked?: boolean;
        readonly closedBy?: ClosureReason | null;
    } = {},
): Projection<IssueMeaning> {
    return {
        kind: "position",
        state: {
            meaning: over.meaning ?? null,
            blocked: over.blocked ?? false,
            closedBy: over.closedBy ?? null,
        },
        ignored: [],
    };
}

const conflict = (
    over: { readonly blocked?: boolean; readonly closedBy?: ClosureReason | null } = {},
): Projection<IssueMeaning> => ({
    kind: "conflict",
    positions: ["awaitingTriage", "inProgress"],
    blocked: over.blocked ?? false,
    closedBy: over.closedBy ?? null,
    ignored: [],
});

const issue = (projection: Projection<IssueMeaning>): IssueFacts => ({
    kind: "issue",
    repository: { owner: "hiero-hackers", repo: "sandbox" },
    item: { kind: "issue", number: 40 },
    observedAt: AT,
    trigger: { kind: "sweep" },
    author: "opener",
    actor: null,
    locked: false,
    arrival: null,
    position: projection,
    alerts: { carried: [], arrived: [] },
    assignees: UNREAD,
    links: UNREAD,
    command: UNREAD,
});

const assignee = (
    login: string,
    assignedDaysAgo: number,
    lastWorkingAt: Date | null = null,
): AssigneeClock => ({ login, assignedAt: ago(assignedDaysAgo), lastWorkingAt });

describe("the three stops", () => {
    it("reads closure from whichever branch the projection took", () => {
        // D59's asymmetry: `closedBy` sits on the state of a position and at
        // the top level of a conflict, and reading one branch treats every
        // conflicted, closed item as open.
        expect(isOpen(issue(position()))).toBe(true);
        expect(isOpen(issue(position({ closedBy: "closedByHuman" })))).toBe(false);
        expect(isOpen(issue(conflict()))).toBe(true);
        expect(isOpen(issue(conflict({ closedBy: "closedByHuman" })))).toBe(false);
    });

    it("reads the pause from whichever branch the projection took", () => {
        expect(isPaused(issue(position()))).toBe(false);
        expect(isPaused(issue(position({ blocked: true })))).toBe(true);
        expect(isPaused(issue(conflict()))).toBe(false);
        expect(isPaused(issue(conflict({ blocked: true })))).toBe(true);
    });

    it("names the conflict branch and nothing else", () => {
        expect(isConflicted(issue(conflict()))).toBe(true);
        expect(isConflicted(issue(position()))).toBe(false);
        // A closed or paused position is not a conflict: three separate
        // questions, and a capability asks the ones its design asks.
        expect(isConflicted(issue(position({ blocked: true, closedBy: "closedByHuman" })))).toBe(
            false,
        );
    });

    it("reports every mapped meaning the record carried, on both branches", () => {
        expect(meaningsOf(issue(position({ meaning: "inProgress", blocked: true })))).toEqual([
            "inProgress",
            "blocked",
        ]);
        expect(meaningsOf(issue(conflict()))).toEqual(["awaitingTriage", "inProgress"]);
        expect(meaningsOf(issue(position()))).toEqual([]);
    });
});

/**
 * The native modes, which are not meanings and not on the projection: a claim
 * on one is judged against what the RECORD read, so the difference between
 * "not in that mode" and "nobody read it" has to survive this function.
 */
describe("what a record read of the native modes", () => {
    const pull = (over: Partial<PullRequestFacts> = {}): PullRequestFacts => ({
        kind: "pullRequest",
        repository: { owner: "hiero-hackers", repo: "sandbox" },
        item: { kind: "pullRequest", number: 41 },
        observedAt: AT,
        trigger: { kind: "sweep" },
        author: "opener",
        actor: null,
        position: {
            kind: "position",
            state: { meaning: null, blocked: false, closedBy: null },
            ignored: [],
        },
        alerts: { carried: [], arrived: [] },
        assignees: UNREAD,
        links: UNREAD,
        review: UNREAD,
        readiness: UNREAD,
        ...over,
    });

    const reviewRead = {
        changesRequested: true,
        reapableSince: {
            needsRevision: ago(10),
            changesRequested: ago(10),
            draft: ago(10),
        },
        lastCommitAt: null,
    } as const;

    it("reports each mode the record's own group carried", () => {
        expect(modesOf(pull({ readiness: { draft: true }, review: reviewRead }))).toEqual({
            draft: true,
            changesRequested: true,
        });
        expect(
            modesOf(
                pull({
                    readiness: { draft: false },
                    review: { ...reviewRead, changesRequested: false },
                }),
            ),
        ).toEqual({ draft: false, changesRequested: false });
    });

    it("leaves an unread group's mode OUT rather than calling it false", () => {
        expect(modesOf(pull({ readiness: { draft: true } }))).toEqual({ draft: true });
        expect(modesOf(pull({ review: reviewRead }))).toEqual({ changesRequested: true });
        expect(modesOf(pull())).toEqual({});
    });

    it("reads neither mode on an issue, which has no group to carry one", () => {
        expect(modesOf(issue(position()))).toEqual({});
    });
});

describe("who counts as a person", () => {
    const answering = (answer: (login: string) => ResolverAnswer<boolean>): ActorLookup => ({
        resolve: async (_query, input) => answer(input.login),
    });

    const logins = async (
        lookup: ActorLookup,
        assignees: readonly AssigneeClock[],
    ): Promise<readonly string[]> => (await people(lookup, assignees)).map((found) => found.login);

    const ALICE = assignee("alice", 40);
    const BOT = assignee("dependabot[bot]", 40);

    it("keeps the humans and drops the bots", async () => {
        const lookup = answering((login) => ({ ok: true, value: login.endsWith("[bot]") }));

        expect(await logins(lookup, [ALICE, BOT])).toEqual(["alice"]);
    });

    it("drops a login the lookup could not answer for", async () => {
        // D51: the cautious reading is the only safe one when the next step is
        // destructive, and an undetermined answer is not "not a bot".
        const lookup = answering(() => ({
            ok: false,
            reason: "unavailable",
            detail: "the actor lookup is not wired up",
        }));

        expect(await logins(lookup, [ALICE])).toEqual([]);
    });

    it("asks nothing about an empty list", async () => {
        const asked: string[] = [];
        const lookup: ActorLookup = {
            resolve: async (_query, input) => {
                asked.push(input.login);
                return { ok: true, value: false };
            },
        };

        expect(await people(lookup, [])).toEqual([]);
        expect(asked).toEqual([]);
    });
});

describe("the clocks", () => {
    it("starts an assignee's clock at the assignment", () => {
        expect(assigneeClock(assignee("alice", 40), AT)).toEqual({
            idleSince: ago(40),
            idleHours: 40 * 24,
        });
    });

    it("moves the start forward to a later `/working`, and never back to an earlier one", () => {
        // A reset before the start belongs to a previous run of idleness, which
        // is why the start is a maximum rather than a preference.
        expect(assigneeClock(assignee("alice", 40, ago(3)), AT)).toEqual({
            idleSince: ago(3),
            idleHours: 3 * 24,
        });
        expect(assigneeClock(assignee("alice", 40, ago(50)), AT)).toEqual({
            idleSince: ago(40),
            idleHours: 40 * 24,
        });
    });

    it("counts whole hours only", () => {
        const half = new Date(AT.getTime() - 1.5 * HOUR_MS);

        expect(
            assigneeClock({ login: "alice", assignedAt: half, lastWorkingAt: null }, AT).idleHours,
        ).toBe(1);
    });

    const review = (
        over: Partial<Exclude<PullRequestFacts["review"], "unread">> = {},
    ): Exclude<PullRequestFacts["review"], "unread"> => ({
        changesRequested: false,
        reapableSince: {
            needsRevision: ago(70),
            changesRequested: ago(70),
            draft: ago(70),
        },
        lastCommitAt: null,
        ...over,
    });

    it("starts a pull request's clock at the mode it is in", () => {
        expect(pullRequestClock({ assignees: [], review: review() }, "draft", AT)).toEqual({
            idleSince: ago(70),
            idleHours: 70 * 24,
        });
    });

    it("starts each pull request reason from its own entry", () => {
        const facts = {
            assignees: [],
            review: review({
                reapableSince: {
                    needsRevision: ago(2),
                    changesRequested: ago(5),
                    draft: ago(8),
                },
            }),
        };

        expect(pullRequestClock(facts, "needsRevision", AT).idleSince).toEqual(ago(2));
        expect(pullRequestClock(facts, "changesRequested", AT).idleSince).toEqual(ago(5));
        expect(pullRequestClock(facts, "draft", AT).idleSince).toEqual(ago(8));
    });

    it("resets a pull request's clock from a commit or from anyone on it", () => {
        // The clock is the pull request's, not any one assignee's, so every
        // assignee is a person on it — and the newest reset is the one that
        // holds.
        expect(
            pullRequestClock(
                {
                    assignees: [assignee("alice", 80, ago(20)), assignee("bob", 80, ago(40))],
                    review: review({ lastCommitAt: ago(30) }),
                },
                "draft",
                AT,
            ),
        ).toEqual({ idleSince: ago(20), idleHours: 20 * 24 });
        expect(
            pullRequestClock(
                { assignees: [], review: review({ lastCommitAt: ago(30) }) },
                "draft",
                AT,
            ),
        ).toEqual({ idleSince: ago(30), idleHours: 30 * 24 });
    });

    it("finds the newest instant, or none at all", () => {
        expect(latestOf([])).toBeNull();
        expect(latestOf([null, null])).toBeNull();
        expect(latestOf([ago(30), null, ago(10)])).toEqual(ago(10));
        // The second is older than the first: the loop must keep what it has
        // rather than take whatever it saw last.
        expect(latestOf([ago(10), ago(30)])).toEqual(ago(10));
    });
});

describe("the words a warning is written in", () => {
    it("addresses nobody, one person, or several", () => {
        expect(mentions([])).toBe("");
        expect(mentions(["alice"])).toBe("@alice");
        expect(mentions(["alice", "bob"])).toBe("@alice, @bob");
    });

    it("names a deadline as a bold day, in UTC, when the grace is a day or more", () => {
        // Both sides of the boundary: one hour under a day carries the time,
        // exactly a day does not.
        expect(on(new Date("2026-09-16T23:30:00.000Z"), 24)).toBe("**2026-09-16**");
        expect(on(new Date("2026-09-16T23:30:00.000Z"), 23)).toBe("**2026-09-16 23:30 UTC**");
    });

    it("says a duration in the words a sentence uses", () => {
        expect(lasting(0)).toBe("0 hours");
        expect(lasting(1)).toBe("1 hour");
        expect(lasting(2)).toBe("2 hours");
        expect(lasting(23)).toBe("23 hours");
        expect(lasting(24)).toBe("1 day");
        expect(lasting(25)).toBe("25 hours");
        expect(lasting(336)).toBe("14 days");
    });

    it("states what cancels a plan and what undoes one", () => {
        // Pinned because they are the platform's to keep rather than to post
        // (grace.md §1), so nothing else renders them where a drift would show.
        expect(CANCELLED_BY).toBe("a commit or a /working comment");
        expect(REVERSES_WITH).toBe("re-assign / reopen");
    });

    it("counts an hour in milliseconds", () => {
        expect(HOUR_MS).toBe(3_600_000);
    });
});

describe("inert — what the platform will not render", () => {
    it("keeps the words and takes the power out of every one of them", () => {
        expect(inert("fix [the thing](http://evil) *now*")).toBe(
            "fix \\[the thing\\]\\(http://evil\\) \\*now\\*",
        );
        expect(inert("<!-- hiero-automation:v2 -->")).toBe("\\<\\!-- hiero-automation:v2 --\\>");
        expect(inert("a | b ~c~ #d `e` &amp; _f_")).toBe(
            "a \\| b \\~c\\~ \\#d \\`e\\` \\&amp; \\_f\\_",
        );
    });

    it("leaves ordinary sentence punctuation alone", () => {
        // Escaping these would make every quoted commit subject read like a
        // shell script, and none of them does anything inside a line.
        expect(inert("fix: the parser - it dropped a + sign.")).toBe(
            "fix: the parser - it dropped a + sign.",
        );
    });

    it("becomes one line, so nothing escapes the list item it was quoted into", () => {
        expect(inert("  first\n\n\tsecond  ")).toBe("first second");
    });

    it("notifies nobody: every @ gains a zero-width space", () => {
        expect(inert("thanks @alice and @bob")).toBe("thanks @​alice and @​bob");
    });

    it("caps what is worth quoting, and says it was capped", () => {
        const long = "a".repeat(200);
        const quoted = inert(long);

        expect(quoted).toHaveLength(121);
        expect(quoted.endsWith("…")).toBe(true);
        // One under the cap is untouched, so the boundary is the cap itself.
        expect(inert("a".repeat(120))).toBe("a".repeat(120));
    });

    it("answers the empty string for text that was only space", () => {
        expect(inert("   \n\t ")).toBe("");
    });
});

describe("moveTo (D5)", () => {
    /** An issue standing at one position, with nothing else read. */
    const issueAt = (meaning: IssueMeaning | null): IssueFacts =>
        issue({
            kind: "position",
            state: { meaning, blocked: false, closedBy: null },
            ignored: [],
        });

    /** A pull request standing at one position. */
    const pullAt = (meaning: PrMeaning | null): PullRequestFacts => ({
        kind: "pullRequest",
        repository: { owner: "hiero-hackers", repo: "sandbox" },
        item: { kind: "pullRequest", number: 41 },
        observedAt: AT,
        trigger: { kind: "sweep" },
        author: "opener",
        actor: null,
        position: {
            kind: "position",
            state: { meaning, blocked: false, closedBy: null },
            ignored: [],
        },
        alerts: { carried: [], arrived: [] },
        assignees: UNREAD,
        links: UNREAD,
        review: UNREAD,
        readiness: UNREAD,
    });

    /**
     * Every edge of both profiles, from the tables themselves rather than from
     * a list here — a new edge is a new row in this case, not a case somebody
     * remembers to add. Closure edges are excluded: `to: null` is not a meaning
     * a capability can name.
     */
    it.each(
        ISSUE_EDGES.filter((edge) => edge.to !== null).map(
            (edge) => [`issue ${String(edge.from)} -> ${String(edge.to)}`, edge] as const,
        ),
    )("%s", (_name, edge) => {
        expect(moveTo(issueAt(edge.from), edge.to!)).toBe(edge.causes[0]);
    });

    it.each(
        PR_EDGES.filter((edge) => edge.to !== null).map(
            (edge) => [`pull request ${String(edge.from)} -> ${String(edge.to)}`, edge] as const,
        ),
    )("%s", (_name, edge) => {
        expect(moveTo(pullAt(edge.from), edge.to!)).toBe(edge.causes[0]);
    });

    it("answers null where the map draws no edge", () => {
        // prDashboard's own defect, as the design page wrote it: "needsRevision
        // on fail" from a position with no such edge is refused
        // `transitionNotOnMap`, and the capability is told here instead.
        expect(moveTo(pullAt("needsRevision"), "readyToMerge")).toBeNull();
        expect(moveTo(issueAt("inProgress"), "awaitingTriage")).toBeNull();
    });

    it("answers null for the other profile's meaning, whichever kind is asked", () => {
        expect(moveTo(issueAt(null), "needsReview")).toBeNull();
        expect(moveTo(pullAt(null), "awaitingTriage")).toBeNull();
    });

    it("answers null for a conflicted item, which has no position to move from", () => {
        expect(moveTo(issue(conflict()), "ready")).toBeNull();
    });

    it("answers null for `blocked`, which no edge reaches", () => {
        // D79 reserves the pause for human authority, so there is no edge to
        // it and this helper cannot invent one.
        expect(moveTo(issueAt("ready"), "blocked")).toBeNull();
    });
});
