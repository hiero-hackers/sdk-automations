/**
 * The owned operational store — `design/operations/storage-decision.md`
 * made real, with the exact crash semantics protocol 6.5 demonstrated.
 * **Ratification pending** under the stage-four review. Durable webhook
 * intake extends the original GUID-only `seen_delivery` record so an
 * acknowledged delivery can never exist without retrievable work.
 *
 * Design rules carried over from the evidence:
 *
 * - Every state transition is a synchronous SQLite statement. Delivery
 *   acceptance wraps its insert and duplicate classification in one
 *   synchronous transaction, so a returned result is committed before
 *   the caller can acknowledge it.
 * - The tables are independent: no foreign keys and no joins.
 * - The journal alone cannot disambiguate a sent-but-unconfirmed write
 *   (`sentUnknown`) — the caller must resolve it against GitHub state
 *   before retrying, per the recovery loop in the storage decision.
 */

import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { asDeliveryGuid, type DeliveryGuid } from "@hiero-hackers/automation-core";

export type DeliveryState = "pending" | "processing" | "done";

export interface AcceptDeliveryInput {
    readonly deliveryId: DeliveryGuid;
    readonly eventName: string;
    readonly payload: Uint8Array;
    readonly receivedAt: string;
}

export type AcceptDeliveryResult =
    | {
          readonly outcome: "accepted";
          readonly state: "pending";
          readonly payloadDigest: string;
      }
    | {
          readonly outcome: "duplicate";
          readonly state: DeliveryState;
          readonly payloadDigest: string;
      }
    | {
          readonly outcome: "conflict";
          readonly state: DeliveryState;
          readonly eventNameMismatch: boolean;
          readonly payloadMismatch: boolean;
      };

export interface ClaimedDelivery {
    readonly deliveryId: DeliveryGuid;
    readonly eventName: string;
    readonly payload: Uint8Array;
    readonly payloadDigest: string;
    readonly receivedAt: string;
    readonly worker: string;
    readonly claimedAt: string;
    readonly claimToken: string;
}

export type CompleteDeliveryResult =
    { readonly outcome: "completed" } | { readonly outcome: "notOwned" };

export type ReleaseDeliveryResult =
    { readonly outcome: "released" } | { readonly outcome: "notOwned" };

export type EffectState =
    | { readonly state: "neverStarted" }
    | {
          readonly state: "complete";
          readonly lastDoneSeq: number;
          readonly revision: string;
      }
    | {
          readonly state: "midSequence";
          readonly lastDoneSeq: number;
          readonly revision: string;
      }
    | {
          readonly state: "sentUnknown";
          readonly seq: number;
          readonly intent: string;
          /**
           * How many times this call has been sent — durable across
           * crashes, so a restarted process can hand `retryAdvice` a
           * truthful attempt number instead of restarting the bound
           * at zero.
           */
          readonly attempt: number;
          readonly revision: string;
      };

export interface ScheduleRow {
    readonly scheduleId: string;
    readonly dueAt: string;
    readonly effect: string;
}

export interface ClaimedScheduleRow extends ScheduleRow {
    /** Unique to this firing; required to complete it. */
    readonly claimToken: string;
}

/** One unresolved `sent` journal row — the sweep's unit of work. */
export interface OpenIntent {
    readonly effectId: string;
    readonly seq: number;
    readonly intent: string;
    readonly attempt: number;
    readonly at: string;
}

/**
 * The ONE timestamp format the store accepts: exactly the
 * `Date.toISOString()` shape — millisecond precision, `Z` suffix.
 * Constant width is what makes lexicographic order chronological
 * order, which every `<=` comparison in this file relies on. Mixed
 * precision breaks it (`"…00Z" > "…00.500Z"` as strings but earlier
 * in time — `'Z'` sorts above `'.'`), and an offset format sorts
 * wrongly outright — so both are thrown caller bugs, not data.
 * (Property-tested: order equivalence over random instant pairs.)
 */
const UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** Exported so the shell can validate before a store call. */
export function assertUtcInstant(value: string, param: string): void {
    const epochMs = Date.parse(value);
    if (
        !UTC_INSTANT.test(value) ||
        !Number.isFinite(epochMs) ||
        new Date(epochMs).toISOString() !== value
    ) {
        throw new TypeError(
            `${param} must be a millisecond-precision UTC instant, exactly Date.toISOString() form (got ${JSON.stringify(value)})`,
        );
    }
}

function assertDeliveryGuid(value: DeliveryGuid): void {
    if (asDeliveryGuid(value) === undefined) {
        throw new TypeError("deliveryId must be a valid GitHub delivery GUID");
    }
}

function assertNonEmpty(value: string, param: string): void {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new TypeError(`${param} must be a non-empty string`);
    }
}

function assertPayload(value: Uint8Array): void {
    if (!(value instanceof Uint8Array)) {
        throw new TypeError("payload must be bytes");
    }
}

function payloadDigest(payload: Uint8Array): string {
    return createHash("sha256").update(payload).digest("hex");
}

interface StoredDeliveryIdentity {
    readonly event_name: string;
    readonly payload_digest: string;
    readonly state: DeliveryState;
}

interface ClaimedDeliveryRow {
    readonly delivery_id: string;
    readonly event_name: string;
    readonly payload: Uint8Array;
    readonly payload_digest: string;
    readonly received_at: string;
    readonly claim_token: string;
}

export class Store {
    private readonly db: DatabaseSync;

    constructor(path: string) {
        this.db = new DatabaseSync(path);
        try {
            this.db.exec("PRAGMA busy_timeout = 2000");
            // These two pragmas ARE the crash model — set explicitly,
            // not inherited as defaults. DELETE-mode journal +
            // synchronous FULL is what makes "everything before the
            // last returned call survives kill -9 and power loss" true.
            // The config test pins both so this cannot change silently.
            this.db.exec("PRAGMA journal_mode = DELETE");
            this.db.exec("PRAGMA synchronous = FULL");
            const existingDeliveryTable = this.db
                .prepare(
                    `
                    SELECT 1
                    FROM sqlite_schema
                    WHERE type = 'table' AND name = 'seen_delivery'
                `,
                )
                .get();
            if (existingDeliveryTable !== undefined) {
                this.assertDeliverySchema();
            }
            this.db.exec(`
            CREATE TABLE IF NOT EXISTS seen_delivery (
                delivery_id   TEXT PRIMARY KEY,
                event_name    TEXT NOT NULL,
                payload       BLOB,
                payload_digest TEXT NOT NULL,
                received_at   TEXT NOT NULL,
                state         TEXT NOT NULL CHECK (state IN ('pending', 'processing', 'done')),
                claim_worker  TEXT,
                claim_token   TEXT,
                claimed_at    TEXT,
                completed_at  TEXT,
                CHECK (
                    (state = 'pending' AND payload IS NOT NULL
                        AND claim_worker IS NULL AND claim_token IS NULL
                        AND claimed_at IS NULL AND completed_at IS NULL)
                    OR
                    (state = 'processing' AND payload IS NOT NULL
                        AND claim_worker IS NOT NULL AND claim_token IS NOT NULL
                        AND claimed_at IS NOT NULL AND completed_at IS NULL)
                    OR
                    (state = 'done' AND payload IS NULL
                        AND claim_worker IS NULL AND claim_token IS NULL
                        AND claimed_at IS NULL AND completed_at IS NOT NULL)
                )
            );
            CREATE TABLE IF NOT EXISTS effect_journal (
                effect_id TEXT NOT NULL,
                call_seq  INTEGER NOT NULL,
                intent    TEXT NOT NULL,
                status    TEXT NOT NULL CHECK (status IN ('sent', 'done')),
                at        TEXT NOT NULL,
                attempt   INTEGER NOT NULL,
                revision  TEXT NOT NULL,
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
                status      TEXT NOT NULL CHECK (status IN ('pending', 'running', 'done')),
                claimed_at  TEXT,
                claim_token TEXT
            );
        `);
            this.assertDeliverySchema();
            this.db.exec(`
                -- The journal has no retention policy yet (D43), so the
                -- sweep's openIntents scan must not grow with all history
                -- ever: this partial index keeps it O(open intents). The
                -- schedule scans stay unindexed deliberately — that table
                -- is bounded by live schedules.
                CREATE INDEX IF NOT EXISTS open_intents
                    ON effect_journal(at) WHERE status = 'sent';
                CREATE INDEX IF NOT EXISTS delivery_work
                    ON seen_delivery(state, received_at, delivery_id);
            `);
        } catch (error) {
            try {
                this.db.close();
            } catch {
                // Preserve the initialization error.
            }
            throw error;
        }
    }

