/**
 * The sweep driver: a due schedule row becomes one fact record per open item, and
 * each becomes one decision (sweep.md §2). This lane exists because nobody told us.
 * A firing is also the only thing that prunes: the three retention windows (D166).
 */

import {
    groupsNeeded,
    UNREAD,
    type EngineCapability,
    type FactGroup,
    type IssueFacts,
    type ItemRef,
    type NeededGroups,
    type PullRequestFacts,
    type RepositoryConfig,
    type RepositoryRef,
    type Unread,
} from "@hiero-hackers/automation-core";
import {
    decodeSnapshot,
    encodeSnapshot,
    snapshotAnswers,
    type ClaimedScheduleRow,
    type ItemSnapshot,
    type SnapshotFacts,
    type Store,
} from "../../store/index.js";
import type { Allowance, Spent } from "../allowance.js";
import { REVIEW_SETTLE_MS, SNAPSHOT_MAX_AGE_MS } from "./budgets.js";
import type { DecideItem, Decided } from "../decide/item.js";
import { repositoryOfScheduleId, SWEEP_EFFECT, wantsSweeping } from "../decide/schedule.js";
import { detailOf, type Log } from "../log.js";

// ─── The seams ───────────────────────────────────────────────────────

/**
 * One open item as the list carries it — the adapter's `OpenItem`, restated.
 * Restated rather than imported: only `main.ts` may name the adapter, and that is where the two shapes are checked against each other.
 */
export interface SweptItem {
    readonly item: ItemRef;
    readonly author: string;
    readonly labels: readonly string[];
    readonly assignees: readonly string[];
    readonly closedBy: string | null;
    readonly updatedAt: Date;
}

/** Every open item, or the reason the list is unusable. */
export type SweptItems =
    | { readonly ok: true; readonly items: readonly SweptItem[] }
    | { readonly ok: false; readonly detail: string };

/** What one pull request closes, as the reader answered it. */
export type SweptLinks = readonly ItemRef[] | Unread;

/** What the driver reads its records through — the adapter's `FactsReader`. */
export interface SweepFacts {
    openItems(): Promise<SweptItems>;
    linksFor(numbers: readonly number[]): Promise<ReadonlyMap<number, SweptLinks>>;
    /** `stored` fills the groups in place of the reads that made them, and sends nothing (D193). */
    issueFacts(
        listed: SweptItem,
        links: readonly ItemRef[] | Unread,
        stored?: Pick<IssueFacts, "assignees">,
    ): Promise<IssueFacts>;
    pullRequestFacts(
        listed: SweptItem,
        openIssues: readonly SweptItem[],
        closes: SweptLinks,
        stored?: Pick<PullRequestFacts, "assignees" | "links" | "review" | "readiness">,
    ): Promise<PullRequestFacts>;
}

/**
 * A reader built FRESH for each firing.
 * Never one for the process: it memoises each item's clocks for one sweep only.
 */
export type SweepFactsSource = (config: RepositoryConfig, groups: NeededGroups) => SweepFacts;

/** How ONE repository is swept: its reader, the shared box, and the file both lanes gate on. */
export interface SweepProcessor {
    configuration(): Promise<RepositoryConfig | null>;
    decideItem: DecideItem;
    facts: SweepFactsSource;
}

export interface SweepOptions {
    readonly store: Store;
    readonly capabilities: readonly EngineCapability[];
    /** One repository's processor; a due row's id names which (D169). */
    readonly processorFor: (repository: RepositoryRef, allowance: Allowance) => SweepProcessor;
    readonly clock: () => Date;
    /** How long until the next firing. sweep.md §2 step 4; the default is hourly. */
    readonly cadenceMs: number;
    /** How many writes one TICK may send; the default is `SWEEP_WRITE_CALLS` (D192). */
    readonly writeCap: number;
    /** One for the process: the share of GitHub's limits every firing spends from (D192). */
    readonly allowance: Allowance;
    /** How long a stored read may be decided from; the default is `SNAPSHOT_MAX_AGE_MS` (D193). */
    readonly snapshotMaxAgeMs?: number;
    /** The installation switch (D171): a firing reads nothing, and still prunes and re-arms. */
    readonly suspended?: boolean;
    readonly log: Log;
}

const DAY_MS = 24 * 60 * 60_000;

