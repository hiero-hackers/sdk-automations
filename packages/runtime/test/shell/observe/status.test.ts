/**
 * What `pnpm shell:status` prints, over a store a test wrote: one line per
 * question of a store holding work, the same six of a store holding nothing,
 * and the two answers the command gives — a store it opened, and one not there.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useTempDir } from "@hiero-hackers/automation-testkit";
import {
    asDeliveryGuid,
    type DeliveryGuid,
    type ItemRef,
    type RepositoryRef,
} from "@hiero-hackers/automation-core";
import {
    encodeSnapshot,
    Store,
    type Decision,
    type Fact,
    type StoredWarning,
} from "../../../src/store/index.js";
import { readStatus, status } from "../../../src/shell/observe/status.js";
import { spending } from "../spending.js";

const ITEM: ItemRef = { kind: "issue", number: 40 };
const REPOSITORY: RepositoryRef = { owner: "o", repo: "r" };
const NOW = new Date("2026-09-12T15:00:00.000Z");

/** Earlier than every claim below, so no claim here is taken over. */
const STALE = "2026-08-01T00:00:00.000Z";

const GUID_PREFIX = "00000000-0000-0000-0000-00000000000";

const temp = useTempDir("shell-status-");
let path: string;
let store: Store;

beforeEach(() => {
    path = temp.file("store.sqlite");
    store = new Store(path);
});
afterEach(() => {
    store.close();
});

function guid(last: number): DeliveryGuid {
    const deliveryId = asDeliveryGuid(`${GUID_PREFIX}${String(last)}`);
    if (deliveryId === undefined) throw new Error("invalid test delivery GUID");
    return deliveryId;
}

const accept = (last: number, receivedAt: string): void => {
    store.inbox.acceptDelivery({
        deliveryId: guid(last),
        eventName: "issues",
        payload: Buffer.from("work"),
        receivedAt,
    });
};

function claim(now: string) {
    const claimed = store.inbox.claimNextDelivery("worker", now, STALE);
    if (claimed === undefined) throw new Error("nothing was claimable");
    return claimed;
}

function complete(now: string, completedAt: string): void {
    const claimed = claim(now);
    store.inbox.completeDelivery({
        deliveryId: claimed.deliveryId,
        eventName: claimed.eventName,
        payloadDigest: claimed.payloadDigest,
        claimToken: claimed.claimToken,
        completedAt,
    });
}

const fact = (over: Partial<Fact> = {}): Fact => ({
    effectId: "effect-a",
    seq: 1,
    kind: "sent",
    at: "2026-09-12T13:00:00.000Z",
    revision: "revision-1",
    capability: "inactivity",
    repository: REPOSITORY,
    item: ITEM,
    verb: "postComment",
    login: null,
    code: null,
    detail: null,
    payload: '{"verb":"postComment"}',
    ...over,
});

const warned = (effectId: string, earliestActionAt: string): Fact => {
    const snapshot: Omit<StoredWarning, "effectId"> = {
        warnedAt: "2026-09-12T12:00:00.000Z",
        gracePeriodHours: 7 * 24,
        earliestActionAt,
        cancelledBy: "a commit or a /working comment",
        reversesWith: "re-assign / reopen",
        actionClass: "clockTriggeredDestructive",
        capability: "inactivity",
        causeObservedAt: "2026-08-01T00:00:00.000Z",
        cause: "assignmentWentStale",
        item: "o/r#40",
        change: "release alice",
    };
    return fact({
        effectId,
        seq: 0,
        kind: "warned",
        verb: null,
        payload: JSON.stringify(snapshot),
    });
};

const decision = (verdict: string, at = "2026-09-12T14:00:00.000Z"): Decision => ({
    passId: "pass-1",
    source: "webhook",
    sourceId: "00000000-0000-0000-0000-000000000001",
    at,
    repository: REPOSITORY,
    item: ITEM,
    capability: "inactivity",
    verdict,
    code: null,
    detail: null,
    effectId: null,
});

/** One item's read, as a firing wrote it back. */
const stored = (number: number, readAt: string): void => {
    store.ledger.putSnapshot(REPOSITORY, {
        item: { kind: "issue", number },
        updatedAt: "2026-09-10T00:00:00.000Z",
        readAt,
        facts: encodeSnapshot({ kind: "issue", groups: ["assignees"], assignees: "unread" }),
    });
};

