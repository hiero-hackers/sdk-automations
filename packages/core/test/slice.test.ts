/**
 * The vertical slice, closed: one delivery GitHub actually sent travels
 * webhook-payload → normalize → capability → screen → safety → report,
 * entirely in pure logic, through `decide()` (D92). Zero network, zero
 * mocks of GitHub — the payload is the testkit's `issues.opened.json` from
 * the 2026-08-07 capture session.
 *
 * `scenario.test.ts` walks the same modules from a synthetic observation;
 * this file's whole point is that NOTHING here is synthetic until the
 * capability speaks. When GitHub changes shape, this is the test that
 * notices first.
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
    decide,
    deriveWorld,
    writeRequestFor,
    evaluateWrite,
    explanationFinding,
    intentFactoryFor,
    meaningsOfLabels,
    normalizeDelivery,
    problems,
    projectIssueObservation,
    screenIntent,
    verdictFinding,
    type DecideExternals,
    type EngineCapability,
} from "../src/index.js";
import { triageConfig } from "./config/builders.js";

const payload = capture("issues.opened.json").json();

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

/** The shared triage repository, stamped with this file's revision. */
const configIn = (mode: "active" | "dry-run") => triageConfig(mode, "rev-slice-1");

const externals: DecideExternals = {
    killSwitchActive: false,
    installationGrants: ["issues:write"],
    latestHumanChangeAt: () => null,
};

describe("one real delivery, end to end", () => {
    const config = configIn("active");
    const normalized = normalizeDelivery("issues", payload, config);
    if (normalized.kind !== "observation") throw new Error("fixture must normalize");
    const observation = normalized.observation;

    /** The capability's one decision, stated once: triage this issue. */
    const keyed = intentFactoryFor(declaration, {
        repository: observation.repository,
        item: observation.item,
        observedAt: observation.observedAt,
    })({
        operation: "applyMappedLabel",
        desired: { meaning: "awaitingTriage", cause: "intakeObserved" },
        cause: "issueWithoutPosition",
        expected: { meaningsAbsent: ["awaitingTriage"], closed: false },
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
            { kind: "delivery", repository: observation.repository, event: "issues", payload },
            configIn(mode),
            [triage],
            externals,
        );

    it("triages the unpositioned issue and closes clean: nothing needs a human", async () => {
        const decision = await send("active");
        expect(decision.approved).toEqual([{ intent: keyed, managedComment: null }]);
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
        const screen = screenIntent(keyed, declaration, observation.position);
        expect(screen).toEqual({ ok: true });

        // The world by decide()'s recipe: a projection of the capture's own
        // labels, derived against the intent's claim. Equal to the one the
        // normalizer built, or this fixture no longer says what it says.
        const projection = projectIssueObservation({
            closedBy: null,
            meanings: meaningsOfLabels(config, capturedLabels),
        });
        expect(projection).toEqual(observation.position);
        const world = deriveWorld(projection, keyed.expected);
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
                item: "scrubbed-1/scrubbed-2#164",
                change: "set mapped position awaitingTriage",
            },
        });

        const verdict = evaluateWrite(request, config, {
            installationGrants: externals.installationGrants,
            killSwitchActive: externals.killSwitchActive,
            world,
            latestHumanChangeAt: await externals.latestHumanChangeAt(observation.item),
        });
        const expectedFindings = [
            explanationFinding(keyed.explanation, {
                kind: "item",
                capability: "triage",
                item: observation.item,
            }),
            verdictFinding(verdict, {
                kind: "effect",
                capability: "triage",
                item: observation.item,
                operation: "applyMappedLabel",
            }),
        ];

        const decision = await send("active");
        expect(decision.report.findings).toEqual(expectedFindings);
    });
});
