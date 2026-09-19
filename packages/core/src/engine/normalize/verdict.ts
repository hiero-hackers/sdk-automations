/**
 * The verdict vocabulary every normalizer speaks — read, skipped or refused —
 * plus the constructor for the refusal.
 */

import type { Facts } from "../../catalogue.js";

/** Every way a consumed delivery can be unreadable; the operator surface must see each. */
export const NORMALIZE_MALFORMED_CODES = [
    "payloadNotObject",
    "repositoryUnreadable",
    "actionUnreadable",
    "itemMissing",
    "numberMissing",
    "labelsUnreadable",
    "timestampUnreadable",
    "authorUnreadable",
    "lockedMissing",
    "mergedMissing",
    "draftMissing",
    "commentUnreadable",
] as const;
/** One way a consumed delivery can be unreadable. */
export type NormalizeMalformedCode = (typeof NORMALIZE_MALFORMED_CODES)[number];

/** The three verdicts on a delivery: read it, skip it, or refuse it. */
export type NormalizeResult =
    | { readonly kind: "facts"; readonly facts: Facts }
    | { readonly kind: "ignored"; readonly event: string }
    | {
          readonly kind: "malformed";
          /** Machine-readable, like every refusal in core (D75). */
          readonly code: NormalizeMalformedCode;
          readonly detail: string;
      };

/** Refuse a delivery. Exported: the family modules refuse in this vocabulary. */
export const malformed = (code: NormalizeMalformedCode, detail: string): NormalizeResult => ({
    kind: "malformed",
    code,
    detail,
});