describe("the questions a store holding work answers", () => {
    /** One delivery in each state, one open send, two standing promises, a sweep row, five verdicts. */
    beforeEach(() => {
        accept(1, "2026-08-14T10:00:00.000Z");
        complete("2026-08-14T10:00:01.000Z", "2026-08-14T10:00:05.000Z");
        accept(2, "2026-09-12T14:10:00.000Z");
        const failing = claim("2026-09-12T14:10:01.000Z");
        store.inbox.releaseDeliveryAfterFailure({
            deliveryId: failing.deliveryId,
            claimToken: failing.claimToken,
            failedAt: "2026-09-12T14:10:02.000Z",
            retryNotBefore: "2026-09-12T14:20:00.000Z",
            maxAttempts: 1,
        });
        accept(3, "2026-09-12T14:20:00.000Z");
        claim("2026-09-12T14:20:01.000Z");
        accept(4, "2026-09-12T14:32:10.000Z");
        complete("2026-09-12T14:32:11.000Z", "2026-09-12T14:32:13.000Z");
        accept(5, "2026-09-12T14:00:00.000Z");

        store.ledger.record(fact());
        store.ledger.record(
            fact({ effectId: "effect-d", kind: "landed", at: "2026-09-12T14:40:00.000Z" }),
        );
        store.ledger.record(warned("effect-b", "2026-09-12T16:53:00.000Z"));
        store.ledger.record(warned("effect-c", "2026-09-12T18:00:00.000Z"));
        store.ledger.schedule("sweep:o/r", "2026-09-12T15:32:39.000Z", "sweep");
        stored(40, "2026-09-12T14:00:00.000Z");
        stored(41, "2026-09-12T14:30:00.000Z");
        for (const verdict of ["info", "info", "notice", "problem", "refused"]) {
            store.ledger.decide(decision(verdict));
        }
    });

    it("prints one line per question, each a fact the store holds", () => {
        expect(status(store, NOW)).toEqual([
            "deliveries   pending 1   processing 1   failed 1   done 2 (oldest 2026-08-14T10:00:05Z)",
            "delay        newest delivery received 2026-09-12T14:32:10Z, decided 3 s later",
            "sends        open 1   (oldest 2026-09-12T13:00:00Z)",
            "warnings     standing 2   (next due 2026-09-12T16:53:00Z)",
            "sweep        sweep:o/r   pending   due 2026-09-12T15:32:39Z   claimed —",
            "snapshots    o/r   held 2   (oldest read 2026-09-12T14:00:00Z)",
            "creations    last 1 h: 1 comments landed",
            "allowance    held by the running process, not by the store",
            "decisions    last 24 h: 2 info, 1 notice, 1 problem, 1 refused",
        ]);
    });

    /** A comment landed before the window is a fact the store holds and this line does not count. */
    it("counts only the comments GitHub's own creation window still holds", () => {
        store.ledger.record(
            fact({ effectId: "effect-e", kind: "landed", at: "2026-09-12T13:30:00.000Z" }),
        );

        expect(status(store, NOW)[6]).toBe("creations    last 1 h: 1 comments landed");
    });

    /** The window and the spend are the running process's; a store has neither (D193). */
    it("prints the allowance a caller holds, per pool and lane", () => {
        const allowance = spending();
        allowance.charge("core", 3);
        allowance.armMutations(20);
        allowance.charge("mutations", 2);

        expect(status(store, NOW, allowance)[7]).toBe(
            "allowance    core 5/5,000 (resets —)   graphql 0/5,000 (resets —)   mutations 2",
        );
    });

    /** A decision older than the window is a row the store still holds and this line does not count. */
    it("counts only the decisions inside the window", () => {
        store.ledger.decide(decision("info", "2026-09-11T08:00:00.000Z"));

        expect(status(store, NOW).at(-1)).toBe(
            "decisions    last 24 h: 2 info, 1 notice, 1 problem, 1 refused",
        );
    });

    it("says when a firing holds the sweep row", () => {
        store.ledger.claimDue("2026-09-12T15:40:00.000Z");

        expect(status(store, NOW)[4]).toBe(
            "sweep        sweep:o/r   running   due 2026-09-12T15:32:39Z   claimed 2026-09-12T15:40:00Z",
        );
    });
});

describe("the questions a store holding nothing answers", () => {
    it("prints the same lines, each saying so", () => {
        expect(status(store, NOW)).toEqual([
            "deliveries   pending 0   processing 0   failed 0   done 0 (oldest —)",
            "delay        no delivery",
            "sends        open 0   (oldest —)",
            "warnings     standing 0   (next due —)",
            "sweep        —",
            "snapshots    —",
            "creations    last 1 h: 0 comments landed",
            "allowance    held by the running process, not by the store",
            "decisions    last 24 h: —",
        ]);
    });
});

describe("the delay the newest delivery waited", () => {
    it("says so while that delivery is still waiting on its decision", () => {
        accept(1, "2026-09-12T14:32:10.000Z");

        expect(status(store, NOW)[1]).toBe(
            "delay        newest delivery received 2026-09-12T14:32:10Z, not decided yet",
        );
    });

    it("groups a four-figure count", () => {
        accept(1, "2026-09-12T14:00:00.000Z");
        complete("2026-09-12T14:00:01.000Z", "2026-09-12T14:20:04.000Z");

        expect(status(store, NOW)[1]).toBe(
            "delay        newest delivery received 2026-09-12T14:00:00Z, decided 1,204 s later",
        );
    });
});

describe("the command around the reads", () => {
    it("reads the store the environment names", () => {
        store.ledger.schedule("sweep:o/r", "2026-09-12T15:32:39.000Z", "sweep");
        const answer = readStatus({ STORE_PATH: path }, NOW);

        expect(answer.opened).toBe(true);
        expect(answer.lines).toEqual(status(store, NOW));
    });

    it("answers a store that is not there without creating one", () => {
        const missing = temp.file("absent.sqlite");

        expect(readStatus({ STORE_PATH: missing }, NOW)).toEqual({
            opened: false,
            lines: [`no store at ${missing}`],
        });
    });

    it("opens the store main.ts would, when STORE_PATH is unset", () => {
        const answer = readStatus({ XDG_STATE_HOME: temp.file("state") }, NOW);

        expect(answer.opened).toBe(false);
        expect(answer.lines[0]).toMatch(/^no store at .*shell\.sqlite$/);
    });
});
