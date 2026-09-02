/**
 * The live externals: grants ride the token, and ordering evidence answers
 * a Date, a confident null, or "unknown" — with a failure never laundered
 * into either of the others. Timeline bodies here are SYNTHETIC, shaped
 * from GitHub's documented timeline format, not recorded traffic.
 */

import { describe, expect, it } from "vitest";
import type { ItemRef } from "@hiero-hackers/automation-core";
import {
    causeFingerprintOf,
    installationGrants,
    liveExternalsForDelivery,
    orderingEvidenceSource,
    type CauseFingerprint,
} from "../src/externals.js";
import {
    failure,
    httpHarness as harness,
    installationToken as token,
    scriptedTokenSource as tokenSource,
    success,
} from "./harness.js";

const ITEM: ItemRef = { kind: "issue", number: 7 };
const REPOSITORY = { owner: "hiero-hackers", repo: "sdk-automations" };
const TIMELINE_URL = "https://api.github.com/repos/hiero-hackers/sdk-automations/issues/7/timeline";
const AT = "2026-08-20T10:00:00Z";
const CAUSE: CauseFingerprint = {
    actorLogin: "maintainer",
    observedAt: new Date(AT),
    itemNumber: 7,
    action: "labeled",
    target: "triage",
};
const PAYLOAD = {
    action: "labeled",
    label: { name: "triage" },
    sender: { login: "maintainer" },
    issue: { number: 7, updated_at: AT },
};

function entry(
    event: string,
    login: string,
    createdAt: string,
    type: "User" | "Bot" = "User",
    target = "triage",
): Record<string, unknown> {
    const details =
        event === "labeled" || event === "unlabeled"
            ? { label: { name: target } }
            : event === "assigned" || event === "unassigned"
              ? { assignee: { login: target } }
              : {};
    return { event, actor: { login, type }, created_at: createdAt, ...details };
}

function page(events: readonly unknown[], headers?: Record<string, string>): Response {
    return success(JSON.stringify(events), headers);
}

/** A `link` header naming `rel="last"`, the shape GitHub paginates with. */
function linkTo(lastPage: number): Record<string, string> {
    return {
        link:
            `<${TIMELINE_URL}?per_page=100&page=2>; rel="next", ` +
            `<${TIMELINE_URL}?per_page=100&page=${String(lastPage)}>; rel="last"`,
    };
}

function source(steps: Parameters<typeof harness>[0], cause?: CauseFingerprint) {
    const built = harness(steps);
    const lookup = orderingEvidenceSource({
        http: built.client,
        repository: REPOSITORY,
        ...(cause === undefined ? {} : { cause }),
    });
    return { lookup, scripted: built.scripted };
}

describe("cause exclusion respects the action kind", () => {
    it("does not exclude a different counted kind sharing actor, second, and a null target", async () => {
        // cause: a close (target null); timeline: a reopen by the same
        // actor in the same second — different human intent, must count.
        const cause: CauseFingerprint = {
            actorLogin: "maintainer",
            observedAt: new Date(AT),
            itemNumber: 7,
            action: "closed",
            target: null,
        };
        const { lookup } = source([page([entry("reopened", "maintainer", AT)])], cause);

        expect(await lookup(ITEM)).toEqual(new Date(AT));
    });

    it("replaces an older find with a newer one on the same page", async () => {
        const { lookup } = source([
            page([
                entry("labeled", "maintainer", "2026-08-20T10:00:00Z"),
                entry("closed", "maintainer", "2026-08-20T12:00:00Z"),
            ]),
        ]);

        expect(await lookup(ITEM)).toEqual(new Date("2026-08-20T12:00:00Z"));
    });
});

