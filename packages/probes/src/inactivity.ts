/**
 * PROBE — schedule-triggered, destructive, durable-state-requiring,
 * many-items-per-observation.
 *
 * The hostile end of the triad, and the only probe that reaches
 * `evaluateDestructive`, the store's `schedule` table, and the
 * warn-then-act shape safety.md §3 requires. It emits intents for SEVERAL
 * items from ONE observation, which is what forces the planner's
 * per-intent context recheck.
 *
 * Not a scope decision — the build plan defers destructive automation
 * explicitly. See `probes/README.md`.
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
    observations: ["staleItemsDue"],
    resolvers: ["isAutomationActor"],
    intents: [
        {
            name: "postManagedComment",
            idempotencyClass: "nonIdempotent",
            requiredPermissions: ["issues:write"],
        },
        {
            name: "unassign",
            idempotencyClass: "idempotent",
            requiredPermissions: ["issues:write"],
        },
    ],
    permissions: {
        repository: ["issues:write", "contents:read"],
        organization: [],
    },
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
                // First stale observation warns. It never acts (§3).
                const make = intentFactoryFor(inactivityDeclaration, {
                    repository: observation.repository,
                    item: entry.item,
                    observedAt: observation.observedAt,
                });
                intents.push(
                    make({
                        operation: "postManagedComment",
                        actionClass: "humanFacingOutput",
                        desired: {
                            marker: "<!-- hiero-automation:inactivity -->",
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
             * The grace arithmetic is deliberately NOT repeated here —
             * `evaluateDestructive` owns it, including the floor and the
             * qualifying-activity cancellation. The capability states the
             * warning it recorded and lets the gate decide.
             *
             * The occasion is the ORIGINAL stale observation, not this
             * sweep: D60 authorizes a warning against one causal
             * observation, so an act carrying a fresh cause is not the act
             * that was warned about — the factory binding `observedAt` to
             * `entry.warnedAt` is that rule made structural.
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
                    actionClass: "clockTriggeredDestructive",
                    desired: { login: entry.assignee },
                    cause: warnedCause,
                    expected: { closed: false },
                    destructive: {
                        warnedAt: entry.warnedAt,
                        gracePeriodDays: graceDays,
                        earliestActionAt: new Date(
                            entry.warnedAt.getTime() + graceDays * 24 * 60 * 60 * 1000,
                        ),
                        cancelledBy: "a comment or commit from the assignee",
                        reversesWith: "reassigning the item to the same person",
                        qualifyingActivitySinceWarning:
                            entry.lastHumanActivityAt !== null &&
                            entry.lastHumanActivityAt.getTime() > entry.warnedAt.getTime(),
                        warnedCause,
                        warnedCauseObservedAt: entry.warnedAt,
                    },
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