const NOTHING: Spent = { core: 0, graphql: 0, mutations: 0 };

/** What one firing spent: the allowance's lanes, before against after. */
const since = (before: Spent, after: Spent): Spent => ({
    core: after.core - before.core,
    graphql: after.graphql - before.graphql,
    mutations: after.mutations - before.mutations,
});

/** How long a done delivery and its report are kept — the deliveries API's own window (D166). */
export const DONE_DELIVERY_RETENTION_DAYS = 30;

/** How long a decision row is kept (D166). */
export const DECISION_RETENTION_DAYS = 30;

/** How long a settled effect's facts are kept (D166). */
export const SETTLED_EFFECT_RETENTION_DAYS = 90;

/** What the composition root holds: one tick, run whenever the clock says. */
export interface Sweep {
    /** Fire every due sweep row; overlapping calls share the pass already running. */
    runDue(): Promise<void>;
    /** The pass in flight, if any. What a shutdown joins, to free the schedule claim. */
    settled(): Promise<void>;
}

// ─── The driver ──────────────────────────────────────────────────────

/**
 * What one firing produced, for the line it ends with.
 * `unread` separates "nothing is stale" from "this sweep could not tell".
 * `writes` is what the cap spent and `heldBack` what it turned away (D167).
 */
interface Swept {
    readonly items: number;
    readonly decided: number;
    readonly unread: number;
    readonly writes: number;
    readonly heldBack: number;
    /** Items the allowance left for the next firing (D192). */
    readonly remaining: number;
    /** Where the next firing starts reading; null reads the list again from the beginning. */
    readonly resumeAfter: number | null;
    /** Items answered from their stored read rather than read again (D193). */
    readonly reused: number;
    /** What this repository spent of the allowance, per lane (D192). */
    readonly spent: Spent;
    /** This repository was left untouched for the next tick because the allowance was spent. */
    readonly deferred: boolean;
    /** This firing stopped before the end of its list; the next tick continues from the cursor. */
    readonly partial: boolean;
}

/**
 * A firing that read nothing — an unusable list, a suspension, or a repository that wants none.
 * The cursor is handed back as it stood: nothing was read, so nothing moved it.
 */
const nothingRead = (row: ClaimedScheduleRow, spent: Spent = NOTHING): Swept => ({
    items: 0,
    decided: 0,
    unread: 0,
    writes: 0,
    heldBack: 0,
    remaining: 0,
    resumeAfter: row.resumeAfter,
    reused: 0,
    spent,
    deferred: false,
    partial: false,
});

const deferred = (row: ClaimedScheduleRow, spent: Spent = NOTHING): Swept => ({
    ...nothingRead(row, spent),
    deferred: true,
});

/** How many of one item's effects the write cap turned away. */
const heldBackIn = (decided: Decided): number =>
    decided.kind === "decided"
        ? decided.outcomes.filter(
              (outcome) => outcome.code === "sweepRequestCap" || outcome.code === "sweepWriteCap",
          ).length
        : 0;

/**
 * What this firing may read: past the cursor, by number ascending (D170).
 * The allowance stops the walk over these; nothing here knows about it.
 */
function afterCursor(items: readonly SweptItem[], after: number | null): readonly SweptItem[] {
    return items
        .filter(({ item }) => after === null || item.number > after)
        .sort((left, right) => left.item.number - right.item.number);
}

/** What of a record is kept: the groups the read paid for, and the batch its links came from (D193). */
function storedOf(
    record: IssueFacts | PullRequestFacts,
    groups: readonly FactGroup[],
    closes: SweptLinks,
): SnapshotFacts {
    return record.kind === "issue"
        ? { kind: "issue", groups, assignees: record.assignees }
        : {
              kind: "pullRequest",
              groups,
              assignees: record.assignees,
              links: record.links,
              review: record.review,
              readiness: record.readiness,
              closes,
          };
}

/** Why a claimed row is handed straight back: no driver here, or no repository in its id. */
function undrivable(row: ClaimedScheduleRow): string {
    return row.effect === SWEEP_EFFECT
        ? `schedule "${row.scheduleId}" names no repository`
        : `schedule "${row.scheduleId}" carries the unknown effect "${row.effect}"`;
}

