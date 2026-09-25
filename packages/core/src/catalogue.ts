/** The closed vocabularies a capability chooses from and cannot extend (D61, P3). */

import type { Command, ConfigResult, MappableMeaning, Skill } from "./config/index.js";
import type { PermissionGrant } from "./github/index.js";
import type { ActionClass } from "./safety/index.js";
import type {
    EntityKind,
    IssueMeaning,
    PrMeaning,
    Projection,
    TransitionCause,
} from "./workflow/index.js";

// ─── References and explanations ─────────────────────────────────────

export interface RepositoryRef {
    readonly owner: string;
    readonly repo: string;
}

/** GitHub numbers issues and pull requests in one sequence per repository. */
export interface ItemRef {
    readonly kind: EntityKind;
    readonly number: number;
}

/** contracts/safety.md's explanation requirement as structure rather than prose. */
export interface StructuredExplanation {
    readonly capability: string;
    readonly summary: string;
    readonly detail: readonly string[];
}

/** contract.md §3 — a cause is always dated (contracts/safety.md). */
export interface DatedCause {
    readonly cause: string;
    readonly observedAt: Date;
    readonly deliveryId?: string;
}

// ─── The facts a capability reads ────────────────────────────────────

/** What woke the platform. Metadata a capability may log, never branch on (facts.md §6). */
export type Trigger =
    | { readonly kind: "event"; readonly event: string; readonly deliveryId?: string }
    | { readonly kind: "sweep" };

/** A group the producer did not read; the engine records `factsUnread` and skips. */
export type Unread = "unread";

/** The one value `Unread` has — what a producer marks an unread group with. */
export const UNREAD: Unread = "unread";

/** Whoever caused this record, or `null` on a sweep — never an `Unread`. */
export interface Actor {
    readonly login: string;
}

/** What the item carries, and what arrived here — `arrived` is empty on a sweep. */
export interface Alerts {
    readonly carried: readonly string[];
    readonly arrived: readonly string[];
}

/** The command typed on this item — a catalogue name, never the repository's (contract.md §2). */
export interface CommandFacts {
    readonly command: Command;
    readonly by: string;
    readonly at: Date;
}

/** One assignee of an item, with the clock that assignment started. */
export interface AssigneeClock {
    readonly login: string;
    readonly assignedAt: Date;
    /** The last `/working` comment by this person, the one reset that applies to any clock. */
    readonly lastWorkingAt: Date | null;
}

/** A pull request's linked issue, carrying its own assignees' clocks. */
export interface LinkedIssue {
    readonly item: ItemRef;
    readonly assignees: readonly AssigneeClock[];
}

/** One issue, as the platform read it — `design/contracts/facts.md` §1 (D141). */
export interface IssueFacts {
    readonly kind: "issue";
    readonly repository: RepositoryRef;
    readonly item: ItemRef;
    readonly observedAt: Date;
    readonly trigger: Trigger;
    /** Who opened the item — always read, so there is no honest `Unread` for it. */
    readonly author: string;
    readonly actor: Actor | null;
    /** GitHub's current discussion lock state. */
    readonly locked: boolean;
    /** The issue transition this observation carries, or `null` when it carries none. */
    readonly arrival:
        | { readonly kind: "opened" }
        | {
              readonly kind: "label";
              readonly change: "added" | "removed";
              readonly meaning: MappableMeaning | null;
              readonly skill: Skill | null;
          }
        | null;
    readonly skills: readonly Skill[];
    /** Always read: the projection every gate judges by. */
    readonly position: Projection<IssueMeaning>;
    readonly alerts: Alerts;
    readonly assignees: readonly AssigneeClock[] | Unread;
    readonly links: { readonly openPullRequests: readonly ItemRef[] } | Unread;
    /** `null` is a READ group that carried no command; only `UNREAD` means nobody looked. */
    readonly command: CommandFacts | null | Unread;
}

/** One pull request, as the platform read it; `IssueFacts`'s notes hold unchanged. */
export interface PullRequestFacts {
    readonly kind: "pullRequest";
    readonly repository: RepositoryRef;
    readonly item: ItemRef;
    readonly observedAt: Date;
    readonly trigger: Trigger;
    readonly author: string;
    readonly actor: Actor | null;
    readonly position: Projection<PrMeaning>;
    readonly alerts: Alerts;
    readonly assignees: readonly AssigneeClock[] | Unread;
    /** Each linked issue with its own assignees' clocks — what a close releases alongside. */
    readonly links: { readonly issues: readonly LinkedIssue[] } | Unread;
    readonly review:
        | {
              readonly changesRequested: boolean;
              readonly reapableSince: Readonly<
                  Record<"needsRevision" | "changesRequested" | "draft", Date>
              >;
              readonly lastCommitAt: Date | null;
          }
        | Unread;
    /** Whether the author has offered the pull request for review yet. */
    readonly readiness: { readonly draft: boolean } | Unread;
}

/** One record, one item — whatever woke the platform. */
export type Facts = IssueFacts | PullRequestFacts;

/** The item kinds a capability may declare. */
export const FACT_KINDS = ["issue", "pullRequest"] as const;

export type FactKind = (typeof FACT_KINDS)[number];

/** The groups a capability may declare a need for. */
export const FACT_GROUPS = ["assignees", "links", "review", "readiness", "command"] as const;

export type FactGroup = (typeof FACT_GROUPS)[number];

/** How each kind holds each group, or `null` where the kind carries none. */
const GROUP_KEYS: {
    readonly [K in FactKind]: {
        readonly [G in FactGroup]: (keyof Extract<Facts, { kind: K }> & FactGroup) | null;
    };
} = {
    issue: {
        assignees: "assignees",
        links: "links",
        review: null,
        readiness: null,
        command: "command",
    },
    pullRequest: {
        assignees: "assignees",
        links: "links",
        review: "review",
        readiness: "readiness",
        command: null,
    },
};

