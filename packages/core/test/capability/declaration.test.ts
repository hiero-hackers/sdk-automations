import { describe, expect, it } from "vitest";
import {
    declareCapability,
    flag,
    spec,
    text,
    validateCapabilityDeclarations,
    type CapabilityDeclaration,
    type DeclaredTrigger,
} from "../../src/capability/index.js";

const declaration: CapabilityDeclaration = {
    name: "prDashboard",
    triggers: [{ kind: "event", event: "pull_request" }],
    settings: spec({ checks: flag({ default: false }) }),
    requiredMappings: { labels: ["needsReview"] },
    labels: ["needsReview"],
    facts: ["pullRequest"],
    /**
     * Empty, and it is the study's finding that it has to be: the webhook
     * producer of `pull_request` reads no `review`, so needing it here is the
     * declaration the boot check exists to refuse — asserted below.
     */
    needs: {},
    resolvers: ["linkedIssues"],
    intents: ["postManagedComment", "applyMappedLabel"],
};

describe("validateCapabilityDeclarations", () => {
    it("accepts a valid direct declaration set", () => {
        expect(validateCapabilityDeclarations([declaration])).toEqual([]);
    });

    it("rejects duplicate declaration names with the boot-boundary error", () => {
        expect(validateCapabilityDeclarations([declaration, declaration])).toContain(
            'duplicate capability name "prDashboard"',
        );
    });

    it("rejects a position two capabilities may set", () => {
        expect(
            validateCapabilityDeclarations([declaration, { ...declaration, name: "other" }]),
        ).toContain('label meaning "needsReview" is set by more than one capability');
    });

    it("does not count one capability naming a position twice as two writers", () => {
        const twice = { ...declaration, labels: ["needsReview", "needsReview"] };
        expect(validateCapabilityDeclarations([twice]).join("\n")).not.toContain(
            "more than one capability",
        );
    });

    it("returns every structural, duplicate-entry, and catalogue-name error", () => {
        const errors = validateCapabilityDeclarations([
            {
                ...declaration,
                name: "PR-Quality",
                triggers: [],
                requiredMappings: { labels: ["almostReady", "almostReady"] },
                facts: ["unknownKind", "unknownKind"],
                needs: { pullRequest: ["unknownGroup", "unknownGroup"] },
                resolvers: ["unknownResolver", "unknownResolver"],
                intents: ["unknownOperation", "unknownOperation"],
            },
            {
                ...declaration,
                name: "scheduled",
                triggers: [{ kind: "schedule", description: "daily" }],
                facts: [],
            },
        ]);

        expect(errors.join("\n")).toContain("camelCase configuration key");
        expect(errors.join("\n")).toContain("at least one trigger");
        // Every error names the declaration it came from. With two bad
        // declarations in one list, an unattributed error tells a maintainer
        // that SOMETHING is wrong and not which capability to open.
        expect(errors.join("\n")).toContain('capability "PR-Quality": at least one trigger');
        expect(errors.join("\n")).toContain(
            'capability "PR-Quality": fact kind "unknownKind" is not in the fact catalogue',
        );
        /**
         * Attribution is also what makes the kinds check a check: `scheduled`
         * names none and must be the one accused; `PR-Quality` names two.
         */
        expect(errors.join("\n")).toContain('capability "scheduled": names no fact kind');
        expect(errors.join("\n")).not.toContain('capability "PR-Quality": names no fact kind');
        expect(errors.join("\n")).toContain(
            'duplicate requiredMappings.labels entry "almostReady"',
        );
        /**
         * D84 — a meaning no repository may map is a requirement no repository
         * can satisfy, so the catalogue check covers `requiredMappings` the
         * way it already covered facts, resolvers, and intents. Each family
         * has its own closed set, so the error names the family it judged in.
         */
        expect(errors.join("\n")).toContain(
            'capability "PR-Quality": required meaning "almostReady" is not in the labels family',
        );
        expect(errors.join("\n")).toContain('duplicate facts entry "unknownKind"');
        expect(errors.join("\n")).toContain('duplicate needs.pullRequest entry "unknownGroup"');
        expect(errors.join("\n")).toContain('duplicate resolvers entry "unknownResolver"');
        expect(errors.join("\n")).toContain('duplicate intents entry "unknownOperation"');
        expect(errors.join("\n")).toContain(
            'fact group "unknownGroup" is not in the fact catalogue',
        );
        expect(errors.join("\n")).toContain('resolver "unknownResolver"');
        expect(errors.join("\n")).toContain('intent "unknownOperation"');
        expect(errors.join("\n")).toContain("a schedule trigger must state `facts`");
    });

    /**
     * A capability block is flat, so `enabled` is consent at the top of it and
     * a spec declaring it as a setting owns a key the parser never hands it.
     * Refused at boot; the second case is the control, since the check must
     * read the spec's own keys and not the block's.
     */
    it("refuses a spec that declares the reserved key", () => {
        expect(
            validateCapabilityDeclarations([
                { ...declaration, settings: spec({ enabled: flag({ default: false }) }) },
            ]),
        ).toEqual([
            'capability "prDashboard": settings may not declare "enabled" — the capability\'s own block reads it as consent, and its other keys are the settings',
        ]);
        expect(validateCapabilityDeclarations([declaration])).toEqual([]);
    });

    /**
     * `mode` sits beside `enabled` on the block, so a spec declaring it is
     * refused the same way. The near name is the control: the check reads the
     * spec's exact keys, and a setting merely about modes is the capability's.
     */
    it("refuses a spec that declares mode, and only that key", () => {
        expect(
            validateCapabilityDeclarations([
                { ...declaration, settings: spec({ mode: text({ optional: true }) }) },
            ]),
        ).toEqual([
            'capability "prDashboard": settings may not declare "mode" — the capability\'s own block reads it as the mode it runs in, bounded by the file\'s, and its other keys are the settings',
        ]);
        expect(
            validateCapabilityDeclarations([
                { ...declaration, settings: spec({ modes: text({ optional: true }) }) },
            ]),
        ).toEqual([]);
    });

    /**
     * facts.md §3: `review` is the pull request's alone, so an issue-only
     * declaration needing it names a group no record it receives could hold.
     * Refused once at boot, rather than skipped in silence on every record.
     */
    it("refuses a need no declared kind carries", () => {
        expect(
            validateCapabilityDeclarations([
                { ...declaration, facts: ["issue"], needs: { issue: ["review"] } },
            ]),
        ).toEqual(['capability "prDashboard": the issue record carries no group "review"']);
    });

    /** D214: a need on a kind the capability never receives is refused, not ignored. */
    it("refuses a need on a kind it does not declare", () => {
        expect(
            validateCapabilityDeclarations([{ ...declaration, needs: { issue: ["assignees"] } }]),
        ).toEqual([
            'capability "prDashboard": needs groups on issue records, a kind it does not declare',
        ]);
    });

    /**
     * The defect this check was built for, as the declaration that found it:
     * prDashboard's own design page asked for `needs: ["review"]` on a
     * `pull_request` trigger, and the platform answered by skipping the
     * capability `factsUnread` on every delivery, silently, forever.
     *
     * The message has to name all three things a maintainer needs — which
     * trigger, which group, and who does read it — because the fix is always
     * one of two moves: change the trigger, or drop the need.
     */
    it("refuses a need the producer its trigger names never reads", () => {
        expect(
            validateCapabilityDeclarations([
                { ...declaration, needs: { pullRequest: ["review"] } },
            ]),
        ).toEqual([
            'capability "prDashboard": the "pull_request" trigger leaves "review" unread on a pullRequest record, so every delivery it wakes is skipped — read by: sweep',
        ]);
    });

    /**
     * The same need on the trigger that does read it is the positive half, and
     * it is inactivity's shape: both kinds declared, `review` needed on the
     * pull request, which is the only kind that can hold it.
     */
    it("admits the same need on a schedule trigger, which the sweep answers", () => {
        expect(
            validateCapabilityDeclarations([
                {
                    ...declaration,
                    triggers: [{ kind: "schedule", description: "daily" }],
                    facts: ["issue", "pullRequest"],
                    needs: { pullRequest: ["review"] },
                },
            ]),
        ).toEqual([]);
    });

    /** An event IS a producer: one nobody wakes on does not compile, so no boot check judges it. */
    it("names its events out of the producer registry", () => {
        // @ts-expect-error — `pull_request_review` is an event no producer wakes on.
        const trigger: DeclaredTrigger = { kind: "event", event: "pull_request_review" };
        expect(trigger.kind).toBe("event");
    });

    /** D204: a capability that may set a position names which, and the reverse. */
    it("holds `labels` and the applyMappedLabel intent together", () => {
        expect(validateCapabilityDeclarations([{ ...declaration, labels: [] }])).toEqual([
            'capability "prDashboard": may set a position but names no label meaning in `labels`',
        ]);
        expect(
            validateCapabilityDeclarations([{ ...declaration, intents: ["postManagedComment"] }]),
        ).toEqual([
            'capability "prDashboard": names label meanings but never declares the applyMappedLabel intent',
        ]);
        expect(
            validateCapabilityDeclarations([
                { ...declaration, labels: ["needsReview", "needsReview", "nonsense"] },
            ]),
        ).toEqual([
            'capability "prDashboard": duplicate labels entry "needsReview"',
            'capability "prDashboard": label meaning "nonsense" is not in the labels family',
        ]);
    });

    it("keeps operation facts out of the declaration shape", () => {
        expect(declaration.intents).toEqual(["postManagedComment", "applyMappedLabel"]);
        expect(Object.keys(declaration).sort()).toEqual([
            "facts",
            "intents",
            "labels",
            "name",
            "needs",
            "requiredMappings",
            "resolvers",
            "settings",
            "triggers",
        ]);
    });
});

