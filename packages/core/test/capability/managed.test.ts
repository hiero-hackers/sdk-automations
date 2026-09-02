/**
 * Managed-comment identity (D125): what the platform mints, what it refuses to
 * read back, and the one judgement that decides whether a comment is a given
 * effect's.
 *
 * The marker's exact bytes are pinned. They are a wire format — comments
 * already posted by an earlier deployment must still be recognised — so a
 * change to the spelling is a schema change, and this is where it stops being
 * an accident.
 */

import { describe, expect, it } from "vitest";
import {
    MANAGED_COMMENT_KINDS,
    MANAGED_COMMENT_MISMATCHES,
    MANAGED_EFFECT_DIGEST_LENGTH,
    MANAGED_MARKER_PREFIX,
    MANAGED_MARKER_REJECTIONS,
    MANAGED_MARKER_SCHEMA_VERSION,
    MANAGED_MARKER_SUFFIX,
    MANAGED_PAYLOAD_BYTE_LIMIT,
    deriveManagedMarker,
    managedCommentOf,
    managedMarkerPayload,
    matchesManagedComment,
    parseManagedMarker,
    type ManagedIdentity,
} from "../../src/index.js";

const identity: ManagedIdentity = {
    capability: "prQuality",
    kind: "summary",
    effectId:
        '["prQuality","o","r","pullRequest","12","postManagedComment","c","2026-08-03T09:00:00.000Z"]',
};

/** A marker built from parts, so a test can vary one field without retyping the rest. */
const markerOf = (payload: unknown): string =>
    `${MANAGED_MARKER_PREFIX}${JSON.stringify(payload)}${MANAGED_MARKER_SUFFIX}`;

describe("what the platform mints", () => {
    /**
     * The whole marker, byte for byte: prefix, field order, and the digest
     * length. Nothing else in the suite would notice a reordered payload, and a
     * reordered payload is a different string for every comment already posted.
     */
    it("is an HTML comment carrying version, capability, kind and effect digest", () => {
        expect(deriveManagedMarker(identity)).toBe(
            '<!-- hiero-automation:{"schemaVersion":1,"capability":"prQuality","kind":"summary","effect":"0a70e62c14228dbe"} -->',
        );
    });

    it("pairs the identity with its marker", () => {
        expect(managedCommentOf(identity)).toEqual({
            identity,
            marker: deriveManagedMarker(identity),
        });
    });

    /**
     * The digest is of the effect id and nothing else. Two effects differing
     * only in their id must not share a marker, or a retry would edit the wrong
     * comment — the failure 6.5 measured.
     */
    it("gives different effects different digests, and the same effect the same one", () => {
        const other = { ...identity, effectId: `${identity.effectId} ` };
        expect(managedMarkerPayload(other).effect).not.toBe(managedMarkerPayload(identity).effect);
        expect(managedMarkerPayload({ ...identity }).effect).toBe(
            managedMarkerPayload(identity).effect,
        );
        expect(managedMarkerPayload(identity).effect).toHaveLength(MANAGED_EFFECT_DIGEST_LENGTH);
    });

    /** Capability and kind are identity too, not decoration on it. */
    it("gives every kind and every capability its own marker", () => {
        const markers = MANAGED_COMMENT_KINDS.map((kind) =>
            deriveManagedMarker({ ...identity, kind }),
        );
        expect(new Set(markers).size).toBe(MANAGED_COMMENT_KINDS.length);
        expect(deriveManagedMarker({ ...identity, capability: "intake" })).not.toBe(
            deriveManagedMarker(identity),
        );
    });

    /**
     * Body content is not identity. `deriveIdempotencyKey` excludes the desired
     * payload so a reworded comment stays one effect; a marker that moved with
     * the wording would undo that, and would also change under every UPDATE.
     */
    it("takes nothing from a comment's wording — the identity has no body to take", () => {
        expect(Object.keys(managedMarkerPayload(identity))).toEqual([
            "schemaVersion",
            "capability",
            "kind",
            "effect",
        ]);
    });

    it("round-trips everything it mints", () => {
        for (const kind of MANAGED_COMMENT_KINDS) {
            const mine = { ...identity, kind };
            expect(parseManagedMarker(deriveManagedMarker(mine))).toEqual({
                recognized: managedMarkerPayload(mine),
            });
        }
    });

    /** The applier writes the body after the marker; identity survives it. */
    it("round-trips with a rendered body following the marker", () => {
        const body = `${deriveManagedMarker(identity)}\nThis pull request does not reference an issue.`;
        expect(parseManagedMarker(body)).toEqual({ recognized: managedMarkerPayload(identity) });
    });
});

