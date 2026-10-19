/** What this layer gives back: the error types and the one constructor (D103). */

import type { RepositoryConfig } from "./schema.js";

/** Why a configuration was rejected, in a form a report can use (D75). */
export type ConfigErrorCode =
    /** Document-level: only `parseConfigDocument` sees text. */
    | "documentUnparseable"
    | "duplicateKey"
    | "notAMapping"
    | "unknownKey"
    | "schemaVersionUnsupported"
    | "modeInvalid"
    | "capabilityNameInvalid"
    | "capabilityEnabledNotBoolean"
    /** A block states a mode above the file's, which bounds every capability. */
    | "capabilityModeAboveFile"
    | "capabilityUnknown"
    /** A settings VALUE the admitted capability's spec cannot read. */
    | "settingInvalid"
    | "meaningNotMappable"
    | "meaningRequired"
    | "labelInvalid"
    | "labelNotInjective"
    | "commandNotMappable"
    | "commandInvalid"
    | "commandNotInjective"
    | "skillNotMappable"
    | "skillInvalid"
    | "skillNotInjective"
    | "alertInvalid"
    | "alertNotInjective"
    | "principalNameInvalid"
    | "principalNotAString";

/**
 * One reason a document was rejected. `path` is dotted, like
 * `capabilities.triageQueue.enabled`, or `null`; the code and the path are the contract.
 */
export interface ConfigError {
    readonly code: ConfigErrorCode;
    /** For a maintainer. Never asserted on, only its presence. */
    readonly message: string;
    readonly path: string | null;
    /** 1-based, into the document text. Absent unless `path` resolves. */
    readonly line?: number;
}

/** Parsed, or rejected with reasons. Never both. */
export type ConfigResult =
    | { readonly ok: true; readonly config: RepositoryConfig }
    | { readonly ok: false; readonly errors: readonly ConfigError[] };

/** One section's outcome. A value exists only when the section is valid. */
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
