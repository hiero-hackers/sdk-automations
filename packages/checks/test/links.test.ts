/**
 * The eighth invariant, and the blind spot that made the packages/ move
 * (D95) unverifiable by eye.
 *
 * `citations.test.ts` checks paths written from the REPOSITORY ROOT —
 * `packages/core/src/….ts`, `design/….md`. It has never checked a
 * RELATIVE markdown link, and relative links are exactly what breaks when
 * a directory moves: the text still reads correctly, the target no longer
 * exists, and no test notices. Three documents proved it — `probes/`
 * pointed at `../experiments/README.md` (renamed to `lab/` two
 * reorganisations ago) and two lab protocols pointed at design documents
 * that were never lab's neighbours. All three predate D95 and none had
 * ever failed a check.
 *
 * Resolution is per-file, the way a reader's click resolves it.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { lines, normalizeRepoPath, repoRoot, trackedFiles } from "./helpers.js";

/** `[text](target)` — the target only, before any `#anchor` or title. */
const LINK = /\]\(([^)\s]+)/g;

/** Links this check cannot resolve: the web, anchors, mail. */
function isLocal(target: string): boolean {
    return (
        !/^[a-z][a-z0-9+.-]*:/i.test(target) && !target.startsWith("#") && !target.startsWith("//")
    );
}

export function danglingLinks(doc: string, text: string): string[] {
    const from = dirname(join(repoRoot, doc));
    const bad: string[] = [];
    for (const match of text.matchAll(LINK)) {
        const target = match[1]!.split("#")[0]!;
        if (target === "" || !isLocal(target)) continue;
        // A root-relative target ("/docs/x.md") resolves from the root;
        // everything else resolves from the document's own directory.
        const resolved = target.startsWith("/")
            ? join(repoRoot, target.slice(1))
            : resolve(from, target);
        if (!existsSync(resolved)) bad.push(`${doc} -> ${target}`);
    }
    return bad;
}

describe("markdown links resolve from the document that carries them", () => {
    const docs = trackedFiles()
        .filter((rel) => rel.endsWith(".md"))
        .map((rel) => ({
            doc: rel,
            text: readFileSync(join(repoRoot, rel), "utf8"),
        }));

    it("finds documents and links to check", () => {
        expect(docs.length).toBeGreaterThan(5);
        const total = docs.reduce((n, d) => n + [...d.text.matchAll(LINK)].length, 0);
        expect(total).toBeGreaterThan(20);
    });

    it("every local link points at a file that exists", () => {
        const bad = docs.flatMap(({ doc, text }) => danglingLinks(doc, text));
        expect([...new Set(bad)]).toEqual([]);
    });

    it("proves the check can fail, and skips what it cannot resolve", () => {
        const fake = [
            "[gone](../nowhere/absent.md)",
            "[web](https://example.com/x.md)",
            "[anchor](#section)",
            "[real](helpers.ts)",
        ].join(" ");
        // Resolution is relative to this file's own directory, so the
        // sibling resolves and the invented parent does not.
        const bad = danglingLinks("packages/checks/test/links.test.ts", fake);
        expect(bad).toEqual(["packages/checks/test/links.test.ts -> ../nowhere/absent.md"]);
    });

    it("normalizes the way the other repository checks do", () => {
        expect(normalizeRepoPath("a\\b.md")).toBe("a/b.md");
        expect(lines("a\r\nb")).toEqual(["a", "b"]);
    });
});