describe("installation grants", () => {
    it("answers with the live token's grants", async () => {
        const { source } = tokenSource([{ ok: true, token: token("t") }]);

        expect(await installationGrants(source)).toEqual({
            ok: true,
            grants: ["issues:write"],
        });
    });

    it("propagates a classified mint failure, never an empty grant list", async () => {
        const { source } = tokenSource([{ ok: false, failure: { kind: "transient" } }]);

        expect(await installationGrants(source)).toEqual({
            ok: false,
            failure: { kind: "transient" },
        });
    });

    it("moves with the token when a refresh changes the grants", async () => {
        const widened = { ...token("t2"), grants: ["issues:write", "contents:read"] } as const;
        const { source } = tokenSource([
            { ok: true, token: token("t1") },
            { ok: true, token: widened },
        ]);

        expect(await installationGrants(source)).toEqual({
            ok: true,
            grants: ["issues:write"],
        });
        expect(await installationGrants(source)).toEqual({
            ok: true,
            grants: ["issues:write", "contents:read"],
        });
    });
});

describe("ordering evidence", () => {
    it("answers the newest human change on a single page", async () => {
        const { lookup, scripted } = source([
            page([
                entry("closed", "maintainer", "2026-08-20T12:00:00Z"),
                entry("labeled", "maintainer", "2026-08-20T10:00:00Z"),
                entry("labeled", "app[bot]", "2026-08-21T09:00:00Z", "Bot"),
            ]),
        ]);

        expect(await lookup(ITEM)).toEqual(new Date("2026-08-20T12:00:00Z"));
        expect(scripted.calls).toHaveLength(1);
        expect(scripted.calls[0]!.url).toBe(`${TIMELINE_URL}?per_page=100&page=1`);
    });

    it("answers null when only bots and uncounted kinds acted", async () => {
        const { lookup } = source([
            page([
                entry("labeled", "app[bot]", "2026-08-20T10:00:00Z", "Bot"),
                entry("commented", "maintainer", "2026-08-20T11:00:00Z"),
                entry("milestoned", "maintainer", "2026-08-20T12:00:00Z"),
                entry("cross-referenced", "maintainer", "2026-08-20T13:00:00Z"),
            ]),
        ]);

        expect(await lookup(ITEM)).toBeNull();
    });

    it.each(["labeled", "unlabeled", "assigned", "unassigned", "closed", "reopened"])(
        "counts a lone %s event as a human change",
        async (kind) => {
            const { lookup } = source([page([entry(kind, "maintainer", "2026-08-20T10:00:00Z")])]);
            expect(await lookup(ITEM)).toEqual(new Date("2026-08-20T10:00:00Z"));
        },
    );

    it("excludes the cause but keeps ties from another actor and later changes", async () => {
        const cause = CAUSE;
        const causeOnly = source(
            [page([entry("labeled", "maintainer", "2026-08-20T10:00:00Z")])],
            cause,
        );
        expect(await causeOnly.lookup(ITEM)).toBeNull();

        // A DIFFERENT actor in the cause's second still counts (D33).
        const tie = source(
            [page([entry("labeled", "other-human", "2026-08-20T10:00:00Z")])],
            cause,
        );
        expect(await tie.lookup(ITEM)).toEqual(new Date("2026-08-20T10:00:00Z"));

        // The same actor a second LATER is genuinely newer intent.
        const later = source(
            [page([entry("labeled", "maintainer", "2026-08-20T10:00:01Z")])],
            cause,
        );
        expect(await later.lookup(ITEM)).toEqual(new Date("2026-08-20T10:00:01Z"));
    });

    it.each([
        ["another action", entry("unassigned", "maintainer", AT)],
        ["the opposite action on the same label", entry("unlabeled", "maintainer", AT)],
        ["another label", entry("labeled", "maintainer", AT, "User", "other")],
        ["another identical action", entry("labeled", "maintainer", AT)],
    ])("keeps %s by the same human in the same second", async (_name, other) => {
        const { lookup } = source([page([entry("labeled", "maintainer", AT), other])], CAUSE);
        expect(await lookup(ITEM)).toEqual(new Date(AT));
    });

    it("never excludes a matching action on another item", async () => {
        const { lookup } = source([page([entry("labeled", "maintainer", AT)])], CAUSE);
        expect(await lookup({ kind: "issue", number: 8 })).toEqual(new Date(AT));
    });

    it("excludes the cause only once across pages", async () => {
        const match = entry("labeled", "maintainer", AT);
        const { lookup } = source([page([match], linkTo(3)), page([match]), page([])], CAUSE);
        expect(await lookup(ITEM)).toEqual(new Date(AT));
    });

    it("matches assignment targets and state changes", async () => {
        for (const action of ["unlabeled", "assigned", "unassigned", "closed", "reopened"]) {
            const target = action === "closed" || action === "reopened" ? null : "triage";
            const cause = { ...CAUSE, action, target };
            const { lookup } = source([page([entry(action, "maintainer", AT)])], cause);
            expect(await lookup(ITEM)).toBeNull();
        }
        const { lookup } = source([page([entry("assigned", "maintainer", AT, "User", "other")])], {
            ...CAUSE,
            action: "assigned",
        });
        expect(await lookup(ITEM)).toEqual(new Date(AT));
    });

    it("reads each item once per delivery, sharing the in-flight read", async () => {
        // A function step mints a fresh Response per call — a body reads once.
        const { lookup, scripted } = source([() => page([])]);

        const [a, b] = await Promise.all([lookup(ITEM), lookup(ITEM)]);
        await lookup(ITEM);
        expect(a).toBeNull();
        expect(b).toBeNull();
        expect(scripted.calls).toHaveLength(1);

        await lookup({ kind: "issue", number: 8 });
        expect(scripted.calls).toHaveLength(2);
    });

    it("answers unknown for a failed read, never null", async () => {
        const failing = source([failure(500, "[]"), failure(500, "[]")]);
        expect(await failing.lookup(ITEM)).toBe("unknown");

        const malformed = source([success("not json")]);
        expect(await malformed.lookup(ITEM)).toBe("unknown");

        const nonArray = source([success('{"events": []}')]);
        expect(await nonArray.lookup(ITEM)).toBe("unknown");
    });

    it("answers unknown when a counted event cannot be ordered", async () => {
        const badDate = source([page([entry("labeled", "maintainer", "not a date")])]);
        expect(await badDate.lookup(ITEM)).toBe("unknown");

        const missingDate = source([page([{ event: "labeled", actor: { type: "User" } }])]);
        expect(await missingDate.lookup(ITEM)).toBe("unknown");

        const numericDate = source([
            page([{ event: "labeled", actor: { type: "User" }, created_at: 0 }]),
        ]);
        expect(await numericDate.lookup(ITEM)).toBe("unknown");
    });

    it.each([undefined, null, {}, { type: "Unexpected" }])(
        "answers unknown for an unidentified actor: %j",
        async (actor) => {
            const { lookup } = source([page([{ event: "labeled", actor, created_at: AT }])]);
            expect(await lookup(ITEM)).toBe("unknown");
        },
    );

    it("answers unknown when next exists but the last page is unavailable", async () => {
        const { lookup, scripted } = source([
            page([], {
                link: `<${TIMELINE_URL}?page=2>; rel="next"`,
            }),
        ]);
        expect(await lookup(ITEM)).toBe("unknown");
        expect(scripted.calls).toHaveLength(1);
    });

    it("treats a link header without rel=last as a single page", async () => {
        const { lookup, scripted } = source([
            page([entry("labeled", "maintainer", "2026-08-20T10:00:00Z")], {
                link: `<${TIMELINE_URL}?per_page=100&page=1>; rel="prev"`,
            }),
        ]);

        expect(await lookup(ITEM)).toEqual(new Date("2026-08-20T10:00:00Z"));
        expect(scripted.calls).toHaveLength(1);
    });

    it("answers unknown when a descending page fails or cannot be ordered", async () => {
        const failing = source([page([], linkTo(2)), failure(500, "boom"), failure(500, "boom")]);
        expect(await failing.lookup(ITEM)).toBe("unknown");

        const unparsable = source([
            page([], linkTo(2)),
            page([entry("labeled", "maintainer", "not a date")]),
        ]);
        expect(await unparsable.lookup(ITEM)).toBe("unknown");
    });

    it("finds the newest change on the last page of two", async () => {
        const { lookup, scripted } = source([
            page([entry("labeled", "maintainer", "2026-08-01T00:00:00Z")], linkTo(2)),
            page([entry("reopened", "maintainer", "2026-08-21T00:00:00Z")]),
        ]);

        expect(await lookup(ITEM)).toEqual(new Date("2026-08-21T00:00:00Z"));
        expect(scripted.calls).toHaveLength(2);
        expect(scripted.calls[1]!.url).toBe(`${TIMELINE_URL}?per_page=100&page=2`);
    });

    it("answers null across two fully visited pages with no human change", async () => {
        const { lookup, scripted } = source([
            page([entry("labeled", "app[bot]", "2026-08-01T00:00:00Z", "Bot")], linkTo(2)),
            page([]),
        ]);

        expect(await lookup(ITEM)).toBeNull();
        expect(scripted.calls).toHaveLength(2);
    });

    it("stops paying once the last page answers, even on a long timeline", async () => {
        const { lookup, scripted } = source([
            page([], linkTo(5)),
            page([entry("unassigned", "maintainer", "2026-08-22T00:00:00Z")]),
        ]);

        expect(await lookup(ITEM)).toEqual(new Date("2026-08-22T00:00:00Z"));
        expect(scripted.calls).toHaveLength(2);
        expect(scripted.calls[1]!.url).toBe(`${TIMELINE_URL}?per_page=100&page=5`);
    });

    it("answers unknown at the call cap when coverage stays partial", async () => {
        // A human change sits on page 1, but pages 2-3 were never read: a
        // Date from page 1 could understate the newest change, so refuse.
        const { lookup, scripted } = source([
            page([entry("labeled", "maintainer", "2026-08-01T00:00:00Z")], linkTo(5)),
            page([]),
            page([]),
        ]);

        expect(await lookup(ITEM)).toBe("unknown");
        expect(scripted.calls).toHaveLength(3);
        expect(scripted.calls[1]!.url).toBe(`${TIMELINE_URL}?per_page=100&page=5`);
        expect(scripted.calls[2]!.url).toBe(`${TIMELINE_URL}?per_page=100&page=4`);
    });

    it("answers null for a fully visited three-page timeline with no human change", async () => {
        const { lookup, scripted } = source([page([], linkTo(3)), page([]), page([])]);

        expect(await lookup(ITEM)).toBeNull();
        expect(scripted.calls).toHaveLength(3);
    });
});

