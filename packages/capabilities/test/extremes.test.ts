/**
 * The file a maintainer writes at 11pm: extreme values, contradictions, and
 * everything on at once, against the SHIPPED specs and through `decide()`.
 *
 * Every other suite here builds a block the capability can read. This one
 * builds the blocks a real repository writes when it is trying to say
 * "immediately", "never" or "all of it", and records what the platform does
 * with each — so the answers stay answers rather than folklore.
 *
 * Three kinds of row, kept apart on purpose:
 *  - a file the parser REFUSES with a message at the right path is the
 *    platform working, and the row pins the path and the wording a maintainer
 *    acts on;
 *  - a file it ACCEPTS is pinned by what the engine then does with it, because
 *    an accepted file that surprises its author is the defect this suite is
 *    for;
 *  - a thing a maintainer plausibly wants and cannot spell is neither, and is
 *    written down in `packages/capabilities/src/inactivity/design.md` rather
 *    than invented here.
 *
 * `inactivity` is the subject of most of it because it is the one shipped
 * capability with clocks, a cascade, a relation between two keys and a
 * destructive act at the end of them.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
    decide,
    MAX_CLOCK_HOURS,
    MIN_GRACE_HOURS,
    MIN_REAP_HOURS,
    parseConfig,
    parseConfigDocument,
    type ConfigError,
    type Decision,
    type Effect,
    type Externals,
    type Facts,
    type Finding,
    type RepositoryConfig,
} from "@hiero-hackers/automation-core";
import { CAPABILITIES } from "../src/index.js";
import {
    configEnabling,
    sweptIssue,
    sweptPullRequest,
    webhookIssue,
    webhookPullRequest,
} from "@hiero-hackers/automation-core/author/testing";

const ALL = CAPABILITIES;
const NAMES = CAPABILITIES.map(({ declaration }) => declaration.name);
const DECLARATIONS = CAPABILITIES.map(({ declaration }) => declaration);

/** Every meaning a shipped block names, so no block is unusable for want of one. */
const MAPPINGS = {
    labels: {
        awaitingTriage: "status: triage",
        inProgress: "status: in progress",
        blocked: "blocked",
        needsRevision: "status: needs revision",
    },
};

/** The externals the engine matrix runs on, answered in each name's own shape. */
const externals: Externals = {
    killSwitchActive: false,
    installationGrants: ["issues:write"],
    latestHumanChangeAt: () => null,
    resolve: async (query) => {
        if (query === "linkedIssues") return { ok: true, value: [] } as never;
        if (query === "configAtHead") return { ok: true, value: { touched: false } } as never;
        return { ok: true, value: false } as never;
    },
};

/** One assignee, idle since well before every fixture's observation. */
const CONTRIBUTOR = [
    {
        login: "contributor",
        assignedAt: new Date("2026-07-01T00:00:00.000Z"),
        lastWorkingAt: null,
    },
];

const staleIssue = (): Facts => sweptIssue({ assignees: CONTRIBUTOR });

// ─── The parser, against the shipped inactivity spec ─────────────────

/** One inactivity block, offered to the parser in a file that maps everything. */
function readBlock(block: Readonly<Record<string, unknown>>): ConfigResultOf {
    const result = parseConfig(
        {
            schemaVersion: 2,
            mode: "active",
            capabilities: { inactivity: { enabled: true, ...block } },
            mappings: MAPPINGS,
        },
        { revision: "rev-extremes", knownCapabilities: DECLARATIONS },
    );
    return result.ok
        ? { settings: result.config.capabilities.inactivity?.settings ?? {}, errors: [] }
        : { settings: null, errors: result.errors };
}

/** What one block came back as: the resolved settings, or the errors instead. */
interface ConfigResultOf {
    readonly settings: Readonly<Record<string, unknown>> | null;
    readonly errors: readonly ConfigError[];
}

/** Each error as `path: message`, which is the pair a maintainer acts on. */
const said = ({ errors }: ConfigResultOf): string[] =>
    errors.map((error) => `${String(error.path)} :: ${error.message}`);

