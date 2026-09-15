/**
 * The version contract over the one schema there is: what a fresh file becomes,
 * what reopening it does not change, and the shapes that are refused. No
 * fixtures of older schemas, because no older store will ever be opened (D165).
 */

import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { useTempDir } from "@hiero-hackers/automation-testkit";
import { CURRENT_STORAGE_SCHEMA_VERSION, migrateStorageSchema } from "../../src/store/schema.js";
import { Store, type StoreFaultPoint } from "../../src/store/store.js";

const temp = useTempDir("store-schema-");
let databasePath: string;

beforeEach(() => {
    databasePath = temp.file("store.sqlite");
});

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
    it("creates a fresh database through the one migration", () => {
        const points: StoreFaultPoint[] = [];
        const store = new Store(databasePath, {
            injectFault: (point) => points.push(point),
        });
        store.close();

        expect(points).toEqual(["migration:1"]);
        expect(schemaState(databasePath)).toEqual({
            version: CURRENT_STORAGE_SCHEMA_VERSION,
            tables: [
                "decision",
                "effect_claim",
                "effect_fact",
                "item_snapshot",
                "schedule",
                "seen_delivery",
            ],
        });
        // The fingerprint is the contract: a schema that reaches the right
        // version with a different CHECK is the failure worth naming.

        const created = schemaFingerprint(databasePath);
        expect(Object.keys(created)).toHaveLength(12);
        expect(created["seen_delivery"]).toContain("retry_not_before");
        expect(created["seen_delivery"]).toContain("'failed'");
        expect(created["effect_fact"]).toContain("'abandoned'");
        expect(created["effect_fact"]).toContain("repository TEXT NOT NULL");
        expect(created["decision"]).toContain("verdict");
        expect(created["decision"]).toContain("repository TEXT NOT NULL");
        // Every item-keyed read takes the repository first, so the index leads with it (D169).

        expect(created["fact_by_item"]).toContain("(repository, item_kind, item_number");
        expect(created["decision_by_item"]).toContain("(repository, item_kind, item_number");
        // The cursor and the firing's start both ride on the row (D170, D192).

        expect(created["schedule"]).toContain("resume_after INTEGER");
        expect(created["schedule"]).toContain("started_at TEXT");
        // One row per open item, keyed the way every item-keyed read asks (D169, D193).

        expect(created["item_snapshot"]).toContain("updated_at TEXT NOT NULL");
        expect(created["item_snapshot"]).toContain("read_at TEXT NOT NULL");
        expect(created["item_snapshot"]).toContain("facts TEXT NOT NULL");
        expect(created["item_snapshot"]).toContain(
            "PRIMARY KEY (repository, item_kind, item_number)",
        );
    });

    it("changes nothing when the file it already created is reopened", () => {
        new Store(databasePath).close();
        const created = schemaFingerprint(databasePath);

        const points: StoreFaultPoint[] = [];
        const reopened = new Store(databasePath, { injectFault: (point) => points.push(point) });
        reopened.close();

        expect(points).toEqual([]);
        expect(schemaFingerprint(databasePath)).toEqual(created);
        expect(schemaState(databasePath).version).toBe(CURRENT_STORAGE_SCHEMA_VERSION);
    });

    it("refuses a newer version without rewriting its database", () => {
        const db = new DatabaseSync(databasePath);
        db.exec("CREATE TABLE future_marker (value TEXT); PRAGMA user_version = 2;");
        db.close();

        expect(() => new Store(databasePath)).toThrow(
            "storage schema version 2 is newer than supported version 1",
        );
        expect(schemaState(databasePath)).toEqual({
            version: 2,
            tables: ["future_marker"],
        });
    });

    it("refuses a versioned file whose shape drifted from what it declares", () => {
        new Store(databasePath).close();
        const db = new DatabaseSync(databasePath);
        db.exec("ALTER TABLE schedule ADD COLUMN extra TEXT");
        db.close();

        expect(() => new Store(databasePath)).toThrow(
            "storage schema does not match declared version 1",
        );
    });

    it("refuses an unversioned file that holds anything at all", () => {
        const unknown = new DatabaseSync(databasePath);
        unknown.exec("CREATE TABLE unrelated (value TEXT)");
        unknown.close();

        expect(() => new Store(databasePath)).toThrow("unrecognized unversioned storage schema");
        expect(schemaState(databasePath)).toEqual({ version: 0, tables: ["unrelated"] });
    });

    it.each([
        { drift: "a missing object", change: "DROP INDEX open_sends" },
        {
            drift: "an exact DDL mismatch",
            change: `
                DROP INDEX open_sends;
                CREATE INDEX open_sends ON effect_fact(at) WHERE kind = 'landed'
            `,
        },
        {
            drift: "an unexpected object",
            change: `
                CREATE TRIGGER erase_report_identity
                AFTER UPDATE ON seen_delivery
                BEGIN
                    DELETE FROM seen_delivery WHERE delivery_id = NEW.delivery_id;
                END
            `,
        },
    ])("refuses a version-1 file whose shape drifted by $drift", ({ change }) => {
        new Store(databasePath).close();
        const drifted = new DatabaseSync(databasePath);
        drifted.exec(change);
        drifted.close();

        expect(() => new Store(databasePath)).toThrow(
            "storage schema does not match declared version 1",
        );
    });
});

describe("migration interruption", () => {
    it("rolls back before returning so the same connection can retry", () => {
        const db = new DatabaseSync(databasePath);
        expect(() =>
            migrateStorageSchema(db, (point) => {
                if (point === "migration:1") throw new Error("interrupt migration:1");
            }),
        ).toThrow("interrupt migration:1");

        expect(() => migrateStorageSchema(db)).not.toThrow();
        db.close();
        expect(schemaState(databasePath).version).toBe(CURRENT_STORAGE_SCHEMA_VERSION);
    });

    it("rolls back the one step and repeats cleanly on reopen", () => {
        expect(
            () =>
                new Store(databasePath, {
                    injectFault: (point) => {
                        if (point === "migration:1") throw new Error("interrupt migration:1");
                    },
                }),
        ).toThrow("interrupt migration:1");
        expect(schemaState(databasePath)).toEqual({ version: 0, tables: [] });

        const restarted = new Store(databasePath);
        restarted.close();
        expect(schemaState(databasePath).version).toBe(CURRENT_STORAGE_SCHEMA_VERSION);
    });
});
