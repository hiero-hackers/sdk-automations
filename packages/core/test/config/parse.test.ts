import { DEFAULT_LABEL_MAPPINGS } from "../../src/config/label-defaults.js";
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { duration, flag, section, spec, writeDuration } from "../../src/capability/index.js";
import {
    describeSpec,
    parseConfig,
    NO_CONFIG,
    labelKey,
    MAPPABLE_MEANINGS,
    REPOSITORY_MODES,
} from "../../src/config/index.js";
import { admitting } from "./builders.js";
import { VALUE_REJECTIONS, expectRejection } from "./documents.js";

/**
 * Fixed seed: identical inputs every run, shrinking to minimal
 * counterexamples on failure. The properties claim what the examples below
 * cannot — the parser never throws, and it is a fixed point over its
 * generated input space.
 */
const SEED = 20260725;

/**
 * Headroom for the two heavy properties, applied PER TEST rather than to
 * core's vitest config, so a genuine hang anywhere else still fails fast.
 * They measure 1.5-1.9 s on an idle machine against vitest's 5 s default,
 * and that margin does not survive a full concurrent `pnpm -r test` (D98).
 */
const PROPERTY_TIMEOUT_MS = 30_000;

const camelName = fc.stringMatching(/^[a-z][a-zA-Z0-9]{0,10}$/);

/**
 * A handle or team slug, which is what a principal is. Blank names are not in
 * the space: an empty one renders an `@` that pings nobody, so the parser
 * refuses it with the rest of the file and a generator emitting one would be
 * generating rejections.
 */
const principalHandle = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9/-]{0,20}$/);

/**
 * The spec every generated capability is admitted with, and the block the
 * generator writes against it.
 *
 * Valid BY CONSTRUCTION now covers the settings block too: since C1 a value
 * the spec cannot read rejects the file, so a generator that wrote arbitrary
 * JSON under a declared key would be generating rejections and the property
 * below would be about nothing. One flag and one clock is enough to make the
 * fixed-point property say something — both default, so a block that states
 * neither still resolves to a value, which is what has to be stable.
 *
 * Not every constructor is like that, and the property is honest about its
 * reach rather than widened to claim it: `text({ optional: true })` resolves
 * an absent key to `null`, which is not a value a document may write, so a
 * resolved block is not in general a document. Nothing re-parses one — the
 * shell reads text from GitHub every time — and this test is the only caller
 * that tries.
 */
const GENERATED_SETTINGS = spec({
    announce: flag({ default: false }),
    after: duration({ default: "7d" }),
});

/**
 * One capability's block as a maintainer writes it: consent and the spec's own
 * keys on one level, each optional, because the document is flat.
 */
const capabilityBlock = fc.record(
    {
        enabled: fc.boolean(),
        announce: fc.boolean(),
        after: fc.nat({ max: 90 }).map((n) => `${String(n)}d`),
    },
    { requiredKeys: [] },
);

/** Valid-by-construction config: injective labels, camelCase names. */
const validConfig = fc
    .uniqueArray(fc.constantFrom(...MAPPABLE_MEANINGS), { maxLength: MAPPABLE_MEANINGS.length })
    .chain((meanings) =>
        fc
            /**
             * Unique by the VALIDATOR's judgment, not by exact string: the
             * collision rule folds case (D55), so ["Abc", "abc"] is exact-
             * unique yet labelNotInjective. Generating those would fail a
             * property that is not about them.
             */
            .uniqueArray(fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9: -]{0,20}[a-zA-Z0-9]$/), {
                selector: labelKey,
                minLength: meanings.length,
                maxLength: meanings.length,
            })
            .map((labels) => Object.fromEntries(meanings.map((m, i) => [m, labels[i]]))),
    )
    .chain((labels) =>
        fc.record(
            {
                schemaVersion: fc.constant(2 as const),
                mode: fc.constantFrom(...REPOSITORY_MODES),
                capabilities: fc.dictionary(camelName, capabilityBlock, { maxKeys: 5 }),
                mappings: fc.constant({ labels }),
                principals: fc.dictionary(camelName, principalHandle, { maxKeys: 5 }),
            },
            { requiredKeys: ["schemaVersion"] },
        ),
    );

/**
 * Resolved settings back in the document's own spelling — the one key of
 * `GENERATED_SETTINGS` that a walk cannot copy across unchanged.
 */
const written = (settings: Readonly<Record<string, unknown>>): Record<string, unknown> =>
    Object.fromEntries(
        Object.entries(settings).map(([key, value]) => [
            key,
            describeSpec(GENERATED_SETTINGS)[key]?.kind === "duration"
                ? writeDuration(value as number)
                : value,
        ]),
    );

/** Every generated capability, admitted with the spec its block was written against. */
const admittedIn = (raw: { readonly capabilities?: Readonly<Record<string, unknown>> }) =>
    admitting(Object.keys(raw.capabilities ?? {}), {
        ...Object.fromEntries(
            Object.keys(raw.capabilities ?? {}).map((name) => [name, GENERATED_SETTINGS]),
        ),
    });

