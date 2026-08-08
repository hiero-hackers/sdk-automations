/**
 * Locks the four security claims the workflow comments make: actions stay
 * SHA-pinned with version comments, fork code never runs through
 * `pull_request_target`, permissions stay read-only except for the explicit
 * reviewed write allowlist, and every checkout refuses to persist the token.
 * Future workflows are covered automatically because the test reads the whole
 * directory — which is the point, since the way this class of hardening
 * regresses is a NEW job that quietly omits it (D100).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lines, repoRoot, trackedFiles } from "./helpers.js";

const workflows = trackedFiles().filter(
    (path) => path.startsWith(".github/workflows/") && /\.ya?ml$/.test(path),
);

/**
 * `security-events` and `id-token` are the Scorecard SARIF upload's declared
 * needs. A future workflow that needs a write must add its file and key here
 * visibly, not by weakening the check.
 */
const WRITE_ALLOWLIST = new Set([
    ".github/workflows/scorecard.yml:security-events",
    ".github/workflows/scorecard.yml:id-token",
    // CodeQL's SARIF upload. Declared on the analyze job only, never at the
    // workflow level, so no other step can inherit it (#42).
    ".github/workflows/codeql.yml:security-events",
]);

function workflowLines(path: string): string[] {
    return lines(readFileSync(join(repoRoot, path), "utf8"));
}

function permissionWrites(path: string): string[] {
    const writes: string[] = [];
    let inPermissions = false;
    for (const line of workflowLines(path)) {
        if (/^\s*permissions:\s*$/.test(line)) {
            inPermissions = true;
            continue;
        }
        if (inPermissions) {
            const match = /^\s+([A-Za-z_-]+):\s*(read|write|none)\s*(?:#.*)?$/.exec(line);
            if (match) {
                if (match[2] === "write") writes.push(`${path}:${match[1]}`);
                continue;
            }
            if (/^\S/.test(line)) inPermissions = false;
        }
    }
    return writes;
}

describe("workflow hygiene stays a checked invariant", () => {
    it("reads every workflow file", () => {
        expect(workflows.length).toBeGreaterThan(0);
    });

    it("pins every action to a full commit SHA with a version comment", () => {
        for (const path of workflows) {
            for (const line of workflowLines(path)) {
                if (!line.includes("uses:")) continue;
                const match = /^\s*(?:-\s+)?uses:\s+([^\s#]+)\s+#\s*v.+$/.exec(line);
                expect(match, `${path}: ${line}`).not.toBeNull();
                const ref = match![1]!.split("@").at(-1)!;
                expect(ref, `${path}: ${line}`).toMatch(/^[0-9a-f]{40}$/);
            }
        }
    });

    it("never uses pull_request_target", () => {
        for (const path of workflows) {
            expect(
                workflowLines(path).join("\n"),
                `${path} must not contain pull_request_target`,
            ).not.toContain("pull_request_target");
        }
    });

    it("keeps permissions read-only outside the explicit write allowlist", () => {
        const actual = workflows.flatMap(permissionWrites);
        expect([...actual].sort()).toEqual([...WRITE_ALLOWLIST].sort());
    });

    /**
     * The other half of `permissions: contents: read`. Without this flag the
     * token is written into `.git/config` and stays readable to every later
     * step; `ci.yml` claims in a comment that every checkout sets it, and a
     * claim in this repository becomes an invariant.
     */
    it("never persists the token past checkout", () => {
        const missing: string[] = [];
        for (const path of workflows) {
            const body = workflowLines(path);
            body.forEach((line, i) => {
                if (!/uses:\s+actions\/checkout@/.test(line)) return;
                // The `with:` block belongs to this step: scan forward until
                // the next step (`- `) at the same or shallower indentation.
                const indent = line.search(/\S/);
                let persists = false;
                for (let j = i + 1; j < body.length; j++) {
                    const next = body[j]!;
                    if (next.trim() === "") continue;
                    if (next.search(/\S/) <= indent && /^\s*-\s/.test(next)) break;
                    if (next.search(/\S/) <= indent && next.trim() !== "") break;
                    if (/persist-credentials:\s*false/.test(next)) {
                        persists = true;
                        break;
                    }
                }
                if (!persists) missing.push(`${path}:${String(i + 1)}`);
            });
        }
        expect(missing).toEqual([]);
    });

    it("proves the pin check can fail in both directions", () => {
        const pin = (ref: string): boolean => /^[0-9a-f]{40}$/.test(ref);
        expect(pin("v4")).toBe(false);
        expect(pin("3d3c42e5aac5ba805825da76410c181273ba90b1")).toBe(true);
    });
});
