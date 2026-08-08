/**
 * The closed platform vocabularies — every observation a capability may
 * receive, every resolver it may ask, every intent it may express — plus the
 * facts the PLATFORM owns about each operation.
 *
 * ADDING AN OPERATION touches five exhaustive switches, each compile-checked,
 * jointly a checklist: `INTENT_OPERATIONS` and `IntentCatalogue` here,
 * `describeChange` in the engine, `commandFor` in the executor's planner, and
 * the command identity in the executor's recovery module. Named here so the
 * hunt has a map; consolidate when a real fourth operation arrives.
 *
 * D61: a capability chooses from these; it cannot extend them. The
 * alternative is unimplementable at the far end, because the adapter would
 * need an executor for a type it has never seen. Isolation (P3) falls out:
 * capabilities that share no vocabulary have nothing to call each other
 * through.
 */

import type { MappableMeaning } from "../config/index.js";
import type { PermissionGrant } from "../github/index.js";
import type { ActionClass } from "../safety/index.js";
import type {
    EntityKind,
    IssueMeaning,
    ObservationProjection,
    PrMeaning,
    TransitionCause,
} from "../workflow/index.js";

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

/**
 * safety.md's "explains each action in a comment" as structure rather
 * than prose: `summary` is the human sentence, `detail` the supporting
 * facts, `capability` the attribution every managed write owes. Kept
 * structured so the managed comment, the dry-run report, and the operator
 * surface render the SAME explanation instead of three drifting strings.
 */
export interface StructuredExplanation {
    readonly capability: string;
    readonly summary: string;
    readonly detail: readonly string[];
}

/** contract.md §3 — a cause is always dated (safety.md rule 5). */
export interface DatedCause {
    readonly cause: string;
    readonly observedAt: Date;
}

// ─── The observation catalogue ───────────────────────────────────────

export const OBSERVATION_NAMES = ["issueUpdated", "pullRequestUpdated", "staleItemsDue"] as const;

export type ObservationName = (typeof OBSERVATION_NAMES)[number];

/**
 * What the platform hands a capability. Every payload carries `kind`, so
 * a capability declaring several observations receives a discriminated
 * union rather than an intersection it must narrow by hand.
 *
 * Payloads are NORMALIZED facts (contract.md §2: "the platform normalizes
 * all external facts before evaluation"). No webhook payload, no Octokit
 * object, no raw label strings — the projection has already run, so a
 * capability sees positions and meanings, never the repository's words
 * for them.
 */
export interface ObservationCatalogue extends Record<ObservationName, unknown> {
    readonly issueUpdated: {
        readonly kind: "issueUpdated";
        readonly repository: RepositoryRef;
        readonly item: ItemRef;
        /**
         * The projection itself, not a flattening of it (D81).
         *
         * `observe.ts` distinguishes a CONFLICT — more than one own-flow
         * position, which it refuses to resolve (D35) — from a position. This
         * payload used to carry a bare meaning list, so that distinction died
         * at the boundary and a capability handed a human's double-labelled
         * issue could not tell it from a clean one. `blocked` and `closed`
         * travelled beside it as separate booleans the shell had to keep
         * consistent with the same meanings; both are read from the
         * projection now.
         */
        readonly position: ObservationProjection<IssueMeaning>;
        readonly observedAt: Date;
    };
    readonly pullRequestUpdated: {
        readonly kind: "pullRequestUpdated";
        readonly repository: RepositoryRef;
        readonly item: ItemRef;
        /** See `issueUpdated`. `merged` is `state.closedBy === "merged"`. */
        readonly position: ObservationProjection<PrMeaning>;
        readonly observedAt: Date;
    };
    readonly staleItemsDue: {
        readonly kind: "staleItemsDue";
        readonly repository: RepositoryRef;
        readonly items: readonly {
            readonly item: ItemRef;
            readonly assignee: string | null;
            readonly lastHumanActivityAt: Date | null;
            /** A recorded warning for this item, `null` if none yet. */
            readonly warnedAt: Date | null;
        }[];
        readonly observedAt: Date;
    };
}

type AssertNever<T extends never> = T;
type _ObservationCatalogueNamesAreExact = AssertNever<
    Exclude<keyof ObservationCatalogue, ObservationName>
>;

// ─── The resolver catalogue ──────────────────────────────────────────

export const RESOLVER_NAMES = ["linkedIssues", "isAutomationActor"] as const;

export type ResolverName = (typeof RESOLVER_NAMES)[number];

