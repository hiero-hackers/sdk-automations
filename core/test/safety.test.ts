import { describe, it, expect } from "vitest";
import {
    evaluateWrite,
    evaluateDestructive,
    MIN_GRACE_DAYS,
    type WriteRequest,
    type WriteContext,
    type DestructivePlan,
} from "../src/safety.js";

const request = (over?: Partial<WriteRequest>): WriteRequest => ({
    actionClass: "reversibleStateChange",
    capability: "assignment",
    causeObservedAt: new Date("2026-07-01T00:00:00Z"),
    cause: "contributor requested /assign",
    target: { item: "issue #42", change: "add label 'status: in progress'" },
    ...over,
});

const context = (over?: Partial<WriteContext>): WriteContext => ({
    mode: "active",
    capabilityEnabled: true,
    installationHasPermission: true,
    killSwitchActive: false,
    itemBlocked: false,
    preconditionHolds: true,
    newerHumanChange: false,
    ...over,
});

describe("evaluateWrite (safety.md §2)", () => {
    it("applies only when every rule passes in active mode", () => {
        expect(evaluateWrite(request(), context())).toEqual({ outcome: "apply" });
    });

    it.each([
        ["kill switch", { killSwitchActive: true }],
        ["capability disabled (rule 1)", { capabilityEnabled: false }],
        ["missing permission (rule 2)", { installationHasPermission: false }],
        ["blocked item (§5)", { itemBlocked: true }],
        ["failed precondition recheck (rule 4)", { preconditionHolds: false }],
        ["newer human change (rule 5)", { newerHumanChange: true }],
        ["disabled mode", { mode: "disabled" as const }],
    ])("refuses on %s", (_name, override) => {
        const verdict = evaluateWrite(request(), context(override));
        expect(verdict.outcome).toBe("refuse");
    });

    it.each(["observe", "dry-run"] as const)(
        "%s mode records instead of applying (rule 10)",
        (mode) => {
            const verdict = evaluateWrite(request(), context({ mode }));
            expect(verdict.outcome).toBe("record-only");
        },
    );

    it("observations never require enablement or permission", () => {
        const verdict = evaluateWrite(
            request({ actionClass: "observation" }),
            context({ capabilityEnabled: false, installationHasPermission: false }),
        );
        expect(verdict.outcome).toBe("record-only");
    });

    it("the kill switch beats everything, including observations", () => {
        const verdict = evaluateWrite(
            request({ actionClass: "observation" }),
            context({ killSwitchActive: true }),
        );
        expect(verdict.outcome).toBe("refuse");
    });
});

describe("evaluateDestructive (safety.md §3–§4)", () => {
    const destructive = (over?: Partial<DestructivePlan>): DestructivePlan => ({
        request: request({
            actionClass: "clockTriggeredDestructive",
            capability: "inactivity",
            cause: "no qualifying activity for 21 days",
        }),
        warning: {
            warnedAt: new Date("2026-07-01T00:00:00Z"),
            gracePeriodDays: 7,
            cancelledBy: "any comment or commit by the assignee",
        },
        qualifyingActivitySinceWarning: false,
        ...over,
    });

    const afterGrace = new Date("2026-07-09T00:00:00Z"); // 8 days later
    const duringGrace = new Date("2026-07-05T00:00:00Z"); // 4 days later

    it("never acts on first observation — a missing warning refuses", () => {
        const verdict = evaluateDestructive(
            destructive({ warning: null }),
            context(),
            afterGrace,
        );
        expect(verdict.outcome).toBe("refuse");
    });

    it("refuses while the grace period is running", () => {
        expect(
            evaluateDestructive(destructive(), context(), duringGrace).outcome,
        ).toBe("refuse");
    });

    it("refuses when the affected person was active during the grace period", () => {
        expect(
            evaluateDestructive(
                destructive({ qualifyingActivitySinceWarning: true }),
                context(),
                afterGrace,
            ).outcome,
        ).toBe("refuse");
    });

    it.each([0, -1, MIN_GRACE_DAYS - 1])(
        "refuses a grace period of %s days (§4 floor)",
        (days) => {
            const plan = destructive();
            const verdict = evaluateDestructive(
                {
                    ...plan,
                    warning: { ...plan.warning!, gracePeriodDays: days },
                },
                context(),
                afterGrace,
            );
            expect(verdict.outcome).toBe("refuse");
        },
    );

    it("a warned, elapsed, quiet, unblocked plan still respects repository mode", () => {
        expect(
            evaluateDestructive(destructive(), context({ mode: "dry-run" }), afterGrace)
                .outcome,
        ).toBe("record-only");
        expect(
            evaluateDestructive(destructive(), context(), afterGrace).outcome,
        ).toBe("apply");
    });

    it("a human change during the grace period cancels the plan (rule 5)", () => {
        expect(
            evaluateDestructive(
                destructive(),
                context({ newerHumanChange: true }),
                afterGrace,
            ).outcome,
        ).toBe("refuse");
    });

    it("rejects a non-destructive request routed through the destructive path", () => {
        const plan = destructive();
        expect(
            evaluateDestructive(
                { ...plan, request: request() },
                context(),
                afterGrace,
            ).outcome,
        ).toBe("refuse");
    });
});
