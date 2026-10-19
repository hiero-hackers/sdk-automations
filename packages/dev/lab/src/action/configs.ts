/**
 * The config texts the protocols switch the sandbox to: a named set of capability blocks from
 * the shared table, and the one file that enables every capability with clocks short enough to
 * run in an afternoon. The harness copy of the full file wins where it exists.
 */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CONFIGS } from "@hiero-hackers/automation-testkit";
import { TRIAGE_LABEL } from "./cases.js";

export const READY_LABEL = "status: ready for dev";

export const NEEDS_REVIEW_LABEL = "status: needs review";

export const NEEDS_REVISION_LABEL = "status: needs revision";

export const BLOCKED_LABEL = "status: blocked";

/** Every label the full file maps. */
export const MAPPED_LABELS: readonly string[] = [
    TRIAGE_LABEL,
    READY_LABEL,
    NEEDS_REVIEW_LABEL,
    NEEDS_REVISION_LABEL,
    BLOCKED_LABEL,
];

const TRIAGE_MAPPINGS = `mappings:
  labels:
    awaitingTriage: "${TRIAGE_LABEL}"
    ready: "${READY_LABEL}"
  commands:
    assign: /assign
    unassign: /unassign
    working: /working
`;

/** One file enabling the named capabilities from the shared table, with the triage mappings. */
export function configOf(mode: string, names: readonly string[]): string {
    const blocks = names.map((name) => CONFIGS[name] ?? "").join("");
    return `mode: ${mode}\ncapabilities:\n${blocks}${TRIAGE_MAPPINGS}`;
}

/** Triage with the welcome, the lock until triaged and its confirmed release. */
export const LOCKING_TRIAGE = `  triageQueue:
    enabled: true
    welcome: true
    lockUntilTriaged: true
    confirmUnlock: true
`;

/** The warning-then-act ladder on assigned issues, the reminder at once and the act two hours on. */
export const SHORT_LADDER = `  inactivity:
    enabled: true
    remindAfter: 0h
    reap:
      after: 2h
    issues:
      enabled: true
      reap:
        enabled: true
`;

/** How long after its warning the short ladder acts. */
export const SHORT_GRACE_MS = 2 * 60 * 60_000;

/** configReport held at dry-run by its own block, whatever the file's mode is. */
const HELD_REPORT = `  configReport:
    enabled: true
    mode: dry-run
`;

/** An active file: prDashboard inherits `active`, configReport's block holds it at `dry-run`. */
export function heldConfig(): string {
    return `mode: active\ncapabilities:\n${CONFIGS["prDashboard"] ?? ""}${HELD_REPORT}${TRIAGE_MAPPINGS}`;
}

export function lockingConfig(mode: string): string {
    return `mode: ${mode}\ncapabilities:\n${LOCKING_TRIAGE}${TRIAGE_MAPPINGS}`;
}

export function ladderConfig(mode: string): string {
    return `mode: ${mode}\ncapabilities:\n${SHORT_LADDER}${TRIAGE_MAPPINGS}`;
}

const FULL = `mode: active

capabilities:
  triageQueue:
    enabled: true
    welcome: true
    lockUntilTriaged: true
    confirmUnlock: true

  prDashboard:
    enabled: true
    checks:
      dcoSignoff:
        enabled: true
      gpgSignature:
        enabled: true
      mergeConflicts:
        enabled: true
      linkedIssues:
        enabled: true
        assignedIssues:
          enabled: true
    applyLabels: [needsRevision, needsReview]

  configReport:
    enabled: true

  inactivity:
    enabled: true
    remindAfter: 1h
    reap:
      after: 2h
    issues:
      enabled: true
      reap:
        enabled: true
    pullRequests:
      enabled: true
      reapWhen:
        draft:
          enabled: true
          reap:
            enabled: true
        needsRevision:
          enabled: true
          reap:
            enabled: true

  assignment:
    enabled: true
    autoAssign:
      enabled: true
      claimableOnlyWhen: [ready]
      notClaimableWhen: [blocked, awaitingTriage]
      capIgnores: [blocked]
      maxOpen: 2
    unassign:
      enabled: true

mappings:
  labels:
    awaitingTriage: "${TRIAGE_LABEL}"
    ready: "${READY_LABEL}"
    needsReview: "${NEEDS_REVIEW_LABEL}"
    needsRevision: "${NEEDS_REVISION_LABEL}"
    blocked: "${BLOCKED_LABEL}"
  commands:
    assign: "/assign"
    unassign: "/unassign"
    working: "/working"
  skills:
    goodFirstIssue: "good first issue"
`;

const HARNESS_COPY = fileURLToPath(
    new URL("../../harness/action/sandbox-full.yml", import.meta.url),
);

/** The harness file where it exists, else the inline copy. */
export function fullConfig(): string {
    return existsSync(HARNESS_COPY) ? readFileSync(HARNESS_COPY, "utf8") : FULL;
}