    private assertDeliverySchema(): void {
        const columns = this.db.prepare("PRAGMA table_info(seen_delivery)").all() as {
            name: string;
        }[];
        const names = new Set(columns.map((column) => column.name));
        const required = [
            "delivery_id",
            "event_name",
            "payload",
            "payload_digest",
            "received_at",
            "state",
            "claim_worker",
            "claim_token",
            "claimed_at",
            "completed_at",
        ];
        if (required.some((column) => !names.has(column))) {
            throw new Error(
                "incompatible pre-ratification seen_delivery schema; use a fresh store database",
            );
        }
    }

    // ── Durable webhook intake ─────────────────────────────────────

    /**
     * Atomically persist a verified delivery's identity and exact
     * bytes before an HTTP receiver acknowledges it. The transaction
     * keeps duplicate classification and the row it describes under
     * the same write lock, so a successful result always refers to a
     * durable row. Neither duplicates nor conflicts mutate the first
     * accepted delivery.
     */
    acceptDelivery(input: AcceptDeliveryInput): AcceptDeliveryResult {
        assertDeliveryGuid(input.deliveryId);
        assertNonEmpty(input.eventName, "eventName");
        assertPayload(input.payload);
        assertUtcInstant(input.receivedAt, "receivedAt");

        const digest = payloadDigest(input.payload);
        this.db.exec("BEGIN IMMEDIATE");
        try {
            const inserted = this.db
                .prepare(
                    `
                    INSERT INTO seen_delivery (
                        delivery_id, event_name, payload, payload_digest,
                        received_at, state, claim_worker, claim_token,
                        claimed_at, completed_at
                    ) VALUES (?, ?, ?, ?, ?, 'pending', NULL, NULL, NULL, NULL)
                    ON CONFLICT(delivery_id) DO NOTHING
                `,
                )
                .run(input.deliveryId, input.eventName, input.payload, digest, input.receivedAt);

            let result: AcceptDeliveryResult;
            if (inserted.changes === 1) {
                result = {
                    outcome: "accepted",
                    state: "pending",
                    payloadDigest: digest,
                };
            } else {
                const existing = this.db
                    .prepare(
                        `
                        SELECT event_name, payload_digest, state
                        FROM seen_delivery
                        WHERE delivery_id = ?
                    `,
                    )
                    .get(input.deliveryId) as StoredDeliveryIdentity | undefined;
                if (existing === undefined) {
                    throw new Error("delivery conflict lookup did not find its durable row");
                }

                const eventNameMismatch = existing.event_name !== input.eventName;
                const payloadMismatch = existing.payload_digest !== digest;
                result =
                    eventNameMismatch || payloadMismatch
                        ? {
                              outcome: "conflict",
                              state: existing.state,
                              eventNameMismatch,
                              payloadMismatch,
                          }
                        : {
                              outcome: "duplicate",
                              state: existing.state,
                              payloadDigest: existing.payload_digest,
                          };
            }

            this.db.exec("COMMIT");
            return result;
        } catch (error) {
            try {
                this.db.exec("ROLLBACK");
            } catch {
                // Preserve the operation's original error.
            }
            throw error;
        }
    }

