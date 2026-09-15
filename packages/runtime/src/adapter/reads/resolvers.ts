/**
 * The adapter's answers to the questions core lets a capability ask: one arm per
 * name in core's `RESOLVER_NAMES`, and nothing else. Every answer is VERIFIED on
 * this side — whatever fails a check becomes a typed failure, never a shorter list
 * (`design/contracts/catalogue.md`, "unknown is not an answer"). A read the endpoint
 * matrix has not confirmed is implemented here and answered `unavailable`, never sent.
 */

import {
    ABSENT_CONFIG_REVISION,
    CONFIG_PATH,
    isAutomationLogin,
    meaningsOfLabels,
    parseConfig,
    parseConfigDocument,
    type AdmittedCapability,
    type CommitAttestation,
    type ConfigAtHead,
    type ItemRef,
    type MappableMeaning,
    type RepositoryConfig,
    type RepositoryRef,
    type ResolverAnswer,
    type ResolverName,
    type ResolverOutput,
    type ResolverSource,
} from "@hiero-hackers/automation-core";
import type { Allowance } from "../client/allowance.js";
import {
    advertisesNextPage,
    lastPageFromLink,
    repoPath,
    type GitHubHttpClient,
} from "../client/contract.js";
import { decodeContents } from "./config.js";
import type { RepositoryReads } from "./facts.js";
import { httpFailure, unavailable, type ResolverFailure } from "./failures.js";
import { readLinkedIssues } from "./links.js";
import { field, jsonArrayOf, jsonRecordOf } from "../client/untrusted.js";

export interface ResolverSourceOptions {
    readonly http: GitHubHttpClient;
    readonly repository: RepositoryRef;
    /** What these reads are charged to; unset spends from no lane (D192). */
    readonly allowance?: Allowance;
    /** The label mapping `openAssignments` projects each assignment's labels through (contract.md §2). */
    readonly config: RepositoryConfig;
    /** The declarations the shell ships; the adapter may not import them itself. */
    readonly knownCapabilities: readonly AdmittedCapability[];
}

/**
 * The reads the endpoint-permission matrix records as confirmed, each with its citation.
 * A name absent from this list is answered `unavailable` rather than sent.
 */
export const CONFIRMED_RESOLVER_READS = [
    // GraphQL `closingIssuesReferences` — Issues R — `2026-08-29T20-51-00.386Z#same-repository`
    "linkedIssues",
    // No call: GitHub gives every App actor the `[bot]` suffix.
    "isAutomationActor",
    // `GET /repos/{o}/{r}/pulls/{n}` — Pull requests R — `2026-07-23T19-41-18-911Z#3`
    "mergeability",
    // `GET /repos/{o}/{r}/issues` — Issues R — `2026-07-23T19-36-29-346Z#1–6`
    "openAssignments",
    // files, pull, contents (with `ref`) — Pull requests R, Contents R — `2026-07-23T20-16-41-190Z#7`, `2026-07-23T19-41-18-911Z#3`, `2026-07-23T19-09-37-225Z#2`
    "configAtHead",
    // `GET /repos/{o}/{r}/pulls/{n}/commits` — Pull requests R — `2026-09-12T06-31-36-229Z#23`
    "commitAttestations",
    // `GET /repos/{o}/{r}/issues/{n}` — Issues R — `2026-09-12T06-31-36-229Z#27`
    "assigneesOf",
] as const satisfies readonly ResolverName[];

/** One of `CONFIRMED_RESOLVER_READS` — a name the dispatch below must answer. */
type ConfirmedRead = (typeof CONFIRMED_RESOLVER_READS)[number];

function isConfirmedRead(query: ResolverName): query is ConfirmedRead {
    return (CONFIRMED_RESOLVER_READS as readonly ResolverName[]).includes(query);
}

/** GitHub's maximum, so one question costs as few calls as it can. */
const PAGE_SIZE = 100;

/** How many pages one list read may walk before the honest answer is that nobody read it. */
const MAX_LIST_PAGES = 10;

// ─── The item reads ──────────────────────────────────────────────────

