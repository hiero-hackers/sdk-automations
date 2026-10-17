/**
 * The run's job summary: what one Action run decided, item by item, as markdown, with the
 * workflow commands that surface an effect, a failure or a lowered mode on the run page, and
 * one machine-readable line per decision row for a reader of the log.
 */

import { appendFileSync } from "node:fs";
import type { ItemRef, RepositoryRef } from "@hiero-hackers/automation-core";
import type { RunOutcome } from "../compose/action.js";
import type { EffectOutcome, EffectOutcomeName } from "../effects.js";
import type { ShellEvent } from "../log.js";
import { standing } from "./explain.js";
import type { Store } from "../../store/index.js";

/** What names the run in its heading. */
export interface SummaryRun {
    readonly repository: RepositoryRef;
    readonly eventName: string;
    readonly runUrl: string | null;
}

const LOWERED =
    "The configuration asked for `active`; it was decided as `dry-run` because the workflow did not arm writes.";

/** One table cell: backslashes first, then the pipe, so no input can close the cell. */
export const cell = (value: string | number | null): string =>
    value === null || value === ""
        ? "-"
        : String(value).replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\s+/g, " ");

const row = (cells: readonly (string | number | null)[]): string =>
    `| ${cells.map(cell).join(" | ")} |`;

const table = (head: readonly string[], rows: readonly string[]): string[] => [
    row(head),
    row(head.map(() => "---")),
    ...rows,
    "",
];

const spelled = (item: ItemRef): string => `${item.kind}#${String(item.number)}`;

/** The items once each, in the order they were decided. */
function distinct(items: readonly ItemRef[]): ItemRef[] {
    const seen = new Set<string>();
    return items.filter((item) => !seen.has(spelled(item)) && seen.add(spelled(item)));
}

/** The events that made the run exit non-zero. */
function failures(events: readonly ShellEvent[]): ShellEvent[] {
    return events.filter(
        (event) =>
            event.event === "deliveryAttemptFailed" ||
            event.event === "deliveryDeadLettered" ||
            event.event === "sweepFailed" ||
            (event.event === "deliveryCompleted" && event.kind === "repositoryMismatch"),
    );
}

const detailOf = (event: ShellEvent): string =>
    "detail" in event && typeof event.detail === "string" ? event.detail : "";

const named = (event: ShellEvent): string =>
    event.event === "deliveryCompleted" ? `${event.event} (${event.kind})` : event.event;

/** One item's heading and tables, or nothing when no decision and no effect names it. */
function itemSection(store: Store, repository: RepositoryRef, item: ItemRef): string[] {
    const decisions = store.ledger.decisionsOn(repository, item);
    const effects = store.ledger.effectsOn(repository, item);
    if (decisions.length === 0 && effects.length === 0) return [];
    return [
        `### ${spelled(item)}`,
        "",
        ...table(
            ["capability", "verdict", "code", "detail"],
            decisions.map(({ capability, verdict, code, detail }) =>
                row([capability, verdict, code, detail]),
            ),
        ),
        ...table(
            ["effect", "stands"],
            effects.map((effectId) => row([effectId, standing(store, effectId)])),
        ),
    ];
}

export function renderSummary(store: Store, run: SummaryRun, outcome: RunOutcome): string {
    const { owner, repo } = run.repository;
    const link = run.runUrl === null ? "" : ` ([run](${run.runUrl}))`;
    const lines = [`## ${owner}/${repo}: ${run.eventName} (${outcome.kind})${link}`, ""];
    if (outcome.modeLowered) lines.push(LOWERED, "");
    const sections = distinct(outcome.items).map((item) =>
        itemSection(store, run.repository, item),
    );
    const silent = sections.filter((section) => section.length === 0).length;
    lines.push(...sections.flat());
    if (silent > 0) lines.push(`Items decided with no rows: ${String(silent)}.`, "");
    const [cause] = failures(outcome.events);
    if (outcome.exitCode !== 0 && cause !== undefined) {
        const detail = detailOf(cause);
        lines.push(
            `The run exited non-zero: \`${named(cause)}\`${detail === "" ? "" : `, ${detail}`}.`,
        );
    }
    return `${lines.join("\n")}\n`;
}

/** A workflow command: `%`, CR and LF are the three characters the runner decodes in a message. */
const command = (level: "notice" | "warning", message: string): string =>
    `::${level}::${message.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A")}`;

/** The outcomes worth a line in the log, and how loud each is. */
const LEVEL: Partial<Record<EffectOutcomeName, "notice" | "warning">> = {
    applied: "notice",
    refused: "warning",
};

const effectLine = (effect: EffectOutcome): string =>
    `${effect.capability} ${effect.operation} ${spelled(effect.item)} ${effect.outcome}` +
    (effect.code === null ? "" : ` ${effect.code}`);

/** One command per applied or refused effect and per failure, and one notice when the mode was lowered. */
export function annotations(outcome: RunOutcome): string[] {
    const detail = (event: ShellEvent): string =>
        detailOf(event) === "" ? "" : ` ${detailOf(event)}`;
    return [
        ...(outcome.modeLowered ? [command("notice", LOWERED)] : []),
        ...outcome.effects.flatMap((effect) => {
            const level = LEVEL[effect.outcome];
            return level === undefined ? [] : [command(level, effectLine(effect))];
        }),
        ...failures(outcome.events).map((event) =>
            command("warning", `${named(event)}${detail(event)}`),
        ),
    ];
}

/** What a reader of the log greps for; the compact JSON after it is one decision row. */
export const ROW_MARKER = "sdk-automations.row";

/** One line per decision row on every item the run decided, in the order the store holds them. */
export function rowLines(store: Store, repository: RepositoryRef, outcome: RunOutcome): string[] {
    return distinct(outcome.items).flatMap((item) =>
        store.ledger.decisionsOn(repository, item).map(({ capability, verdict, code, detail }) => {
            const row = { item: { kind: item.kind, number: item.number }, capability, verdict };
            return `${ROW_MARKER} ${JSON.stringify({ ...row, code, detail })}`;
        }),
    );
}

/** Appends to the step summary file when the runner names one. */
export function appendSummary(path: string | undefined, text: string): void {
    if (path === undefined || path === "") return;
    appendFileSync(path, text);
}
