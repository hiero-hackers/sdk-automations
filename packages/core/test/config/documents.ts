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
import type { AdmittedCapability, ConfigErrorCode, ConfigResult } from "../../src/config/index.js";

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
     * What the application admits. Empty admits nothing. A bare NAME admits
     * only the name, so the rows about settings keys and required meanings
     * pass `AdmittedCapability` objects — those two checks have nothing to
     * judge against otherwise (D84).
     */
    readonly known?: readonly (string | AdmittedCapability)[];
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

export const DOCUMENT_REJECTIONS: readonly DocumentRejection[] = [
    // ---- document level: the file never became a mapping ----
    {
        code: "documentUnparseable",
        why: "the indentation does not describe a tree",
        yaml: `capabilities:\n  intake:\n enabled: true\n`,
    },
    {
        code: "documentUnparseable",
        why: "a flow sequence is never closed",
        yaml: `schemaVersion: 1\nmode: [observe\n`,
    },
    {
        code: "documentUnparseable",
        why: "a quoted scalar is never closed",
        yaml: `schemaVersion: 1\nmode: "observe\n`,
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
        yaml: `schemaVersion: 1\nmode: observe\nmode: active\n${VALID_TAIL}`,
        messageIncludes: ["line 3"],
    },
    {
        code: "duplicateKey",
        why: "a nested key is declared twice",
        yaml: `schemaVersion: 1\nmode: observe\ncapabilities:\n  intake:\n    enabled: false\n    enabled: true\n`,
    },

    // ---- the document parsed, but is not a mapping ----
    {
        code: "notAMapping",
        why: "a sequence at the top level",
        yaml: `- schemaVersion: 1\n- mode: observe\n`,
    },
    { code: "notAMapping", why: "a bare scalar", yaml: `observe\n` },
    { code: "notAMapping", why: "a number", yaml: `1\n` },

    // ---- top-level keys ----
    {
        code: "unknownKey",
        why: "capabilities is misspelt, so the block would be silently ignored",
        yaml: `schemaVersion: 1\nmode: observe\ncapabilties: {}\n`,
    },
    {
        code: "unknownKey",
        why: "several unknown keys are all reported, not just the first",
        yaml: `schemaVersion: 1\nmode: observe\n${VALID_TAIL}nope: 1\nalsoNope: 2\n`,
        errorCount: 2,
    },

    {
        code: "schemaVersionUnsupported",
        why: "a version that does not exist yet",
        yaml: `schemaVersion: 2\nmode: observe\n${VALID_TAIL}`,
    },
    {
        code: "schemaVersionUnsupported",
        why: 'the version is quoted, so it is the string "1"',
        yaml: `schemaVersion: "1"\nmode: observe\n${VALID_TAIL}`,
    },
    {
        code: "schemaVersionUnsupported",
        why: "no version at all — a document must say which schema it is",
        yaml: `mode: observe\n${VALID_TAIL}`,
    },

    {
        code: "modeInvalid",
        why: "a plausible word that is not one of the four modes",
        yaml: `schemaVersion: 1\nmode: enabled\n${VALID_TAIL}`,
    },
    {
        code: "modeInvalid",
        why: "YAML reads an unquoted no as a boolean, not a mode",
        yaml: `schemaVersion: 1\nmode: no\n${VALID_TAIL}`,
    },
    {
        code: "modeInvalid",
        why: "the right word in the wrong case",
        yaml: `schemaVersion: 1\nmode: Observe\n${VALID_TAIL}`,
    },

    // ---- capabilities ----
    {
        code: "capabilityNameInvalid",
        why: "a name that could not be a configuration key",
        yaml: `schemaVersion: 1\nmode: observe\ncapabilities:\n  Pr-Quality:\n    enabled: true\n`,
    },
    {
        code: "capabilityNameInvalid",
        why: "a prototype-pollution key, rejected by the same rule",
        yaml: `schemaVersion: 1\nmode: observe\ncapabilities:\n  __proto__:\n    enabled: true\n`,
    },
    {
        code: "capabilityEnabledNotBoolean",
        why: "a quoted true is a string, and truthy is not consent",
        yaml: `schemaVersion: 1\nmode: observe\ncapabilities:\n  intake:\n    enabled: "true"\n`,
    },
    {
        code: "capabilityEnabledNotBoolean",
        why: "1 is not a boolean either",
        yaml: `schemaVersion: 1\nmode: observe\ncapabilities:\n  intake:\n    enabled: 1\n`,
    },
    {
        code: "capabilityUnknown",
        why: "mentioning a capability that does not ship",
        yaml: `schemaVersion: 1\nmode: observe\ncapabilities:\n  autoMerge:\n    enabled: true\n`,
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
            `schemaVersion: 1\nmode: observe\ncapabilities:\n  intake:\n    enabled: true\n` +
            `    settings:\n      annouce: true\nmappings:\n  labels:\n    awaitingTriage: "status: triage"\n`,
        path: "capabilities.intake.settings.annouce",
        errorCount: 1,
    },
    {
        code: "meaningRequired",
        why: "intake is enabled in a file that never maps the meaning it needs",
        yaml: `schemaVersion: 1\nmode: observe\ncapabilities:\n  intake:\n    enabled: true\n`,
        path: "mappings.labels.awaitingTriage",
        errorCount: 1,
        messageIncludes: ['"intake"', "add mappings.labels.awaitingTriage"],
    },

    // ---- mappings ----
    {
        code: "meaningNotMappable",
        why: "a meaning the platform does not have",
        yaml: `schemaVersion: 1\nmode: observe\n${VALID_TAIL}mappings:\n  labels:\n    almostReady: "status: nearly"\n`,
    },
    {
        code: "labelInvalid",
        why: "an empty label maps a meaning onto nothing",
        yaml: `schemaVersion: 1\nmode: observe\n${VALID_TAIL}mappings:\n  labels:\n    ready: ""\n`,
    },
    {
        code: "labelInvalid",
        why: "whitespace is not a label",
        yaml: `schemaVersion: 1\nmode: observe\n${VALID_TAIL}mappings:\n  labels:\n    ready: "   "\n`,
    },
    {
        code: "labelInvalid",
        why: "a label that YAML read as a number",
        yaml: `schemaVersion: 1\nmode: observe\n${VALID_TAIL}mappings:\n  labels:\n    ready: 3\n`,
    },
    {
        code: "labelNotInjective",
        why: "two meanings share a label, so the mapping cannot be read backwards",
        yaml: `schemaVersion: 1\nmode: observe\n${VALID_TAIL}mappings:\n  labels:\n    ready: "status: go"\n    readyToMerge: "status: go"\n`,
    },
    {
        code: "labelNotInjective",
        why: "the collision is only visible after trimming and lowercasing",
        yaml: `schemaVersion: 1\nmode: observe\n${VALID_TAIL}mappings:\n  labels:\n    ready: "Status: Go"\n    readyToMerge: "status: go  "\n`,
    },

    // ---- principals ----
    {
        code: "principalNotAString",
        why: "a principal is a name, not a number",
        yaml: `schemaVersion: 1\nmode: observe\n${VALID_TAIL}principals:\n  maintainerTeam: 42\n`,
    },
    {
        code: "principalNotAString",
        why: "nor a list",
        yaml: `schemaVersion: 1\nmode: observe\n${VALID_TAIL}principals:\n  maintainerTeam: [a, b]\n`,
    },
];

