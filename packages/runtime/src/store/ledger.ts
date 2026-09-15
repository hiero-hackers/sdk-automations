/**
 * The half of the file that is appended and folded: an effect's facts, its lease,
 * and the schedule rows a clock claims (D164).
 * The file and its pragmas belong to `Store`; this class is handed the connection.
 */

import type { DatabaseSync } from "node:sqlite";
import type { ItemRef, RepositoryRef } from "@hiero-hackers/automation-core";
import type {
    Decision,
    Fact,
    LandedWrite,
    LedgerState,
    OpenSend,
    OpenSendTally,
    StandingWarnings,
    StoredWarning,
    VerdictTally,
} from "./facts.js";
import { fold } from "./fold.js";
import { assertNonEmpty, assertUtcInstant } from "./guards.js";
import type { ClaimedScheduleRow, ScheduleRow, ScheduleStanding } from "./schedules.js";
import type { ItemSnapshot, SnapshotStanding } from "./snapshots.js";

/** The kinds that close an open send; `unsent` closes one without spending an attempt. */
const CLOSING = "('landed','refused','abandoned','unsent')";

/** An open send is a `sent` fact with no later closing fact at the same seq. */
const STILL_OPEN = `
    NOT EXISTS (
        SELECT 1 FROM effect_fact closing
        WHERE closing.effect_id = sent.effect_id AND closing.seq = sent.seq
          AND closing.kind IN ${CLOSING} AND closing.fact_id > sent.fact_id
    )`;

/** The newest send at its seq: a resend supersedes the send it retries, as one attempt of one call. */
const LATEST_SEND = `
    NOT EXISTS (
        SELECT 1 FROM effect_fact newer
        WHERE newer.effect_id = sent.effect_id AND newer.seq = sent.seq
          AND newer.kind = 'sent' AND newer.fact_id > sent.fact_id
    )`;

const ATTEMPTS_AT = `
    (SELECT COUNT(CASE WHEN spent.kind = 'sent' THEN 1 END)
          - COUNT(CASE WHEN spent.kind = 'unsent' THEN 1 END)
     FROM effect_fact spent
     WHERE spent.effect_id = sent.effect_id AND spent.seq = sent.seq)`;

/**
 * The instant a `warned` payload promises, null on bytes that are not JSON (D166).
 * The `CASE` is the guard: `json_extract` raises on those, and either side of an `AND` may be evaluated first.
 */
const PROMISED_AT = `
    CASE WHEN json_valid(warned.payload)
         THEN json_extract(warned.payload, '$.earliestActionAt') END`;

/** An effect whose warning promises an action still ahead of `$before` (D166). */
const PROMISE_AHEAD = `
    SELECT warned.effect_id FROM effect_fact warned
    WHERE warned.kind = 'warned' AND ${PROMISED_AT} > $before`;

/** An effect a landed call has already moved; a promise it kept is no longer standing (D168). */
const ALREADY_LANDED = `
    SELECT landed.effect_id FROM effect_fact landed
    WHERE landed.kind = 'landed' AND landed.seq >= 1`;

/** Which of two rows fires first: the one that started longer ago, and never-fired before all (D192). */
function firedFirst(left: string | null, right: string | null): number {
    if (left === right) return 0;
    if (left === null) return -1;
    if (right === null) return 1;
    return left < right ? -1 : 1;
}

/** The column's spelling, and the reference it is read back as: `owner/repo` (D169). */
const spelled = (repository: RepositoryRef): string => `${repository.owner}/${repository.repo}`;

function refOf(column: string): RepositoryRef {
    const cut = column.indexOf("/");
    return { owner: column.slice(0, cut), repo: column.slice(cut + 1) };
}

/** One `effect_fact` row, as SQLite hands it back. */
interface FactRow {
    readonly effect_id: string;
    readonly seq: number;
    readonly kind: Fact["kind"];
    readonly at: string;
    readonly revision: string;
    readonly capability: string;
    readonly repository: string;
    readonly item_kind: ItemRef["kind"];
    readonly item_number: number;
    readonly verb: string | null;
    readonly login: string | null;
    readonly code: string | null;
    readonly detail: string | null;
    readonly payload: string | null;
}

