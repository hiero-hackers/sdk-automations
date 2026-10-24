/**
 * The vertical slice, closed: one delivery GitHub actually sent travels
 * webhook-payload → normalize → capability → screen → safety → report,
 * entirely in pure logic, through `decide()` (D92). Zero network, zero
 * mocks of GitHub — the payload is the testkit's `issues.opened.json` from
 * the 2026-10-24 capture session.
 *
 * Nothing here is synthetic until the capability speaks, which is the whole
 * point: when GitHub changes shape, this is the test that notices first. The
 * second describe is the one exception, and says why.
 *
 * The parity test is the one place the pipeline is still hand-wired: it
 * builds the expected report from the same primitives `decide()` composes
 * — `screenIntent`, `evaluateWrite`, `explanationFinding`, `verdictFinding`
 * — on the identical intent, so that block is the specification `decide()`
 * is held to, not duplicated plumbing (D92 phase 2's parity gate).
 *
 * That block takes the request from `writeRequestFor` — decide()'s one
 * builder, shared with the shell's applier — and the world from
 * `deriveWorld` over a projection rebuilt from the capture's labels. It
 * then pins each of those
 * to today's spelling, because `verdictFinding` surfaces only a code and a
 * reason — a report comparison alone would let the target format, the change
 * description or the world derivation drift unnoticed.
 */

import { describe, expect, it } from "vitest";
import { capture } from "@hiero-hackers/automation-testkit";
import {
    INTENT_OPERATIONS,
    declareCapability,
    spec,
    decide,
    deriveWorld,
    writeRequestFor,
    evaluateWrite,
    explanationFinding,
    intentFactoryFor,
    meaningsOfLabels,
    normalizeDelivery,
    problems,
    projectIssue,
    screenIntent,
    verdictFinding,
    applyIssueTransition,
    type EngineCapability,
    type Externals,
    type IssueMeaning,
    type WorkItemState,
} from "../src/index.js";
import { triageConfig } from "./config/builders.js";

const payload = capture("issues.opened.json").json();

const declaration = declareCapability({
    name: "triage",
    triggers: [{ kind: "event", event: "issues" }],
    settings: spec({}),
    requiredMappings: {},
    facts: ["issue"],
    needs: [],
    resolvers: [],
    labels: ["awaitingTriage"],
    intents: ["applyMappedLabel"],
});

/** The shared triage repository, stamped with this file's revision. */
const configIn = (mode: "active" | "dry-run") => triageConfig(mode, "rev-slice-1");

const externals: Externals = {
    killSwitchActive: false,
    installationGrants: ["issues:write"],
    latestHumanChangeAt: () => null,
};