    /**
     * Claim one pending delivery, or atomically take over one stale
     * processing claim. Selection is stable by receipt time then GUID.
     * The generated 256-bit token, not the worker name, proves
     * ownership to completion and release calls.
     */
    claimNextDelivery(
        worker: string,
        now: string,
        staleBefore: string,
    ): ClaimedDelivery | undefined {
        assertNonEmpty(worker, "worker");
        assertUtcInstant(now, "now");
        assertUtcInstant(staleBefore, "staleBefore");
        const row = this.db
            .prepare(
                `
                UPDATE seen_delivery
                SET state = 'processing',
                    claim_worker = ?,
                    claim_token = lower(hex(randomblob(32))),
                    claimed_at = ?
                WHERE delivery_id = (
                    SELECT delivery_id
                    FROM seen_delivery
                    WHERE state = 'pending'
                       OR (state = 'processing' AND claimed_at <= ?)
                    ORDER BY received_at, delivery_id
                    LIMIT 1
                )
                RETURNING delivery_id, event_name, payload, payload_digest,
                          received_at, claim_token
            `,
            )
            .get(worker, now, staleBefore) as ClaimedDeliveryRow | undefined;
        if (row === undefined) return undefined;
        return {
            deliveryId: row.delivery_id as DeliveryGuid,
            eventName: row.event_name,
            payload: Buffer.from(row.payload),
            payloadDigest: row.payload_digest,
            receivedAt: row.received_at,
            worker,
            claimedAt: now,
            claimToken: row.claim_token,
        };
    }

    /** Complete only work still owned by this token, clearing payload bytes atomically. */
    completeDelivery(
        deliveryId: DeliveryGuid,
        claimToken: string,
        completedAt: string,
    ): CompleteDeliveryResult {
        assertDeliveryGuid(deliveryId);
        assertNonEmpty(claimToken, "claimToken");
        assertUtcInstant(completedAt, "completedAt");
        const result = this.db
            .prepare(
                `
                UPDATE seen_delivery
                SET state = 'done', payload = NULL, claim_worker = NULL,
                    claim_token = NULL, claimed_at = NULL, completed_at = ?
                WHERE delivery_id = ? AND state = 'processing' AND claim_token = ?
            `,
            )
            .run(completedAt, deliveryId, claimToken);
        return result.changes === 1 ? { outcome: "completed" } : { outcome: "notOwned" };
    }

    /** Return only this token's in-flight work to the pending queue. */
    releaseDelivery(deliveryId: DeliveryGuid, claimToken: string): ReleaseDeliveryResult {
        assertDeliveryGuid(deliveryId);
        assertNonEmpty(claimToken, "claimToken");
        const result = this.db
            .prepare(
                `
                UPDATE seen_delivery
                SET state = 'pending', claim_worker = NULL,
                    claim_token = NULL, claimed_at = NULL
                WHERE delivery_id = ? AND state = 'processing' AND claim_token = ?
            `,
            )
            .run(deliveryId, claimToken);
        return result.changes === 1 ? { outcome: "released" } : { outcome: "notOwned" };
    }

    /** Requeue stale processing rows without exposing their payloads. */
    requeueStuckDeliveries(claimedBefore: string): DeliveryGuid[] {
        assertUtcInstant(claimedBefore, "claimedBefore");
        const rows = this.db
            .prepare(
                `
                UPDATE seen_delivery
                SET state = 'pending', claim_worker = NULL,
                    claim_token = NULL, claimed_at = NULL
                WHERE state = 'processing' AND claimed_at <= ?
                RETURNING delivery_id
            `,
            )
            .all(claimedBefore) as { delivery_id: string }[];
        return rows
            .map((row) => row.delivery_id as DeliveryGuid)
            .sort((left, right) => left.localeCompare(right));
    }