interface DecisionRow {
    readonly pass_id: string;
    readonly source: Decision["source"];
    readonly source_id: string;
    readonly at: string;
    readonly repository: string;
    readonly item_kind: ItemRef["kind"];
    readonly item_number: number;
    readonly capability: string;
    readonly verdict: string;
    readonly code: string | null;
    readonly detail: string | null;
    readonly effect_id: string | null;
}

function factOf(row: FactRow): Fact {
    return {
        effectId: row.effect_id,
        seq: row.seq,
        kind: row.kind,
        at: row.at,
        revision: row.revision,
        capability: row.capability,
        repository: refOf(row.repository),
        item: { kind: row.item_kind, number: row.item_number },
        verb: row.verb,
        login: row.login,
        code: row.code,
        detail: row.detail,
        payload: row.payload,
    };
}

/** A `warned` fact's payload read back as the snapshot it stored, or `null`. */
function warningOf(effectId: string, payload: string | null): StoredWarning | null {
    if (payload === null) return null;
    let snapshot: unknown;
    try {
        snapshot = JSON.parse(payload);
    } catch {
        return null;
    }
    if (typeof snapshot !== "object" || snapshot === null || Array.isArray(snapshot)) return null;
    return { ...(snapshot as Omit<StoredWarning, "effectId">), effectId };
}

/** An effect's history appended one fact at a time, with its lease and its clock (D164). */
export class Ledger {
    private readonly db: DatabaseSync;

    constructor(db: DatabaseSync) {
        this.db = db;
    }

    // ── Facts ───────────────────────────────────────────────────────

    /**
     * Append one fact. A second `warned` for the same effect appends nothing (D162).
     * One statement, so the first warning binds even against a concurrent writer.
     */
    record(fact: Fact): void {
        assertUtcInstant(fact.at, "at");
        assertNonEmpty(fact.effectId, "effectId");
        this.db
            .prepare(
                `
                INSERT INTO effect_fact (
                    effect_id, seq, kind, at, revision, capability,
                    repository, item_kind, item_number, verb, login, code, detail, payload
                )
                SELECT $effectId, $seq, $kind, $at, $revision, $capability,
                       $repository, $itemKind, $itemNumber, $verb, $login, $code, $detail, $payload
                WHERE $kind != 'warned'
                   OR NOT EXISTS (
                        SELECT 1 FROM effect_fact
                        WHERE effect_id = $effectId AND kind = 'warned'
                   )
            `,
            )
            .run({
                $effectId: fact.effectId,
                $seq: fact.seq,
                $kind: fact.kind,
                $at: fact.at,
                $revision: fact.revision,
                $capability: fact.capability,
                $repository: spelled(fact.repository),
                $itemKind: fact.item.kind,
                $itemNumber: fact.item.number,
                $verb: fact.verb,
                $login: fact.login,
                $code: fact.code,
                $detail: fact.detail,
                $payload: fact.payload,
            });
    }

    /** One effect's facts in ledger order — the fold's input, and the operator's. */
    factsOf(effectId: string): Fact[] {
        const rows = this.db
            .prepare("SELECT * FROM effect_fact WHERE effect_id = ? ORDER BY fact_id")
            .all(effectId) as unknown as FactRow[];
        return rows.map(factOf);
    }

    stateOf(effectId: string, planLength: number): LedgerState {
        return fold(this.factsOf(effectId), planLength);
    }