describe("the ladder at its limits", () => {
    /**
     * Both floors are judged on the level that CONSENTS, so every row that
     * exercises one writes its release inside the `issues` ladder's own block:
     * the root's `reap.after` is a default nobody acts on, and a default has
     * nothing to refuse.
     */
    const onIssues = (remindAfter: string, after: string) => ({
        remindAfter,
        issues: { enabled: true, reap: { enabled: true, after } },
    });

    /** The path every one of those refusals is reported at. */
    const ISSUES_REAP = "capabilities.inactivity.issues.reap.after";

    /**
     * The fastest legal ladder. `remindAfter: 0h` warns on first sight and
     * `reap.after: 2h` is the platform's smallest reap, which is also more
     * than `MIN_GRACE_HOURS` above it — so the fastest file a repository may
     * state is exactly what `safety/destructive.ts` will act on.
     */
    it("remind at 0h and reap at 2h is legal, and is the floor", () => {
        const read = readBlock(onIssues("0h", "2h"));
        expect(said(read)).toEqual([]);
        expect(read.settings).toMatchObject({
            remindAfter: 0,
            issues: { remindAfter: 0, reap: { enabled: true, after: 2 } },
        });
        expect([MIN_GRACE_HOURS, MIN_REAP_HOURS]).toEqual([1, 2]);
    });

    /**
     * One hour is above the grace floor and below the reap floor, so it is the
     * row that tells the two floors apart: the message names the reap floor,
     * because that is the rule the clock broke.
     */
    it("a one-hour reap is refused by the smallest reap, not by the gap", () => {
        const read = readBlock(onIssues("0h", "1h"));
        expect(said(read)).toEqual([`${ISSUES_REAP} :: ${ISSUES_REAP}: must be at least 2h`]);
        expect(read.errors.map((error) => error.code)).toEqual(["settingInvalid"]);
    });

    /**
     * Zero gap, at the smallest reap the platform allows. The message has to
     * name both fields and the floor, because the fix is a choice between
     * raising one and lowering the other and the maintainer cannot make it
     * from the path alone.
     */
    it("remind at 2h and reap at 2h is refused, naming both clocks and the floor", () => {
        const read = readBlock(onIssues("2h", "2h"));
        expect(said(read)).toEqual([
            `${ISSUES_REAP} :: ${ISSUES_REAP}: must be at least 1h above remindAfter (2h)`,
        ]);
        expect(read.errors.map((error) => error.code)).toEqual(["settingInvalid"]);
    });

    it("reaping before reminding is refused at the clock that is wrong", () => {
        const read = readBlock(onIssues("14d", "1d"));
        expect(said(read)).toEqual([
            `${ISSUES_REAP} :: ${ISSUES_REAP}: must be at least 1h above remindAfter (14d)`,
        ]);
    });

    /**
     * The consequence of both floors living on the level that consents: a
     * reminder LONGER than the release clock the root offers is a file about
     * reminders. Nothing here consents to reap, so the `21d` default is a
     * number waiting for a taker rather than a promise to break, and the file
     * means "remind at 30d, release never" — which is a thing to want.
     */
    it("a reminder past the default release parses while nothing consents to reap", () => {
        const read = readBlock({ remindAfter: "30d" });
        expect(said(read)).toEqual([]);
        expect(read.settings).toMatchObject({ remindAfter: 30 * 24, reap: { after: 21 * 24 } });
    });

    /**
     * The same file the moment a ladder says yes to that same default. `21d`
     * is now a clock something will act on, and it would release nine days
     * before the reminder it is meant to follow — so it is refused at the
     * LADDER's path, where the consent is, and not at the root that merely
     * offered the number.
     */
    it("the same default is refused the moment a ladder consents to it", () => {
        const read = readBlock({
            remindAfter: "30d",
            issues: { enabled: true, reap: { enabled: true } },
        });
        expect(said(read)).toEqual([
            `${ISSUES_REAP} :: ${ISSUES_REAP}: must be at least 1h above remindAfter (30d)`,
        ]);
        expect(read.errors.map((error) => error.code)).toEqual(["settingInvalid"]);
    });

    /**
     * The ceiling, and the file that earned it: `reapAfter: 2147483647` parsed
     * under the name this clock had then, and `inactivity` failed on every
     * delivery with `Invalid time value`, because the date its warning names
     * landed outside the range a `Date` holds. The refusal is now at the
     * maintainer's own path, with the rest of their file.
     */
    it.each([
        ["the largest 32-bit integer, in days", "2147483647d"],
        ["one day past a century", "36501d"],
        ["one hour past a century", `${String(MAX_CLOCK_HOURS + 1)}h`],
    ])("a reap clock of %s is refused", (_why, value) => {
        expect(said(readBlock({ remindAfter: "14d", reap: { after: value } }))).toEqual([
            "capabilities.inactivity.reap.after :: capabilities.inactivity.reap.after:" +
                " must be at most 36500d",
        ]);
    });

    it("a century is legal, and the clocks either side of it are not", () => {
        expect(said(readBlock(onIssues("36499d", "36500d")))).toEqual([]);
        // Both at the ceiling leaves no room for the gap the floor demands.
        expect(said(readBlock(onIssues("36500d", "36500d")))).toEqual([
            `${ISSUES_REAP} :: ${ISSUES_REAP}: must be at least 1h above remindAfter (36500d)`,
        ]);
    });
});

