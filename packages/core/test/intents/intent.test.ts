/**
 * What an intent carries and what its identity is derived from: the operation
 * facts the platform owns, and the key the store reads as an `effect_id`.
 */

import { describe, expect, it } from "vitest";
import {
    deriveIdempotencyKey,
    idempotencyOf,
    INTENT_OPERATIONS,
    OPERATIONS,
} from "../../src/intents/index.js";

const AT = new Date("2026-08-05T09:00:00.000Z");

describe("the operation catalogue owns platform facts", () => {
    /** Operation-owned facts cannot be restated by a capability. */
    it("pins the idempotency class of every operation", () => {
        expect(idempotencyOf("postManagedComment")).toBe("nonIdempotent");
        expect(idempotencyOf("applyMappedLabel")).toBe("idempotent");
        expect(idempotencyOf("unassign")).toBe("idempotent");
        expect(idempotencyOf("releaseAssignment")).toBe("idempotent");
        expect(idempotencyOf("closePullRequest")).toBe("idempotent");
    });

    it("pins the action-class floor and required permission of every operation", () => {
        expect(INTENT_OPERATIONS.postManagedComment).toEqual({
            idempotencyClass: "nonIdempotent",
            actionClassFloor: "humanFacingOutput",
            permission: "issues:write",
        });
        for (const op of ["applyMappedLabel", "unassign"] as const) {
            expect(INTENT_OPERATIONS[op]).toEqual({
                idempotencyClass: "idempotent",
                actionClassFloor: "reversibleStateChange",
                permission: "issues:write",
            });
        }
        /**
         * The clock's two, and the whole of D63's split: `releaseAssignment`
         * takes the same person off the same list as `unassign` and is a
         * different action class, so only one of them can reach GitHub without
         * a warning behind it.
         */
        expect(INTENT_OPERATIONS.releaseAssignment).toEqual({
            idempotencyClass: "idempotent",
            actionClassFloor: "clockTriggeredDestructive",
            permission: "issues:write",
        });
        expect(INTENT_OPERATIONS.closePullRequest).toEqual({
            idempotencyClass: "idempotent",
            actionClassFloor: "clockTriggeredDestructive",
            permission: "pull_requests:write",
        });
    });

    /** A row missing from the derived table is silent at every consumer. */
    it("reads every registered operation's facts off that operation's module", () => {
        const operations = Object.keys(OPERATIONS) as Array<keyof typeof OPERATIONS>;

        expect(operations.map((operation) => INTENT_OPERATIONS[operation])).toEqual(
            operations.map((operation) => OPERATIONS[operation].facts),
        );
    });
});

describe("deriveIdempotencyKey", () => {
    const base = {
        capability: "fixture",
        repository: { owner: "o", repo: "r" },
        item: { kind: "issue", number: 1 },
        operation: "applyMappedLabel",
        cause: { cause: "someCause", observedAt: AT },
    } as const;

    it("is stable across independent derivations of the same occasion", () => {
        expect(deriveIdempotencyKey(base)).toBe(deriveIdempotencyKey(base));
    });

    it("distinguishes events in the same second but keeps redelivery stable", () => {
        const first = { ...base, cause: { ...base.cause, deliveryId: "first" } };
        const second = { ...base, cause: { ...base.cause, deliveryId: "second" } };
        expect(deriveIdempotencyKey(first)).not.toBe(deriveIdempotencyKey(second));
        expect(deriveIdempotencyKey(first)).toBe(deriveIdempotencyKey(first));
    });

    it("distinguishes every identifying field", () => {
        const variants = [
            { ...base, capability: "other" },
            { ...base, repository: { owner: "o2", repo: "r" } },
            { ...base, repository: { owner: "o", repo: "r2" } },
            { ...base, item: { kind: "pullRequest", number: 1 } as const },
            { ...base, item: { kind: "issue", number: 2 } as const },
            { ...base, cause: { cause: "otherCause", observedAt: AT } },
            { ...base, cause: { cause: "someCause", observedAt: new Date(AT.getTime() + 1) } },
        ];
        const keys = new Set(variants.map(deriveIdempotencyKey));
        expect(keys.size).toBe(variants.length);
        expect(keys.has(deriveIdempotencyKey(base))).toBe(false);
    });

    /**
     * FINDING(runtime-idempotency-key-underived): the encoding must not let
     * a field boundary move. A delimiter join makes capability "a b" with
     * repo "c" collide with capability "a" and repo "b c"; two distinct
     * effects become one and the store cannot tell.
     */
    it("does not let a field boundary shift between fields", () => {
        const a = deriveIdempotencyKey({
            ...base,
            capability: "a b",
            repository: { owner: "c", repo: "r" },
        });
        const b = deriveIdempotencyKey({
            ...base,
            capability: "a",
            repository: { owner: "b c", repo: "r" },
        });
        expect(a).not.toBe(b);
    });

    it("produces a key with no control characters", () => {
        // A NUL-delimited key made the whole source file read as binary to
        // grep and diff; the encoding stays printable on purpose.
        expect(deriveIdempotencyKey(base)).not.toMatch(/[\u0000-\u001f]/);
    });
});
