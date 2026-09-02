/**
 * GitHub's permission strings, as a shape rather than a list.
 *
 * The FORM is a GitHub fact — `scope:level` — so it belongs here. The
 * ratified permission CEILING is a project decision and does not: that stays
 * with the register and the App manifest. This file says what a permission
 * looks like, never which ones we ask for.
 *
 * A validated template type rather than a closed union, so the platform
 * needs no edit when GitHub adds a scope.
 */

export type PermissionGrant = `${string}:${"read" | "write"}`;

const PERMISSION_PATTERN = /^[a-z][a-z_]*:(read|write)$/;

/** Runtime check for a value that arrives as an ordinary string. */
export function isPermissionGrant(value: string): value is PermissionGrant {
    return PERMISSION_PATTERN.test(value);
}

const READ_SUFFIX = ":read";

/**
 * The write grant on the same resource, when the requirement is a read one.
 *
 * GitHub's levels are a ladder per resource, so `issues:write` covers
 * `issues:read` and never the reverse. Total on a malformed string: anything
 * not ending in `:read` has no wider grant and is answered by exact
 * membership alone.
 */
function widerGrantFor(required: PermissionGrant): PermissionGrant | null {
    return required.endsWith(READ_SUFFIX)
        ? `${required.slice(0, -READ_SUFFIX.length)}:write`
        : null;
}

/**
 * Does an installation's grant cover everything an operation needs?
 *
 * Returns the MISSING grants, not a boolean. An operator message that names
 * the absent permission is the difference between a fix and an investigation
 * (D77) — and a maintainer told `issues:read` is missing while the App holds
 * `issues:write` is sent to fix a working installation.
 */
export function missingPermissions(
    required: readonly PermissionGrant[],
    granted: readonly PermissionGrant[],
): readonly PermissionGrant[] {
    const held: ReadonlySet<string> = new Set(granted);
    return required.filter((r) => {
        const wider = widerGrantFor(r);
        return !held.has(r) && (wider === null || !held.has(wider));
    });
}
