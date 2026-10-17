/**
 * What every shipped capability decides on every captured delivery: one config enabling that
 * capability alone, one cell per capture. A cell absent from `JOURNEYS` asserts that nothing was
 * decided. One definition, read by the runtime's matrices and by the lab's action rehearsal.
 */

/** One decision row, as the store keeps it, without the pass it belongs to. */
export interface Row {
    readonly capability: string;
    readonly verdict: string;
    readonly code: string | null;
}

/** The capabilities block enabling one capability alone; the shell adds the rest of the file. */
export const CONFIGS: Readonly<Record<string, string>> = {
    triageQueue: `  triageQueue:
    enabled: true
    welcome: true
`,
    prDashboard: `  prDashboard:
    enabled: true
    checks:
      mergeConflicts:
        enabled: true
`,
    inactivity: `  inactivity:
    enabled: true
    issues:
      enabled: true
    pullRequests:
      enabled: true
`,
    configReport: `  configReport:
    enabled: true
`,
    assignment: `  assignment:
    enabled: true
    autoAssign:
      enabled: true
    unassign:
      enabled: true
`,
};

const explained = (capability: string): Row => ({
    capability,
    verdict: "info",
    code: "capabilityExplained",
});
const wouldApply = (capability: string): Row => ({
    capability,
    verdict: "info",
    code: "wouldApply",
});
const recordsOnly = (capability: string): Row => ({
    capability,
    verdict: "notice",
    code: "modeRecordsOnly",
});

/** One dry-run effect: explained, would apply, recorded only. */
const effect = (capability: string): Row[] => [
    explained(capability),
    wouldApply(capability),
    recordsOnly(capability),
];

/** Sorted as the harness sorts: capability, verdict, code. */
const effects = (capability: string, count: number): Row[] =>
    Array.from({ length: count }, () => effect(capability))
        .flat()
        .sort((a, b) => `${a.verdict}${a.code}`.localeCompare(`${b.verdict}${b.code}`));

/** The whole config file for one capability enabled alone, in dry-run unless `mode` says otherwise. */
export const configFor = (capability: string, mode = "dry-run"): string => `schemaVersion: 2
mode: ${mode}
capabilities:
${CONFIGS[capability] ?? ""}mappings:
  labels:
    awaitingTriage: "status: triage"
  commands:
    assign: /assign
    unassign: /unassign
    working: /working
`;

export const JOURNEYS: Readonly<Record<string, Readonly<Record<string, readonly Row[]>>>> = {
    /** On open: the awaitingTriage label and the welcome, nothing on any later event. */
    triageQueue: { "issues.opened.json": effects("triageQueue", 2) },
    /** On open: the one dashboard comment; a merged pull request is left alone. */
    prDashboard: { "pull_request.opened.json": effects("prDashboard", 1) },
    /** Runs on the schedule alone; no webhook moves it. */
    inactivity: {},
    /** On open of a pull request touching the file: the one report comment. */
    configReport: { "pull_request.opened.json": effects("configReport", 1) },
    /** Hears comments alone, and the captured one issues no command. */
    assignment: {},
};
