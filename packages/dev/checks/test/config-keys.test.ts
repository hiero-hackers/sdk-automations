/**
 * Every configuration key a repository may write is a promise: the top-level
 * keys, the `mappings:` families, and each shipped capability's settings, as
 * `docs/capabilities.md`'s generated tree lists them. `fixtures/config-keys.json`
 * is the baseline of that promise. A key that vanishes breaks a file somebody
 * already wrote; a key that appears is a new commitment. Neither happens by
 * accident — the fixture is edited in the same change, on purpose.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readGeneratedBlock } from "./generated.js";
import { repoRoot } from "./repository.js";

interface Baseline {
    readonly topLevel: readonly string[];
    readonly mappings: readonly string[];
    readonly capabilities: readonly string[];
}

/** The string members of `export const NAME = [...]`, following `...OTHER` spreads. */
function arrayMembers(schemaText: string, name: string): string[] {
    const body = new RegExp(`const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\]`).exec(schemaText)?.[1] ?? "";
    return [...body.matchAll(/\.\.\.([A-Z_]+)|"([A-Za-z]+)"/g)].flatMap((m) =>
        m[1] !== undefined ? arrayMembers(schemaText, m[1]) : [m[2]!],
    );
}

/**
 * Every key path in the settings block, dotted from the capability's name:
 * `inactivity.issues.reap.after`. A key shown only as a commented `# guide:`
 * line is still a key a repository may write.
 */
function settingsPaths(block: string): string[] {
    const paths: string[] = [];
    let capability = "";
    let stack: string[] = [];
    for (const line of block.split("\n")) {
        const heading = /^### `([A-Za-z]+)`$/.exec(line);
        if (heading) {
            capability = heading[1]!;
            stack = [];
            paths.push(capability);
            continue;
        }
        const key = /^( *)(?:# )?([A-Za-z][A-Za-z0-9]*):(?: |$)/.exec(line);
        if (capability === "" || !key) continue;
        stack = [...stack.slice(0, key[1]!.length / 2), key[2]!];
        paths.push([capability, ...stack].join("."));
    }
    return paths;
}

function currentKeys(): Baseline {
    const schema = readFileSync(join(repoRoot, "packages/core/src/config/schema.ts"), "utf8");
    const page = readFileSync(join(repoRoot, "docs/capabilities.md"), "utf8");
    return {
        topLevel: arrayMembers(schema, "TOP_LEVEL_KEYS"),
        mappings: arrayMembers(schema, "MAPPING_SECTION_KEYS"),
        capabilities: settingsPaths(readGeneratedBlock(page, "settings") ?? ""),
    };
}

/** Every path as one flat, labelled list, so a difference names where it is. */
function flat(keys: Baseline): string[] {
    return [
        ...keys.topLevel.map((key) => `top-level: ${key}`),
        ...keys.mappings.map((key) => `mappings: ${key}`),
        ...keys.capabilities.map((key) => `capabilities: ${key}`),
    ];
}

function drift(baseline: Baseline, current: Baseline): { vanished: string[]; added: string[] } {
    const was = new Set(flat(baseline));
    const is = new Set(flat(current));
    return {
        vanished: [...was].filter((key) => !is.has(key)),
        added: [...is].filter((key) => !was.has(key)),
    };
}

describe("the configuration keys", () => {
    const baseline = JSON.parse(
        readFileSync(join(repoRoot, "packages/dev/checks/test/fixtures/config-keys.json"), "utf8"),
    ) as Baseline;
    const current = currentKeys();

    it("still accept every key the baseline lists", () => {
        expect(flat(current).length).toBeGreaterThan(0);
        expect(drift(baseline, current).vanished).toEqual([]);
    });

    it("accept no key the baseline does not list", () => {
        expect(drift(baseline, current).added).toEqual([]);
    });

    it("proves the check can fail", () => {
        const schema = 'const A = ["x", "y"] as const;\nconst B = [...A, "z"] as const;';
        expect(arrayMembers(schema, "B")).toEqual(["x", "y", "z"]);

        const block = [
            "### `cap`",
            "```yaml",
            "enabled: true",
            "# mode: dry-run — optional; m",
            "group: # default — d",
            '  # guide: "…" — optional; g',
            "  after: 1d",
            "```",
            "### `empty`",
            "No settings.",
        ].join("\n");
        expect(settingsPaths(block)).toEqual([
            "cap",
            "cap.enabled",
            "cap.mode",
            "cap.group",
            "cap.group.guide",
            "cap.group.after",
            "empty",
        ]);

        const small: Baseline = { topLevel: ["mode"], mappings: [], capabilities: ["cap.a"] };
        const renamed: Baseline = { topLevel: ["mode"], mappings: [], capabilities: ["cap.b"] };
        expect(drift(small, renamed)).toEqual({
            vanished: ["capabilities: cap.a"],
            added: ["capabilities: cap.b"],
        });

        // A baseline missing a block's `mode` row is a key the page offers and nobody declared.
        const withoutMode: Baseline = { topLevel: [], mappings: [], capabilities: ["cap"] };
        const withMode: Baseline = {
            topLevel: [],
            mappings: [],
            capabilities: ["cap", "cap.mode"],
        };
        expect(drift(withoutMode, withMode)).toEqual({
            vanished: [],
            added: ["capabilities: cap.mode"],
        });
    });
});