/**
 * One spelling, and everything a maintainer reaches for instead of it.
 *
 * A duration is a whole number and a unit. Everything else is refused, and the
 * two refusals are told apart on purpose: a BARE NUMBER is shown the spelling
 * it should have had, because the unit is the only thing missing from it;
 * anything else is told the grammar, because there is no one string to suggest.
 */
describe("the forms a clock can be written in", () => {
    /**
     * One reminder, written however the row writes it, under a reap clock far
     * enough above every form that the RELATION is never what refuses a file:
     * the subject here is the spelling, not the gap.
     */
    const parseWritten = (written: string) =>
        parseConfigDocument(
            `schemaVersion: 2\nmode: observe\ncapabilities:\n  inactivity:\n` +
                `    enabled: true\n    remindAfter: ${written}\n    reap:\n      after: 2000d\n`,
            { revision: "rev-extremes", knownCapabilities: DECLARATIONS },
        );

    const document = (written: string): readonly string[] => {
        const result = parseWritten(written);
        return result.ok ? [] : result.errors.map((error) => error.message);
    };

    const resolved = (written: string): unknown => {
        const result = parseWritten(written);
        return result.ok ? result.config.capabilities.inactivity?.settings.remindAfter : "refused";
    };

    it.each([
        ["14d — a fortnight", "14d", 14 * 24],
        ["4h — four hours", "4h", 4],
        ["0h — nothing at all", "0h", 0],
        ["0d — nothing at all, the other way", "0d", 0],
    ])("%s resolves to the hours it says", (_why, written, value) => {
        expect(document(written)).toEqual([]);
        expect(resolved(written)).toBe(value);
    });

    /** YAML reads each of these as a NUMBER, so each is shown the unit it lacks. */
    it.each([
        ["14 — a bare number", "14", '"14d" for days or "14h" for hours'],
        ["1e3 — exponent notation", "1e3", '"1000d" for days or "1000h" for hours'],
        ["0x10 — hexadecimal", "0x10", '"16d" for days or "16h" for hours'],
        ["+14 — a signed integer", "+14", '"14d" for days or "14h" for hours'],
    ])("%s is shown the spelling it should have had", (_why, written, spelling) => {
        expect(document(written)).toEqual([
            `capabilities.inactivity.remindAfter: must be a duration with a unit — write ${spelling}`,
        ]);
    });

    it.each([
        ["14.5d — half a day", "14.5d"],
        ["2w — a week is not a unit", "2w"],
        ["90m — neither are minutes", "90m"],
        ["1d4h — no mixed units", "1d4h"],
        ["14.5 — a fraction with no unit either", "14.5"],
        [".inf — not a duration at all", ".inf"],
        ["1_000 — an underscore makes it text", "1_000"],
    ])("%s is refused with the grammar", (_why, written) => {
        expect(document(written)).toEqual([
            "capabilities.inactivity.remindAfter: must be a duration: a whole number of hours" +
                ' or days, written "4h" or "14d"',
        ]);
    });
});

/**
 * The cascade, which the design promises resolves reason → ladder →
 * capability default, and the relation, which it promises is checked at every
 * level. The two together are what makes a reason override legal below its
 * own ladder's clocks and illegal below its own level's reminder.
 */