    /** The sweep's worklist — every open send at or before `before`, oldest first. */
    open(before: string): OpenSend[] {
        assertUtcInstant(before, "before");
        const rows = this.db
            .prepare(
                `
                SELECT sent.effect_id, sent.repository, sent.seq, sent.payload,
                       sent.at, sent.revision, ${ATTEMPTS_AT} AS attempts
                FROM effect_fact sent
                WHERE sent.kind = 'sent' AND sent.at <= ?
                  AND ${STILL_OPEN} AND ${LATEST_SEND}
                ORDER BY sent.at, sent.fact_id
            `,
            )
            .all(before) as unknown as {
            effect_id: string;
            repository: string;
            seq: number;
            payload: string | null;
            at: string;
            revision: string;
            attempts: number;
        }[];
        return rows.map((row) => ({
            effectId: row.effect_id,
            repository: refOf(row.repository),
            seq: row.seq,
            payload: row.payload,
            attempts: row.attempts,
            at: row.at,
            revision: row.revision,
        }));
    }

    /** How many sends nothing has closed, and when the oldest of them was sent (D168). */
    stillOpen(): OpenSendTally {
        const row = this.db
            .prepare(
                `
                SELECT COUNT(*) AS open_sends, MIN(sent.at) AS oldest
                FROM effect_fact sent
                WHERE sent.kind = 'sent' AND ${STILL_OPEN} AND ${LATEST_SEND}
            `,
            )
            .get() as unknown as { open_sends: number; oldest: string | null };
        return { count: row.open_sends, oldest: row.oldest };
    }

    /** Every effect with a fact on one item, oldest first — where an explanation starts (D163). */
    effectsOn(repository: RepositoryRef, item: ItemRef): string[] {
        const rows = this.db
            .prepare(
                `
                SELECT effect_id FROM effect_fact
                WHERE repository = ? AND item_kind = ? AND item_number = ?
                GROUP BY effect_id
                ORDER BY MIN(fact_id)
            `,
            )
            .all(spelled(repository), item.kind, item.number) as unknown as {
            effect_id: string;
        }[];
        return rows.map((row) => row.effect_id);
    }

    /** Every completed call the platform made on one item — what GitHub's actor cannot say (D159). */
    landedOn(repository: RepositoryRef, item: ItemRef): LandedWrite[] {
        const rows = this.db
            .prepare(
                `
                SELECT verb, login, at FROM effect_fact
                WHERE kind = 'landed'
                  AND repository = ? AND item_kind = ? AND item_number = ?
                ORDER BY at, fact_id
            `,
            )
            .all(spelled(repository), item.kind, item.number) as unknown as LandedWrite[];
        return rows.map((row) => ({ verb: row.verb, login: row.login, at: row.at }));
    }

    /** The warning standing for one effect: the earliest, because the first binds (D162). */
    warningFor(effectId: string): StoredWarning | null {
        const row = this.db
            .prepare(
                `
                SELECT payload FROM effect_fact
                WHERE effect_id = ? AND kind = 'warned'
                ORDER BY fact_id LIMIT 1
            `,
            )
            .get(effectId) as { payload: string | null } | undefined;
        return row === undefined ? null : warningOf(effectId, row.payload);
    }

    /** The warnings promising an action still ahead of `now`, and the earliest due (D168). */
    standingWarnings(now: string): StandingWarnings {
        assertUtcInstant(now, "now");
        const row = this.db
            .prepare(
                `
                SELECT COUNT(*) AS standing, MIN(${PROMISED_AT}) AS next_due
                FROM effect_fact warned
                WHERE warned.kind = 'warned' AND ${PROMISED_AT} > $now
                  AND warned.effect_id NOT IN (${ALREADY_LANDED})
            `,
            )
            .get({ $now: now }) as unknown as { standing: number; next_due: string | null };
        return { count: row.standing, nextDue: row.next_due };
    }