/** D214: `needs` is filled per kind, whichever form the author wrote. */
describe("declareCapability fills needs per kind", () => {
    const both = {
        name: "both",
        triggers: [{ kind: "schedule", description: "hourly" }],
        settings: spec({}),
        facts: ["issue", "pullRequest"],
        resolvers: [],
        intents: [],
    } as const;

    it("reaches every declared kind that carries a listed group, and no other", () => {
        expect(declareCapability({ ...both, needs: ["assignees", "review"] }).needs).toEqual({
            issue: ["assignees"],
            pullRequest: ["assignees", "review"],
        });
    });

    it("keeps a per-kind list as written, and empties the kinds it leaves out", () => {
        expect(declareCapability({ ...both, needs: { pullRequest: ["review"] } }).needs).toEqual({
            issue: [],
            pullRequest: ["review"],
        });
    });

    it("keeps a listed group no declared kind carries, so boot names it", () => {
        const issueOnly = declareCapability({ ...both, facts: ["issue"], needs: ["review"] });
        expect(issueOnly.needs).toEqual({ issue: ["review"], pullRequest: [] });
        expect(validateCapabilityDeclarations([issueOnly])).toEqual([
            'capability "both": the issue record carries no group "review"',
        ]);
    });

    it("refuses at compile time a per-kind group the kind cannot hold", () => {
        // @ts-expect-error — an issue record carries no `review`.
        const wrong = declareCapability({ ...both, needs: { issue: ["review"] } });
        expect(validateCapabilityDeclarations([wrong])).toHaveLength(1);
    });
});
