/**
 * The sweep's reader: every open item of a repository, and of its fact groups those
 * an enabled capability needs (`design/guides/sweep.md` §1). Nothing is invented — a
 * group nobody needs, one the endpoint matrix has not confirmed, and a read that
 * failed all answer `UNREAD`. Each group's read is its module's (D216).
 */

import {
    carriesFactGroup,
    FACT_GROUPS,
    keptOn,
    meaningsOfLabels,
    producerReads,
    projectIssue,
    projectPullRequest,
    UNREAD,
    type AssigneeClock,
    type FactGroup,
    type FactKind,
    type IssueFacts,
    type ItemRef,
    type KeptGroups,
    type NeededGroups,
    type PullRequestFacts,
    type RepositoryConfig,
    type RepositoryRef,
    type Unread,
} from "@hiero-hackers/automation-core";
import type { Allowance } from "../client/allowance.js";
import type { GitHubHttpClient } from "../client/contract.js";
import { GROUP_READS, SWEEP_GROUPS, type GroupScope } from "./groups/index.js";
import {
    isConfirmed,
    readAssignedAt,
    readLastWorkingAt,
    readOpenItems,
    readPull,
    readTimeline,
    unreadable,
    type ClosedIssues,
    type ItemWalk,
    type OpenItem,
    type OpenItemsOutcome,
    type Read,
    type ReadContext,
} from "./items.js";
import { readLinkedIssuesBatch } from "./links.js";

export { GROUP_READS } from "./groups/index.js";
export {
    CONFIRMED_SWEEP_READS,
    readChangesRequestedAt,
    readDraft,
    readLastCommitAt,
    readPullRequestActivity,
    readReapableSince,
    readReview,
    readWorkingBy,
    SWEEP_READS,
    type ClosedIssues,
    type ItemWalk,
    type OpenItem,
    type OpenItemsOutcome,
    type Read,
    type RepositoryReads,
    type SweepRead,
} from "./items.js";

export interface FactsReaderOptions {
    readonly http: GitHubHttpClient;
    readonly repository: RepositoryRef;
    /** The lane this firing's reads are charged to (D192). */
    readonly allowance?: Allowance;
    /** The two mapping families this reader speaks: `mappings.labels` and `mappings.commands.working`. */
    readonly config: RepositoryConfig;
    /** When this sweep is happening — every record's `observedAt`, NOT the item's `updated_at`. */
    readonly clock: () => Date;
    /** What an enabled capability needs, per kind; every other group is `UNREAD` (D195). */
    readonly groups: NeededGroups;
}

/** The seam the sweep driver reads through — sweep.md §2.2. Both builders take what only the DRIVER holds. */
export interface FactsReader {
    openItems(): Promise<OpenItemsOutcome>;
    /** The issues each pull request closes, one entry per number asked, read together. */
    linksFor(numbers: readonly number[]): Promise<ReadonlyMap<number, ClosedIssues>>;
    /** `stored` fills the kept groups in place of the reads that made them, and sends nothing (D193). */
    issueFacts(
        listed: OpenItem,
        links: readonly ItemRef[] | Unread,
        stored?: KeptGroups<"issue">,
    ): Promise<IssueFacts>;
    pullRequestFacts(
        listed: OpenItem,
        openIssues: readonly OpenItem[],
        closes: ClosedIssues,
        stored?: KeptGroups<"pullRequest">,
    ): Promise<PullRequestFacts>;
}

/** Does the sweep's own row in `PRODUCERS` promise this group on this kind? */
function promised(kind: FactKind, group: FactGroup): boolean {
    return producerReads("sweep", kind, group);
}

/** The read behind `key`, started once and awaited by every later caller. */
function once<T>(memo: Map<number, Promise<T>>, key: number, start: () => Promise<T>): Promise<T> {
    let pending = memo.get(key);
    if (pending === undefined) {
        pending = start();
        memo.set(key, pending);
    }
    return pending;
}

/**
 * The sweep's reader over one repository, for one firing.
 * The memos must not outlive the firing, which is why this is a factory.
 */
