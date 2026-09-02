/**
 * Seeded interleaving stress for the lifecycle production actually runs —
 * the example suites test SPECIFIC orderings of accept/claim/release/
 * complete; these drive hundreds of RANDOM interleavings across two Store
 * instances on one file, checking every durable row against a reference
 * model after every step. Deterministic: a failure names its seed and its
 * step, and replaying the seed replays the exact interleaving.
 *
 * The model is a per-delivery state machine — pending with its attempt
 * count and backoff instant, processing under one worker's token, done,
 * dead-lettered — plus the one global rule the whole queue rests on: a
 * claim takes the oldest ELIGIBLE row, receipt time then GUID, where
 * eligible means pending with its backoff elapsed or processing past the
 * staleness window. Rows are read back through a third, read-only
 * connection, because the store deliberately exposes no way to look at a
 * payload it has not handed out under a claim.
 *
 * `STRESS_SEEDS=n` widens the seed list for a long run; the default ten is
 * what fits a normal suite, since every write here is a real fsync.
 */

import { createHash } from "node:crypto";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { asDeliveryGuid, type DeliveryGuid } from "@hiero-hackers/automation-core";
import { withTempDir } from "@hiero-hackers/automation-testkit";
import { Store } from "../src/store.js";
import type {
    AcceptDeliveryResult,
    CompleteDeliveryWithReportResult,
    DeliveryState,
} from "../src/deliveries.js";

/** mulberry32 — tiny deterministic PRNG. */
function prng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const iso = (ms: number) => new Date(ms).toISOString();
const MINUTE = 60_000;
const STALE = 5 * MINUTE;
const START = Date.parse("2026-08-01T00:00:00.000Z");
const EVENT = "issues";
const OTHER_EVENT = "pull_request";

/**
 * A token no claim can ever mint: real ones are 64 lowercase hex
 * characters, so this stands in for "the caller holds nothing".
 */
const NO_TOKEN = "not-a-claim-token";

const requestedSeeds = Number.parseInt(process.env["STRESS_SEEDS"] ?? "", 10);
const SEEDS = Array.from(
    { length: Number.isInteger(requestedSeeds) && requestedSeeds > 0 ? requestedSeeds : 10 },
    (_, index) => index + 1,
);

function guid(raw: string): DeliveryGuid {
    const deliveryId = asDeliveryGuid(raw);
    if (deliveryId === undefined) throw new Error("invalid test delivery GUID");
    return deliveryId;
}

// Same length and same shape, differing only in the trailing digits, so
// SQLite's binary GUID order and the model's string order cannot disagree.
const IDS = Array.from({ length: 10 }, (_, index) =>
    guid(`00000000-0000-0000-0000-${String(index).padStart(12, "0")}`),
);

const canonicalPayload = (id: DeliveryGuid) => Buffer.from(`payload for ${id}`);
const rewrittenPayload = (id: DeliveryGuid) => Buffer.from(`rewritten payload for ${id}`);
const digestOf = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const canonicalReport = (id: DeliveryGuid) => JSON.stringify({ deliveryId: id, verdict: "ok" });
const revisedReport = (id: DeliveryGuid) => JSON.stringify({ deliveryId: id, verdict: "revised" });

/**
 * One delivery as the model believes it stands.
 *
 * `previousToken` is the token a takeover, release or completion retired.
 * It is the realistic wrong token to offer — the one a worker that lost
 * its delivery would still be holding — and every operation must refuse
 * it.
 */
interface ModelDelivery {
    receivedAt: string;
    state: DeliveryState;
    attempts: number;
    retryNotBefore: string | null;
    worker: string | null;
    claimToken: string | null;
    previousToken: string | null;
    claimedAt: string | null;
    completedAt: string | null;
    reportToken: string | null;
    reportJson: string | null;
}

type Model = Map<DeliveryGuid, ModelDelivery>;

