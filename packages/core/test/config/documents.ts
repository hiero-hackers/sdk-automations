/**
 * The rejection corpus — every way a configuration can be wrong, as data.
 *
 * These began as files under `examples/config/invalid/`, which was the wrong
 * home for two reasons. The mundane one: nobody adopting the App reads
 * `capabilityEnabledNotBoolean.yml`, so they were never documentation. The
 * sharp one: Stryker's sandbox contains `core/` and nothing above it, so a
 * fixture at the repository root is invisible to mutation testing. Thirteen
 * files scored `document.ts` at 0.00% — they ran under vitest, killed nothing,
 * and would have gone on reporting a module as tested that was not.
 *
 * As a table they are also cheaper to extend, which is the point: a code is
 * better demonstrated by three shapes that reach it than by one.
 *
 * TWO tables because there are two entry points, not two homes. A document is
 * TEXT and only `parseConfigDocument` sees it, so `documentUnparseable` and
 * `duplicateKey` are reachable from nowhere else; a value is what YAML already
 * became, and `parseConfig` takes it from a file, a test, or any future
 * caller. Folding them into one array would mean a `yaml?` and a `raw?` that
 * are never both absent and never both present — a shape that lies about the
 * layer it describes.
 *
 * `expectRejection` is here rather than in either driver for the same reason
 * the corpus is: an optional field a driver forgets to assert is a field that
 * silently does nothing, which is the failure mode the whole file exists to
 * end. One assertion function, so both tables get every field honoured.
 */

import { expect } from "vitest";
import { flag, spec, text } from "../../src/capability/index.js";
import type { AdmittedCapability, ConfigErrorCode, ConfigResult } from "../../src/config/index.js";
import { admitting } from "./builders.js";

/**
 * What every rejection says, whatever it was parsed from.
 *
 * `code` is the contract and is always asserted as the WHOLE distinct-code
 * set: "this input produces this error and no other" is the claim, and a row
 * that quietly grew a second error is a change in behaviour worth failing on.
 *
 * The optional fields exist because a bespoke `it()` that asserted more than
 * a code had nowhere to fold to. Each is asserted only when present, so a row
 * says exactly what it means to pin and nothing is asserted by accident:
 *
 *  - `alsoReports` — the other codes the SAME input must produce, in the
 *    order `parse.ts` emits its sections. This is what pins multi-error
 *    accumulation: a maintainer with three mistakes hears about all three.
 *  - `messageIncludes` — the fragments of prose that are contract even though
 *    the wording is not: a misspelt key quoted back, the list of legal modes,
 *    the available capability names. D75 says the code is the contract; these
 *    are the places a code alone would not tell a maintainer what to type.
 *  - `path` — where to annotate. `null` is a real value here (a whole-document
 *    problem has no path), so absence, not null, means "not asserted".
 *  - `errorCount` — the total number of errors, for the rows whose point is
 *    that exactly one thing was wrong.
 */
export interface RejectionCase {
    /** The first code this input must produce, and — with `alsoReports` — the only ones. */
    readonly code: ConfigErrorCode;
    /** What is wrong, in a few words — becomes the test name. */
    readonly why: string;
    readonly alsoReports?: readonly ConfigErrorCode[];
    readonly messageIncludes?: readonly string[];
    readonly path?: string | null;
    readonly errorCount?: number;
}

/** A rejection reachable only from text. Drives `parseConfigDocument`. */
export interface DocumentRejection extends RejectionCase {
    readonly yaml: string;
    /**
     * True when core raises the error itself rather than relaying one the YAML
     * parser reported. Only the alias budget does this — nothing failed to
     * parse, the expansion did — so it is the one document-level error with no
     * position, and the position assertion has to know that.
     */
    readonly synthesised?: true;
}

/** A rejection of an already-parsed value. Drives `parseConfig`. */
export interface ValueRejection extends RejectionCase {
    readonly raw: unknown;
    /**
     * What the application admits. Empty admits nothing, and every entry
     * states a spec: the spec IS the schema for a block, so a row about a
     * settings key or a settings value says which keys the capability
     * declares and what each may hold (D84, C1). `admitting` is the shorthand
     * for the rows whose subject is the name alone.
     */
    readonly known?: readonly AdmittedCapability[];
}

/**
 * Assert one rejection, honouring every field the case carries.
 *
 * The two assertions made unconditionally are the ones D38 §2.6 makes about
 * every rejection whatever its cause: it is a rejection, and no partially
 * applied configuration escapes on the failure arm.
 */
export function expectRejection(result: ConfigResult, rejection: RejectionCase): void {
    expect(result.ok).toBe(false);
    // Fail closed, whole-file: there is no half-read configuration to reach for.
    expect("config" in result).toBe(false);
    if (result.ok) return;

    expect([...new Set(result.errors.map((e) => e.code))]).toEqual([
        rejection.code,
        ...(rejection.alsoReports ?? []),
    ]);

    if (rejection.errorCount !== undefined) {
        expect(result.errors).toHaveLength(rejection.errorCount);
    }
    if (rejection.path !== undefined) {
        expect(result.errors.find((e) => e.code === rejection.code)?.path).toBe(rejection.path);
    }
    const prose = result.errors.map((e) => e.message).join("\n");
    for (const fragment of rejection.messageIncludes ?? []) expect(prose).toContain(fragment);

    // Every rejection explains itself. The wording is not contract; having
    // some is — the convention `safety.test.ts` set over verdict reasons.
    for (const error of result.errors) expect(error.message.length).toBeGreaterThan(0);
}

const VALID_TAIL = `capabilities: {}\n`;

/**
 * The largest wrong file there is: every UNBUILT design's `capabilities:`
 * block, pasted as `design/guides/capabilities/` writes it, in one document.
 *
 * A maintainer who reads the design pages and copies what they promise writes
 * this file, and what they must get back is six lines they can act on — one
 * per block, in the order they wrote them, each at its own line. So the claim
 * is the SHAPE of the refusal and not only its code: the settings under an
 * unadmitted name add nothing, because a name with no spec has no schema to be
 * wrong against, and depth does not multiply the complaint.
 *
 * Only the `capabilities:` sections are pasted. Their `mappings:` and
 * `principals:` sections are each design's own, and two of them map the same
 * family, so merging those would make the document a `duplicateKey` about YAML
 * rather than a rejection about the capabilities.
 */
