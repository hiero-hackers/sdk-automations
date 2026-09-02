/**
 * The general write door — `evaluateWrite` alone (contracts/safety.md). Widest
 * first: the enumeration fixing `apply ⇔ every rule passes`, then the
 * examples naming a code or an ordering the sweep never inspects, then the
 * D51-D53 findings that entered by THIS door. `destructive.test.ts` is the
 * other door, `rules.test.ts` the order both share, `builders.ts` the
 * request, config and context all three start from.
 */

import { describe, it, expect } from "vitest";
import {
    evaluateWrite,
    type ActionClass,
    type HumanChangeOrdering,
    type WriteContext,
} from "../../src/safety/index.js";
import { REPOSITORY_MODES, type RepositoryConfig } from "../../src/config/index.js";
import { assertedWorld } from "../../src/safety/world.js";
import { anyCapability, capabilityOff, config, context, evalWrite, request } from "./builders.js";

/**
 * The exhaustive sweep, where everything below it checks examples. It
 * enumerates the full input space and asserts the PROPERTY: `apply` happens
 * exactly when every safety rule passes, over every action class and every
 * remaining configuration and context dimension.
 */
const CAUSE_AT = new Date("2026-07-01T00:00:00Z");
const CAPABILITY = "assignment";
const requestFor = (actionClass: ActionClass) => ({
    actionClass,
    capability: CAPABILITY,
    requiredPermissions: ["issues:write"] as const,
    causeObservedAt: CAUSE_AT,
    cause: "sweep",
    target: { item: "issue #1", change: "label" },
});
const ACTION_CLASSES: ActionClass[] = [
    "observation",
    "humanFacingOutput",
    "reversibleStateChange",
    "clockTriggeredDestructive",
    "immediatePreventive",
];

describe("evaluateWrite: apply ⇔ every rule passes (full sweep)", () => {
    const bools = [false, true];
    const humanChanges: HumanChangeOrdering[] = [
        null,
        "unknown", // ordering could not be established — D51
        new Date("2026-06-30T00:00:00Z"), // older than the cause
        new Date("2026-07-02T00:00:00Z"), // newer than the cause
    ];

    /**
     * The action class is a swept DIMENSION, never a fixed value. Fixing it
     * leaves the sweep exhaustive in every dimension but the one where
     * `clockTriggeredDestructive` reaches `apply` (D52).
     */
    it("5,120 (class × context) combinations: apply exactly when nothing refuses and mode is active", () => {
        let applies = 0;
        let checked = 0;
        for (const actionClass of ACTION_CLASSES)
            for (const killSwitchActive of bools)
                for (const capabilityEnabled of bools)
                    for (const installationHasPermission of bools)
                        for (const itemBlocked of bools)
                            for (const itemClosed of bools)
                                for (const preconditionHolds of bools)
                                    for (const latestHumanChangeAt of humanChanges)
                                        for (const mode of REPOSITORY_MODES) {
                                            const config: RepositoryConfig = {
                                                revision: "rev-test",
                                                schemaVersion: 1,
                                                mode,
                                                capabilities: {
                                                    [CAPABILITY]: {
                                                        enabled: capabilityEnabled,
                                                        settings: {},
                                                    },
                                                },
                                                mappings: { labels: {} },
                                                principals: {},
                                            };
                                            const context: WriteContext = {
                                                installationGrants: installationHasPermission
                                                    ? (["issues:write"] as const)
                                                    : [],
                                                killSwitchActive,
                                                world: assertedWorld(
                                                    itemBlocked ? (["blocked"] as const) : [],
                                                    preconditionHolds,
                                                    itemClosed ? "closedByHuman" : null,
                                                ),
                                                latestHumanChangeAt,
                                            };
                                            const verdict = evaluateWrite(
                                                requestFor(actionClass),
                                                config,
                                                context,
                                            );
                                            checked += 1;
                                            // Every non-apply carries prose for humans.
                                            if (verdict.outcome !== "apply") {
                                                expect(verdict.reason.length).toBeGreaterThan(0);
                                            }
                                            if (verdict.outcome === "apply") applies += 1;

                                            const actionMayApply =
                                                actionClass !== "observation" &&
                                                actionClass !== "clockTriggeredDestructive" &&
                                                actionClass !== "immediatePreventive";
                                            const humanOrderingAllowsWrite =
                                                latestHumanChangeAt === null ||
                                                (latestHumanChangeAt !== "unknown" &&
                                                    latestHumanChangeAt.getTime() <
                                                        CAUSE_AT.getTime());
                                            const everyRulePasses =
                                                actionMayApply &&
                                                !killSwitchActive &&
                                                capabilityEnabled &&
                                                installationHasPermission &&
                                                !itemClosed &&
                                                !itemBlocked &&
                                                preconditionHolds &&
                                                humanOrderingAllowsWrite &&
                                                mode === "active";
                                            expect(verdict.outcome === "apply").toBe(
                                                everyRulePasses,
                                            );

                                            // A destructive request can NEVER apply here,
                                            // whatever the context (D52).
                                            if (
                                                actionClass === "clockTriggeredDestructive" &&
                                                !killSwitchActive &&
                                                preconditionHolds
                                            ) {
                                                expect(verdict).toMatchObject({
                                                    outcome: "refuse",
                                                    code: "wrongEntryPoint",
                                                });
                                            }
                                            // Unestablished ordering can never apply (D51).
                                            if (
                                                latestHumanChangeAt === "unknown" &&
                                                actionClass !== "observation"
                                            ) {
                                                expect(verdict.outcome).not.toBe("apply");
                                            }
                                        }
        expect(checked).toBe(5_120); // 5 classes × 2^6 flags × 4 orderings × 4 modes
        // 2 currently authorized write classes × active mode ×
        // {null, older} ordering = 4. Immediate preventive actions stay
        // fail-closed until their explanation/reversal gate exists.
        expect(applies).toBe(4);
    });
});