/**
 * A document with nothing wrong with it. A row that spreads this one has
 * exactly one mistake in it, so its distinct-code set is unambiguous and the
 * `path` it pins is the path of the only error there is.
 */
const COMPLETE = {
    schemaVersion: 1,
    mode: "active",
    capabilities: {},
    mappings: { labels: {} },
    principals: {},
};

/** The names `COMPLETE`-based rows admit, so `intake` is never also unknown. */
const INTAKE = ["intake"];

/** Two shipped capabilities, for the rows about what the App admits. */
const SHIPPED = ["prQuality", "assignment"];

/**
 * What the DOCUMENT driver admits: two probes declared rather than named, so
 * a document row reaches the two rules that need a declaration (D84). Shaped
 * on the real probes, so a row fails the way a repository would.
 */
export const DOCUMENT_ADMISSIONS = [
    { name: "intake", configKeys: ["announce"], requiredMeanings: ["awaitingTriage"] },
    { name: "prQuality", configKeys: ["marker"], requiredMeanings: [] },
] as const satisfies readonly AdmittedCapability[];

/** `intake` alone, for the value rows about one capability's declaration. */
const INTAKE_DECLARED = [DOCUMENT_ADMISSIONS[0]];

/** A capability needing two meanings, for the rows about accumulation. */
const TRIAGE_DECLARED = [
    {
        name: "triage",
        configKeys: [],
        requiredMeanings: ["awaitingTriage", "needsReview"],
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
        raw: Object.assign(Object.create({ mode: "active" }), { schemaVersion: 1 }),
        path: null,
        errorCount: 1,
    },

    // ---- schema level: the version and the top-level keys ----
    {
        code: "schemaVersionUnsupported",
        why: "a version that does not exist yet",
        raw: { ...COMPLETE, schemaVersion: 2 },
        known: INTAKE,
        path: "schemaVersion",
    },
    {
        code: "schemaVersionUnsupported",
        why: "no version at all — a document must say which schema it is",
        raw: { mode: "observe" },
    },
    {
        code: "unknownKey",
        why: "capabilities is misspelt, and the misspelling is quoted back",
        raw: { schemaVersion: 1, mode: "observe", capabilties: {} },
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
     * §2.6 in one row: `prQuality` is a well-formed block and it still buys
     * nothing, because one error anywhere yields no configuration at all. It
     * is also unshipped here, which is why the rejection names two codes.
     */
    {
        code: "modeInvalid",
        why: "a well-formed capability alongside a bad mode is discarded too",
        raw: {
            schemaVersion: 1,
            mode: "actively",
            capabilities: { prQuality: { enabled: true } },
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
        raw: { schemaVersion: 1, mode: null },
    },
    {
        code: "modeInvalid",
        why: "an empty string is not a mode either",
        raw: { schemaVersion: 1, mode: "" },
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
        raw: { schemaVersion: 1, capabilities: [] },
        messageIncludes: ["capabilities must be a mapping"],
    },
    {
        code: "notAMapping",
        why: "a capability whose body is a sequence",
        raw: { schemaVersion: 1, capabilities: { a: [] } },
        path: "capabilities.a",
        messageIncludes: ['capability "a" must be a mapping'],
    },
    {
        code: "notAMapping",
        why: "a null capability body is not an empty one",
        raw: { schemaVersion: 1, capabilities: { assignment: null } },
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
        raw: { schemaVersion: 1, capabilities: { assignment: undefined } },
        path: "capabilities.assignment",
        errorCount: 1,
        messageIncludes: ['capability "assignment" must be a mapping'],
    },
    {
        code: "notAMapping",
        why: "settings is opaque, but it is still a mapping",
        raw: { schemaVersion: 1, capabilities: { a: { settings: [] } } },
        path: "capabilities.a.settings",
        messageIncludes: ["settings must be a mapping"],
    },
    {
        code: "capabilityNameInvalid",
        why: "a dotted path is not a capability name",
        raw: { schemaVersion: 1, capabilities: { "a.b": { enabled: false } } },
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
        raw: { schemaVersion: 1, capabilities: { PascalCase: { enabled: false } } },
    },
    {
        code: "capabilityNameInvalid",
        why: "a leading underscore is not a configuration key",
        raw: { schemaVersion: 1, capabilities: { _private: { enabled: false } } },
    },
    {
        code: "capabilityNameInvalid",
        why: "the empty name",
        raw: { schemaVersion: 1, capabilities: { "": { enabled: false } } },
    },
    {
        code: "unknownKey",
        why: "an unknown key inside a capability block",
        raw: { ...COMPLETE, capabilities: { intake: { enabled: true, stray: 1 } } },
        known: INTAKE,
        path: "capabilities.intake.stray",
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
            schemaVersion: 1,
            capabilities: {
                intake: { enabled: true, settings: { annouce: true } },
            },
            mappings: { labels: { awaitingTriage: "status: triage" } },
        },
        known: INTAKE_DECLARED,
        path: "capabilities.intake.settings.annouce",
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
            schemaVersion: 1,
            capabilities: { intake: { enabled: false, settings: { annouce: true } } },
        },
        known: INTAKE_DECLARED,
        path: "capabilities.intake.settings.annouce",
        errorCount: 1,
    },
    {
        code: "unknownKey",
        why: "a capability declaring no settings says so rather than showing a blank list",
        raw: {
            schemaVersion: 1,
            capabilities: { triage: { enabled: false, settings: { anything: 1 } } },
        },
        known: TRIAGE_DECLARED,
        path: "capabilities.triage.settings.anything",
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
            '{"schemaVersion":1,"capabilities":{"intake":{"enabled":false,"settings":{"__proto__":{"announce":true}}}}}',
        ),
        known: INTAKE_DECLARED,
        path: "capabilities.intake.settings.__proto__",
        errorCount: 1,
    },
    /**
     * A name-only admission buys neither new check. `intake` is admitted as a
     * bare string here and the same typo passes — which is the seam stated as
     * behaviour, not an oversight: a caller that declares nothing has told the
     * parser nothing to judge against.
     */
    {
        code: "capabilityUnknown",
        why: "a name-only admission still judges the NAME, and nothing more",
        raw: {
            schemaVersion: 1,
            capabilities: {
                intake: { enabled: false, settings: { annouce: true } },
                ghost: { enabled: false },
            },
        },
        known: INTAKE,
        path: "capabilities.ghost",
        errorCount: 1,
    },

    // ---- enabled without a meaning the capability requires (D84) ----
    /**
     * The gap `configuration.md` used to document honestly: this file was
     * VALID, and intake skipped itself at runtime saying so only in a report.
     * The path points at the line to add, not at the capability block.
     */
    {
        code: "meaningRequired",
        why: "intake is enabled without the triage meaning it declares it needs",
        raw: {
            schemaVersion: 1,
            capabilities: { intake: { enabled: true } },
            mappings: { labels: { ready: "status: ready" } },
        },
        known: INTAKE_DECLARED,
        path: "mappings.labels.awaitingTriage",
        errorCount: 1,
        messageIncludes: [
            '"intake"',
            '"awaitingTriage"',
            "add mappings.labels.awaitingTriage",
            "capabilities.intake.enabled to false",
        ],
    },
    {
        code: "meaningRequired",
        why: "a repository mapping nothing at all is missing it just the same",
        raw: { schemaVersion: 1, capabilities: { intake: { enabled: true } } },
        known: INTAKE_DECLARED,
        path: "mappings.labels.awaitingTriage",
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
        raw: { schemaVersion: 1, capabilities: { triage: { enabled: true } } },
        known: TRIAGE_DECLARED,
        errorCount: 2,
        messageIncludes: ['"awaitingTriage"', '"needsReview"'],
    },
    {
        code: "meaningRequired",
        why: "a partially mapped repository is told only about what is missing",
        raw: {
            schemaVersion: 1,
            capabilities: { triage: { enabled: true } },
            mappings: { labels: { awaitingTriage: "status: triage" } },
        },
        known: TRIAGE_DECLARED,
        path: "mappings.labels.needsReview",
        errorCount: 1,
    },
    /**
     * Three sections wrong, three sections heard from — the humane half of
     * D38. A maintainer is not made to fix one mistake per push, and the
     * ORDER is `parse.ts`'s section order, which is the order they read.
     */
    {
        code: "unknownKey",
        why: "a misspelt capability key and an unmappable meaning are reported together",
        raw: {
            schemaVersion: 1,
            capabilities: { intake: { enable: true } },
            mappings: { labels: { readyForDev: "status: ready" } },
        },
        alsoReports: ["capabilityUnknown", "meaningNotMappable"],
        messageIncludes: ['unknown key "enable"', '"readyForDev" is not a mappable meaning'],
    },
    // §2.4 — only boolean true enables a capability; truthiness is not consent.
    {
        code: "capabilityEnabledNotBoolean",
        why: "1 is not a boolean",
        raw: { schemaVersion: 1, capabilities: { intake: { enabled: 1 } } },
        known: INTAKE,
    },
    {
        code: "capabilityEnabledNotBoolean",
        why: "a quoted true is a string",
        raw: { schemaVersion: 1, capabilities: { intake: { enabled: "true" } } },
        known: INTAKE,
    },
    {
        code: "capabilityEnabledNotBoolean",
        why: "nor does yes mean yes",
        raw: { ...COMPLETE, capabilities: { intake: { enabled: "yes" } } },
        known: INTAKE,
        path: "capabilities.intake.enabled",
    },
    {
        code: "capabilityUnknown",
        why: "a capability that does not ship, with the available names listed",
        raw: { schemaVersion: 1, capabilities: { checksGate: { enabled: true } } },
        known: SHIPPED,
        path: "capabilities.checksGate",
        messageIncludes: ['"checksGate"', "not available", "assignment, prQuality"],
    },
    /**
     * `knownCapabilities` is required, so omitting the admission authority is
     * a compile error and `[]` is a stated choice: admit nothing.
     */
    {
        code: "capabilityUnknown",
        why: "an empty admission list says none rather than showing a blank list",
        raw: { schemaVersion: 1, capabilities: { checksGate: { enabled: true } } },
        messageIncludes: ["(available: none)"],
    },
    {
        code: "capabilityUnknown",
        why: "a DISABLED unknown capability is rejected, not retained as a tombstone",
        raw: {
            schemaVersion: 1,
            capabilities: { removedProbe: { enabled: false, settings: { old: 1 } } },
        },
        known: SHIPPED,
        path: "capabilities.removedProbe",
        errorCount: 1,
    },
    {
        code: "capabilityUnknown",
        why: "a shipped capability alongside an unshipped one is discarded too",
        raw: {
            schemaVersion: 1,
            capabilities: { prQuality: { enabled: true }, checksGate: { enabled: true } },
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
        raw: { schemaVersion: 1, mappings: [] },
        path: "mappings",
        messageIncludes: ["mappings must be a mapping"],
    },
    {
        code: "notAMapping",
        why: "a sequence where the label table should be",
        raw: { schemaVersion: 1, mappings: { labels: [] } },
        path: "mappings.labels",
        messageIncludes: ["mappings.labels must be a mapping"],
    },
    {
        code: "unknownKey",
        why: "labels is the only thing mappings has",
        raw: { schemaVersion: 1, mappings: { fields: {} } },
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
            schemaVersion: 1,
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
            schemaVersion: 1,
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
            schemaVersion: 1,
            mappings: { labels: { ready: "status: ready", needsReview: "Status: Ready" } },
        },
        messageIncludes: ["injective", "GitHub treats as the same label"],
    },
    {
        code: "labelNotInjective",
        why: "labels differing only in surrounding space are one label to GitHub",
        raw: {
            schemaVersion: 1,
            mappings: { labels: { ready: "status: ready", needsReview: "  status: ready  " } },
        },
        messageIncludes: ["injective", "GitHub treats as the same label"],
    },
    {
        code: "labelNotInjective",
        why: "labels differing in both case and surrounding space",
        raw: {
            schemaVersion: 1,
            mappings: { labels: { ready: "Status: Ready", needsReview: " status: ready " } },
        },
        messageIncludes: ["injective", "GitHub treats as the same label"],
    },

    // ---- principals ----
    {
        code: "notAMapping",
        why: "a sequence where the principals block should be",
        raw: { schemaVersion: 1, principals: [] },
        path: "principals",
        messageIncludes: ["principals must be a mapping"],
    },
    {
        code: "principalNotAString",
        why: "a principal is a name, not a number",
        raw: { schemaVersion: 1, principals: { a: 1 } },
        path: "principals.a",
        messageIncludes: ["principals.a: must be a string"],
    },
    {
        code: "principalNotAString",
        why: "nor a number under a plausible role",
        raw: { ...COMPLETE, principals: { reviewer: 3 } },
        known: INTAKE,
        path: "principals.reviewer",
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
        raw: JSON.parse('{"schemaVersion":1,"capabilities":{"__proto__":{"enabled":true}}}'),
        path: "capabilities.__proto__",
        messageIncludes: ["not a valid configuration key"],
    },
    {
        code: "unknownKey",
        why: "__proto__ at the top level is an ordinary unknown key",
        raw: JSON.parse('{"schemaVersion":1,"__proto__":{"mode":"active"}}'),
        path: "__proto__",
    },
    {
        code: "meaningNotMappable",
        why: "__proto__ under labels is an ordinary unmappable meaning",
        raw: JSON.parse('{"schemaVersion":1,"mappings":{"labels":{"__proto__":"x"}}}'),
        path: "mappings.labels.__proto__",
    },
];
