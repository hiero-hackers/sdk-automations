/**
 * The permission SHAPE, tested where it is decided.
 *
 * `missingPermissions` had coverage only through the safety rules, and
 * `isPermissionGrant` had none at all — the 2026-08-15 mutation run scored
 * this module at 40.00% with every pattern mutant alive, which is what a
 * regex nobody calls looks like from the outside. The pattern is the whole
 * content of the module (`design/guides/capabilities` keeps the ratified CEILING
 * elsewhere), so the rows below are the specification: what GitHub's
 * `scope:level` form admits, and what it must not.
 */

import { describe, expect, it } from "vitest";
import {
    isPermissionGrant,
    missingPermissions,
    type PermissionGrant,
} from "../../src/github/index.js";

describe("isPermissionGrant — GitHub's scope:level form", () => {
    it.each([
        ["issues:write", "the commonest grant there is"],
        ["issues:read", "read is the other level"],
        ["pull_requests:read", "underscores are how GitHub spells multi-word scopes"],
        ["a:read", "a one-character scope is still a scope"],
    ])("accepts %s — %s", (value) => {
        expect(isPermissionGrant(value)).toBe(true);
    });

    it.each([
        ["Issues:write", "scopes are lowercase; a capital is a different string to GitHub"],
        ["_issues:write", "a scope starts with a letter, never an underscore"],
        ["1issues:write", "nor with a digit"],
        ["issues:admin", "admin is not a level this platform recognises"],
        ["issues:", "a scope with no level grants nothing"],
        [":write", "a level with no scope names nothing"],
        ["issues", "the colon is not optional"],
        ["", "the empty string is not a grant"],
        ["issues-write", "a hyphen is not the separator"],
        ["issues:writing", "the level is exact, not a prefix"],
        ["issues:write:extra", "nothing may follow the level"],
        ["needs issues:write", "and nothing may precede the scope"],
    ])("rejects %s — %s", (value) => {
        expect(isPermissionGrant(value)).toBe(false);
    });
});

describe("missingPermissions — the absent ones, named (D77)", () => {
    it("answers nothing when the installation holds everything required", () => {
        expect(missingPermissions(["issues:write"], ["issues:write", "contents:read"])).toEqual([]);
    });

    it("requiring nothing is satisfied by holding nothing", () => {
        expect(missingPermissions([], [])).toEqual([]);
    });

    it("returns the absent grants themselves, not a count or a boolean", () => {
        expect(
            missingPermissions(["issues:write", "contents:write", "checks:read"], ["issues:write"]),
        ).toEqual(["contents:write", "checks:read"]);
    });

    it("holding read does not satisfy a requirement for write", () => {
        expect(missingPermissions(["issues:write"], ["issues:read"])).toEqual(["issues:write"]);
    });

    /**
     * The ladder, both directions. Exact set membership made an installation
     * holding `issues:write` fail a requirement of `issues:read` — a
     * `permissionMissing` refusal shown to a maintainer whose grants were
     * already correct, which sends them to fix a working installation.
     */
    it("holding write satisfies a requirement for read on the same resource", () => {
        expect(missingPermissions(["issues:read"], ["issues:write"])).toEqual([]);
        expect(missingPermissions(["issues:read"], ["issues:read"])).toEqual([]);
    });

    it("the ladder is per resource: another resource's write satisfies nothing", () => {
        expect(missingPermissions(["issues:read"], ["contents:write"])).toEqual(["issues:read"]);
        // The prefix is not a resource: `issues_events` is its own scope.
        expect(missingPermissions(["issues:read"], ["issues_events:write"])).toEqual([
            "issues:read",
        ]);
    });

    it("answers a malformed requirement by exact membership, and never throws", () => {
        const malformed = ["issues", ":read", "read", ""] as unknown as readonly PermissionGrant[];
        expect(() => missingPermissions(malformed, ["issues:write"])).not.toThrow();
        expect(missingPermissions(malformed, ["issues:write"])).toEqual([
            "issues",
            ":read",
            "read",
            "",
        ]);
        // Held exactly, a malformed string still satisfies itself: this
        // function judges membership, never grant validity.
        expect(missingPermissions(malformed, malformed)).toEqual([]);
    });
});