/** The row an accepted delivery starts as: queued, unattempted, unclaimed. */
function queued(receivedAt: string): ModelDelivery {
    return {
        receivedAt,
        state: "pending",
        attempts: 0,
        retryNotBefore: null,
        worker: null,
        claimToken: null,
        previousToken: null,
        claimedAt: null,
        completedAt: null,
        reportToken: null,
        reportJson: null,
    };
}

/** SQLite's BINARY collation, which is what every `ORDER BY` here uses. */
const compare = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

/** Whether a claim at `now`, with this staleness window, may take this row. */
function isClaimable(delivery: ModelDelivery, now: string, staleBefore: string): boolean {
    if (delivery.state === "pending") {
        return delivery.retryNotBefore === null || delivery.retryNotBefore <= now;
    }
    if (delivery.state === "processing") {
        return delivery.claimedAt !== null && delivery.claimedAt <= staleBefore;
    }
    return false;
}

/** The delivery a claim wins: oldest eligible by receipt, GUID breaking ties. */
function nextClaim(model: Model, now: string, staleBefore: string): DeliveryGuid | undefined {
    const eligible = [...model].filter(([, delivery]) => isClaimable(delivery, now, staleBefore));
    eligible.sort(([leftId, left], [rightId, right]) =>
        left.receivedAt === right.receivedAt
            ? compare(leftId, rightId)
            : compare(left.receivedAt, right.receivedAt),
    );
    return eligible[0]?.[0];
}

/** The intake classification the model predicts for these offered bytes. */
function expectedIntake(
    known: ModelDelivery | undefined,
    eventName: string,
    digest: string,
    canonicalDigest: string,
): AcceptDeliveryResult {
    if (known === undefined) {
        return { outcome: "accepted", state: "pending", payloadDigest: digest };
    }
    const eventNameMismatch = eventName !== EVENT;
    const payloadMismatch = digest !== canonicalDigest;
    if (eventNameMismatch || payloadMismatch) {
        return { outcome: "conflict", state: known.state, eventNameMismatch, payloadMismatch };
    }
    return { outcome: "duplicate", state: known.state, payloadDigest: canonicalDigest };
}

/**
 * What the store owes a completion attempt.
 *
 * Identity is checked before state, so a delivery that was never accepted
 * and one offered the wrong digest answer alike. The `reportConflict` a
 * still-processing row with a filed report would draw is unreachable
 * without fault injection — that pairing is exactly the torn commit
 * `delivery-finalization.test.ts` injects — so this model never predicts
 * it, and would fail the run if the store produced it.
 */
function expectedCompletion(
    delivery: ModelDelivery | undefined,
    identityMatches: boolean,
    claimToken: string,
    reportJson: string,
): CompleteDeliveryWithReportResult {
    if (delivery === undefined || !identityMatches) return { outcome: "identityMismatch" };
    if (delivery.state === "done") {
        if (delivery.reportToken !== claimToken) return { outcome: "notOwned" };
        return delivery.reportJson === reportJson
            ? { outcome: "alreadyCompleted" }
            : { outcome: "reportConflict" };
    }
    if (delivery.claimToken !== claimToken) return { outcome: "notOwned" };
    return { outcome: "completed" };
}

interface StoredRow {
    readonly delivery_id: string;
    readonly state: DeliveryState;
    readonly attempts: number;
    readonly retry_not_before: string | null;
    readonly claim_worker: string | null;
    readonly claim_token: string | null;
    readonly claimed_at: string | null;
    readonly completed_at: string | null;
    readonly payload_kept: number;
}

/**
 * Every promise the model makes about durable state, checked at once: the
 * row set, each row's lifecycle fields and claim ownership, the terminal
 * CHECK constraints the v5 schema pins — `done` drops its payload,
 * `failed` keeps its payload and a counted attempt — and the two
 * projections that read those rows back out.
 */