export function createSweep(options: SweepOptions): Sweep {
    const {
        store,
        capabilities,
        processorFor,
        clock,
        cadenceMs,
        writeCap,
        allowance,
        snapshotMaxAgeMs = SNAPSHOT_MAX_AGE_MS,
        suspended = false,
        log,
    } = options;

    const nextDue = (): string => new Date(clock().getTime() + cadenceMs).toISOString();

    /** Has a pool this firing reads from reached its cap? The mutation lane is not one. */
    const readsStalled = (): boolean => {
        const lane = allowance.exhausted();
        return lane === "core" || lane === "graphql";
    };

    /** What this repository's enabled capabilities need read, per kind (D195). */
    const groupsFor = (config: RepositoryConfig): NeededGroups => ({
        issue: groupsNeeded(config, capabilities, "issue"),
        pullRequest: groupsNeeded(config, capabilities, "pullRequest"),
    });

    /**
     * Does a stored read carry what this firing asks of it (D193)?
     * A pull request also owes the batch answer, because every issue's links are built from it.
     */
    const answers = (stored: SnapshotFacts, groups: NeededGroups): boolean =>
        snapshotAnswers(stored, groups[stored.kind]) &&
        (stored.kind === "issue" || !groups.issue.includes("links") || stored.closes !== UNREAD);

    /**
     * Does one stored read still stand for this item (D193)?
     * The list's own field unchanged, settled before the list was read, and read inside the age.
     */
    const stillStands = (snapshot: ItemSnapshot, listed: SweptItem, readAt: number): boolean =>
        snapshot.updatedAt === listed.updatedAt.toISOString() &&
        listed.updatedAt.getTime() < readAt - REVIEW_SETTLE_MS &&
        Date.parse(snapshot.readAt) > readAt - snapshotMaxAgeMs;

    /** Every listed item this firing may decide without reading it, and the rows nobody could read. */
    const standingReads = (
        repository: RepositoryRef,
        items: readonly SweptItem[],
        groups: NeededGroups,
        readAt: number,
    ): { readonly held: ReadonlyMap<number, SnapshotFacts>; readonly unreadable: number } => {
        const held = new Map<number, SnapshotFacts>();
        let unreadable = 0;
        for (const listed of items) {
            const snapshot = store.ledger.snapshotOf(repository, listed.item);
            if (snapshot === null || !stillStands(snapshot, listed, readAt)) continue;
            const stored = decodeSnapshot(snapshot.facts);
            if (stored === null) {
                unreadable += 1;
                continue;
            }
            if (stored.kind === listed.item.kind && answers(stored, groups)) {
                held.set(listed.item.number, stored);
            }
        }
        return { held, unreadable };
    };

    /**
     * Every open item the allowance reaches, read once, in number order.
     * One list call covers both kinds because GitHub's issue list carries pull requests too.
     */
    const readRecords = async (
        row: ClaimedScheduleRow,
        repository: RepositoryRef,
        config: RepositoryConfig,
        processor: SweepProcessor,
        before: Spent,
    ): Promise<Swept> => {
        const spent = (): Spent => since(before, allowance.spent());
        const groups = groupsFor(config);
        const reader = processor.facts(config, groups);
        const listed = await reader.openItems();
        if (!listed.ok) {
            log({ event: "sweepUnreadable", scheduleId: row.scheduleId, detail: listed.detail });
            return nothingRead(row, spent());
        }
        // The list is the whole of what is open, so a row for anything else is past (D193).

        const readAt = clock();
        store.ledger.dropSnapshotsNotIn(
            repository,
            listed.items.map(({ item }) => item.number),
        );
        const standing = standingReads(repository, listed.items, groups, readAt.getTime());
        if (standing.unreadable > 0) {
            log({
                event: "snapshotUnreadable",
                scheduleId: row.scheduleId,
                rows: standing.unreadable,
            });
        }
        const eligible = afterCursor(listed.items, row.resumeAfter);
        // Joined against every listed issue, not this firing's window: reading one more
        // item's clocks is a request, and requests are what the allowance counts (D192).

        const issues = listed.items.filter(({ item }) => item.kind === "issue");

        // A pull request's `links` are the only read that says which pull requests an
        // issue has, so EVERY listed one is answered before the walk and reversed here.
        // The walk's own bounds then decide nothing about an issue's links.

        const closes = new Map<number, SweptLinks>();
        for (const [number, held] of standing.held) {
            if (held.kind === "pullRequest") closes.set(number, held.closes);
        }
        const fresh = await reader.linksFor(
            listed.items
                .filter(({ item }) => item.kind === "pullRequest" && !closes.has(item.number))
                .map(({ item }) => item.number),
        );
        for (const [number, closing] of fresh) closes.set(number, closing);

        const inverse = new Map<number, ItemRef[]>();
        let linksUnread = false;
        for (const [number, closing] of closes) {
            if (closing === "unread") {
                linksUnread = true;
                continue;
            }
            for (const issue of closing) {
                const held = inverse.get(issue.number) ?? [];
                held.push({ kind: "pullRequest", number });
                inverse.set(issue.number, held);
            }
        }

        /** An issue's open pull requests; a partial inverse is a shorter list, not a shorter answer. */
        const openPullRequestsOf = (number: number): readonly ItemRef[] | Unread =>
            linksUnread ? "unread" : (inverse.get(number) ?? []);

        /** One item's record: from its stored read where one stands, from GitHub otherwise. */
        const recordOf = (
            listedItem: SweptItem,
            stored: SnapshotFacts | undefined,
        ): Promise<IssueFacts | PullRequestFacts> => {
            const { kind, number } = listedItem.item;
            return kind === "issue"
                ? reader.issueFacts(
                      listedItem,
                      openPullRequestsOf(number),
                      stored?.kind === "issue" ? stored : undefined,
                  )
                : reader.pullRequestFacts(
                      listedItem,
                      issues,
                      closes.get(number) ?? "unread",
                      stored?.kind === "pullRequest" ? stored : undefined,
                  );
        };

        const records: (IssueFacts | PullRequestFacts)[] = [];
        let read = 0;
        let reused = 0;
        for (const listedItem of eligible) {
            // In number order, one item at a time: what a firing answered is then a prefix
            // of the list, which is what the cursor below hands to the next one.

            if (readsStalled()) break;
            const turnedAway = allowance.refusals();
            const { kind, number } = listedItem.item;
            const stored = standing.held.get(number);
            const record = await recordOf(listedItem, stored);
            // A record one refusal short of complete is not kept, and the cursor stays
            // before it: the next firing reads the item again (D192).

            if (allowance.refusals() > turnedAway) break;
            read += 1;
            records.push(record);
            if (stored !== undefined) {
                reused += 1;
                continue;
            }
            // Written back as this firing read it; a reused row keeps its own `read_at`,
            // so reuse can never carry a read past `SNAPSHOT_MAX_AGE` (D193).

            store.ledger.putSnapshot(repository, {
                item: listedItem.item,
                updatedAt: listedItem.updatedAt.toISOString(),
                readAt: readAt.toISOString(),
                facts: encodeSnapshot(storedOf(record, groups[kind], closes.get(number) ?? UNREAD)),
            });
        }
        const reading = spent();
        const remaining = eligible.length - read;
        const resumeAfter =
            remaining === 0 ? null : (eligible[read - 1]?.item.number ?? row.resumeAfter);

        // One mutation lane for the tick: what it holds back is decided again next time.

        let decided = 0;
        let unread = 0;
        let heldBack = 0;
        for (const record of records) {
            if (record.links === "unread") unread += 1;
            const answer = await processor.decideItem(
                { kind: "facts", scheduleId: row.scheduleId, facts: record },
                config,
                row.dueAt,
                allowance,
            );
            heldBack += heldBackIn(answer);
            decided += 1;
        }
        if (resumeAfter !== null) {
            log({
                event: "sweepPartial",
                scheduleId: row.scheduleId,
                read,
                remaining,
                resumeAfter,
                requests: reading.core,
            });
        }
        const total = spent();
        return {
            items: listed.items.length,
            decided,
            unread,
            writes: total.mutations,
            heldBack,
            remaining,
            resumeAfter,
            reused,
            spent: total,
            deferred: false,
            partial: resumeAfter !== null,
        };
    };

    /** The three retention windows, run once per firing and contained on their own (D166). */
    const pruneRetained = (): void => {
        try {
            const now = clock().getTime();
            const before = (days: number): string => new Date(now - days * DAY_MS).toISOString();
            const deliveries = store.inbox.pruneCompletedDeliveries(
                before(DONE_DELIVERY_RETENTION_DAYS),
            );
            const effects = store.ledger.prune(before(SETTLED_EFFECT_RETENTION_DAYS));
            const decisions = store.ledger.pruneDecisions(before(DECISION_RETENTION_DAYS));
            if (deliveries > 0 || effects > 0 || decisions > 0) {
                log({ event: "sweepPruned", deliveries, effects, decisions });
            }
        } catch (error) {
            log({ event: "sweepFailed", detail: detailOf(error) });
        }
    };

    /**
     * What this firing read — nothing, where a suspension or the file says so (D171).
     * Contained: the reading is the only half of a firing that may fail, and the re-arm below has to happen anyway.
     */
    const readingOf = async (
        row: ClaimedScheduleRow,
        repository: RepositoryRef,
        processor: SweepProcessor,
    ): Promise<Swept> => {
        if (suspended) {
            log({ event: "sweepSuspended", scheduleId: row.scheduleId });
            return nothingRead(row);
        }
        if (allowance.exhausted() !== null) return deferred(row);
        const before = allowance.spent();
        const spent = (): Spent => since(before, allowance.spent());
        try {
            const config = await processor.configuration();
            if (allowance.exhausted() !== null) return deferred(row, spent());
            // Neither an unreadable file nor a repository that wants no sweeping is a
            // reason to read twenty items: re-arm and ask again.

            if (config !== null && wantsSweeping(config, capabilities)) {
                return await readRecords(row, repository, config, processor, before);
            }
        } catch (error) {
            log({ event: "sweepFailed", detail: detailOf(error) });
        }
        return nothingRead(row, spent());
    };

    /**
     * One firing, from claim to re-arm.
     * The re-arm happens whatever the reading came to: a row left `running` is one only a stale-claim redrive could free.
     */
    const fire = async (row: ClaimedScheduleRow, repository: RepositoryRef): Promise<void> => {
        const startedAt = clock().toISOString();
        log({ event: "sweepClaimed", scheduleId: row.scheduleId, dueAt: row.dueAt });
        const swept = await readingOf(row, repository, processorFor(repository, allowance));
        pruneRetained();
        const { partial, ...result } = swept;
        // One re-arm rule: a firing that did not finish its list is due at once (D192).

        const nextDueAt = swept.deferred || partial ? clock().toISOString() : nextDue();
        if (
            !store.ledger.scheduleAgain(
                row.scheduleId,
                row.claimToken,
                nextDueAt,
                result.resumeAfter,
                // A deferred firing read nothing, so the row keeps its place in the order.

                swept.deferred ? null : startedAt,
            )
        ) {
            // A redrive took the claim over while this firing ran; whoever holds it now
            // owns the next due date, and the reading just done was thrown away.

            log({ event: "sweepFailed", detail: `the claim on "${row.scheduleId}" was lost` });
            return;
        }
        log({ event: "sweepFinished", scheduleId: row.scheduleId, ...result, nextDueAt });
    };

    /**
     * Every row this tick claimed, fired or handed back.
     * Nothing here may reject: a rejection would reach `settled()`, where a shutdown awaiting it has nowhere to put it.
     */
    const fireDue = async (): Promise<void> => {
        try {
            const now = clock().toISOString();
            const due: readonly ClaimedScheduleRow[] = store.ledger.claimDue(now);
            // The pools are GitHub's window; only the mutation lane is this tick's (D192).

            allowance.armMutations(writeCap);
            for (const row of due) {
                const repository = repositoryOfScheduleId(row.scheduleId);
                if (row.effect === SWEEP_EFFECT && repository !== null) {
                    await fire(row, repository);
                    continue;
                }
                // `claimDue` claims every due row, so this is a future effect's row with no
                // driver here, or a sweep row whose id lost its name. Hand the claim back.

                log({ event: "sweepFailed", detail: undrivable(row) });
                store.ledger.scheduleAgain(
                    row.scheduleId,
                    row.claimToken,
                    nextDue(),
                    row.resumeAfter,
                    null,
                );
            }
        } catch (error) {
            log({ event: "sweepFailed", detail: detailOf(error) });
        }
    };

    let firing: Promise<void> | null = null;
    return {
        runDue(): Promise<void> {
            firing ??= (async () => {
                try {
                    await fireDue();
                } finally {
                    firing = null;
                }
            })();
            return firing;
        },
        settled: () => firing ?? Promise.resolve(),
    };
}
