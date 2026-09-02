/**
 * The App's own comment: how one is marked, and how the platform recognises
 * one it wrote (D125).
 *
 * Identity is PLATFORM-OWNED. A capability supplies a `kind` and body content;
 * everything that answers "which effect does this comment belong to" is derived
 * here from facts the capability cannot choose. `catalogue.ts` owns the kind
 * vocabulary and nothing else here is imported by it, so this file sits one step
 * below the rest of the directory.
 *
 * Three total functions, in the order a write uses them: `managedCommentOf`
 * mints the marker for an effect, `parseManagedMarker` reads untrusted bytes
 * back, and `matchesManagedComment` judges whether one comment is a given
 * effect's. Nothing throws.
 */

import { createHash } from "node:crypto";
import { MANAGED_COMMENT_KINDS, type ManagedCommentKind } from "./catalogue.js";

// ─── Shape and bounds ────────────────────────────────────────────────

/**
 * The marker's opening bytes. The schema version lives in the PAYLOAD rather
 * than here on purpose: a v2 marker must still match the prefix so the parser
 * can refuse it as a future version, instead of missing it and treating a
 * newer deployment's comment as absent.
 */
export const MANAGED_MARKER_PREFIX = "<!-- hiero-automation:";

/** The marker's closing bytes — the payload is everything between the two. */
export const MANAGED_MARKER_SUFFIX = " -->";

/** The only payload schema that exists. Anything higher is refused, not read. */
export const MANAGED_MARKER_SCHEMA_VERSION = 1;

/**
 * Bounds, and why each is what it is.
 *
 * `MANAGED_PAYLOAD_BYTE_LIMIT` caps the UTF-8 bytes handed to `JSON.parse`. A
 * GitHub comment body runs to 65536 characters, and recognition is a test run
 * over every comment on an item — parsing a hostile 64 KiB payload per comment
 * is work a cheap test should not do. A v1 payload is around 110 bytes, so 512
 * is four times the room a second field would need.
 *
 * `MANAGED_EFFECT_DIGEST_LENGTH` is the hex prefix of the effect id's SHA-256.
 * The comparison space is the handful of App-authored comments on ONE item, so
 * 64 bits is already far past what distinguishing them needs; collisions are
 * not a security boundary here, because authorship is.
 */
export const MANAGED_PAYLOAD_BYTE_LIMIT = 512;
export const MANAGED_EFFECT_DIGEST_LENGTH = 16;

/**
 * What the platform knows before it writes: the effect a managed comment will
 * belong to.
 *
 * `effectId` is the intent's idempotency key — the store's `effect_id` (D65) —
 * so the comment and the journal row name the same effect. `desired.body` is
 * deliberately absent, for the reason `deriveIdempotencyKey` excludes the
 * payload: a capability that recomputes slightly different wording for the same
 * occasion must not thereby address a different comment. Identity must also
 * survive an UPDATE, which changes the body by definition.
 */
export interface ManagedIdentity {
    readonly capability: string;
    readonly kind: ManagedCommentKind;
    readonly effectId: string;
}

/**
 * The identity as published — the JSON object inside the marker.
 *
 * Every field earns its place. `schemaVersion` is what lets a v1 reader refuse
 * a v2 comment rather than misread it (managed-output.md §4). `capability` and
 * `kind` are what make "one short marker per purpose per item" (§2) decidable:
 * two capabilities may both hold a comment on one item, and one capability may
 * hold two purposes. `effect` is the effect id's digest, which is what makes a
 * retry-after-check safe — capability and kind alone would match a comment from
 * an earlier occasion, so a retry would edit that one instead of recognising
 * that its own create had landed.
 *
 * The digest, not the id: the id embeds the capability's free-text cause, and
 * §7 keeps untrusted and internal text out of rendered comments. Nothing needs
 * to read the id back — the journal holds it, and a reader compares digests.
 */
export interface ManagedMarkerPayload {
    readonly schemaVersion: typeof MANAGED_MARKER_SCHEMA_VERSION;
    readonly capability: string;
    readonly kind: ManagedCommentKind;
    readonly effect: string;
}

/** An effect's identity together with the marker that publishes it. */
export interface ManagedComment {
    readonly identity: ManagedIdentity;
    readonly marker: string;
}

// ─── Minting ─────────────────────────────────────────────────────────

const effectDigest = (effectId: string): string =>
    createHash("sha256")
        .update(effectId, "utf8")
        .digest("hex")
        .slice(0, MANAGED_EFFECT_DIGEST_LENGTH);

/** The payload one identity publishes — the comparison both sides of a match use. */
export function managedMarkerPayload(identity: ManagedIdentity): ManagedMarkerPayload {
    return {
        schemaVersion: MANAGED_MARKER_SCHEMA_VERSION,
        capability: identity.capability,
        kind: identity.kind,
        effect: effectDigest(identity.effectId),
    };
}

/**
 * The marker for one effect: an HTML comment, invisible where GitHub renders it.
 *
 * The object literal is written out field by field rather than stringifying the
 * payload record, because `JSON.stringify` preserves insertion order and the
 * marker's bytes must not depend on how the record was built.
 */
export function deriveManagedMarker(identity: ManagedIdentity): string {
    const payload = managedMarkerPayload(identity);
    const encoded = JSON.stringify({
        schemaVersion: payload.schemaVersion,
        capability: payload.capability,
        kind: payload.kind,
        effect: payload.effect,
    });
    return `${MANAGED_MARKER_PREFIX}${encoded}${MANAGED_MARKER_SUFFIX}`;
}