export function createFactsReader(options: FactsReaderOptions): FactsReader {
    const { config, clock } = options;
    const context: ReadContext = {
        http: options.http,
        repository: options.repository,
        config: options.config,
        ...(options.allowance === undefined ? {} : { allowance: options.allowance }),
    };
    const working = config.mappings.commands.working;
    const clocks = new Map<number, Promise<Read<readonly AssigneeClock[]>>>();
    const timelines = new Map<number, Promise<Read<readonly unknown[]>>>();
    const pulls = new Map<number, Promise<Read<Record<string, unknown>>>>();

    /** Each page this firing folds more than one fact from, read once per item. */
    const walk: ItemWalk = {
        timelineFor: (number) => once(timelines, number, () => readTimeline(context, number)),
        pullFor: (number) => once(pulls, number, () => readPull(context, number)),
    };

    /**
     * Is this group read on this kind? The row must promise it, and an enabled capability
     * must need it — unless it costs no request, which a list-borne group never does (D195).
     */
    const needed = (kind: FactKind, group: FactGroup): boolean =>
        promised(kind, group) &&
        (GROUP_READS[group].length === 0 || options.groups[kind].includes(group));

    /**
     * A group's value, or `UNREAD`.
     * Unneeded, unconfirmed and failed meet here: from a capability's side all three are one fact.
     */
    const groupOf = async <T>(
        kind: FactKind,
        group: FactGroup,
        read: () => Promise<Read<T>>,
    ): Promise<T | Unread> => {
        if (!needed(kind, group)) return UNREAD;
        if (!GROUP_READS[group].every(isConfirmed)) return UNREAD;
        const answer = await read();
        return answer.ok ? answer.value : UNREAD;
    };

    /**
     * One item's assignees, as clocks.
     * A login with no `assigned` event makes the whole read unusable, not a clock started now.
     */
    const readClocks = async (
        number: number,
        logins: readonly string[],
    ): Promise<Read<readonly AssigneeClock[]>> => {
        const assigned = await readAssignedAt(context, number, walk);
        if (!assigned.ok) return assigned;
        // No spelling, no command: no comment page is worth a call.

        const worked =
            working === undefined
                ? { ok: true as const, value: new Map<string, Date>() }
                : await readLastWorkingAt(context, number, working);
        if (!worked.ok) return worked;

        const built: AssigneeClock[] = [];
        for (const login of logins) {
            const assignedAt = assigned.value.get(login);
            if (assignedAt === undefined) {
                return unreadable(`#${String(number)}: no assignment event for "${login}"`);
            }
            built.push({ login, assignedAt, lastWorkingAt: worked.value.get(login) ?? null });
        }
        return { ok: true, value: built };
    };

    /** One item's assignee clocks, read once per firing. */
    const clocksFor = (
        item: ItemRef,
        logins: readonly string[],
    ): Promise<Read<readonly AssigneeClock[]>> =>
        once(clocks, item.number, () => readClocks(item.number, logins));

    const meanings = (listed: OpenItem) => meaningsOfLabels(config, listed.labels);

    /**
     * Whether either kind wants links at all; the batch is not sent when neither does.
     * An issue's `links` are the inverse of a pull request's, so one need is enough.
     */
    const wantsLinks = (): boolean =>
        (needed("issue", "links") || needed("pullRequest", "links")) &&
        GROUP_READS.links.every(isConfirmed);

    /** The issues each listed pull request closes, read for the whole list at once (D194). */
    const linksFor = async (
        numbers: readonly number[],
    ): Promise<ReadonlyMap<number, ClosedIssues>> => {
        const nobodyAnswered = (): ReadonlyMap<number, ClosedIssues> =>
            new Map(numbers.map((number) => [number, UNREAD]));
        if (numbers.length === 0 || !wantsLinks()) return nobodyAnswered();
        // One malformed alias refuses the batch, so no pull request keeps a half answer.

        const read = await readLinkedIssuesBatch(context, numbers);
        return read.ok ? read.value : nobodyAnswered();
    };

    /**
     * Every group the kind carries, in `FACT_GROUPS` order: a kept one from the stored
     * read where one stands, every other through its module. THE ONE CAST: the loop fills
     * exactly the kind's groups, which is what the record's group keys are.
     */
    const groupsOf = async (
        kind: FactKind,
        scope: GroupScope,
        stored: Readonly<Record<string, unknown>> | undefined,
    ): Promise<Record<string, unknown>> => {
        const kept = keptOn(kind);
        const groups: Record<string, unknown> = {};
        for (const group of FACT_GROUPS) {
            if (!carriesFactGroup(kind, group)) continue;
            if (stored !== undefined && kept.includes(group)) {
                groups[group] = stored[group];
                continue;
            }
            // `SweepGroup` requires a read on every kind that carries the group.
            const read = (SWEEP_GROUPS[group].read as Record<FactKind, GroupRead>)[kind];
            groups[group] = await groupOf(kind, group, () => read(scope));
        }
        return groups;
    };

    /** What a record carries without a read: the list's own fields, and when this sweep is. */
    const observed = (listed: OpenItem) => ({
        repository: options.repository,
        item: listed.item,
        observedAt: clock(),
        trigger: { kind: "sweep" } as const,
        author: listed.author,
        actor: null,
    });

    /** One item's scope; the driver's answers fill the two it alone holds. */
    const scopeOf = (
        listed: OpenItem,
        openPullRequests: readonly ItemRef[] | Unread,
        closes: ClosedIssues,
        openIssues: readonly OpenItem[],
    ): GroupScope => ({ listed, context, walk, clocksFor, openPullRequests, closes, openIssues });

    return {
        openItems: () => readOpenItems(context),

        linksFor,

        async issueFacts(listed, links, stored) {
            const groups = await groupsOf("issue", scopeOf(listed, links, UNREAD, []), stored);
            return {
                kind: "issue",
                ...observed(listed),
                arrival: null,
                position: projectIssue({ closedBy: listed.closedBy, meanings: meanings(listed) }),
                ...groups,
            } as IssueFacts;
        },

        async pullRequestFacts(listed, openIssues, closes, stored) {
            // A stored read answers all four; the reads are not started at all.
            const groups = await groupsOf(
                "pullRequest",
                scopeOf(listed, UNREAD, closes, openIssues),
                stored,
            );
            return {
                kind: "pullRequest",
                ...observed(listed),
                position: projectPullRequest({
                    closedBy: listed.closedBy,
                    meanings: meanings(listed),
                }),
                ...groups,
            } as PullRequestFacts;
        },
    };
}

/** One group's read on one kind, widened so the loop can call it. */
type GroupRead = (scope: GroupScope) => Promise<Read<unknown>>;
