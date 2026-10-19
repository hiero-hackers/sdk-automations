/**
 * Several `docs/` tables restate closed vocabularies the code owns — one fact
 * in two places, aimed at a reader who cannot run the compiler that would catch
 * the drift (D83). This file locks the identifier columns and severity groups
 * it names below; explanatory and behavior prose remains review-owned. Where
 * no runtime array exists, a mapped type makes a new code fail to compile until
 * the corresponding documented vocabulary follows (D76).
 *
 * The last describe locks a different kind of documented fact — the commands a
 * contributor is TOLD to run — for the same reason, and lives here rather than
 * in a file of its own now that it is one loop each way.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
    duration,
    flag,
    MAPPABLE_MEANINGS,
    REPOSITORY_MODES,
    spec,
    text,
    TOP_LEVEL_KEYS,
    type ConfigErrorCode,
} from "@hiero-hackers/automation-core";
import type { RecordOnlyCode, SafetyRefusalCode } from "@hiero-hackers/automation-core";
import { verdictFinding, type Severity } from "@hiero-hackers/automation-core";
import { shippedCapabilities } from "./capabilities.js";
import { renderEditorSchema, SCHEMA_PATH, SCHEMA_URL } from "./editor-schema.js";
import {
    readGeneratedBlock,
    renderCapabilityTable,
    renderSettingsTrees,
    settingsTree,
} from "./generated.js";
import {
    docsDir,
    exampleFiles,
    normalizeNewlines,
    repoRoot,
    repositoryFiles,
    workspacePackages,
} from "./repository.js";

const page = (name: string): string => normalizeNewlines(readFileSync(join(docsDir, name), "utf8"));

/**
 * The kinds of record the shell persists for one delivery. `ShellRecord` is a
 * private union rather than an exported vocabulary, so there is nothing to
 * import: this reads the declaration's text, the way every repository check
 * reads another package's file (D85).
 */
function shellRecordKinds(): string[] {
    const source = normalizeNewlines(
        readFileSync(join(repoRoot, "packages/runtime/src/shell/inbound/deliveries.ts"), "utf8"),
    );
    const union = source.split("type ShellRecord =")[1]?.split("\n\n")[0] ?? "";
    return [...union.matchAll(/readonly kind: "([A-Za-z]+)"/g)].map((m) => m[1]!);
}

/**
 * The applier's own codes. `EFFECT_CODES` is the runtime's, and this package
 * depends on core alone, so it is read as text like the record kinds (D85).
 */
function effectCodes(): string[] {
    const source = normalizeNewlines(
        readFileSync(join(repoRoot, "packages/runtime/src/shell/effects.ts"), "utf8"),
    );
    const array = source.split("export const EFFECT_CODES = [")[1]?.split("]")[0] ?? "";
    return [...array.matchAll(/"([A-Za-z]+)"/g)].map((m) => m[1]!);
}