/**
 * Which item is this about? An input naming no plausible one is `unavailable`.
 * Never a throw: a resolver runs inside a capability's own evaluation.
 */
function itemNumber(input: unknown, kind: ItemRef["kind"]): number | null {
    const item = field(input, "item");
    const number = field(item, "number");
    return field(item, "kind") === kind &&
        typeof number === "number" &&
        Number.isSafeInteger(number) &&
        number >= 1
        ? number
        : null;
}

/** The `linkedIssues` arm: the item's number, then the per-item read (`links.ts`). */
async function linkedIssues(
    options: ResolverSourceOptions,
    input: unknown,
): Promise<ResolverAnswer<readonly ItemRef[]>> {
    const number = itemNumber(input, "pullRequest");
    return number === null
        ? unavailable("linkedIssues requires a valid pull request item")
        : readLinkedIssues(options, number);
}

/**
 * GitHub's own ceiling on the commits endpoint.
 * A pull request with more commits than this cannot be answered at all.
 */
const MAX_COMMITS = 250;

/** Enough pages to reach the ceiling, and not one more. */
const MAX_COMMIT_PAGES = Math.ceil(MAX_COMMITS / PAGE_SIZE);

/** Does this commit message carry a DCO trailer? */
function hasSignoff(message: string): boolean {
    return message.split("\n").some((line) => /^\s*Signed-off-by:\s*\S/i.test(line));
}

/** One entry of the commits list, or `null` when the shape is not GitHub's. */
function attestationOf(entry: unknown): CommitAttestation | null {
    const sha = field(entry, "sha");
    const commit = field(entry, "commit");
    const message = field(commit, "message");
    const parents = field(entry, "parents");
    if (typeof sha !== "string" || sha.length === 0 || typeof message !== "string") return null;
    if (!Array.isArray(parents)) return null;
    return {
        sha,
        // The subject line alone; no check reads the body.

        summary: message.split("\n")[0] ?? "",
        signedOff: hasSignoff(message),
        verified: field(field(commit, "verification"), "verified") === true,
        merge: parents.length > 1,
    };
}

/**
 * Every commit of a pull request, or the reason there is no complete answer.
 * `verified` is GitHub's word and not a signature this file checks.
 */
export async function readCommitAttestations(
    { http, repository, allowance }: ResolverSourceOptions,
    number: number,
): Promise<ResolverAnswer<readonly CommitAttestation[]>> {
    const base = `${repoPath(repository)}/pulls/${String(number)}/commits`;
    const commits: CommitAttestation[] = [];
    for (let page = 1; page <= MAX_COMMIT_PAGES; page += 1) {
        const outcome = await http.request(
            {
                url: `${base}?per_page=${String(PAGE_SIZE)}&page=${String(page)}`,
                method: "GET",
            },
            allowance,
        );
        if (!outcome.ok) return httpFailure(outcome, allowance);
        const entries = jsonArrayOf(outcome.body);
        if (entries === null) return unavailable("GitHub returned malformed commit data");
        for (const entry of entries) {
            const attestation = attestationOf(entry);
            if (attestation === null) return unavailable("GitHub returned malformed commit data");
            commits.push(attestation);
        }
        if (entries.length < PAGE_SIZE) break;
    }
    // A list AT the ceiling is no answer, not a short one.

    return commits.length >= MAX_COMMITS
        ? unavailable(
              `GitHub lists at most ${String(MAX_COMMITS)} commits per pull request, and this one reached that limit`,
          )
        : { ok: true, value: commits };
}

/** The `commitAttestations` arm: the item's number, then the reader above. */
async function commitAttestations(
    options: ResolverSourceOptions,
    input: unknown,
): Promise<ResolverAnswer<readonly CommitAttestation[]>> {
    const number = itemNumber(input, "pullRequest");
    return number === null
        ? unavailable("commitAttestations requires a valid pull request item")
        : readCommitAttestations(options, number);
}

/**
 * Can GitHub merge this pull request cleanly?
 * GitHub reports `null` while it is still computing; that is neither `true` nor `false`.
 */
