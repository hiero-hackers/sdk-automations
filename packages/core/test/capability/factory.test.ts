/**
 * The factory's contracts (D92 3d): what it stamps, what it defaults, and
 * that its output is indistinguishable from a hand-built intent everywhere
 * it matters — the screens and the idempotency key.
 */

import { describe, expect, it } from "vitest";
import {
    declareCapability,
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
    configKeys: [],
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
    it("an omitted expected claims NOTHING — closed is no-claim, not open", () => {
        expect(label().expected).toEqual({
            meaningsPresent: [],
            meaningsAbsent: [],
            closed: null,
        });
    });

    it("a partial expected fills only the stated clause", () => {
        const intent = make({
            operation: "applyMappedLabel",
            desired: { meaning: "awaitingTriage", cause: "intakeObserved" },
            cause: "c",
            expected: { meaningsAbsent: ["awaitingTriage"], closed: false },
            explain: { summary: "s" },
        });
        expect(intent.expected).toEqual({
            meaningsPresent: [],
            meaningsAbsent: ["awaitingTriage"],
            closed: false,
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
