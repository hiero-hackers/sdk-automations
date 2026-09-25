/**
 * The normalizer — a raw webhook delivery becomes a fact record, or a typed
 * refusal to make one. This file is the registry walk plus the preamble every
 * family shares; each family's own reading lives in a module of `normalize/`,
 * and the refusal codes are one closed list there (D75). A delivery core does
 * not consume is `ignored`, one it consumes but cannot read is `malformed`.
 */

import { isWebhookProducer, type WebhookProducer } from "../capability/index.js";
import {
    alertsOfLabels,
    meaningsOfLabels,
    skillsOfLabels,
    type RepositoryConfig,
} from "../config/index.js";
import { issueCommentNormalizer } from "./normalize/issue-comment.js";
import { issuesNormalizer } from "./normalize/issues.js";
import {
    actionOf,
    authorLogin,
    isRecord,
    labelAdded,
    labelRemoved,
    labelNames,
    repositoryOf,
    senderOf,
    timestamp,
    type DeliveryFacts,
} from "./normalize/payload.js";
import { pullRequestNormalizer } from "./normalize/pull-request.js";
import { malformed, type NormalizeResult } from "./normalize/verdict.js";

export {
    NORMALIZE_MALFORMED_CODES,
    type NormalizeMalformedCode,
    type NormalizeResult,
} from "./normalize/verdict.js";
export { repositoryNamedBy } from "./normalize/payload.js";

/** What one event family contributes to the walk below. */
interface EventNormalizer<E extends WebhookProducer> {
    readonly event: E;
    /** Which payload key carries the item (`issue` / `pull_request`). */
    readonly itemKey: string;
    normalize(facts: DeliveryFacts): NormalizeResult;
}

/** The routing — the mapped type demands an entry per webhook producer. */
const NORMALIZERS: { readonly [E in WebhookProducer]: EventNormalizer<E> } = {
    issues: issuesNormalizer,
    issue_comment: issueCommentNormalizer,
    pull_request: pullRequestNormalizer,
};

/**
 * Normalize one delivery. `event` is the `x-github-event` header, `payload` the
 * parsed body, `config` the label mapping — an unmapped label never survives.
 */
export function normalizeDelivery(
    event: string,
    payload: unknown,
    config: RepositoryConfig,
    deliveryId?: string,
): NormalizeResult {
    if (!isWebhookProducer(event)) {
        return { kind: "ignored", event };
    }
    const normalizer = NORMALIZERS[event];
    if (!isRecord(payload)) {
        return malformed("payloadNotObject", `${event}: payload is not an object`);
    }
    const repository = repositoryOf(payload);
    if (repository === null) {
        return malformed("repositoryUnreadable", `${event}: repository/owner missing`);
    }

    const itemKey = normalizer.itemKey;
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
    const author = authorLogin(item);
    if (author === null) {
        return malformed("authorUnreadable", `${event}: user.login unreadable`);
    }
    const action = actionOf(payload);
    if (action === null) {
        return malformed("actionUnreadable", `${event}: action unreadable`);
    }

    const meanings = meaningsOfLabels(config, names);
    // The added label must intersect the item's own labels — the projection's source.
    const added = labelAdded(payload);
    const removed = labelRemoved(payload);
    const arrivedMeaning = added === null ? null : (meaningsOfLabels(config, [added])[0] ?? null);
    const removedMeaning =
        removed === null ? null : (meaningsOfLabels(config, [removed])[0] ?? null);
    const skills = skillsOfLabels(config, names);
    const arrivedSkill = added === null ? null : (skillsOfLabels(config, [added])[0] ?? null);
    const removedSkill = removed === null ? null : (skillsOfLabels(config, [removed])[0] ?? null);
    const carried = alertsOfLabels(config, names);
    const arrived =
        added === null ? [] : alertsOfLabels(config, [added]).filter((a) => carried.includes(a));

    return normalizer.normalize({
        repository,
        item,
        number: item["number"],
        author,
        meanings,
        arrivedMeaning,
        removedMeaning,
        skills,
        arrivedSkill,
        removedSkill,
        alerts: { carried, arrived },
        actor: senderOf(payload),
        observedAt,
        ...(deliveryId === undefined ? {} : { deliveryId }),
        action,
        payload,
        config,
    });
}
