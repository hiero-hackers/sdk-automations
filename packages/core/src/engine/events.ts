/**
 * The normalizer — a raw webhook delivery becomes a catalogue observation,
 * or a typed refusal to make one. The pipeline's first stage.
 *
 * Everything a capability may know about GitHub's wire format dies here:
 * label STRINGS become meanings via the repository's reviewed mapping,
 * state fields become a `ClosureReason`, and the label set becomes an
 * `ObservationProjection` (contract.md §2 — "the platform normalizes all
 * external facts before evaluation"). Built test-first against REAL
 * captured payloads from the testkit (`packages/dev/testkit/fixtures/`,
 * protocol 7.1), never against invented ones.
 *
 * Total, like everything at this boundary. A delivery this file does not
 * consume is `ignored` (normal — pushes, stars, pings); one it consumes
 * but cannot read is `malformed` (loud — GitHub changed shape, or the
 * shell handed us something that is not a webhook body). Nothing throws.
 *
 * The boundary with `github/` (D92 phase 5): what stays there is observed
 * knowledge ABOUT GitHub, while what a delivery BECOMES is the engine's
 * business.
 */

import type { ObservationCatalogue } from "../capability/index.js";
import { meaningsOfLabels, type RepositoryConfig } from "../config/index.js";
import {
    projectIssueObservation,
    projectPrObservation,
    type ClosureReason,
} from "../workflow/index.js";

/** The two observations a webhook delivery can become. */
export type NormalizedObservation =
    ObservationCatalogue["issueUpdated"] | ObservationCatalogue["pullRequestUpdated"];

/**
 * `ignored` and `malformed` are different verdicts on purpose: the first is
 * the system working (most webhook traffic is not workflow traffic), the
 * second is a fact the operator surface must see — it means GitHub's shape
 * and our reading of it have diverged.
 */
export const NORMALIZE_MALFORMED_CODES = [
    "payloadNotObject",
    "repositoryUnreadable",
    "itemMissing",
    "numberMissing",
    "labelsUnreadable",
    "timestampUnreadable",
    "mergedMissing",
] as const;
/** One way a consumed delivery can be unreadable. */
export type NormalizeMalformedCode = (typeof NORMALIZE_MALFORMED_CODES)[number];

/** The three verdicts on a delivery: read it, skip it, or refuse it. */
export type NormalizeResult =
    | { readonly kind: "observation"; readonly observation: NormalizedObservation }
    | { readonly kind: "ignored"; readonly event: string }
    | {
          readonly kind: "malformed";
          /** Machine-readable, like every refusal in core (D75). */
          readonly code: NormalizeMalformedCode;
          readonly detail: string;
      };

const malformed = (code: NormalizeMalformedCode, detail: string): NormalizeResult => ({
    kind: "malformed",
    code,
    detail,
});

function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The label NAMES on an item, or null if the shape is not GitHub's. */
function labelNames(item: Record<string, unknown>): readonly string[] | null {
    const labels = item["labels"];
    if (!Array.isArray(labels)) return null;
    const names: string[] = [];
    for (const label of labels) {
        if (!isRecord(label) || typeof label["name"] !== "string") return null;
        names.push(label["name"]);
    }
    return names;
}

/** A valid Date from an ISO field, or null. */
function timestamp(value: unknown): Date | null {
    if (typeof value !== "string") return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
}

function repositoryOf(
    payload: Record<string, unknown>,
): { readonly owner: string; readonly repo: string } | null {
    const repository = payload["repository"];
    if (!isRecord(repository)) return null;
    const owner = repository["owner"];
    if (!isRecord(owner) || typeof owner["login"] !== "string") return null;
    if (typeof repository["name"] !== "string") return null;
    return { owner: owner["login"], repo: repository["name"] };
}

/**
 * The repository a payload readably names — total over `unknown`, `null`
 * when it names none. Exported for the shell's serving-boundary check, so
 * the one reading of these three fields lives beside the normalizer that
 * owns them; a payload this cannot read is one `normalizeDelivery` reports
 * as `payloadNotObject` or `repositoryUnreadable`, and a caller must not
 * pre-empt that with a refusal of its own.
 */
export function repositoryNamedBy(
    payload: unknown,
): { readonly owner: string; readonly repo: string } | null {
    return isRecord(payload) ? repositoryOf(payload) : null;
}

/**
 * Issue closure, from what the webhook alone can see. GitHub reports
 * `state` and `state_reason`; whether a closure was CAUSED by a linked
 * merge (`completedByLinkedMerge`, D47) is not on this payload — it needs
 * the timeline API, which is the adapter's territory. Until then a closed
 * issue reads `closedByHuman`, the conservative reason: it never triggers
 * merge-gated policy (progression credits only merged pull requests).
 */
function issueClosure(item: Record<string, unknown>): ClosureReason | null {
    return item["state"] === "closed" ? "closedByHuman" : null;
}

/** Pull-request closure: `merged` is authoritative (D47 keeps them distinct). */
function prClosure(item: Record<string, unknown>): ClosureReason | null {
    if (item["merged"] === true) return "merged";
    return item["state"] === "closed" ? "closedByHuman" : null;
}

/**
 * Normalize one delivery. `event` is the `x-github-event` header; `payload`
 * is the parsed body; `config` supplies the label mapping this repository
 * reviewed — an unmapped label never survives into the observation.
 */
export function normalizeDelivery(
    event: string,
    payload: unknown,
    config: RepositoryConfig,
): NormalizeResult {
    if (event !== "issues" && event !== "pull_request") {
        return { kind: "ignored", event };
    }
    if (!isRecord(payload)) {
        return malformed("payloadNotObject", `${event}: payload is not an object`);
    }
    const repository = repositoryOf(payload);
    if (repository === null) {
        return malformed("repositoryUnreadable", `${event}: repository/owner missing`);
    }

    const itemKey = event === "issues" ? "issue" : "pull_request";
    const item = payload[itemKey];
    if (!isRecord(item)) {
        return malformed("itemMissing", `${event}: "${itemKey}" missing`);
    }
    if (typeof item["number"] !== "number") {
        return malformed("numberMissing", `${event}: item number missing`);
    }
    const names = labelNames(item);
    if (names === null) {
        return malformed("labelsUnreadable", `${event}: labels unreadable`);
    }
    const observedAt = timestamp(item["updated_at"]);
    if (observedAt === null) {
        return malformed("timestampUnreadable", `${event}: updated_at unreadable`);
    }

    const meanings = meaningsOfLabels(config, names);

    if (event === "issues") {
        return {
            kind: "observation",
            observation: {
                kind: "issueUpdated",
                repository,
                item: { kind: "issue", number: item["number"] },
                position: projectIssueObservation({
                    closedBy: issueClosure(item),
                    meanings,
                }),
                observedAt,
            },
        };
    }
    if (typeof item["merged"] !== "boolean") {
        return malformed("mergedMissing", "pull_request: merged missing");
    }
    return {
        kind: "observation",
        observation: {
            kind: "pullRequestUpdated",
            repository,
            item: { kind: "pullRequest", number: item["number"] },
            position: projectPrObservation({
                closedBy: prClosure(item),
                meanings,
            }),
            observedAt,
        },
    };
}