export const UNBUILT_DESIGNS_YAML = `schemaVersion: 2
mode: observe
capabilities:
  advancement:
    enabled: true
    noticeOn: latestActivity # comment on the contributor's most recent authored item, cc maintainerTeam
    reference: "https://github.com/hiero-ledger/governance/blob/main/roles/advancement-qualifications.md"
    roles: # any names, any number — each is a set of pillar thresholds
      juniorCommitter:
        enabled: true
        pillars:
          activeWeeks: { atLeast: 8, window: 12 }
          mergedPRs: { atLeast: 5, minTier: beginner }
          reviews: { atLeast: 9 }
          issuesAuthored: { atLeast: 3, outcome: accepted }
        uncounted: [review substance, triage judgement, community support, responsiveness]
      committer:
        enabled: true
        pillars:
          activeWeeks: { atLeast: 20, window: 40 }
          mergedPRs: { atLeast: 20, minTier: intermediate }
          reviews: { atLeast: 20 }
          issuesAuthored: { atLeast: 6, outcome: completed }
        uncounted: [standing as junior committer, review depth, breadth, judgement, mentorship]
      maintainer:
        enabled: true
        pillars:
          activeWeeks: { atLeast: 30, window: 52 }
          mergedPRs: { atLeast: 10, minTier: advanced }
          reviews: { atLeast: 40 }
        uncounted: [standing as committer, technical mastery, design leadership,
          review depth and judgement, API and compatibility judgement, debugging depth,
          stewardship, mentorship, community leadership, escalation]
  assignment:
    enabled: true
    autoAssign: # the /assign command
      enabled: true
      maxOpen: 2 # default cap; 0 = uncapped
      maxPerDay: 1 # claims per person per day
      minAccountAge: 7d # refuses brand-new accounts
    unassign: # the self /unassign command
      enabled: true
    skillGates:
      enabled: false
  merged:
    enabled: true
  notifications:
    enabled: true
    subscriptions: # alert name → who gets pinged
      critical:
        notify: maintainerTeam
      high:
        notify: triageTeam
  onboarding:
    enabled: true
  reviews:
    enabled: true
    remindAfter: 7d # no review for this long, counted from entering review
    notify: reviewersTeam # who the reminder addresses
    exemptWhen: [blocked] # meanings that pause the clock
    escalate: # the second, stronger ping — off unless enabled
      enabled: true
      escalateAfter: 21d # must exceed remindAfter by MIN_GRACE_HOURS
      to: maintainerTeam
`;

