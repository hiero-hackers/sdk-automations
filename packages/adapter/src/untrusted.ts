/**
 * Reading bytes GitHub sent, without trusting them.
 *
 * Every reader here is total: a bad shape answers `null` or `undefined`,
 * never a throw. Response-body parsers across the package read in this one
 * idiom, so a shape surprise is a value a pipeline can refuse — and the
 * next operation does not invent a second dialect.
 */

/**
 * A property read that cannot throw, whatever shape arrived.
 *
 * Own properties only. A plain `[name]` read walks the prototype chain, so
 * `field(response, "__proto__")` answers `Object.prototype` and
 * `"constructor"` or `"toString"` answer functions — values GitHub never
 * sent, arriving as if it had. The caller checks the type it wants next,
 * but "absent" is the honest answer, and it is the one a caller can refuse.
 */
export const field = (value: unknown, name: string): unknown =>
    typeof value === "object" && value !== null && Object.hasOwn(value, name)
        ? (value as Record<string, unknown>)[name]
        : undefined;

/** The body as a JSON object, or `null` when it is anything else. */
export function jsonRecordOf(body: string): Record<string, unknown> | null {
    let parsed: unknown;
    // Stryker disable BlockStatement: an emptied catch leaves parsed undefined, and the shape checks answer null anyway.
    try {
        parsed = JSON.parse(body);
    } catch {
        return null;
    }
    // Stryker restore BlockStatement
    // Stryker disable next-line ConditionalExpression: when parsed IS null the mutant returns parsed — the same null. The arm is for readers.
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
}

/** The body as a JSON array, or `null` when it is anything else. */
export function jsonArrayOf(body: string): readonly unknown[] | null {
    let parsed: unknown;
    // Stryker disable BlockStatement: an emptied catch leaves parsed undefined, and the shape checks answer null anyway.
    try {
        parsed = JSON.parse(body);
    } catch {
        return null;
    }
    // Stryker restore BlockStatement
    return Array.isArray(parsed) ? parsed : null;
}