describe("one real delivery, end to end", () => {
    const config = configIn("active");
    const normalized = normalizeDelivery("issues", payload, config);
    if (normalized.kind !== "facts") throw new Error("fixture must normalize");
    const facts = normalized.facts;

    /** The capability's one decision, stated once: triage this issue. */
    const keyed = intentFactoryFor(declaration, {
        repository: facts.repository,
        item: facts.item,
        observedAt: facts.observedAt,
    })({
        operation: "applyMappedLabel",
        desired: { meaning: "awaitingTriage", cause: "intakeObserved" },
        cause: "issueWithoutPosition",
        claims: { meaningsAbsent: ["awaitingTriage"], closed: false },
        explain: {
            summary: "New issue placed in triage.",
            detail: ["no mapped position on arrival"],
        },
    });

    const triage: EngineCapability = {
        declaration: declaration as never,
        async evaluate() {
            return [keyed];
        },
    };

    const send = (mode: "active" | "dry-run") =>
        decide(
            { kind: "delivery", repository: facts.repository, event: "issues", payload },
            configIn(mode),
            [triage],
            externals,
        );

    it("triages the unpositioned issue and closes clean: nothing needs a human", async () => {
        const decision = await send("active");
        expect(decision.approved).toEqual([
            {
                intent: { ...keyed, evaluatedAt: facts.observedAt },
                managedComment: null,
                records: null,
            },
        ]);
        expect(decision.report.findings.map((f) => f.code)).toEqual([
            "capabilityExplained",
            "applied",
        ]);
        expect(problems(decision.report)).toEqual([]);
    });

    it("dry-run tells the same story, and names what it would have done", async () => {
        const decision = await send("dry-run");
        expect(decision.approved).toEqual([]);
        expect(decision.report.findings.map((f) => `${f.code}:${f.severity}`)).toEqual([
            "capabilityExplained:info",
            "modeRecordsOnly:notice",
            "wouldApply:info",
        ]);
    });

    /**
     * The capture's issue arrives bare, so `meaningsOfLabels` maps nothing.
     * Stated here rather than dug out of the `unknown` payload; the projection
     * below is compared against the normalizer's, which is what would notice a
     * capture that grew a label.
     */
    const capturedLabels: readonly string[] = [];

    it("parity: decide() equals the hand-wired report, finding for finding", async () => {
        const screen = screenIntent(keyed, declaration, facts.position);
        expect(screen).toEqual({ ok: true });

        // The world by decide()'s recipe: a projection of the capture's own
        // labels, derived against the intent's claim. Equal to the one the
        // normalizer built, or this fixture no longer says what it says.
        const projection = projectIssue({
            closedBy: null,
            meanings: meaningsOfLabels(config, capturedLabels),
        });
        expect(projection).toEqual(facts.position);
        const world = deriveWorld(projection, keyed.claims);
        expect(world).toMatchObject({
            observedMeanings: [],
            preconditionHolds: true,
            closure: null,
        });

        // The request from decide()'s ONE builder, with its spelling pinned:
        // the verdict finding carries neither the item nor the change, so
        // nothing else would catch a change to either half — and pinning
        // the builder's output pins every caller, the applier included.
        const request = writeRequestFor(keyed);
        expect(request).toMatchObject({
            capability: declaration.name,
            actionClass: INTENT_OPERATIONS[keyed.operation].actionClassFloor,
            requiredPermissions: [INTENT_OPERATIONS[keyed.operation].permission],
            target: {
                item: "scrubbed-1/scrubbed-2#37",
                change: "set mapped position awaitingTriage",
            },
        });

        const verdict = evaluateWrite(request, config, {
            installationGrants: externals.installationGrants,
            killSwitchActive: externals.killSwitchActive,
            world,
            latestHumanChangeAt: await externals.latestHumanChangeAt(facts.item),
        });
        const expectedFindings = [
            explanationFinding(keyed.explanation, {
                kind: "item",
                capability: "triage",
                item: facts.item,
            }),
            verdictFinding(verdict, {
                kind: "effect",
                capability: "triage",
                item: facts.item,
                operation: "applyMappedLabel",
            }),
        ];

        const decision = await send("active");
        expect(decision.report.findings).toEqual(expectedFindings);
    });
});

/**
 * Defence in depth, asserted rather than described — the one claim
 * `scenario.test.ts` made that no other test makes. Every piece below is
 * covered on its own (`workflow/transitions.test.ts` for `itemClosed`,
 * `safety/write.test.ts` for `newerHumanChange`); what is unique is that the
 * SAME stale story is refused by two independent layers, so a bypass of
 * either is still caught by the other. Synthetic on purpose: no captured
 * delivery arrives already stale.
 */
describe("a human closing the issue defeats a stale scheduled intent at BOTH layers", () => {
    const config = configIn("active");

    it("the state machine refuses, and safety refuses on the close alone", () => {
        // A scheduled evaluation still believes the issue is inProgress.
        const closed: WorkItemState<IssueMeaning> = {
            meaning: null,
            blocked: false,
            closedBy: "closedByHuman",
        };
        const stale = applyIssueTransition(closed, {
            from: "inProgress",
            to: "ready",
            cause: "reclaimCompleted",
        });
        expect(stale.verdict).toMatchObject({ allowed: false, code: "itemClosed" });

        // Even if the state machine were bypassed, safety refuses on the newer
        // human change ALONE — so the world here is the one a recheck that
        // MISSED the close would derive: still open, still positioned,
        // precondition intact. Every other rule is satisfied; only the close's
        // timestamp is left to refuse, which is the whole claim.
        const missedTheClose = deriveWorld(
            projectIssue({ closedBy: null, meanings: ["awaitingTriage"] }),
            { meaningsPresent: ["awaitingTriage"], meaningsAbsent: [], closed: false },
        );
        expect(missedTheClose).toMatchObject({ preconditionHolds: true, closure: null });

        const write = evaluateWrite(
            {
                actionClass: "reversibleStateChange",
                capability: "triage",
                requiredPermissions: ["issues:write"],
                causeObservedAt: new Date("2026-07-25T10:00:00Z"),
                cause: "scheduled reclaim evaluation",
                target: { item: "issue #7", change: "clear mapped position awaitingTriage" },
            },
            config,
            {
                installationGrants: externals.installationGrants,
                killSwitchActive: false,
                world: missedTheClose,
                latestHumanChangeAt: new Date("2026-07-25T10:05:00Z"), // the close
            },
        );
        expect(write).toMatchObject({ outcome: "refuse", code: "newerHumanChange" });
    });
});
