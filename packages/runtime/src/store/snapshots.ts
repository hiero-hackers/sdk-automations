/**
 * What one item's read left behind, and the row it becomes: instants as ISO
 * strings, an unread group as the sentinel (D193). Nothing here throws — bytes
 * that are not this file's own decode to `null`, and the read rewrites them.
 */

import {
    ENTITY_KINDS,
    FACT_GROUPS,
    UNREAD,
    type AssigneeClock,
    type FactGroup,
    type IssueFacts,
    type ItemRef,
    type LinkedIssue,
    type PullRequestFacts,
    type RepositoryRef,
    type Unread,
} from "@hiero-hackers/automation-core";

// ─── What a read leaves behind ───────────────────────────────────────

/** An issue's stored groups; its `links` are the inverse, rebuilt every firing. */
export type StoredIssueFacts = Pick<IssueFacts, "assignees">;

/** A pull request's stored groups, with the batch answer its links were built from. */
export type StoredPullRequestFacts = Pick<
    PullRequestFacts,
    "assignees" | "links" | "review" | "readiness"
> & { readonly closes: readonly ItemRef[] | Unread };

/** One item's read: the groups it was read with, and what each of them said. */
export type SnapshotFacts = { readonly groups: readonly FactGroup[] } & (
    | ({ readonly kind: "issue" } & StoredIssueFacts)
    | ({ readonly kind: "pullRequest" } & StoredPullRequestFacts)
);

/** One `item_snapshot` row: the read, and the two instants the reuse rule compares. */
export interface ItemSnapshot {
    readonly item: ItemRef;
    /** The open-item list's own field at that read. */
    readonly updatedAt: string;
    readonly readAt: string;
    /** `encodeSnapshot`'s JSON; `decodeSnapshot` is its only reader. */
    readonly facts: string;
}

/** How many reads one repository holds, and the oldest of them (D168, D193). */
export interface SnapshotStanding {
    readonly repository: RepositoryRef;
    readonly count: number;
    readonly oldest: string;
}

// ─── The codec ───────────────────────────────────────────────────────

/** The stored groups as one column. A `Date` writes itself as the ISO instant. */
export function encodeSnapshot(facts: SnapshotFacts): string {
    return JSON.stringify(facts);
}

const recordOf = (value: unknown): Record<string, unknown> | null =>
    typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;

function instantOf(value: unknown): Date | null {
    if (typeof value !== "string") return null;
    const at = new Date(value);
    return Number.isFinite(at.getTime()) ? at : null;
}

/** An instant the record allows to be absent: `null` there is an answer, not a gap. */
function optionalInstant(value: unknown): { readonly at: Date | null } | null {
    if (value === null) return { at: null };
    const at = instantOf(value);
    return at === null ? null : { at };
}

/** A group's value, or the sentinel; `null` is a shape this file did not write. */
function groupOf<T>(value: unknown, read: (value: unknown) => T | null): T | Unread | null {
    return value === UNREAD ? UNREAD : read(value);
}

function itemOf(value: unknown): ItemRef | null {
    const ref = recordOf(value);
    const kind = ENTITY_KINDS.find((named) => named === ref?.["kind"]);
    const number = ref?.["number"];
    return kind === undefined || typeof number !== "number" || !Number.isSafeInteger(number)
        ? null
        : { kind, number };
}

/** Every entry of an array read by one reader, or `null` if any entry is not that shape. */
function each<T>(value: unknown, read: (entry: unknown) => T | null): readonly T[] | null {
    if (!Array.isArray(value)) return null;
    const entries: T[] = [];
    for (const entry of value) {
        const one = read(entry);
        if (one === null) return null;
        entries.push(one);
    }
    return entries;
}

function clockOf(value: unknown): AssigneeClock | null {
    const clock = recordOf(value);
    if (clock === null || typeof clock["login"] !== "string") return null;
    const assignedAt = instantOf(clock["assignedAt"]);
    const worked = optionalInstant(clock["lastWorkingAt"]);
    return assignedAt === null || worked === null
        ? null
        : { login: clock["login"], assignedAt, lastWorkingAt: worked.at };
}