/** Both halves at once — what an approved effect carries downstream. */
export function managedCommentOf(identity: ManagedIdentity): ManagedComment {
    return { identity, marker: deriveManagedMarker(identity) };
}

// ─── Reading untrusted bytes ─────────────────────────────────────────

/** Why a comment body carries no v1 identity (managed-output.md §4). */
export const MANAGED_MARKER_REJECTIONS = [
    "noMarker",
    "oversized",
    "malformed",
    "futureVersion",
] as const;

/** One of `MANAGED_MARKER_REJECTIONS`. */
export type ManagedMarkerRejection = (typeof MANAGED_MARKER_REJECTIONS)[number];

/** What a comment body turned out to be. */
export type ManagedMarkerReading =
    | { readonly recognized: ManagedMarkerPayload }
    | { readonly unrecognized: ManagedMarkerRejection };

const DIGEST_PATTERN = /^[0-9a-f]+$/;

/** A JSON object, or `null` for anything else — arrays and scalars included. */
function jsonObject(text: string): Record<string, unknown> | null {
    try {
        const value: unknown = JSON.parse(text);
        return typeof value === "object" && value !== null && !Array.isArray(value)
            ? (value as Record<string, unknown>)
            : null;
    } catch {
        return null;
    }
}

const UTF8 = new TextEncoder();

const isManagedCommentKind = (value: unknown): value is ManagedCommentKind =>
    (MANAGED_COMMENT_KINDS as readonly unknown[]).includes(value);

/**
 * The identity a comment body carries, or why it carries none.
 *
 * The marker must be the body's FIRST bytes. The platform composes the body, so
 * its own comments always begin with one; requiring the position means a marker
 * quoted inside prose is not even a claim, and recognition costs a prefix test.
 *
 * Version is checked before the other fields so a v2 payload — whose remaining
 * fields this reader has no grounds to judge — is refused as `futureVersion`
 * rather than as `malformed`. The two need different responses: one waits for a
 * newer reader, the other is a defect.
 */
export function parseManagedMarker(body: string): ManagedMarkerReading {
    if (!body.startsWith(MANAGED_MARKER_PREFIX)) return { unrecognized: "noMarker" };
    const end = body.indexOf(MANAGED_MARKER_SUFFIX);
    if (end < 0) return { unrecognized: "noMarker" };

    const encoded = body.slice(MANAGED_MARKER_PREFIX.length, end);
    if (UTF8.encode(encoded).length > MANAGED_PAYLOAD_BYTE_LIMIT) {
        return { unrecognized: "oversized" };
    }

    const fields = jsonObject(encoded);
    if (fields === null) return { unrecognized: "malformed" };

    // The literal 1 is the FIRST schema that ever existed, not the current one:
    // below it is a version nothing ever wrote, which is a defect rather than a
    // deployment this reader is behind.
    const version = fields["schemaVersion"];
    if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
        return { unrecognized: "malformed" };
    }
    if (version > MANAGED_MARKER_SCHEMA_VERSION) return { unrecognized: "futureVersion" };

    const capability = fields["capability"];
    const kind = fields["kind"];
    const effect = fields["effect"];
    if (typeof capability !== "string" || capability === "") return { unrecognized: "malformed" };
    if (!isManagedCommentKind(kind)) return { unrecognized: "malformed" };
    if (
        typeof effect !== "string" ||
        effect.length !== MANAGED_EFFECT_DIGEST_LENGTH ||
        !DIGEST_PATTERN.test(effect)
    ) {
        return { unrecognized: "malformed" };
    }

    return {
        recognized: {
            schemaVersion: MANAGED_MARKER_SCHEMA_VERSION,
            capability,
            kind,
            effect,
        },
    };
}

// ─── The judgement ───────────────────────────────────────────────────

/** Why a comment is not this effect's. */
export const MANAGED_COMMENT_MISMATCHES = [
    "notAppAuthored",
    "noManagedMarker",
    "otherEffect",
] as const;

/** One of `MANAGED_COMMENT_MISMATCHES`. */
export type ManagedCommentMismatch = (typeof MANAGED_COMMENT_MISMATCHES)[number];

/**
 * A comment offered for recognition: its bytes, and who wrote them.
 *
 * The two travel together so that no caller can hold a body without also
 * holding the authorship fact. That is the whole reason this is a record rather
 * than a `string` parameter — a marker is worthless as evidence on its own, and
 * a signature that accepted one alone would make the copied-marker attack a
 * matter of remembering to check (managed-output.md §4).
 */
export interface ManagedCommentCandidate {
    readonly body: string;
    readonly authoredByApp: boolean;
}

/** Whether the candidate is this effect's managed comment, or why it is not. */
export type ManagedCommentMatch =
    { readonly matches: true } | { readonly matches: false; readonly why: ManagedCommentMismatch };

/**
 * Is this comment THIS effect's managed comment?
 *
 * Authorship is answered first, before the bytes are read at all: a marker
 * copied into a repository user's comment must never reach the parser, let
 * alone a comparison (D125). A byte-identical marker under any other author is
 * `notAppAuthored`, never a match.
 */
export function matchesManagedComment(
    candidate: ManagedCommentCandidate,
    identity: ManagedIdentity,
): ManagedCommentMatch {
    if (!candidate.authoredByApp) return { matches: false, why: "notAppAuthored" };

    const reading = parseManagedMarker(candidate.body);
    if (!("recognized" in reading)) return { matches: false, why: "noManagedMarker" };

    const found = reading.recognized;
    const mine = managedMarkerPayload(identity);
    return found.capability === mine.capability &&
        found.kind === mine.kind &&
        found.effect === mine.effect
        ? { matches: true }
        : { matches: false, why: "otherEffect" };
}
