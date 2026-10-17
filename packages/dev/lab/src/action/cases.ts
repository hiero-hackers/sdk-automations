/**
 * What the action rehearsal provokes for each capability, and the cell it expects: one case per
 * config in the shared table, the captures in provocation order, the pull-request pair only
 * where the capability hears pull requests. Data; `run.ts` acts on it.
 */

import { CONFIGS, configFor, JOURNEYS, type Row } from "@hiero-hackers/automation-testkit";

export type { Row };

/** The label `configFor` maps as awaitingTriage. */
export const TRIAGE_LABEL = "status: triage";

/** A comment that is a command to no capability. */
export const COMMENT_BODY = "Temporary comment for the action rehearsal.";

/** What the person does to cause one capture. */
export type Action =
    | { readonly kind: "open" }
    | { readonly kind: "label"; readonly name: string }
    | { readonly kind: "comment"; readonly body: string }
    | { readonly kind: "close" }
    | { readonly kind: "openPull"; readonly editsConfig: boolean }
    | { readonly kind: "closePull" };

export interface EventCase {
    readonly capture: string;
    readonly action: Action;
    /** The workflow events whose runs the step waits for. */
    readonly raises: readonly string[];
    readonly expected: readonly Row[];
}

export interface Case {
    readonly capability: string;
    /** The dry-run file enabling the capability alone. */
    readonly config: string;
    readonly events: readonly EventCase[];
}

/** The capabilities that hear pull requests; the others get the issue captures alone. */
export const PULL_REQUEST_LISTENERS: ReadonlySet<string> = new Set(["prDashboard", "configReport"]);

/** The capability whose pull request must touch the config file. */
const EDITS_CONFIG = "configReport";

type Provocation = Omit<EventCase, "expected">;

const ISSUE_EVENTS: readonly Provocation[] = [
    { capture: "issues.opened.json", action: { kind: "open" }, raises: ["issues"] },
    {
        capture: "issues.labeled.json",
        action: { kind: "label", name: TRIAGE_LABEL },
        raises: ["issues"],
    },
    {
        capture: "issue_comment.created.json",
        action: { kind: "comment", body: COMMENT_BODY },
        raises: ["issue_comment"],
    },
    { capture: "issues.closed.json", action: { kind: "close" }, raises: ["issues"] },
];

const pullEvents = (editsConfig: boolean): Provocation[] => [
    {
        capture: "pull_request.opened.json",
        action: { kind: "openPull", editsConfig },
        raises: ["pull_request_target"],
    },
    {
        capture: "pull_request.closed.json",
        action: { kind: "closePull" },
        raises: ["pull_request_target"],
    },
];

/** The six captures in provocation order. */
export const CAPTURE_ORDER: readonly string[] = [...ISSUE_EVENTS, ...pullEvents(false)].map(
    (event) => event.capture,
);

const caseFor = (capability: string): Case => ({
    capability,
    config: configFor(capability),
    events: [
        ...ISSUE_EVENTS,
        ...(PULL_REQUEST_LISTENERS.has(capability) ? pullEvents(capability === EDITS_CONFIG) : []),
    ].map((event) => ({ ...event, expected: JOURNEYS[capability]?.[event.capture] ?? [] })),
});

export const CASES: readonly Case[] = Object.keys(CONFIGS).map(caseFor);
