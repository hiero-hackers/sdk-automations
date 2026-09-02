# capability/ — the boundary a capability lives behind

Six files, six questions, one rule: a capability is ordinary code the platform must not trust.
Everything here exists to make that lack of trust structural rather than hopeful.

Read them in this order — it is also the import direction. `catalogue.ts` imports nothing from this
directory and everything else eventually reaches it, so a new import *into* the catalogue is the
signal that something has been put in the wrong file.

| File | The question it answers | The one thing to know |
|---|---|---|
| [`catalogue.ts`](catalogue.ts) | **What may be said.** The closed vocabularies — observations a capability can receive, resolvers it can ask, intents it can express — plus the facts the *platform* owns about each operation (idempotency, action-class floor, permission). | Closed on purpose (D61): a capability chooses from these and cannot extend them, which is where P3 isolation comes from — capabilities that share no vocabulary have nothing to call each other through. |
| [`managed.ts`](managed.ts) | **Which comment is ours?** The marker one effect publishes, the parser that reads an arbitrary comment body back, and the judgement that answers whether a comment is a given effect's. | Identity is platform-owned (D125). A capability supplies a `kind` and body content and can write no marker; the judgement takes authorship as a parameter, so a marker copied into a repository user's comment is refused before its bytes are read. |
| [`declaration.ts`](declaration.ts) | **Who is speaking, and may the application boot?** A capability's self-description — triggers, config keys, observations, resolvers, and intent names — plus `validateCapabilityDeclarations`, the sole set-level admission path. | The shell validates the complete direct list before constructing the processor or server. Write typed declarations through `declareCapability`; boot admission still accepts runtime `string[]` names so malformed external declarations can be rejected. |
| [`intent.ts`](intent.ts) | **What may be done.** The intent shape, idempotency-key derivation, and `screenIntent` runtime checks for attribution, declaration, authoritative position availability, and the workflow map. | A mapped-label transition gets its current position only from the observation projection. Missing or conflicted authority refuses closed; `expected` is only a requested precondition. |
| [`factory.ts`](factory.ts) | **How is one built?** `intentFactoryFor` binds the occasion once, so an intent states only what it wants. | The ergonomics are also two contracts: an intent cannot omit its explanation, and an omitted `expected` claims nothing rather than claiming something wrong. |
| [`boundary.ts`](boundary.ts) | **How it plugs in.** The typed view a capability receives (its own settings only, meanings-not-labels) and the generic machinery deriving per-declaration types. | The projection is the enforcement of config isolation: a capability cannot read a neighbour's block because the view never contains it. |

At boot, the shell admits the complete direct declaration list once. At runtime, an **observation**
(from the catalogue) reaches a capability's `evaluate` through its **view** (from boundary); it
returns **intents** (built with factory), each of which passes the projection-aware **screens**
(intent.ts) before safety. The engine derives action class and permission from `INTENT_OPERATIONS`;
capabilities never supply those facts. Explanations ride along and land in `../report/`.

What is deliberately *not* here: label strings (a capability speaks meanings; the adapter owns the
repository's words — `../config/`), the write rules (`../safety/`), and the transition tables the
screen consults (`../workflow/`). This directory defines the *shape* of a capability; it contains no
capability — those live outside core, and the disposable examples are in `probes/`.

## Your first capability — the whole idiom in ~30 lines

A capability is a declaration plus one pure async function. This one triages
unpositioned issues; it is real — the engine's own tests run its twin:

```ts
import {
    declareCapability,
    intentFactoryFor,
    type Capability,
} from "@hiero-hackers/automation-core";

export const triageDeclaration = declareCapability({
    name: "triage",
    triggers: [{ kind: "event", event: "issues" }],
    configKeys: [],
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

export const triage: Capability<typeof triageDeclaration> = {
    declaration: triageDeclaration,
    async evaluate(observation) {
        if (observation.position.kind !== "position") return []; // conflicts are reported, never repaired
        if (observation.position.state.meaning !== null) return []; // already positioned
        const make = intentFactoryFor(triageDeclaration, {
            repository: observation.repository,
            item: observation.item,
            observedAt: observation.observedAt,
        });
        return [
            make({
                operation: "applyMappedLabel",
                desired: { meaning: "awaitingTriage", cause: "intakeObserved" },
                cause: "issueWithoutPosition",
                expected: { meaningsAbsent: ["awaitingTriage"], closed: false },
                explain: { summary: "New issue placed in triage." },
            }),
        ];
    },
};
```

What the shape gives you without asking: an undeclared operation is a compile
error at the `make` call; the explanation is unskippable and becomes the
report's story; the requested `expected` facts are checked against the
authoritative observation projection; and everything you did NOT receive —
labels, Octokit, other capabilities, the mode, action class, or permissions —
is the isolation guarantee. Missing or conflicted projection authority refuses
closed. Run it through `decide()` and you get a `Report` and, in `active` mode,
an approved intent only when every screen and safety rule passes.
