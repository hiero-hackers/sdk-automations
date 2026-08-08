/**
 * The vertical slice, closed: one delivery GitHub actually sent travels
 * webhook-payload → normalize → capability → screen → safety → report,
 * entirely in pure logic. Zero network, zero mocks of GitHub — the payload
 * is `fixtures/issues.opened.json` from the 2026-08-07 capture session.
 *
 * `scenario.test.ts` walks the same modules from a synthetic observation;
 * this file's whole point is that NOTHING here is synthetic until the
 * capability speaks. When GitHub changes shape, this is the test that
 * notices first — and when a stage's assumption about real payloads is
 * wrong, this is where the stages meet.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
    decide,
    deriveIdempotencyKey,
    evaluateWrite,
    normalizeDelivery,
    parseConfig,
    explanationFinding,
    problems,
    screenIntent,
    verdictFinding,
    type AnyIntent,
    type CapabilityDeclaration,
    type Report,
} from "../src/index.js";
import { assertedWorld } from "../src/safety/world.js";

const payload = JSON.parse(
    readFileSync(
        fileURLToPath(new URL("github/fixtures/issues.opened.json", import.meta.url)),
        "utf8",
    ),
);

/** A minimal triage capability — the one synthetic participant. */
const triage: CapabilityDeclaration = {
    name: "triage",
    triggers: [{ kind: "event", event: "issues" }],
    configKeys: [],
    observations: ["issueUpdated"],
    resolvers: [],
    intents: [
        {
            name: "applyMappedLabel",
            idempotencyClass: "idempotent",
            requiredPermissions: ["issues:write"],
        },
    ],
    permissions: { repository: ["issues:write"], organization: [] },
    operationalNeeds: {
        schedule: false,
        durableState: "none",
        crossItemCoordination: false,
        externalDelivery: false,
    },
};

const configResult = parseConfig(
    {
        schemaVersion: 1,
        mode: "active",
        capabilities: { triage: { enabled: true } },
        mappings: { labels: { awaitingTriage: "status: triage" } },
    },
    { revision: "rev-slice-1", knownCapabilities: ["triage"] },
);
if (!configResult.ok) throw new Error("config must parse");
const config = configResult.config;

describe("one real delivery, end to end", () => {
    // ── normalize: GitHub's wire format dies here ──
    const normalized = normalizeDelivery("issues", payload, config);
    it("the real payload normalizes", () => {
        expect(normalized.kind).toBe("observation");
    });
    if (normalized.kind !== "observation") throw new Error("unreachable");
    const observation = normalized.observation;

    // ── the capability's decision, from the projection alone ──
    if (observation.position.kind !== "position") throw new Error("unreachable");
    const state = observation.position.state;

    const intent: AnyIntent = {
        capability: "triage",
        repository: observation.repository,
        item: observation.item,
        operation: "applyMappedLabel",
        actionClass: "reversibleStateChange",
        expected: {
            meaningsPresent: [],
            meaningsAbsent: ["awaitingTriage"],
            closed: false,
        },
        desired: { meaning: "awaitingTriage", cause: "intakeObserved" },
        cause: { cause: "issueWithoutPosition", observedAt: observation.observedAt },
        explanation: {
            capability: "triage",
            summary: "New issue placed in triage.",
            detail: ["no mapped position on arrival"],
        },
        idempotencyKey: "",
    };
    const keyed = { ...intent, idempotencyKey: deriveIdempotencyKey(intent) };

    it("the observation invites exactly this intent", () => {
        expect(state).toEqual({ meaning: null, blocked: false, closedBy: null });
    });

    // ── screen: declaration, floors, and the map (D78/D90) ──
    const screen = screenIntent(keyed, triage as never);
    it("the screen passes the documented [*] → awaitingTriage edge", () => {
        expect(screen).toEqual({ ok: true });
    });

    // ── safety: the write gate, on facts derived from the same observation ──
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
    it("safety applies the write in active mode", () => {
        expect(verdict).toEqual({ outcome: "apply" });
    });

    // ── report: the sink every consumer reads ──
    const report: Report = {
        revision: config.revision,
        mode: config.mode,
        repository: observation.repository,
        findings: [
            /**
             * D92 3d: an intent that acts tells its story — the explanation
             * joins the report beside the verdict, on both wirings.
             */
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
        ],
    };
    it("the report closes clean: nothing needs a human", () => {
        expect(report.findings.map((f) => f.code)).toEqual(["capabilityExplained", "applied"]);
        expect(problems(report)).toEqual([]);
    });

    it("dry-run tells the same story without applying it", () => {
        const dryConfig = { ...config, mode: "dry-run" as const };
        const dry = evaluateWrite(
            {
                capability: "triage",
                actionClass: "reversibleStateChange",
                requiredPermissions: ["issues:write"],
                causeObservedAt: keyed.cause.observedAt,
                cause: keyed.cause.cause,
                target: { item: "issue #164", change: "label → status: triage" },
            },
            dryConfig,
            {
                installationGrants: ["issues:write"],
                killSwitchActive: false,
                world: assertedWorld([], true),
                latestHumanChangeAt: null,
            },
        );
        expect(dry).toMatchObject({ outcome: "record-only", code: "modeRecordsOnly" });
        expect(verdictFinding(dry, { kind: "repository" }).severity).toBe("notice");
    });

    /**
     * D92 phase 2 — the parity gate. The engine must produce, from the same
     * real delivery, exactly the findings this file assembled by hand. A
     * mismatch STOPS the migration: it means either the engine or a
     * hand-wiring is wrong, and both answers matter more than progress.
     */
    it("parity: decide() equals the hand wiring, finding for finding", async () => {
        const asCapability = {
            declaration: triage as never,
            async evaluate() {
                return [keyed];
            },
        };
        const decision = await decide(
            { kind: "delivery", repository: observation.repository, event: "issues", payload },
            config,
            [asCapability as never],
            {
                now: new Date("2026-08-07T02:00:00Z"),
                killSwitchActive: false,
                installationGrants: ["issues:write"],
                latestHumanChangeAt: () => null,
            },
        );
        expect(decision.report.findings).toEqual(report.findings);
        expect(decision.report.revision).toBe(report.revision);
        expect(decision.report.mode).toBe(report.mode);
        expect(decision.report.repository).toEqual(report.repository);
        expect(decision.approved).toEqual([keyed]);
    });
});
