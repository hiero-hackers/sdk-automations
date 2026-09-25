/**
 * What GitHub's payload readably says, and nothing about what it means: total
 * readers of untrusted bytes, each answering a value or `null`, never throwing.
 */

import type { Actor, Alerts, RepositoryRef } from "../../catalogue.js";
import type { MappableMeaning, RepositoryConfig, Skill } from "../../config/index.js";

export function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The label NAMES on an item, or null if the shape is not GitHub's. */
export function labelNames(item: Record<string, unknown>): readonly string[] | null {
    const labels = item["labels"];
    if (!Array.isArray(labels)) return null;
    const names: string[] = [];
    for (const label of labels) {
        if (!isRecord(label) || typeof label["name"] !== "string") return null;
        names.push(label["name"]);
    }
    return names;
}

/** Who opened the item, or `null` when the payload does not readably say. */
export function authorLogin(item: Record<string, unknown>): string | null {
    const user = item["user"];
    if (!isRecord(user)) return null;
    const login = user["login"];
    return typeof login === "string" && login.length > 0 ? login : null;
}

/** Who caused this delivery, or `null` — a reader must then treat the record as uncaused. */
export function senderOf(payload: Record<string, unknown>): Actor | null {
    const sender = payload["sender"];
    if (!isRecord(sender) || typeof sender["login"] !== "string") return null;
    return { login: sender["login"] };
}

/** The webhook action, or `null` when the signed payload does not name one. */
export function actionOf(payload: Record<string, unknown>): string | null {
    const action = payload["action"];
    return typeof action === "string" && action.length > 0 ? action : null;
}

/** An issue's current discussion lock state, never defaulted. */
export function lockedOf(item: Record<string, unknown>): boolean | null {
    return typeof item["locked"] === "boolean" ? item["locked"] : null;
}

/** The label this delivery ADDED, or `null` when it added none. */
export function labelAdded(payload: Record<string, unknown>): string | null {
    if (payload["action"] !== "labeled") return null;
    const label = payload["label"];
    if (!isRecord(label) || typeof label["name"] !== "string") return null;
    return label["name"];
}

/** The label this delivery REMOVED, or `null` when it removed none. */
export function labelRemoved(payload: Record<string, unknown>): string | null {
    if (payload["action"] !== "unlabeled") return null;
    const label = payload["label"];
    if (!isRecord(label) || typeof label["name"] !== "string") return null;
    return label["name"];
}

/** A valid Date from an ISO field, or null. */
export function timestamp(value: unknown): Date | null {
    if (typeof value !== "string") return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
}

export function repositoryOf(
    payload: Record<string, unknown>,
): { readonly owner: string; readonly repo: string } | null {
    const repository = payload["repository"];
    if (!isRecord(repository)) return null;
    const owner = repository["owner"];
    if (!isRecord(owner) || typeof owner["login"] !== "string") return null;
    if (typeof repository["name"] !== "string") return null;
    return { owner: owner["login"], repo: repository["name"] };
}

/** The repository a payload names, or `null`; a caller leaves the refusal to `normalizeDelivery`. */
export function repositoryNamedBy(
    payload: unknown,
): { readonly owner: string; readonly repo: string } | null {
    return isRecord(payload) ? repositoryOf(payload) : null;
}

/** Everything the shared preamble read, handed to the family that finishes. */
export interface DeliveryFacts {
    readonly repository: RepositoryRef;
    readonly item: Record<string, unknown>;
    readonly number: number;
    readonly author: string;
    readonly meanings: readonly MappableMeaning[];
    readonly arrivedMeaning: MappableMeaning | null;
    readonly removedMeaning: MappableMeaning | null;
    readonly skills: readonly Skill[];
    readonly arrivedSkill: Skill | null;
    readonly removedSkill: Skill | null;
    /** What this item carries, and what this delivery added — through `mappings.alerts`. */
    readonly alerts: Alerts;
    /** The delivery's sender, or `null` — see `senderOf`. */
    readonly actor: Actor | null;
    readonly observedAt: Date;
    readonly deliveryId?: string;
    readonly action: string;
    /** The delivery body, proved a record — for the item's sibling keys. */
    readonly payload: Record<string, unknown>;
    /** The repository's reviewed configuration, for readings beyond labels. */
    readonly config: RepositoryConfig;
}
