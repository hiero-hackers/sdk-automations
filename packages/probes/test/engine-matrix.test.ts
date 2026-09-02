/**
 * P3 isolation, proven at the ENGINE level (D92 3b).
 *
 * The original toggle matrix ran the probes through the test harness's own
 * wiring; this one runs them through `decide()` — the composition that will
 * actually run in production. The property is the same and stronger for
 * where it is measured: for every capability C and every subset containing
 * C, C's OBSERVABLE DECISION — its approved intents and its findings — is
 * identical to C running alone. Enabling a neighbour changes nothing.
 *
 * An unprojected scheduled observation cannot verify an intent's claim. The
 * matrix therefore pins `inactivity` to `preconditionStale`; a future adapter
 * recheck cannot make an unapproved intent safe by itself (D116).
 */

import { describe, expect, it } from "vitest";
import {
    decide,
    deriveManagedMarker,
    matchesManagedComment,
    parseManagedMarker,
    type ApprovedEffect,
    type DecideExternals,
    type Decision,
    toEngine,
    type Finding,
} from "@hiero-hackers/automation-core";
import { inactivity, intake, prQuality } from "../src/index.js";
import { configEnabling, subsets, type AnyObservation } from "./world.js";

const ALL = [toEngine(prQuality), toEngine(intake), toEngine(inactivity)];
const NAMES = ["prQuality", "intake", "inactivity"];

const AT = new Date("2026-08-03T09:00:00.000Z");
const REPO = { owner: "hiero-hackers", repo: "sandbox" } as const;

const OBSERVATIONS: readonly AnyObservation[] = [
    {
        kind: "issueUpdated",
        repository: REPO,
        item: { kind: "issue", number: 11 },
        position: {
            kind: "position",
            state: { meaning: null, blocked: false, closedBy: null },
            ignored: [],
        },
        observedAt: AT,
    },
    {
        kind: "pullRequestUpdated",
        repository: REPO,
        item: { kind: "pullRequest", number: 12 },
        position: {
            kind: "position",
            state: { meaning: null, blocked: false, closedBy: null },
            ignored: [],
        },
        observedAt: AT,
    },
    {
        kind: "staleItemsDue",
        repository: REPO,
        items: [
            {
                item: { kind: "issue", number: 13 },
                assignee: "contributor",
                lastHumanActivityAt: new Date("2026-07-01T00:00:00.000Z"),
                warnedAt: null,
            },
        ],
        observedAt: AT,
    },
];

const SETTINGS = {
    intake: { announce: true },
    inactivity: { gracePeriodDays: 7 },
};

const externals: DecideExternals = {
    killSwitchActive: false,
    installationGrants: ["issues:write"],
    latestHumanChangeAt: () => null,
    resolve: async (query) =>
        query === "linkedIssues"
            ? ({ ok: true, value: [] } as never)
            : ({ ok: true, value: false } as never),
};

/** A capability's observable share of a decision. */
interface Slice {
    readonly approved: readonly ApprovedEffect[];
    readonly findings: readonly Finding[];
}
const capabilityOf = (f: Finding): string | null =>
    f.subject.kind === "capability" || f.subject.kind === "item" || f.subject.kind === "effect"
        ? f.subject.capability
        : null;

function sliceFor(decisions: readonly Decision[], name: string): Slice {
    return {
        approved: decisions.flatMap((d) =>
            d.approved.filter((effect) => effect.intent.capability === name),
        ),
        findings: decisions.flatMap((d) =>
            d.report.findings.filter((f) => capabilityOf(f) === name),
        ),
    };
}

async function runAll(enabled: readonly string[]): Promise<readonly Decision[]> {
    const config = configEnabling(enabled, NAMES, SETTINGS);
    const decisions: Decision[] = [];
    for (const observation of OBSERVATIONS) {
        decisions.push(await decide({ kind: "observation", observation }, config, ALL, externals));
    }
    return decisions;
}

describe("P3 through the engine", () => {
    it("each capability's decision is identical no matter which others are enabled", async () => {
        const alone = new Map<string, Slice>();
        for (const name of NAMES) {
            alone.set(name, sliceFor(await runAll([name]), name));
        }
        for (const subset of subsets(NAMES)) {
            const decisions = await runAll(subset);
            for (const name of subset) {
                expect(
                    sliceFor(decisions, name),
                    `"${name}" decided differently alongside [${subset.join(", ")}]`,
                ).toEqual(alone.get(name));
            }
        }
    });

    it("a disabled capability leaves no trace in any decision", async () => {
        for (const subset of subsets(NAMES)) {
            const decisions = await runAll(subset);
            for (const name of NAMES) {
                if (subset.includes(name)) continue;
                expect(sliceFor(decisions, name)).toEqual({
                    approved: [],
                    findings: [],
                });
            }
        }
    });

    it("the matrix is not vacuous: alone-runs do real, distinguishable work", async () => {
        const intakeAlone = sliceFor(await runAll(["intake"]), "intake");
        expect(intakeAlone.approved.length).toBeGreaterThan(0);
        const prAlone = sliceFor(await runAll(["prQuality"]), "prQuality");
        expect(prAlone.approved.length).toBeGreaterThan(0);
        // The retained stale probe has no projection and therefore refuses closed.
        const staleAlone = sliceFor(await runAll(["inactivity"]), "inactivity");
        expect(staleAlone.approved).toEqual([]);
        expect(staleAlone.findings.map((finding) => finding.code)).toEqual(["preconditionStale"]);
    });
});

