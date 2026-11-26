/**
 * What assignment decides on a comment. Each row of `design.md`'s Verified-by table
 * that this file proves names its test here by title; each refusal is paired with
 * an input that gets past it.
 */

import { describe, expect, it } from "vitest";
import {
    handleFor,
    projectCapabilityView,
    type Command,
    type Facts,
    type IssueMeaning,
    type MappableMeaning,
    type Projection,
    type ResolverName,
    type ResolverSource,
} from "@hiero-hackers/automation-core";
import {
    commentedIssue,
    configEnabling,
    factsFor,
} from "@hiero-hackers/automation-core/author/testing";
import { assignment, assignmentDeclaration } from "./capability.js";

const AT = new Date("2026-08-03T08:59:00.000Z");

const MAPPINGS = {
    labels: {
        awaitingTriage: "status: triage",
        ready: "status: ready for dev",
        inProgress: "status: in development",
        needsReview: "status: needs review",
        blocked: "status: blocked",
    },
    commands: { assign: "/assign", unassign: "/unassign" },
};

/** Both blocks on, the cap at its default; a test states only what it changes. */
function viewWith(
    autoAssign: Readonly<Record<string, unknown>> = {},
    unassign: Readonly<Record<string, unknown>> = { enabled: true },
    mappings: Readonly<Record<string, unknown>> = MAPPINGS,
) {
    const config = configEnabling(
        ["assignment"],
        [assignmentDeclaration],
        { assignment: { autoAssign: { enabled: true, ...autoAssign }, unassign } },
        mappings,
    );
    return projectCapabilityView(assignmentDeclaration, config);
}

const DEFAULT_VIEW = viewWith();

/** A comment by `by` on an issue standing at `meaning`, perhaps paused. */
function comment(
    issued: Command | null,
    by = "alice",
    state: { readonly meaning?: IssueMeaning | null; readonly blocked?: boolean } = {},
) {
    const position = {
        kind: "position",
        state: { meaning: state.meaning ?? null, blocked: state.blocked ?? false, closedBy: null },
        ignored: [],
    } satisfies Projection<IssueMeaning>;
    return factsFor(
        assignmentDeclaration,
        commentedIssue({ command: { issued, by, at: AT }, position }),
    );
}

type Open = readonly {
    readonly item: { readonly kind: "issue"; readonly number: number };
    readonly meanings: readonly MappableMeaning[];
}[];

/** `n` open assignments elsewhere in this repository, each carrying `meanings`. */
const open = (n: number, meanings: readonly MappableMeaning[] = []): Open =>
    Array.from({ length: n }, (_, i) => ({
        item: { kind: "issue", number: 100 + i },
        meanings,
    }));

interface Script {
    readonly bots?: readonly string[];
    readonly holders?: readonly string[];
    readonly open?: Open;
    readonly failing?: ResolverName;
}

/** The engine's own handle over one record; `asked` is every resolver called, in order. */
function watch(record: Facts, script: Script = {}) {
    const asked: { readonly query: ResolverName; readonly input: unknown }[] = [];
    const source: ResolverSource = async (query, input) => {
        asked.push({ query, input });
        if (query === script.failing) {
            return await Promise.resolve({
                ok: false,
                reason: "unavailable",
                detail: "the list paginated incompletely",
            } as never);
        }
        const value =
            query === "isAutomationActor"
                ? (script.bots ?? []).includes((input as { readonly login: string }).login)
                : query === "assigneesOf"
                  ? (script.holders ?? [])
                  : (script.open ?? []);
        return await Promise.resolve({ ok: true, value } as never);
    };
    const handle = handleFor(assignmentDeclaration, record, source);
    return { platform: handle, handle, queries: () => asked.map(({ query }) => query), asked };
}

async function run(record: Facts, script: Script = {}, view = DEFAULT_VIEW) {
    const watched = watch(record, script);
    const intents = await assignment.evaluate(
        record as Parameters<typeof assignment.evaluate>[0],
        view,
        watched.platform,
    );
    return { intents, ...watched };
}

/** What an evaluation asked for, without the bookkeeping every intent carries. */
const acts = (intents: readonly { readonly operation: string; readonly desired: unknown }[]) =>
    intents.map(({ operation, desired }) => ({ operation, desired }));

