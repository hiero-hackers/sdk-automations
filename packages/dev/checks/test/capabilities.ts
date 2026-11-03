import { CAPABILITIES } from "@hiero-hackers/automation-capabilities";
import type {
    DeclaredTrigger,
    MappableMeaning,
    RequiredMappings,
    Spec,
} from "@hiero-hackers/automation-core";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeNewlines, repoRoot, repositoryFiles } from "./repository.js";

export interface ShippedCapability {
    readonly name: string;
    readonly folder: string;
    readonly triggers: readonly DeclaredTrigger[];
    readonly settings: Spec;
    readonly requiredMappings: RequiredMappings;
    readonly intents: readonly string[];
    readonly labels: readonly MappableMeaning[];
    readonly moves: readonly string[];
    readonly reads: readonly string[];
    /** The design page's first line, exactly as written. */
    readonly title: string;
    /** The half after the em-dash — the whole line when the title is not in shape. */
    readonly purpose: string;
}

/**
 * The shape a capability's `design.md` title must have, and where it is judged.
 *
 * Reading it is deliberately LENIENT here: five check files call
 * `shippedCapabilities()`, so a title with the wrong dash used to throw inside
 * this helper and red every one of them with a message about a title.
 * `capabilities.test.ts` asserts the shape instead, once, with the rule in its
 * own message — a wrong em-dash now names itself.
 */
export const DESIGN_TITLE = /^# [A-Za-z-]+ — (.+)$/;

function designTitle(folder: string): string {
    const page = join(repoRoot, folder, "design.md");
    if (!existsSync(page)) throw new Error(`${folder} has no design.md`);
    return normalizeNewlines(readFileSync(page, "utf8")).split("\n")[0] ?? "";
}

export function shippedCapabilities(): readonly ShippedCapability[] {
    return CAPABILITIES.map(({ declaration }) => {
        const folder = `packages/capabilities/src/${declaration.name}`;
        const title = designTitle(folder);
        return {
            name: declaration.name,
            folder,
            triggers: declaration.triggers,
            settings: declaration.settings,
            requiredMappings: declaration.requiredMappings,
            labels: declaration.labels,
            moves: declaration.moves,
            reads: declaration.reads,
            intents: declaration.intents,
            title,
            purpose: DESIGN_TITLE.exec(title)?.[1] ?? title,
        };
    });
}

export function declaredCapabilityNames(): readonly string[] {
    return [
        ...new Set(
            repositoryFiles()
                .map((path) => /^packages\/capabilities\/src\/([A-Za-z]+)\//.exec(path)?.[1])
                .filter((name): name is string => name !== undefined),
        ),
    ].sort();
}