    // ── Effect journal (detector) ───────────────────────────────────

    /**
     * Record intent BEFORE the call — the row that survives any crash
     * after it. One upsert: a `done` row is immutable (acknowledged
     * history never regresses to `sent`), and re-declaring a still-open
     * call increments a durable `attempt` counter —
     * FINDING(store-journal-attempts), D42. Pre-ratification store
     * files are not migrated.
     */
    intent(
        effectId: string,
        seq: number,
        intent: string,
        at: string,
        /**
         * REQUIRED, with no default: the recovery loop compares this
         * against the current plan's revision, so a caller that omitted
         * it would journal a value matching no real plan and surface
         * every effect as unresolved. Fail-closed, but for a reason no
         * operator could act on.
         */
        revision: string,
    ): void {
        assertUtcInstant(at, "at");
        this.db
            .prepare(
                `
                INSERT INTO effect_journal VALUES (?, ?, ?, 'sent', ?, 1, ?)
                ON CONFLICT(effect_id, call_seq) DO UPDATE
                    SET attempt = attempt + 1,
                        at = excluded.at,
                        intent = excluded.intent,
                        revision = excluded.revision
                    WHERE effect_journal.status != 'done'
            `,
            )
            .run(effectId, seq, intent, at, revision);
    }

    /**
     * Mark a call done. Returns whether a row was actually marked —
     * `false` means no such intent row exists, which is a caller bug
     * worth noticing, not a state the store absorbs silently.
     */
    done(effectId: string, seq: number, at: string): boolean {
        assertUtcInstant(at, "at");
        const result = this.db
            .prepare(
                "UPDATE effect_journal SET status = 'done', at = ? WHERE effect_id = ? AND call_seq = ?",
            )
            .run(at, effectId, seq);
        return result.changes === 1;
    }

    /**
     * Classify an effect from the journal alone — the left half of the
     * storage decision's recovery loop. `planLength` is the declared
     * call count of the effect's plan (contract.md §5); the journal
     * cannot know completion without it.
     *
     * Classification reads the highest-seq row only, which assumes the
     * caller discipline the executor enforces: calls run sequentially,
     * and seq N+1 is never declared while seq N is still `sent`. The
     * store does not police that invariant.
     */
    effectState(effectId: string, planLength: number): EffectState {
        const rows = this.db
            .prepare(
                "SELECT call_seq, intent, status, attempt, revision FROM effect_journal WHERE effect_id = ? ORDER BY call_seq DESC LIMIT 1",
            )
            .all(effectId) as {
            call_seq: number;
            intent: string;
            status: string;
            attempt: number;
            revision: string;
        }[];
        const last = rows[0];
        if (last === undefined) return { state: "neverStarted" };
        if (last.status === "sent") {
            return {
                state: "sentUnknown",
                seq: last.call_seq,
                intent: last.intent,
                attempt: last.attempt,
                revision: last.revision,
            };
        }
        if (last.call_seq >= planLength) {
            return {
                state: "complete",
                lastDoneSeq: last.call_seq,
                revision: last.revision,
            };
        }
        return {
            state: "midSequence",
            lastDoneSeq: last.call_seq,
            revision: last.revision,
        };
    }

    /**
     * The sweep's worklist — every open `sent` row at or before
     * `before`, across all effects: the intents whose outcomes the
     * recovery loop must resolve against GitHub. Read-only;
     * resolution itself stays with `done`/`intent` and the resolver.
     */
    openIntents(before: string): OpenIntent[] {
        assertUtcInstant(before, "before");
        const rows = this.db
            .prepare(
                `
                SELECT effect_id, call_seq, intent, attempt, at FROM effect_journal
                WHERE status = 'sent' AND at <= ?
                ORDER BY at
            `,
            )
            .all(before) as {
            effect_id: string;
            call_seq: number;
            intent: string;
            attempt: number;
            at: string;
        }[];
        return rows.map((r) => ({
            effectId: r.effect_id,
            seq: r.call_seq,
            intent: r.intent,
            attempt: r.attempt,
            at: r.at,
        }));
    }

