/**
 * P3 isolation, proven at the ENGINE level (D92 3b).
 *
 * The original toggle matrix ran the capabilities through the test harness's own
 * wiring; this one runs them through `decide()` — the composition that will
 * actually run in production. The property is the same and stronger for
 * where it is measured: for every capability C and every subset containing
 * C, C's OBSERVABLE DECISION — its approved intents and its findings — is
 * identical to C running alone. Enabling a neighbour changes nothing.
 *
 * Four records, one decision each (contracts/facts.md §4): a webhook-shaped
 * issue and pull request, and a sweep-shaped one of each. The webhook pair is
 * where `inactivity` meets `factsUnread` — it needs every group and a webhook
 * reads none — and the sweep pair is where its reminder is gated and approved.
 * What has not changed is that the claim is checked, never taken: an adapter
 * recheck cannot make an unapproved intent safe by itself (D116).
 */

import { describe, expect, it } from "vitest";
import {
    decide,
    deriveManagedMarker,
    managedMarkerPayload,
    matchesManagedComment,
    parseManagedMarker,
    type Decision,
    type Effect,
    type Externals,
    type Finding,
} from "@hiero-hackers/automation-core";
import type { Facts } from "@hiero-hackers/automation-core";
import { CAPABILITIES } from "../src/index.js";
import {
    configEnabling,
    fullestValidSettings,
    namesOffered,
    subsets,
    sweptIssue,
    sweptPullRequest,
    webhookIssue,
    webhookPullRequest,
} from "@hiero-hackers/automation-core/author/testing";

// Derived, not listed: a capability joins the matrix by joining the registry.
const ALL = CAPABILITIES;
const NAMES = CAPABILITIES.map((capability) => capability.declaration.name);
const DECLARATIONS = CAPABILITIES.map((capability) => capability.declaration);

const RECORDS: readonly Facts[] = [
    webhookIssue(),
    webhookPullRequest(),
    sweptIssue({
        assignees: [
            {
                login: "contributor",
                assignedAt: new Date("2026-07-01T00:00:00.000Z"),
                lastWorkingAt: null,
            },
        ],
    }),
    // One of each kind since D143, so the vacuity control and the identity
    // block exercise both ladders rather than only the issue one. The pull
    // request is a stale draft, which is the silent branch even with the
    // ladder enabled — the issue record above is what makes the sweep do
    // visible work.
    sweptPullRequest({
        assignees: [
            {
                login: "contributor",
                assignedAt: new Date("2026-07-01T00:00:00.000Z"),
                lastWorkingAt: null,
            },
        ],
    }),
];

/**
 * A document that maps every meaning a shipped block names.
 *
 * The three the probe world maps by default do not include `needsRevision`,
 * and a settings block is only as usable as the mappings under it: consenting
 * to inactivity's `needsRevision` reason against a document that never mapped
 * the meaning makes the capability skip the whole file as unusable, which is
 * the one thing a matrix measuring decisions must not do silently.
 */
const MAPPINGS = {
    labels: {
        awaitingTriage: "status: triage",
        inProgress: "status: in progress",
        blocked: "blocked",
        needsRevision: "status: needs revision",
    },
};

/**
 * Every capability at its fullest, derived the way `ALL` and `NAMES` are: each
 * block consented to, each flag thrown, each required key at its smallest value,
 * everything else at its own default.
 *
 * A hand-kept map here was the one line a capability's first opt-in block did
 * not move. An alone-run under the smallest valid block does nothing, and the
 * vacuity control below is what notices — after the capability is written, in
 * a file whose name does not mention it.
 */
const SETTINGS = Object.fromEntries(
    ALL.map(({ declaration }) => [
        declaration.name,
        fullestValidSettings(declaration.settings, namesOffered(MAPPINGS)),
    ]),
);

const externals: Externals = {
    killSwitchActive: false,
    installationGrants: ["issues:write"],
    latestHumanChangeAt: () => null,
    resolve: async (query) => {
        // Each name answered in its OWN shape. A blanket `false` typechecks
        // through the erasure and would hand `configAtHead` a value with no
        // `touched` on it — a capability reading a nonsense answer is not the
        // isolation this matrix measures.
        if (query === "linkedIssues") return { ok: true, value: [] } as never;
        if (query === "commitAttestations") return { ok: true, value: [] } as never;
        if (query === "assigneesOf") return { ok: true, value: [] } as never;
        if (query === "configAtHead") return { ok: true, value: { touched: false } } as never;
        return { ok: true, value: false } as never;
    },
};

/** A capability's observable share of a decision. */
interface Slice {
    readonly approved: readonly Effect[];
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
    const config = configEnabling(enabled, DECLARATIONS, SETTINGS, MAPPINGS);
    const decisions: Decision[] = [];
    for (const facts of RECORDS) {
        decisions.push(await decide({ kind: "facts", facts }, config, ALL, externals));
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
        const prAlone = sliceFor(await runAll(["prDashboard"]), "prDashboard");
        expect(prAlone.approved.length).toBeGreaterThan(0);
        /**
         * Both halves of facts.md §4 in one list, in record order: the two
         * webhook records are skipped because inactivity needs groups a
         * webhook does not read, and the swept issue's reminder is gated and
         * approved. The swept pull request earns its own pair now — every
         * reason under its ladder acts, the draft one included, so a stale
         * draft is warned exactly as a stale label is.
         */
        const staleAlone = sliceFor(await runAll(["inactivity"]), "inactivity");
        expect(staleAlone.approved.length).toBeGreaterThan(0);
        expect(staleAlone.findings.map((finding) => finding.code)).toEqual([
            "factsUnread",
            "factsUnread",
            "capabilityExplained",
            "applied",
            "capabilityExplained",
            "applied",
        ]);
    });
});