/**
 * Four different problems reach a decision as the same word. These pin that
 * an operator can still tell them apart (D20).
 */
describe("why an ordering came back unknown", () => {
    /** An ordering source that keeps every reason it gave. */
    function reasoned(steps: Parameters<typeof harness>[0]) {
        const details: string[] = [];
        const built = harness(steps);
        return {
            lookup: orderingEvidenceSource({
                http: built.client,
                repository: REPOSITORY,
                onUnknownOrdering: (detail) => details.push(detail),
            }),
            details,
        };
    }

    it("names the classified failure behind a refused read", async () => {
        const { lookup, details } = reasoned([failure(500, "[]"), failure(500, "[]")]);

        expect(await lookup(ITEM)).toBe("unknown");
        expect(details).toEqual([
            "#7 ordering unknown: page 1: GitHub refused the read: transient",
        ]);
    });

    it("tells a nonsense body from a page count GitHub would not name", async () => {
        const nonArray = reasoned([success('{"events": []}')]);
        expect(await nonArray.lookup(ITEM)).toBe("unknown");
        expect(nonArray.details).toEqual([
            "#7 ordering unknown: page 1: GitHub's timeline body was not a JSON array",
        ]);

        const advertised = reasoned([page([], { link: `<${TIMELINE_URL}?page=2>; rel="next"` })]);
        expect(await advertised.lookup(ITEM)).toBe("unknown");
        expect(advertised.details).toEqual([
            "#7 ordering unknown: page 1: GitHub advertised a next page without naming the last",
        ]);
    });

    it("names the page a later read failed on", async () => {
        const { lookup, details } = reasoned([
            page([], linkTo(2)),
            failure(500, "boom"),
            failure(500, "boom"),
        ]);

        expect(await lookup(ITEM)).toBe("unknown");
        expect(details).toEqual([
            "#7 ordering unknown: page 2: GitHub refused the read: transient",
        ]);
    });

    it("tells an unreadable entry from a timeline the cap cannot cover", async () => {
        const broken = reasoned([page([entry("labeled", "maintainer", "not a date")])]);
        expect(await broken.lookup(ITEM)).toBe("unknown");
        expect(broken.details).toEqual([
            "#7 ordering unknown: a timeline entry carried an unreadable actor or timestamp",
        ]);

        const tooLong = reasoned([page([], linkTo(5)), page([]), page([])]);
        expect(await tooLong.lookup(ITEM)).toBe("unknown");
        expect(tooLong.details).toEqual([
            "#7 ordering unknown: the timeline is longer than 3 reads may cover",
        ]);
    });

    it("says nothing when the ordering is established", async () => {
        const found = reasoned([page([entry("labeled", "maintainer", AT)])]);
        expect(await found.lookup(ITEM)).toEqual(new Date(AT));
        expect(found.details).toEqual([]);

        const absent = reasoned([page([])]);
        expect(await absent.lookup(ITEM)).toBeNull();
        expect(absent.details).toEqual([]);
    });

    it("contains a diagnostic seam that throws, and answers anyway", async () => {
        const lookup = orderingEvidenceSource({
            http: harness([success("not json")]).client,
            repository: REPOSITORY,
            onUnknownOrdering: () => {
                throw new Error("the log is gone");
            },
        });

        expect(await lookup(ITEM)).toBe("unknown");
    });

    it("carries the sink from a delivery's live externals to the read", async () => {
        const details: string[] = [];
        const built = harness([success("not json")]);
        const outcome = await liveExternalsForDelivery(
            {
                tokenSource: tokenSource([{ ok: true, token: token("t") }]).source,
                http: built.client,
                repository: REPOSITORY,
                onUnknownOrdering: (detail) => details.push(detail),
            },
            PAYLOAD,
        );

        expect(outcome.ok).toBe(true);
        if (!outcome.ok) return;
        expect(await outcome.facts.latestHumanChangeAt(ITEM)).toBe("unknown");
        expect(details).toEqual([
            "#7 ordering unknown: page 1: GitHub's timeline body was not a JSON array",
        ]);
    });
});