describe("a reason override under its ladder", () => {
    const withReason = (reason: Readonly<Record<string, unknown>>) => ({
        remindAfter: "14d",
        reap: { after: "21d" },
        pullRequests: {
            enabled: true,
            // A section, not a block: the ladder hands this clock to its
            // reasons and acts on nothing itself.
            reap: { after: "60d" },
            reapWhen: { needsRevision: { enabled: true, ...reason } },
        },
    });

    /**
     * `above` is judged at the REASON's own level, against what
     * `remindAfter` resolves to there — the capability default of `14d`,
     * because neither the ladder nor the reason states one. So a reason that
     * reaps at `2d` is refused even though its ladder reaps at `60d`.
     */
    it("is judged against its own level's reminder, not its ladder's", () => {
        expect(said(readBlock(withReason({ reap: { enabled: true, after: "2d" } })))).toEqual([
            "capabilities.inactivity.pullRequests.reapWhen.needsRevision.reap.after ::" +
                " capabilities.inactivity.pullRequests.reapWhen.needsRevision.reap.after:" +
                " must be at least 1h above remindAfter (14d)",
        ]);
    });

    /** Stating the reminder at the same level is what makes the fast reason legal. */
    it("is legal once its own reminder comes down with it", () => {
        const read = readBlock(
            withReason({ remindAfter: "1d", reap: { enabled: true, after: "2d" } }),
        );
        expect(said(read)).toEqual([]);
        expect(read.settings).toMatchObject({
            remindAfter: 14 * 24,
            reap: { after: 21 * 24 },
            pullRequests: {
                enabled: true,
                // Inherited from the capability default, one level out.
                remindAfter: 14 * 24,
                // No `enabled` beside it: this ladder consents to nothing.
                reap: { after: 60 * 24 },
                reapWhen: {
                    // A reason nobody consented to is parked, and carries no clocks.
                    draft: { enabled: false },
                    changesRequested: { enabled: false },
                    needsRevision: {
                        enabled: true,
                        remindAfter: 24,
                        reap: { enabled: true, after: 2 * 24 },
                    },
                },
            },
        });
    });
});

/**
 * "Reminders, but never a close." C11 recorded that a `duration` field has no
 * `never`; the reap is an enabled-block now, so the answer is a block a
 * maintainer simply does not write. This records what each spelling does, so
 * the answers stay answers.
 */
describe("what a maintainer who wants no close can write", () => {
    /** The spelling the decision built: no `reap` block, so no release clock. */
    it("leaving the reap block out is how a ladder reminds and never releases", () => {
        const read = readBlock({ issues: { enabled: true, remindAfter: "3d" } });
        expect(said(read)).toEqual([]);
        expect(read.settings).toMatchObject({
            issues: { enabled: true, remindAfter: 3 * 24, reap: { enabled: false } },
        });
    });

    /** A kept block with no consent is the same answer, written down. */
    it("parking the reap block says the same thing and keeps the clock for later", () => {
        const read = readBlock({
            issues: { enabled: true, remindAfter: "3d", reap: { enabled: false, after: "30d" } },
        });
        expect(said(read)).toEqual([]);
        expect(read.settings).toMatchObject({
            issues: { enabled: true, remindAfter: 3 * 24, reap: { enabled: false } },
        });
    });

    /** Leaving the CLOCK out of a consenting block still inherits it. */
    it("a reap block with no clock in it inherits one rather than switching off", () => {
        const read = readBlock({ issues: { enabled: true, reap: { enabled: true } } });
        expect(read.settings).toMatchObject({
            issues: {
                enabled: true,
                remindAfter: 14 * 24,
                reap: { enabled: true, after: 21 * 24 },
            },
        });
    });

    it("parking the ladder loses the reminders with it", () => {
        const read = readBlock({ pullRequests: { enabled: false, remindAfter: "1d" } });
        expect(said(read)).toEqual([]);
        // A parked block reads as consent alone: the clock beside it is not read.
        expect(read.settings).toMatchObject({ pullRequests: { enabled: false } });
    });

    it("a century is the longest wait there is, and it still reaps", () => {
        const read = readBlock({ remindAfter: "14d", reap: { after: "36500d" } });
        expect(said(read)).toEqual([]);
        expect(read.settings).toMatchObject({ reap: { after: MAX_CLOCK_HOURS } });
    });
});

// ─── The engine, on the files the parser accepted ────────────────────

