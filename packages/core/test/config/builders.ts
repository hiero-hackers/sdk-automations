/**
 * A valid configuration, built rather than hand-rolled — the accepting half
 * of what `documents.ts` holds the rejections for.
 *
 * Four suites wrote the same `parseConfig` call: the same document literal,
 * the same throw on the failure arm, differing only in a revision string and
 * one `enabled` flag. Copies that similar drift rather than diverge — two of
 * them were byte-identical, which is a fact nobody could see from inside
 * either file.
 *
 * It sits beside the rejection corpus and not in the testkit because core
 * cannot depend on a package that depends on core; the testkit's own header
 * names config builders as the thing it will not take. Beside `documents.ts`
 * is also where Stryker can see it: the sandbox is the mutated package's own
 * directory, so in-package support is support that survives mutation (D82).
 */

import { spec } from "../../src/capability/index.js";
import {
    parseConfig,
    type AdmittedCapability,
    type CapabilityMode,
    type RepositoryConfig,
    type RepositoryMode,
    type Spec,
} from "../../src/config/index.js";

/**
 * What a suite admits when the settings block is not its subject: the name,
 * a spec with no keys, and nothing required.
 *
 * `parseConfig` takes admissions rather than names, because the spec IS the
 * schema for a block (C1). A test about projection, mode or mappings should
 * not have to describe a schema to say "this capability ships", and the empty
 * spec is the written answer for one that takes no setting.
 */
export function admitting(
    names: readonly string[],
    specs: Readonly<Record<string, Spec>> = {},
): readonly AdmittedCapability[] {
    return names.map((name) => ({
        name,
        settings: specs[name] ?? spec({}),
        requiredMappings: {},
    }));
}

/**
 * What a built configuration says beyond the empty document.
 *
 * Every field is optional and the defaults are the shape most tests want: an
 * `active` repository that has adopted nothing and maps nothing. `parseConfig`
 * defaults an ABSENT mode to `observe` (D56); this builder always states one,
 * so a test that omits `mode` gets a repository that acts.
 */
export interface ConfigOptions {
    readonly mode?: RepositoryMode;
    /** Meaning → label, spelt as a maintainer would write it in the file. */
    readonly labels?: Record<string, string>;
    /** Command → the word this repository answers to, as a maintainer writes it. */
    readonly commands?: Record<string, string>;
    /** Alert name → the label carrying it, as a maintainer writes it. */
    readonly alerts?: Record<string, string>;
    readonly skills?: Record<string, string>;
    /** The capability names the document declares, each with `enabled`. */
    readonly capabilities?: readonly string[];
    /** The consent every declared capability carries. Boolean, never truthy (§2.4). */
    readonly enabled?: boolean;
    /**
     * Per-capability settings, keyed by capability name. A name with no
     * entry declares an empty settings map, which is what the parser reads
     * for an absent one — so the tests whose subject is projection state
     * only the settings they are about.
     */
    readonly settings?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
    /** The mode a block states, keyed by capability name. A name with no entry inherits. */
    readonly modes?: Readonly<Record<string, CapabilityMode>>;
    /**
     * The spec each admitted capability is admitted with, keyed by name. A
     * name with no entry is admitted with the empty spec, which takes no
     * setting — so a suite states a spec exactly when its document writes a
     * settings block.
     */
    readonly specs?: Readonly<Record<string, Spec>>;
    /**
     * The application's admitted names. Defaults to `capabilities`, so a
     * declared capability is an admitted one; pass `[]` for the tests whose
     * subject is a repository naming something the App does not ship.
     */
    readonly known?: readonly string[];
    /** The revision the parser stamps onto the result and reports carry. */
    readonly revision?: string;
}

/**
 * Parse the described document, or throw with the codes that refused it.
 *
 * A test that reaches here wanted a configuration, so a rejection is a broken
 * test rather than an assertion — but it is the CODES that say which rule the
 * document tripped, and a bare "config must parse" makes the reader run the
 * parser in their head to find out (D75).
 */
export function configWith({
    mode = "active",
    labels = {},
    commands = {},
    alerts = {},
    skills = {},
    capabilities = [],
    enabled = true,
    settings = {},
    modes = {},
    specs = {},
    known = capabilities,
    revision = "rev-test",
}: ConfigOptions = {}): RepositoryConfig {
    const result = parseConfig(
        {
            schemaVersion: 2,
            mode,
            // The document is flat: a block is `enabled` and the capability's
            // own keys beside it, so the settings spread in rather than nest.
            capabilities: Object.fromEntries(
                capabilities.map((name) => [
                    name,
                    {
                        enabled,
                        ...(modes[name] === undefined ? {} : { mode: modes[name] }),
                        ...(settings[name] ?? {}),
                    },
                ]),
            ),
            mappings: { labels, commands, skills, alerts },
        },
        { revision, knownCapabilities: admitting(known, specs) },
    );
    if (!result.ok) throw new Error(result.errors.map((e) => e.code).join(","));
    return result.config;
}

/**
 * One repository, adopting triage and mapping the one label it needs.
 *
 * The engine and the vertical slice want this exact document and differ only
 * where they must: the revision their reports carry, and — for the paths
 * where adoption is declared without consent — `enabled`. A test that needs
 * anything else from a configuration builds it with `configWith`.
 */
export function triageConfig(
    mode: RepositoryMode,
    revision: string,
    enabled = true,
): RepositoryConfig {
    return configWith({
        mode,
        enabled,
        revision,
        capabilities: ["triage"],
        labels: { awaitingTriage: "status: triage" },
    });
}
