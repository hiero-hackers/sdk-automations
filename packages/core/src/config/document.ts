/**
 * The layer between a file on disk and `parseConfig` — the one nobody had
 * written.
 *
 * `parseConfig` takes `unknown`, and every caller so far handed it an object
 * literal. That left the ON-DISK format unspecified: `design/config/schema.md`
 * §3 showed YAML, no code had ever read YAML, and a document could therefore
 * fail in ways the error catalogue had no word for. `examples/config/` is the
 * first consumer that starts from text, and it could not exist without this.
 *
 * Still pure. Text in, result out; the shell reads the bytes.
 */

import { parseDocument, type YAMLError } from "yaml";
import { parseConfig } from "./parse.js";
import { err } from "./validate.js";
import type { ConfigError, ConfigResult, ParseConfigOptions } from "./schema.js";

/**
 * Anchors and aliases can expand quadratically — the "billion laughs" shape —
 * and a reviewed configuration file is attacker-adjacent: it arrives in a pull
 * request from anyone. The library defaults to 100; this is lower because a
 * repository configuration has no legitimate use for aliases at all, and the
 * cheapest bound is the one no honest document approaches.
 */
const MAX_ALIAS_COUNT = 10;

/**
 * A YAML-level problem, classified.
 *
 * The library's own message is used verbatim because it ALREADY carries the
 * position and a source excerpt — "Map keys must be unique at line 2, column
 * 1:" followed by the offending lines and a caret. An earlier draft here read
 * `error.linePos` and appended a second copy of the same fact, which is the
 * defect this package spent D53, D62, D67, D73, D76 and D77 removing, arrived
 * at by not reading what the dependency already gives. `linePos` and the
 * position in the message are also the same switch — `prettyErrors`, on by
 * default — so the guard for an absent `linePos` was covering a case that
 * cannot occur.
 *
 * `ConfigError.path` stays null: a path is a dotted route into a MAPPING, and
 * a file that never became one has none. The named alternative is a structured
 * `position` field, deferred because it widens a type every consumer reads for
 * one producer's benefit.
 *
 * `duplicateKey` is separated from the rest because it is the only one that
 * SUCCEEDS. YAML resolves a repeated key to its last value, so a file saying
 * `mode: observe` and later `mode: active` parses cleanly into a repository
 * that writes — the maintainer's stated intent silently overridden by their
 * own typo. Every other syntax error yields no document at all, which is loud.
 */
function documentError(error: YAMLError): ConfigError {
    return error.code === "DUPLICATE_KEY"
        ? err(
              "duplicateKey",
              `${error.message}\nYAML keeps the LAST value, so the earlier one is silently discarded.`,
              null,
          )
        : err("documentUnparseable", error.message, null);
}

/**
 * Parse a configuration FILE.
 *
 * Syntax errors are reported together rather than one per push, matching what
 * `parseConfig` already does for semantic errors. A document that will not
 * parse is never handed onward: there is nothing to validate, and guessing at
 * a half-read file is how a fail-closed parser accidentally fails open.
 */
export function parseConfigDocument(text: string, options: ParseConfigOptions): ConfigResult {
    const document = parseDocument(text);

    if (document.errors.length > 0) {
        return { ok: false, errors: document.errors.map(documentError) };
    }

    /**
     * `toJS` THROWS when the alias budget is exceeded — it does not report the
     * problem the way a parse error is reported. Nothing else in the
     * configuration layer throws, and a caller that had to guard this one
     * would be guarding it in the shell, on input arriving from a pull
     * request. Converted here, so `parseConfigDocument` keeps `parseConfig`'s
     * property: every rejection is a value.
     */
    let value: unknown;
    try {
        value = document.toJS({ maxAliasCount: MAX_ALIAS_COUNT });
    } catch (_cause) {
        return {
            ok: false,
            errors: [
                err(
                    "documentUnparseable",
                    `the document expands to more than ${MAX_ALIAS_COUNT} YAML aliases and was not read; a repository configuration has no legitimate use for anchors at that scale`,
                    null,
                ),
            ],
        };
    }

    /**
     * An empty file is not an error. schema.md §2.2 — no configuration causes
     * no workflow-changing writes — and `parseConfig` already answers `null`
     * with `NO_CONFIG`, so an empty file and an absent file agree by
     * construction rather than by two code paths that happen to match.
     */
    return parseConfig(value, options);
}