async function decideOn(config: RepositoryConfig, facts: Facts): Promise<Decision> {
    return await decide({ kind: "facts", facts }, config, ALL, externals);
}

const configFor = (settings: Readonly<Record<string, unknown>>, names = ["inactivity"]) =>
    configEnabling(names, DECLARATIONS, { inactivity: settings }, MAPPINGS);

describe("a sweep at the fastest legal ladder", () => {
    const fastest = {
        remindAfter: "0h",
        reap: { after: "2h" },
        issues: { enabled: true, reap: { enabled: true } },
    };

    /**
     * Day zero reminds, and the release does NOT follow it in the same sweep:
     * the destructive gate refuses an act with no recorded warning however
     * short the clocks are, so the one effect approved is the warning the
     * platform authored (grace.md §2).
     */
    it("warns on first sight and approves no release beside it", async () => {
        const decision = await decideOn(configFor(fastest), staleIssue());

        expect(
            decision.approved.map((effect) => ({
                operation: effect.intent.operation,
                kind: effect.managedComment?.identity.kind,
            })),
        ).toEqual([{ operation: "postManagedComment", kind: "warning" }]);
        expect(
            decision.approved.map((effect) => effect.intent.operation === "releaseAssignment"),
        ).toEqual([false]);
    });

    /**
     * The deadline it promises is two hours out, which is the gap the clocks
     * state — and under a day, so the rendered deadline carries the hour as
     * well as the date. A date alone here would name a deadline the reader
     * cannot tell from "some time today".
     */
    it("names a deadline two hours after the observation, with the hour on it", async () => {
        const decision = await decideOn(configFor(fastest), staleIssue());
        const [warning] = decision.approved;

        expect(warning?.intent.desired).toMatchObject({ body: expect.stringContaining("**") });
        expect(JSON.stringify(warning?.intent.desired)).toContain("2026-08-03 11:00 UTC");
    });
});

/**
 * The whole of "remind, never close", from the file to the effect: a ladder
 * enabled with no `reap` block under it.
 *
 * The parser rows above say the block reads as parked; this says what the sweep
 * then does with it. One comment, no release, and no warning record for a
 * release to be authorized by later — because there is no act for the platform
 * to hold.
 */
describe("a sweep on a ladder that reminds and never releases", () => {
    const remindOnly = { remindAfter: "0h", issues: { enabled: true } };

    it("approves the capability's own reminder and nothing else", async () => {
        const decision = await decideOn(configFor(remindOnly), staleIssue());

        expect(
            decision.approved.map((effect) => ({
                operation: effect.intent.operation,
                kind: effect.managedComment?.identity.kind,
                topic: effect.managedComment?.identity.topic,
                records: effect.records,
            })),
        ).toEqual([
            {
                operation: "postManagedComment",
                kind: "warning",
                topic: "contributor",
                // Nothing recorded: a warning record authorizes an act, and
                // this file asked for none (grace.md §3).
                records: null,
            },
        ]);
        expect(JSON.stringify(decision.approved[0]?.intent.desired)).not.toContain("otherwise");
    });

    /**
     * The control, on the same record: consenting to the reap turns the one
     * comment into the platform's own warning for a release it will hold.
     */
    it("becomes the platform's warning the moment the reap block consents", async () => {
        const decision = await decideOn(
            configFor({
                remindAfter: "0h",
                reap: { after: "2h" },
                issues: { enabled: true, reap: { enabled: true } },
            }),
            staleIssue(),
        );

        expect(decision.approved.map((effect) => effect.records !== null)).toEqual([true]);
        expect(JSON.stringify(decision.approved[0]?.intent.desired)).toContain("otherwise");
    });
});

/**
 * `exemptBlocked: false` turns off the capability's OWN exemption. It does not
 * turn off the platform's: a blocked item is refused by the safety rules, so
 * the answer to "is the config the only guard" is no, and the file that says
 * `false` still writes nothing to a blocked item.
 */
