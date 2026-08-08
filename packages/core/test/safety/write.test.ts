import { describe, it, expect } from "vitest";
import {
    evaluateWrite,
    GENERAL_RULES,
    evaluateDestructive,
    createDestructiveWarning,
    MIN_GRACE_DAYS,
    type WriteRequest,
    type WriteContext,
    type DestructivePlan,
    type DestructiveWarning,
    type DestructiveWarningInput,
} from "../../src/safety/index.js";
import { REPOSITORY_MODES, type RepositoryConfig } from "../../src/config/index.js";
import { assertedWorld } from "../../src/safety/world.js";

const request = (over?: Partial<WriteRequest>): WriteRequest => ({
    actionClass: "reversibleStateChange",
    capability: "assignment",
    requiredPermissions: ["issues:write"],
    causeObservedAt: new Date("2026-07-01T00:00:00Z"),
    cause: "contributor requested /assign",
    target: { item: "issue #42", change: "add label 'status: in progress'" },
    ...over,
});

/**
 * The reviewed configuration is now the ONLY source of mode and
 * enablement (D73) — a test that wants a disabled capability or a
 * dry-run repository says so here, where a maintainer would.
 */
const config = (over?: Partial<RepositoryConfig>): RepositoryConfig => ({
    revision: "rev-test",
    schemaVersion: 1,
    mode: "active",
    capabilities: {
        assignment: { enabled: true, settings: {} },
        inactivity: { enabled: true, settings: {} },
        intake: { enabled: true, settings: {} },
    },
    mappings: { labels: {} },
    principals: {},
    ...over,
});

const anyCapability = (name: string) =>
    config({ capabilities: { [name]: { enabled: true, settings: {} } } });

const capabilityOff = config({
    capabilities: { assignment: { enabled: false, settings: {} } },
});

/** Config last so the existing call shape stays readable. */
const evalWrite = (r: WriteRequest, c: WriteContext, cfg: RepositoryConfig = config()) =>
    evaluateWrite(r, cfg, c);

const evalDestructive = (
    plan: DestructivePlan,
    c: WriteContext,
    now: Date,
    cfg: RepositoryConfig = config(),
) => evaluateDestructive(plan, cfg, c, now);

const context = (over?: Partial<WriteContext>): WriteContext => ({
    installationGrants: ["issues:write"],
    killSwitchActive: false,
    latestHumanChangeAt: null,
    world: assertedWorld([], true),
    ...over,
});

const warningFor = (
    warnedRequest: WriteRequest,
    over?: Partial<Omit<DestructiveWarningInput, "request">>,
): DestructiveWarning =>
    createDestructiveWarning({
        request: warnedRequest,
        warnedAt: new Date("2026-07-01T00:00:00Z"),
        gracePeriodDays: 7,
        earliestActionAt: new Date("2026-07-08T00:00:00Z"),
        cancelledBy: "any comment or commit by the assignee",
        reversesWith: "a maintainer or author restores the previous state",
        ...over,
    });

