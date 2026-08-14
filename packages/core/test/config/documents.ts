/**
 * The rejection corpus — every way a configuration file can be wrong, as data.
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
 */

import type { ConfigErrorCode } from "../../src/config/index.js";

export interface RejectionCase {
    /** The single code this document must produce, and no other. */
    readonly code: ConfigErrorCode;
    /** What is wrong, in a few words — becomes the test name. */
    readonly why: string;
    readonly yaml: string;
    /**
     * True when core raises the error itself rather than relaying one the YAML
     * parser reported. Only the alias budget does this — nothing failed to
     * parse, the expansion did — so it is the one document-level error with no
     * position, and the position assertion has to know that.
     */
    readonly synthesised?: true;
}

const VALID_TAIL = `capabilities: {}\n`;

export const REJECTIONS: readonly RejectionCase[] = [
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