describe("exemptBlocked: false with blocked mapped", () => {
    const blocked = (): Facts =>
        sweptIssue({
            assignees: CONTRIBUTOR,
            position: {
                kind: "position",
                state: { meaning: null, blocked: true, closedBy: null },
                ignored: [],
            },
        });

    it("reaches the safety rules, which refuse the write anyway", async () => {
        const decision = await decideOn(
            configFor({
                exemptBlocked: false,
                issues: { enabled: true, reap: { enabled: true } },
            }),
            blocked(),
        );

        expect(decision.approved).toEqual([]);
        expect(decision.report.findings.map((finding) => finding.code)).toEqual(["itemBlocked"]);
    });

    /**
     * The control: with the exemption on, the capability declines before an
     * intent exists, so the refusal has nothing to refuse and says nothing.
     * The two together are what makes the row above the SAFETY rule firing.
     */
    it("says nothing at all when the exemption is left on", async () => {
        const decision = await decideOn(
            configFor({
                exemptBlocked: true,
                issues: { enabled: true, reap: { enabled: true } },
            }),
            blocked(),
        );

        expect(decision.approved).toEqual([]);
        expect(decision.report.findings).toEqual([]);
    });
});

/**
 * Two capabilities on one pull request, in one sweep: `prDashboard`'s standing
 * summary and `inactivity`'s warning. Two managed comments, and the identity
 * that keeps them apart is the capability plus the purpose — never the
 * occasion — so neither rewrites the other (D125, D145).
 */
describe("two capabilities on one item", () => {
    const contested = (): Facts =>
        sweptPullRequest({
            assignees: CONTRIBUTOR,
            readiness: { draft: false },
            review: {
                changesRequested: true,
                reapableSince: {
                    needsRevision: new Date("2026-07-01T00:00:00.000Z"),
                    changesRequested: new Date("2026-07-01T00:00:00.000Z"),
                    draft: new Date("2026-07-01T00:00:00.000Z"),
                },
                lastCommitAt: null,
            },
            position: {
                kind: "position",
                state: { meaning: "needsRevision", blocked: false, closedBy: null },
                ignored: [],
            },
        });

    it("posts two comments with two identities and two markers", async () => {
        // Both blocks stated, because both capabilities are opt-in one level
        // below their own `enabled`: prDashboard's check and inactivity's reason.
        const decision = await decideOn(
            configEnabling(
                ["prDashboard", "inactivity"],
                DECLARATIONS,
                {
                    prDashboard: { checks: { linkedIssues: { enabled: true } } },
                    inactivity: {
                        pullRequests: {
                            enabled: true,
                            reapWhen: {
                                needsRevision: { enabled: true, reap: { enabled: true } },
                            },
                        },
                    },
                },
                MAPPINGS,
            ),
            contested(),
        );

        const comments = decision.approved.filter(
            (effect) => effect.intent.operation === "postManagedComment",
        );
        expect(
            comments.map((effect) => ({
                capability: effect.intent.capability,
                kind: effect.managedComment?.identity.kind,
                topic: effect.managedComment?.identity.topic,
            })),
        ).toEqual([
            { capability: "prDashboard", kind: "summary", topic: "" },
            // The reason is the discriminator on a pull request, the assignee
            // on an issue: one warning per act, never one per item.
            { capability: "inactivity", kind: "warning", topic: "needsRevision" },
        ]);
        expect(new Set(comments.map((effect) => effect.managedComment?.marker)).size).toBe(2);
    });
});

/**
 * The mode is the outermost decision, so a file that contradicts itself
 * contradicts the mode and loses: a destructive ladder in `observe` records,
 * everything on in `disabled` refuses, and `active` with no capability at all
 * is a perfectly valid file that does nothing.
 */