/** resolvers.md §2, narrowed to the resolvers the probes exercise. */
export interface ResolverCatalogue extends Record<ResolverName, unknown> {
    readonly linkedIssues: {
        readonly input: { readonly item: ItemRef };
        readonly output: readonly ItemRef[];
    };
    readonly isAutomationActor: {
        readonly input: { readonly login: string };
        readonly output: boolean;
    };
}
type _ResolverCatalogueNamesAreExact = AssertNever<Exclude<keyof ResolverCatalogue, ResolverName>>;
export type ResolverInput<Q extends ResolverName> = ResolverCatalogue[Q]["input"];
export type ResolverOutput<Q extends ResolverName> = ResolverCatalogue[Q]["output"];

/**
 * resolvers.md §6, as a type a capability cannot ignore: an empty answer
 * and an answer that could not be determined are different values, not
 * both `[]`. A capability must never read "the API failed" as "no linked
 * issue exists" — the union makes the distinction unavoidable rather than
 * documented.
 */
export type ResolverAnswer<T> =
    | { readonly ok: true; readonly value: T }
    | {
          readonly ok: false;
          readonly reason: "noPermission" | "rateLimited" | "unavailable" | "notConfigured";
          readonly detail: string;
      };

// ─── The intent catalogue ────────────────────────────────────────────

/** The desired-outcome payload per operation (contract.md §3 `desired`). */
export interface IntentCatalogue {
    readonly postManagedComment: {
        readonly marker: string;
        readonly body: string;
    };
    /**
     * SET the item's position — not "add a label". The adapter removes the
     * position label the item previously held as part of realising this, per
     * D4's rule that the platform removes only named managed labels.
     *
     * That is why there is no `removeMappedLabel` (D80): a position CHANGE is
     * this operation, the map has no edge for leaving a position without
     * closing, and unpausing needs the same authority as pausing, which D79
     * reserves to humans. An operation with no legal use is dead vocabulary
     * in a closed catalogue — the kind that gets used later without anyone
     * rechecking whether it was ever allowed.
     *
     * The one operation that MOVES an item, so the one that names a
     * transition cause from the closed, entity-scoped list in
     * `workflow/meanings.ts`; `screenIntent` checks the edge (D78). The
     * others do not move anything: a comment and an unassign have reasons
     * but not transitions, and keep the free-text `DatedCause` that
     * identifies the occasion.
     */
    readonly applyMappedLabel: {
        readonly meaning: MappableMeaning;
        readonly cause: TransitionCause;
    };
    readonly unassign: { readonly login: string };
}

export type IntentOperation = keyof IntentCatalogue & string;

/**
 * How a retry must behave after a lost response — experiment 6.5's
 * classes. `idempotent`: re-sending cannot duplicate the outcome (label
 * add). `nonIdempotent`: a blind retry duplicates; recovery must go
 * through the read-back path (comment create).
 */
export type IdempotencyClass = "idempotent" | "nonIdempotent";

/**
 * The facts the PLATFORM owns about an operation — never the capability.
 *
 * The declared class is a redundant restatement that must match: a per-capability
 * field cannot be authoritative about a per-endpoint fact
 * (`FINDING(runtime-idempotency-declared-not-checked)`, D62).
 *
 * `actionClassFloor` is a MINIMUM, not a value: `unassign` is reversible when a
 * human asks and destructive when a clock does, so a capability may declare
 * stricter and never laxer (`FINDING(runtime-action-class-floor)`, D63).
 */
export interface OperationFacts {
    readonly idempotencyClass: IdempotencyClass;
    readonly actionClassFloor: ActionClass;
    readonly permission: PermissionGrant;
}

/** Increasing risk — safety.md §1's order, as a comparable rank. */
export const ACTION_CLASS_RANK: { readonly [K in ActionClass]: number } = {
    observation: 0,
    humanFacingOutput: 1,
    reversibleStateChange: 2,
    clockTriggeredDestructive: 3,
    immediatePreventive: 4,
};

export const INTENT_OPERATIONS: {
    readonly [K in IntentOperation]: OperationFacts;
} = {
    // 6.5: comment creation duplicates on a blind retry. Not negotiable.
    postManagedComment: {
        idempotencyClass: "nonIdempotent",
        actionClassFloor: "humanFacingOutput",
        permission: "issues:write",
    },
    applyMappedLabel: {
        idempotencyClass: "idempotent",
        actionClassFloor: "reversibleStateChange",
        permission: "issues:write",
    },
    unassign: {
        idempotencyClass: "idempotent",
        actionClassFloor: "reversibleStateChange",
        permission: "issues:write",
    },
};
