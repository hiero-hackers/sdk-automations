/** A restored backup preserves decisions and resumes only work its inbox and ledger remember. */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { asDeliveryGuid, toEngine, type DeliveryGuid } from "@hiero-hackers/automation-core";
import { triageQueue } from "@hiero-hackers/automation-capabilities";
import { capture, useTempDir } from "@hiero-hackers/automation-testkit";
import { backupStoreFile, Store } from "../../../src/store/index.js";
import { createShell, fileConfigSource, stubbedExternals } from "../../../src/shell/index.js";
import { createApplier } from "../../../src/shell/apply/apply.js";
import { explainEffect, explainItem } from "../../../src/shell/observe/explain.js";
import { status } from "../../../src/shell/observe/status.js";
import {
    BASE,
    commentEffect,
    configFor,
    fakeGitHub,
    type FakeGitHub,
} from "../apply/effect-harness.js";

const temp = useTempDir("shell-recovery-");
const BODY = capture("issues.opened.json").bytes();
const REPOSITORY = { owner: "scrubbed-1", repo: "scrubbed-2" } as const;
const ITEM = { kind: "issue", number: 164 } as const;
const GUID = asDeliveryGuid("83e4273f-dd89-22f4-92bc-5da478ed1a69")!;
const OTHER_GUID = asDeliveryGuid("83e4273f-dd89-22f4-92bc-5da478ed1a6a")!;
const LATER = new Date(BASE.getTime() + 60 * 60_000);
let sourcePath: string;
let configPath: string;
let store: Store;

beforeEach(() => {
    sourcePath = temp.file("source.sqlite");
    configPath = temp.file("sdk-automations.yml");
    store = new Store(sourcePath);
    writeFileSync(
        configPath,
        `schemaVersion: 2
mode: dry-run
capabilities:
  triageQueue:
    enabled: true
    welcome: true
`,
    );
});

afterEach(() => store.close());

const accept = (deliveryId: DeliveryGuid, payload = BODY) =>
    store.inbox.acceptDelivery({
        deliveryId,
        eventName: "issues",
        payload,
        receivedAt: BASE.toISOString(),
    });

async function restore(): Promise<void> {
    const target = temp.file("backup.sqlite");
    await backupStoreFile(sourcePath, target);
    store.close();
    store = new Store(target);
}

async function drain(now = BASE): Promise<void> {
    const shell = createShell({
        secret: "recovery-secret",
        store,
        capabilities: [toEngine(triageQueue)],
        repository: REPOSITORY,
        clock: () => now,
        log: () => {},
        seams: () => ({
            configSource: fileConfigSource(configPath),
            externals: () => stubbedExternals(),
            writePath: null,
            facts: () => {
                throw new Error("recovery must not sweep");
            },
        }),
    });
    try {
        await shell.drain();
    } finally {
        shell.stopTick();
    }
}

const applier = (github: FakeGitHub, now = BASE) =>
    createApplier({
        ledger: store.ledger,
        writer: github.writer,
        reader: github.reader,
        externals: () => stubbedExternals(),
        worker: "recovery",
        clock: () => now,
        log: () => {},
    });