/** Does this kind carry the group at all? */
export function carriesFactGroup(kind: FactKind, group: FactGroup): boolean {
    return GROUP_KEYS[kind][group] !== null;
}

/** Did the producer leave this group unread? `false` for a group the kind does not carry. */
export function factGroupUnread(facts: Facts, group: FactGroup): boolean {
    if (facts.kind === "issue") {
        const key = GROUP_KEYS.issue[group];
        return key !== null && facts[key] === UNREAD;
    }
    const key = GROUP_KEYS.pullRequest[group];
    return key !== null && facts[key] === UNREAD;
}

// A catalogue's keys must be exactly its name list; this half forces the reverse.
type AssertNever<T extends never> = T;
// ─── The resolver catalogue ──────────────────────────────────────────

/** Every question a capability may ask the platform. */
export const RESOLVER_NAMES = [
    "linkedIssues",
    "isAutomationActor",
    "commitAttestations",
    "mergeability",
    "assigneesOf",
    "openAssignments",
    "configAtHead",
] as const;

export type ResolverName = (typeof RESOLVER_NAMES)[number];

/** One commit of a pull request; the message body is never carried. */
export interface CommitAttestation {
    readonly sha: string;
    /** The first line of the commit message — untrusted text. */
    readonly summary: string;
    readonly signedOff: boolean;
    readonly verified: boolean;
    /** More than one parent — GitHub's own merge commit, exempt from DCO. */
    readonly merge: boolean;
}

/** What a pull request does to `automations.yml`: the PARSED result, never the text. */
export type ConfigAtHead =
    | { readonly touched: false }
    | { readonly touched: true; readonly revision: string; readonly result: ConfigResult };

/** Every resolver's question and answer shape; the catalogue table is generated from it. */
export interface ResolverCatalogue extends Record<ResolverName, unknown> {
    readonly linkedIssues: {
        readonly input: { readonly item: ItemRef };
        readonly output: readonly ItemRef[];
    };
    readonly isAutomationActor: {
        readonly input: { readonly login: string };
        readonly output: boolean;
    };
    /** Every commit of a pull request; a list GitHub truncates fails rather than shortens. */
    readonly commitAttestations: {
        readonly input: { readonly item: ItemRef };
        readonly output: readonly CommitAttestation[];
    };
    /** Can GitHub merge this cleanly? Its `null` is a failure to answer, not a `false`. */
    readonly mergeability: {
        readonly input: { readonly item: ItemRef };
        readonly output: boolean;
    };
    /** Who is assigned to one item right now, by login — never a bot filter. */
    readonly assigneesOf: {
        readonly input: { readonly item: ItemRef };
        readonly output: readonly string[];
    };
    /** Every open issue in THIS repository one login is assigned to, with its meanings (D57). */
    readonly openAssignments: {
        readonly input: { readonly login: string };
        readonly output: readonly {
            readonly item: ItemRef;
            readonly meanings: readonly MappableMeaning[];
        }[];
    };
    /** Did this pull request change `automations.yml`, and what does it parse to at head? */
    readonly configAtHead: {
        readonly input: { readonly item: ItemRef };
        readonly output: ConfigAtHead;
    };
}
type _ResolverCatalogueNamesAreExact = AssertNever<Exclude<keyof ResolverCatalogue, ResolverName>>;

export type ResolverInput<Q extends ResolverName> = ResolverCatalogue[Q]["input"];

/** What it answers with, before `ResolverAnswer` wraps the failure case. */
export type ResolverOutput<Q extends ResolverName> = ResolverCatalogue[Q]["output"];

/** "Unknown is not an answer" (catalogue.md): an empty answer is not a failed one. */
export type ResolverAnswer<T> =
    | { readonly ok: true; readonly value: T }
    | {
          readonly ok: false;
          readonly reason: "noPermission" | "rateLimited" | "unavailable" | "notConfigured";
          readonly detail: string;
      };

// ─── The intent catalogue ────────────────────────────────────────────

/** The purposes a managed comment may serve; a `warning` carries grace.md §1's facts. */
export const MANAGED_COMMENT_KINDS = ["summary", "warning", "notice"] as const;

export type ManagedCommentKind = (typeof MANAGED_COMMENT_KINDS)[number];

/**
 * The desired-outcome payload per operation (contract.md §3 `desired`); comment
 * identity D125/D145, `applyMappedLabel` D4/D78, `releaseAssignment` D63/D141.
 */
export interface IntentCatalogue {
    readonly postManagedComment: {
        readonly kind: ManagedCommentKind;
        readonly topic?: string;
        readonly body: string;
        /** A principal to address the comment to, by NAME; not part of identity (D145). */
        readonly mention?: string;
    };
    readonly applyMappedLabel: {
        readonly meaning: MappableMeaning;
        readonly cause: TransitionCause;
    };
    readonly assign: { readonly login: string };
    readonly unassign: { readonly login: string };
    readonly releaseAssignment: { readonly login: string };
    readonly closePullRequest: { readonly reason: string };
    readonly lockIssue: { readonly reason: string };
    readonly unlockIssue: { readonly reason: string };
}

export type IntentOperation = keyof IntentCatalogue & string;

/** How a retry must behave after a lost response; `nonIdempotent` needs read-back. */
export type IdempotencyClass = "idempotent" | "nonIdempotent";

/** The facts the platform owns about an operation — never the capability. */
export interface OperationFacts {
    readonly idempotencyClass: IdempotencyClass;
    readonly actionClassFloor: ActionClass;
    readonly permission: PermissionGrant;
}