function expectAgreement(db: DatabaseSync, store: Store, model: Model, where: string): void {
    const rows = db
        .prepare(
            `
            SELECT delivery_id, state, attempts, retry_not_before, claim_worker,
                   claim_token, claimed_at, completed_at,
                   payload IS NOT NULL AS payload_kept
            FROM seen_delivery
            ORDER BY delivery_id
        `,
        )
        .all() as unknown as StoredRow[];

    expect(
        rows.map((row) => row.delivery_id),
        `${where} — accepted delivery set`,
    ).toEqual([...model.keys()].sort());

    for (const row of rows) {
        const delivery = model.get(row.delivery_id as DeliveryGuid)!;
        expect(
            {
                state: row.state,
                attempts: row.attempts,
                retryNotBefore: row.retry_not_before,
                worker: row.claim_worker,
                claimToken: row.claim_token,
                claimedAt: row.claimed_at,
                completedAt: row.completed_at,
                payloadKept: row.payload_kept === 1,
            },
            `${where} — row ${row.delivery_id}`,
        ).toEqual({
            state: delivery.state,
            attempts: delivery.attempts,
            retryNotBefore: delivery.retryNotBefore,
            worker: delivery.worker,
            claimToken: delivery.claimToken,
            claimedAt: delivery.claimedAt,
            completedAt: delivery.completedAt,
            // The terminal half of the v5 CHECK: only a completed
            // delivery gives up its bytes; a dead letter is the last
            // copy of something GitHub will not send again.
            payloadKept: delivery.state !== "done",
        });
        if (row.state === "failed") {
            expect(
                row.attempts,
                `${where} — dead letter ${row.delivery_id} spent attempts`,
            ).toBeGreaterThan(0);
        }
    }

    const reports = db
        .prepare(
            "SELECT delivery_id, claim_token, report_json FROM delivery_report ORDER BY delivery_id",
        )
        .all();
    expect(reports, `${where} — canonical reports`).toEqual(
        [...model]
            .filter(([, delivery]) => delivery.reportJson !== null)
            .sort(([leftId], [rightId]) => compare(leftId, rightId))
            .map(([id, delivery]) => ({
                delivery_id: id,
                claim_token: delivery.reportToken,
                report_json: delivery.reportJson,
            })),
    );

    expect(store.deadLetteredDeliveries(), `${where} — dead letters`).toEqual(
        [...model]
            .filter(([, delivery]) => delivery.state === "failed")
            .sort(([leftId, left], [rightId, right]) =>
                left.completedAt === right.completedAt
                    ? compare(leftId, rightId)
                    : compare(left.completedAt ?? "", right.completedAt ?? ""),
            )
            .map(([id, delivery]) => ({
                deliveryId: id,
                eventName: EVENT,
                payloadDigest: digestOf(canonicalPayload(id)),
                receivedAt: delivery.receivedAt,
                attempts: delivery.attempts,
                failedAt: delivery.completedAt,
            })),
    );
}