describe("the cause fingerprint", () => {
    it("reads the sender and the item's updated_at, the normalizer's field", () => {
        expect(
            causeFingerprintOf({
                action: "labeled",
                label: { name: "triage" },
                sender: { login: "maintainer" },
                issue: { number: 7, updated_at: "2026-08-20T10:00:00Z" },
            }),
        ).toEqual(CAUSE);
    });

    it("falls back to the pull request when the payload carries no issue", () => {
        expect(
            causeFingerprintOf({
                action: "closed",
                sender: { login: "maintainer" },
                pull_request: { number: 8, updated_at: "2026-08-20T11:00:00Z" },
            }),
        ).toEqual({
            ...CAUSE,
            itemNumber: 8,
            action: "closed",
            target: null,
            observedAt: new Date("2026-08-20T11:00:00Z"),
        });
    });

    it.each([
        ["a non-object payload", undefined],
        ["a missing sender", { ...PAYLOAD, sender: undefined }],
        ["a non-string login", { ...PAYLOAD, sender: { login: 7 } }],
        ["a missing updated_at", { ...PAYLOAD, issue: { number: 7 } }],
        ["an unreadable updated_at", { ...PAYLOAD, issue: { number: 7, updated_at: "later" } }],
        ["a numeric updated_at", { ...PAYLOAD, issue: { number: 7, updated_at: 0 } }],
        ["a missing action", { ...PAYLOAD, action: undefined }],
        ["an uncounted action", { ...PAYLOAD, action: "opened" }],
        ["a missing label", { ...PAYLOAD, label: undefined }],
        ["a missing assignee", { ...PAYLOAD, action: "assigned" }],
        ["a missing item number", { ...PAYLOAD, issue: { updated_at: AT } }],
        ["a non-integer item number", { ...PAYLOAD, issue: { number: 1.5, updated_at: AT } }],
        ["a non-positive item number", { ...PAYLOAD, issue: { number: 0, updated_at: AT } }],
    ])("answers nothing to exclude for %s", (_label, payload) => {
        expect(causeFingerprintOf(payload)).toBeUndefined();
    });

    it.each(["assigned", "unassigned"])("reads the %s target", (action) => {
        expect(
            causeFingerprintOf({ ...PAYLOAD, action, assignee: { login: "contributor" } }),
        ).toEqual({ ...CAUSE, action, target: "contributor" });
    });

    it("accepts the first item number", () => {
        expect(causeFingerprintOf({ ...PAYLOAD, issue: { number: 1, updated_at: AT } })).toEqual({
            ...CAUSE,
            itemNumber: 1,
        });
    });
});

