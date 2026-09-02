/**
 * The safety layer: may this write happen?
 *
 * `write.ts` is the general entry point; `destructive.ts` holds the §3
 * warning and grace gates that clock-triggered actions pass INSTEAD, not as
 * well (D52). `rules.ts` holds the general rules both entry points share. Only
 * their ORDER is exported, because D52 was a precedence defect.
 */
export * from "./types.js";
export { evaluateWrite } from "./write.js";
// The rule ORDER is contract (D39, D52), so the list is public for tests to
// assert directly. The rules themselves stay internal, with one exception:
// `evaluateStandingRules` runs the item-independent subset for a caller that
// holds no item — the write path's resume gate, which would otherwise restate
// them.
export { evaluateStandingRules, GENERAL_RULES, type RuleScope } from "./rules.js";
export * from "./destructive.js";
/**
 * The derived world (D92 phase 4): the type, the derivation, and its two
 * ingredients — but never `DERIVED` (the brand) or `assertedWorld` (the
 * rule-suite constructor). Outside this package there is exactly one way
 * to make a world: derive it.
 */
export {
    deriveWorld,
    expectedHolds,
    observedMeaningsOf,
    type ClaimedFacts,
    type DerivedWorld,
} from "./world.js";