describe("what the parser refuses, and why", () => {
    const rejection = (body: string): string | null => {
        const reading = parseManagedMarker(body);
        return "unrecognized" in reading ? reading.unrecognized : null;
    };

    /** Every documented reason is reachable — a vocabulary with a dead entry is a lie. */
    it("reaches every rejection reason exactly once", () => {
        const reached = [
            rejection("Thanks for opening this."),
            rejection(markerOf({ schemaVersion: 1, capability: "x".repeat(600) })),
            rejection(markerOf({ schemaVersion: 1, capability: "prQuality" })),
            rejection(markerOf({ ...managedMarkerPayload(identity), schemaVersion: 2 })),
        ];
        expect(reached).toEqual([...MANAGED_MARKER_REJECTIONS]);
    });

    it("refuses a body with no marker, and one whose marker never closes", () => {
        expect(rejection("")).toBe("noMarker");
        expect(rejection("Thanks for opening this.")).toBe("noMarker");
        // The marker must be the body's FIRST bytes: quoted inside prose it is
        // not a claim, which is why a leading space is enough to lose it.
        expect(rejection(` ${deriveManagedMarker(identity)}`)).toBe("noMarker");
        expect(rejection(`${MANAGED_MARKER_PREFIX}{"schemaVersion":1}`)).toBe("noMarker");
    });

    /**
     * The cap is on the PAYLOAD, not the comment: a long human comment that
     * happens to open with the prefix is refused for what it says, not its size.
     */
    it("refuses a payload over the byte limit, and accepts one at it", () => {
        const padded = (bytes: number) => {
            const skeleton = JSON.stringify({ ...managedMarkerPayload(identity), pad: "" });
            return markerOf({
                ...managedMarkerPayload(identity),
                pad: "x".repeat(bytes - skeleton.length),
            });
        };
        expect(rejection(padded(MANAGED_PAYLOAD_BYTE_LIMIT))).toBe(null);
        expect(rejection(padded(MANAGED_PAYLOAD_BYTE_LIMIT + 1))).toBe("oversized");
    });

    /** Bytes, not characters: one emoji is four of them. */
    it("counts the limit in UTF-8 bytes", () => {
        const skeleton = JSON.stringify({ ...managedMarkerPayload(identity), pad: "" });
        const room = MANAGED_PAYLOAD_BYTE_LIMIT - skeleton.length;
        const emoji = "\u{1F600}".repeat(Math.floor(room / 4));
        expect(rejection(markerOf({ ...managedMarkerPayload(identity), pad: emoji }))).toBe(null);
        expect(
            rejection(markerOf({ ...managedMarkerPayload(identity), pad: `${emoji}\u{1F600}` })),
        ).toBe("oversized");
    });

    it("refuses anything that is not a JSON object of the fields v1 declares", () => {
        const payload = managedMarkerPayload(identity);
        expect(rejection(`${MANAGED_MARKER_PREFIX}not json${MANAGED_MARKER_SUFFIX}`)).toBe(
            "malformed",
        );
        expect(rejection(markerOf([payload]))).toBe("malformed");
        expect(rejection(markerOf("a string"))).toBe("malformed");
        expect(rejection(markerOf(null))).toBe("malformed");
        expect(rejection(markerOf({ ...payload, capability: 7 }))).toBe("malformed");
        expect(rejection(markerOf({ ...payload, capability: "" }))).toBe("malformed");
        expect(rejection(markerOf({ ...payload, kind: "gossip" }))).toBe("malformed");
        expect(rejection(markerOf({ ...payload, effect: "not-hex-at-all!" }))).toBe("malformed");
        expect(rejection(markerOf({ ...payload, effect: payload.effect.slice(1) }))).toBe(
            "malformed",
        );
        expect(rejection(markerOf({ ...payload, effect: `${payload.effect}0` }))).toBe("malformed");
        expect(rejection(markerOf({ ...payload, effect: payload.effect.toUpperCase() }))).toBe(
            "malformed",
        );
    });

    /**
     * A version below one was never written by anything, so it is a defect
     * rather than a newer deployment. The boundary is worth pinning in both
     * directions: exactly the current version reads, one above waits.
     */
    it("separates a future version from a malformed one", () => {
        const payload = managedMarkerPayload(identity);
        expect(
            rejection(markerOf({ ...payload, schemaVersion: MANAGED_MARKER_SCHEMA_VERSION })),
        ).toBe(null);
        expect(
            rejection(markerOf({ ...payload, schemaVersion: MANAGED_MARKER_SCHEMA_VERSION + 1 })),
        ).toBe("futureVersion");
        expect(rejection(markerOf({ ...payload, schemaVersion: 99 }))).toBe("futureVersion");
        expect(rejection(markerOf({ ...payload, schemaVersion: 0 }))).toBe("malformed");
        expect(rejection(markerOf({ ...payload, schemaVersion: -1 }))).toBe("malformed");
        expect(rejection(markerOf({ ...payload, schemaVersion: 1.5 }))).toBe("malformed");
        expect(rejection(markerOf({ ...payload, schemaVersion: "1" }))).toBe("malformed");
        expect(rejection(markerOf({ capability: "prQuality", kind: "summary" }))).toBe("malformed");
    });

    /**
     * A future version is refused before its other fields are judged: this
     * reader has no grounds to call a v2 field malformed, and the two answers
     * need different responses.
     */
    it("calls a future version future even when the rest of it makes no sense", () => {
        expect(rejection(markerOf({ schemaVersion: 2, whatever: true }))).toBe("futureVersion");
    });
});

