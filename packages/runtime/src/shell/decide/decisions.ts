/**
 * Which rows one decided pass writes down: a verdict per item finding, one per effect (D163).
 * A judgement only — appending them is the box's, and the store's `decide` is one row each.
 */

import type {
    Finding,
    ItemRef,
    Report,
    RepositoryRef,
    Subject,
} from "@hiero-hackers/automation-core";
import type { Decision } from "../../store/index.js";
import type { EffectOutcome } from "../effects.js";

/** One decided pass, as its rows name it. */
export interface DecidedPass {
    readonly passId: string;
    /** Which lane caused the pass, and the delivery or schedule row it names (D173). */
    readonly source: Decision["source"];
    readonly sourceId: string;
    /** The repository the process served this pass for (D169). */
    readonly repository: RepositoryRef;
    /** The item the pass decided, which a capability's own explanation is written on. */
    readonly item: ItemRef | null;
    readonly at: string;
    readonly report: Report;
    readonly effects: readonly EffectOutcome[];
}

/** The subjects a row is written about: one item, or one act on it. */
type ItemSubject = Extract<Subject, { readonly kind: "item" | "effect" }>;

type CapabilitySubject = Extract<Subject, { readonly kind: "capability" }>;

/** The code a skip's row carries: core files the skip as an explanation on the capability (D186). */
export const SKIPPED = "capabilitySkipped";

/** The codes filed on the capability that its item's rows carry; a producer's unread group stays silent. */
const ON_THE_CAPABILITY: Readonly<Record<string, string>> = {
    capabilityExplained: SKIPPED,
    capabilityFailed: "capabilityFailed",
    resolverFailed: "resolverFailed",
    undeclaredResolver: "undeclaredResolver",
    intentsAfterSkip: "intentsAfterSkip",
};

const aboutAnItem = (finding: Finding): finding is Finding & { readonly subject: ItemSubject } =>
    finding.subject.kind === "item" || finding.subject.kind === "effect";

const aboutTheCapability = (
    finding: Finding,
): finding is Finding & { readonly subject: CapabilitySubject } =>
    finding.subject.kind === "capability";

/** The reason, then its lines, in the one detail column. */
const reasonOf = (finding: Finding): string =>
    finding.detail.length === 0
        ? finding.summary
        : `${finding.summary} (${finding.detail.join("; ")})`;

/**
 * Every row one pass writes: its item verdicts, skips and capability problems in report order, then its effects.
 * A record with no item finding and no effect writes none — a config rejection has no item.
 */
export function decisionsOf(pass: DecidedPass): Decision[] {
    const common = {
        passId: pass.passId,
        source: pass.source,
        sourceId: pass.sourceId,
        at: pass.at,
        repository: pass.repository,
        effectId: null,
    };
    const rowOf = (finding: Finding): Decision | null => {
        if (aboutAnItem(finding)) {
            return {
                ...common,
                item: finding.subject.item,
                capability: finding.subject.capability,
                verdict: finding.severity,
                code: finding.code,
                detail: finding.summary,
            };
        }
        if (pass.item === null || !aboutTheCapability(finding)) return null;
        const code = ON_THE_CAPABILITY[finding.code];
        if (code === undefined) return null;
        return {
            ...common,
            item: pass.item,
            capability: finding.subject.capability,
            verdict: finding.severity,
            code,
            detail: reasonOf(finding),
        };
    };
    return [
        ...pass.report.findings.map(rowOf).filter((row): row is Decision => row !== null),
        ...pass.effects.map((outcome) => ({
            ...common,
            item: outcome.item,
            capability: outcome.capability,
            verdict: outcome.outcome,
            code: outcome.code,
            detail: outcome.detail,
            effectId: outcome.effectId,
        })),
    ];
}
