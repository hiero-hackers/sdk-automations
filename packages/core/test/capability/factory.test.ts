/**
 * The factory's contracts (D92 3d): what it stamps, what it defaults, and
 * that its output is indistinguishable from a hand-built intent everywhere
 * it matters — the screens and the idempotency key.
 */

import { describe, expect, it } from "vitest";
import {
    declareCapability,
    spec,
    deriveIdempotencyKey,
    intentFactory,
    intentFactoryFor,
    screenIntent,
} from "../../src/index.js";

const occasion = {
    repository: { owner: "o", repo: "r" },
    item: { kind: "issue", number: 7 },
    observedAt: new Date("2026-08-07T01:00:00Z"),
} as const;

const declaration = declareCapability({
    name: "triage",
    triggers: [{ kind: "event", event: "issues" }],
    settings: spec({}),
    requiredMappings: {},
    facts: ["issue"],
    needs: [],
    resolvers: [],
    intents: ["applyMappedLabel"],
});

const make = intentFactory("triage", occasion);

const label = () =>
    make({
        operation: "applyMappedLabel",
        desired: { meaning: "awaitingTriage", cause: "intakeObserved" },
        cause: "issueWithoutPosition",
        explain: { summary: "New issue placed in triage." },
    });

describe("what the factory stamps", () => {
    it("binds the occasion and attributes the explanation", () => {
        const intent = label();
        expect(intent.capability).toBe("triage");
        expect(intent.repository).toEqual(occasion.repository);
        expect(intent.item).toEqual(occasion.item);
        expect(intent.cause).toEqual({
            cause: "issueWithoutPosition",
            observedAt: occasion.observedAt,
        });
        expect(intent.explanation).toEqual({
            capability: "triage",
            summary: "New issue placed in triage.",
            detail: [],
        });
    });

    it("derives the same key the hand path derives", () => {
        const intent = label();
        expect(intent.idempotencyKey).toBe(deriveIdempotencyKey(intent));
    });

    it("binds the webhook delivery to the effect occasion", () => {
        const first = intentFactory("triage", { ...occasion, deliveryId: "first" });
        const second = intentFactory("triage", { ...occasion, deliveryId: "second" });
        const spec = {
            operation: "applyMappedLabel" as const,
            desired: { meaning: "awaitingTriage" as const, cause: "intakeObserved" as const },
            cause: "issueWithoutPosition",
            explain: { summary: "New issue placed in triage." },
        };
        expect(first(spec).idempotencyKey).not.toBe(second(spec).idempotencyKey);
        expect(first(spec).idempotencyKey).toBe(first(spec).idempotencyKey);
    });

    it("the key identifies the occasion, not the payload — a reworded comment is one effect", () => {
        const a = make({
            operation: "postManagedComment",
            desired: { kind: "summary", body: "first wording" },
            cause: "prWithoutLinkedIssue",
            explain: { summary: "s" },
        });
        const b = make({
            operation: "postManagedComment",
            desired: { kind: "summary", body: "second wording" },
            cause: "prWithoutLinkedIssue",
            explain: { summary: "s" },
        });
        expect(a.idempotencyKey).toBe(b.idempotencyKey);
    });
});

describe("what the factory defaults", () => {
    it("omitted `claims` claims NOTHING — closed is no-claim, not open", () => {
        expect(label().claims).toEqual({
            meaningsPresent: [],
            meaningsAbsent: [],
            closed: null,
        });
    });

    it("a partial `claims` fills only the stated clause", () => {
        const intent = make({
            operation: "applyMappedLabel",
            desired: { meaning: "awaitingTriage", cause: "intakeObserved" },
            cause: "c",
            claims: { meaningsAbsent: ["awaitingTriage"], closed: false },
            explain: { summary: "s" },
        });
        expect(intent.claims).toEqual({
            meaningsPresent: [],
            meaningsAbsent: ["awaitingTriage"],
            closed: false,
        });
    });

    /**
     * The byte-compatibility half of the mode claim: a capability that claims
     * no mode produces an intent with NO such key, which is what every intent
     * written before the mode was claimable looks like — so a record from then
     * and one from now are the same object, not two.
     */
    it("writes the mode claim in only when one is made", () => {
        expect("pullRequestMode" in label().claims).toBe(false);
        const claimed = make({
            operation: "applyMappedLabel",
            desired: { meaning: "awaitingTriage", cause: "intakeObserved" },
            cause: "c",
            claims: { closed: false, pullRequestMode: "draft" },
            explain: { summary: "s" },
        });
        expect(claimed.claims).toEqual({
            meaningsPresent: [],
            meaningsAbsent: [],
            closed: false,
            pullRequestMode: "draft",
        });
    });

    it("does not mint capability-authored safety authority", () => {
        expect("actionClass" in label()).toBe(false);
        expect("destructive" in label()).toBe(false);
    });
});

/**
 * The declaration-aware factory is the one capabilities are told to use, and
 * until now only `slice.test.ts` ever called it — a composition test, which
 * cannot say what this function alone owes. What it owes is two things: an
 * intent that is byte-for-byte the untyped factory's, and the attribution
 * taken from the DECLARATION rather than from a string the caller retypes.
 */
describe("intentFactoryFor — the declaration supplies the name", () => {
    const spec = {
        operation: "applyMappedLabel",
        desired: { meaning: "awaitingTriage", cause: "intakeObserved" },
        cause: "issueWithoutPosition",
        explain: { summary: "New issue placed in triage." },
    } as const;

    it("attributes the intent to the declaration, not to a restated name", () => {
        const intent = intentFactoryFor(declaration, occasion)(spec);
        expect(intent.capability).toBe(declaration.name);
        expect(intent.explanation.capability).toBe(declaration.name);
    });

    it("produces exactly what the untyped factory produces — it adds types, not behaviour", () => {
        expect(intentFactoryFor(declaration, occasion)(spec)).toEqual(make(spec));
    });
});

describe("factory output is screen-clean", () => {
    it("a factory-made intent passes the screens a hand-built one passes", () => {
        expect(
            screenIntent(label(), declaration, {
                kind: "position",
                state: { meaning: null, blocked: false, closedBy: null },
                ignored: [],
            }),
        ).toEqual({ ok: true });
    });
});