describe("deliveries under random interleaving: store ≡ per-delivery lifecycle model", () => {
    it.each(SEEDS)("seed %i — 200 steps, two instances, ten deliveries", (seed) => {
        withTempDir("delivery-stress-", (dir) => {
            const path = join(dir, "store.sqlite");
            const a = new Store(path);
            const b = new Store(path);
            // withTempDir owns the directory; the three handles are still
            // ours, and closing them before the removal is what keeps this
            // clean. The reader is read-only by discipline: the store hands
            // out no way to see a payload it has not claimed out.
            const reader = new DatabaseSync(path);
            try {
                const rand = prng(seed);
                const stores = [a, b];
                const workers = ["w1", "w2"];
                const MAX_ATTEMPTS = 2;
                // Receipt times collide on purpose, so the GUID tiebreak in
                // the claim's ORDER BY is exercised rather than assumed.
                const receipts = new Map(
                    IDS.map((id) => [id, iso(START + Math.floor(rand() * 4) * MINUTE)]),
                );
                const model: Model = new Map();
                let nowMs = START + 10 * MINUTE;

                // Two deliveries are already queued, so the very first claim
                // has something to win and the run does not open on misses.
                for (const id of IDS.slice(0, 2)) {
                    const receivedAt = receipts.get(id)!;
                    a.acceptDelivery({
                        deliveryId: id,
                        eventName: EVENT,
                        payload: canonicalPayload(id),
                        receivedAt,
                    });
                    model.set(id, queued(receivedAt));
                }

                for (let step = 0; step < 200; step++) {
                    nowMs += Math.floor(rand() * 2 * MINUTE);
                    const now = iso(nowMs);
                    const store = stores[Math.floor(rand() * stores.length)]!;
                    const worker = workers[Math.floor(rand() * workers.length)]!;
                    const anyId = IDS[Math.floor(rand() * IDS.length)]!;
                    // Release, failure and completion mostly target work
                    // somebody is actually holding — a uniform pick would
                    // spend the run on refusals and never reach a dead letter.
                    const held = [...model]
                        .filter(([, delivery]) => delivery.state === "processing")
                        .map(([id]) => id);
                    const target =
                        rand() < 0.75 && held.length > 0
                            ? held[Math.floor(rand() * held.length)]!
                            : IDS[Math.floor(rand() * IDS.length)]!;
                    const roll = rand();
                    let where = `seed ${String(seed)} step ${String(step)}`;

                    if (roll < 0.18) {
                        // Intake: fresh bytes, an exact resend, or a resend
                        // that disagrees with what was stored under the GUID.
                        where += " accept";
                        const known = model.get(anyId);
                        const variant = known === undefined ? 1 : rand();
                        const eventName = variant < 0.16 ? OTHER_EVENT : EVENT;
                        const payload =
                            variant >= 0.16 && variant < 0.4
                                ? rewrittenPayload(anyId)
                                : canonicalPayload(anyId);
                        const receivedAt = receipts.get(anyId)!;
                        const result = store.acceptDelivery({
                            deliveryId: anyId,
                            eventName,
                            payload,
                            receivedAt,
                        });
                        expect(result, where).toEqual(
                            expectedIntake(
                                known,
                                eventName,
                                digestOf(payload),
                                digestOf(canonicalPayload(anyId)),
                            ),
                        );
                        if (result.outcome === "accepted") model.set(anyId, queued(receivedAt));
                    } else if (roll < 0.5) {
                        // Claim: the oldest eligible row, or a stale takeover,
                        // decided inside one statement.
                        where += " claim";
                        const staleBefore = iso(nowMs - STALE);
                        const predicted = nextClaim(model, now, staleBefore);
                        const claimed = store.claimNextDelivery(worker, now, staleBefore);
                        expect(claimed?.deliveryId, `${where} — winner`).toBe(predicted);
                        if (claimed !== undefined) {
                            const delivery = model.get(claimed.deliveryId)!;
                            expect(
                                {
                                    eventName: claimed.eventName,
                                    payload: Buffer.from(claimed.payload).toString("utf8"),
                                    payloadDigest: claimed.payloadDigest,
                                    receivedAt: claimed.receivedAt,
                                    worker: claimed.worker,
                                    claimedAt: claimed.claimedAt,
                                    attempts: claimed.attempts,
                                },
                                `${where} — claimed row`,
                            ).toEqual({
                                eventName: EVENT,
                                payload: canonicalPayload(claimed.deliveryId).toString("utf8"),
                                payloadDigest: digestOf(canonicalPayload(claimed.deliveryId)),
                                receivedAt: delivery.receivedAt,
                                worker,
                                claimedAt: now,
                                // Attempts count the failures BEFORE this
                                // claim, so a takeover does not spend one.
                                attempts: delivery.attempts,
                            });
                            delivery.previousToken = delivery.claimToken ?? delivery.previousToken;
                            delivery.state = "processing";
                            delivery.worker = worker;
                            delivery.claimToken = claimed.claimToken;
                            delivery.claimedAt = now;
                            delivery.retryNotBefore = null;
                        }
                    } else if (roll < 0.6) {
                        // Clean release: back to the queue, attempts untouched.
                        where += " release";
                        const delivery = model.get(target);
                        const token =
                            (rand() < 0.75 ? delivery?.claimToken : delivery?.previousToken) ??
                            NO_TOKEN;
                        const owns =
                            delivery !== undefined &&
                            delivery.state === "processing" &&
                            delivery.claimToken === token;
                        expect(store.releaseDelivery(target, token), where).toEqual({
                            outcome: owns ? "released" : "notOwned",
                        });
                        if (owns) {
                            delivery.previousToken = delivery.claimToken;
                            delivery.state = "pending";
                            delivery.worker = null;
                            delivery.claimToken = null;
                            delivery.claimedAt = null;
                        }
                    } else if (roll < 0.74) {
                        // Counted failure: a backoff, or the dead letter the
                        // caller's budget ran out on.
                        where += " fail";
                        const delivery = model.get(target);
                        const token =
                            (rand() < 0.75 ? delivery?.claimToken : delivery?.previousToken) ??
                            NO_TOKEN;
                        const retryNotBefore = iso(nowMs + Math.floor(rand() * 3 * MINUTE));
                        const owns =
                            delivery !== undefined &&
                            delivery.state === "processing" &&
                            delivery.claimToken === token;
                        const attempts = owns ? delivery.attempts + 1 : 0;
                        const result = store.releaseDeliveryAfterFailure({
                            deliveryId: target,
                            claimToken: token,
                            failedAt: now,
                            retryNotBefore,
                            maxAttempts: MAX_ATTEMPTS,
                        });
                        expect(result, where).toEqual(
                            !owns
                                ? { outcome: "notOwned" }
                                : attempts >= MAX_ATTEMPTS
                                  ? { outcome: "deadLettered", attempts }
                                  : { outcome: "retryScheduled", attempts, retryNotBefore },
                        );
                        if (owns) {
                            const deadLettered = attempts >= MAX_ATTEMPTS;
                            delivery.previousToken = delivery.claimToken;
                            delivery.state = deadLettered ? "failed" : "pending";
                            delivery.attempts = attempts;
                            delivery.worker = null;
                            delivery.claimToken = null;
                            delivery.claimedAt = null;
                            delivery.completedAt = deadLettered ? now : null;
                            delivery.retryNotBefore = deadLettered ? null : retryNotBefore;
                        }
                    } else if (roll < 0.87) {
                        // Completion: one report and one done row, provable by
                        // token and identity or refused with a reason.
                        where += " complete";
                        const delivery = model.get(target);
                        const token =
                            (rand() < 0.75 ? delivery?.claimToken : delivery?.previousToken) ??
                            NO_TOKEN;
                        const identityMatches = rand() >= 0.15;
                        const reportJson =
                            rand() < 0.3 ? revisedReport(target) : canonicalReport(target);
                        const result = store.completeDeliveryWithReport({
                            deliveryId: target,
                            eventName: EVENT,
                            payloadDigest: identityMatches
                                ? digestOf(canonicalPayload(target))
                                : digestOf(rewrittenPayload(target)),
                            claimToken: token,
                            reportJson,
                            completedAt: now,
                        });
                        expect(result, where).toEqual(
                            expectedCompletion(delivery, identityMatches, token, reportJson),
                        );
                        if (result.outcome === "completed" && delivery !== undefined) {
                            delivery.previousToken = delivery.claimToken;
                            delivery.state = "done";
                            delivery.worker = null;
                            delivery.claimToken = null;
                            delivery.claimedAt = null;
                            delivery.completedAt = now;
                            delivery.reportToken = token;
                            delivery.reportJson = reportJson;
                        }
                    } else {
                        // The sweep: every processing row older than the
                        // window goes back, and nothing else moves.
                        where += " requeue";
                        const claimedBefore = iso(nowMs - Math.floor(rand() * 2 * STALE));
                        const expected = [...model]
                            .filter(
                                ([, delivery]) =>
                                    delivery.state === "processing" &&
                                    delivery.claimedAt !== null &&
                                    delivery.claimedAt <= claimedBefore,
                            )
                            .map(([id]) => id)
                            .sort();
                        expect(store.requeueStuckDeliveries(claimedBefore), where).toEqual(
                            expected,
                        );
                        for (const id of expected) {
                            const delivery = model.get(id)!;
                            delivery.previousToken = delivery.claimToken;
                            delivery.state = "pending";
                            delivery.worker = null;
                            delivery.claimToken = null;
                            delivery.claimedAt = null;
                        }
                    }

                    expectAgreement(reader, store, model, where);
                }

                // The headline invariant: drain the queue at an instant late
                // enough to make every claim stale, and exactly the live
                // deliveries come out. A done row and a dead letter are
                // claimable by nothing, ever again — and no row comes out
                // twice, since each drain claim stamps a fresh, unstale time.
                const drainAt = nowMs + 10 * STALE;
                const drainStale = iso(nowMs + 5 * STALE);
                const drained: DeliveryGuid[] = [];
                for (let attempt = 0; attempt <= model.size; attempt++) {
                    const claimed = a.claimNextDelivery("drain", iso(drainAt), drainStale);
                    if (claimed === undefined) break;
                    drained.push(claimed.deliveryId);
                }
                expect(drained.sort(), `seed ${String(seed)} — drained`).toEqual(
                    [...model]
                        .filter(
                            ([, delivery]) =>
                                delivery.state === "pending" || delivery.state === "processing",
                        )
                        .map(([id]) => id)
                        .sort(),
                );
            } finally {
                reader.close();
                a.close();
                b.close();
            }
        });
    });
});

