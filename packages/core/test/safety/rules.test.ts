/**
 * The rule list itself — `GENERAL_RULES`, the one thing `rules.ts` exports,
 * because order is contract (D39, D52). Three claims the doors cannot make
 * for it: the order is pinned as a literal, no two rules share a name, and
 * every rule answers the value an earlier rule normally intercepts without
 * throwing. A single write through `evaluateWrite` closes the loop — the
 * order in the list is the order that fires.
 */

import { describe, it, expect } from "vitest";
import { GENERAL_RULES } from "../../src/safety/index.js";
import { assertedWorld } from "../../src/safety/world.js";
import { capabilityOff, config, context, evalWrite, request } from "./builders.js";

describe("the check order is contract, and now assertable directly", () => {
    /**
     * Verdict codes are contract (D39), so precedence between rules is too: an
     * operator who has pulled the emergency brake must be told about the kill
     * switch, not about whatever else also refuses (D52). Precedence as a LIST
     * can be pinned outright, which is the entire reason for the shape — a
     * sequence of `if`s can only be tested by tripping several rules at once
     * and seeing which wins.
     */
    it("pins the general-rule order", () => {
        expect(GENERAL_RULES.map(([name]) => name)).toEqual([
            "observation",
            "capabilityDisabled",
            "permissionMissing",
            "itemClosed",
            "itemBlocked",
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
     * The cost of making order DATA: the list is editable, so a rule that only
     * survives its input because an earlier rule intercepted the hard case is
     * a landmine waiting for the next reordering. Two rules read
     * `latestHumanChangeAt` after `humanOrderingUnknown` has removed the one
     * value with no `getTime()`, and their own guards against it are
     * unreachable through `evaluateGeneralRulesAfterPreflight` — so a test
     * entering by the front door cannot see them at all.
     *
     * Every rule is therefore handed that value directly and must ANSWER: a
     * verdict or `null`, never a throw. The property is per-rule independence,
     * which is what the list shape claims and what a reordering relies on.
     */
    it.each(GENERAL_RULES.map(([name, rule]) => [name, rule] as const))(
        "%s answers unestablished ordering on its own, without the rule above it",
        (_name, rule) => {
            const write = request();
            const facts = {
                request: write,
                actionClass: write.actionClass,
                config: config(),
                context: context({ latestHumanChangeAt: "unknown" }),
                capabilityEnabled: true,
                missing: [] as readonly string[],
            };
            expect(() => rule(facts)).not.toThrow();
            const verdict = rule(facts);
            if (verdict !== null && verdict.outcome !== "apply") {
                expect(verdict.reason.length).toBeGreaterThan(0);
            }
        },
    );

    /**
     * The behavioural half: the order in the list is the order that fires.
     * Everything below is wrong at once, and the FIRST rule wins.
     */
    it("the earliest failing rule names the code, matching the list", () => {
        const verdict = evalWrite(
            request(),
            context({
                installationGrants: [],
                world: assertedWorld(["blocked"], true),
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