describe("parseConfig properties", () => {
    it("never throws and ok ⇔ no errors, for arbitrary values", () => {
        fc.assert(
            fc.property(fc.anything(), (raw) => {
                const result = parseConfig(raw, { revision: "rev-test", knownCapabilities: [] });
                expect(typeof result.ok).toBe("boolean");
                if (!result.ok) expect(result.errors.length).toBeGreaterThan(0);
                else expect("errors" in result).toBe(false);
            }),
            { seed: SEED, numRuns: 500 },
        );
    });

    it(
        "valid-by-construction configs parse ok",
        () => {
            fc.assert(
                fc.property(validConfig, (raw) => {
                    const result = parseConfig(raw, {
                        revision: "rev-test",
                        knownCapabilities: admittedIn(raw),
                    });
                    if (!result.ok) throw new Error(result.errors.map((e) => e.message).join("; "));
                }),
                { seed: SEED, numRuns: 300 },
            );
        },
        PROPERTY_TIMEOUT_MS,
    );

    it(
        "is a fixed point: re-parsing an accepted config yields the identical config",
        () => {
            // Catches silent normalization drift — whatever parseConfig
            // outputs must be exactly what it would output again.
            fc.assert(
                fc.property(validConfig, (raw) => {
                    const knownCapabilities = admittedIn(raw);
                    const first = parseConfig(raw, { revision: "rev-test", knownCapabilities });
                    if (!first.ok) return; // covered by the property above
                    /**
                     * A parsed configuration is not itself a valid document,
                     * in three places. `revision` is metadata ABOUT the
                     * document rather than a key IN it (D77); a resolved
                     * capability is `{ enabled, settings }` where the document
                     * writes those keys beside `enabled`; and a resolved
                     * `duration` is a number of HOURS where the document
                     * writes `14d` (D147's recorded limit, one kind wider).
                     * Undoing all three is what leaves something that can be
                     * parsed a second time.
                     */
                    const { revision: _stamped, ...rest } = first.config;
                    const asDocument = {
                        ...rest,
                        capabilities: Object.fromEntries(
                            Object.entries(rest.capabilities).map(([name, block]) => [
                                name,
                                { enabled: block.enabled, ...written(block.settings) },
                            ]),
                        ),
                    };
                    const second = parseConfig(asDocument as unknown, {
                        revision: "rev-test",
                        knownCapabilities,
                    });
                    expect(second.ok).toBe(true);
                    if (second.ok) expect(second.config).toEqual(first.config);
                }),
                { seed: SEED, numRuns: 300 },
            );
        },
        PROPERTY_TIMEOUT_MS,
    );
});

/**
 * Every way an already-parsed value is wrong, from `documents.ts`. What
 * follows the corpus is only what a row cannot say.
 */
describe("parseConfig rejections (design/contracts/config-schema.md)", () => {
    it.each(VALUE_REJECTIONS.map((r) => [`${r.code}: ${r.why}`, r] as const))(
        "%s",
        (_name, rejection) => {
            expectRejection(
                parseConfig(rejection.raw, {
                    revision: "rev-test",
                    knownCapabilities: rejection.known ?? [],
                }),
                rejection,
            );
        },
    );
});

