/**
 * What configReport decides, and what the comment it asks for says.
 *
 * An unanswerable resolver is never read as an untouched file, and nothing
 * file-derived reaches a body without going through `inert()`.
 */

import { describe, expect, it } from "vitest";
import {
    decide,
    handleFor,
    parseConfig,
    parseConfigDocument,
    projectCapabilityView,
    revisionOf,
    toEngine,
    type AdmittedCapability,
    type ConfigError,
    type ConfigResult,
    type Externals,
    type Facts,
    type PrMeaning,
    type Projection,
    type ResolverSource,
    type WorkItemState,
} from "@hiero-hackers/automation-core";
import { configReport, configReportDeclaration } from "./capability.js";
import { renderConfiguration, renderRejection, renderReport } from "./render.js";
import { CONFIG_REPORT_SETTINGS } from "./settings.js";
import { intakeDeclaration } from "../intake/capability.js";
import { prDashboardDeclaration } from "../prDashboard/capability.js";
import { inactivityDeclaration } from "../inactivity/capability.js";
import {
    answering,
    configEnabling,
    factsFor,
    OBSERVED_AT,
    REPOSITORY,
    webhookPullRequest,
} from "@hiero-hackers/automation-core/author/testing";

const ITEM = { kind: "pullRequest", number: 12 } as const;
const REVISION = "sha256:abcdef012345";

/** The declarations a proposed document is judged against: the real ones. */
const KNOWN: readonly AdmittedCapability[] = [
    intakeDeclaration,
    prDashboardDeclaration,
    inactivityDeclaration,
    configReportDeclaration,
];

const enabled = () => configEnabling(["configReport"], [configReportDeclaration]);

const view = () => projectCapabilityView(configReportDeclaration, enabled());

const pullRequest = (state: Partial<WorkItemState<PrMeaning>>) =>
    factsFor(
        configReportDeclaration,
        webhookPullRequest({
            item: ITEM,
            position: {
                kind: "position",
                state: { meaning: null, blocked: false, closedBy: null, ...state },
                ignored: [],
            } satisfies Projection<PrMeaning>,
        }),
    );

/** The engine's own handle over one source, and the record it is about. */
function probe(source: ResolverSource, state: Partial<WorkItemState<PrMeaning>> = {}) {
    const facts = pullRequest(state);
    const handle = handleFor(configReportDeclaration, facts, source);
    return { facts, handle, platform: handle };
}

/** The externals a decision runs against, over one resolver source. */
const externals = (resolve: ResolverSource): Externals => ({
    killSwitchActive: false,
    installationGrants: ["issues:write"],
    latestHumanChangeAt: () => null,
    resolve,
});

/** The parser, over text, exactly as the resolver would have run it. */
const parsed = (text: string): ConfigResult =>
    parseConfigDocument(text, { revision: revisionOf(text), knownCapabilities: KNOWN });

/** A resolver source answering with one proposed document. */
const proposing = (text: string): ResolverSource =>
    answering({ ok: true, value: { touched: true, revision: REVISION, result: parsed(text) } });

/** The one comment body this capability asked for. */
async function bodyFor(text: string): Promise<string> {
    const { facts, platform } = probe(proposing(text));
    const intents = await configReport.evaluate(facts, view(), platform);
    const desired = intents[0]?.desired;
    if (desired === undefined || !("body" in desired)) throw new Error("no comment was asked for");
    return desired.body;
}

const CLEAN = `schemaVersion: 2
mode: active

capabilities:
  intake:
    enabled: true
    announce: true
  prDashboard:
    enabled: true
  inactivity:
    enabled: false

mappings:
  labels:
    awaitingTriage: "status: triage"

principals:
  maintainerTeam: hiero-sdk-js-maintainers
`;

/** One capability on, its spec empty, and no neighbour written beside it. */
const SPARSE = `schemaVersion: 2
mode: dry-run

capabilities:
  configReport:
    enabled: true
`;