async function mergeability(
    { http, repository, allowance }: ResolverSourceOptions,
    input: unknown,
): Promise<ResolverAnswer<boolean>> {
    const number = itemNumber(input, "pullRequest");
    if (number === null) return unavailable("mergeability requires a valid pull request item");

    const outcome = await http.request(
        { url: `${repoPath(repository)}/pulls/${String(number)}`, method: "GET" },
        allowance,
    );
    if (!outcome.ok) return httpFailure(outcome, allowance);
    const body = jsonRecordOf(outcome.body);
    if (body === null) return unavailable("GitHub returned malformed pull request data");
    if (body["number"] !== number) {
        return unavailable("GitHub answered about a different pull request");
    }
    const mergeable = body["mergeable"];
    if (typeof mergeable !== "boolean") {
        return unavailable("GitHub has not finished computing whether this branch merges cleanly");
    }
    return { ok: true, value: mergeable };
}

/**
 * The logins assigned to one item. Unpaged: GitHub caps assignees at ten.
 * Takes only what it reads through, so the release's read-back can call it without a configuration it has no business holding.
 */
export async function readAssigneesOf(
    { http, repository, allowance }: RepositoryReads,
    number: number,
): Promise<ResolverAnswer<readonly string[]>> {
    const outcome = await http.request(
        { url: `${repoPath(repository)}/issues/${String(number)}`, method: "GET" },
        allowance,
    );
    if (!outcome.ok) return httpFailure(outcome, allowance);
    const body = jsonRecordOf(outcome.body);
    if (body === null) return unavailable("GitHub returned malformed issue data");
    if (body["number"] !== number) return unavailable("GitHub answered about a different issue");

    const assignees = body["assignees"];
    if (!Array.isArray(assignees)) return unavailable("GitHub returned malformed issue data");
    const logins: string[] = [];
    for (const assignee of assignees) {
        const login = field(assignee, "login");
        if (typeof login !== "string" || login.length === 0) {
            return unavailable("GitHub returned malformed issue data");
        }
        logins.push(login);
    }
    return { ok: true, value: logins };
}

/**
 * The `assigneesOf` arm: the item's number, then the reader above.
 * An ISSUE number only; the matrix row was cited on an issue.
 */
async function assigneesOf(
    options: ResolverSourceOptions,
    input: unknown,
): Promise<ResolverAnswer<readonly string[]>> {
    const number = itemNumber(input, "issue");
    return number === null
        ? unavailable("assigneesOf requires a valid issue item")
        : readAssigneesOf(options, number);
}

/**
 * Every entry of the filtered open-issue list, or the reason there is no complete answer.
 * A list still advertising a successor past the walk's bound is a failure, not a short list.
 */
async function assignedPages(
    { http, repository, allowance }: RepositoryReads,
    login: string,
): Promise<{ readonly ok: true; readonly entries: readonly unknown[] } | ResolverFailure> {
    const url = `${repoPath(repository)}/issues`;
    const entries: unknown[] = [];
    let lastPage = 1;
    for (let page = 1; page <= MAX_LIST_PAGES; page += 1) {
        const outcome = await http.request(
            {
                url:
                    `${url}?per_page=${String(PAGE_SIZE)}&page=${String(page)}` +
                    `&state=open&assignee=${encodeURIComponent(login)}`,
                method: "GET",
            },
            allowance,
        );
        if (!outcome.ok) return httpFailure(outcome, allowance);
        const read = jsonArrayOf(outcome.body);
        if (read === null) return unavailable("GitHub returned malformed assignment data");
        entries.push(...read);
        const link = outcome.headers["link"];
        if (page === 1) lastPage = lastPageFromLink(link) ?? lastPage;
        if (page >= lastPage && !advertisesNextPage(link)) return { ok: true, entries };
    }
    return unavailable(`GitHub assignment pagination exceeded ${String(MAX_LIST_PAGES)} pages`);
}

/**
 * Every open issue one login is assigned to, with the meanings its labels projected to.
 * The `assignee=` filter's answer is re-checked, and a pull request in the list is dropped.
 */
