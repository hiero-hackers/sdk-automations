/**
 * What this layer gives back, and how it is built.
 *
 * The error types and the one constructor that makes them live together
 * here, rather than the type in `schema.ts` and `err` in the checker, which
 * is how they sat until D103. Every producer — `sections.ts`, `document.ts`,
 * `parse.ts` — needs both.
 *
 * `Checked` is deliberately absent from the package barrel: it is the shape
 * sections speak to each other in, not part of core's public surface.
 */

import type { RepositoryConfig } from "./schema.js";

/** Why a configuration was rejected, in a form a report can use (D75). */
export type ConfigErrorCode =
    /** Document-level. Only `parseConfigDocument` sees text, so only it
     * reports these. */
    | "documentUnparseable"
    | "duplicateKey"
    | "notAMapping"
    | "unknownKey"
    | "schemaVersionUnsupported"
    | "modeInvalid"
    | "capabilityNameInvalid"
    | "capabilityEnabledNotBoolean"
    | "capabilityUnknown"
    | "meaningNotMappable"
    | "meaningRequired"
    | "labelInvalid"
    | "labelNotInjective"
    | "principalNotAString";

/**
 * One reason a document was rejected.
 *
 * `path` is dotted, like `capabilities.intake.enabled`, or `null` for a
 * whole-document problem. A check run uses it to annotate one line instead
 * of pasting a paragraph.
 */
export interface ConfigError {
    readonly code: ConfigErrorCode;
    /** For a maintainer. Never asserted on, only its presence. */
    readonly message: string;
    readonly path: string | null;
}

/** Parsed, or rejected with reasons. Never both. */
export type ConfigResult =
    | { readonly ok: true; readonly config: RepositoryConfig }
    | { readonly ok: false; readonly errors: readonly ConfigError[] };

/**
 * One section's outcome. A value exists only when the section is valid.
 *
 * The alternative, `{ value, errors }` always populated, makes the value
 * meaningless without checking a list somewhere else. Splitting into a check
 * pass and a build pass was also rejected: the builder would assume what the
 * checker guarantees, with nothing tying the two together (D77).
 */
export type Checked<T> =
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly errors: readonly ConfigError[] };

/** One constructor, so every error is shaped the same way. */
export function err(
    code: ConfigErrorCode,
    message: string,
    path: string | null = null,
): ConfigError {
    return { code, message, path };
}

/** Fold a section's accumulated errors into a result. */
export function checked<T>(value: T, errors: readonly ConfigError[]): Checked<T> {
    return errors.length > 0 ? { ok: false, errors } : { ok: true, value };
}