describe("evaluateWrite (safety.md §2)", () => {
    it("applies only when every rule passes in active mode", () => {
        expect(evalWrite(request(), context())).toEqual({ outcome: "apply" });
    });

    it.each([
        ["kill switch", { killSwitchActive: true }, "killSwitch"],
        ["missing permission (rule 2)", { installationGrants: [] as const }, "permissionMissing"],
        ["blocked item (§5)", { world: assertedWorld(["blocked"], true) }, "itemBlocked"],
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

    // Mode and enablement now come from the reviewed configuration (D73),
    // so their refusals are stated as configurations, not as context facts.
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

    it("a human change older than the cause does not conflict", () => {
        const verdict = evalWrite(
            request(),
            context({ latestHumanChangeAt: new Date("2026-06-30T23:59:59Z") }),
        );
        expect(verdict).toEqual({ outcome: "apply" });
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
     * D52 — the headline: the §3 gates must be inescapable, not a
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

    it("unknown ordering also stops a fully-warranted destructive action", () => {
        const destructiveRequest = request({
            actionClass: "clockTriggeredDestructive",
            capability: "inactivity",
        });
        const plan: DestructivePlan = {
            request: destructiveRequest,
            warning: warningFor(destructiveRequest),
            qualifyingActivitySinceWarning: false,
        };
        expect(
            evalDestructive(
                plan,
                context({ latestHumanChangeAt: "unknown" }),
                new Date("2026-08-01T00:00:00Z"),
                anyCapability("inactivity"),
            ),
        ).toMatchObject({ outcome: "refuse", code: "humanOrderingUnknown" });
    });

    // D52 — the kill switch is reported FIRST on the destructive path too.
    it("an active kill switch is reported as killSwitch, not noWarning", () => {
        expect(
            evalDestructive(
                {
                    request: request({
                        actionClass: "clockTriggeredDestructive",
                        capability: "inactivity",
                    }),
                    warning: null,
                    qualifyingActivitySinceWarning: false,
                },
                context({ killSwitchActive: true }),
                new Date("2026-08-01T00:00:00Z"),
                anyCapability("inactivity"),
            ),
        ).toMatchObject({ outcome: "refuse", code: "killSwitch" });
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

    it("a destructive capability mismatch is reported before plan policy", () => {
        expect(
            evalDestructive(
                {
                    request: request({
                        actionClass: "clockTriggeredDestructive",
                        capability: "inactivity",
                    }),
                    warning: null,
                    qualifyingActivitySinceWarning: false,
                },
                context(),
                new Date("2026-08-01T00:00:00Z"),
                anyCapability("inactivity"),
            ),
        ).toMatchObject({ outcome: "refuse", code: "noWarning" });
    });
});

describe("evaluateDestructive (safety.md §3–§4)", () => {
    /**
     * These plans are from the `inactivity` capability, so the rechecked
     * context must describe that same capability — D53's link check
     * refuses a context about a different one.
     */
    const dConfig = anyCapability("inactivity");
    const dContext = (over?: Partial<WriteContext>): WriteContext => context(over);

    const destructive = (over?: Partial<DestructivePlan>): DestructivePlan => {
        const destructiveRequest = request({
            actionClass: "clockTriggeredDestructive",
            capability: "inactivity",
            cause: "no qualifying activity for 21 days",
        });
        return {
            request: destructiveRequest,
            warning: warningFor(destructiveRequest),
            qualifyingActivitySinceWarning: false,
            ...over,
        };
    };

    const afterGrace = new Date("2026-07-09T00:00:00Z"); // 8 days later
    const duringGrace = new Date("2026-07-05T00:00:00Z"); // 4 days later

    it("never acts on first observation — a missing warning refuses", () => {
        const verdict = evalDestructive(destructive({ warning: null }), dContext(), afterGrace);
        expect(verdict).toMatchObject({ outcome: "refuse", code: "noWarning" });
    });

    it("refuses while the grace period is running", () => {
        expect(evalDestructive(destructive(), dContext(), duringGrace)).toMatchObject({
            outcome: "refuse",
            code: "graceRunning",
        });
    });

    it("refuses when the affected person was active during the grace period", () => {
        expect(
            evalDestructive(
                destructive({ qualifyingActivitySinceWarning: true }),
                dContext(),
                afterGrace,
            ),
        ).toMatchObject({ outcome: "refuse", code: "activityCancelled" });
    });

    it("refuses warning reuse across capabilities, targets, and causes", () => {
        const plan = destructive();
        const mismatches: readonly [WriteRequest, WriteContext][] = [
            [
                { ...plan.request, target: { ...plan.request.target, item: "issue #999" } },
                dContext(),
            ],
            [
                { ...plan.request, target: { ...plan.request.target, change: "unassign" } },
                dContext(),
            ],
            [{ ...plan.request, cause: "a different inactivity observation" }, dContext()],
            [{ ...plan.request, causeObservedAt: new Date("2026-07-01T00:00:01Z") }, dContext()],
            [{ ...plan.request, capability: "anotherCapability" }, dContext()],
        ];
        for (const [mismatchedRequest, matchingContext] of mismatches) {
            const verdict = evalDestructive(
                { ...plan, request: mismatchedRequest },
                matchingContext,
                afterGrace,
            );
            expect(verdict).toMatchObject({ outcome: "refuse", code: "warningRequestMismatch" });
            if (verdict.outcome === "refuse") expect(verdict.reason.length).toBeGreaterThan(0);
        }

        const wrongClass = evalDestructive(
            {
                ...plan,
                warning: warningFor({
                    ...plan.request,
                    actionClass: "reversibleStateChange",
                }),
            },
            dContext(),
            afterGrace,
        );
        expect(wrongClass).toMatchObject({ outcome: "refuse", code: "warningRequestMismatch" });
    });

    it("warning issuance copies primitives so later request mutation cannot change its authority", () => {
        const aliasedRequest = request({
            actionClass: "clockTriggeredDestructive",
            capability: "inactivity",
            target: { item: "issue #1", change: "unassign alice" },
        });
        const warning = warningFor(aliasedRequest);
        expect(Object.isFrozen(warning)).toBe(true);
        expect(Object.isFrozen(warning.requestSnapshot)).toBe(true);

        const mutableTarget = aliasedRequest.target as { item: string; change: string };
        mutableTarget.item = "issue #999";
        mutableTarget.change = "close issue";
        aliasedRequest.causeObservedAt.setTime(new Date("2026-07-01T00:00:01Z").getTime());

        expect(
            evalDestructive(
                {
                    request: aliasedRequest,
                    warning,
                    qualifyingActivitySinceWarning: false,
                },
                context(),
                new Date("2026-07-09T00:00:00Z"),
                dConfig,
            ),
        ).toMatchObject({ outcome: "refuse", code: "warningRequestMismatch" });
        expect(warning.requestSnapshot).toMatchObject({
            item: "issue #1",
            change: "unassign alice",
            causeObservedAtMs: new Date("2026-07-01T00:00:00Z").getTime(),
        });
    });

    it("refuses inconsistent or incomplete warning metadata", () => {
        const plan = destructive();
        const invalidWarnings: readonly DestructiveWarning[] = [
            warningFor(plan.request, {
                warnedAt: new Date("2026-06-30T23:59:59Z"),
            }),
            warningFor(plan.request, {
                earliestActionAt: new Date("2026-07-07T23:59:59Z"),
            }),
            warningFor(plan.request, { cancelledBy: "   " }),
            warningFor(plan.request, { reversesWith: "   " }),
        ];
        for (const warning of invalidWarnings) {
            const verdict = evalDestructive({ ...plan, warning }, dContext(), afterGrace);
            expect(verdict).toMatchObject({ outcome: "refuse", code: "invalidDestructivePlan" });
            if (verdict.outcome === "refuse") expect(verdict.reason.length).toBeGreaterThan(0);
        }
    });

    it.each([0, -1, MIN_GRACE_DAYS - 1])("refuses a grace period of %s days (§4 floor)", (days) => {
        const plan = destructive();
        const verdict = evalDestructive(
            {
                ...plan,
                warning: warningFor(plan.request, { gracePeriodDays: days }),
            },
            dContext(),
            afterGrace,
        );
        expect(verdict).toMatchObject({ outcome: "refuse", code: "graceBelowFloor" });
    });

    it.each([
        ["a non-finite grace period", Number.NaN, new Date("2026-07-01T00:00:00Z"), afterGrace],
        ["an invalid warning timestamp", 7, new Date("invalid"), afterGrace],
        ["an invalid current timestamp", 7, new Date("2026-07-01T00:00:00Z"), new Date("invalid")],
    ] as const)("fails closed on %s", (_name, gracePeriodDays, warnedAt, now) => {
        const plan = destructive();
        const verdict = evalDestructive(
            {
                ...plan,
                warning: warningFor(plan.request, { gracePeriodDays, warnedAt }),
            },
            dContext(),
            now,
        );
        expect(verdict).toMatchObject({
            outcome: "refuse",
            code: "invalidDestructivePlan",
        });
        if (verdict.outcome === "refuse") {
            expect(verdict.reason.length).toBeGreaterThan(0);
        }
    });

    // Mutation-testing survivors, now pinned — both boundaries exact:
    it("a grace period exactly at the floor is legal, and acts exactly when it elapses", () => {
        const plan = destructive();
        const atFloor = {
            ...plan,
            warning: warningFor(plan.request, {
                gracePeriodDays: MIN_GRACE_DAYS,
                earliestActionAt: new Date("2026-07-02T00:00:00Z"),
            }),
        };
        // warnedAt 2026-07-01T00:00:00Z + exactly MIN_GRACE_DAYS days:
        // the grace has fully elapsed at this instant, not one ms later.
        expect(evalDestructive(atFloor, dContext(), new Date("2026-07-02T00:00:00Z")).outcome).toBe(
            "apply",
        );
        expect(
            evalDestructive(atFloor, dContext(), new Date("2026-07-01T23:59:59.999Z")),
        ).toMatchObject({ outcome: "refuse", code: "graceRunning" });
    });

    it("a warned, elapsed, quiet, unblocked plan still respects repository mode", () => {
        expect(
            evalDestructive(destructive(), dContext(), afterGrace, config({ mode: "dry-run" }))
                .outcome,
        ).toBe("record-only");
        expect(evalDestructive(destructive(), dContext(), afterGrace).outcome).toBe("apply");
    });

    it("a human change during the grace period cancels the plan (rule 5)", () => {
        expect(
            evalDestructive(
                destructive(),
                dContext({ latestHumanChangeAt: new Date("2026-07-05T12:00:00Z") }),
                afterGrace,
            ).outcome,
        ).toBe("refuse");
    });

    it("every destructive refusal carries a non-empty human reason", () => {
        const plan = destructive();
        const refusals = [
            evalDestructive(destructive({ warning: null }), dContext(), afterGrace),
            evalDestructive(destructive(), dContext(), duringGrace),
            evalDestructive(
                destructive({ qualifyingActivitySinceWarning: true }),
                dContext(),
                afterGrace,
            ),
            evalDestructive(
                { ...plan, warning: warningFor(plan.request, { gracePeriodDays: 0 }) },
                dContext(),
                afterGrace,
            ),
            evalDestructive({ ...plan, request: request() }, context(), afterGrace),
        ];
        for (const verdict of refusals) {
            expect(verdict.outcome).toBe("refuse");
            if (verdict.outcome === "refuse") expect(verdict.reason.length).toBeGreaterThan(0);
        }
        // And the observation record-only verdict explains itself too.
        // `context()` here, not `dContext()`: `request()` defaults to the
        // `assignment` capability, and D53's link check runs BEFORE the
        // observation short-circuit — a request and context describing
        // different capabilities is malformed input, not a policy
        // question, so no action class is exempt from it.
        const observed = evalWrite(request({ actionClass: "observation" }), context());
        expect(observed).toMatchObject({ outcome: "record-only" });
        if (observed.outcome === "record-only") expect(observed.reason.length).toBeGreaterThan(0);
    });

    it("rejects a non-destructive request routed through the destructive path", () => {
        const plan = destructive();
        expect(
            evalDestructive({ ...plan, request: request() }, context(), afterGrace),
        ).toMatchObject({ outcome: "refuse", code: "wrongActionClass" });
    });
});

describe("the check order is contract, and now assertable directly", () => {
    /**
     * D39 makes verdict CODES contract, and D52 was a precedence defect: the
     * kill switch was checked last on the destructive path, so an operator who
     * had pulled the emergency brake was told "no recorded warning". The
     * outcome was a refusal either way — only the reported code was wrong.
     *
     * While precedence was a sequence of `if`s it could only be tested by
     * constructing inputs that trip several rules and seeing which wins. As a
     * list it can be pinned outright, which is the entire reason for the shape.
     */
    it("pins the general-rule order", () => {
        expect(GENERAL_RULES.map(([name]) => name)).toEqual([
            "observation",
            "capabilityDisabled",
            "permissionMissing",
            "itemBlocked",
            "preconditionStale",
            "humanOrderingUnknown",
            "invalidTimestamp",
            "newerHumanChange",
            "modeDisabled",
            "modeRecordsOnly",
        ]);
    });

    it("every rule has a distinct name — a duplicate would hide a reordering", () => {
        const names = GENERAL_RULES.map(([name]) => name);
        expect(new Set(names).size).toBe(names.length);
    });

    /**
     * The behavioural half: the order in the list is the order that fires.
     * Everything below is wrong at once, and the FIRST rule wins.
     */
    it("the earliest failing rule names the code, matching the list", () => {
        const verdict = evalWrite(
            request(),
            context({
                installationGrants: [],
                world: assertedWorld(["blocked"], false),
                latestHumanChangeAt: "unknown",
            }),
            capabilityOff,
        );
        expect(verdict).toMatchObject({ outcome: "refuse", code: "capabilityDisabled" });
        const names = GENERAL_RULES.map(([n]) => n);
        expect(names.indexOf("capabilityDisabled")).toBeLessThan(
            names.indexOf("permissionMissing"),
        );
    });
});