async function openAssignments(
    options: ResolverSourceOptions,
    input: unknown,
): Promise<ResolverAnswer<ResolverOutput<"openAssignments">>> {
    const login = field(input, "login");
    if (typeof login !== "string" || login.length === 0) {
        return unavailable("openAssignments requires a valid login");
    }

    const listed = await assignedPages(options, login);
    if (!listed.ok) return listed;

    const wanted = login.toLowerCase();
    const assignments: { readonly item: ItemRef; readonly meanings: readonly MappableMeaning[] }[] =
        [];
    for (const entry of listed.entries) {
        const number = field(entry, "number");
        const labels = field(entry, "labels");
        const assignees = field(entry, "assignees");
        if (
            typeof number !== "number" ||
            !Number.isSafeInteger(number) ||
            number < 1 ||
            !Array.isArray(labels) ||
            !Array.isArray(assignees)
        ) {
            return unavailable("GitHub returned malformed assignment data");
        }
        if (field(entry, "pull_request") !== undefined) continue;

        const names: string[] = [];
        for (const label of labels) {
            const name = field(label, "name");
            if (typeof name !== "string") {
                return unavailable("GitHub returned malformed assignment data");
            }
            names.push(name);
        }
        // Read every login before judging any: a bad shape must REFUSE, not fail to match.

        const holders: string[] = [];
        for (const assignee of assignees) {
            const each = field(assignee, "login");
            if (typeof each !== "string") {
                return unavailable("GitHub returned malformed assignment data");
            }
            holders.push(each.toLowerCase());
        }
        if (!holders.includes(wanted)) continue;
        assignments.push({
            item: { kind: "issue", number },
            meanings: meaningsOfLabels(options.config, names),
        });
    }
    return { ok: true, value: assignments };
}

// ─── The configuration a pull request proposes ───────────────────────

/**
 * Whether this pull request touches `automations.yml`, and how.
 * `status` is GitHub's own word and `null` is the file untouched; it is only ever compared.
 */
type ConfigFileChange = { readonly ok: true; readonly status: string | null } | ResolverFailure;

/** GitHub's object names, and the one shape that may be spliced into a URL. */
const COMMIT_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/**
 * Did this pull request change the configuration file, and how?
 * A rename AWAY from the path counts; the path is matched exactly (`CONFIG_PATH`, D93).
 */
async function configFileChange(
    { http, repository, allowance }: RepositoryReads,
    number: number,
): Promise<ConfigFileChange> {
    const url = `${repoPath(repository)}/pulls/${String(number)}/files`;
    let lastPage = 1;
    for (let page = 1; page <= MAX_LIST_PAGES; page += 1) {
        const outcome = await http.request(
            {
                url: `${url}?per_page=${String(PAGE_SIZE)}&page=${String(page)}`,
                method: "GET",
            },
            allowance,
        );
        if (!outcome.ok) return httpFailure(outcome, allowance);
        const entries = jsonArrayOf(outcome.body);
        if (entries === null) return unavailable("GitHub returned malformed pull request files");

        for (const entry of entries) {
            const filename = field(entry, "filename");
            const status = field(entry, "status");
            const previous = field(entry, "previous_filename");
            if (typeof filename !== "string" || typeof status !== "string") {
                return unavailable("GitHub returned malformed pull request files");
            }
            if (filename === CONFIG_PATH) return { ok: true, status };
            if (previous === CONFIG_PATH) return { ok: true, status: "removed" };
        }

        const link = outcome.headers["link"];
        if (page === 1) lastPage = lastPageFromLink(link) ?? lastPage;
        if (page >= lastPage && !advertisesNextPage(link)) return { ok: true, status: null };
    }
    return unavailable(`GitHub pull request files exceeded ${String(MAX_LIST_PAGES)} pages`);
}

/**
 * The commit this pull request currently proposes.
 * The shape is checked before the value reaches a URL.
 */