describe("evaluateWrite (contracts/safety.md)", () => {
    // The sweep above enumerates plain apply/not-apply, so what survives here
    // asserts a specific code, reason, or ordering it never checks.

    it.each([
        ["kill switch", { killSwitchActive: true }, "killSwitch"],
        ["missing permission (rule 2)", { installationGrants: [] as const }, "permissionMissing"],
        ["blocked item (pause)", { world: assertedWorld(["blocked"], true) }, "itemBlocked"],
        ["closed item (terminal)", { world: assertedWorld([], true, "merged") }, "itemClosed"],
        [
            "failed precondition recheck (rule 4)",
            { world: assertedWorld([], false) },
            "preconditionStale",
        ],
        [
            "newer human change (rule 5)",
            { latestHumanChangeAt: new Date("2026-07-01T00:00:01Z") },
            "newerHumanChange",
        ],
    ])("refuses on %s", (_name, override, code) => {
        const verdict = evalWrite(request(), context(override));
        expect(verdict).toMatchObject({ outcome: "refuse", code });
    });

    // Mode and enablement refusals are stated as configurations, not as
    // context facts (D73).
    it("refuses when the repository mode is disabled", () => {
        expect(evalWrite(request(), context(), config({ mode: "disabled" }))).toMatchObject({
            outcome: "refuse",
            code: "modeDisabled",
        });
    });

    it("refuses when the reviewed configuration disables the capability", () => {
        expect(evalWrite(request(), context(), capabilityOff)).toMatchObject({
            outcome: "refuse",
            code: "capabilityDisabled",
        });
    });

    /**
     * Silence is not enablement. A capability the file never mentions reads
     * `undefined` out of a null-prototype record, and the derivation must
     * treat that as "off" rather than reaching into it. Otherwise the
     * commonest configuration of all — a capability nobody has adopted — is
     * a crash instead of a refusal.
     */
    it("a capability the reviewed file never mentions is disabled, not a crash", () => {
        expect(evalWrite(request({ capability: "neverConfigured" }), context())).toMatchObject({
            outcome: "refuse",
            code: "capabilityDisabled",
        });
    });

    /**
     * The message names the absent permissions (D77), plural, so the list has
     * to read as a list.
     */
    it("names every absent grant, not just the first (rule 2)", () => {
        const verdict = evalWrite(
            request({ requiredPermissions: ["issues:write", "contents:write"] }),
            context({ installationGrants: [] }),
        );
        expect(verdict).toMatchObject({ outcome: "refuse", code: "permissionMissing" });
        if (verdict.outcome === "refuse") {
            expect(verdict.reason).toContain("issues:write, contents:write");
        }
    });

    /**
     * Closure is platform-enforced, not a capability's favour to ask. A
     * capability may claim `expected.closed: false`, but the claim is
     * optional and `intentFactory` defaults it to no claim — so before this
     * rule a closed item was protected only by the capabilities that
     * remembered. Nothing in the request below mentions closure at all.
     */
    it("refuses on a closed item and names the closure GitHub reported", () => {
        for (const closure of ["merged", "closedByHuman", "completedByLinkedMerge"] as const) {
            const verdict = evalWrite(
                request(),
                context({ world: assertedWorld([], true, closure) }),
            );
            expect(verdict).toMatchObject({ outcome: "refuse", code: "itemClosed" });
            if (verdict.outcome === "refuse") expect(verdict.reason).toContain(closure);
        }
    });

    /**
     * Closure ahead of the pause. Both refuse, so only the CODE distinguishes
     * them, and telling a maintainer a merged pull request is "paused" names
     * the fact they can undo and hides the one they cannot.
     */
    it("a closed and blocked item reports the closure, not the pause", () => {
        expect(
            evalWrite(request(), context({ world: assertedWorld(["blocked"], true, "merged") })),
        ).toMatchObject({ outcome: "refuse", code: "itemClosed" });
    });

    it("the check precedence is contract: the earliest failing rule names the code", () => {
        // Everything fails at once; the kill switch is reported.
        const verdict = evalWrite(
            request(),
            context({
                killSwitchActive: true,
                installationGrants: [],
                world: assertedWorld(["blocked"], false),
            }),
            config({
                mode: "disabled",
                capabilities: { assignment: { enabled: false, settings: {} } },
            }),
        );
        expect(verdict).toMatchObject({ outcome: "refuse", code: "killSwitch" });
    });

    it("unavailable authority is reported before permissions, mode, and observation handling", () => {
        const unavailable = context({
            installationGrants: [],
            world: assertedWorld([], false),
        });
        expect(
            evalWrite(
                request({ actionClass: "observation" }),
                unavailable,
                config({ mode: "disabled" }),
            ),
        ).toMatchObject({ outcome: "refuse", code: "preconditionStale" });
    });

    it.each(["observe", "dry-run"] as const)(
        "%s mode records instead of applying (rule 10)",
        (mode) => {
            const verdict = evalWrite(request(), context(), config({ mode }));
            expect(verdict).toMatchObject({ outcome: "record-only", code: "modeRecordsOnly" });
        },
    );

    it("observations never require enablement or permission", () => {
        const verdict = evalWrite(
            request({ actionClass: "observation" }),
            context({ installationGrants: [] }),
            capabilityOff,
        );
        expect(verdict).toMatchObject({ outcome: "record-only", code: "observation" });
    });

    it("a human change at the exact cause instant refuses — ties go to the human", () => {
        // FINDING(safety-human-tie): causeObservedAt is 2026-07-01T00:00:00Z.
        const verdict = evalWrite(
            request(),
            context({ latestHumanChangeAt: new Date("2026-07-01T00:00:00Z") }),
        );
        expect(verdict.outcome).toBe("refuse");
    });

    it.each([
        [
            "an invalid cause timestamp",
            request({ causeObservedAt: new Date("invalid") }),
            context({
                latestHumanChangeAt: new Date("2026-06-30T23:59:59Z"),
            }),
        ],
        [
            "an invalid human-change timestamp",
            request(),
            context({
                latestHumanChangeAt: new Date("invalid"),
            }),
        ],
    ] as const)("fails closed on %s", (_name, badRequest, badContext) => {
        const verdict = evalWrite(badRequest, badContext);
        expect(verdict).toMatchObject({
            outcome: "refuse",
            code: "invalidTimestamp",
        });
        if (verdict.outcome === "refuse") {
            expect(verdict.reason.length).toBeGreaterThan(0);
        }
    });

    // FINDING(safety-killswitch-observations)
    it("the kill switch beats everything, including observations", () => {
        const verdict = evalWrite(
            request({ actionClass: "observation" }),
            context({ killSwitchActive: true }),
        );
        expect(verdict).toMatchObject({ outcome: "refuse", code: "killSwitch" });
    });
});

