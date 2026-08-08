/**
 * Source files stay readable to text tools — the invariant born from the NUL
 * byte that turned a source file binary to grep (D74's neighbourhood).
 * Split from repo-artifacts.test.ts (D89).
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { repoRoot, workspacePackages } from "./helpers.js";

function typescriptFiles(): string[] {
    const found: string[] = [];
    for (const pkg of workspacePackages()) {
        for (const dir of ["src", "test"]) {
            const root = join(repoRoot, pkg, dir);
            let entries: string[];
            try {
                entries = readdirSync(root, { recursive: true }) as string[];
            } catch {
                continue; // a package need not have both directories
            }
            found.push(
                ...entries.filter((rel) => rel.endsWith(".ts")).map((rel) => join(root, rel)),
            );
        }
    }
    return found;
}

describe("source files stay readable to text tools", () => {
    const files = typescriptFiles();

    it("finds the workspace's TypeScript sources", () => {
        // Guards against the walk silently returning nothing, which would
        // make every assertion below vacuously true.
        expect(files.length).toBeGreaterThan(20);
    });

    it("contains no control characters that make a file read as binary", () => {
        // Tab, newline and carriage return only. Anything else in this range
        // makes grep report "Binary file matches" and stops diffs rendering.
        const offenders: string[] = [];
        for (const file of files) {
            const bytes = readFileSync(file);
            for (const byte of bytes) {
                if (byte > 0x1f) continue;
                if (byte === 0x09 || byte === 0x0a || byte === 0x0d) continue;
                offenders.push(`${file.replace(repoRoot, "")} (byte 0x${byte.toString(16)})`);
                break;
            }
        }
        expect(offenders).toEqual([]);
    });
});