describe("is this comment this effect's?", () => {
    const marker = deriveManagedMarker(identity);

    it("recognises the App's own comment", () => {
        expect(matchesManagedComment({ body: marker, authoredByApp: true }, identity)).toEqual({
            matches: true,
        });
        expect(
            matchesManagedComment(
                { body: `${marker}\nrendered content`, authoredByApp: true },
                identity,
            ),
        ).toEqual({ matches: true });
    });

    /**
     * The attack managed-output.md §4 names: a repository user copies the App's
     * marker into their own comment. Byte-identical, and never a match — which
     * is why authorship is a parameter of the judgement rather than a check the
     * caller is trusted to have already done.
     */
    it("refuses a byte-identical marker under another author", () => {
        expect(matchesManagedComment({ body: marker, authoredByApp: false }, identity)).toEqual({
            matches: false,
            why: "notAppAuthored",
        });
    });

    /** Authorship is answered first: an unauthored body is never even parsed. */
    it("puts authorship ahead of the bytes, whatever the bytes are", () => {
        for (const body of ["", marker, "nothing like a marker", `${marker}extra`]) {
            expect(matchesManagedComment({ body, authoredByApp: false }, identity)).toEqual({
                matches: false,
                why: "notAppAuthored",
            });
        }
    });

    /** Every documented mismatch is reachable, and they stay three distinct answers. */
    it("reaches every mismatch reason exactly once", () => {
        const why = (candidate: { body: string; authoredByApp: boolean }): string | null => {
            const verdict = matchesManagedComment(candidate, identity);
            return verdict.matches ? null : verdict.why;
        };
        expect([
            why({ body: marker, authoredByApp: false }),
            why({ body: "a human wrote this", authoredByApp: true }),
            why({
                body: deriveManagedMarker({ ...identity, capability: "intake" }),
                authoredByApp: true,
            }),
        ]).toEqual([...MANAGED_COMMENT_MISMATCHES]);
    });

    /** A future-version marker is an unrecognised one, not another effect's. */
    it("reads an unreadable marker as no marker at all", () => {
        expect(
            matchesManagedComment(
                { body: markerOf({ schemaVersion: 2 }), authoredByApp: true },
                identity,
            ),
        ).toEqual({ matches: false, why: "noManagedMarker" });
    });

    /** Each field of the identity is load-bearing, one at a time. */
    it.each([
        ["capability", { capability: "intake" }],
        ["kind", { kind: "warning" as const }],
        ["effect id", { effectId: "a different occasion" }],
    ])("does not match the App's own comment for a different %s", (_field, differing) => {
        expect(
            matchesManagedComment(
                { body: deriveManagedMarker({ ...identity, ...differing }), authoredByApp: true },
                identity,
            ),
        ).toEqual({ matches: false, why: "otherEffect" });
    });
});
