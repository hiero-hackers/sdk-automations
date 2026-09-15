/**
 * The store schema contract: recognize an owned database, create it, and reject
 * shapes or versions this package cannot interpret. No store older than this
 * schema will ever be opened, so there is no history to convert here (D165).
 */

import type { DatabaseSync } from "node:sqlite";
import { isDeepStrictEqual } from "node:util";

/** The newest storage schema this package can safely read and write. */
export const CURRENT_STORAGE_SCHEMA_VERSION = 1;

/** A deliberate interruption point after one migration step. */
export type MigrationFaultPoint = "migration:1";

type FaultInjector = (point: MigrationFaultPoint) => void;

/**
 * `failed` is dead-lettering: claimable by nothing, and it KEEPS its payload.
 * `completed_at` is when a delivery finished, done or dead-lettered alike.
 */
const SEEN_DELIVERY = `
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

/**
 * One row per fact of an effect, folded to a state (D161).
 * `fact_id` is the ledger's order, so a fact never has to be found by its timestamp.
 */
const EFFECT_FACT = `
    CREATE TABLE effect_fact (
        fact_id     INTEGER PRIMARY KEY,
        effect_id   TEXT NOT NULL,
        seq         INTEGER NOT NULL,
        kind        TEXT NOT NULL CHECK (kind IN ('sent','unsent','landed','refused','abandoned','warned','reversed')),
        at          TEXT NOT NULL,
        revision    TEXT NOT NULL,
        capability  TEXT NOT NULL,
        repository  TEXT NOT NULL,
        item_kind   TEXT NOT NULL,
        item_number INTEGER NOT NULL,
        verb        TEXT,
        login       TEXT,
        code        TEXT,
        detail      TEXT,
        payload     TEXT
    )`;

const FACT_BY_EFFECT = `
    CREATE INDEX fact_by_effect ON effect_fact(effect_id, seq, fact_id)`;

const FACT_BY_ITEM = `
    CREATE INDEX fact_by_item   ON effect_fact(repository, item_kind, item_number, kind, at)`;

const OPEN_SENDS = `
    CREATE INDEX open_sends     ON effect_fact(at) WHERE kind = 'sent'`;

/** One row per item per capability per pass, webhook and sweep alike (D163). */
const DECISION = `
    CREATE TABLE decision (
        pass_id     TEXT NOT NULL,
        source      TEXT NOT NULL CHECK (source IN ('webhook','sweep')),
        source_id   TEXT NOT NULL,
        at          TEXT NOT NULL,
        repository  TEXT NOT NULL,
        item_kind   TEXT NOT NULL,
        item_number INTEGER NOT NULL,
        capability  TEXT NOT NULL,
        verdict     TEXT NOT NULL,
        code        TEXT,
        detail      TEXT,
        effect_id   TEXT
    )`;

const DECISION_BY_ITEM = `
    CREATE INDEX decision_by_item ON decision(repository, item_kind, item_number, at)`;

const DECISION_BY_AT = `
    CREATE INDEX decision_by_at   ON decision(at)`;

const EFFECT_CLAIM = `
    CREATE TABLE effect_claim (
        effect_id TEXT PRIMARY KEY,
        worker    TEXT NOT NULL,
        at        TEXT NOT NULL
    )`;

/**
 * `resume_after` is the item number a firing stopped reading at; null reads the list from the beginning (D170).
 * `started_at` is when this row last began a firing; null has never fired, and due rows fire oldest first (D192).
 */
const SCHEDULE = `
    CREATE TABLE schedule (
        schedule_id TEXT PRIMARY KEY,
        due_at      TEXT NOT NULL,
        effect      TEXT NOT NULL,
        status      TEXT NOT NULL CHECK (status IN ('pending', 'running', 'done')),
        claimed_at  TEXT,
        claim_token TEXT,
        resume_after INTEGER,
        started_at  TEXT
    )`;

/**
 * One row per open item the sweep has read, decided from again while it stands (D193).
 * `updated_at` is the list's own field at that read, and `facts` the read's groups as JSON.
 */
const ITEM_SNAPSHOT = `
    CREATE TABLE item_snapshot (
        repository  TEXT NOT NULL,
        item_kind   TEXT NOT NULL,
        item_number INTEGER NOT NULL,
        updated_at  TEXT NOT NULL,
        read_at     TEXT NOT NULL,
        facts       TEXT NOT NULL,
        PRIMARY KEY (repository, item_kind, item_number)
    )`;

const SCHEMA_BY_VERSION = {
    1: {
        decision: DECISION,
        decision_by_at: DECISION_BY_AT,
        decision_by_item: DECISION_BY_ITEM,
        delivery_work: DELIVERY_WORK,
        effect_claim: EFFECT_CLAIM,
        effect_fact: EFFECT_FACT,
        fact_by_effect: FACT_BY_EFFECT,
        fact_by_item: FACT_BY_ITEM,
        item_snapshot: ITEM_SNAPSHOT,
        open_sends: OPEN_SENDS,
        schedule: SCHEDULE,
        seen_delivery: SEEN_DELIVERY,
    },
} as const;

type StorageSchemaVersion = keyof typeof SCHEMA_BY_VERSION;

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

/** An unversioned file is this package's only if it is empty (D165). */
function detectUnversionedSchema(db: DatabaseSync): 0 {
    if (schemaObjects(db).length > 0) {
        throw new Error("unrecognized unversioned storage schema");
    }
    return 0;
}

function setVersion(db: DatabaseSync, version: number): void {
    db.exec(`PRAGMA user_version = ${String(version)}`);
}

function createSchema(db: DatabaseSync): void {
    db.exec(
        `${SEEN_DELIVERY};${DELIVERY_WORK};
         ${EFFECT_FACT};${FACT_BY_EFFECT};${FACT_BY_ITEM};${OPEN_SENDS};
         ${DECISION};${DECISION_BY_ITEM};${DECISION_BY_AT};
         ${EFFECT_CLAIM};${SCHEDULE};${ITEM_SNAPSHOT};`,
    );
}

/** One entry per version, and the mechanism a second version will use (D165). */
const MIGRATIONS: ReadonlyArray<{
    readonly version: StorageSchemaVersion;
    readonly apply: (db: DatabaseSync) => void;
}> = [{ version: 1, apply: createSchema }];

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