describe("live externals for one delivery", () => {
    it("propagates a grants failure instead of deciding without them", async () => {
        const tokens = tokenSource([{ ok: false, failure: { kind: "transient" } }]);
        const built = harness([page([])]);

        expect(
            await liveExternalsForDelivery(
                { tokenSource: tokens.source, http: built.client, repository: REPOSITORY },
                PAYLOAD,
            ),
        ).toEqual({ ok: false, failure: { kind: "transient" } });
        expect(built.scripted.calls).toHaveLength(0);
    });

    it("supplies live grants and ordering that excludes the delivery's cause", async () => {
        const tokens = tokenSource([{ ok: true, token: token("t") }]);
        const built = harness([page([entry("labeled", "maintainer", "2026-08-20T10:00:00Z")])]);

        const outcome = await liveExternalsForDelivery(
            { tokenSource: tokens.source, http: built.client, repository: REPOSITORY },
            PAYLOAD,
        );

        expect(outcome.ok).toBe(true);
        if (outcome.ok) {
            expect(outcome.facts.installationGrants).toEqual(["issues:write"]);
            expect(
                await outcome.facts.resolve("isAutomationActor", { login: "automation[bot]" }),
            ).toEqual({ ok: true, value: true });
            // The only timeline entry is the causing event: excluded.
            expect(await outcome.facts.latestHumanChangeAt(ITEM)).toBeNull();
        }
        expect(built.scripted.calls[0]!.url).toBe(`${TIMELINE_URL}?per_page=100&page=1`);
    });

    it("applies no exclusion when the payload names no cause", async () => {
        const tokens = tokenSource([{ ok: true, token: token("t") }]);
        const built = harness([page([entry("labeled", "maintainer", "2026-08-20T10:00:00Z")])]);

        const outcome = await liveExternalsForDelivery(
            { tokenSource: tokens.source, http: built.client, repository: REPOSITORY },
            {},
        );

        if (outcome.ok) {
            expect(await outcome.facts.latestHumanChangeAt(ITEM)).toEqual(
                new Date("2026-08-20T10:00:00Z"),
            );
        }
        expect(outcome.ok).toBe(true);
    });

    it("binds a fresh ordering memo to every delivery", async () => {
        const tokens = tokenSource([{ ok: true, token: token("t") }]);
        const built = harness([() => page([])]);
        const options = {
            tokenSource: tokens.source,
            http: built.client,
            repository: REPOSITORY,
        };

        const first = await liveExternalsForDelivery(options, PAYLOAD);
        const second = await liveExternalsForDelivery(options, PAYLOAD);
        if (first.ok) await first.facts.latestHumanChangeAt(ITEM);
        if (second.ok) await second.facts.latestHumanChangeAt(ITEM);

        // Two deliveries, one item: two reads — nothing crosses a delivery.
        expect(built.scripted.calls).toHaveLength(2);
    });
});