describe("parseConfig acceptances (design/contracts/config-schema.md)", () => {
    it("no configuration yields the safe default — observe mode, nothing enabled (§2.2)", () => {
        for (const raw of [undefined, null]) {
            const result = parseConfig(raw, { revision: "rev-test", knownCapabilities: [] });
            /**
             * The safe default still carries the revision it was read at
             * (D77). An operator report that cannot say WHEN nothing was
             * found is not evidence of anything.
             */
            expect(result).toEqual({
                ok: true,
                config: { ...NO_CONFIG, revision: "rev-test" },
            });
        }
        // Assert NO_CONFIG's literal shape, not just against itself —
        // a mutation of the constant must fail HERE, not vanish into
        // both sides of the equality above.
        expect(NO_CONFIG.mode).toBe("observe");
        expect(Object.keys(NO_CONFIG.capabilities)).toHaveLength(0);
        expect(Object.keys(NO_CONFIG.principals)).toHaveLength(0);
        expect(NO_CONFIG.mappings).toEqual({
            labels: { ...DEFAULT_LABEL_MAPPINGS },
            commands: {},
            skills: {},
            alerts: {},
        });
        expect(NO_CONFIG.schemaVersion).toBe(2);
    });

    it("accepts the documented candidate shape (§3)", () => {
        const result = parseConfig(
            {
                schemaVersion: 2,
                mode: "observe",
                capabilities: {
                    prDashboard: {
                        enabled: true,
                        checks: { dco: true, mergeConflict: true },
                    },
                    assignment: { enabled: false, maxOpenAssignments: true },
                },
                mappings: {
                    labels: {
                        ready: "status: ready for dev",
                        inProgress: "status: in progress",
                    },
                },
                principals: { maintainerTeam: "hiero-sdk-cpp-maintainers" },
            },
            {
                revision: "rev-test",
                knownCapabilities: admitting(["prDashboard", "assignment"], {
                    prDashboard: spec({
                        checks: section({
                            dco: flag({ default: false }),
                            mergeConflict: flag({ default: false }),
                        }),
                    }),
                    assignment: spec({ maxOpenAssignments: flag({ default: false }) }),
                }),
            },
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.config.capabilities.prDashboard?.enabled).toBe(true);
            expect(result.config.capabilities.assignment?.enabled).toBe(false);
            expect(result.config.mappings.labels.ready).toBe("status: ready for dev");
        }
    });

    it("refuses the retired settings wrapper by name, as an unknown setting", () => {
        const result = parseConfig(
            {
                capabilities: {
                    triageQueue: { enabled: true, settings: { announce: true } },
                },
            },
            {
                revision: "rev-test",
                knownCapabilities: admitting(["triageQueue"], {
                    triageQueue: spec({ announce: flag({ default: false }) }),
                }),
            },
        );
        expect(result.ok ? [] : result.errors.map((e) => `${e.code} @ ${e.path}`)).toEqual([
            "unknownKey @ capabilities.triageQueue.settings",
        ]);
    });

    /**
     * §2.4's other half. The corpus holds the three truthy values that are
     * NOT consent; this holds the one shape that is silence.
     */
    it("an omitted enabled leaves the capability off, not on", () => {
        const result = parseConfig(
            { schemaVersion: 2, capabilities: { triageQueue: {} } },
            { revision: "rev-test", knownCapabilities: admitting(["triageQueue"]) },
        );
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.config.capabilities.triageQueue?.enabled).toBe(false);
    });

    /**
     * The other side of D55: the fold decides COLLISION only. Distinct labels
     * keep the maintainer's exact spelling, which is what the App writes to
     * GitHub.
     */
    it("genuinely distinct labels still pass, with their spelling preserved", () => {
        const result = parseConfig(
            {
                schemaVersion: 2,
                mappings: {
                    labels: { ready: "Status: Ready", needsReview: "status: needs review" },
                },
            },
            { revision: "rev-test", knownCapabilities: [] },
        );
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.config.mappings.labels.ready).toBe("Status: Ready");
    });

    /**
     * The other half of D84's rule, and the one the corpus cannot hold: a
     * DISABLED capability demands nothing. Rejecting this file would make
     * `enabled: false` harder to write than deleting the block, which is the
     * opposite of what a blast-radius lever should cost.
     */
    it("a disabled capability requires none of its meanings", () => {
        const result = parseConfig(
            { schemaVersion: 2, capabilities: { triageQueue: { enabled: false } } },
            {
                revision: "rev-test",
                knownCapabilities: [
                    {
                        name: "triageQueue",
                        settings: spec({ announce: flag({ default: false }) }),
                        requiredMappings: { labels: ["awaitingTriage"] },
                    },
                ],
            },
        );
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.config.capabilities.triageQueue?.enabled).toBe(false);
    });

    /**
     * What replaces "names here, values there" (C1): the block is stored as
     * the spec RESOLVED it, defaults materialised, so nobody downstream reads
     * a raw document again. The corpus holds the rejections; this is the
     * accepting half, and the claim a rejection row cannot make.
     */
    it("stores a settings block as the spec resolved it, defaults and all", () => {
        const result = parseConfig(
            {
                schemaVersion: 2,
                capabilities: {
                    triageQueue: { enabled: false },
                    triage: { enabled: false },
                },
            },
            {
                revision: "rev-test",
                knownCapabilities: admitting(["triageQueue", "triage"], {
                    triageQueue: spec({
                        announce: flag({ default: true }),
                        after: duration({ default: "7d" }),
                    }),
                }),
            },
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.config.capabilities.triageQueue?.settings).toEqual({
            announce: true,
            after: 7 * 24,
        });
        // A capability admitted with the empty spec resolves to the empty
        // block, which is the written answer for one that takes no setting.
        expect(result.config.capabilities.triage?.settings).toEqual({});
    });

    /**
     * An absent version is the current format, so nothing at all is a complete
     * document. A future format has to state its own number to be read as one.
     * The corpus holds the present-but-null half.
     */
    it("an absent schemaVersion is the current format, and an empty mapping is a whole document", () => {
        for (const raw of [{ mode: "observe" }, {}]) {
            const result = parseConfig(raw, { revision: "rev-test", knownCapabilities: [] });
            expect(result.ok).toBe(true);
            if (result.ok) expect(result.config.schemaVersion).toBe(2);
        }
    });

    // D56 — an absent key defaults; the corpus holds the present-but-empty
    // half, which is an error rather than a default.
    it("an absent mode defaults to observe", () => {
        const result = parseConfig(
            { schemaVersion: 2 },
            { revision: "rev-test", knownCapabilities: [] },
        );
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.config.mode).toBe("observe");
    });
});

describe("NO_CONFIG is inert all the way down", () => {
    it("carries the empty revision — the parser stamps the real one", () => {
        // `parseConfig` overwrites `revision` from its options, so this
        // literal is only visible to code using NO_CONFIG directly — and ""
        // is the sentinel telling it apart from a parsed configuration.
        expect(NO_CONFIG.revision).toBe("");
    });
});
