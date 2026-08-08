/**
 * Where decisions land. In dry-run the report IS the product: the file
 * this sink appends is what a maintainer reads to see what the platform
 * WOULD have done — one JSON line per processed delivery.
 *
 * A sink, not a store table: the store's ratified four-table schema
 * (design/operations/storage-decision.md) stays untouched until a report
 * table is a decided need rather than a default.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { AnyIntent, ConfigError, Report } from "@hiero-hackers/automation-core";

interface RecordBase {
    readonly deliveryId: string;
    readonly event: string;
    readonly receivedAt: string;
    readonly decidedAt: string;
    readonly configRevision: string;
}

export type ShellRecord =
    | (RecordBase & {
          readonly kind: "decision";
          readonly report: Report;
          /** Empty outside `active` mode; recorded so the count is auditable. */
          readonly approved: readonly AnyIntent[];
      })
    | (RecordBase & {
          /** The config failed to parse. Fail-closed: nothing was decided. */
          readonly kind: "configRejected";
          readonly errors: readonly ConfigError[];
      });

export interface ReportSink {
    record(entry: ShellRecord): void;
}

export function fileReportSink(file: string): ReportSink {
    mkdirSync(dirname(file), { recursive: true });
    return {
        record(entry: ShellRecord): void {
            appendFileSync(file, `${JSON.stringify(entry)}\n`);
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
        record(entry: ShellRecord): void {
            entries.push(entry);
        },
    };
}
