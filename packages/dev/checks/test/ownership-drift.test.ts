/**
 * `design/contracts/taxonomy.md` §2.1 holds two tables to the shipped declarations: an automatic
 * edge's owner is the capability whose `moves` names its cause, and a position's readers are the
 * capabilities whose `reads` name it (D220, D243). Prose in a cell — "A person", "None", "—" — names
 * no capability.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
    CLOSURE_CAUSES,
    ISSUE_EDGES,
    MAPPABLE_MEANINGS,
    PR_EDGES,
} from "@hiero-hackers/automation-core";
import { shippedCapabilities } from "./capabilities.js";
import { normalizeNewlines, repoRoot } from "./repository.js";

const DOC = join(repoRoot, "design", "contracts", "taxonomy.md");

const HEADING = "### 2.1 Current capability interactions";

const sectionOf = (markdown: string): string =>
    markdown.split(HEADING)[1]?.split(/^#{2,3} /m)[0] ?? "";

const namesIn = (cell: string): string[] => [...cell.matchAll(/`(\w+)`/g)].map((m) => m[1]!).sort();

const edgeKey = (from: string | null, to: string, cause: string): string =>
    `${from ?? "∅"} → ${to} (${cause})`;

/** The four-column edge rows: from (∅ for none), to, cause, and the owners the cell names. */
function documentedEdges(markdown: string): Record<string, string[]> {
    const rows = sectionOf(markdown).matchAll(
        /^\|\s*(∅|`\w+`)\s*\|\s*`(\w+)`\s*\|\s*`(\w+)`\s*\|([^|]*)\|/gm,
    );
    return Object.fromEntries(
        [...rows].map(([, from, to, cause, owner]) => [
            edgeKey(from === "∅" ? null : from!.slice(1, -1), to!, cause!),
            namesIn(owner!),
        ]),
    );
}

/** The two-column reader rows: a position, and the readers the cell names. */
function documentedReaders(markdown: string): Record<string, string[]> {
    const rows = sectionOf(markdown).matchAll(/^\|\s*`(\w+)`\s*\|([^|]*)\|\s*$/gm);
    return Object.fromEntries(
        [...rows].map(([, meaning, readers]) => [meaning!, namesIn(readers!)]),
    );
}

/** Every edge into a position, per cause, and the shipped capabilities whose `moves` own it. */
function declaredOwners(): Record<string, string[]> {
    const shipped = shippedCapabilities();
    const owners: Record<string, string[]> = {};
    for (const edge of [...ISSUE_EDGES, ...PR_EDGES]) {
        if (edge.to === null) continue;
        for (const cause of edge.causes) {
            if (CLOSURE_CAUSES.some((closing) => closing === cause)) continue;
            owners[edgeKey(edge.from, edge.to, cause)] = shipped
                .filter(({ moves }) => moves.includes(cause))
                .map(({ name }) => name)
                .sort();
        }
    }
    return owners;
}

/** Every position, and the shipped capabilities whose `reads` name it; `blocked` is a marker. */
function declaredReaders(): Record<string, string[]> {
    const shipped = shippedCapabilities();
    return Object.fromEntries(
        MAPPABLE_MEANINGS.filter((meaning) => meaning !== "blocked").map((meaning) => [
            meaning,
            shipped
                .filter(({ reads }) => reads.includes(meaning))
                .map(({ name }) => name)
                .sort(),
        ]),
    );
}

describe("taxonomy.md §2.1 holds its tables to the declarations", () => {
    const markdown = normalizeNewlines(readFileSync(DOC, "utf8"));

    it("names exactly the owner of every automatic edge", () => {
        expect(documentedEdges(markdown), `update the edge table under ${HEADING}`).toEqual(
            declaredOwners(),
        );
    });

    it("names exactly the readers of every position", () => {
        expect(documentedReaders(markdown), `update the reader table under ${HEADING}`).toEqual(
            declaredReaders(),
        );
    });

    it("reads backticked names, treats prose as no capability, and stops at the next heading", () => {
        const sample = [
            HEADING,
            "",
            "| From | To | Cause | Owner |",
            "|---|---|---|---|",
            "| ∅ | `awaitingTriage` | `intakeObserved` | `b`, `a` |",
            "| `awaitingTriage` | `ready` | `triageCompleted` | A person |",
            "",
            "| Position | Read by |",
            "|---|---|",
            "| `ready` | `b` |",
            "| `inProgress` | — |",
            "",
            "### 2.2 Next",
            "| `blocked` | `ignored` |",
        ].join("\n");
        expect(documentedEdges(sample)).toEqual({
            "∅ → awaitingTriage (intakeObserved)": ["a", "b"],
            "awaitingTriage → ready (triageCompleted)": [],
        });
        expect(documentedReaders(sample)).toEqual({ ready: ["b"], inProgress: [] });
    });
});
