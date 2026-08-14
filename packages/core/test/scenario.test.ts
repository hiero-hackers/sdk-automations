/**
 * One realistic story walked through every core module in composition —
 * direct admission → config → observation → taxonomy → safety. No I/O.
 */
import { describe, it, expect } from "vitest";
import {
    validateCapabilityDeclarations,
    parseConfig,
    projectIssueObservation,
    applyIssueTransition,
    evaluateWrite,
    type CapabilityDeclaration,
    type WorkItemState,
    type IssueMeaning,
} from "../src/index.js";
import { assertedWorld } from "../src/safety/world.js";

const assignment: CapabilityDeclaration = {
    name: "assignment",
    triggers: [{ kind: "event", event: "issue_comment.created" }],
    configKeys: ["maxOpenAssignments"],
    observations: ["issueUpdated"],
    resolvers: [],
    intents: ["applyMappedLabel"],
    operationalNeeds: {
        schedule: false,
        durableState: "none",
        crossItemCoordination: false,
        externalDelivery: false,
    },
};

describe("the assignment story, end to end in pure logic", () => {
    // 1. The platform validates the direct shipped declaration list.
    const declarations = [assignment];
    const declarationErrors = validateCapabilityDeclarations(declarations);
    if (declarationErrors.length > 0) throw new Error(declarationErrors.join("; "));

    // 2. The repository's reviewed config enables the capability and
    //    maps its labels.
    const configResult = parseConfig(
        {
            schemaVersion: 1,
            mode: "active",
            capabilities: { assignment: { enabled: true } },
            mappings: {
                labels: {
                    ready: "status: ready for dev",
                    inProgress: "status: in progress",
                },
            },
        },
        { revision: "rev-test", knownCapabilities: declarations.map(({ name }) => name) },
    );
    if (!configResult.ok) throw new Error(configResult.errors.map((e) => e.message).join("; "));
    const config = configResult.config;

    it("wires admission → config → projection → transition → safety into one apply", () => {
        // 3. The shell observes the issue's labels and maps them to
        //    meanings via config.mappings; core projects a position.
        const projection = projectIssueObservation({ closedBy: null, meanings: ["ready"] });
        expect(projection.kind).toBe("position");
        if (projection.kind !== "position") return;

        // 4. A contributor is assigned; the capability requests the
        //    documented transition.
        const request = {
            from: "ready",
            to: "inProgress",
            cause: "contributorAssigned",
        } as const;
        const { state, verdict } = applyIssueTransition(projection.state, request);
        expect(verdict).toEqual({ allowed: true });
        expect(state.meaning).toBe("inProgress");

        // 5. The write that realizes it passes every safety rule.
        const write = evaluateWrite(
            {
                actionClass: "reversibleStateChange",
                capability: "assignment",
                requiredPermissions: ["issues:write"],
                causeObservedAt: new Date("2026-07-25T10:00:00Z"),
                cause: "contributor requested /assign",
                target: { item: "issue #7", change: "label 'status: in progress'" },
            },
            config,
            {
                installationGrants: ["issues:write"], // shell fact, from the App's grants
                killSwitchActive: false,
                world: assertedWorld(state.blocked ? (["blocked"] as const) : [], true),
                latestHumanChangeAt: new Date("2026-07-25T09:59:00Z"), // older: no conflict
            },
        );
        expect(write).toEqual({ outcome: "apply" });
    });

    it("a human closing the issue defeats a stale scheduled intent at BOTH layers", () => {
        // The issue was closed by a human; a scheduled evaluation still
        // believes it is inProgress.
        const closed: WorkItemState<IssueMeaning> = {
            meaning: null,
            blocked: false,
            closedBy: "closedByHuman",
        };
        const stale = applyIssueTransition(closed, {
            from: "inProgress",
            to: "ready",
            cause: "reclaimCompleted",
        });
        expect(stale.verdict).toMatchObject({ allowed: false, code: "itemClosed" });

        // And even if the state machine were bypassed, safety refuses
        // on the newer human change alone.
        const write = evaluateWrite(
            {
                actionClass: "reversibleStateChange",
                capability: "assignment",
                requiredPermissions: ["issues:write"],
                causeObservedAt: new Date("2026-07-25T10:00:00Z"),
                cause: "scheduled reclaim evaluation",
                target: { item: "issue #7", change: "label 'status: ready for dev'" },
            },
            config,
            {
                installationGrants: ["issues:write"],
                killSwitchActive: false,
                world: assertedWorld([], false), // recheck saw the close
                latestHumanChangeAt: new Date("2026-07-25T10:05:00Z"), // the close
            },
        );
        expect(write.outcome).toBe("refuse");
    });

    it("a conflicted observation never reaches the state machine — there is no state to pass", () => {
        const projection = projectIssueObservation({
            closedBy: null,
            meanings: ["ready", "inProgress"],
        });
        expect(projection.kind).toBe("conflict");
        // The structural point: only the `position` branch carries a
        // WorkItemState, so the reference walk is unreachable from here.
    });

    it("dry-run mode records the same story instead of applying it", () => {
        const dryConfig = parseConfig(
            {
                schemaVersion: 1,
                mode: "dry-run",
                capabilities: { assignment: { enabled: true } },
            },
            { revision: "rev-test", knownCapabilities: declarations.map(({ name }) => name) },
        );
        expect(dryConfig.ok).toBe(true);
        if (!dryConfig.ok) return;
        const write = evaluateWrite(
            {
                actionClass: "reversibleStateChange",
                capability: "assignment",
                requiredPermissions: ["issues:write"],
                causeObservedAt: new Date("2026-07-25T10:00:00Z"),
                cause: "contributor requested /assign",
                target: { item: "issue #7", change: "label 'status: in progress'" },
            },
            dryConfig.config,
            {
                installationGrants: ["issues:write"],
                killSwitchActive: false,
                world: assertedWorld([], true),
                latestHumanChangeAt: null,
            },
        );
        expect(write).toMatchObject({ outcome: "record-only", code: "modeRecordsOnly" });
    });
});
