/**
 * The action rehearsal's judgements: how the rows a step's runs printed differ from the cell the
 * table expects, and what GitHub read back that a dry-run must not have written. Pure, so the
 * live verdicts are tested.
 */

import type { ItemRef } from "@hiero-hackers/automation-core";
import type { Row } from "./cases.js";

/** One decision row as the Action printed it to the log. */
export interface LogRow extends Row {
    readonly item: ItemRef;
    readonly detail: string | null;
}

/** One event on an item's timeline, as GitHub lists it. */
export interface TimelineEvent {
    readonly event: string;
    readonly actor: string | null;
    readonly at: string | null;
}

/** The login the Action's runs write as; a dry-run leaves nothing under it. */
export const ACTION_LOGIN = "github-actions[bot]";

const spelled = (item: ItemRef): string => `${item.kind}#${String(item.number)}`;

const named = (row: Row): string => `${row.capability} ${row.verdict} ${row.code ?? "-"}`;

/** Sorted as the matrix sorts: capability, verdict, code. */
export function sorted<T extends Row>(rows: readonly T[]): T[] {
    return [...rows].sort((a, b) =>
        `${a.capability}${a.verdict}${a.code}`.localeCompare(
            `${b.capability}${b.verdict}${b.code}`,
        ),
    );
}

/** Each way the rows differ from the cell: a row about another item, a row missing, a row unexpected. */
export function rowDifferences(
    item: ItemRef,
    expected: readonly Row[],
    found: readonly LogRow[],
): string[] {
    const elsewhere = found.filter((row) => spelled(row.item) !== spelled(item));
    const differences = elsewhere.map(
        (row) => `a row about ${spelled(row.item)}, not ${spelled(item)}: ${named(row)}`,
    );
    const unmatched = sorted(found.filter((row) => !elsewhere.includes(row))).map(named);
    for (const row of sorted(expected)) {
        const at = unmatched.indexOf(named(row));
        if (at === -1) differences.push(`missing: ${named(row)}`);
        else unmatched.splice(at, 1);
    }
    return [...differences, ...unmatched.map((name) => `unexpected: ${name}`)];
}

/** Every event by the Action on the item since the step began: in dry-run, each one is a write. */
export function readBackDifferences(
    events: readonly TimelineEvent[],
    since: string,
    login = ACTION_LOGIN,
): string[] {
    return events
        .filter((event) => event.actor === login)
        .filter((event) => event.at === null || Date.parse(event.at) >= Date.parse(since))
        .map((event) => `${login} ${event.event} at ${event.at ?? "an unknown time"}`);
}