/** The first backtick-quoted token of each table row in one `## section`. */
function tableCodes(markdown: string, heading: string): string[] {
    const section = markdown.split(/^## /m).find((s) => s.startsWith(heading));
    expect(section, `section "${heading}" exists`).toBeDefined();
    return [...(section ?? "").matchAll(/^\|\s*`([^`\r\n]+)`\s*\|/gm)].map((m) => m[1]!);
}

/** Every backtick-quoted token in a section, for the non-table list. */
function inlineCodes(markdown: string, heading: string): string[] {
    const section = markdown.split(/^## /m).find((s) => s.startsWith(heading));
    expect(section, `section "${heading}" exists`).toBeDefined();
    return [...(section ?? "").matchAll(/`([^`\r\n]+)`/g)].map((m) => m[1]!);
}

describe("documentation parsing", () => {
    it.each(["\n", "\r\n"])("reads tables with %j line endings", (newline) => {
        const markdown = [
            "## Codes",
            "",
            "| Code | Meaning |",
            "| --- | --- |",
            "| `first` | one |",
            "| `second` | two |",
            "| `invented_2` | three |",
            "",
            "## Next",
        ].join(newline);
        expect(tableCodes(normalizeNewlines(markdown), "Codes")).toEqual([
            "first",
            "second",
            "invented_2",
        ]);
    });
});

describe("docs/quickstart.md", () => {
    /**
     * The wording is deliberately unpinned: what is locked is that both entry
     * pages HAVE a banner and that the two agree, so a rewrite lands in both.
     */
    it("carries a banner identical to the index's", () => {
        const banner = (name: string) =>
            page(name)
                .split("\n")
                .filter((l) => l.startsWith(">"))
                .join("\n");
        expect(banner("quickstart.md")).not.toBe("");
        expect(banner("quickstart.md")).toEqual(banner("README.md"));
    });

    it("the index links to every other page", () => {
        const index = page("README.md");
        for (const target of [
            "quickstart.md",
            "capabilities.md",
            "configuration.md",
            "troubleshooting.md",
            "running.md",
        ]) {
            expect(index).toContain(`(${target})`);
        }
    });

    /**
     * Both directions: a tested example nobody is pointed at is dead weight,
     * and a link to a renamed file is a 404 in the most-read page.
     */
    it("offers every tested example, and links no phantom ones", () => {
        const quickstart = page("quickstart.md");
        const shipped = exampleFiles();
        const linked = [...quickstart.matchAll(/\]\(examples\/([a-z-]+\.yml)\)/g)]
            .map((m) => m[1]!)
            .sort();
        expect(linked).toEqual(shipped);
    });

    it("its mode table is the mode union, in ladder order", () => {
        expect(tableCodes(page("quickstart.md"), "Choosing a mode")).toEqual([...REPOSITORY_MODES]);
    });
});