export const DOCUMENT_REJECTIONS: readonly DocumentRejection[] = [
    // ---- document level: the file never became a mapping ----
    {
        code: "documentUnparseable",
        why: "the indentation does not describe a tree",
        yaml: `capabilities:\n  triageQueue:\n enabled: true\n`,
    },
    {
        code: "documentUnparseable",
        why: "a flow sequence is never closed",
        yaml: `schemaVersion: 2\nmode: [observe\n`,
    },
    {
        code: "documentUnparseable",
        why: "a quoted scalar is never closed",
        yaml: `schemaVersion: 2\nmode: "observe\n`,
    },
    {
        code: "documentUnparseable",
        why: "aliases expand past the budget — a resource-exhaustion document",
        synthesised: true,
        yaml:
            `a: &a [x,x,x,x,x,x,x,x,x,x]\n` +
            `b: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a,*a]\n` +
            `c: [*b,*b,*b,*b,*b,*b,*b,*b,*b,*b]\n`,
    },
    /**
     * Twenty aliases: over OUR budget of ten, well under the library's default
     * of a hundred. Without it, deleting the limit we pass would change
     * nothing observable — the bomb above is caught either way — and the
     * choice would be untested. This is what pins the number to a decision.
     */
    {
        code: "documentUnparseable",
        why: "twenty aliases — inside the library's default budget, outside ours",
        synthesised: true,
        yaml: `a: &a observe\n` + `b: [${Array.from({ length: 20 }, () => "*a").join(",")}]\n`,
    },

    /**
     * The only malformed document that otherwise SUCCEEDS. YAML resolves a
     * repeated key to its last value, so this parses cleanly into a repository
     * that writes — the maintainer's stated intent overridden by their own
     * typo, with nothing to see in the result.
     */
    {
        code: "duplicateKey",
        why: "mode is declared twice, and the second one wins",
        yaml: `schemaVersion: 2\nmode: observe\nmode: active\n${VALID_TAIL}`,
        messageIncludes: ["line 3"],
    },
    {
        code: "duplicateKey",
        why: "a nested key is declared twice",
        yaml: `schemaVersion: 2\nmode: observe\ncapabilities:\n  triageQueue:\n    enabled: false\n    enabled: true\n`,
    },

    // ---- the document parsed, but is not a mapping ----
    {
        code: "notAMapping",
        why: "a sequence at the top level",
        yaml: `- schemaVersion: 2\n- mode: observe\n`,
    },
    { code: "notAMapping", why: "a bare scalar", yaml: `observe\n` },
    { code: "notAMapping", why: "a number", yaml: `1\n` },

    // ---- top-level keys ----
    {
        code: "unknownKey",
        why: "capabilities is misspelt, so the block would be silently ignored",
        yaml: `schemaVersion: 2\nmode: observe\ncapabilties: {}\n`,
    },
    {
        code: "unknownKey",
        why: "several unknown keys are all reported, not just the first",
        yaml: `schemaVersion: 2\nmode: observe\n${VALID_TAIL}nope: 1\nalsoNope: 2\n`,
        errorCount: 2,
    },

    {
        code: "schemaVersionUnsupported",
        why: "a version that does not exist yet",
        yaml: `schemaVersion: 3\nmode: observe\n${VALID_TAIL}`,
    },
    {
        code: "schemaVersionUnsupported",
        why: 'the version is quoted, so it is the string "2"',
        yaml: `schemaVersion: "2"\nmode: observe\n${VALID_TAIL}`,
    },
    {
        code: "schemaVersionUnsupported",
        why: "the retired version 1, whose settings wrapper is no longer read",
        yaml: `schemaVersion: 1\nmode: observe\n${VALID_TAIL}`,
    },
    /**
     * Absence is the current format, so the only way to say nothing is to
     * write nothing. `schemaVersion:` with no value is a STATED version —
     * null — and is refused, the way an empty `mode:` is (D56).
     */
    {
        code: "schemaVersionUnsupported",
        why: "the key is there with nothing after it, which states null rather than nothing",
        yaml: `schemaVersion:\nmode: observe\n${VALID_TAIL}`,
    },

    {
        code: "modeInvalid",
        why: "a plausible word that is not one of the four modes",
        yaml: `schemaVersion: 2\nmode: enabled\n${VALID_TAIL}`,
    },
    {
        code: "modeInvalid",
        why: "YAML reads an unquoted no as a boolean, not a mode",
        yaml: `schemaVersion: 2\nmode: no\n${VALID_TAIL}`,
    },
    {
        code: "modeInvalid",
        why: "the right word in the wrong case",
        yaml: `schemaVersion: 2\nmode: Observe\n${VALID_TAIL}`,
    },

    // ---- capabilities ----
    {
        code: "capabilityNameInvalid",
        why: "a name that could not be a configuration key",
        yaml: `schemaVersion: 2\nmode: observe\ncapabilities:\n  Pr-Quality:\n    enabled: true\n`,
    },
    {
        code: "capabilityNameInvalid",
        why: "a prototype-pollution key, rejected by the same rule",
        yaml: `schemaVersion: 2\nmode: observe\ncapabilities:\n  __proto__:\n    enabled: true\n`,
    },
    {
        code: "capabilityEnabledNotBoolean",
        why: "a quoted true is a string, and truthy is not consent",
        yaml: `schemaVersion: 2\nmode: observe\ncapabilities:\n  triageQueue:\n    enabled: "true"\n`,
    },
    {
        code: "capabilityEnabledNotBoolean",
        why: "1 is not a boolean either",
        yaml: `schemaVersion: 2\nmode: observe\ncapabilities:\n  triageQueue:\n    enabled: 1\n`,
    },
    {
        code: "capabilityUnknown",
        why: "mentioning a capability that does not ship",
        yaml: `schemaVersion: 2\nmode: observe\ncapabilities:\n  autoMerge:\n    enabled: true\n`,
    },
    /**
     * Six unbuilt designs, each block as its own page writes it: six errors and
     * no others. The deep settings under each name are not a seventh
     * complaint, because a name the App does not admit has no spec for them to
     * be judged against. `document.test.ts` asserts the line each one lands on.
     */
    {
        code: "capabilityUnknown",
        why: "every design that is not built yet, pasted into one file",
        yaml: UNBUILT_DESIGNS_YAML,
        errorCount: 6,
        path: "capabilities.advancement",
        messageIncludes: ["not available", "prDashboard, tracker, triageQueue"],
    },
    /**
     * D84, as the file a maintainer actually types. The misspelt setting is
     * the whole defect: YAML accepted it, the parser kept it, and the
     * capability never saw it — so the file said announce was on and nothing
     * announced anything.
     */
    {
        code: "unknownKey",
        why: "a settings key the capability never declared",
        yaml:
            `schemaVersion: 2\nmode: observe\ncapabilities:\n  triageQueue:\n    enabled: true\n` +
            `    annouce: true\nmappings:\n  labels:\n    awaitingTriage: "status: triage"\n`,
        path: "capabilities.triageQueue.annouce",
        errorCount: 1,
    },
    /**
     * The same file one character further on: the key is right and the VALUE
     * is not. `announce: yes` is YAML for the string "yes", which is exactly
     * the shape §2.4 refuses for consent — and since C1 it refuses it here,
     * with the rest of the file, rather than on every delivery that meets it.
     */
    {
        code: "settingInvalid",
        why: "a settings value the capability's spec cannot read",
        yaml:
            `schemaVersion: 2\nmode: observe\ncapabilities:\n  triageQueue:\n    enabled: true\n` +
            `    announce: "yes"\nmappings:\n  labels:\n    awaitingTriage: "status: triage"\n`,
        path: "capabilities.triageQueue.announce",
        errorCount: 1,
        messageIncludes: ["must be true or false"],
    },
    {
        code: "meaningRequired",
        why: "tracker is enabled in a file that never maps the command it needs",
        yaml: `schemaVersion: 2\nmode: observe\ncapabilities:\n  tracker:\n    enabled: true\n`,
        path: "mappings.commands.working",
        errorCount: 1,
        messageIncludes: ['"tracker"', "add mappings.commands.working"],
    },

    // ---- mappings ----
    {
        code: "meaningNotMappable",
        why: "a meaning the platform does not have",
        yaml: `schemaVersion: 2\nmode: observe\n${VALID_TAIL}mappings:\n  labels:\n    almostReady: "status: nearly"\n`,
    },
    {
        code: "labelInvalid",
        why: "an empty label maps a meaning onto nothing",
        yaml: `schemaVersion: 2\nmode: observe\n${VALID_TAIL}mappings:\n  labels:\n    ready: ""\n`,
    },
    {
        code: "labelInvalid",
        why: "whitespace is not a label",
        yaml: `schemaVersion: 2\nmode: observe\n${VALID_TAIL}mappings:\n  labels:\n    ready: "   "\n`,
    },
    {
        code: "labelInvalid",
        why: "a label that YAML read as a number",
        yaml: `schemaVersion: 2\nmode: observe\n${VALID_TAIL}mappings:\n  labels:\n    ready: 3\n`,
    },
    {
        code: "labelNotInjective",
        why: "two meanings share a label, so the mapping cannot be read backwards",
        yaml: `schemaVersion: 2\nmode: observe\n${VALID_TAIL}mappings:\n  labels:\n    ready: "status: go"\n    readyToMerge: "status: go"\n`,
    },
    {
        code: "labelNotInjective",
        why: "the collision is only visible after trimming and lowercasing",
        yaml: `schemaVersion: 2\nmode: observe\n${VALID_TAIL}mappings:\n  labels:\n    ready: "Status: Go"\n    readyToMerge: "status: go  "\n`,
    },
    {
        code: "commandNotMappable",
        why: "a command the platform does not have",
        yaml: `schemaVersion: 2\nmode: observe\n${VALID_TAIL}mappings:\n  commands:\n    approve: "/approve"\n`,
    },
    {
        code: "commandInvalid",
        why: "an empty command maps an act onto nothing",
        yaml: `schemaVersion: 2\nmode: observe\n${VALID_TAIL}mappings:\n  commands:\n    assign: ""\n`,
    },
    /**
     * The slash is demanded rather than added: a repository that writes a bare
     * word means a bare word, and prefixing it silently would map a command
     * nobody typing the file's own spelling could ever invoke.
     */
    {
        code: "commandInvalid",
        why: "a bare word is not a command",
        yaml: `schemaVersion: 2\nmode: observe\n${VALID_TAIL}mappings:\n  commands:\n    assign: "take"\n`,
        messageIncludes: ['command must start with "/"'],
    },
    {
        code: "commandNotInjective",
        why: "two commands share a word, and a comment cannot mean both",
        yaml: `schemaVersion: 2\nmode: observe\n${VALID_TAIL}mappings:\n  commands:\n    assign: "/take"\n    unassign: "/Take "\n`,
    },
    {
        code: "skillNotMappable",
        why: "a tier outside the ladder",
        yaml: `schemaVersion: 2\nmode: observe\n${VALID_TAIL}mappings:\n  skills:\n    expert: "skill: expert"\n`,
    },
    {
        code: "skillInvalid",
        why: "a tier label that YAML read as a number",
        yaml: `schemaVersion: 2\nmode: observe\n${VALID_TAIL}mappings:\n  skills:\n    beginner: 3\n`,
    },
    {
        code: "skillNotInjective",
        why: "two tiers share a label",
        yaml: `schemaVersion: 2\nmode: observe\n${VALID_TAIL}mappings:\n  skills:\n    beginner: "skill: easy"\n    intermediate: "Skill: Easy"\n`,
    },
    /**
     * Tiers and positions are both GitHub labels, so one spelling cannot be
     * both. Within a family the injectivity rule already says so; this is the
     * half that spans two families and nothing else would catch.
     */
    {
        code: "skillNotInjective",
        why: "one label is both a position and a tier",
        yaml: `schemaVersion: 2\nmode: observe\n${VALID_TAIL}mappings:\n  labels:\n    ready: "up for grabs"\n  skills:\n    goodFirstIssue: "Up For Grabs"\n`,
        messageIncludes: ['already mapped to "ready" under mappings.labels'],
        errorCount: 1,
    },

    // ---- alerts (the open family: the names are the file's own) ----
    {
        code: "alertInvalid",
        why: "an alert label that YAML read as a number",
        yaml: `schemaVersion: 2\nmode: observe\n${VALID_TAIL}mappings:\n  alerts:\n    critical: 3\n`,
    },
    /**
     * The native project-field form is notifications' phase 2, and nothing
     * refuses it by name any more: an entry is a label string, so the shape is
     * simply not one. The day a project-field read has an endpoint row the
     * VALUE widens to a string-or-object union, which accepts every file
     * written against today's line.
     */
    {
        code: "alertInvalid",
        why: "the native field form is a mapping, and an alert is spelled by a label",
        yaml: `schemaVersion: 2\nmode: observe\n${VALID_TAIL}mappings:\n  alerts:\n    critical: { field: Priority, value: Critical }\n`,
        errorCount: 1,
    },
    /**
     * The one refusal an open family has that a closed one does not need: the
     * repository names the alerts, so the only question left about a name is
     * whether it is shaped like every other key the parser admits.
     */
    {
        code: "alertInvalid",
        why: "an alert name that is not a key the parser admits",
        yaml: `schemaVersion: 2\nmode: observe\n${VALID_TAIL}mappings:\n  alerts:\n    priority.critical: "P0"\n`,
        messageIncludes: ["camelCase"],
        errorCount: 1,
    },
    {
        code: "alertNotInjective",
        why: "two alerts share a label",
        yaml: `schemaVersion: 2\nmode: observe\n${VALID_TAIL}mappings:\n  alerts:\n    critical: "P0"\n    urgent: "p0 "\n`,
    },
    {
        code: "alertNotInjective",
        why: "one label is both a position and an alert",
        yaml: `schemaVersion: 2\nmode: observe\n${VALID_TAIL}mappings:\n  labels:\n    blocked: "On Fire"\n  alerts:\n    critical: "on fire"\n`,
        messageIncludes: ['already mapped to "blocked" under mappings.labels'],
        errorCount: 1,
    },
    /**
     * Positions, tiers and alerts are all GitHub labels, so one spelling
     * cannot be two of them. Alerts are read last, so this is the label the
     * maintainer is told to change.
     */
    {
        code: "alertNotInjective",
        why: "one label is both a tier and an alert",
        yaml: `schemaVersion: 2\nmode: observe\n${VALID_TAIL}mappings:\n  skills:\n    goodFirstIssue: "good first issue"\n  alerts:\n    critical: "Good First Issue"\n`,
        messageIncludes: ['already mapped to "goodFirstIssue" under mappings.skills'],
        errorCount: 1,
    },

    {
        code: "notAMapping",
        why: "the open family is not a mapping at all",
        yaml: `schemaVersion: 2\nmode: observe\n${VALID_TAIL}mappings:\n  alerts: "P0"\n`,
    },

    // ---- principals ----
    /**
     * The KEY is the repository's own, so the only question about it is its
     * shape — the same question `mappings.alerts` asks of an alert name, with
     * the same pattern and the same sentence. A dotted name would become an
     * error path nobody can find the line for, and would reach a settings
     * field as a value it is checked against.
     */
    {
        code: "principalNameInvalid",
        why: "a principal name that is not a key the parser admits",
        yaml: `schemaVersion: 2\nmode: observe\n${VALID_TAIL}principals:\n  maintainer.team: "@alice"\n`,
        messageIncludes: ["camelCase"],
        errorCount: 1,
    },
    {
        code: "principalNotAString",
        why: "a principal is a name, not a number",
        yaml: `schemaVersion: 2\nmode: observe\n${VALID_TAIL}principals:\n  maintainerTeam: 42\n`,
    },
    {
        code: "principalNotAString",
        why: "nor a list",
        yaml: `schemaVersion: 2\nmode: observe\n${VALID_TAIL}principals:\n  maintainerTeam: [a, b]\n`,
    },
    /**
     * `principals:` is the one section a settings value turns into a
     * `@`-mention (`packages/core/src/intents/managed.ts`), so an empty
     * name is refused the way an empty label is: it renders an `@` that pings
     * nobody and says nothing about having done so.
     */
    {
        code: "principalNotAString",
        why: "a role declared with nothing after the colon",
        yaml: `schemaVersion: 2\nmode: observe\n${VALID_TAIL}principals:\n  maintainerTeam: ""\n`,
    },
    {
        code: "principalNotAString",
        why: "whitespace is not a name",
        yaml: `schemaVersion: 2\nmode: observe\n${VALID_TAIL}principals:\n  maintainerTeam: "   "\n`,
    },
];

