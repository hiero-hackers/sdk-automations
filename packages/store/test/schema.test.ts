/**
 * The version contract against every complete schema this repository has
 * created. Fixtures reproduce those SQLite definitions rather than mocking
 * migration inputs.
 */

import { rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { asDeliveryGuid } from "@hiero-hackers/automation-core";
import { useTempDir } from "@hiero-hackers/automation-testkit";
import { CURRENT_STORAGE_SCHEMA_VERSION, migrateStorageSchema } from "../src/schema.js";
import { Store, type StoreFaultPoint } from "../src/store.js";

const temp = useTempDir("store-schema-");
let databasePath: string;

beforeEach(() => {
    databasePath = temp.file("store.sqlite");
});

const DELIVERY_ID = asDeliveryGuid("00000000-0000-0000-0000-000000000001")!;
const SECOND_DELIVERY_ID = asDeliveryGuid("00000000-0000-0000-0000-000000000002")!;
const AT = "2026-07-23T10:00:00.000Z";

const VERSION3_SEEN_DELIVERY = `
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

function createVersion1Schema(path: string): void {
    const db = new DatabaseSync(path);
    db.exec(`
        CREATE TABLE seen_delivery (
            delivery_id TEXT PRIMARY KEY,
            at          TEXT NOT NULL
        );
        CREATE TABLE effect_journal (
            effect_id TEXT NOT NULL,
            call_seq  INTEGER NOT NULL,
            intent    TEXT NOT NULL,
            status    TEXT NOT NULL CHECK (status IN ('sent', 'done')),
            at        TEXT NOT NULL,
            PRIMARY KEY (effect_id, call_seq)
        );
        CREATE TABLE effect_claim (
            effect_id TEXT PRIMARY KEY,
            worker    TEXT NOT NULL,
            at        TEXT NOT NULL
        );
        CREATE TABLE schedule (
            schedule_id TEXT PRIMARY KEY,
            due_at      TEXT NOT NULL,
            effect      TEXT NOT NULL,
            status      TEXT NOT NULL CHECK (status IN ('pending', 'running', 'done'))
        );
    `);
    db.prepare("INSERT INTO seen_delivery VALUES (?, ?)").run(DELIVERY_ID, AT);
    db.prepare("INSERT INTO effect_journal VALUES (?, ?, ?, ?, ?)").run(
        "effect-old",
        1,
        "write",
        "sent",
        AT,
    );
    db.prepare("INSERT INTO effect_claim VALUES (?, ?, ?)").run("held-effect", "worker-old", AT);
    db.prepare("INSERT INTO schedule VALUES (?, ?, ?, ?)").run(
        "running-old",
        AT,
        "sweep",
        "running",
    );
    db.close();
}

function createVersion2Schema(path: string): void {
    const db = new DatabaseSync(path);
    db.exec(`
        CREATE TABLE seen_delivery (
            delivery_id TEXT PRIMARY KEY,
            at          TEXT NOT NULL
        );
        CREATE TABLE effect_journal (
            effect_id TEXT NOT NULL,
            call_seq  INTEGER NOT NULL,
            intent    TEXT NOT NULL,
            status    TEXT NOT NULL CHECK (status IN ('sent', 'done')),
            at        TEXT NOT NULL,
            attempt   INTEGER NOT NULL,
            revision  TEXT NOT NULL,
            PRIMARY KEY (effect_id, call_seq)
        );
        CREATE TABLE effect_claim (
            effect_id TEXT PRIMARY KEY,
            worker    TEXT NOT NULL,
            at        TEXT NOT NULL
        );
        CREATE TABLE schedule (
            schedule_id TEXT PRIMARY KEY,
            due_at      TEXT NOT NULL,
            effect      TEXT NOT NULL,
            status      TEXT NOT NULL CHECK (status IN ('pending', 'running', 'done')),
            claimed_at  TEXT,
            claim_token TEXT
        );
        CREATE INDEX open_intents
            ON effect_journal(at) WHERE status = 'sent';
    `);
    db.prepare("INSERT INTO seen_delivery VALUES (?, ?)").run(DELIVERY_ID, AT);
    db.prepare("INSERT INTO effect_journal VALUES (?, ?, ?, ?, ?, ?, ?)").run(
        "effect-newer",
        1,
        "write",
        "sent",
        AT,
        3,
        "revision-3",
    );
    db.prepare("INSERT INTO schedule VALUES (?, ?, ?, ?, ?, ?)").run(
        "running-newer",
        AT,
        "sweep",
        "running",
        AT,
        "schedule-token",
    );
    db.close();
}

function createVersion3Schema(path: string): void {
    const db = new DatabaseSync(path);
    db.exec(`
        ${VERSION3_SEEN_DELIVERY};
        CREATE TABLE effect_journal (
            effect_id TEXT NOT NULL,
            call_seq  INTEGER NOT NULL,
            intent    TEXT NOT NULL,
            status    TEXT NOT NULL CHECK (status IN ('sent', 'done')),
            at        TEXT NOT NULL,
            attempt   INTEGER NOT NULL,
            revision  TEXT NOT NULL,
            PRIMARY KEY (effect_id, call_seq)
        );
        CREATE TABLE effect_claim (
            effect_id TEXT PRIMARY KEY,
            worker    TEXT NOT NULL,
            at        TEXT NOT NULL
        );
        CREATE TABLE schedule (
            schedule_id TEXT PRIMARY KEY,
            due_at      TEXT NOT NULL,
            effect      TEXT NOT NULL,
            status      TEXT NOT NULL CHECK (status IN ('pending', 'running', 'done')),
            claimed_at  TEXT,
            claim_token TEXT
        );
        CREATE INDEX open_intents
            ON effect_journal(at) WHERE status = 'sent';
        CREATE INDEX delivery_work
            ON seen_delivery(state, received_at, delivery_id);
    `);
    db.prepare(
        `
        INSERT INTO seen_delivery (
            delivery_id, event_name, payload, payload_digest, received_at,
            state, claim_worker, claim_token, claimed_at, completed_at
        ) VALUES (?, 'issues', ?, ?, ?, 'pending', NULL, NULL, NULL, NULL)
    `,
    ).run(DELIVERY_ID, Buffer.from("work"), "0".repeat(64), AT);
    db.close();
}

/** Version 4 = version 3 plus the canonical-report table, declared as 4. */
function createVersion4Schema(path: string): void {
    createVersion3Schema(path);
    const db = new DatabaseSync(path);
    db.exec(`
        CREATE TABLE delivery_report (
            delivery_id TEXT PRIMARY KEY,
            claim_token TEXT NOT NULL,
            report_json TEXT NOT NULL,
            completed_at TEXT NOT NULL
        );
        PRAGMA user_version = 4;
    `);
    db.close();
}

function replaceVersion3DeliveryDefinition(definition: string, declaredVersion: 0 | 3): void {
    createVersion3Schema(databasePath);
    const db = new DatabaseSync(databasePath);
    db.exec(`
        DROP INDEX delivery_work;
        ALTER TABLE seen_delivery RENAME TO seen_delivery_original;
        ${definition};
        INSERT INTO seen_delivery
            SELECT * FROM seen_delivery_original;
        DROP TABLE seen_delivery_original;
        CREATE INDEX delivery_work
            ON seen_delivery(state, received_at, delivery_id);
        PRAGMA user_version = ${String(declaredVersion)};
    `);
    db.close();
}

/** Every owned SQLite object's exact definition, whitespace-insensitive. */
function schemaFingerprint(path: string): Record<string, string> {
    const db = new DatabaseSync(path);
    const objects = db
        .prepare(
            `
        SELECT name, sql FROM sqlite_schema
        WHERE name NOT LIKE 'sqlite_%' AND sql IS NOT NULL
        ORDER BY name
    `,
        )
        .all() as { name: string; sql: string }[];
    db.close();
    return Object.fromEntries(
        objects.map((object) => [object.name, object.sql.replace(/\s+/g, " ")]),
    );
}

function schemaState(path: string): {
    readonly version: number;
    readonly tables: string[];
} {
    const db = new DatabaseSync(path);
    const version = (
        db.prepare("PRAGMA user_version").get() as {
            user_version: number;
        }
    ).user_version;
    const tables = (
        db
            .prepare(
                `
        SELECT name FROM sqlite_schema
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name
    `,
            )
            .all() as { name: string }[]
    ).map((row) => row.name);
    db.close();
    return { version, tables };
}

describe("storage schema versions", () => {
    it("creates a fresh database through every ordered migration", () => {
        const points: StoreFaultPoint[] = [];
        const store = new Store(databasePath, {
            injectFault: (point) => points.push(point),
        });
        store.close();

        expect(points).toEqual([
            "migration:1",
            "migration:2",
            "migration:3",
            "migration:4",
            "migration:5",
        ]);
        expect(schemaState(databasePath)).toEqual({
            version: CURRENT_STORAGE_SCHEMA_VERSION,
            tables: [
                "delivery_report",
                "effect_claim",
                "effect_journal",
                "schedule",
                "seen_delivery",
            ],
        });
    });

    it("migrates the original four-table schema without losing recovery state", () => {
        createVersion1Schema(databasePath);
        const store = new Store(databasePath);

        expect(store.effectState("effect-old", 2)).toEqual({
            state: "sentUnknown",
            seq: 1,
            intent: "write",
            attempt: 1,
            revision: "legacy:unknown",
        });
        expect(store.claim("held-effect", "worker-new", AT, "2026-07-23T09:59:59.999Z")).toBe(
            false,
        );
        expect(store.claimDue(AT)).toHaveLength(1);
        expect(
            store.acceptDelivery({
                deliveryId: DELIVERY_ID,
                eventName: "issues",
                payload: Buffer.from("work"),
                receivedAt: AT,
            }),
        ).toMatchObject({ outcome: "conflict", state: "done" });
        store.close();
        expect(schemaState(databasePath).version).toBe(CURRENT_STORAGE_SCHEMA_VERSION);
    });

    it("migrates the recovery-enriched schema with attempts and claims intact", () => {
        createVersion2Schema(databasePath);
        const store = new Store(databasePath);

        expect(store.effectState("effect-newer", 2)).toEqual({
            state: "sentUnknown",
            seq: 1,
            intent: "write",
            attempt: 3,
            revision: "revision-3",
        });
        expect(store.requeueStuck(AT)).toEqual([
            { scheduleId: "running-newer", dueAt: AT, effect: "sweep" },
        ]);
        store.close();
        expect(schemaState(databasePath).version).toBe(CURRENT_STORAGE_SCHEMA_VERSION);
    });

    it("migrates the durable-delivery schema and preserves pending bytes", () => {
        createVersion3Schema(databasePath);
        const store = new Store(databasePath);
        const claim = store.claimNextDelivery(
            "worker",
            "2026-07-23T10:01:00.000Z",
            "2026-07-23T09:00:00.000Z",
        );

        expect(claim?.deliveryId).toBe(DELIVERY_ID);
        expect(Buffer.from(claim!.payload)).toEqual(Buffer.from("work"));
        store.close();
        expect(schemaState(databasePath).version).toBe(CURRENT_STORAGE_SCHEMA_VERSION);
    });

    it("does not invent idempotent report ownership for a reportless v3 completion", () => {
        createVersion3Schema(databasePath);
        const old = new DatabaseSync(databasePath);
        old.prepare(
            `UPDATE seen_delivery
             SET state = 'done', payload = NULL, completed_at = ?
             WHERE delivery_id = ?`,
        ).run(AT, DELIVERY_ID);
        old.close();

        const store = new Store(databasePath);
        expect(
            store.completeDeliveryWithReport({
                deliveryId: DELIVERY_ID,
                eventName: "issues",
                payloadDigest: "0".repeat(64),
                claimToken: "legacy-claim-token",
                reportJson: "{}",
                completedAt: "2026-07-23T10:01:00.000Z",
            }),
        ).toEqual({ outcome: "notOwned" });
        expect(store.deliveryReports()).toEqual([]);
        store.close();
    });

    it("migrates the report-bearing schema into a bounded-retry queue", () => {
        createVersion4Schema(databasePath);
        const reported = new DatabaseSync(databasePath);
        reported
            .prepare(
                `INSERT INTO delivery_report
                 (delivery_id, claim_token, report_json, completed_at)
                 VALUES (?, ?, ?, ?)`,
            )
            .run(SECOND_DELIVERY_ID, "v4-token", "{}", AT);
        reported.close();

        const store = new Store(databasePath);
        const claim = store.claimNextDelivery(
            "worker",
            "2026-07-23T10:01:00.000Z",
            "2026-07-23T09:00:00.000Z",
        );

        // A delivery the old schema could not have counted starts unspent.
        expect(claim).toMatchObject({ deliveryId: DELIVERY_ID, attempts: 0 });
        expect(Buffer.from(claim!.payload)).toEqual(Buffer.from("work"));
        expect(store.deadLetteredDeliveries()).toEqual([]);
        expect(store.deliveryReports()).toEqual([
            { deliveryId: SECOND_DELIVERY_ID, reportJson: "{}", completedAt: AT },
        ]);
        store.close();
        expect(schemaState(databasePath).version).toBe(CURRENT_STORAGE_SCHEMA_VERSION);
    });

    it("upgrades every old version into the schema a fresh database creates", () => {
        const fresh = temp.file("fresh.sqlite");
        new Store(fresh).close();
        const expected = schemaFingerprint(fresh);
        // The fingerprint is the contract: a migration that reaches the
        // right version with a different CHECK is the failure worth naming.
        expect(expected["seen_delivery"]).toContain("retry_not_before");
        expect(expected["seen_delivery"]).toContain("'failed'");

        for (const create of [createVersion1Schema, createVersion2Schema, createVersion3Schema]) {
            const upgraded = temp.file(`${create.name}.sqlite`);
            create(upgraded);
            new Store(upgraded).close();
            expect(schemaFingerprint(upgraded), create.name).toEqual(expected);
        }
        createVersion4Schema(databasePath);
        new Store(databasePath).close();
        expect(schemaFingerprint(databasePath)).toEqual(expected);
    });

    it("refuses newer versions without rewriting their database", () => {
        const db = new DatabaseSync(databasePath);
        db.exec("CREATE TABLE future_marker (value TEXT); PRAGMA user_version = 6;");
        db.close();

        expect(() => new Store(databasePath)).toThrow(
            "storage schema version 6 is newer than supported version 5",
        );
        expect(schemaState(databasePath)).toEqual({
            version: 6,
            tables: ["future_marker"],
        });
    });

    it("fails closed on an unknown unversioned shape and a false version label", () => {
        const unknown = new DatabaseSync(databasePath);
        unknown.exec("CREATE TABLE unrelated (value TEXT)");
        unknown.close();
        expect(() => new Store(databasePath)).toThrow("unrecognized unversioned storage schema");

        rmSync(databasePath);
        createVersion3Schema(databasePath);
        const mislabeled = new DatabaseSync(databasePath);
        mislabeled.exec("PRAGMA user_version = 4");
        mislabeled.close();
        expect(() => new Store(databasePath)).toThrow(
            "storage schema does not match declared version 4",
        );
    });

    it.each([
        {
            property: "primary key",
            definition: VERSION3_SEEN_DELIVERY.replace(
                "delivery_id   TEXT PRIMARY KEY",
                "delivery_id   TEXT",
            ),
            version: 0 as const,
            error: "unrecognized unversioned storage schema",
        },
        {
            property: "column type",
            definition: VERSION3_SEEN_DELIVERY.replace(
                "event_name    TEXT NOT NULL",
                "event_name    BLOB NOT NULL",
            ),
            version: 3 as const,
            error: "storage schema does not match declared version 3",
        },
        {
            property: "not-null constraint",
            definition: VERSION3_SEEN_DELIVERY.replace(
                "payload_digest TEXT NOT NULL",
                "payload_digest TEXT",
            ),
            version: 3 as const,
            error: "storage schema does not match declared version 3",
        },
        {
            property: "check constraint",
            definition: VERSION3_SEEN_DELIVERY.replace(
                "state IN ('pending', 'processing', 'done')",
                "state IN ('pending', 'processing', 'done', 'lost')",
            ),
            version: 3 as const,
            error: "storage schema does not match declared version 3",
        },
    ])(
        "rejects a same-column schema with the wrong $property",
        ({ definition, version, error }) => {
            replaceVersion3DeliveryDefinition(definition, version);
            expect(() => new Store(databasePath)).toThrow(error);
        },
    );

    it.each([
        {
            boundary: "a missing object while every remaining object matches",
            change: "DROP INDEX open_intents",
        },
        {
            boundary: "the same object count with one wrong name",
            change: `
                DROP INDEX open_intents;
                CREATE INDEX closed_intents
                    ON effect_journal(at) WHERE status = 'sent'
            `,
        },
        {
            boundary: "an exact DDL mismatch",
            change: `
                DROP INDEX open_intents;
                CREATE INDEX open_intents
                    ON effect_journal(at) WHERE status = 'done'
            `,
        },
    ])("rejects $boundary", ({ change }) => {
        createVersion3Schema(databasePath);
        const db = new DatabaseSync(databasePath);
        db.exec(`${change}; PRAGMA user_version = 3;`);
        db.close();

        expect(() => new Store(databasePath)).toThrow(
            "storage schema does not match declared version 3",
        );
    });

    it("rejects unexpected active schema objects", () => {
        createVersion3Schema(databasePath);
        const db = new DatabaseSync(databasePath);
        db.exec(`
            CREATE TRIGGER erase_report_identity
            AFTER UPDATE ON seen_delivery
            BEGIN
                DELETE FROM seen_delivery WHERE delivery_id = NEW.delivery_id;
            END;
            PRAGMA user_version = 3;
        `);
        db.close();

        expect(() => new Store(databasePath)).toThrow(
            "storage schema does not match declared version 3",
        );
    });
});

describe("migration interruption", () => {
    it("rolls back before returning so the same connection can retry", () => {
        createVersion1Schema(databasePath);
        const db = new DatabaseSync(databasePath);
        expect(() =>
            migrateStorageSchema(db, (point) => {
                if (point === "migration:2") throw new Error("interrupt migration:2");
            }),
        ).toThrow("interrupt migration:2");

        expect(() => migrateStorageSchema(db)).not.toThrow();
        db.close();
        expect(schemaState(databasePath).version).toBe(CURRENT_STORAGE_SCHEMA_VERSION);
    });

    it.each(["migration:1", "migration:2", "migration:3", "migration:4", "migration:5"] as const)(
        "rolls back %s and repeats cleanly on reopen",
        (faultPoint) => {
            if (faultPoint !== "migration:1") createVersion1Schema(databasePath);
            const before = schemaState(databasePath);

            expect(
                () =>
                    new Store(databasePath, {
                        injectFault: (point) => {
                            if (point === faultPoint) throw new Error(`interrupt ${point}`);
                        },
                    }),
            ).toThrow(`interrupt ${faultPoint}`);
            expect(schemaState(databasePath)).toEqual(before);

            const restarted = new Store(databasePath);
            restarted.close();
            expect(schemaState(databasePath).version).toBe(CURRENT_STORAGE_SCHEMA_VERSION);
        },
    );
});
