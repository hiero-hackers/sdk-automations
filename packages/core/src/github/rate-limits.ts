/**
 * Parsing and automatic-wait bounds for GitHub rate-limit headers.
 *
 * GitHub documents these fields as whole seconds. JavaScript's
 * `Number("") === 0` coercion is therefore unsafe here: a malformed
 * response must not turn into an immediate retry.
 */

export type ParsedSecondsHeader =
    | { readonly kind: "missing" }
    | { readonly kind: "invalid"; readonly rawValue: string }
    | { readonly kind: "valid"; readonly seconds: number };

/**
 * Longer waits belong in durable scheduling or operator handling, not
 * in the automatic retry path. One hour covers GitHub's normal primary
 * rate-limit window without permitting an unbounded in-process timer.
 */
export const MAX_AUTOMATIC_RATE_LIMIT_WAIT_SECONDS = 60 * 60;

/** Parse a GitHub whole-seconds header without permissive number coercion. */
export function parseSecondsHeader(rawValue: string | undefined): ParsedSecondsHeader {
    if (rawValue === undefined) return { kind: "missing" };
    if (!/^\d+$/.test(rawValue)) {
        return { kind: "invalid", rawValue };
    }

    const seconds = Number(rawValue);
    return Number.isSafeInteger(seconds)
        ? { kind: "valid", seconds }
        : { kind: "invalid", rawValue };
}