    // ── Claims (lock) ───────────────────────────────────────────────

    /**
     * One-winner LEASE on an effect — the 6.5 race serializer, with
     * atomic stale takeover so a crashed holder cannot deadlock the
     * effect. A fresh claim inserts; a claim with `at <= staleBefore`
     * is taken over in the same upsert (no delete-then-claim window).
     * Returns true iff the caller now holds it; non-contention
     * failures THROW — `false` strictly means "a live worker holds it".
     *
     * FINDING(store-claim-lease), D41: a lease can be stolen from a
     * live worker that outlives it — the journal plus GitHub re-read
     * stays the correctness layer. Lease duration is an ops decision.
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
     * Release a claim on clean completion — deletes only the caller's
     * OWN row, so releasing after your lease was stolen is a safe
     * no-op. Returns whether a row was actually released; `false`
     * means you no longer held it, which a caller may want to log.
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
            .prepare("INSERT OR IGNORE INTO schedule VALUES (?, ?, ?, 'pending', NULL, NULL)")
            .run(scheduleId, dueAt, effect);
    }

    /**
     * Atomically claim every due pending schedule (pending → running,
     * stamped with `claimed_at = now`) and return the claimed rows.
     * Two instances calling concurrently split the due set; a restart
     * mid-processing does NOT re-fire a running schedule — redriving
     * stuck `running` rows is `requeueStuck`, driven by the
     * reconciliation sweep, deliberately not this method.
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
                RETURNING schedule_id, due_at, effect, claim_token
            `,
            )
            .all(now, now) as {
            schedule_id: string;
            due_at: string;
            effect: string;
            claim_token: string;
        }[];
        return rows.map((r) => ({
            scheduleId: r.schedule_id,
            dueAt: r.due_at,
            effect: r.effect,
            claimToken: r.claim_token,
        }));
    }

    /**
     * The sweep's redrive — FINDING(store-sweep-api), D43: atomically
     * return stuck `running` schedules (claimed at or before
     * `claimedBefore`) to `pending`. Stuckness is claim age, never due
     * time, so backlog catch-up is not stolen from; requeued work
     * re-fires through `claimDue` — no parallel firing mechanism. A
     * slow-but-alive handler can be requeued and fire twice, harmless
     * on D41's grounds. The threshold is the sweep's ops decision.
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
            .all(claimedBefore) as { schedule_id: string; due_at: string; effect: string }[];
        return rows.map((r) => ({
            scheduleId: r.schedule_id,
            dueAt: r.due_at,
            effect: r.effect,
        }));
    }

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

    // ── Retention (the sweep's pruning half — D43's adopted windows) ─

    /**
     * Delete only completed delivery identities whose completion time
     * reached the retention boundary. Pending and processing payloads
     * are never eligible, regardless of their age.
     */
    pruneCompletedDeliveries(before: string): number {
        assertUtcInstant(before, "before");
        return this.db
            .prepare(
                `
                DELETE FROM seen_delivery
                WHERE state = 'done' AND completed_at <= ?
            `,
            )
            .run(before).changes as number;
    }

    /**
     * Delete DONE journal rows at or before `before`. Open (`sent`)
     * rows are never pruned — an unresolved effect stays visible until
     * the recovery loop or an operator closes it, however old.
     */
    pruneDoneJournal(before: string): number {
        assertUtcInstant(before, "before");
        return this.db
            .prepare("DELETE FROM effect_journal WHERE status = 'done' AND at <= ?")
            .run(before).changes as number;
    }

    close(): void {
        this.db.close();
    }
}
