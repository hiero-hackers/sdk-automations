/**
 * A backup taken while the store is open is a store: it opens under the same schema, holds
 * every row the source held at the call, and hands out the pending work the source would.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { asDeliveryGuid, type DeliveryGuid } from "@hiero-hackers/automation-core";
import { useTempDir } from "@hiero-hackers/automation-testkit";
import { Store } from "../../src/store/store.js";

const temp = useTempDir("store-backup-");

const guid = (last: string): DeliveryGuid => {
    const held = asDeliveryGuid(`83e4273f-dd89-22f4-92bc-5da478ed1a6${last}`);
    if (held === undefined) throw new Error("invalid test guid");
    return held;
};

const NOW = "2026-10-02T10:00:00.000Z";
const STALE = "2026-10-02T09:00:00.000Z";

function accepted(store: Store, last: string): void {
    store.inbox.acceptDelivery({
        deliveryId: guid(last),
        eventName: "issues",
        payload: Buffer.from(`payload-${last}`),
        receivedAt: NOW,
    });
}

describe("a backup is a store", () => {
    it("opens under the same schema and holds the rows the source held", async () => {
        const source = new Store(temp.file("source.sqlite"));
        const copyPath = temp.file("copy.sqlite");
        accepted(source, "0");
        accepted(source, "1");
        await source.backup(copyPath);
        accepted(source, "2");
        source.close();

        const copy = new Store(copyPath);
        expect(copy.inbox.counts()).toMatchObject({ pending: 2, processing: 0, done: 0 });
        copy.close();
    });

    it("hands out the pending work the source would, with the same bytes", async () => {
        const source = new Store(temp.file("source.sqlite"));
        const copyPath = temp.file("copy.sqlite");
        accepted(source, "0");
        const fromSource = source.inbox.claimNextDelivery("source", NOW, STALE);
        await source.backup(copyPath);
        source.close();

        const copy = new Store(copyPath);
        const fromCopy = copy.inbox.claimNextDelivery("copy", "2026-10-02T10:10:00.000Z", NOW);
        expect(fromCopy?.deliveryId).toBe(fromSource?.deliveryId);
        expect(fromCopy?.payloadDigest).toBe(fromSource?.payloadDigest);
        copy.close();
    });

    it("replaces an older copy at the path", async () => {
        const source = new Store(temp.file("source.sqlite"));
        const copyPath = temp.file("copy.sqlite");
        await source.backup(copyPath);
        accepted(source, "0");
        await source.backup(copyPath);
        source.close();

        const copy = new Store(copyPath);
        expect(copy.inbox.counts().pending).toBe(1);
        copy.close();
    });

    it("refuses a path holding something that is not a database, and leaves it", async () => {
        const source = new Store(temp.file("source.sqlite"));
        const other = temp.file("notes.txt");
        writeFileSync(other, "not a database");
        await expect(source.backup(other)).rejects.toThrow();
        source.close();
        expect(readFileSync(other, "utf8")).toBe("not a database");
    });
});
