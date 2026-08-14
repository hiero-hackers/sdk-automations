/**
 * The vertical slice, closed: one delivery GitHub actually sent travels
 * webhook-payload → normalize → capability → screen → safety → report,
 * entirely in pure logic, through `decide()` (D92). Zero network, zero
 * mocks of GitHub — the payload is `fixtures/issues.opened.json` from the
 * 2026-08-07 capture session.
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
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
    declareCapability,
    decide,
    evaluateWrite,
    explanationFinding,
    intentFactoryFor,
    normalizeDelivery,
    parseConfig,
    problems,
    screenIntent,
    verdictFinding,
    type DecideExternals,
    type EngineCapability,
} from "../src/index.js";
import { assertedWorld } from "../src/safety/world.js";

const payload = JSON.parse(
    readFileSync(
        fileURLToPath(new URL("github/fixtures/issues.opened.json", import.meta.url)),
        "utf8",
    ),
);

const declaration = declareCapability({
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

function configIn(mode: "active" | "dry-run") {
    const result = parseConfig(
        {
            schemaVersion: 1,
            mode,
            capabilities: { triage: { enabled: true } },
            mappings: { labels: { awaitingTriage: "status: triage" } },
        },
        { revision: "rev-slice-1", knownCapabilities: ["triage"] },
    );
    if (!result.ok) throw new Error("config must parse");
    return result.config;
}

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
        expect(decision.approved).toEqual([keyed]);
        expect(decision.report.findings.map((f) => f.code)).toEqual([
            "capabilityExplained",
            "applied",
        ]);
        expect(problems(decision.report)).toEqual([]);
    });

    it("dry-run tells the same story without applying it", async () => {
        const decision = await send("dry-run");
        expect(decision.approved).toEqual([]);
        expect(decision.report.findings.map((f) => `${f.code}:${f.severity}`)).toEqual([
            "capabilityExplained:info",
            "modeRecordsOnly:notice",
        ]);
    });

    it("parity: decide() equals the hand-wired report, finding for finding", async () => {
        const screen = screenIntent(keyed, declaration, observation.position);
        expect(screen).toEqual({ ok: true });

        const verdict = evaluateWrite(
            {
                capability: "triage",
                actionClass: "reversibleStateChange",
                requiredPermissions: ["issues:write"],
                causeObservedAt: keyed.cause.observedAt,
                cause: keyed.cause.cause,
                target: { item: "issue #164", change: "label → status: triage" },
            },
            config,
            {
                installationGrants: ["issues:write"],
                killSwitchActive: false,
                world: assertedWorld([], true),
                latestHumanChangeAt: null,
            },
        );
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