/**
 * The cross-layer half of prQuality's conflict claim. The capability reads no
 * position, so nothing in `prQuality.ts` stops a conflicted pull request — and
 * for a month its docstring said one "still gets its comment". The engine is
 * where that is settled: `deriveWorld` establishes no precondition from a
 * conflicted projection, so the preflight refuses before any rule runs.
 */
describe("prQuality on a conflicted pull request", () => {
    const conflicted: AnyObservation = {
        kind: "pullRequestUpdated",
        repository: REPO,
        item: { kind: "pullRequest", number: 12 },
        position: {
            kind: "conflict",
            positions: ["needsReview", "readyToMerge"],
            blocked: false,
            closedBy: null,
            ignored: [],
        },
        observedAt: AT,
    };

    it("refuses preconditionStale and approves nothing", async () => {
        const decision = await decide(
            { kind: "observation", observation: conflicted },
            configEnabling(["prQuality"], NAMES, SETTINGS),
            ALL,
            externals,
        );

        expect(decision.approved).toEqual([]);
        expect(decision.report.findings.map((finding) => finding.code)).toEqual([
            "preconditionStale",
        ]);
    });

    /**
     * Merged counts as closed, and prQuality declines before the resolver
     * rather than at the gate — the `itemClosed` rule changed nothing here,
     * which is the point of asserting it.
     */
    it("says nothing at all about a merged pull request", async () => {
        const merged: AnyObservation = {
            ...conflicted,
            position: {
                kind: "position",
                state: { meaning: null, blocked: false, closedBy: "merged" },
                ignored: [],
            },
        };
        const decision = await decide(
            { kind: "observation", observation: merged },
            configEnabling(["prQuality"], NAMES, SETTINGS),
            ALL,
            externals,
        );

        expect(decision.approved).toEqual([]);
        expect(decision.report.findings).toEqual([]);
    });
});

/**
 * D125's ownership split, measured where it is decided: no probe writes a
 * marker, and every managed comment the engine approves carries one anyway.
 * `inactivity` is absent from this block on purpose — its sweep is unprojected,
 * so its warning never reaches approval and never earns an identity.
 */
describe("managed-comment identity is minted by the platform", () => {
    const approvedComments = async () => {
        const effects = (await runAll(NAMES)).flatMap((decision) => decision.approved);
        return effects.filter((effect) => effect.intent.operation === "postManagedComment");
    };

    it("marks intake's notice and prQuality's summary, and nothing else", async () => {
        const comments = await approvedComments();
        expect(
            comments.map((effect) => ({
                capability: effect.intent.capability,
                identity: effect.managedComment?.identity,
            })),
        ).toEqual([
            {
                capability: "intake",
                identity: {
                    capability: "intake",
                    kind: "notice",
                    effectId: comments[0]!.intent.idempotencyKey,
                },
            },
            {
                capability: "prQuality",
                identity: {
                    capability: "prQuality",
                    kind: "summary",
                    effectId: comments[1]!.intent.idempotencyKey,
                },
            },
        ]);

        // The label intake also asks for is the control: an operation that
        // posts nothing is handed no identity to post it under.
        const labels = (await runAll(NAMES))
            .flatMap((decision) => decision.approved)
            .filter((effect) => effect.intent.operation === "applyMappedLabel");
        expect(labels.map((effect) => effect.managedComment)).toEqual([null]);
    });

    it("publishes each identity as the marker that identity derives", async () => {
        for (const effect of await approvedComments()) {
            const managed = effect.managedComment!;
            expect(managed.marker).toBe(deriveManagedMarker(managed.identity));
            expect(parseManagedMarker(managed.marker)).toEqual({
                recognized: {
                    schemaVersion: 1,
                    capability: managed.identity.capability,
                    kind: managed.identity.kind,
                    effect: expect.stringMatching(/^[0-9a-f]{16}$/),
                },
            });
        }
    });

    /** The attack, at probe scale: the App's own marker, in someone else's comment. */
    it("never recognises a probe's marker under another author", async () => {
        for (const effect of await approvedComments()) {
            const managed = effect.managedComment!;
            expect(
                matchesManagedComment(
                    { body: managed.marker, authoredByApp: true },
                    managed.identity,
                ),
            ).toEqual({ matches: true });
            expect(
                matchesManagedComment(
                    { body: managed.marker, authoredByApp: false },
                    managed.identity,
                ),
            ).toEqual({ matches: false, why: "notAppAuthored" });
        }
    });
});

describe("intake conflict behavior", () => {
    it("reports a conflicted item in dry-run without approving a repair", async () => {
        const config = {
            ...configEnabling(["intake"], NAMES, SETTINGS),
            mode: "dry-run" as const,
        };
        const observation: AnyObservation = {
            kind: "issueUpdated",
            repository: REPO,
            item: { kind: "issue", number: 11 },
            position: {
                kind: "conflict",
                positions: ["ready", "inProgress"],
                blocked: false,
                closedBy: null,
                ignored: [],
            },
            observedAt: AT,
        };

        const decision = await decide({ kind: "observation", observation }, config, ALL, externals);

        expect(decision.approved).toEqual([]);
        expect(decision.report.findings.map((finding) => finding.code)).toEqual([
            "capabilityExplained",
        ]);
        expect(
            decision.report.findings
                .filter((finding) => finding.code === "capabilityExplained")
                .map((finding) => finding.summary),
        ).toContain("Skipped: the item holds more than one workflow position.");
    });
});