/**
 * A document with nothing wrong with it. A row that spreads this one has
 * exactly one mistake in it, so its distinct-code set is unambiguous and the
 * `path` it pins is the path of the only error there is.
 */
const COMPLETE = {
    schemaVersion: 2,
    mode: "active",
    capabilities: {},
    mappings: { labels: {} },
    principals: {},
};

/** The names `COMPLETE`-based rows admit, so `triageQueue` is never also unknown. */
const INTAKE = admitting(["triageQueue"]);

/** Two shipped capabilities, for the rows about what the App admits. */
const SHIPPED = admitting(["prDashboard", "assignment"]);

/**
 * What the DOCUMENT driver admits: two capabilities declared rather than
 * named, so a document row reaches the two rules that need a declaration
 * (D84). Shaped on the real ones, so a row fails the way a repository would.
 */
export const DOCUMENT_ADMISSIONS = [
    {
        name: "triageQueue",
        settings: spec({ announce: flag({ default: false }) }),
        requiredMappings: { labels: ["awaitingTriage"] },
    },
    {
        name: "prDashboard",
        settings: spec({ marker: text({ optional: true }) }),
        requiredMappings: {},
    },
    // A required COMMAND, the family with no defaults, so `meaningRequired` stays reachable (D203).
    {
        name: "tracker",
        settings: spec({}),
        requiredMappings: { commands: ["working"] },
    },
] as const satisfies readonly AdmittedCapability[];