describe("retry budgets under random interleaving: attempts never exceed the cap", () => {
    it.each(SEEDS)("seed %i — 150 steps, two instances, a three-attempt budget", (seed) => {
        withTempDir("delivery-budget-", (dir) => {
            const path = join(dir, "store.sqlite");
            const a = new Store(path);
            const b = new Store(path);
            const reader = new DatabaseSync(path);
            try {
                const rand = prng(seed);
                const stores = [a, b];
                const workers = ["w1", "w2"];
                const MAX_ATTEMPTS = 3;
                const model: Model = new Map();
                let nowMs = START;

                // Every delivery is queued up front, and the pool is small
                // enough that a budget is actually spent to the last attempt:
                // this run is about repeated failure, not about intake.
                for (const id of IDS.slice(0, 6)) {
                    const receivedAt = iso(START + Math.floor(rand() * 4) * MINUTE);
                    a.acceptDelivery({
                        deliveryId: id,
                        eventName: EVENT,
                        payload: canonicalPayload(id),
                        receivedAt,
                    });
                    model.set(id, queued(receivedAt));
                }

                for (let step = 0; step < 150; step++) {
                    nowMs += Math.floor(rand() * 2 * MINUTE);
                    const now = iso(nowMs);
                    const store = stores[Math.floor(rand() * stores.length)]!;
                    const worker = workers[Math.floor(rand() * workers.length)]!;
                    const held = [...model]
                        .filter(([, delivery]) => delivery.state === "processing")
                        .map(([id]) => id);
                    const roll = rand();
                    let where = `seed ${String(seed)} step ${String(step)}`;

                    if (roll < 0.45 || held.length === 0) {
                        // Claim, so there is something to fail.
                        where += " claim";
                        const staleBefore = iso(nowMs - STALE);
                        const predicted = nextClaim(model, now, staleBefore);
                        const claimed = store.claimNextDelivery(worker, now, staleBefore);
                        expect(claimed?.deliveryId, `${where} — winner`).toBe(predicted);
                        if (claimed !== undefined) {
                            const delivery = model.get(claimed.deliveryId)!;
                            expect(claimed.attempts, `${where} — attempts so far`).toBe(
                                delivery.attempts,
                            );
                            delivery.previousToken = delivery.claimToken ?? delivery.previousToken;
                            delivery.state = "processing";
                            delivery.worker = worker;
                            delivery.claimToken = claimed.claimToken;
                            delivery.claimedAt = now;
                            delivery.retryNotBefore = null;
                        }
                    } else if (roll < 0.9) {
                        // Spend one attempt against a held delivery.
                        where += " fail";
                        const target = held[Math.floor(rand() * held.length)]!;
                        const delivery = model.get(target)!;
                        const token =
                            (rand() < 0.85 ? delivery.claimToken : delivery.previousToken) ??
                            NO_TOKEN;
                        const retryNotBefore = iso(nowMs + Math.floor(rand() * 3 * MINUTE));
                        const owns = delivery.claimToken === token;
                        const attempts = owns ? delivery.attempts + 1 : 0;
                        const result = store.releaseDeliveryAfterFailure({
                            deliveryId: target,
                            claimToken: token,
                            failedAt: now,
                            retryNotBefore,
                            maxAttempts: MAX_ATTEMPTS,
                        });
                        expect(result, where).toEqual(
                            !owns
                                ? { outcome: "notOwned" }
                                : attempts >= MAX_ATTEMPTS
                                  ? { outcome: "deadLettered", attempts }
                                  : { outcome: "retryScheduled", attempts, retryNotBefore },
                        );
                        if (owns) {
                            const deadLettered = attempts >= MAX_ATTEMPTS;
                            delivery.previousToken = delivery.claimToken;
                            delivery.state = deadLettered ? "failed" : "pending";
                            delivery.attempts = attempts;
                            delivery.worker = null;
                            delivery.claimToken = null;
                            delivery.claimedAt = null;
                            delivery.completedAt = deadLettered ? now : null;
                            delivery.retryNotBefore = deadLettered ? null : retryNotBefore;
                        }
                    } else {
                        // A sweep in the middle of the budget must not reset it.
                        where += " requeue";
                        const claimedBefore = iso(nowMs - Math.floor(rand() * 2 * STALE));
                        const expected = [...model]
                            .filter(
                                ([, delivery]) =>
                                    delivery.state === "processing" &&
                                    delivery.claimedAt !== null &&
                                    delivery.claimedAt <= claimedBefore,
                            )
                            .map(([id]) => id)
                            .sort();
                        expect(store.requeueStuckDeliveries(claimedBefore), where).toEqual(
                            expected,
                        );
                        for (const id of expected) {
                            const delivery = model.get(id)!;
                            delivery.previousToken = delivery.claimToken;
                            delivery.state = "pending";
                            delivery.worker = null;
                            delivery.claimToken = null;
                            delivery.claimedAt = null;
                        }
                    }

                    expectAgreement(reader, store, model, where);
                }

                // The headline invariant: the cap is a total, not a per-claim
                // allowance. Nothing spends more than the budget, and a dead
                // letter is exactly a delivery that spent all of it.
                for (const [id, delivery] of model) {
                    expect(
                        delivery.attempts,
                        `seed ${String(seed)} — ${id} spent attempts`,
                    ).toBeLessThanOrEqual(MAX_ATTEMPTS);
                    if (delivery.state === "failed") {
                        expect(delivery.attempts, `seed ${String(seed)} — ${id} dead letter`).toBe(
                            MAX_ATTEMPTS,
                        );
                    }
                }
            } finally {
                reader.close();
                a.close();
                b.close();
            }
        });
    });
});
