/**
 * The store schema contract: recognize an owned database, migrate it in
 * order, and reject shapes or versions this package cannot interpret.
 * Operational state transitions remain in store.ts.
 */

import type { DatabaseSync } from "node:sqlite";
import { isDeepStrictEqual } from "node:util";

/** The newest storage schema this package can safely read and write. */
export const CURRENT_STORAGE_SCHEMA_VERSION = 5;

/** A deliberate interruption point after one migration step. */
export type MigrationFaultPoint =
    "migration:1" | "migration:2" | "migration:3" | "migration:4" | "migration:5";

type FaultInjector = (point: MigrationFaultPoint) => void;

const SEEN_DELIVERY_V1 = `
    CREATE TABLE seen_delivery (
        delivery_id TEXT PRIMARY KEY,
        at          TEXT NOT NULL
    )`;

const SEEN_DELIVERY_V3 = `
    CREATE TABLE seen_delivery (
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
    )`;

/**
 * Version 5 adds the two columns a bounded retry needs, and the terminal
 * state it ends in.
 *
 * `attempts` counts failed processing attempts, and `retry_not_before` is
 * the instant a `pending` row becomes claimable again — NULL meaning now.
 * Both are meaningless outside the pending queue, so the per-state CHECK
 * pins `retry_not_before` to NULL everywhere else.
 *
 * `failed` is dead-lettering: a delivery whose attempts reached the
 * caller's cap. It is claimable by nothing, and it KEEPS its payload,
 * unlike `done`. A completed delivery's bytes are superseded by its
 * canonical report; a dead-lettered one has no report, so those bytes are
 * the only surviving copy of a delivery GitHub will not send again, and
 * the only thing a manual redrive could work from.
 *
 * `completed_at` is the terminal instant for both terminal states: the
 * completion time of a `done` row, the dead-letter time of a `failed` one.
 */
const SEEN_DELIVERY_V5 = `
    CREATE TABLE seen_delivery (
        delivery_id   TEXT PRIMARY KEY,
        event_name    TEXT NOT NULL,
        payload       BLOB,
        payload_digest TEXT NOT NULL,
        received_at   TEXT NOT NULL,
        state         TEXT NOT NULL CHECK (state IN ('pending', 'processing', 'done', 'failed')),
        claim_worker  TEXT,
        claim_token   TEXT,
        claimed_at    TEXT,
        completed_at  TEXT,
        attempts      INTEGER NOT NULL CHECK (attempts >= 0),
        retry_not_before TEXT,
        CHECK (
            (state = 'pending' AND payload IS NOT NULL
                AND claim_worker IS NULL AND claim_token IS NULL
                AND claimed_at IS NULL AND completed_at IS NULL)
            OR
            (state = 'processing' AND payload IS NOT NULL
                AND claim_worker IS NOT NULL AND claim_token IS NOT NULL
                AND claimed_at IS NOT NULL AND completed_at IS NULL
                AND retry_not_before IS NULL)
            OR
            (state = 'done' AND payload IS NULL
                AND claim_worker IS NULL AND claim_token IS NULL
                AND claimed_at IS NULL AND completed_at IS NOT NULL
                AND retry_not_before IS NULL)
            OR
            (state = 'failed' AND payload IS NOT NULL
                AND claim_worker IS NULL AND claim_token IS NULL
                AND claimed_at IS NULL AND completed_at IS NOT NULL
                AND retry_not_before IS NULL AND attempts > 0)
        )
    )`;

const DELIVERY_WORK = `
    CREATE INDEX delivery_work
        ON seen_delivery(state, received_at, delivery_id)`;

const DELIVERY_REPORT_V4 = `
    CREATE TABLE delivery_report (
        delivery_id TEXT PRIMARY KEY,
        claim_token TEXT NOT NULL,
        report_json TEXT NOT NULL,
        completed_at TEXT NOT NULL
    )`;

const EFFECT_JOURNAL_V1 = `
    CREATE TABLE effect_journal (
        effect_id TEXT NOT NULL,
        call_seq  INTEGER NOT NULL,
        intent    TEXT NOT NULL,
        status    TEXT NOT NULL CHECK (status IN ('sent', 'done')),
        at        TEXT NOT NULL,
        PRIMARY KEY (effect_id, call_seq)
    )`;

const EFFECT_JOURNAL_V2 = `
    CREATE TABLE effect_journal (
        effect_id TEXT NOT NULL,
        call_seq  INTEGER NOT NULL,
        intent    TEXT NOT NULL,
        status    TEXT NOT NULL CHECK (status IN ('sent', 'done')),
        at        TEXT NOT NULL,
        attempt   INTEGER NOT NULL,
        revision  TEXT NOT NULL,
        PRIMARY KEY (effect_id, call_seq)
    )`;