describe("audit findings, pinned (D51-D53)", () => {
    /**
     * D52 — the headline: the destructive gates must be inescapable, not a
     * calling convention. Before this, the same call answered `apply`.
     */
    it("evaluateWrite refuses a destructive request instead of applying it", () => {
        const verdict = evalWrite(
            request({ actionClass: "clockTriggeredDestructive", capability: "assignment" }),
            context(),
        );
        expect(verdict).toMatchObject({ outcome: "refuse", code: "wrongEntryPoint" });
    });

    it("no context can make evaluateWrite apply a destructive request", () => {
        for (const mode of REPOSITORY_MODES) {
            expect(
                evalWrite(
                    request({ actionClass: "clockTriggeredDestructive" }),
                    context(),
                    config({ mode }),
                ).outcome,
            ).toBe("refuse");
        }
    });

    // D51 — unknown ordering is a conflict, not an absence.
    it("unestablished human-change ordering refuses (manual-edits.md §2)", () => {
        expect(evalWrite(request(), context({ latestHumanChangeAt: "unknown" }))).toMatchObject({
            outcome: "refuse",
            code: "humanOrderingUnknown",
        });
    });

    it("null still means CHECKED-and-none, and still applies", () => {
        expect(evalWrite(request(), context({ latestHumanChangeAt: null }))).toEqual({
            outcome: "apply",
        });
    });

    it("refuses immediate preventive actions until their explanation and reversal gate exists", () => {
        expect(
            evalWrite(
                request({
                    actionClass: "immediatePreventive",
                    capability: "intake",
                    target: { item: "issue #42", change: "lock pending moderation" },
                }),
                context(),
                anyCapability("intake"),
            ),
        ).toMatchObject({ outcome: "refuse", code: "preventiveGateUnavailable" });
    });
});
