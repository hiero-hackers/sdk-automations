/**
 * Reading the label mapping in the direction GitHub speaks it.
 *
 * The reviewed file maps meaning → label, because that is the direction a
 * maintainer thinks in. A webhook delivery arrives speaking the other way:
 * it carries the repository's label strings, and the normalizer
 * (`engine/events.ts`, the vertical slice) must ask "which meaning, if any,
 * is this label?". This is that question, answered once.
 *
 * The lookup is total and closed: an unmapped label answers `null`, never a
 * guess — an unmapped label is INVISIBLE to the platform (docs/configuration.md
 * calls this the maintainer's blast-radius lever, and it is enforced here).
 *
 * Sameness is judged the way the validator judges collisions (D55): trimmed,
 * case-insensitively — `Status: Ready` on the wire matches a mapped
 * `status: ready`. The validator's injectivity rule is what makes this
 * reverse reading well-defined at all: no two meanings can share a label, so
 * the first match is the only match.
 */

import { MAPPABLE_MEANINGS, type MappableMeaning, type RepositoryConfig } from "./schema.js";

/**
 * D55's sameness, in one place for BOTH consumers: the validator's collision
 * check and this lookup. They folded independently until the mutation gate
 * noticed the copies could disagree without a test failing — on `ß`-class
 * characters, upper- and lower-folding genuinely differ, and collision
 * judgment must never diverge from lookup judgment.
 */
export function labelKey(label: string): string {
    return label.trim().toLowerCase();
}

/**
 * The meaning a repository label carries, or `null` for any label the
 * repository has not mapped — including the empty string and labels that
 * differ from a mapped one by more than case and surrounding space.
 *
 * Iterates `MAPPABLE_MEANINGS` rather than the config's own entries so the
 * keys keep their type without assertion — the closed union is the walk.
 */
export function meaningOfLabel(config: RepositoryConfig, label: string): MappableMeaning | null {
    // No empty-string case: the validator rejects empty and whitespace
    // labels, so an empty `wanted` can never match a mapped key.
    const wanted = labelKey(label);
    for (const meaning of MAPPABLE_MEANINGS) {
        const mapped = config.mappings.labels[meaning];
        if (mapped !== undefined && labelKey(mapped) === wanted) {
            return meaning;
        }
    }
    return null;
}

/**
 * Every mapped meaning present in a set of repository labels, in
 * `MAPPABLE_MEANINGS` order — the shape the projection consumes. Unmapped
 * labels vanish; duplicates collapse; input order does not matter, so two
 * deliveries listing the same labels differently normalize identically.
 */
export function meaningsOfLabels(
    config: RepositoryConfig,
    labels: readonly string[],
): readonly MappableMeaning[] {
    const present = new Set<MappableMeaning>();
    for (const label of labels) {
        const meaning = meaningOfLabel(config, label);
        if (meaning !== null) present.add(meaning);
    }
    return MAPPABLE_MEANINGS.filter((m) => present.has(m));
}
