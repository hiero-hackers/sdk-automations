/**
 * The closed platform vocabularies — every observation a capability may
 * receive, every resolver it may ask, every intent it may express — plus the
 * facts the PLATFORM owns about each operation.
 *
 * ADDING AN OPERATION touches three exhaustive switches, each compile-checked,
 * jointly a checklist: `INTENT_OPERATIONS` and `IntentCatalogue` here, and
 * `describeChange` in the engine. A future writer must add an explicit
 * translation for every operation it supports.
 *
 * D61: a capability chooses from these; it cannot extend them. The
 * alternative is unimplementable at the far end, because a writer could
 * receive a type it has never seen. Isolation (P3) falls out:
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
 * contracts/safety.md's explanation requirement as structure rather
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

/** contract.md §3 — a cause is always dated (contracts/safety.md). */
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

// The `extends Record<Name, unknown>` above forces every NAME to have a
// payload; these force the reverse. A payload with no name in the list is a
// compile error here and nowhere else, because nothing reads the interface at
// runtime.
type AssertNever<T extends never> = T;
type _ObservationCatalogueNamesAreExact = AssertNever<
    Exclude<keyof ObservationCatalogue, ObservationName>
>;

// ─── The resolver catalogue ──────────────────────────────────────────

/** Every question a capability may ask the platform. */
export const RESOLVER_NAMES = ["linkedIssues", "isAutomationActor"] as const;

/** One of `RESOLVER_NAMES`. */
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

/** What a resolver is asked. */
export type ResolverInput<Q extends ResolverName> = ResolverCatalogue[Q]["input"];

/** What it answers with, before `ResolverAnswer` wraps the failure case. */
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

/**
 * The purposes a managed comment may serve — one per comment, and the half of
 * its identity a capability chooses.
 *
 * managed-output.md §2 allows one short marker per PURPOSE per item, so the
 * purpose has to be part of the identity: without it a capability holding both
 * a standing summary and a warning on one item could not tell them apart. The
 * vocabulary is closed for the reason the rest of the catalogue is (D61) — a
 * writer must never receive a purpose it has no rendering for.
 *
 * `summary` is a standing statement about the item, updated in place.
 * `warning` is advance notice of an action the App will take, and carries
 * §6's five facts. `notice` records that something already happened.
 */
export const MANAGED_COMMENT_KINDS = ["summary", "warning", "notice"] as const;

/** One of `MANAGED_COMMENT_KINDS`. */
export type ManagedCommentKind = (typeof MANAGED_COMMENT_KINDS)[number];

/**
 * The desired-outcome payload per operation (contract.md §3 `desired`).
 *
 * `postManagedComment` carries content and purpose, and no marker: identity is
 * platform-owned (D125), derived in `managed.ts` from the intent's own fields
 * and its idempotency key. A capability that could write a marker could address
 * another capability's comment, or an effect that is not its own.
 *
 * `applyMappedLabel` SETS the item's position; it is not "add a label". The
 * adapter removes the position label the item previously held as part of
 * realising it (D4). There is deliberately no `removeMappedLabel`: leaving a
 * position without closing has no edge on the map, and unpausing needs the
 * human authority D79 reserves — an operation with no legal use is dead
 * vocabulary in a closed catalogue (D80).
 *
 * It is also the only operation that MOVES an item, which is why its `cause`
 * comes from the closed, entity-scoped list in `workflow/causes.ts` rather
 * than the free-text `DatedCause` the others carry; `screenIntent` checks the
 * edge (D78).
 */
export interface IntentCatalogue {
    readonly postManagedComment: {
        readonly kind: ManagedCommentKind;
        readonly body: string;
    };
    readonly applyMappedLabel: {
        readonly meaning: MappableMeaning;
        readonly cause: TransitionCause;
    };
    readonly unassign: { readonly login: string };
}

/** One of the catalogue's keys — the closed set of operations. */
export type IntentOperation = keyof IntentCatalogue & string;

/**
 * How a retry must behave after a lost response — experiment 6.5's
 * classes. `idempotent`: re-sending cannot duplicate the outcome (label
 * add). `nonIdempotent`: a blind retry duplicates; recovery must go
 * through the read-back path (comment create).
 */
export type IdempotencyClass = "idempotent" | "nonIdempotent";

/**
 * The facts the platform owns about an operation — never the capability.
 * `actionClassFloor` retains its catalogue name but is the class supplied to
 * safety now that capabilities cannot restate or elevate it.
 */
export interface OperationFacts {
    readonly idempotencyClass: IdempotencyClass;
    readonly actionClassFloor: ActionClass;
    readonly permission: PermissionGrant;
}

/** The platform's authoritative facts for every operation. */
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