type Decided = readonly { readonly operation: string; readonly desired: unknown }[];

interface Notice {
    readonly kind: string;
    readonly topic: string;
    readonly body: string;
}

/** A refusal's own notice, or the one an act carries — posted only once that act lands. */
function noticesIn(intents: Decided): readonly Notice[] {
    return intents.flatMap(({ operation, desired }) => {
        if (operation === "postManagedComment") return [desired as Notice];
        const carried = (desired as { readonly notice?: Omit<Notice, "kind"> }).notice;
        return carried === undefined ? [] : [{ kind: "notice", ...carried }];
    });
}

/** The one managed notice on this issue, its identity asserted: a notice, topic the commenter. */
function noticeOf(intents: Decided, login = "alice") {
    const notices = noticesIn(intents);
    expect(notices).toHaveLength(1);
    const notice = notices[0]!;
    expect({ kind: notice.kind, topic: notice.topic }).toEqual({ kind: "notice", topic: login });
    return notice;
}

/** One act on the commenter, carrying their notice, and nothing beside it. */
function expectAct(intents: Decided, operation: "assign" | "unassign", login: string) {
    expect(acts(intents).map((act) => act.operation)).toEqual([operation]);
    expect((intents[0]!.desired as { readonly login: string }).login).toBe(login);
    return noticeOf(intents, login);
}

/** A claim: the commenter assigned, carrying their notice. */
const expectClaim = (intents: Decided, login = "alice") => expectAct(intents, "assign", login);

/** A release: the commenter unassigned, carrying their notice. */
const expectRelease = (intents: Decided, login = "alice") => expectAct(intents, "unassign", login);