const OPEN_INTENTS = `
    CREATE INDEX open_intents
        ON effect_journal(at) WHERE status = 'sent'`;

const EFFECT_CLAIM = `
    CREATE TABLE effect_claim (
        effect_id TEXT PRIMARY KEY,
        worker    TEXT NOT NULL,
        at        TEXT NOT NULL
    )`;

const SCHEDULE_V1 = `
    CREATE TABLE schedule (
        schedule_id TEXT PRIMARY KEY,
        due_at      TEXT NOT NULL,
        effect      TEXT NOT NULL,
        status      TEXT NOT NULL CHECK (status IN ('pending', 'running', 'done'))
    )`;

const SCHEDULE_V2 = `
    CREATE TABLE schedule (
        schedule_id TEXT PRIMARY KEY,
        due_at      TEXT NOT NULL,
        effect      TEXT NOT NULL,
        status      TEXT NOT NULL CHECK (status IN ('pending', 'running', 'done')),
        claimed_at  TEXT,
        claim_token TEXT
    )`;

const SCHEMA_BY_VERSION = {
    1: {
        effect_claim: EFFECT_CLAIM,
        effect_journal: EFFECT_JOURNAL_V1,
        schedule: SCHEDULE_V1,
        seen_delivery: SEEN_DELIVERY_V1,
    },
    2: {
        effect_claim: EFFECT_CLAIM,
        effect_journal: EFFECT_JOURNAL_V2,
        open_intents: OPEN_INTENTS,
        schedule: SCHEDULE_V2,
        seen_delivery: SEEN_DELIVERY_V1,
    },
    3: {
        delivery_work: DELIVERY_WORK,
        effect_claim: EFFECT_CLAIM,
        effect_journal: EFFECT_JOURNAL_V2,
        open_intents: OPEN_INTENTS,
        schedule: SCHEDULE_V2,
        seen_delivery: SEEN_DELIVERY_V3,
    },
    4: {
        delivery_report: DELIVERY_REPORT_V4,
        delivery_work: DELIVERY_WORK,
        effect_claim: EFFECT_CLAIM,
        effect_journal: EFFECT_JOURNAL_V2,
        open_intents: OPEN_INTENTS,
        schedule: SCHEDULE_V2,
        seen_delivery: SEEN_DELIVERY_V3,
    },
    5: {
        delivery_report: DELIVERY_REPORT_V4,
        delivery_work: DELIVERY_WORK,
        effect_claim: EFFECT_CLAIM,
        effect_journal: EFFECT_JOURNAL_V2,
        open_intents: OPEN_INTENTS,
        schedule: SCHEDULE_V2,
        seen_delivery: SEEN_DELIVERY_V5,
    },
} as const;

type StorageSchemaVersion = keyof typeof SCHEMA_BY_VERSION;
type DetectedStorageSchemaVersion = 0 | Exclude<StorageSchemaVersion, 4 | 5>;

function schemaObjects(
    db: DatabaseSync,
): ReadonlyArray<{ readonly name: string; readonly sql: string }> {
    return db
        .prepare(
            `
        SELECT name, sql FROM sqlite_schema
        WHERE name NOT LIKE 'sqlite_%' AND sql IS NOT NULL
    `,
        )
        .all() as Array<{ name: string; sql: string }>;
}

function normalizeSql(sql: string): string {
    // Stryker disable next-line Regex: Replacing one whitespace character or one run at a time produces the same normalized SQL.
    return sql.replace(/\s+/g, "");
}

function schemaMatchesVersion(db: DatabaseSync, version: StorageSchemaVersion): boolean {
    const actual = Object.fromEntries(
        schemaObjects(db).map((object) => [object.name, normalizeSql(object.sql)]),
    );
    const expected = Object.fromEntries(
        Object.entries(SCHEMA_BY_VERSION[version]).map(([name, sql]) => [name, normalizeSql(sql)]),
    );
    return isDeepStrictEqual(actual, expected);
}

function assertSchemaMatchesVersion(db: DatabaseSync, version: StorageSchemaVersion): void {
    if (!schemaMatchesVersion(db, version)) {
        throw new Error(`storage schema does not match declared version ${String(version)}`);
    }
}

function detectUnversionedSchema(db: DatabaseSync): DetectedStorageSchemaVersion {
    if (schemaObjects(db).length === 0) return 0;
    for (const version of [1, 2, 3] as const) {
        if (schemaMatchesVersion(db, version)) return version;
    }
    throw new Error("unrecognized unversioned storage schema");
}

function setVersion(db: DatabaseSync, version: number): void {
    db.exec(`PRAGMA user_version = ${String(version)}`);
}

function createOriginalOperationalSchema(db: DatabaseSync): void {
    db.exec(`${SEEN_DELIVERY_V1};${EFFECT_JOURNAL_V1};${EFFECT_CLAIM};${SCHEDULE_V1};`);
}

