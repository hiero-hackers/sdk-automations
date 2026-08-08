/**
 * The local-only layers stay out of the repository — generalised from the
 * lab's own check after the shell arrived without one (D99).
 *
 * Every layer below holds material that must never reach a commit, and each
 * is protected by a single `.gitignore` line that a `git add -f`, or a
 * directory move that leaves the rule stale, bypasses in silence. The
 * asymmetry that prompted this file: the lab's layer had this check and the
 * shell's did not, although the shell's is arguably worse — its SQLite store
 * holds the RAW webhook payload bytes until a delivery completes, and its
 * decision journal names real repositories and issues, neither of them
 * scrubbed, because scrubbing is the lab's job and the shell has none.
 *
 * Three assertions per layer, deliberately overlapping:
 *
 * 1. the rule is still WRITTEN — fails the moment someone deletes it, which
 *    is before anything leaks rather than after;
 * 2. the rule still WORKS — `git check-ignore` tests the effect, catching a
 *    later negation or a pattern that stopped matching after a move;
 * 3. nothing under it is TRACKED — the invariant itself, and the only one of
 *    the three that a forced add cannot slip past.
 */

import { describe, expect, it } from "vitest";
import { execFileSync, execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lines, repoRoot } from "./helpers.js";

interface Layer {
    /** The exact `.gitignore` line, and the prefix git is asked about. */
    readonly rule: string;
    /** What would leak. Prose, so a failure explains itself. */
    readonly holds: string;
}

const LAYERS: readonly Layer[] = [
    {
        rule: "packages/lab/harness/",
        holds: "era-1 harness code and the private, unscrubbed evidence archive",
    },
    {
        rule: "packages/lab/evidence/",
        holds: "captures staged for human review before promotion (protocol 7.1)",
    },
    {
        rule: "packages/lab/.env",
        holds: "the sandbox App's credentials",
    },
    {
        rule: "packages/shell/data/",
        holds: "the operational store — RAW webhook payload bytes — and the decision journal naming real repositories",
    },
];

const tracked = (path: string): string[] =>
    lines(
        execFileSync("git", ["ls-files", "--", path], {
            cwd: repoRoot,
            encoding: "utf8",
        }),
    ).filter(Boolean);

/** `git check-ignore` exits 1 when the path is NOT ignored, so a throw is a false. */
function ignored(path: string): boolean {
    try {
        execSync(`git check-ignore -q -- ${JSON.stringify(path)}`, {
            cwd: repoRoot,
            stdio: "ignore",
        });
        return true;
    } catch {
        return false;
    }
}

describe("the local-only layers stay out of the repository", () => {
    const ignoreLines = lines(readFileSync(join(repoRoot, ".gitignore"), "utf8"));

    it("covers every layer that exists", () => {
        // Guards against the table silently emptying, which would pass every
        // assertion below in silence — the vacuous-glob failure shape again.
        expect(LAYERS.length).toBeGreaterThanOrEqual(4);
        expect(LAYERS.map((l) => l.rule)).toContain("packages/shell/data/");
    });

    it.each(LAYERS)("$rule is still ignored by rule", ({ rule }) => {
        expect(ignoreLines).toContain(rule);
    });

    it.each(LAYERS)("$rule is still ignored in effect", ({ rule }) => {
        // A written rule that no longer matches is the failure the packages/
        // move nearly shipped: the text said `lab/harness/` while the
        // directory had become `packages/lab/harness/` (D95).
        expect(ignored(rule)).toBe(true);
    });

    it.each(LAYERS)("git tracks nothing under $rule ($holds)", ({ rule, holds }) => {
        expect(tracked(rule), `${rule} would leak ${holds}`).toEqual([]);
    });

    it("proves the instruments can fail", () => {
        // The same commands on a tracked, non-ignored path answer the other
        // way, so an empty result above means "nothing tracked", not
        // "command broken".
        expect(tracked("packages/core/package.json")).toEqual(["packages/core/package.json"]);
        expect(ignored("packages/core/package.json")).toBe(false);
    });
});