describe("claims, refusals and releases", () => {
    it("`/assign` on an open, claimable issue", async () => {
        const { intents, queries } = await run(comment("assign", "alice", { meaning: "ready" }));

        expect(acts(intents)).toEqual([
            {
                operation: "assign",
                desired: {
                    login: "alice",
                    notice: { topic: "alice", body: expect.any(String) as string },
                },
            },
        ]);
        expect(noticeOf(intents).body).toContain("@alice — you are assigned to this issue");
        // The release is offered in words, never in this repository's spelling.
        expect(noticeOf(intents).body).toContain("this repository's unassign command");
        expect(noticeOf(intents).body).not.toContain("/unassign");
        expect(queries()).toEqual(["isAutomationActor", "assigneesOf", "openAssignments"]);
    });

    it("`/assign` on an issue without the `claimableOnlyWhen` meaning", async () => {
        const view = viewWith({ claimableOnlyWhen: ["ready"] });

        const refused = await run(
            comment("assign", "alice", { meaning: "awaitingTriage" }),
            {},
            view,
        );
        expect(acts(refused.intents).map(({ operation }) => operation)).toEqual([
            "postManagedComment",
        ]);
        expect(noticeOf(refused.intents).body).toContain(
            "only an issue marked `ready` can be claimed",
        );
        // Refused before the cap: nobody counted the commenter's assignments.
        expect(refused.queries()).not.toContain("openAssignments");

        const accepted = await run(comment("assign", "alice", { meaning: "ready" }), {}, view);
        expectClaim(accepted.intents);
    });

    it("`claimableOnlyWhen` is any-of: one listed meaning is enough", async () => {
        const view = viewWith({ claimableOnlyWhen: ["ready", "inProgress"] });

        const { intents } = await run(
            comment("assign", "alice", { meaning: "inProgress" }),
            {},
            view,
        );
        expectClaim(intents);
    });

    it("At the cap, but one assignment sits in `needsReview`", async () => {
        const view = viewWith({ maxOpen: 2, capIgnores: ["needsReview"] });
        const record = comment("assign");

        const ignored = await run(
            record,
            { open: [...open(1), ...open(1, ["needsReview"])] },
            view,
        );
        expectClaim(ignored.intents);

        const counted = await run(record, { open: open(2) }, view);
        expect(acts(counted.intents).map(({ operation }) => operation)).toEqual([
            "postManagedComment",
        ]);
        expect(noticeOf(counted.intents).body).toContain(
            "you already have 2 open assignments, and this repository's limit is 2",
        );
    });

    it("Assigned to a `blocked` issue, `blocked` in `capIgnores`", async () => {
        const record = comment("assign");
        const script = { open: [...open(1), ...open(1, ["blocked"])] };

        const ignoring = await run(
            record,
            script,
            viewWith({ maxOpen: 2, capIgnores: ["blocked"] }),
        );
        expectClaim(ignoring.intents);

        // The meaning-set decides: out of the set, the blocked assignment counts.
        const counting = await run(record, script, viewWith({ maxOpen: 2, capIgnores: [] }));
        expect(acts(counting.intents).map(({ operation }) => operation)).toEqual([
            "postManagedComment",
        ]);
        expect(noticeOf(counting.intents).body).toContain("you already have 2 open assignments");
    });

    it("Maintainer natively assigns someone past the cap", async () => {
        const view = viewWith({ maxOpen: 2 });
        const record = comment("assign");

        // Three open, one of them over the cap by a maintainer's hand: every one counts.
        const refused = await run(record, { open: open(3) }, view);
        expect(noticeOf(refused.intents).body).toContain(
            "you already have 3 open assignments, and this repository's limit is 2",
        );
        expect(acts(refused.intents).some(({ operation }) => operation === "assign")).toBe(false);

        const accepted = await run(record, { open: open(1) }, view);
        expectClaim(accepted.intents);
    });

    it("Issue carrying both `ready` and `blocked`", async () => {
        const view = viewWith({ claimableOnlyWhen: ["ready"], notClaimableWhen: ["blocked"] });

        const denied = await run(
            comment("assign", "alice", { meaning: "ready", blocked: true }),
            {},
            view,
        );
        expect(acts(denied.intents).map(({ operation }) => operation)).toEqual([
            "postManagedComment",
        ]);
        expect(noticeOf(denied.intents).body).toContain(
            "cannot be claimed while it is marked `blocked`",
        );
        expect(denied.queries()).not.toContain("openAssignments");

        const accepted = await run(comment("assign", "alice", { meaning: "ready" }), {}, view);
        expectClaim(accepted.intents);
        // Both acts stand on the deny set still being absent when they apply.
        for (const intent of accepted.intents) {
            expect(intent.claims.meaningsAbsent).toEqual(["blocked"]);
        }
    });

    it("Second `/assign` by the same person", async () => {
        const record = comment("assign");

        // The claim and every refusal share one identity: one notice per person per issue.
        const first = await run(record);
        noticeOf(first.intents);

        const again = await run(record, { holders: ["alice"] });
        expect(again.intents).toEqual([]);
        expect(again.handle.explanations).toEqual([
            {
                capability: "assignment",
                summary: "Skipped: the commenter already holds this issue.",
                detail: ["commenter: alice"],
            },
        ]);
        expect(again.queries()).not.toContain("openAssignments");
    });

    it("A second contributor's `/assign` after the first claim landed", async () => {
        // The loser's evaluation sees the winner already holding it.
        const lost = await run(comment("assign", "alice"), { holders: ["bob"] });
        expect(acts(lost.intents).map(({ operation }) => operation)).toEqual([
            "postManagedComment",
        ]);
        const body = noticeOf(lost.intents).body;
        expect(body).toContain("already assigned to");
        // Named, not pinged: the holder is not mentioned by a refusal meant for the commenter.
        expect(body).not.toContain("@bob");
        expect(body).toContain("@​bob");
        expect(lost.queries()).not.toContain("openAssignments");

        const won = await run(comment("assign", "alice"), { holders: [] });
        expectClaim(won.intents);
    });

    it("`/assign` by a bot", async () => {
        const bot = await run(comment("assign", "renovate[bot]"), { bots: ["renovate[bot]"] });
        expect(bot.intents).toEqual([]);
        expect(bot.handle.explanations).toEqual([]);
        expect(bot.queries()).toEqual(["isAutomationActor"]);

        const person = await run(comment("assign", "alice"), { bots: ["renovate[bot]"] });
        expectClaim(person.intents);
    });

    it("A count or holder list nobody could answer", async () => {
        const record = comment("assign");
        const { platform, handle } = watch(record, { failing: "openAssignments" });

        await expect(
            assignment.evaluate(
                record as Parameters<typeof assignment.evaluate>[0],
                DEFAULT_VIEW,
                platform,
            ),
        ).rejects.toBeDefined();
        // Unknown is not under the cap: the evaluation ends, and nothing is assigned.
        expect(handle.skipped).toBe(true);
        expect(handle.explanations[0]?.summary).toBe(
            "Skipped: the openAssignments resolver could not answer.",
        );
    });

    it("an ordinary comment issues nothing, and asks nothing", async () => {
        const { intents, queries, handle } = await run(comment(null));
        expect(intents).toEqual([]);
        expect(queries()).toEqual([]);
        expect(handle.explanations).toEqual([]);
    });

    it("`/unassign` by a non-assignee", async () => {
        const stranger = await run(comment("unassign", "alice"), { holders: ["bob"] });
        expect(stranger.intents).toEqual([]);
        expect(stranger.handle.explanations).toEqual([
            {
                capability: "assignment",
                summary:
                    "Skipped: the commenter is not assigned to this issue, so nothing of theirs was released.",
                detail: ["commenter: alice"],
            },
        ]);

        const holder = await run(comment("unassign", "alice"), { holders: ["alice"] });
        expectRelease(holder.intents);
        expect(noticeOf(holder.intents).body).toContain(
            "@alice claimed this issue and has since been unassigned at their request. The issue is open for anyone to pick up — comment this repository's assign command to claim it again.",
        );
    });

    it("`/unassign` naming someone else", async () => {
        // Whatever the comment says after the word, only the commenter's own claim is released.
        const { intents } = await run(comment("unassign", "alice"), { holders: ["alice", "bob"] });
        expectRelease(intents);
        expect(acts(intents).filter(({ operation }) => operation === "unassign")).toHaveLength(1);
        // Bob still holds it, so it is not offered to anyone.
        expect(noticeOf(intents).body).not.toContain("open for anyone");
    });

    it("A maintainer types `/assign` at the cap", async () => {
        const view = viewWith({ maxOpen: 1 });

        // No role is read: a maintainer at the cap is refused like anyone.
        const refused = await run(comment("assign", "maintainer"), { open: open(1) }, view);
        expect(acts(refused.intents).map(({ operation }) => operation)).toEqual([
            "postManagedComment",
        ]);
        expect(noticeOf(refused.intents, "maintainer").body).toContain(
            "@maintainer — you already have 1 open assignment, and this repository's limit is 1",
        );
        expect(refused.queries()).toEqual(["isAutomationActor", "assigneesOf", "openAssignments"]);

        const accepted = await run(comment("assign", "maintainer"), { open: open(0) }, view);
        expectClaim(accepted.intents, "maintainer");
    });

    it("Contributor with open assignments in a sibling repo", async () => {
        // The count is asked by login alone, of a resolver that answers for this repository (D57).
        const { asked } = await run(comment("assign"));
        expect(asked.find(({ query }) => query === "openAssignments")?.input).toEqual({
            login: "alice",
        });
    });
});

