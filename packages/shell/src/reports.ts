/**
 * The operator projection of canonical reports. The store commits the
 * authoritative JSON with delivery completion first; this file may append
 * those same bytes to JSONL for people and can be rebuilt from the store.
 */

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ConfigError, Report } from "@hiero-hackers/automation-core";
import type { CanonicalDeliveryReport } from "@hiero-hackers/automation-store";

interface RecordBase {
    readonly deliveryId: string;
    readonly event: string;
    readonly receivedAt: string;
    readonly decidedAt: string;
    readonly configRevision: string;
}

/** The canonical shell record persisted for one delivery. */
export type ShellRecord =
    | (RecordBase & {
          readonly kind: "decision";
          readonly report: Report;
      })
    | (RecordBase & {
          /** The config failed to parse. Fail-closed: nothing was decided. */
          readonly kind: "configRejected";
          readonly errors: readonly ConfigError[];
      })
    | (RecordBase & {
          /** The runnable shell has no external effect path. */
          readonly kind: "modeUnsupported";
          readonly reason: string;
      });

/** A derived projection that receives the already-persisted canonical JSON. */
export interface ReportSink {
    record(entry: ShellRecord, reportJson: string): void;
    rebuild(reports: readonly CanonicalDeliveryReport[]): void;
}

/** Append canonical reports to an operator-readable JSONL projection. */
export function fileReportSink(file: string): ReportSink {
    mkdirSync(dirname(file), { recursive: true });
    return {
        record(_entry: ShellRecord, reportJson: string): void {
            appendFileSync(file, `${reportJson}\n`);
        },
        rebuild(reports: readonly CanonicalDeliveryReport[]): void {
            writeFileSync(
                file,
                reports.length === 0
                    ? ""
                    : `${reports.map((report) => report.reportJson).join("\n")}\n`,
            );
        },
    };
}

/** For tests and drills: same contract, no filesystem. */
export function memoryReportSink(): ReportSink & {
    readonly entries: ShellRecord[];
} {
    const entries: ShellRecord[] = [];
    return {
        entries,
        record(entry: ShellRecord, _reportJson: string): void {
            entries.push(entry);
        },
        rebuild(reports: readonly CanonicalDeliveryReport[]): void {
            entries.splice(
                0,
                entries.length,
                ...reports.map((report) => JSON.parse(report.reportJson) as ShellRecord),
            );
        },
    };
}
