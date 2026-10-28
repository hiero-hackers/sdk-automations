/**
 * prDashboard — one dashboard comment telling a contributor what stops their
 * pull request being ready to review (`design.md`), and the position its
 * verdict earns. The rows are `rows.ts`, the judgements `checks.ts`, the words `messages.ts`.
 */

import {
    changesOutstanding,
    moveTo,
    UNREAD,
    type Capability,
    type IntentFor,
} from "@hiero-hackers/automation-core/author";
import {
    determined,
    positionFor,
    VERDICT_POSITIONS,
    type Row,
    type VerdictPosition,
} from "./checks.js";
import {
    prDashboardDeclaration,
    type Platform,
    type PrDashboardDeclaration,
} from "./declaration.js";
import { dashboard } from "./messages.js";
import { anyEnabled, rowsFor } from "./rows.js";

export { prDashboardDeclaration, type PrDashboardDeclaration } from "./declaration.js";

type Facts = Parameters<Capability<PrDashboardDeclaration>["evaluate"]>[0];

const isVerdictPosition = (name: string): name is VerdictPosition =>
    (VERDICT_POSITIONS as readonly string[]).includes(name);

/** The label the verdict earns, when the repository listed it and the map draws the edge. */
function labelIntent(
    rows: readonly Row[],
    facts: Facts,
    applyLabels: readonly string[],
    platform: Platform,
): IntentFor<PrDashboardDeclaration> | null {
    for (const name of applyLabels.filter((listed) => !isVerdictPosition(listed))) {
        platform.explain({
            capability: prDashboardDeclaration.name,
            summary: `applyLabels names ${name}, a position prDashboard never sets.`,
            detail: [`it sets ${VERDICT_POSITIONS.join(" and ")} only`],
        });
    }
    const current = facts.position.kind === "position" ? facts.position.state.meaning : null;
    const outstanding = facts.review === UNREAD ? null : changesOutstanding(facts.review);
    const target = positionFor(rows, facts.readiness.draft, current, outstanding);
    if (target === null || !applyLabels.includes(target)) return null;
    // The review earned the verdict, not the checks: the cause says so, and the map draws that edge from needsReview alone.
    const byReview = target === "needsRevision" && !rows.some((row) => row.outcome === "fail");
    if (moveTo(facts, target, prDashboardDeclaration.moves) === null) {
        // Already there, off the map, or a conflicted position: the engine would refuse, so nothing is asked.
        platform.explain({
            capability: prDashboardDeclaration.name,
            summary: `Left the position alone: no edge prDashboard owns moves this pull request to ${target}.`,
            detail: [],
        });
        return null;
    }
    return platform.intent({
        operation: "applyMappedLabel",
        desired: byReview
            ? { meaning: target, cause: "reviewRequestedChanges" }
            : { meaning: target },
        cause: "pullRequestChecked",
        explain: byReview
            ? "Set the position to needsRevision: a review requested changes."
            : `Set the position to ${target} from the checks' verdict.`,
    });
}

export const prDashboard: Capability<PrDashboardDeclaration> = {
    declaration: prDashboardDeclaration,

    async evaluate(facts, config, platform) {
        const { checks } = config.settings;
        if (!anyEnabled(checks)) return [];
        // The dashboard speaks to a person: a bot can neither sign off nor take an assignment.
        if (await platform.ask("isAutomationActor", { login: facts.author })) return [];
        const rows = await rowsFor(checks, facts.item, facts.author, platform);
        if (!rows.some(determined)) {
            return platform.skip(
                "Skipped: no enabled check could run.",
                ...rows.map((row) => `${row.check}: ${row.outcome}`),
            );
        }
        const report = platform.intent({
            operation: "postManagedComment",
            desired: { kind: "summary", body: dashboard(facts.author, rows) },
            cause: "pullRequestChecked",
            explain: {
                summary: "Reported the quality checks on this pull request.",
                detail: rows.map((row) => `${row.check}: ${row.outcome}`),
            },
        });
        const label = labelIntent(rows, facts, config.settings.applyLabels, platform);
        return label === null ? [report] : [report, label];
    },
};