describe("the cap and the commenter", () => {
    it("asks no count when the cap is 0, and assigns past any number held", async () => {
        const { intents, queries } = await run(
            comment("assign"),
            { open: open(50) },
            viewWith({ maxOpen: 0 }),
        );
        expectClaim(intents);
        expect(queries()).not.toContain("openAssignments");
    });

    it("speaks for the commenter, never the delivery's sender", async () => {
        const record = comment("assign", "alice");
        expect(record.actor).toEqual({ login: "actor" });

        const { intents, asked } = await run(record);
        expectClaim(intents);
        expect(asked[0]).toEqual({ query: "isAutomationActor", input: { login: "alice" } });
    });

    it("skips with the dotted path when an enabled block's word is unmapped", async () => {
        const view = viewWith(
            {},
            { enabled: true },
            { labels: MAPPINGS.labels, commands: { assign: "/assign" } },
        );

        const { intents, handle, queries } = await run(comment("assign"), {}, view);
        expect(intents).toEqual([]);
        expect(handle.explanations).toEqual([
            {
                capability: "assignment",
                summary: "Skipped: settings unusable.",
                detail: [
                    "capabilities.assignment.unassign.enabled: the unassign command needs mappings.commands.unassign, and this repository has not mapped it",
                ],
            },
        ]);
        expect(queries()).toEqual([]);
    });

    it("skips every comment while a word is unmapped, one that issues nothing too", async () => {
        const view = viewWith(
            {},
            { enabled: true },
            { labels: MAPPINGS.labels, commands: { assign: "/assign" } },
        );

        const { intents, handle } = await run(comment(null), {}, view);
        expect(intents).toEqual([]);
        expect(handle.explanations.map(({ summary }) => summary)).toEqual([
            "Skipped: settings unusable.",
        ]);
    });

    it("catches an unmapped assign word as well as an unmapped unassign one", async () => {
        const view = viewWith(
            {},
            { enabled: true },
            { labels: MAPPINGS.labels, commands: { unassign: "/unassign" } },
        );

        const { intents, handle, queries } = await run(
            comment("unassign"),
            { holders: ["alice"] },
            view,
        );
        expect(intents).toEqual([]);
        expect(handle.explanations).toEqual([
            {
                capability: "assignment",
                summary: "Skipped: settings unusable.",
                detail: [
                    "capabilities.assignment.autoAssign.enabled: the assign command needs mappings.commands.assign, and this repository has not mapped it",
                ],
            },
        ]);
        expect(queries()).toEqual([]);

        const mapped = await run(comment("unassign"), { holders: ["alice"] });
        expectRelease(mapped.intents);
    });
});