/** `tracker` alone, for the rows about a required mapping the file lacks. */
const TRACKER_DECLARED = [DOCUMENT_ADMISSIONS[2]];

/** A capability needing two commands, for the rows about accumulation. */
const TWO_COMMANDS_DECLARED = [
    {
        name: "tracker",
        settings: spec({}),
        requiredMappings: { commands: ["working", "assign"] },
    },
] as const satisfies readonly AdmittedCapability[];

/** `triageQueue` alone, for the value rows about one capability's declaration. */
const INTAKE_DECLARED = [DOCUMENT_ADMISSIONS[0]];

/** A capability needing two meanings, for the rows about accumulation. */
const TRIAGE_DECLARED = [
    {
        name: "triage",
        settings: spec({}),
        requiredMappings: { labels: ["awaitingTriage", "needsReview"] },
    },
] as const satisfies readonly AdmittedCapability[];

export const VALUE_REJECTIONS: readonly ValueRejection[] = [
    // ---- document level: what arrived was not a mapping at all ----
    {
        code: "notAMapping",
        why: "a bare string has no path to point at",
        raw: "not a mapping at all",
        path: null,
        errorCount: 1,
    },
    {
        code: "notAMapping",
        why: "a string trips its own guard, not whatever check happens to fail later",
        raw: "a string",
        messageIncludes: ["configuration must be a mapping"],
    },
    {
        code: "notAMapping",
        why: "a sequence is not a mapping",
        raw: [],
        messageIncludes: ["configuration must be a mapping"],
    },
    /**
     * The prototype chain is not the document. `mode: "active"` sits one link
     * up, and a reader that walked it would enable writes nobody wrote down —
     * so this is rejected whole, before any section reads anything.
     */
    {
        code: "notAMapping",
        why: "an inherited mode is not configuration and must not activate",
        raw: Object.assign(Object.create({ mode: "active" }), { schemaVersion: 2 }),
        path: null,
        errorCount: 1,
    },

    // ---- schema level: the version and the top-level keys ----
    {
        code: "schemaVersionUnsupported",
        why: "a version that does not exist yet",
        raw: { ...COMPLETE, schemaVersion: 3 },
        known: INTAKE,
        path: "schemaVersion",
    },
    {
        code: "schemaVersionUnsupported",
        why: "the version is stated as null, which is a version and not silence",
        raw: { ...COMPLETE, schemaVersion: null },
        known: INTAKE,
        path: "schemaVersion",
        errorCount: 1,
    },
    {
        code: "unknownKey",
        why: "capabilities is misspelt, and the misspelling is quoted back",
        raw: { schemaVersion: 2, mode: "observe", capabilties: {} },
        path: "capabilties",
        messageIncludes: ['unknown key "capabilties"'],
    },
    {
        code: "unknownKey",
        why: "a stray top-level key",
        raw: { ...COMPLETE, stray: 1 },
        known: INTAKE,
        path: "stray",
    },
    {
        code: "modeInvalid",
        why: "a plausible word that is not one of the four modes",
        raw: { ...COMPLETE, mode: "sideways" },
        known: INTAKE,
        path: "mode",
    },
    /**
     * §2.6 in one row: `prDashboard` is a well-formed block and it still buys
     * nothing, because one error anywhere yields no configuration at all. It
     * is also unshipped here, which is why the rejection names two codes.
     */
    {
        code: "modeInvalid",
        why: "a well-formed capability alongside a bad mode is discarded too",
        raw: {
            schemaVersion: 2,
            mode: "actively",
            capabilities: { prDashboard: { enabled: true } },
        },
        alsoReports: ["capabilityUnknown"],
        messageIncludes: ["disabled, observe, dry-run, active"],
    },
    // D56 — an ABSENT mode defaults to observe; a present but empty one is an
    // error, because choosing on the maintainer's behalf is the silent
    // interpretation §2.7 rejects.
    {
        code: "modeInvalid",
        why: "mode: with no value is null, not a default",
        raw: { schemaVersion: 2, mode: null },
    },
    {
        code: "modeInvalid",
        why: "an empty string is not a mode either",
        raw: { schemaVersion: 2, mode: "" },
    },

    // ---- capability level ----
    {
        code: "notAMapping",
        why: "a number where the capabilities block should be",
        raw: { ...COMPLETE, capabilities: 3 },
        known: INTAKE,
        path: "capabilities",
    },
    {
        code: "notAMapping",
        why: "a sequence where the capabilities block should be",
        raw: { schemaVersion: 2, capabilities: [] },
        messageIncludes: ["capabilities must be a mapping"],
    },
    {
        code: "notAMapping",
        why: "a capability whose body is a sequence",
        raw: { schemaVersion: 2, capabilities: { a: [] } },
        path: "capabilities.a",
        messageIncludes: ['capability "a" must be a mapping'],
    },
    {
        code: "notAMapping",
        why: "a null capability body is not an empty one",
        raw: { schemaVersion: 2, capabilities: { assignment: null } },
        messageIncludes: ['capability "assignment" must be a mapping'],
    },
    /**
     * `undefined`, not `null`: the two reach `isPlainObject` down different
     * arms, and only this one makes `Object.getPrototypeOf` throw. The guard
     * that stops it is the first clause of that function, so this row is what
     * makes the clause load-bearing rather than decorative.
     */
    {
        code: "notAMapping",
        why: "a capability key with no body at all",
        raw: { schemaVersion: 2, capabilities: { assignment: undefined } },
        path: "capabilities.assignment",
        errorCount: 1,
        messageIncludes: ['capability "assignment" must be a mapping'],
    },
    {
        code: "capabilityNameInvalid",
        why: "a dotted path is not a capability name",
        raw: { schemaVersion: 2, capabilities: { "a.b": { enabled: false } } },
    },
    {
        code: "capabilityNameInvalid",
        why: "kebab-case is not a configuration key",
        raw: { ...COMPLETE, capabilities: { "not-camel": { enabled: true } } },
        known: INTAKE,
        path: "capabilities.not-camel",
    },
    {
        code: "capabilityNameInvalid",
        why: "PascalCase is not a configuration key",
        raw: { schemaVersion: 2, capabilities: { PascalCase: { enabled: false } } },
    },
    {
        code: "capabilityNameInvalid",
        why: "a leading underscore is not a configuration key",
        raw: { schemaVersion: 2, capabilities: { _private: { enabled: false } } },
    },
    {
        code: "capabilityNameInvalid",
        why: "the empty name",
        raw: { schemaVersion: 2, capabilities: { "": { enabled: false } } },
    },
    /**
     * The block is flat, so there is no third kind of key in it: everything
     * beside `enabled` is a setting, and one the capability never declared is
     * refused at its own line.
     */
    {
        code: "unknownKey",
        why: "a key beside enabled is a setting, and this capability declares none",
        raw: { ...COMPLETE, capabilities: { triageQueue: { enabled: true, stray: 1 } } },
        known: INTAKE,
        path: "capabilities.triageQueue.stray",
    },

    // ---- settings keys, judged against the capability's declaration (D84) ----
    /**
     * The defect D84 is named for. `annouce` configured nothing: the parser
     * kept it, `projectCapabilityView` dropped it, and the maintainer read a
     * file that said announce was on while the capability never saw it. The
     * path has to reach the KEY, because that is the character to fix.
     */
    {
        code: "unknownKey",
        why: "a misspelt settings key configured nothing and said nothing",
        raw: {
            schemaVersion: 2,
            capabilities: {
                triageQueue: { enabled: true, annouce: true },
            },
            mappings: { labels: { awaitingTriage: "status: triage" } },
        },
        known: INTAKE_DECLARED,
        path: "capabilities.triageQueue.annouce",
        errorCount: 1,
        messageIncludes: ['unknown setting "annouce"', "it declares: announce"],
    },
    /**
     * A DISABLED block is checked too. The typo is otherwise a latent
     * surprise: it sits until somebody flips `enabled`, and then the
     * capability runs with a setting nobody notices is missing.
     */
    {
        code: "unknownKey",
        why: "a typo in a disabled block is caught now, not on the day it is enabled",
        raw: {
            schemaVersion: 2,
            capabilities: { triageQueue: { enabled: false, annouce: true } },
        },
        known: INTAKE_DECLARED,
        path: "capabilities.triageQueue.annouce",
        errorCount: 1,
    },
    {
        code: "unknownKey",
        why: "a capability declaring no settings says so rather than showing a blank list",
        raw: {
            schemaVersion: 2,
            capabilities: { triage: { enabled: false, anything: 1 } },
        },
        known: TRIAGE_DECLARED,
        path: "capabilities.triage.anything",
        messageIncludes: ["it declares: no settings"],
    },
    /**
     * Settings keys are not name-checked the way capability names are, so
     * `__proto__` reaches this rule as an ordinary key — and must be reported
     * rather than silently skipped by a lookup that walks a prototype.
     */
    {
        code: "unknownKey",
        why: "__proto__ as a settings key is an ordinary undeclared one",
        raw: JSON.parse(
            '{"schemaVersion":2,"capabilities":{"triageQueue":{"enabled":false,"__proto__":{"announce":true}}}}',
        ),
        known: INTAKE_DECLARED,
        path: "capabilities.triageQueue.__proto__",
        errorCount: 1,
    },
    /**
     * The name check and the settings checks are separate rules over one
     * block list, and a file can trip both: the misspelt setting belongs to
     * the admitted capability, the unknown name to the block beside it.
     * Reported together, in the order the blocks are written (D38).
     */
    {
        code: "unknownKey",
        why: "a misspelt setting and an unknown capability are both reported",
        raw: {
            schemaVersion: 2,
            capabilities: {
                triageQueue: { enabled: false, annouce: true },
                ghost: { enabled: false },
            },
        },
        known: INTAKE_DECLARED,
        alsoReports: ["capabilityUnknown"],
        path: "capabilities.triageQueue.annouce",
        errorCount: 2,
    },

    // ---- settings values, judged against the same spec (C1) ----
    /**
     * D38 extended from key names to VALUES. `announce: "yes"` is not consent
     * and never was, and until C1 the file was valid: the capability read the
     * block on every delivery, reported it unusable, and did nothing — while
     * every other capability in the file went on running. One error anywhere
     * rejects the whole file, and a settings value is now one of them.
     */
    {
        code: "settingInvalid",
        why: "a truthy string where the spec reads a boolean",
        raw: {
            schemaVersion: 2,
            capabilities: {
                triageQueue: { enabled: true, announce: "yes" },
            },
            mappings: { labels: { awaitingTriage: "status: triage" } },
        },
        known: INTAKE_DECLARED,
        path: "capabilities.triageQueue.announce",
        errorCount: 1,
        messageIncludes: ["capabilities.triageQueue.announce: must be true or false"],
    },
    /**
     * The other half of D84's reasoning, one level down: a DISABLED block's
     * values are read too, because a value that waits for the day somebody
     * flips `enabled` is the same latent surprise as a key that does.
     */
    {
        code: "settingInvalid",
        why: "a bad value in a disabled block is caught now, not on the day it is enabled",
        raw: {
            schemaVersion: 2,
            capabilities: { triageQueue: { enabled: false, announce: 1 } },
        },
        known: INTAKE_DECLARED,
        path: "capabilities.triageQueue.announce",
        errorCount: 1,
    },

    // ---- enabled without a meaning the capability requires (D84) ----
    /**
     * The gap `configuration.md` used to document honestly: this file was
     * VALID, and triageQueue skipped itself at runtime saying so only in a report.
     * The path points at the line to add, not at the capability block.
     */
    {
        code: "meaningRequired",
        why: "tracker is enabled without the command it declares it needs",
        raw: {
            schemaVersion: 2,
            capabilities: { tracker: { enabled: true } },
            mappings: { commands: { assign: "/assign" } },
        },
        known: TRACKER_DECLARED,
        path: "mappings.commands.working",
        errorCount: 1,
        messageIncludes: [
            '"tracker"',
            '"working"',
            "add mappings.commands.working",
            "capabilities.tracker.enabled to false",
        ],
    },
    {
        code: "meaningRequired",
        why: "a repository mapping nothing at all is missing it just the same",
        raw: { schemaVersion: 2, capabilities: { tracker: { enabled: true } } },
        known: TRACKER_DECLARED,
        path: "mappings.commands.working",
        errorCount: 1,
    },
    /**
     * Accumulation, the humane half of D38 applied to this rule: a maintainer
     * two meanings short hears about both, rather than adding one and being
     * told about the other on the next push.
     */
    {
        code: "meaningRequired",
        why: "both missing meanings are reported, not just the first",
        raw: { schemaVersion: 2, capabilities: { tracker: { enabled: true } } },
        known: TWO_COMMANDS_DECLARED,
        errorCount: 2,
        messageIncludes: ['"working"', '"assign"'],
    },
    {
        code: "meaningRequired",
        why: "a partially mapped repository is told only about what is missing",
        raw: {
            schemaVersion: 2,
            capabilities: { tracker: { enabled: true } },
            mappings: { commands: { working: "/working" } },
        },
        known: TWO_COMMANDS_DECLARED,
        path: "mappings.commands.assign",
        errorCount: 1,
    },
    /**
     * Three sections wrong, three sections heard from — the humane half of
     * D38. A maintainer is not made to fix one mistake per push, and the
     * ORDER is `parse.ts`'s section order, which is the order they read.
     */
    {
        code: "unknownKey",
        why: "a misspelt consent key, an unknown capability and an unmappable meaning are reported together",
        raw: {
            schemaVersion: 2,
            capabilities: { triageQueue: { enable: true }, ghost: { enabled: false } },
            mappings: { labels: { readyForDev: "status: ready" } },
        },
        known: INTAKE,
        alsoReports: ["capabilityUnknown", "meaningNotMappable"],
        messageIncludes: ['unknown setting "enable"', '"readyForDev" is not a mappable meaning'],
    },
    // §2.4 — only boolean true enables a capability; truthiness is not consent.
    {
        code: "capabilityEnabledNotBoolean",
        why: "1 is not a boolean",
        raw: { schemaVersion: 2, capabilities: { triageQueue: { enabled: 1 } } },
        known: INTAKE,
    },
    {
        code: "capabilityEnabledNotBoolean",
        why: "a quoted true is a string",
        raw: { schemaVersion: 2, capabilities: { triageQueue: { enabled: "true" } } },
        known: INTAKE,
    },
    {
        code: "capabilityEnabledNotBoolean",
        why: "nor does yes mean yes",
        raw: { ...COMPLETE, capabilities: { triageQueue: { enabled: "yes" } } },
        known: INTAKE,
        path: "capabilities.triageQueue.enabled",
    },
    {
        code: "capabilityUnknown",
        why: "a capability that does not ship, with the available names listed",
        raw: { schemaVersion: 2, capabilities: { checksGate: { enabled: true } } },
        known: SHIPPED,
        path: "capabilities.checksGate",
        messageIncludes: ['"checksGate"', "not available", "assignment, prDashboard"],
    },
    /**
     * `knownCapabilities` is required, so omitting the admission authority is
     * a compile error and `[]` is a stated choice: admit nothing.
     */
    {
        code: "capabilityUnknown",
        why: "an empty admission list says none rather than showing a blank list",
        raw: { schemaVersion: 2, capabilities: { checksGate: { enabled: true } } },
        messageIncludes: ["(available: none)"],
    },
    {
        code: "capabilityUnknown",
        why: "a DISABLED unknown capability is rejected, not retained as a tombstone",
        raw: {
            schemaVersion: 2,
            capabilities: { removedProbe: { enabled: false, old: 1 } },
        },
        known: SHIPPED,
        path: "capabilities.removedProbe",
        errorCount: 1,
    },
    {
        code: "capabilityUnknown",
        why: "a shipped capability alongside an unshipped one is discarded too",
        raw: {
            schemaVersion: 2,
            capabilities: { prDashboard: { enabled: true }, checksGate: { enabled: true } },
        },
        known: SHIPPED,
        path: "capabilities.checksGate",
        errorCount: 1,
    },
    {
        code: "capabilityUnknown",
        why: "a capability the App never declared",
        raw: { ...COMPLETE, capabilities: { ghost: { enabled: true } } },
        known: INTAKE,
        path: "capabilities.ghost",
    },

    // ---- mappings ----
    {
        code: "notAMapping",
        why: "a sequence where the mappings block should be",
        raw: { schemaVersion: 2, mappings: [] },
        path: "mappings",
        messageIncludes: ["mappings must be a mapping"],
    },
    {
        code: "notAMapping",
        why: "a sequence where the label table should be",
        raw: { schemaVersion: 2, mappings: { labels: [] } },
        path: "mappings.labels",
        messageIncludes: ["mappings.labels must be a mapping"],
    },
    {
        code: "unknownKey",
        why: "a family mappings does not have",
        raw: { schemaVersion: 2, mappings: { fields: {} } },
        path: "mappings.fields",
        messageIncludes: ['mappings: unknown key "fields"'],
    },
    {
        code: "meaningNotMappable",
        why: "a meaning the platform does not have",
        raw: { ...COMPLETE, mappings: { labels: { nonsense: "x" } } },
        known: INTAKE,
        path: "mappings.labels.nonsense",
    },
    {
        code: "labelInvalid",
        why: "whitespace maps a meaning onto nothing",
        raw: { ...COMPLETE, mappings: { labels: { ready: "  " } } },
        known: INTAKE,
        path: "mappings.labels.ready",
    },
    // FINDING(config-label-injectivity) D34 — label→meaning must be readable
    // backwards, so no two meanings may share a label.
    /**
     * The third fragment is the ABSENCE of the case-folding clause, stated as
     * presence: when two meanings share a spelling exactly, the meaning pair
     * runs straight into the rule citation with nothing interposed. Every
     * shorter fragment survives a message that has grown an explanation
     * nobody asked for — which is what "these labels differ only in case"
     * would be here, since they do not differ at all.
     */
    {
        code: "labelNotInjective",
        why: "two meanings share a label exactly",
        raw: {
            schemaVersion: 2,
            mappings: { labels: { ready: "status: wip", inProgress: "status: wip" } },
        },
        messageIncludes: [
            '"status: wip"',
            "injective",
            '"ready" and "inProgress" — label mappings must be injective (config-schema.md §3)',
        ],
    },
    {
        code: "labelNotInjective",
        why: "injectivity is not scoped per entity — the strict reading, pending D34",
        raw: {
            schemaVersion: 2,
            mappings: { labels: { ready: "attention", needsReview: "attention" } },
        },
    },
    {
        code: "labelNotInjective",
        why: "the second meaning is the one to annotate",
        raw: { ...COMPLETE, mappings: { labels: { ready: "x", inProgress: "x" } } },
        known: INTAKE,
        path: "mappings.labels.inProgress",
    },
    /**
     * D55 — GitHub treats label names case-insensitively for uniqueness, so
     * exact-string injectivity let two meanings share ONE real label,
     * reintroducing the ambiguity D34 exists to prevent. The message has to
     * say so, or the maintainer sees two spellings and no collision.
     */
    {
        code: "labelNotInjective",
        why: "labels differing only in case are one label to GitHub",
        raw: {
            schemaVersion: 2,
            mappings: { labels: { ready: "status: ready", needsReview: "Status: Ready" } },
        },
        messageIncludes: ["injective", "GitHub treats as the same label"],
    },
    {
        code: "labelNotInjective",
        why: "labels differing only in surrounding space are one label to GitHub",
        raw: {
            schemaVersion: 2,
            mappings: { labels: { ready: "status: ready", needsReview: "  status: ready  " } },
        },
        messageIncludes: ["injective", "GitHub treats as the same label"],
    },
    {
        code: "labelNotInjective",
        why: "labels differing in both case and surrounding space",
        raw: {
            schemaVersion: 2,
            mappings: { labels: { ready: "Status: Ready", needsReview: " status: ready " } },
        },
        messageIncludes: ["injective", "GitHub treats as the same label"],
    },

    // ---- principals ----
    {
        code: "notAMapping",
        why: "a sequence where the principals block should be",
        raw: { schemaVersion: 2, principals: [] },
        path: "principals",
        messageIncludes: ["principals must be a mapping"],
    },
    {
        code: "principalNameInvalid",
        why: "a dotted principal name is refused before its value is read",
        raw: { ...COMPLETE, principals: { "a.b": "@alice" } },
        known: INTAKE,
        path: "principals.a.b",
        messageIncludes: ['principals: "a.b" is not a valid name (camelCase)'],
        errorCount: 1,
    },
    {
        code: "principalNotAString",
        why: "a principal is a name, not a number",
        raw: { schemaVersion: 2, principals: { a: 1 } },
        path: "principals.a",
        messageIncludes: ["principals.a: must be a non-empty string"],
    },
    {
        code: "principalNotAString",
        why: "nor a number under a plausible role",
        raw: { ...COMPLETE, principals: { reviewer: 3 } },
        known: INTAKE,
        path: "principals.reviewer",
    },
    {
        code: "principalNotAString",
        why: "an empty name would render an @ that pings nobody",
        raw: { ...COMPLETE, principals: { reviewer: "" } },
        known: INTAKE,
        path: "principals.reviewer",
        errorCount: 1,
    },
    {
        code: "principalNotAString",
        why: "and whitespace is the same absence one space along",
        raw: { ...COMPLETE, principals: { reviewer: " \t " } },
        known: INTAKE,
        path: "principals.reviewer",
        errorCount: 1,
    },

    // ---- hostile keys: `__proto__` reaches every level, and is ordinary at each ----
    /**
     * Built with `JSON.parse` on purpose. An object LITERAL with a `__proto__`
     * key sets the prototype instead of creating the key, so the literal would
     * not be the input this is about. Before the name check, this key passed
     * validation, vanished from the result, AND replaced the prototype of the
     * object it was assigned into.
     */
    {
        code: "capabilityNameInvalid",
        why: "a capability named __proto__ is rejected rather than lost after validation",
        raw: JSON.parse('{"schemaVersion":2,"capabilities":{"__proto__":{"enabled":true}}}'),
        path: "capabilities.__proto__",
        messageIncludes: ["not a valid configuration key"],
    },
    {
        code: "unknownKey",
        why: "__proto__ at the top level is an ordinary unknown key",
        raw: JSON.parse('{"schemaVersion":2,"__proto__":{"mode":"active"}}'),
        path: "__proto__",
    },
    {
        code: "meaningNotMappable",
        why: "__proto__ under labels is an ordinary unmappable meaning",
        raw: JSON.parse('{"schemaVersion":2,"mappings":{"labels":{"__proto__":"x"}}}'),
        path: "mappings.labels.__proto__",
    },
    /**
     * The same key one section along, and the reason `principals` grew a name
     * check: a declared principal reaches a `principal()` field as a value it
     * is checked against, so a name the shape rule does not admit is refused
     * where the maintainer wrote it.
     */
    {
        code: "principalNameInvalid",
        why: "a principal named __proto__ is rejected rather than lost after validation",
        raw: JSON.parse('{"schemaVersion":2,"principals":{"__proto__":"@alice"}}'),
        path: "principals.__proto__",
        messageIncludes: ["not a valid name"],
    },
];