/** The five-error case D147 recorded, plus an unrelated misspelling. */
const CASCADE = `schemaVersion: 2
mode: active

capabilities:
  intake:
    enabled: true
    annouce: true
  inactivity:
    enabled: true
    remindAfter: "two weeks"
    pullRequests:
      enabled: true
      reapWhen:
        draft:
          enabled: true
        changesRequested:
          enabled: true
`;

describe("configReport", () => {
    it("says nothing about a pull request that leaves automations.yml alone", async () => {
        const { facts, handle, platform } = probe(
            answering({ ok: true, value: { touched: false } }),
        );

        expect(await configReport.evaluate(facts, view(), platform)).toEqual([]);
        expect(handle.explanations).toEqual([]);
    });

    it("reads an unanswerable resolver as unknown, never as an untouched file", async () => {
        const { facts, handle, platform } = probe(
            answering({
                ok: false,
                reason: "rateLimited",
                detail: "secondary rate limit on this installation",
            }),
        );

        await expect(configReport.evaluate(facts, view(), platform)).rejects.toBeDefined();
        expect(handle.skipped).toBe(true);
        expect(handle.explanations).toEqual([
            {
                capability: "configReport",
                summary: "Skipped: the configAtHead resolver could not answer.",
                detail: [
                    "resolver reason: rateLimited",
                    "secondary rate limit on this installation",
                ],
            },
        ]);
    });

    /** The closed-item guard is the platform's: the capability is never woken (D59). */
    it("is never woken for a merged pull request, and never asks", async () => {
        const unreachable: ResolverSource = () => {
            throw new Error("closure is read before the resolver");
        };

        const decision = await decide(
            { kind: "facts", facts: pullRequest({ closedBy: "merged" }) as Facts },
            enabled(),
            [toEngine(configReport)],
            externals(unreachable),
        );

        expect(decision.approved).toEqual([]);
        expect(decision.report.findings).toEqual([]);
    });

    it("asks the configAtHead resolver, once, about the pull request it was given", async () => {
        const asked: { query: string; input: unknown }[] = [];
        const recording: ResolverSource = async (query, input) => {
            asked.push({ query, input });
            return { ok: true, value: { touched: false } } as never;
        };
        const { facts, platform } = probe(recording);

        await configReport.evaluate(facts, view(), platform);

        expect(asked).toEqual([{ query: "configAtHead", input: { item: ITEM } }]);
    });

    /** The claims are the record's own: an open item claims `closed: false`. */
    it("asks for one managed comment on the observed pull request, claiming it is open", async () => {
        const { facts, platform } = probe(proposing(CLEAN));

        const intents = await configReport.evaluate(facts, view(), platform);

        expect(intents).toEqual([
            {
                capability: "configReport",
                repository: REPOSITORY,
                item: ITEM,
                operation: "postManagedComment",
                desired: { kind: "summary", body: expect.any(String) },
                claims: { meaningsPresent: [], meaningsAbsent: [], closed: false },
                cause: { cause: "pullRequestChangesConfiguration", observedAt: OBSERVED_AT },
                explanation: {
                    capability: "configReport",
                    summary: "Reported what this pull request's automations.yml would mean.",
                    detail: [`proposed configuration read at revision ${REVISION}`],
                },
                grace: null,
                idempotencyKey: expect.any(String),
            },
        ]);
    });

    /** The explanation is what a reader sees without opening the comment. */
    it("counts the errors in the explanation when the proposed file is rejected", async () => {
        const { facts, platform } = probe(proposing(CASCADE));

        const intents = await configReport.evaluate(facts, view(), platform);

        expect(intents[0]?.explanation).toEqual({
            capability: "configReport",
            summary: "Reported what this pull request's automations.yml would mean.",
            detail: [`proposed configuration read at revision ${REVISION}`],
        });
    });

    it("renders a clean file as its mode, every enabled capability's settings, and the mappings", async () => {
        expect(await bodyFor(CLEAN)).toBe(
            [
                "### `automations.yml` — what this pull request would mean",
                "",
                `The file at \`${REVISION}\` parses. This is what the App would read from it.`,
                "",
                "**Mode** — active",
                "",
                "**Capabilities**",
                "",
                "- intake — on",
                "  - announce: true",
                "  - unlockWhen: none",
                "  - confirmUnlock: false",
                "  - labels it may set",
                "    - status: triage — awaitingTriage; defined #fbca04 if the repository lacks it",
                // `enabled: true` and nothing else, so every check is parked.
                "- prDashboard — on",
                "  - checks",
                "    - dcoSignoff",
                "      - enabled: false",
                "    - gpgSignature",
                "      - enabled: false",
                "    - mergeConflicts",
                "      - enabled: false",
                "    - linkedIssues",
                "      - enabled: false",
                "  - applyLabels: none",
                "  - labels it may set",
                "    - status: needs revision — needsRevision; defined #d93f0b if the repository lacks it",
                "    - status: needs review — needsReview; defined #5319e7 if the repository lacks it",
                "",
                "Switched off: inactivity.",
                "",
                "**Mappings**",
                "",
                "- labels",
                "  - awaitingTriage: status: triage",
                "  - ready: status: ready",
                "  - inProgress: status: in progress",
                "  - needsReview: status: needs review",
                "  - needsRevision: status: needs revision",
                "  - readyToMerge: status: ready to merge",
                "  - blocked: status: blocked",
                "",
                "**Principals**",
                "",
                "- maintainerTeam: hiero-sdk-js-maintainers",
                "",
                "Read on the default branch, this changes nothing until it merges.",
            ].join("\n"),
        );
    });

    /** A capability whose spec admits nothing says so on its own line. */
    it("renders a keyless capability as on with no settings, and skips the empty sections", async () => {
        expect(await bodyFor(SPARSE)).toBe(
            [
                "### `automations.yml` — what this pull request would mean",
                "",
                `The file at \`${REVISION}\` parses. This is what the App would read from it.`,
                "",
                "**Mode** — dry-run",
                "",
                "**Capabilities**",
                "",
                "- configReport — on, no settings",
                "",
                "**Mappings**",
                "",
                "- labels",
                "  - awaitingTriage: status: triage",
                "  - ready: status: ready",
                "  - inProgress: status: in progress",
                "  - needsReview: status: needs review",
                "  - needsRevision: status: needs revision",
                "  - readyToMerge: status: ready to merge",
                "  - blocked: status: blocked",
                "",
                "Read on the default branch, this changes nothing until it merges.",
            ].join("\n"),
        );
    });

    /** Every capability the file switched off, on one line, in the file's own order. */
    it("names each switched-off capability, separated for a reader", async () => {
        const body = await bodyFor(`schemaVersion: 2
mode: active

capabilities:
  configReport:
    enabled: true
  prDashboard:
    enabled: false
  intake:
    enabled: false
`);

        expect(body).toContain("Switched off: prDashboard, intake.");
    });

    it("renders a rejected file as line, path and message in document order", async () => {
        const body = await bodyFor(CASCADE);
        const errors = body.split("\n").filter((row) => row.startsWith("- line "));

        expect(errors).toEqual([
            '- line 7 — capabilities.intake.annouce: capability "intake": unknown setting "annouce" \\(it declares: announce, confirmUnlock, unlockWhen\\)',
            '- line 10 — capabilities.inactivity.remindAfter: must be a duration: a whole number of hours or days, written "4h" or "14d"',
        ]);
        expect(body).toContain("the App would read no configuration from it at all");
    });

    /** D147's recorded limit, rendered: five errors, two mistakes. */
    it("collapses the cascade into one trailing line and counts what it collapsed", async () => {
        const result = parsed(CASCADE);
        expect(result.ok ? [] : result.errors).toHaveLength(5);

        expect(await bodyFor(CASCADE)).toContain("  - and 3 places that inherit it");
    });

    it("renders every file-derived string inert", async () => {
        const hostile = `schemaVersion: 2
mode: observe

mappings:
  labels:
    awaitingTriage: "@everyone <!-- hiero-automation:x --> *now*"
  alerts:
    p0: "[click](http://evil)"

principals:
  maintainerTeam: "@here"
`;
        const body = await bodyFor(hostile);

        // Every active character escaped, and no `@` left able to notify.
        expect(body).toContain(
            "  - awaitingTriage: @\u200beveryone \\<\\!-- hiero-automation:x --\\> \\*now\\*",
        );
        expect(body).toContain("  - p0: \\[click\\]\\(http://evil\\)");
        expect(body).toContain("- maintainerTeam: @\u200bhere");
        expect(body).not.toMatch(/@[a-z]/);
        expect(body).not.toContain("<!--");
    });

    it("renders a hostile capability setting inert", () => {
        const body = renderConfiguration("sha256:hostile", {
            revision: "sha256:hostile",
            schemaVersion: 1,
            mode: "observe",
            capabilities: {
                sample: {
                    enabled: true,
                    settings: { guide: "@everyone [click](http://evil) <!-- marker -->" },
                },
            },
            mappings: { labels: {}, commands: {}, skills: {}, alerts: {} },
            principals: {},
        });

        expect(body).toContain(
            "guide: @\u200beveryone \\[click\\]\\(http://evil\\) \\<\\!-- marker --\\>",
        );
        expect(body).not.toMatch(/@[a-z]/);
        expect(body).not.toContain("<!--");
    });

    /** A refused key reaches only the message that quotes it back. */
    it("renders a hostile key inert inside the message that quotes it", async () => {
        const body = await bodyFor(`schemaVersion: 1
mappings:
  alerts:
    "@everyone *now*": "P0"
`);

        expect(body).toContain('"@\u200beveryone \\*now\\*" is not a valid name');
        expect(body).not.toMatch(/@[a-z]/);
    });

    it("renders a deleted file as the parser's own no-file result", async () => {
        const empty = parseConfigDocument("", {
            revision: "sha256:absent",
            knownCapabilities: KNOWN,
        });

        expect(renderReport("sha256:absent", empty)).toContain(
            "- none — this file enables no capability",
        );
        expect(renderReport("sha256:absent", empty)).toContain("**Mode** — observe");
        expect(renderReport("sha256:absent", empty)).toContain(
            "  - awaitingTriage: status: triage",
        );
    });

    /** The comment behind the mode ladder, with no exemption (`design.md`). */
    it("names the comment as wouldApply under dry-run, and approves nothing", async () => {
        const rehearsal = parseConfig(
            {
                schemaVersion: 1,
                mode: "dry-run",
                capabilities: { configReport: { enabled: true } },
            },
            { revision: "rev-rehearsal", knownCapabilities: [configReportDeclaration] },
        );
        if (!rehearsal.ok) throw new Error("the rehearsal configuration is invalid");

        const decision = await decide(
            { kind: "facts", facts: pullRequest({}) as Facts },
            rehearsal.config,
            [toEngine(configReport)],
            externals(proposing(CLEAN)),
        );

        expect(decision.approved).toEqual([]);
        expect(
            decision.report.findings
                .filter((finding) => finding.code === "wouldApply")
                .map((finding) => finding.subject),
        ).toEqual([
            {
                kind: "effect",
                capability: "configReport",
                item: ITEM,
                operation: "postManagedComment",
            },
        ]);
    });

    /** The renderer is total over whatever the resolver's answer carried. */
    it("renders lists, written absences and values no spec produces yet", () => {
        const body = renderConfiguration("sha256:shape", {
            revision: "sha256:shape",
            schemaVersion: 1,
            mode: "observe",
            capabilities: {
                sample: {
                    enabled: true,
                    settings: {
                        exemptWhen: ["blocked", "ready"],
                        capIgnores: [],
                        guide: null,
                        oddity: { toString: () => "*deep*" },
                        nested: [{ deep: true }],
                    },
                },
            },
            mappings: { labels: {}, commands: {}, skills: {}, alerts: {} },
            principals: {},
        });

        expect(body).toContain("  - exemptWhen: blocked, ready");
        expect(body).toContain("  - capIgnores: none");
        expect(body).toContain("  - guide: unset");
        // An object is a level whatever it holds, so `oddity` heads one.
        expect(body).toContain("  - oddity");
        // A list entry is the one place a non-scalar reaches the scalar arm.
        expect(body).toContain("  - nested: \\[object Object\\]");
        expect(body).toContain("**Mappings** — none.");
    });

    /** The three ranks of `ConfigError`, in the order a reader meets them. */
    it("orders whole-document problems first and unplaceable paths last", () => {
        const body = renderRejection("sha256:order", [
            { code: "settingInvalid", message: "fourth", path: "capabilities.x.y" },
            { code: "meaningRequired", message: "fifth", path: "mappings.labels.ready" },
            { code: "modeInvalid", message: "third", path: "mode", line: 4 },
            { code: "duplicateKey", message: "first", path: null },
            { code: "documentUnparseable", message: "second", path: null },
        ]);

        // Equal rank keeps the parser's own order.
        expect(body.split("\n").filter((row) => row.startsWith("- "))).toEqual([
            "- first",
            "- second",
            "- line 4 — mode: third",
            "- capabilities.x.y: fourth",
            "- mappings.labels.ready: fifth",
        ]);
    });

    /** The rejected body whole: one error, so no trailing collapse line. */
    it("pins the rejected body: the heading, the paragraph, the one line and the footer", () => {
        const body = renderRejection("sha256:one", [
            {
                code: "modeInvalid",
                message: 'mode: must be "observe", "dry-run" or "active"',
                path: "mode",
                line: 2,
            },
        ]);

        expect(body).toBe(
            [
                "### `automations.yml` — what this pull request would mean",
                "",
                "The file at `sha256:one` is rejected, so the App would read no configuration " +
                    "from it at all — one error anywhere rejects the whole document.",
                "",
                '- line 2 — mode: must be "observe", "dry-run" or "active"',
                "",
                "Read on the default branch, this changes nothing until it merges.",
            ].join("\n"),
        );
    });

    /** The cascade is the inheritance the settings walk, not a shared prefix. */
    it("keeps two capabilities whose names share a prefix as two mistakes", () => {
        const clock = (path: string, line: number): ConfigError => ({
            code: "settingInvalid",
            message: `${path}: must be a duration`,
            path,
            line,
        });
        const body = renderRejection("sha256:siblings", [
            clock("capabilities.ab.remindAfter", 4),
            clock("capabilities.abc.remindAfter", 8),
        ]);

        expect(body.split("\n").filter((row) => row.trim().startsWith("- "))).toEqual([
            "- line 4 — capabilities.ab.remindAfter: must be a duration",
            "- line 8 — capabilities.abc.remindAfter: must be a duration",
        ]);
    });

    /** Placed errors read in line order, whatever order the parser reported them. */
    it("sorts the placed errors by their own line numbers", () => {
        const body = renderRejection("sha256:lines", [
            { code: "settingInvalid", message: "later", path: "capabilities.b.x", line: 9 },
            { code: "settingInvalid", message: "earlier", path: "capabilities.a.y", line: 4 },
        ]);

        expect(body.split("\n").filter((row) => row.trim().startsWith("- "))).toEqual([
            "- line 4 — capabilities.a.y: earlier",
            "- line 9 — capabilities.b.x: later",
        ]);
    });

    /** The path is stripped because the error carries it, not because the text opens like one. */
    it("prints a pathless message whole, even where it opens like a path", () => {
        const body = renderRejection("sha256:pathless", [
            { code: "duplicateKey", message: "null: duplicate key in this document", path: null },
        ]);

        expect(body.split("\n").filter((row) => row.trim().startsWith("- "))).toEqual([
            "- null: duplicate key in this document",
        ]);
    });

    /** A cascade three levels deep is one mistake, and folds into its outermost error. */
    it("folds a three-level cascade into the error every level inherits from", () => {
        const clock = (path: string, line: number): ConfigError => ({
            code: "settingInvalid",
            message: `${path}: must be set to a duration`,
            path,
            line,
        });
        const body = renderRejection("sha256:deep", [
            clock("capabilities.x.remindAfter", 3),
            clock("capabilities.x.a.remindAfter", 5),
            clock("capabilities.x.a.b.remindAfter", 7),
        ]);

        expect(body.split("\n").filter((row) => row.trim().startsWith("- "))).toEqual([
            "- line 3 — capabilities.x.remindAfter: must be set to a duration",
            "  - and 2 places that inherit it",
        ]);
    });

    it("bounds a large rejection and reports how many errors it left out", () => {
        const errors = Array.from({ length: 250 }, (_, index): ConfigError => ({
            code: "settingInvalid",
            message: `${"x".repeat(1_000)} @everyone <!-- marker -->`,
            path: `capabilities.sample.value${String(index)}`,
            line: index + 1,
        }));

        const body = renderRejection("sha256:many", errors);

        expect(body.length).toBeLessThanOrEqual(12_000);
        expect(new TextEncoder().encode(body).length).toBeLessThan(65_536);
        expect(body).toContain("150 more errors not shown");
        expect(body).toContain("Report shortened to fit in a GitHub comment");
        expect(
            body.endsWith("Read on the default branch, this changes nothing until it merges."),
        ).toBe(true);
        expect(body).not.toMatch(/@[a-z]/);
        expect(body).not.toContain("<!--");
    });

    it("bounds a large accepted configuration", () => {
        const alerts = Object.fromEntries(
            Array.from({ length: 200 }, (_, index) => [
                `alert${String(index)}`,
                `${"漢".repeat(100)}${String(index)}`,
            ]),
        );
        const body = renderConfiguration("sha256:large", {
            revision: "sha256:large",
            schemaVersion: 1,
            mode: "observe",
            capabilities: {},
            mappings: { labels: {}, commands: {}, skills: {}, alerts },
            principals: {},
        });

        expect(body.length).toBeLessThanOrEqual(12_000);
        expect(new TextEncoder().encode(body).length).toBeLessThan(65_536);
        expect(body).toContain("Report shortened to fit in a GitHub comment");
        expect(
            body.endsWith("Read on the default branch, this changes nothing until it merges."),
        ).toBe(true);
    });

    /** A hand-built block: the labels a capability may set render on the default spelling when nothing is mapped (D204). */
    it("names the labels a capability may set, at the default spelling when none is mapped", () => {
        const body = renderConfiguration("sha256:labels", {
            revision: "sha256:labels",
            schemaVersion: 2,
            mode: "active",
            capabilities: {
                intake: { enabled: true, settings: {}, labels: ["awaitingTriage"] },
                configReport: { enabled: true, settings: {} },
            },
            mappings: { labels: {}, commands: {}, skills: {}, alerts: {} },
            principals: {},
        });

        expect(body).toContain(
            [
                "- intake — on",
                "  - labels it may set",
                "    - status: triage — awaitingTriage; defined #fbca04 if the repository lacks it",
                "- configReport — on, no settings",
            ].join("\n"),
        );
    });

    /** The narrow shape again, with the three lists the trigger implies filled in. */
    it("declares one event trigger, one resolver, one comment and no group", () => {
        expect(configReport.declaration).toEqual({
            name: "configReport",
            triggers: [{ kind: "event", event: "pull_request" }],
            settings: CONFIG_REPORT_SETTINGS,
            requiredMappings: {},
            labels: [],
            facts: ["pullRequest"],
            needs: [],
            resolvers: ["configAtHead"],
            intents: ["postManagedComment"],
        });
    });

    /** The negative control: the declaration's spec admits nothing at all. */
    it("declares no settings keys for a repository to supply", () => {
        expect(Object.keys(configReport.declaration.settings)).toEqual([]);
    });
});