async function headShaOf(
    { http, repository, allowance }: RepositoryReads,
    number: number,
): Promise<{ readonly ok: true; readonly sha: string } | ResolverFailure> {
    const outcome = await http.request(
        { url: `${repoPath(repository)}/pulls/${String(number)}`, method: "GET" },
        allowance,
    );
    if (!outcome.ok) return httpFailure(outcome, allowance);
    const body = jsonRecordOf(outcome.body);
    if (body === null) return unavailable("GitHub returned malformed pull request data");
    if (body["number"] !== number)
        return unavailable("GitHub answered about a different pull request");
    const sha = field(field(body, "head"), "sha");
    return typeof sha === "string" && COMMIT_SHA.test(sha)
        ? { ok: true, sha }
        : unavailable("GitHub reported no usable head commit for this pull request");
}

/**
 * What `automations.yml` would mean if this pull request were merged — a report input only.
 * A 404 is absence only where the pull request's own file list said so (D51, D122).
 */
async function configAtHead(
    options: ResolverSourceOptions,
    input: unknown,
): Promise<ResolverAnswer<ConfigAtHead>> {
    const { http, repository, knownCapabilities, allowance } = options;
    const number = itemNumber(input, "pullRequest");
    if (number === null) return unavailable("configAtHead requires a valid pull request item");

    const change = await configFileChange(options, number);
    if (!change.ok) return change;
    if (change.status === null) return { ok: true, value: { touched: false } };
    if (change.status === "removed") {
        return {
            ok: true,
            value: {
                touched: true,
                revision: ABSENT_CONFIG_REVISION,
                // The parser's own no-file answer, so a deleted and an absent file agree by construction.

                result: parseConfig(null, {
                    revision: ABSENT_CONFIG_REVISION,
                    knownCapabilities,
                }),
            },
        };
    }

    const head = await headShaOf(options, number);
    if (!head.ok) return head;

    const outcome = await http.request(
        {
            url:
                `${repoPath(repository)}/contents/${CONFIG_PATH}` +
                `?ref=${encodeURIComponent(head.sha)}`,
            method: "GET",
        },
        allowance,
    );
    if (!outcome.ok) return httpFailure(outcome, allowance);
    const decoded = decodeContents(outcome.body);
    if (decoded.kind !== "document") {
        return unavailable(
            decoded.kind === "defective"
                ? `the proposed config file is unreadable: ${decoded.detail}`
                : "GitHub returned an unrecognized contents response",
        );
    }
    return {
        ok: true,
        value: {
            touched: true,
            revision: decoded.revision,
            result: parseConfigDocument(decoded.text, {
                revision: decoded.revision,
                knownCapabilities,
            }),
        },
    };
}

/** GitHub gives every App actor the `[bot]` suffix, so no call is needed. */
function isAutomationActor(input: unknown): ResolverAnswer<boolean> {
    const login = field(input, "login");
    return typeof login === "string" && login.length > 0
        ? { ok: true, value: isAutomationLogin(login) }
        : unavailable("isAutomationActor requires a valid login");
}

export function createResolverSource(options: ResolverSourceOptions): ResolverSource {
    // Exhaustive, with no default arm: a new `RESOLVER_NAMES` entry is a compile error.

    const resolve = async (
        query: ResolverName,
        input: unknown,
    ): Promise<ResolverAnswer<unknown>> => {
        // The matrix gate, before the dispatch: an unconfirmed read is implemented, not sent.

        if (!isConfirmedRead(query)) {
            return unavailable(
                `"${query}" reads an endpoint the permission matrix has not confirmed`,
            );
        }
        switch (query) {
            case "linkedIssues":
                return linkedIssues(options, input);
            case "isAutomationActor":
                return isAutomationActor(input);
            case "mergeability":
                return mergeability(options, input);
            case "openAssignments":
                return openAssignments(options, input);
            case "configAtHead":
                return configAtHead(options, input);
            case "commitAttestations":
                return commitAttestations(options, input);
            case "assigneesOf":
                return assigneesOf(options, input);
        }
    };
    // The one erasure: the switch above is what makes the per-name pairing true.

    return resolve as ResolverSource;
}