const clocksOf = (value: unknown): readonly AssigneeClock[] | null => each(value, clockOf);

function linkedOf(value: unknown): LinkedIssue | null {
    const linked = recordOf(value);
    const item = itemOf(linked?.["item"]);
    const assignees = clocksOf(linked?.["assignees"]);
    return item === null || assignees === null ? null : { item, assignees };
}

function linksOf(value: unknown): PullRequestFacts["links"] | null {
    const issues = each(recordOf(value)?.["issues"], linkedOf);
    return issues === null ? null : { issues };
}

/** The three instants a reapable mode was entered, every one of them required. */
function reapableSinceOf(
    value: unknown,
): Exclude<PullRequestFacts["review"], Unread>["reapableSince"] | null {
    const since = recordOf(value);
    const needsRevision = instantOf(since?.["needsRevision"]);
    const changesRequested = instantOf(since?.["changesRequested"]);
    const draft = instantOf(since?.["draft"]);
    return needsRevision === null || changesRequested === null || draft === null
        ? null
        : { needsRevision, changesRequested, draft };
}

function reviewOf(value: unknown): PullRequestFacts["review"] | null {
    const review = recordOf(value);
    if (review === null || typeof review["changesRequested"] !== "boolean") return null;
    const reapableSince = reapableSinceOf(review["reapableSince"]);
    const commit = optionalInstant(review["lastCommitAt"]);
    return reapableSince === null || commit === null
        ? null
        : { changesRequested: review["changesRequested"], reapableSince, lastCommitAt: commit.at };
}

function readinessOf(value: unknown): PullRequestFacts["readiness"] | null {
    const readiness = recordOf(value);
    return readiness === null || typeof readiness["draft"] !== "boolean"
        ? null
        : { draft: readiness["draft"] };
}

const groupNameOf = (value: unknown): FactGroup | null =>
    FACT_GROUPS.find((group) => group === value) ?? null;

/** A pull request's four groups and its batch answer, or `null` on any one of them. */
function pullRequestFactsOf(stored: Record<string, unknown>): StoredPullRequestFacts | null {
    const assignees = groupOf(stored["assignees"], clocksOf);
    const links = groupOf(stored["links"], linksOf);
    const review = groupOf(stored["review"], reviewOf);
    const readiness = groupOf(stored["readiness"], readinessOf);
    const closes = groupOf(stored["closes"], (value) => each(value, itemOf));
    if (assignees === null || links === null || review === null) return null;
    if (readiness === null || closes === null) return null;
    return { assignees, links, review, readiness, closes };
}

/** One row's groups as the reader takes them back, or `null` for a row nobody can read. */
export function decodeSnapshot(stored: string): SnapshotFacts | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(stored);
    } catch {
        return null;
    }
    const facts = recordOf(parsed);
    const groups = each(facts?.["groups"], groupNameOf);
    if (facts === null || groups === null) return null;
    if (facts["kind"] === "issue") {
        const assignees = groupOf(facts["assignees"], clocksOf);
        return assignees === null ? null : { kind: "issue", groups, assignees };
    }
    if (facts["kind"] !== "pullRequest") return null;
    const read = pullRequestFactsOf(facts);
    return read === null ? null : { kind: "pullRequest", groups, ...read };
}

// ─── Whether a stored read still stands ──────────────────────────────

/** The groups a pull request stores; an issue stores `assignees` alone. */
const PULL_REQUEST_GROUPS = ["assignees", "links", "review", "readiness"] as const;

/**
 * Does this read answer what the repository needs now — the same groups, each of them read?
 * A set that moved since the read, or a group that read failed on, is a miss rather than a stale answer (D193).
 */
export function snapshotAnswers(stored: SnapshotFacts, needed: readonly FactGroup[]): boolean {
    if (stored.groups.join(",") !== needed.join(",")) return false;
    if (stored.kind === "issue") {
        return !needed.includes("assignees") || stored.assignees !== UNREAD;
    }
    return PULL_REQUEST_GROUPS.every(
        (group) => !needed.includes(group) || stored[group] !== UNREAD,
    );
}