/** Which guard speaks first, where an issue would fail more than one. */
describe("the order of the guards", () => {
    it("denies before it asks for a required meaning", async () => {
        const view = viewWith({
            claimableOnlyWhen: ["ready"],
            notClaimableWhen: ["awaitingTriage"],
        });

        const denied = await run(
            comment("assign", "alice", { meaning: "awaitingTriage" }),
            {},
            view,
        );
        expect(noticeOf(denied.intents).body).toBe(
            "Hi @alice — this issue cannot be claimed while it is marked `awaitingTriage`. It is in the triage queue; once the team marks it ready, it can be claimed.",
        );

        const accepted = await run(comment("assign", "alice", { meaning: "ready" }), {}, view);
        expectClaim(accepted.intents);
    });

    describe("asks who holds the issue before whether it is claimable", () => {
        // `inProgress` fails both claimability guards at once.
        const view = viewWith({ claimableOnlyWhen: ["ready"], notClaimableWhen: ["inProgress"] });
        const unclaimable = comment("assign", "alice", { meaning: "inProgress" });

        it("tells nobody when the commenter already holds it", async () => {
            const held = await run(unclaimable, { holders: ["alice"] }, view);
            expect(held.intents).toEqual([]);
            expect(held.handle.explanations[0]?.summary).toBe(
                "Skipped: the commenter already holds this issue.",
            );
        });

        it("tells the commenter it is already claimed when someone else holds it", async () => {
            const taken = await run(unclaimable, { holders: ["bob"] }, view);
            expect(noticeOf(taken.intents).body).toBe(
                "Hi @alice — this issue is already assigned to @\u200bbob, so it cannot be claimed. It can be claimed again once it is released.",
            );

            const free = await run(unclaimable, { holders: [] }, view);
            expect(noticeOf(free.intents).body).toContain("cannot be claimed while it is marked");
        });
    });
});

