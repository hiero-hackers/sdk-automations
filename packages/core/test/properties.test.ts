/**
 * Property-based tests (fast-check): randomized structured inputs with
 * fixed seeds — deterministic runs, shrinking to minimal
 * counterexamples on failure. These state PROPERTIES the example
 * suites cannot: fixed points, totality, and classification closure
 * over generated input spaces.
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
    parseConfig,
    labelKey,
    classifyFailure,
    asDeliveryRecordId,
    MAPPABLE_MEANINGS,
    REPOSITORY_MODES,
} from "../src/index.js";

const SEED = 20260725;

/**
 * Headroom for the two heavy properties, applied PER TEST rather than to
 * core's vitest config, so a genuine hang anywhere else still fails fast.
 *
 * These two run 300 generated cases each and measure 1.5-1.9 s on an idle
 * machine — a 3x margin under vitest's 5 s default. `pnpm -r test` runs
 * six packages concurrently over core's own parallel workers, and a 3x
 * slowdown there is ordinary, which is the best explanation of the
 * intermittent failures this file produced across 2026-08-07/08: the seed
 * is FIXED, so the inputs are identical on every run and an
 * input-dependent counterexample is impossible, while a timeout is
 * load-dependent by nature. The earlier "seed-dependent flake" reading
 * was wrong for exactly that reason (D98).
 */
const PROPERTY_TIMEOUT_MS = 30_000;

// ── Generators ─────────────────────────────────────────────────────

const camelName = fc.stringMatching(/^[a-z][a-zA-Z0-9]{0,10}$/);

/** Valid-by-construction config: injective labels, camelCase names. */
const validConfig = fc
    .uniqueArray(fc.constantFrom(...MAPPABLE_MEANINGS), { maxLength: MAPPABLE_MEANINGS.length })
    .chain((meanings) =>
        fc
            /**
             * Unique by the VALIDATOR's judgment, not by exact string: the
             * collision rule folds case (D55), so ["Abc", "abc"] is exact-
             * unique yet labelNotInjective — a real collision class the
             * exact-string uniqueness permitted. Same fold, same function,
             * third consumer. (The intermittent failures once blamed on
             * this generator were a timeout, not a counterexample — D98.)
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
                schemaVersion: fc.constant(1 as const),
                mode: fc.constantFrom(...REPOSITORY_MODES),
                capabilities: fc.dictionary(
                    camelName,
                    fc.record(
                        {
                            enabled: fc.boolean(),
                            settings: fc.dictionary(camelName, fc.jsonValue()),
                        },
                        { requiredKeys: [] },
                    ),
                    { maxKeys: 5 },
                ),
                mappings: fc.constant({ labels }),
                principals: fc.dictionary(camelName, fc.string(), { maxKeys: 5 }),
            },
            { requiredKeys: ["schemaVersion"] },
        ),
    );

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
                        knownCapabilities: Object.keys(raw.capabilities ?? {}),
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
                    const knownCapabilities = Object.keys(raw.capabilities ?? {});
                    const first = parseConfig(raw, { revision: "rev-test", knownCapabilities });
                    if (!first.ok) return; // covered by the property above
                    /**
                     * `revision` is metadata ABOUT the document, not a key IN
                     * it (D77), so a parsed configuration is no longer a valid
                     * document — it carries a field a maintainer never writes.
                     * Stripping it keeps the property meaningful: what parsing
                     * produces, minus the identity stamped on it, must parse
                     * back to the same thing.
                     */
                    const { revision: _stamped, ...asDocument } = first.config;
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

describe("classifyFailure properties", () => {
    const observation = fc.record(
        {
            status: fc.integer({ min: 100, max: 599 }),
            body: fc.string({ maxLength: 500 }),
            headers: fc.dictionary(fc.stringMatching(/^[a-z][a-z-]{0,25}$/), fc.string(), {
                maxKeys: 6,
            }),
            tokenPastExpiry: fc.boolean(),
        },
        { requiredKeys: ["status", "body", "headers"] },
    );

    it("is total, and every 403 lands in a documented 403 class with evidence", () => {
        const FORBIDDEN_KINDS = new Set([
            "secondaryLimit",
            "primaryExhausted",
            "rateLimitResponseUnusable",
            "permissionMissing",
            "installationSuspended",
            "forbiddenUnrecognized",
        ]);
        fc.assert(
            fc.property(observation, (o) => {
                const failure = classifyFailure(o); // must not throw
                if (o.status === 403) {
                    expect(FORBIDDEN_KINDS.has(failure.kind)).toBe(true);
                    if (failure.kind === "forbiddenUnrecognized") {
                        // Ignorance always carries bounded evidence.
                        expect(failure.bodySnippet).toBe(o.body.slice(0, 200));
                    }
                }
                if (o.status === 401) {
                    expect(failure.kind).toBe(
                        o.tokenPastExpiry === true ? "tokenExpired" : "badCredentials",
                    );
                }
            }),
            { seed: SEED, numRuns: 500 },
        );
    });
});

describe("asDeliveryRecordId properties", () => {
    it("accepts exactly digit strings, and accepted values round-trip unchanged", () => {
        fc.assert(
            fc.property(fc.string({ maxLength: 40 }), (s) => {
                const id = asDeliveryRecordId(s);
                expect(id !== undefined).toBe(/^\d+$/.test(s));
                if (id !== undefined) expect(id).toBe(s); // opaque: never normalized
            }),
            { seed: SEED, numRuns: 500 },
        );
        // And digit strings beyond 2^53 — the whole point — are preserved.
        fc.assert(
            fc.property(fc.stringMatching(/^[1-9]\d{18,24}$/), (s) => {
                expect(asDeliveryRecordId(s)).toBe(s);
            }),
            { seed: SEED, numRuns: 200 },
        );
    });
});