function addRecoveryOwnershipState(db: DatabaseSync): void {
    db.exec(`
        ALTER TABLE effect_journal RENAME TO effect_journal_v1;
        ${EFFECT_JOURNAL_V2};
        INSERT INTO effect_journal
            SELECT effect_id, call_seq, intent, status, at, 1, 'legacy:unknown'
            FROM effect_journal_v1;
        DROP TABLE effect_journal_v1;

        ALTER TABLE schedule RENAME TO schedule_v1;
        ${SCHEDULE_V2};
        INSERT INTO schedule
            SELECT schedule_id, due_at, effect,
                   CASE status WHEN 'running' THEN 'pending' ELSE status END,
                   NULL, NULL
            FROM schedule_v1;
        DROP TABLE schedule_v1;

        ${OPEN_INTENTS};
    `);
}

function addDurableDeliveryWork(db: DatabaseSync): void {
    db.exec(`
        ALTER TABLE seen_delivery RENAME TO seen_delivery_v2;
        ${SEEN_DELIVERY_V3};
        INSERT INTO seen_delivery (
            delivery_id, event_name, payload, payload_digest, received_at,
            state, claim_worker, claim_token, claimed_at, completed_at
        )
        SELECT delivery_id, 'legacy.unknown', NULL,
               '0000000000000000000000000000000000000000000000000000000000000000',
               at, 'done', NULL, NULL, NULL, at
        FROM seen_delivery_v2;
        DROP TABLE seen_delivery_v2;

        ${DELIVERY_WORK};
    `);
}

function addCanonicalDeliveryReports(db: DatabaseSync): void {
    db.exec(`${DELIVERY_REPORT_V4};`);
}

/**
 * Existing rows start at zero attempts with no retry deadline: an attempt
 * this schema never counted cannot be reconstructed, and inventing one
 * would spend a delivery's retry budget on history nobody recorded.
 *
 * The rename carries `delivery_work` onto the old table, so dropping that
 * table drops the index and the last statement puts it back.
 */
function addBoundedDeliveryRetries(db: DatabaseSync): void {
    db.exec(`
        ALTER TABLE seen_delivery RENAME TO seen_delivery_v4;
        ${SEEN_DELIVERY_V5};
        INSERT INTO seen_delivery (
            delivery_id, event_name, payload, payload_digest, received_at,
            state, claim_worker, claim_token, claimed_at, completed_at,
            attempts, retry_not_before
        )
        SELECT delivery_id, event_name, payload, payload_digest, received_at,
               state, claim_worker, claim_token, claimed_at, completed_at,
               0, NULL
        FROM seen_delivery_v4;
        DROP TABLE seen_delivery_v4;

        ${DELIVERY_WORK};
    `);
}

const MIGRATIONS: ReadonlyArray<{
    readonly version: StorageSchemaVersion;
    readonly apply: (db: DatabaseSync) => void;
}> = [
    { version: 1, apply: createOriginalOperationalSchema },
    { version: 2, apply: addRecoveryOwnershipState },
    { version: 3, apply: addDurableDeliveryWork },
    { version: 4, apply: addCanonicalDeliveryReports },
    { version: 5, apply: addBoundedDeliveryRetries },
];

/** Read SQLite's native application schema version. */
export function readStorageSchemaVersion(db: DatabaseSync): number {
    const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
    return row.user_version;
}

/** Refuse a database whose declared format is newer than this package. */
export function assertSupportedStorageSchemaVersion(version: number): void {
    if (version > CURRENT_STORAGE_SCHEMA_VERSION) {
        throw new Error(
            `storage schema version ${String(version)} is newer than supported version ${String(CURRENT_STORAGE_SCHEMA_VERSION)}`,
        );
    }
}

/** Bring every recognized owned schema to the current version in one transaction. */
export function migrateStorageSchema(
    db: DatabaseSync,
    injectFault: FaultInjector = () => {},
): void {
    const declaredVersion = readStorageSchemaVersion(db);
    assertSupportedStorageSchemaVersion(declaredVersion);

    db.exec("BEGIN IMMEDIATE");
    try {
        let version = declaredVersion as 0 | StorageSchemaVersion;
        if (version === 0) {
            version = detectUnversionedSchema(db);
        } else {
            assertSchemaMatchesVersion(db, version);
        }

        for (const migration of MIGRATIONS) {
            if (migration.version <= version) continue;
            migration.apply(db);
            setVersion(db, migration.version);
            injectFault(`migration:${String(migration.version)}` as MigrationFaultPoint);
            version = migration.version;
        }

        assertSchemaMatchesVersion(db, CURRENT_STORAGE_SCHEMA_VERSION);
        db.exec("COMMIT");
    } catch (error) {
        try {
            db.exec("ROLLBACK");
        } catch {
            // Preserve the migration failure.
        }
        throw error;
    }
}