/** Each block's switch, the unmapped-word guard, a login's case, and the lists a refusal names. */
describe("the switches, the guard and the lists", () => {
    const assignOnly = { labels: MAPPINGS.labels, commands: { assign: "/assign" } };

    it("does nothing, and asks nothing, while autoAssign is off", async () => {
        const off = await run(comment("assign"), {}, viewWith({ enabled: false }));
        expect(off.intents).toEqual([]);
        expect(off.queries()).toEqual([]);
        expect(off.handle.explanations).toEqual([]);

        const on = await run(comment("assign"), {}, viewWith());
        expectClaim(on.intents);
    });

    it("does nothing, and asks nothing, while unassign is off", async () => {
        const record = comment("unassign");
        const off = await run(record, { holders: ["alice"] }, viewWith({}, { enabled: false }));
        expect(off.intents).toEqual([]);
        expect(off.queries()).toEqual([]);
        expect(off.handle.explanations).toEqual([]);

        const on = await run(record, { holders: ["alice"] }, viewWith());
        expectRelease(on.intents);
    });

    it("tells a commenter refused at the gate what comes next, on either refusal", async () => {
        const next = "It is in the triage queue; once the team marks it ready, it can be claimed.";
        const atGate = comment("assign", "alice", { meaning: "awaitingTriage" });

        const notYet = await run(atGate, {}, viewWith({ claimableOnlyWhen: ["ready"] }));
        expect(noticeOf(notYet.intents).body).toBe(
            `Hi @alice — only an issue marked \`ready\` can be claimed in this repository, and this one is not yet. ${next}`,
        );

        const elsewhere = await run(
            comment("assign"),
            {},
            viewWith({ claimableOnlyWhen: ["ready"] }),
        );
        expect(noticeOf(elsewhere.intents).body).not.toContain("triage queue");

        const paused = await run(
            comment("assign", "alice", { meaning: "ready", blocked: true }),
            {},
            viewWith({ notClaimableWhen: ["blocked", "awaitingTriage"] }),
        );
        expect(noticeOf(paused.intents).body).toBe(
            "Hi @alice — this issue cannot be claimed while it is marked `blocked`. It can be claimed once that changes.",
        );
    });

    it("names three required meanings as `a`, `b` or `c`", async () => {
        const view = viewWith({ claimableOnlyWhen: ["ready", "inProgress", "awaitingTriage"] });

        const refused = await run(comment("assign"), {}, view);
        expect(noticeOf(refused.intents).body).toBe(
            "Hi @alice — only an issue marked `ready`, `inProgress` or `awaitingTriage` can be claimed in this repository, and this one is not yet. It can be claimed once it is.",
        );

        const accepted = await run(
            comment("assign", "alice", { meaning: "awaitingTriage" }),
            {},
            view,
        );
        expectClaim(accepted.intents);
    });

    it("names every holder of the issue, and pings none of them", async () => {
        const refused = await run(comment("assign"), { holders: ["bob", "carol", "dave"] });
        expect(noticeOf(refused.intents).body).toBe(
            "Hi @alice — this issue is already assigned to @\u200bbob, @\u200bcarol, @\u200bdave, so it cannot be claimed. It can be claimed again once it is released.",
        );

        const accepted = await run(comment("assign"), { holders: [] });
        expectClaim(accepted.intents);
    });

    it("assigns nobody when the holders cannot be read", async () => {
        const record = comment("assign");
        const { platform, handle, queries } = watch(record, { failing: "assigneesOf" });

        await expect(
            assignment.evaluate(
                record as Parameters<typeof assignment.evaluate>[0],
                DEFAULT_VIEW,
                platform,
            ),
        ).rejects.toBeDefined();
        // Unknown is not "nobody holds it": the evaluation ends before claimability or the cap.
        expect(handle.skipped).toBe(true);
        expect(handle.explanations[0]?.summary).toBe(
            "Skipped: the assigneesOf resolver could not answer.",
        );
        expect(queries()).toEqual(["isAutomationActor", "assigneesOf"]);
    });

    it("demands no word of a block that is switched off", async () => {
        const off = await run(comment("assign"), {}, viewWith({}, { enabled: false }, assignOnly));
        expectClaim(off.intents);
        expect(off.handle.explanations).toEqual([]);

        const on = await run(comment("assign"), {}, viewWith({}, { enabled: true }, assignOnly));
        expect(on.intents).toEqual([]);
    });

    it("offers the release only where the unassign block is on", async () => {
        const quiet = viewWith({ maxOpen: 1 }, { enabled: false });
        const claimedQuietly = await run(comment("assign"), {}, quiet);
        expect(noticeOf(claimedQuietly.intents).body).not.toContain("unassign");
        const cappedQuietly = await run(comment("assign"), { open: open(1) }, quiet);
        expect(noticeOf(cappedQuietly.intents).body).not.toContain("unassign");

        const offering = viewWith({ maxOpen: 1 });
        const claimed = await run(comment("assign"), {}, offering);
        expect(noticeOf(claimed.intents).body).toContain("this repository's unassign command");
        const capped = await run(comment("assign"), { open: open(1) }, offering);
        expect(noticeOf(capped.intents).body).toContain(
            "Release one with this repository's unassign command",
        );
    });

    it("tells a capped commenter with no release command what frees a claim", async () => {
        const quiet = viewWith({ maxOpen: 1 }, { enabled: false });
        const capped = await run(comment("assign"), { open: open(1) }, quiet);

        expect(noticeOf(capped.intents).body).toContain(
            "Once one of them is closed, you can claim this issue.",
        );
    });

    it("offers the claim back after a release only where claims are on", async () => {
        const releasing = await run(comment("unassign", "alice"), { holders: ["alice"] });
        expect(noticeOf(releasing.intents).body).toContain("assign command to claim it again");

        const claimsOff = viewWith({ enabled: false });
        const quiet = await run(comment("unassign", "alice"), { holders: ["alice"] }, claimsOff);
        expect(noticeOf(quiet.intents).body).not.toContain("claim it again");
    });

    it("reads a login the same whatever its case", async () => {
        const held = await run(comment("assign", "alice"), { holders: ["Alice"] });
        expect(held.intents).toEqual([]);
        expect(held.handle.explanations[0]?.summary).toBe(
            "Skipped: the commenter already holds this issue.",
        );

        const released = await run(comment("unassign", "alice"), { holders: ["Alice"] });
        expectRelease(released.intents);
        expect(noticeOf(released.intents).body).toContain("open for anyone");
    });

    it("`/unassign` by a bot", async () => {
        const bot = await run(comment("unassign", "renovate[bot]"), {
            bots: ["renovate[bot]"],
            holders: ["renovate[bot]"],
        });
        expect(bot.intents).toEqual([]);
        expect(bot.handle.explanations).toEqual([]);
        expect(bot.queries()).toEqual(["isAutomationActor"]);

        const person = await run(comment("unassign", "alice"), {
            bots: ["renovate[bot]"],
            holders: ["alice"],
        });
        expectRelease(person.intents);
    });

    it("names two denying meanings as `a` and `b`", async () => {
        const view = viewWith({ notClaimableWhen: ["blocked", "awaitingTriage"] });

        const refused = await run(
            comment("assign", "alice", { meaning: "awaitingTriage", blocked: true }),
            {},
            view,
        );
        expect(noticeOf(refused.intents).body).toBe(
            "Hi @alice — this issue cannot be claimed while it is marked `blocked` and `awaitingTriage`. It is in the triage queue; once the team marks it ready, it can be claimed.",
        );

        const accepted = await run(comment("assign", "alice", { meaning: "ready" }), {}, view);
        expectClaim(accepted.intents);
    });

    it("claims nothing absent on any refusal, and the deny set on a claim", async () => {
        const view = viewWith({
            claimableOnlyWhen: ["ready", "awaitingTriage"],
            notClaimableWhen: ["awaitingTriage"],
            maxOpen: 1,
        });
        const ready = comment("assign", "alice", { meaning: "ready" });

        const refusals = [
            await run(ready, { holders: ["bob"] }, view),
            await run(comment("assign", "alice", { meaning: "awaitingTriage" }), {}, view),
            await run(comment("assign", "alice", { meaning: "inProgress" }), {}, view),
            await run(ready, { open: open(1) }, view),
        ];
        // One of each refusal: already claimed, denied, not yet claimable, at the cap.
        expect(new Set(refusals.map(({ intents }) => noticeOf(intents).body)).size).toBe(4);
        for (const { intents } of refusals) {
            expect(intents.map(({ claims }) => claims.meaningsAbsent)).toEqual([[]]);
        }

        const accepted = await run(ready, {}, view);
        expectClaim(accepted.intents);
        expect(accepted.intents.map(({ claims }) => claims.meaningsAbsent)).toEqual([
            ["awaitingTriage"],
        ]);
    });
});
