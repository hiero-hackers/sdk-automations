/**
 * PROBE — schedule-triggered, durable-state-requiring, many-items-per-observation.
 *
 * The stale sweep remains until Stage 3, but it has no authoritative
 * projection. Its intents therefore reach the shared safety door and refuse
 * closed rather than carrying capability-authored destructive authority.
 *
 * Not a scope decision. See `probes/README.md`.
 */

import {
    declareCapability,
    intentFactoryFor,
    type Capability,
    type IntentFor,
} from "@hiero-hackers/automation-core";

export const inactivityDeclaration = declareCapability({
    name: "inactivity",
    triggers: [{ kind: "schedule", description: "daily stale-assignment sweep" }],
    configKeys: ["gracePeriodDays"],
    requiredMeanings: [],
    observations: ["staleItemsDue"],
    resolvers: ["isAutomationActor"],
    intents: ["postManagedComment", "unassign"],
    operationalNeeds: {
        schedule: true,
        durableState: "required",
        crossItemCoordination: false,
        externalDelivery: false,
    },
});

export type InactivityDeclaration = typeof inactivityDeclaration;

const DEFAULT_GRACE_DAYS = 7;

export const inactivity: Capability<InactivityDeclaration> = {
    declaration: inactivityDeclaration,

    async evaluate(observation, config, platform) {
        const graceDays =
            typeof config.settings.gracePeriodDays === "number"
                ? config.settings.gracePeriodDays
                : DEFAULT_GRACE_DAYS;

        const intents: IntentFor<InactivityDeclaration>[] = [];

        for (const entry of observation.items) {
            if (entry.assignee === null) continue;

            /**
             * Never reclaim a bot's assignment. An undetermined answer is
             * treated as "do not act" — the cautious reading is the only
             * safe one when the next step is destructive.
             */
            const isBot = await platform.resolve("isAutomationActor", {
                login: entry.assignee,
            });
            if (!isBot.ok || isBot.value) continue;

            if (entry.warnedAt === null) {
                // First stale observation warns. It never acts (effects.md).
                const make = intentFactoryFor(inactivityDeclaration, {
                    repository: observation.repository,
                    item: entry.item,
                    observedAt: observation.observedAt,
                });
                intents.push(
                    make({
                        operation: "postManagedComment",
                        desired: {
                            kind: "warning",
                            body: `This has been assigned to @${entry.assignee} without activity for a while. It will be unassigned in ${String(graceDays)} days unless there is a comment or a commit.`,
                        },
                        cause: "assignmentWentStale",
                        expected: { closed: false },
                        explain: {
                            summary: "Warned before reclaiming a stale assignment.",
                            detail: [`grace period ${String(graceDays)} days`],
                        },
                    }),
                );
                continue;
            }

            /**
             * Retain the probe's warn-then-request shape until Stage 3. The
             * unprojected sweep cannot establish a current precondition, so
             * the engine refuses this intent before any write policy.
             */
            const warnedCause = "assignmentWentStale";
            const makeAct = intentFactoryFor(inactivityDeclaration, {
                repository: observation.repository,
                item: entry.item,
                observedAt: entry.warnedAt,
            });
            intents.push(
                makeAct({
                    operation: "unassign",
                    desired: { login: entry.assignee },
                    cause: warnedCause,
                    expected: { closed: false },
                    explain: {
                        summary: "Reclaimed a stale assignment after the grace period.",
                        detail: [
                            `warned at ${entry.warnedAt.toISOString()}`,
                            `grace period ${String(graceDays)} days`,
                        ],
                    },
                }),
            );
        }

        return intents;
    },
};
