/**
 * One realistic story walked through every core module in composition —
 * direct admission → config → observation → taxonomy → safety. No I/O.
 */
import { describe, it, expect } from "vitest";
import {
    validateCapabilityDeclarations,
    deriveWorld,
    projectIssueObservation,
    applyIssueTransition,
    evaluateWrite,
    type CapabilityDeclaration,
    type WorkItemState,
    type IssueMeaning,
} from "../src/index.js";
import { configWith } from "./config/builders.js";

const assignment: CapabilityDeclaration = {
    name: "assignment",
    triggers: [{ kind: "event", event: "issue_comment.created" }],
    configKeys: ["maxOpenAssignments"],
    requiredMeanings: [],
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
    const config = configWith({
        capabilities: ["assignment"],
        known: declarations.map(({ name }) => name),
        labels: {
            ready: "status: ready for dev",
            inProgress: "status: in progress",
        },
    });

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

        // 5. The write that realizes it passes every safety rule, against the
        //    world DERIVED from what was observed — the projection above,
        //    read against the claim the capability made to get here.
        const world = deriveWorld(projection, {
            meaningsPresent: ["ready"],
            meaningsAbsent: [],
            closed: false,
        });
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
                world,
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

        // And even if the state machine were bypassed, safety refuses on the
        // newer human change ALONE — so the world here is the one a recheck
        // that MISSED the close would derive: still open, still inProgress,
        // precondition intact. Every other rule is satisfied; only the close's
        // timestamp is left to refuse, which is the whole claim.
        const missedTheClose = deriveWorld(
            projectIssueObservation({ closedBy: null, meanings: ["inProgress"] }),
            { meaningsPresent: ["inProgress"], meaningsAbsent: [], closed: false },
        );
        expect(missedTheClose).toMatchObject({ preconditionHolds: true, closure: null });

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
                world: missedTheClose,
                latestHumanChangeAt: new Date("2026-07-25T10:05:00Z"), // the close
            },
        );
        expect(write).toMatchObject({ outcome: "refuse", code: "newerHumanChange" });
    });

    it("a conflicted observation never reaches the state machine — there is no state to pass", () => {
        const projection = projectIssueObservation({
            closedBy: null,
            meanings: ["ready", "inProgress"],
        });
        expect(projection).toMatchObject({
            kind: "conflict",
            positions: ["ready", "inProgress"],
            blocked: false,
            closedBy: null,
        });

        // The structural point, asserted rather than described: only the
        // `position` branch carries a WorkItemState, so a consumer that would
        // transition anything it can reach has nothing to hand the machine.
        // The stub stands where that call would go — the day a conflict grows
        // a state, this test throws instead of quietly passing.
        const machine = (): never => {
            throw new Error("must not run: a conflict carries no state to transition");
        };
        const walked = projection.kind === "position" ? machine() : "nothing to transition";
        expect(walked).toBe("nothing to transition");
    });

    it("dry-run mode records the same story instead of applying it", () => {
        const dryConfig = configWith({
            mode: "dry-run",
            capabilities: ["assignment"],
            known: declarations.map(({ name }) => name),
        });
        const write = evaluateWrite(
            {
                actionClass: "reversibleStateChange",
                capability: "assignment",
                requiredPermissions: ["issues:write"],
                causeObservedAt: new Date("2026-07-25T10:00:00Z"),
                cause: "contributor requested /assign",
                target: { item: "issue #7", change: "label 'status: in progress'" },
            },
            dryConfig,
            {
                installationGrants: ["issues:write"],
                killSwitchActive: false,
                // The same clean, open item as the applying story — so mode is
                // demonstrably the only thing that differs between them.
                world: deriveWorld(
                    projectIssueObservation({ closedBy: null, meanings: ["ready"] }),
                    {
                        meaningsPresent: ["ready"],
                        meaningsAbsent: [],
                        closed: false,
                    },
                ),
                latestHumanChangeAt: null,
            },
        );
        expect(write).toMatchObject({ outcome: "record-only", code: "modeRecordsOnly" });
    });
});