    /** Append one pass's verdict on one item (D163). */
    decide(decision: Decision): void {
        assertUtcInstant(decision.at, "at");
        assertNonEmpty(decision.passId, "passId");
        this.db
            .prepare(
                `
                INSERT INTO decision (
                    pass_id, source, source_id, at, repository, item_kind, item_number,
                    capability, verdict, code, detail, effect_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            )
            .run(
                decision.passId,
                decision.source,
                decision.sourceId,
                decision.at,
                spelled(decision.repository),
                decision.item.kind,
                decision.item.number,
                decision.capability,
                decision.verdict,
                decision.code,
                decision.detail,
                decision.effectId,
            );
    }

    decisionsOn(repository: RepositoryRef, item: ItemRef): Decision[] {
        const rows = this.db
            .prepare(
                `
                SELECT * FROM decision
                WHERE repository = ? AND item_kind = ? AND item_number = ?
                ORDER BY at, rowid
            `,
            )
            .all(spelled(repository), item.kind, item.number) as unknown as DecisionRow[];
        return rows.map((row) => ({
            passId: row.pass_id,
            source: row.source,
            sourceId: row.source_id,
            at: row.at,
            repository: refOf(row.repository),
            item: { kind: row.item_kind, number: row.item_number },
            capability: row.capability,
            verdict: row.verdict,
            code: row.code,
            detail: row.detail,
            effectId: row.effect_id,
        }));
    }

    /** How many decisions each verdict took after `since`, in verdict order (D168). */
    verdictsSince(since: string): VerdictTally[] {
        assertUtcInstant(since, "since");
        const rows = this.db
            .prepare(
                `
                SELECT verdict, COUNT(*) AS taken FROM decision
                WHERE at > ?
                GROUP BY verdict ORDER BY verdict
            `,
            )
            .all(since) as unknown as { verdict: string; taken: number }[];
        return rows.map((row) => ({ verdict: row.verdict, count: row.taken }));
    }

    /** Managed comments landed after `since`; the client's own ceiling counts attempts (D193). */
    commentsSince(since: string): number {
        assertUtcInstant(since, "since");
        const row = this.db
            .prepare(
                `
                SELECT COUNT(*) AS created FROM effect_fact
                WHERE kind = 'landed' AND verb = 'postComment' AND at > ?
            `,
            )
            .get(since) as unknown as { created: number };
        return row.created;
    }

    // ── Snapshots ───────────────────────────────────────────────────

    /** One item's last read, or `null` where this repository has none (D193). */
    snapshotOf(repository: RepositoryRef, item: ItemRef): ItemSnapshot | null {
        const row = this.db
            .prepare(
                `
                SELECT updated_at, read_at, facts FROM item_snapshot
                WHERE repository = ? AND item_kind = ? AND item_number = ?
            `,
            )
            .get(spelled(repository), item.kind, item.number) as
            { updated_at: string; read_at: string; facts: string } | undefined;
        return row === undefined
            ? null
            : { item, updatedAt: row.updated_at, readAt: row.read_at, facts: row.facts };
    }

    /** Write one item's read, replacing whatever stood for it (D193). */
    putSnapshot(repository: RepositoryRef, snapshot: ItemSnapshot): void {
        assertUtcInstant(snapshot.updatedAt, "updatedAt");
        assertUtcInstant(snapshot.readAt, "readAt");
        this.db
            .prepare(
                `
                INSERT INTO item_snapshot VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(repository, item_kind, item_number) DO UPDATE SET
                    updated_at = excluded.updated_at,
                    read_at = excluded.read_at,
                    facts = excluded.facts
            `,
            )
            .run(
                spelled(repository),
                snapshot.item.kind,
                snapshot.item.number,
                snapshot.updatedAt,
                snapshot.readAt,
                snapshot.facts,
            );
    }

    /**
     * Drop every read of this repository for an item `numbers` does not carry (D193).
     * Only a COMPLETE list may say so: a firing that read part of one knows nothing about the rest.
     */
    dropSnapshotsNotIn(repository: RepositoryRef, numbers: readonly number[]): number {
        return this.db
            .prepare(
                `
                DELETE FROM item_snapshot
                WHERE repository = $repository
                  AND item_number NOT IN (SELECT value FROM json_each($numbers))
            `,
            )
            .run({ $repository: spelled(repository), $numbers: JSON.stringify(numbers) })
            .changes as number;
    }

    /** How many reads each repository holds, and the oldest of them (D168). */
    snapshots(): SnapshotStanding[] {
        const rows = this.db
            .prepare(
                `
                SELECT repository, COUNT(*) AS held, MIN(read_at) AS oldest
                FROM item_snapshot GROUP BY repository ORDER BY repository
            `,
            )
            .all() as unknown as { repository: string; held: number; oldest: string }[];
        return rows.map((row) => ({
            repository: refOf(row.repository),
            count: row.held,
            oldest: row.oldest,
        }));
    }

    // ── Claims (lock) ───────────────────────────────────────────────

    /**
     * One-winner LEASE on an effect, with atomic stale takeover so a crashed holder
     * cannot deadlock it. Non-contention failures throw, so `false` strictly means a live worker holds it. A lease can still be stolen from a live worker (D41).
     */
    claim(effectId: string, worker: string, now: string, staleBefore: string): boolean {
        assertUtcInstant(now, "now");
        assertUtcInstant(staleBefore, "staleBefore");
        const result = this.db
            .prepare(
                `
                INSERT INTO effect_claim VALUES (?, ?, ?)
                ON CONFLICT(effect_id) DO UPDATE SET worker = excluded.worker, at = excluded.at
                WHERE effect_claim.at <= ?
            `,
            )
            .run(effectId, worker, now, staleBefore);
        return result.changes === 1;
    }

    /**
     * Release a claim on clean completion — deletes only the caller's OWN row, so
     * releasing after your lease was stolen is a safe no-op.
     */
    release(effectId: string, worker: string): boolean {
        const result = this.db
            .prepare("DELETE FROM effect_claim WHERE effect_id = ? AND worker = ?")
            .run(effectId, worker);
        return result.changes === 1;
    }

    // ── Schedules ───────────────────────────────────────────────────

    /** Idempotent: re-declaring an existing schedule id is a no-op. */
    schedule(scheduleId: string, dueAt: string, effect: string): void {
        assertUtcInstant(dueAt, "dueAt");
        this.db
            .prepare(
                "INSERT OR IGNORE INTO schedule VALUES (?, ?, ?, 'pending', NULL, NULL, NULL, NULL)",
            )
            .run(scheduleId, dueAt, effect);
    }

    /**
     * Atomically claim every due pending schedule and return the claimed rows.
     * A restart mid-processing does NOT re-fire a running schedule; redriving stuck `running` rows is `requeueStuck`, deliberately not this method.
     */
    claimDue(now: string): ClaimedScheduleRow[] {
        assertUtcInstant(now, "now");
        const rows = this.db
            .prepare(
                `
                UPDATE schedule
                SET status = 'running',
                    claimed_at = ?,
                    claim_token = lower(hex(randomblob(16)))
                WHERE status = 'pending' AND due_at <= ?
                RETURNING schedule_id, due_at, effect, claim_token, resume_after, started_at
            `,
            )
            .all(now, now) as {
            schedule_id: string;
            due_at: string;
            effect: string;
            claim_token: string;
            resume_after: number | null;
            started_at: string | null;
        }[];
        // The shared allowance goes to the rows that waited longest, so a deferred
        // repository is read before one this tick's caller already read (D192). An
        // UPDATE cannot order its own RETURNING, so the claimed rows are ordered here.

        return rows
            .sort((left, right) => firedFirst(left.started_at, right.started_at))
            .map((r) => ({
                scheduleId: r.schedule_id,
                dueAt: r.due_at,
                effect: r.effect,
                claimToken: r.claim_token,
                resumeAfter: r.resume_after,
            }));
    }

    /** Complete a firing, and only for the token that claimed it. */
    scheduleDone(scheduleId: string, claimToken: string): boolean {
        const result = this.db
            .prepare(
                `
                UPDATE schedule
                SET status = 'done', claimed_at = NULL, claim_token = NULL
                WHERE schedule_id = ? AND status = 'running' AND claim_token = ?
            `,
            )
            .run(scheduleId, claimToken);
        return result.changes === 1;
    }

    /**
     * Complete this firing and arm the next one, in one statement: `schedule()` is
     * `INSERT OR IGNORE`, so a completed sweep could never come round again, and a crash between two statements would lose the schedule or strand the claim.
     * The cursor and the firing's start ride on the due date; a `null` start leaves the row's own, so a firing that read nothing keeps its place in the order (D170, D192).
     */
    scheduleAgain(
        scheduleId: string,
        claimToken: string,
        dueAt: string,
        resumeAfter: number | null,
        startedAt: string | null,
    ): boolean {
        assertUtcInstant(dueAt, "dueAt");
        if (startedAt !== null) assertUtcInstant(startedAt, "startedAt");
        const result = this.db
            .prepare(
                `
                UPDATE schedule
                SET status = 'pending', due_at = ?, claimed_at = NULL, claim_token = NULL,
                    resume_after = ?, started_at = COALESCE(?, started_at)
                WHERE schedule_id = ? AND status = 'running' AND claim_token = ?
            `,
            )
            .run(dueAt, resumeAfter, startedAt, scheduleId, claimToken);
        return result.changes === 1;
    }

    /**
     * The sweep's redrive: atomically return stuck `running` schedules to `pending`.
     * Stuckness is claim age, never due time, so a backlog catch-up is not stolen from. A slow-but-alive handler can fire twice, so effects still need D41's contract (D43).
     */
    requeueStuck(claimedBefore: string): ScheduleRow[] {
        assertUtcInstant(claimedBefore, "claimedBefore");
        const rows = this.db
            .prepare(
                `
                UPDATE schedule
                SET status = 'pending', claimed_at = NULL, claim_token = NULL
                WHERE status = 'running' AND claimed_at <= ?
                RETURNING schedule_id, due_at, effect
            `,
            )
            .all(claimedBefore) as {
            schedule_id: string;
            due_at: string;
            effect: string;
        }[];
        return rows.map((r) => ({
            scheduleId: r.schedule_id,
            dueAt: r.due_at,
            effect: r.effect,
        }));
    }

    /** Every schedule row: where it stands, when it is due, and the claim on it (D168). */
    schedules(): ScheduleStanding[] {
        const rows = this.db
            .prepare(
                `
                SELECT schedule_id, due_at, effect, status, claimed_at
                FROM schedule ORDER BY schedule_id
            `,
            )
            .all() as unknown as {
            schedule_id: string;
            due_at: string;
            effect: string;
            status: ScheduleStanding["status"];
            claimed_at: string | null;
        }[];
        return rows.map((r) => ({
            scheduleId: r.schedule_id,
            dueAt: r.due_at,
            effect: r.effect,
            status: r.status,
            claimedAt: r.claimed_at,
        }));
    }

    // ── Retention ───────────────────────────────────────────────────

    /**
     * Delete whole effects settled at or before `before` — never single facts (D161).
     * An effect with an open send is kept however old, and so is one whose warning promises an action still ahead (D166).
     * Reads older than the window go with them, and the count stays the effects' (D193).
     */
    prune(before: string): number {
        assertUtcInstant(before, "before");
        this.db.prepare("DELETE FROM item_snapshot WHERE read_at <= ?").run(before);
        return this.db
            .prepare(
                `
                DELETE FROM effect_fact
                WHERE effect_id IN (
                        SELECT effect_id FROM effect_fact
                        GROUP BY effect_id HAVING MAX(at) <= $before
                    )
                  AND effect_id NOT IN (
                        SELECT sent.effect_id FROM effect_fact sent
                        WHERE sent.kind = 'sent' AND ${STILL_OPEN}
                    )
                  AND effect_id NOT IN (${PROMISE_AHEAD})
            `,
            )
            .run({ $before: before }).changes as number;
    }

    /** Delete decision rows taken at or before `before`, on the deliveries window (D163). */
    pruneDecisions(before: string): number {
        assertUtcInstant(before, "before");
        return this.db.prepare("DELETE FROM decision WHERE at <= ?").run(before).changes as number;
    }
}