/**
 * The cross-layer half of prDashboard's conflict claim. The capability reads no
 * position, so nothing in its `capability.ts` stops a conflicted pull request — and
 * for a month its docstring said one "still gets its comment". The engine is
 * where that is settled: `deriveWorld` establishes no precondition from a
 * conflicted projection, so the preflight refuses before any rule runs.
 */
describe("prDashboard on a conflicted pull request", () => {
    const conflicted = webhookPullRequest({
        position: {
            kind: "conflict",
            positions: ["needsReview", "readyToMerge"],
            blocked: false,
            closedBy: null,
            ignored: [],
        },
    });

    it("refuses preconditionStale and approves nothing", async () => {
        const decision = await decide(
            { kind: "facts", facts: conflicted },
            configEnabling(["prDashboard"], DECLARATIONS, SETTINGS, MAPPINGS),
            ALL,
            externals,
        );

        expect(decision.approved).toEqual([]);
        expect(decision.report.findings.map((finding) => finding.code)).toEqual([
            "preconditionStale",
        ]);
    });

    /**
     * Merged counts as closed, and the platform declines before the capability
     * is called at all: no finding, nothing asked, nothing approved (D59).
     */
    it("says nothing at all about a merged pull request", async () => {
        const merged = webhookPullRequest({
            position: {
                kind: "position",
                state: { meaning: null, blocked: false, closedBy: "merged" },
                ignored: [],
            },
        });
        const decision = await decide(
            { kind: "facts", facts: merged },
            configEnabling(["prDashboard"], DECLARATIONS, SETTINGS, MAPPINGS),
            ALL,
            externals,
        );

        expect(decision.approved).toEqual([]);
        expect(decision.report.findings).toEqual([]);
    });
});

/**
 * D125's ownership split, measured where it is decided: no capability writes a
 * marker, and every managed comment the engine approves carries one anyway.
 * `inactivity` is here now: a sweep-shaped record makes its reminder
 * approvable, so the warning earns the identity a warning is found again by.
 */
describe("managed-comment identity is minted by the platform", () => {
    const approvedComments = async () => {
        const effects = (await runAll(NAMES)).flatMap((decision) => decision.approved);
        return effects.filter((effect) => effect.intent.operation === "postManagedComment");
    };

    it("marks every comment the four records earn, and none of the labels", async () => {
        const comments = await approvedComments();
        /**
         * Record order. Event-only intake ignores sweep records even though
         * they carry the same item kind.
         */
        expect(
            comments.map((effect) => ({
                capability: effect.intent.capability,
                item: effect.intent.item.number,
                kind: effect.managedComment?.identity.kind,
                topic: effect.managedComment?.identity.topic,
            })),
            "one row per managed comment the four fixture records earn, in record then registry order — a new capability that posts one adds its rows here by hand",
        ).toEqual([
            { capability: "intake", item: 11, kind: "notice", topic: "welcome" },
            { capability: "prDashboard", item: 12, kind: "summary", topic: "" },
            // `inactivity` is the one design that needs the discriminator: the
            // warning is about ONE assignee's clock (D145).
            { capability: "inactivity", item: 13, kind: "warning", topic: "contributor" },
            { capability: "prDashboard", item: 14, kind: "summary", topic: "" },
            // The same discriminator on a pull request is the REASON, so a
            // pull request re-warned under another one gets its own comment.
            { capability: "inactivity", item: 14, kind: "warning", topic: "draft" },
        ]);
        // The identity is minted from the intent's OWN fields, never chosen —
        // and it names the ITEM and the purpose, never the occasion.
        for (const effect of comments) {
            const identity = effect.managedComment!.identity;
            expect(identity.capability).toBe(effect.intent.capability);
            expect(identity.item).toEqual(effect.intent.item);
            expect(deriveManagedMarker(identity)).not.toContain(
                effect.intent.cause.observedAt.toISOString(),
            );
        }

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
                    schemaVersion: 2,
                    capability: managed.identity.capability,
                    kind: managed.identity.kind,
                    subject: expect.stringMatching(/^[0-9a-f]{16}$/),
                },
            });
        }
    });

    /** The attack, at this scale: the App's own marker, in someone else's comment. */
    it("never recognises a capability's marker under another author", async () => {
        for (const effect of await approvedComments()) {
            const managed = effect.managedComment!;
            const published = managedMarkerPayload(managed.identity);
            expect(
                matchesManagedComment({ body: managed.marker, authoredByApp: true }, published),
            ).toEqual({ matches: true });
            expect(
                matchesManagedComment({ body: managed.marker, authoredByApp: false }, published),
            ).toEqual({ matches: false, why: "notAppAuthored" });
        }
    });
});

describe("intake conflict behavior", () => {
    it("reports a conflicted item in dry-run without approving a repair", async () => {
        const config = {
            ...configEnabling(["intake"], DECLARATIONS, SETTINGS, MAPPINGS),
            mode: "dry-run" as const,
        };
        const facts = webhookIssue({
            position: {
                kind: "conflict",
                positions: ["ready", "inProgress"],
                blocked: false,
                closedBy: null,
                ignored: [],
            },
        });

        const decision = await decide({ kind: "facts", facts }, config, ALL, externals);

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