describe("docs/configuration.md", () => {
    const doc = page("configuration.md");

    /** Both pages state the exact scope of their locks and disclaim prose coverage. */
    it("states the scope and limit of its drift checks, as does troubleshooting", () => {
        const promises = {
            "configuration.md":
                "The test suite locks this page's closed vocabularies—top-level keys, modes, meanings, and rejection\ncodes—against the code on every commit. Explanatory behavior still requires review.",
            "troubleshooting.md":
                "The test suite locks the code membership and severity grouping on this page against the implementation\non every commit. The plain-language explanations still require review.",
            "capabilities.md":
                "The test suite regenerates the table and the settings blocks on this page from the shipped\ncapabilities' own declarations on every commit (`pnpm contracts`). The explanations around them\nstill require review.",
        } as const;
        const unscoped = /every table.{0,80}(code-derived|locked|against the code)/is;

        for (const [name, promise] of Object.entries(promises)) {
            expect(page(name), name).toContain(promise);
            expect(page(name), name).not.toMatch(unscoped);
        }
        expect(unscoped.test("Every table is code-derived and locked against the code.")).toBe(
            true,
        );
    });

    /**
     * The tree claims to be "the entire shape" and is the first thing on the
     * page, so both the claim and its stated count are held to the key list.
     */
    it("the at-a-glance tree shows every key, and states the true count", () => {
        const glance = doc.split("## The file at a glance")[1]?.split(/^## /m)[0] ?? "";
        for (const key of TOP_LEVEL_KEYS) {
            expect(glance, `tree shows ${key}`).toContain(`${key}:`);
        }
        expect(glance).toContain(`${TOP_LEVEL_KEYS.length} top-level keys`);
    });

    // A reference guide's characteristic failure is INCOMPLETENESS, so the
    // definition list is held to the key list the unknown-key rule uses.
    it("defines every top-level key, and invents none", () => {
        const defined = [...doc.matchAll(/^### `([a-zA-Z]+)`$/gm)].map((m) => m[1]!);
        expect(defined).toEqual([...TOP_LEVEL_KEYS]);
    });

    it("gives every key a type and a default, or says it is required", () => {
        for (const key of TOP_LEVEL_KEYS) {
            const section = doc.split(`### \`${key}\``)[1] ?? "";
            const table = section.split("\n\n")[1] ?? "";
            expect(table, `${key} has a definition table`).toContain("| Type |");
            expect(table, `${key} states required-or-default`).toMatch(/\| (Required|Default) \|/);
        }
    });

    it("its mode table matches the modes, and the ladder is in order", () => {
        const ladder = doc.split("| Mode | Reads |")[1]?.split("\n\n")[0] ?? "";
        expect([...ladder.matchAll(/^\| `([a-z-]+)` \|/gm)].map((m) => m[1])).toEqual([
            ...REPOSITORY_MODES,
        ]);
    });

    it("its meanings table is the meanings union, exactly", () => {
        expect(tableCodes(doc, "Label mappings")).toEqual([...MAPPABLE_MEANINGS]);
    });

    /** `ConfigErrorCode` has no runtime array, so the catalogue is a mapped type (D76). */
    it("its error table is the error catalogue, exactly", () => {
        const CATALOGUE: { readonly [K in ConfigErrorCode]: true } = {
            documentUnparseable: true,
            duplicateKey: true,
            notAMapping: true,
            unknownKey: true,
            schemaVersionUnsupported: true,
            modeInvalid: true,
            capabilityNameInvalid: true,
            capabilityEnabledNotBoolean: true,
            capabilityModeAboveFile: true,
            capabilityUnknown: true,
            settingInvalid: true,
            meaningNotMappable: true,
            meaningRequired: true,
            labelInvalid: true,
            labelNotInjective: true,
            commandNotMappable: true,
            commandInvalid: true,
            commandNotInjective: true,
            skillNotMappable: true,
            skillInvalid: true,
            skillNotInjective: true,
            alertInvalid: true,
            alertNotInjective: true,
            principalNameInvalid: true,
            principalNotAString: true,
        };
        expect(tableCodes(doc, "Every way the file can be wrong").sort()).toEqual(
            Object.keys(CATALOGUE).sort(),
        );
    });
});

/**
 * Every line of a settings tree that a copy would turn into YAML null: a key,
 * nothing after the colon but its comment, and no deeper line under it.
 *
 * The depth test is what tells the two apart. `issues:` is a mapping once its
 * `enabled: true` is copied with it; `guide:` alone is null, and `text`'s
 * reader rejects the file that states it.
 */
function bareKeys(markdown: string): string[] {
    const lines = markdown.split("\n");
    const indent = (line: string): number => line.length - line.trimStart().length;
    return lines.filter((line, at) => {
        if (!/^\s*[^#\s][^:]*:\s*(#.*)?$/.test(line)) return false;
        const next = lines[at + 1] ?? "";
        return next.trim() === "" || indent(next) <= indent(line);
    });
}

describe("docs/capabilities.md", () => {
    const doc = page("capabilities.md");

    /**
     * The table is generated, so the lock is one sentence: the page holds
     * what the shipped folders say, and `pnpm contracts` is the repair. The
     * generic halves — a forged block differs, no markers reads as absent —
     * are proven once in `catalogue-drift.test.ts`.
     */
    it("holds the capability table the shipped folders generate", () => {
        for (const { name, markdown } of renderCapabilityTable()) {
            expect(readGeneratedBlock(doc, name), `run \`pnpm contracts\` — ${name}`).toEqual(
                markdown,
            );
        }
        expect(renderCapabilityTable().map(({ name }) => name)).toEqual(["capabilities"]);
    });

    /** A capability nobody can find on the page is one nobody enables. */
    it("names every shipped capability, in the order the shell runs them", () => {
        const [block] = renderCapabilityTable();
        const rows = [...(block?.markdown ?? "").matchAll(/^\| `([A-Za-z]+)` \|/gm)].map(
            (m) => m[1]!,
        );
        expect(rows).toEqual(shippedCapabilities().map(({ name }) => name));
        expect(rows.length).toBeGreaterThan(0);
    });

    it("holds the settings trees the shipped specs generate", () => {
        for (const { name, markdown } of renderSettingsTrees()) {
            expect(readGeneratedBlock(doc, name), `run \`pnpm contracts\` — ${name}`).toEqual(
                markdown,
            );
        }
        expect(renderSettingsTrees().map(({ name }) => name)).toEqual(["settings"]);
    });

    /**
     * A tree that stopped at the top, or that showed a key with no value,
     * would still match the block above and teach a maintainer nothing — the
     * second is worse than the first, because a copied bare key parses to
     * `null` and the file is rejected.
     */
    it("reaches the bottom of the deepest spec, with the value each key resolves to", () => {
        const [tree] = renderSettingsTrees();
        const markdown = tree?.markdown ?? "";
        expect(markdown).toContain("    needsRevision: # off until enabled —");
        expect(markdown).toContain("        after: 21d # inherited from the level above —");
        expect(markdown).not.toMatch(/: # inherited/);
    });

    /**
     * The rule one layer down from the one above, for the key a file may
     * leave out. A group key with its levels under it is a mapping when it is
     * copied; a LEAF with nothing after its colon is YAML null, and `text`'s
     * reader refuses the whole file over it. So the tree may hold no bare key
     * that nothing is written under.
     */
    it("offers no bare key a maintainer could copy into a rejected file", () => {
        const [tree] = renderSettingsTrees();
        expect(bareKeys(tree?.markdown ?? "")).toEqual([]);
        expect(bareKeys("a:\n  b: 1 # default — one\nguide: # unset — a page\n")).toEqual([
            "guide: # unset — a page",
        ]);
    });

    /**
     * No shipped spec declares an optional scalar, so the rule above has
     * nothing to bite on yet and would pass a generator that had lost it.
     * This is the spec that exercises it: the key is offered commented out,
     * with the value stating it takes, and a maintainer uncomments it rather
     * than deleting a `#` they were never shown.
     */
    it("writes a key that may be left out as a comment, never as a line", () => {
        const rendered = settingsTree(
            "throwaway",
            spec({
                announce: flag({ default: false, doc: "Say so in a comment" }),
                guide: text({ optional: true, doc: "A page explaining how to link an issue" }),
            }),
        );

        expect(rendered.split("\n").slice(3)).toEqual([
            "enabled: true",
            "# mode: dry-run — optional; observe, dry-run, active, never above the file's mode, which a block leaving it out inherits",
            "announce: false # default — Say so in a comment",
            '# guide: "…" — optional; A page explaining how to link an issue',
            "```",
        ]);
        expect(bareKeys(rendered)).toEqual([]);
    });

    /**
     * The same rule's other half, for the key a file MUST state. It cannot be
     * offered commented out — leaving it out is already a rejected file — so it
     * is shown as a line with a placeholder naming what it takes. A maintainer
     * who copies the placeholder unchanged is refused at that key's own path,
     * which is where they can act on it.
     */
    it("writes a key the file must state with a placeholder naming what it takes", () => {
        const rendered = settingsTree(
            "throwaway",
            spec({
                remindAfter: duration({ doc: "How long the wait may run" }),
                guide: text({ optional: false, doc: "The page the notice points at" }),
            }),
        );

        expect(rendered.split("\n").slice(3)).toEqual([
            "enabled: true",
            "# mode: dry-run — optional; observe, dry-run, active, never above the file's mode, which a block leaving it out inherits",
            "remindAfter: <duration> # required — How long the wait may run",
            "guide: <text> # required — The page the notice points at",
            "```",
        ]);
        expect(bareKeys(rendered)).toEqual([]);
    });
});

/**
 * The editor schema is generated whole — JSON has no comments, so there are no
 * markers and nothing hand-written to keep. The lock is the same sentence the
 * block locks make: the file holds what the specs say, and `pnpm contracts` is
 * the repair. Whether it ACCEPTS the right documents is `examples.test.ts`.
 */
describe("docs/automations.schema.json", () => {
    const text = normalizeNewlines(readFileSync(join(repoRoot, SCHEMA_PATH), "utf8"));

    it("is what the shipped specs and the top-level vocabulary generate", () => {
        expect(text, "run `pnpm contracts`").toEqual(renderEditorSchema());
    });

    /**
     * The modeline is the only way a maintainer finds this file, and an
     * editor fetches the URL rather than resolving a path — so a link check
     * cannot see it and the two spellings are held to one constant instead.
     */
    it("the quickstart points an editor at the URL the schema answers to", () => {
        expect(page("quickstart.md")).toContain(`# yaml-language-server: $schema=${SCHEMA_URL}`);
        expect(JSON.parse(text)).toMatchObject({ $id: SCHEMA_URL });
        expect(SCHEMA_URL).toMatch(/^https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/main\//);
    });
});

describe("docs/troubleshooting.md", () => {
    const doc = page("troubleshooting.md");
    const onPurpose = tableCodes(doc, "It did nothing on purpose");
    const needsYou = tableCodes(doc, "It needs something from you");
    const defects = inlineCodes(doc, "It should never happen");
    const APPLIER = "It decided, and the write did not land";

    /** The assertion, so the negative control runs the same one. */
    const locksEffectCodes = (markdown: string): void => {
        expect(tableCodes(markdown, APPLIER).sort()).toEqual(effectCodes().sort());
    };

    /**
     * The applier's codes are a closed vocabulary below every verdict, locked
     * the way the verdict sections are: a new one cannot ship undocumented.
     */
    it("covers every code the applier reports, and invents none", () => {
        expect(effectCodes(), "EFFECT_CODES parsed").toContain("ledgerInconsistent");
        locksEffectCodes(doc);
    });

    it("catches a section that drops one", () => {
        const rows = effectCodes()
            .slice(1)
            .map((code) => `| \`${code}\` | why |`);
        expect(() => locksEffectCodes([`## ${APPLIER}`, "", ...rows, ""].join("\n"))).toThrow();
    });

    it("covers every refusal and record-only code, and invents none", () => {
        const EVERY_CODE: {
            readonly [K in SafetyRefusalCode | RecordOnlyCode]: true;
        } = {
            killSwitch: true,
            wrongEntryPoint: true,
            preventiveGateUnavailable: true,
            capabilityDisabled: true,
            permissionMissing: true,
            itemBlocked: true,
            itemClosed: true,
            preconditionStale: true,
            newerHumanChange: true,
            humanOrderingUnknown: true,
            invalidTimestamp: true,
            modeDisabled: true,
            wrongActionClass: true,
            noWarning: true,
            warningRequestMismatch: true,
            invalidDestructivePlan: true,
            graceBelowFloor: true,
            graceRunning: true,
            activityCancelled: true,
            observation: true,
            modeRecordsOnly: true,
        };
        expect([...onPurpose, ...needsYou, ...defects].sort()).toEqual(
            Object.keys(EVERY_CODE).sort(),
        );
    });

    /**
     * The page's grouping is a claim about SEVERITY, and `report/convert.ts`
     * is the authority — so ask it rather than restate its table here.
     */
    const severityOf = (code: string): Severity => {
        const RECORD_ONLY: readonly RecordOnlyCode[] = ["observation", "modeRecordsOnly"];
        const verdict = RECORD_ONLY.includes(code as RecordOnlyCode)
            ? ({ outcome: "record-only", code, reason: "r" } as const)
            : ({ outcome: "refuse", code, reason: "r" } as const);
        return verdictFinding(verdict as Parameters<typeof verdictFinding>[0], {
            kind: "repository",
        }).severity;
    };

    /**
     * The section's claim is "nothing to fix", which is a claim about what a
     * reader must DO — so it is `problem` that must not appear here, and both
     * quiet severities may. `notice` is the common case (nothing happened, and
     * that was intended); `graceRunning` is `info` because something IS
     * happening — the App warned and is waiting out what it announced
     * (grace.md §2) — and a reader still has nothing to fix.
     */
    it("'on purpose' rows never ask a reader to act", () => {
        expect(onPurpose.length).toBeGreaterThan(0);
        for (const code of onPurpose) {
            expect(`${code}:${severityOf(code)}`).not.toBe(`${code}:problem`);
        }
        expect(onPurpose.map(severityOf)).toContain("notice");
        expect(onPurpose.map(severityOf)).toContain("info");
    });

    /**
     * A record kind is not a verdict code, so it reaches none of the tables
     * above and nothing else would notice a new one arriving undocumented —
     * which is how `modeUnsupported` shipped with nowhere to look it up.
     * `decision` is the ordinary outcome and stays out: a reader consults this
     * page only when the App recorded something INSTEAD of deciding.
     */
    it("covers every shell record that is not a decision, and invents none", () => {
        const kinds = shellRecordKinds();
        expect(kinds, "the record union parsed").toContain("decision");
        expect(tableCodes(doc, "It never got as far as deciding").sort()).toEqual(
            kinds.filter((kind) => kind !== "decision").sort(),
        );
    });

    it("'needs you' and 'never happen' rows are all problems", () => {
        expect(needsYou.length).toBeGreaterThan(0);
        expect(defects.length).toBeGreaterThan(0);
        for (const code of [...needsYou, ...defects]) {
            expect(`${code}:${severityOf(code)}`).toBe(`${code}:problem`);
        }
    });
});

/**
 * CI gained `format:check` and no document mentioned it, so a contributor could
 * follow CONTRIBUTING exactly, pass locally, and still go red on push (#94).
 * The reverse is the same bug: a documented command that does not exist sends
 * someone to a failure with no explanation. Both directions are one loop over
 * the same parse, so they are one describe.
 */
describe("every documented pnpm command exists", () => {
    /** The documents that instruct a human. Not `design/` — that explains, it does not instruct. */
    const INSTRUCTING = ["CONTRIBUTING.md", "README.md"];

    /**
     * One `pnpm …` invocation, to the end of its code span or line. Horizontal
     * whitespace only: `\s` crosses newlines, so `cache: pnpm` followed by the
     * next line's `- run:` read as a command named `run:`.
     */
    const COMMAND = /pnpm[ \t]+([^\n`]*)/g;

    /** Flags that swallow the token after them, so it is never the script name. */
    const TAKES_VALUE = new Set(["--dir", "-C"]);

    /** pnpm's own subcommands, which need no script to exist. */
    const BUILTIN = new Set(["install", "add", "remove", "why", "dlx", "exec", "store", "audit"]);

    interface Manifest {
        readonly name: string;
        readonly scripts: ReadonlySet<string>;
    }

    /** A script name and the package scope pnpm will resolve it against. */
    interface Invocation {
        readonly raw: string;
        readonly script: string;
        readonly selector: string | null;
        readonly recursive: boolean;
    }

    /** Null for anything that runs no workspace script: a builtin, or flags alone. */
    function parseInvocation(invocation: string): Invocation | null {
        const raw = invocation.trim();
        // A GitHub expression carries spaces that are not token breaks.
        const tokens = raw.replace(/\$\{\{(.*?)\}\}/g, (_, e: string) => e.trim()).split(/\s+/);
        let selector: string | null = null;
        let recursive = false;
        let explicitRun = false;

        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i]!;
            if (token === "-r" || token === "--recursive") recursive = true;
            else if (token === "--filter" || token === "-F") selector = tokens[++i] ?? "";
            else if (token.startsWith("--filter=")) selector = token.slice("--filter=".length);
            else if (TAKES_VALUE.has(token)) i++;
            else if (token.startsWith("-")) continue;
            else if (token === "run") explicitRun = true;
            else if (!explicitRun && BUILTIN.has(token)) return null;
            else return { raw, script: token, selector, recursive };
        }
        return null;
    }

    function invocations(text: string): Invocation[] {
        return [...text.matchAll(COMMAND)]
            .map((match) => parseInvocation(match[1]!))
            .filter((command): command is Invocation => command !== null);
    }

    /** Why pnpm would not find this script, or null if it would. */
    function problem(command: Invocation, root: Manifest, workspace: readonly Manifest[]): string {
        const { script, selector, recursive } = command;
        if (selector === null && !recursive) {
            return root.scripts.has(script) ? "" : `root has no script "${script}"`;
        }
        const scoped = selector === null ? workspace : workspace.filter((m) => m.name === selector);
        if (scoped.length === 0) return `filter "${selector}" matches no workspace package`;
        const missing = scoped.filter(({ scripts }) => !scripts.has(script)).map((m) => m.name);
        return missing.length === 0 ? "" : `"${script}" is missing from ${missing.join(", ")}`;
    }

    function manifestAt(path: string): Manifest {
        const file = `${path}/package.json`.replace(/^\.\//, "");
        const json = JSON.parse(readFileSync(join(repoRoot, file), "utf8")) as {
            name?: string;
            scripts?: Record<string, unknown>;
        };
        return { name: json.name ?? path, scripts: new Set(Object.keys(json.scripts ?? {})) };
    }

    const root = manifestAt(".");
    const workspace = workspacePackages().map(manifestAt);
    const instructing = INSTRUCTING.filter((doc) => repositoryFiles().includes(doc)).map((doc) => ({
        doc,
        text: readFileSync(join(repoRoot, doc), "utf8"),
    }));
    const ci = readFileSync(join(repoRoot, ".github/workflows/ci.yml"), "utf8");

    it("finds documents and commands to check", () => {
        expect(instructing.map((d) => d.doc)).toEqual(INSTRUCTING);
        expect(instructing.flatMap((d) => invocations(d.text)).length).toBeGreaterThan(3);
    });

    it("every pnpm command in an instructing document is a real script", () => {
        const unknown = instructing.flatMap(({ doc, text }) =>
            invocations(text)
                .map((command) => ({ command, why: problem(command, root, workspace) }))
                .filter(({ why }) => why !== "")
                .map(({ command, why }) => `${doc} -> pnpm ${command.raw}: ${why}`),
        );
        expect([...new Set(unknown)]).toEqual([]);
    });

    it("the gates CI runs are documented somewhere a contributor reads", () => {
        const documented = new Set(
            instructing.flatMap(({ text }) => invocations(text).map((c) => c.script)),
        );
        const undocumented = invocations(ci)
            .map((c) => c.script)
            .filter((name) => !documented.has(name) && !name.startsWith("test:"));
        expect([...new Set(undocumented)]).toEqual([]);
    });

    it("proves the check can fail", () => {
        const scripts = (text: string) => invocations(text).map((c) => c.script);
        expect(scripts("run `pnpm format:check` before pushing")).toEqual(["format:check"]);
        expect(scripts("run `pnpm -r test` and `pnpm lint`")).toEqual(["test", "lint"]);
        expect(scripts("`pnpm --filter @scope/pkg test:coverage`")).toEqual(["test:coverage"]);
        expect(scripts("`pnpm install --frozen-lockfile`")).toEqual([]);
        expect(scripts("cache: pnpm\n      - run: pnpm lint")).toEqual(["lint"]);
        expect(
            parseInvocation("--filter @hiero-hackers/automation-${{ matrix.package }} test"),
        ).toMatchObject({ script: "test", selector: "@hiero-hackers/automation-matrix.package" });

        const ask = (text: string) => problem(parseInvocation(text)!, root, workspace);
        expect(ask("format:check")).toBe("");
        expect(ask("run no_such.2")).toContain("root has no script");
        expect(ask("--filter @hiero-hackers/automation-core test:coverage")).toBe("");
        expect(ask("--filter @hiero-hackers/automation-checks test:coverage")).toContain(
            "is missing from",
        );
        expect(ask("--filter @hiero-hackers/no-such-package test")).toContain("matches no");
        expect(ask("-r test")).toBe("");
        expect(
            problem(parseInvocation("-r test")!, root, [{ name: "empty", scripts: new Set() }]),
        ).toContain("is missing from");
    });
});
