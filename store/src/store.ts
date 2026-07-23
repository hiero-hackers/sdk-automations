/**
 * The owned operational store — `design/operations/storage-decision.md`
 * made real, with the exact crash semantics protocol 6.5 demonstrated.
 * **Ratification pending** under the stage-four review; the schema is
 * the decided four independent tables and nothing else.
 *
 * Design rules carried over from the evidence:
 *
 * - Every write is one synchronous SQLite statement, so the on-disk
 *   state after `kill -9` is exactly "everything before the last call
 *   that returned" — the property the 6.5 harness relied on, and the
 *   property the crash tests here simulate by reopening the file in a
 *   fresh instance.
 * - The tables are independent: no foreign keys, no joins. Each hot
 *   path is a single INSERT or primary-key lookup.
 * - The journal alone cannot disambiguate a sent-but-unconfirmed write
 *   (`sentUnknown`) — the caller must resolve it against GitHub state
 *   before retrying, per the recovery loop in the storage decision.
 */

import { DatabaseSync } from "node:sqlite";
import type { DeliveryId } from "../../core/src/ids.js";

export type EffectState =
    | { readonly state: "neverStarted" }
    | { readonly state: "complete" }
    | { readonly state: "midSequence"; readonly lastDoneSeq: number }
    | { readonly state: "sentUnknown"; readonly seq: number; readonly intent: string };

export interface ScheduleRow {
    readonly scheduleId: string;
    readonly dueAt: string;
    readonly effect: string;
}

export class Store {
    private readonly db: DatabaseSync;

    constructor(path: string) {
        this.db = new DatabaseSync(path);
        this.db.exec("PRAGMA busy_timeout = 2000");
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS seen_delivery (
                delivery_id TEXT PRIMARY KEY,
                at          TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS effect_journal (
                effect_id TEXT NOT NULL,
                call_seq  INTEGER NOT NULL,
                intent    TEXT NOT NULL,
                status    TEXT NOT NULL CHECK (status IN ('sent', 'done')),
                at        TEXT NOT NULL,
                PRIMARY KEY (effect_id, call_seq)
            );
            CREATE TABLE IF NOT EXISTS effect_claim (
                effect_id TEXT PRIMARY KEY,
                worker    TEXT NOT NULL,
                at        TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS schedule (
                schedule_id TEXT PRIMARY KEY,
                due_at      TEXT NOT NULL,
                effect      TEXT NOT NULL,
                status      TEXT NOT NULL CHECK (status IN ('pending', 'running', 'done'))
            );
        `);
    }

    // ── Delivery deduplication ──────────────────────────────────────

    /**
     * Record a delivery id; returns true iff it was never seen before.
     * Dedup keys on the delivery guid because GitHub redeliveries and
     * transport-layer duplicates reuse it (6.2), and takes the branded
     * string type because the raw ids exceed 2^53.
     */
    firstSeen(deliveryId: DeliveryId): boolean {
        const result = this.db
            .prepare("INSERT OR IGNORE INTO seen_delivery VALUES (?, ?)")
            .run(deliveryId, new Date().toISOString());
        return result.changes === 1;
    }

    // ── Effect journal (detector) ───────────────────────────────────

    /** Record intent BEFORE the call — the row that survives any crash after it. */
    intent(effectId: string, seq: number, intent: string): void {
        this.db
            .prepare("INSERT OR REPLACE INTO effect_journal VALUES (?, ?, ?, 'sent', ?)")
            .run(effectId, seq, intent, new Date().toISOString());
    }

    done(effectId: string, seq: number): void {
        this.db
            .prepare("UPDATE effect_journal SET status = 'done' WHERE effect_id = ? AND call_seq = ?")
            .run(effectId, seq);
    }

    /**
     * Classify an effect from the journal alone — the left half of the
     * storage decision's recovery loop. `planLength` is the declared
     * call count of the effect's plan (contract.md §5); the journal
     * cannot know completion without it.
     */
    effectState(effectId: string, planLength: number): EffectState {
        const rows = this.db
            .prepare("SELECT call_seq, intent, status FROM effect_journal WHERE effect_id = ? ORDER BY call_seq DESC LIMIT 1")
            .all(effectId) as { call_seq: number; intent: string; status: string }[];
        const last = rows[0];
        if (last === undefined) return { state: "neverStarted" };
        if (last.status === "sent") {
            return { state: "sentUnknown", seq: last.call_seq, intent: last.intent };
        }
        if (last.call_seq >= planLength) return { state: "complete" };
        return { state: "midSequence", lastDoneSeq: last.call_seq };
    }

    // ── Claims (lock) ───────────────────────────────────────────────

    /**
     * One-winner claim on an effect — the primary-key INSERT that
     * serialized the 6.5 two-worker race. Needed even in a one-process
     * deployment: crash-restart overlap and at-least-once redelivery
     * can race two executions of the same effect without two long-lived
     * workers ever existing.
     */
    claim(effectId: string, worker: string): boolean {
        try {
            this.db
                .prepare("INSERT INTO effect_claim VALUES (?, ?, ?)")
                .run(effectId, worker, new Date().toISOString());
            return true;
        } catch {
            return false;
        }
    }

    // ── Schedules ───────────────────────────────────────────────────

    /** Idempotent: re-declaring an existing schedule id is a no-op. */
    schedule(scheduleId: string, dueAt: string, effect: string): void {
        this.db
            .prepare("INSERT OR IGNORE INTO schedule VALUES (?, ?, ?, 'pending')")
            .run(scheduleId, dueAt, effect);
    }

    /**
     * Atomically claim every due pending schedule (pending → running)
     * and return the claimed rows. Two instances calling concurrently
     * split the due set; a restart mid-processing does NOT re-fire a
     * running schedule — redriving stuck `running` rows is the
     * reconciliation sweep's job, deliberately not this method's.
     */
    claimDue(now: string): ScheduleRow[] {
        const rows = this.db
            .prepare(`
                UPDATE schedule SET status = 'running'
                WHERE status = 'pending' AND due_at <= ?
                RETURNING schedule_id, due_at, effect
            `)
            .all(now) as { schedule_id: string; due_at: string; effect: string }[];
        return rows.map((r) => ({ scheduleId: r.schedule_id, dueAt: r.due_at, effect: r.effect }));
    }

    scheduleDone(scheduleId: string): void {
        this.db
            .prepare("UPDATE schedule SET status = 'done' WHERE schedule_id = ?")
            .run(scheduleId);
    }

    close(): void {
        this.db.close();
    }
}