describe("the mode decides, not the capability", () => {
    const fastest = {
        remindAfter: "0h",
        reap: { after: "2h" },
        issues: { enabled: true, reap: { enabled: true } },
    };

    it.each([
        ["disabled", ["modeDisabled"]],
        ["observe", ["capabilityExplained", "modeRecordsOnly"]],
        ["dry-run", ["capabilityExplained", "modeRecordsOnly", "wouldApply"]],
    ] as const)("%s writes nothing and says why", async (mode, codes) => {
        const decision = await decideOn({ ...configFor(fastest), mode }, staleIssue());

        expect(decision.approved).toEqual([]);
        expect(decision.report.findings.map((finding) => finding.code)).toEqual([...codes]);
    });

    it("active with no capability enabled is a valid file that does nothing", async () => {
        const result = parseConfig(
            { schemaVersion: 2, mode: "active", capabilities: {}, mappings: MAPPINGS },
            { revision: "rev-extremes", knownCapabilities: DECLARATIONS },
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const decision = await decideOn(result.config, staleIssue());
        expect(decision.approved).toEqual([]);
        expect(decision.report.findings).toEqual([]);
    });
});

// ─── Everything on ───────────────────────────────────────────────────

function repositoryRoot(): string {
    let dir = dirname(fileURLToPath(import.meta.url));
    while (!existsSync(join(dir, "pnpm-workspace.yaml"))) {
        const parent = dirname(dir);
        if (parent === dir) throw new Error("no pnpm-workspace.yaml above this test");
        dir = parent;
    }
    return dir;
}

/** The shipped catalogue file, read as the shell reads a repository's own. */
function fullExample(): RepositoryConfig {
    const text = readFileSync(join(repositoryRoot(), "docs", "examples", "full.yml"), "utf8");
    const result = parseConfigDocument(text, {
        revision: "rev-full",
        knownCapabilities: DECLARATIONS,
    });
    if (!result.ok) {
        throw new Error(`full.yml did not parse: ${result.errors.map((e) => e.code).join(", ")}`);
    }
    return result.config;
}

/** The same document with consent narrowed to the named capabilities. */
function enabling(config: RepositoryConfig, names: readonly string[]): RepositoryConfig {
    return {
        ...config,
        capabilities: Object.fromEntries(
            Object.entries(config.capabilities).map(([name, block]) => [
                name,
                { ...block, enabled: names.includes(name) },
            ]),
        ),
    };
}

interface Slice {
    readonly approved: readonly Effect[];
    readonly findings: readonly Finding[];
}

const capabilityOf = (finding: Finding): string | null =>
    finding.subject.kind === "capability" ||
    finding.subject.kind === "item" ||
    finding.subject.kind === "effect"
        ? finding.subject.capability
        : null;

function sliceFor(decisions: readonly Decision[], name: string): Slice {
    return {
        approved: decisions.flatMap((decision) =>
            decision.approved.filter((effect) => effect.intent.capability === name),
        ),
        findings: decisions.flatMap((decision) =>
            decision.report.findings.filter((finding) => capabilityOf(finding) === name),
        ),
    };
}

/**
 * `docs/examples/full.yml` — every shipped capability on, every family mapped,
 * every override stated — on one record of each producer and kind.
 *
 * The engine matrix already proves P3 over `fullestValidSettings`, a block
 * derived from each spec. This proves it over the file a maintainer would
 * actually copy, where the overrides are stated at three levels and the
 * mappings are a real repository's. A capability whose decision moved because
 * a neighbour was switched on would be invisible to the derived block and
 * visible here.
 */
describe("full.yml, everything on", () => {
    const RECORDS: readonly Facts[] = [
        webhookIssue(),
        webhookPullRequest(),
        staleIssue(),
        sweptPullRequest({ assignees: CONTRIBUTOR }),
    ];

    const runAll = async (config: RepositoryConfig): Promise<readonly Decision[]> => {
        const decisions: Decision[] = [];
        for (const facts of RECORDS) decisions.push(await decideOn(config, facts));
        return decisions;
    };

    it("parses, and enables every capability the App ships", () => {
        const config = fullExample();
        expect(NAMES.filter((name) => config.capabilities[name]?.enabled !== true)).toEqual([]);
    });

    it("changes no capability's decision by having its neighbours on", async () => {
        const config = fullExample();
        const together = await runAll(config);
        for (const name of NAMES) {
            const alone = await runAll(enabling(config, [name]));
            expect(sliceFor(together, name), name).toEqual(sliceFor(alone, name));
        }
    });

    /**
     * The rehearsal a maintainer reads before promoting to `active`: the file
     * is `dry-run`, so every write it would make is a `wouldApply` line, and
     * each one is named once. A second line for one write would be the report
     * double-counting an effect, which is what an "everything on" file is the
     * likeliest place to find.
     */
    it("names every write it would make exactly once", async () => {
        const rehearsed = (await runAll(fullExample()))
            .flatMap((decision) => decision.report.findings)
            .filter((finding) => finding.code === "wouldApply")
            .map((finding) => JSON.stringify(finding.subject));

        expect(rehearsed.length).toBeGreaterThan(0);
        expect(new Set(rehearsed).size).toBe(rehearsed.length);
    });
});