describe("recovery from a backup", () => {
    it("keeps completed decisions and their explanation without deciding a redelivery", async () => {
        expect(accept(GUID).outcome).toBe("accepted");
        await drain();
        const decisions = store.ledger.decisionsOn(REPOSITORY, ITEM);
        const explanation = explainItem(store, REPOSITORY, ITEM);
        const standing = status(store, BASE);
        expect(decisions.length).toBeGreaterThan(0);
        expect(explanation.found).toBe(true);

        await restore();

        expect(store.ledger.decisionsOn(REPOSITORY, ITEM)).toEqual(decisions);
        expect(explainItem(store, REPOSITORY, ITEM)).toEqual(explanation);
        expect(status(store, BASE)).toEqual(standing);
        expect(accept(GUID)).toMatchObject({ outcome: "duplicate", state: "done" });
        expect(accept(GUID, Buffer.from("different payload"))).toMatchObject({
            outcome: "conflict",
        });
        await drain();
        expect(store.ledger.decisionsOn(REPOSITORY, ITEM)).toEqual(decisions);
        expect(store.inbox.counts()).toMatchObject({ done: 1, pending: 0, processing: 0 });
    });

    it("keeps a copied lease fenced, then drains it with the same payload after expiry", async () => {
        accept(GUID);
        const held = store.inbox.claimNextDelivery(
            "lost-worker",
            BASE.toISOString(),
            "2026-09-02T09:00:00.000Z",
        );
        expect(held?.payload).toEqual(BODY);
        accept(OTHER_GUID);
        await restore();
        await drain();
        expect(store.inbox.counts()).toMatchObject({ done: 1, pending: 0, processing: 1 });

        expect(
            store.inbox.claimNextDelivery(
                "restore",
                BASE.toISOString(),
                "2026-09-02T09:00:00.000Z",
            ),
        ).toBeUndefined();
        const reclaimed = store.inbox.claimNextDelivery(
            "restore",
            LATER.toISOString(),
            BASE.toISOString(),
        );
        expect(reclaimed?.payload).toEqual(BODY);
        expect(reclaimed?.payloadDigest).toBe(held?.payloadDigest);
        expect(reclaimed?.claimToken).not.toBe(held?.claimToken);
        expect(store.inbox.releaseDelivery(GUID, held!.claimToken).outcome).toBe("notOwned");
        store.inbox.releaseDelivery(GUID, reclaimed!.claimToken);
        await drain(LATER);

        expect(store.inbox.counts()).toMatchObject({ done: 2, pending: 0, processing: 0 });
        const decisions = store.ledger.decisionsOn(REPOSITORY, ITEM);
        expect(new Set(decisions.map((row) => row.sourceId))).toEqual(new Set([GUID, OTHER_GUID]));
        await drain(LATER);
        expect(store.ledger.decisionsOn(REPOSITORY, ITEM)).toEqual(decisions);
    });

    it.each(["beforeSend", "afterSend"] as const)(
        "recovers a copied comment interrupted at %s without duplicating it",
        async (when) => {
            const github = fakeGitHub();
            github.faults.crashOn = { verb: "createComment", when };
            const effect = commentEffect();
            await expect(applier(github).applyAll([effect], configFor())).rejects.toThrow(
                when === "afterSend" ? "crash after createComment" : "crash before createComment",
            );
            const open = store.ledger.open(LATER.toISOString());
            expect(open).toHaveLength(1);
            expect(github.calls).toHaveLength(1);
            expect(github.world.comments).toHaveLength(when === "afterSend" ? 1 : 0);
            const explanation = explainEffect(store, effect.intent.idempotencyKey);
            await restore();
            expect(store.ledger.open(LATER.toISOString())).toEqual(open);
            expect(explainEffect(store, effect.intent.idempotencyKey)).toEqual(explanation);
            github.faults.crashOn = null;

            await applier(github, LATER).recover(open[0]!, configFor());
            await applier(github, LATER).applyAll([effect], configFor());

            expect(github.calls).toHaveLength(when === "afterSend" ? 1 : 2);
            expect(github.world.comments).toHaveLength(1);
            expect(store.ledger.open(LATER.toISOString())).toEqual([]);
            expect(store.ledger.stateOf(effect.intent.idempotencyKey, 1)).toMatchObject({
                kind: "settled",
                how: "landed",
            });
        },
    );

    it("keeps an uncertain restored send open until its comment can be read", async () => {
        const github = fakeGitHub();
        github.faults.crashOn = { verb: "createComment", when: "afterSend" };
        const effect = commentEffect();
        await expect(applier(github).applyAll([effect], configFor())).rejects.toThrow(
            "crash after createComment",
        );
        await restore();
        github.faults.crashOn = null;
        github.faults.commentReadFails = true;
        const open = store.ledger.open(LATER.toISOString());
        expect(open).toHaveLength(1);

        await applier(github, LATER).recover(open[0]!, configFor());
        expect(github.calls).toHaveLength(1);
        expect(store.ledger.open(LATER.toISOString())).toEqual(open);
        github.faults.commentReadFails = false;
        await applier(github, LATER).recover(open[0]!, configFor());

        expect(github.calls).toHaveLength(1);
        expect(github.world.comments).toHaveLength(1);
        expect(store.ledger.open(LATER.toISOString())).toEqual([]);
    });
});
