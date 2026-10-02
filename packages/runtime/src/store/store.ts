/**
 * The owned operational store, with the crash semantics protocol 6.5 demonstrated.
 * This file owns the FILE — its two pragmas, its schema version, and the two
 * modules that write to it (D164); no state transition is its own.
 */

import { backup, DatabaseSync } from "node:sqlite";
import { Inbox, type DeliveryFaultPoint } from "./inbox.js";
import { Ledger } from "./ledger.js";
import {
    assertSupportedStorageSchemaVersion,
    migrateStorageSchema,
    readStorageSchemaVersion,
    type MigrationFaultPoint,
} from "./schema.js";

/** A deliberate interruption point in schema or delivery durability work. */
export type StoreFaultPoint = MigrationFaultPoint | DeliveryFaultPoint;

/** Optional dependencies for deterministic durability fault injection. */
export interface StoreOptions {
    readonly injectFault?: (point: StoreFaultPoint) => void;
}

/** One opened and migrated file, as the two halves that write to it over one connection. */
export class Store {
    private readonly db: DatabaseSync;
    readonly inbox: Inbox;
    readonly ledger: Ledger;

    constructor(path: string, options: StoreOptions = {}) {
        this.db = new DatabaseSync(path);
        const injectFault = options.injectFault ?? (() => {});
        try {
            const schemaVersion = readStorageSchemaVersion(this.db);
            assertSupportedStorageSchemaVersion(schemaVersion);
            // These two pragmas ARE the crash model, set explicitly rather than
            // inherited: DELETE-mode journal plus synchronous FULL is what makes
            // "everything before the last returned call survives kill -9" true.

            this.db.exec(`
                PRAGMA busy_timeout = 2000;
                PRAGMA journal_mode = DELETE;
                PRAGMA synchronous = FULL;
            `);
            migrateStorageSchema(this.db, injectFault);
        } catch (error) {
            try {
                // Stryker disable next-line CallExpression: an unclosed handle on the failure path leaks a file descriptor, which no black-box assertion can observe from outside the class — the close is resource hygiene, not visible behavior.
                this.db.close();
            } catch {
                // Preserve the initialization error.
            }
            throw error;
        }
        this.inbox = new Inbox(this.db, injectFault);
        this.ledger = new Ledger(this.db);
    }

    /** Copy the open file to `path`, consistent as of the call; the copy opens as a Store. */
    async backup(path: string): Promise<void> {
        await backup(this.db, path);
    }

    close(): void {
        this.db.close();
    }
}
