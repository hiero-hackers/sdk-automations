/**
 * Pulls a repository's real item history as it stood at one instant, for the testkit's replay:
 * every item open then, with its comments, timeline, and a pull request's reviews, commits and
 * closing issues, cut at that instant, prose blanked, then scrubbed (protocol 7.1).
 *
 * Usage: GITHUB_TOKEN=... tsx src/history.ts <owner/repo> <instant ISO> <out.json>
 * Read-only: every call is a GET or the GraphQL read; the output goes to `evidence/pending/` for
 * the protocol's read-every-file step before promotion.
 */

import { writeFileSync } from "node:fs";
import { createGitHub, type Call } from "./github.js";
import { scrubPayload } from "./scrub.js";

const PAGE = 100;

/** A comment line the capabilities read as a command, kept so `/working` still counts. */
const COMMAND = /^\/[a-z]+/;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The Action's own comment: software's text, whose marker the next run must read back. */
function byTheAction(value: Record<string, unknown>): boolean {
    const user = value["user"];
    const app =
        isRecord(user) && typeof user["login"] === "string" && user["login"].endsWith("[bot]");
    return app && typeof value["body"] === "string" && value["body"].includes("hiero-automation:");
}

/** Links, avatars and app metadata: bulk no reader takes a fact from. */
const NOISE = /(^|_)url$|^_links$|^reactions$|^performed_via_github_app$|^signature$|^payload$/;

/** An account is its login, type and id; a repository its names. Everything else is bulk. */
export function pruned(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(pruned);
    if (!isRecord(value)) return value;
    if (typeof value["login"] === "string") {
        return { login: value["login"], type: value["type"], id: value["id"] };
    }
    if (typeof value["full_name"] === "string" && isRecord(value["owner"])) {
        return {
            full_name: value["full_name"],
            name: value["name"],
            owner: pruned(value["owner"]),
        };
    }
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
        if (!NOISE.test(key)) out[key] = pruned(child);
    }
    return out;
}

/** Titles and bodies are other people's prose; only a leading command line survives. */
export function blankProse(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(blankProse);
    if (!isRecord(value)) return value;
    if (byTheAction(value)) return value;
    // A git author or committer is a real name beside an email, not an account the scrubber maps.
    const gitPerson = typeof value["email"] === "string";
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
        if (key === "title" && typeof child === "string") out[key] = "scrubbed-title";
        else if (key === "body" && typeof child === "string") out[key] = keptBody(child);
        else if (key === "message" && typeof child === "string") out[key] = keptMessage(child);
        else if (key === "name" && gitPerson) out[key] = "scrubbed-name";
        else out[key] = blankProse(child);
    }
    return out;
}

/** A commit keeps its subject, which the dashboard quotes, and whether it was signed off. */
function keptMessage(message: string): string {
    const subject = message.split("\n")[0] ?? "";
    return /^Signed-off-by: /m.test(message)
        ? `${subject}\n\nSigned-off-by: scrubbed-name <scrubbed@example.invalid>`
        : subject;
}

function keptBody(body: string): string {
    const first = body.trimStart().split("\n")[0] ?? "";
    return COMMAND.test(first) ? (COMMAND.exec(first)?.[0] ?? "") : "scrubbed-body";
}

/** When an entry happened, by whichever stamp its kind carries; `null` when it carries none. */
export function instantOf(entry: unknown): number | null {
    if (!isRecord(entry)) return null;
    const commit = isRecord(entry["commit"]) ? entry["commit"] : undefined;
    const committer =
        commit !== undefined && isRecord(commit["committer"]) ? commit["committer"] : {};
    const stamp =
        entry["created_at"] ?? entry["submitted_at"] ?? committer["date"] ?? entry["committed_at"];
    const parsed = typeof stamp === "string" ? Date.parse(stamp) : Number.NaN;
    return Number.isNaN(parsed) ? null : parsed;
}

/** What had happened by `at`; an undated entry is dropped rather than guessed into the past. */
export const asOf = (entries: readonly unknown[], at: number): unknown[] =>
    entries.filter((entry) => {
        const when = instantOf(entry);
        return when !== null && when <= at;
    });

/** The logins assigned, or label names held, at `at`, replayed from the timeline's own events. */
export function heldAt(
    timeline: readonly unknown[],
    added: string,
    removed: string,
    nameOf: (entry: Record<string, unknown>) => unknown,
): string[] {
    const held: string[] = [];
    for (const entry of timeline) {
        if (!isRecord(entry)) continue;
        const name = nameOf(entry);
        if (typeof name !== "string") continue;
        if (entry["event"] === added && !held.includes(name)) held.push(name);
        if (entry["event"] === removed && held.includes(name)) held.splice(held.indexOf(name), 1);
    }
    return held;
}

async function allPages(call: Call, path: string): Promise<unknown[]> {
    const out: unknown[] = [];
    for (let page = 1; ; page += 1) {
        const joiner = path.includes("?") ? "&" : "?";
        const { body } = await call(
            "GET",
            `${path}${joiner}per_page=${String(PAGE)}&page=${String(page)}`,
        );
        if (!Array.isArray(body)) throw new Error(`${path} did not answer a list`);
        out.push(...body);
        if (body.length < PAGE) return out;
    }
}

const LINKS = `query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      closingIssuesReferences(first: 100, excludeUserLinked: true) {
        nodes { number repository { nameWithOwner } }
      }
    }
  }
}`;

async function closingIssues(
    call: Call,
    owner: string,
    repo: string,
    number: number,
): Promise<number[]> {
    const { body } = await call("POST", "/graphql", {
        body: { query: LINKS, variables: { owner, repo, number } },
    });
    const nodes = (
        body as {
            data?: {
                repository?: {
                    pullRequest?: {
                        closingIssuesReferences?: {
                            nodes?: { number: number; repository: { nameWithOwner: string } }[];
                        };
                    };
                };
            };
        }
    ).data?.repository?.pullRequest?.closingIssuesReferences?.nodes;
    if (!Array.isArray(nodes)) throw new Error(`#${String(number)} linked issues were unreadable`);
    // Another repository's issue cannot be an item in this one's world.
    const here = `${owner}/${repo}`.toLowerCase();
    return nodes
        .filter(({ repository }) => repository.nameWithOwner.toLowerCase() === here)
        .map(({ number: linked }) => linked);
}

/**
 * The closing references that could have existed at `at`: an issue opened since was linked since.
 * A link added since to an older issue reads as present then; the API keeps no history of it.
 */
async function closedThen(
    call: Call,
    base: string,
    numbers: readonly number[],
    at: number,
): Promise<number[]> {
    const kept: number[] = [];
    for (const number of numbers) {
        const { body } = await call("GET", `${base}/issues/${String(number)}`);
        if (isRecord(body) && Date.parse(String(body["created_at"])) <= at) kept.push(number);
    }
    return kept;
}

/** Open at `at`: created by then and not yet closed. A reopen cycle before `at` reads as open. */
function openAt(entry: Record<string, unknown>, at: number): boolean {
    const created = Date.parse(String(entry["created_at"]));
    const closed = typeof entry["closed_at"] === "string" ? Date.parse(entry["closed_at"]) : null;
    return created <= at && (closed === null || closed > at);
}

/** The events after `at`, oldest first: what changed since, which the API answers only as now. */
const after = (entries: readonly unknown[], at: number): Record<string, unknown>[] =>
    entries
        .filter(isRecord)
        .filter((entry) => (instantOf(entry) ?? 0) > at)
        .sort((a, b) => (instantOf(a) ?? 0) - (instantOf(b) ?? 0));

/** Draft at `at`: the first draft change since says what it was, or nothing changed it. */
export function draftAt(draftNow: boolean, since: readonly Record<string, unknown>[]): boolean {
    const first = since.find(
        ({ event }) => event === "ready_for_review" || event === "convert_to_draft",
    );
    if (first === undefined) return draftNow;
    return first["event"] === "ready_for_review";
}

/**
 * A pull request as it stood at `at`, or the reason it cannot be: a force-push since replaced its
 * commits, so neither they nor the mergeability then can be read back. One merged since is read
 * as open and mergeable then, since it went on to merge cleanly.
 */
export function pullAt(
    pull: Record<string, unknown>,
    since: readonly Record<string, unknown>[],
): Record<string, unknown> | { readonly unfaithful: string } {
    if (since.some(({ event }) => event === "head_ref_force_pushed")) {
        return { unfaithful: "force-pushed since, so its commits then are gone" };
    }
    const shown = { ...pull, draft: draftAt(pull["draft"] === true, since) };
    if (!since.some(({ event }) => event === "merged" || event === "closed")) return shown;
    const reopened = { ...shown, state: "open", merged: false, merged_at: null, closed_at: null };
    return since.some(({ event }) => event === "merged")
        ? { ...reopened, mergeable: true }
        : reopened;
}

async function itemAt(
    call: Call,
    base: string,
    owner: string,
    repo: string,
    entry: Record<string, unknown>,
    at: number,
) {
    const number = Number(entry["number"]);
    const everything = await allPages(call, `${base}/issues/${String(number)}/timeline`);
    const timeline = asOf(everything, at);
    const comments = asOf(await allPages(call, `${base}/issues/${String(number)}/comments`), at);
    const pullRequest = entry["pull_request"] !== undefined;
    const assignees = heldAt(timeline, "assigned", "unassigned", (e) =>
        isRecord(e["assignee"]) ? e["assignee"]["login"] : undefined,
    );
    const labels = heldAt(timeline, "labeled", "unlabeled", (e) =>
        isRecord(e["label"]) ? e["label"]["name"] : undefined,
    );
    const stamps = [...timeline, ...comments].map(instantOf).filter((t): t is number => t !== null);
    const updated = new Date(
        Math.max(Date.parse(String(entry["created_at"])), ...stamps),
    ).toISOString();
    const shown: Record<string, unknown> = {
        ...entry,
        state: "open",
        closed_at: null,
        updated_at: updated,
        labels: labels.map((name) => ({ name })),
        assignees: assignees.map((login) => ({ login })),
    };
    if (!pullRequest) return { entry: shown, comments, timeline };
    const { body } = await call("GET", `${base}/pulls/${String(number)}`);
    const pull = pullAt(isRecord(body) ? body : {}, after(everything, at));
    if ("unfaithful" in pull) return { number, unfaithful: pull.unfaithful };
    return {
        entry: shown,
        comments,
        timeline,
        pull,
        reviews: asOf(await allPages(call, `${base}/pulls/${String(number)}/reviews`), at),
        commits: asOf(await allPages(call, `${base}/pulls/${String(number)}/commits`), at),
        closes: await closedThen(call, base, await closingIssues(call, owner, repo, number), at),
    };
}

export async function pullHistory(call: Call, fullName: string, instant: string): Promise<unknown> {
    const [owner = "", repo = ""] = fullName.split("/");
    const at = Date.parse(instant);
    const base = `/repos/${owner}/${repo}`;
    const listed = [
        ...(await allPages(call, `${base}/issues?state=open`)),
        ...(await allPages(call, `${base}/issues?state=closed&since=${instant}`)),
    ].filter(isRecord);
    const seen = new Set<number>();
    const items = [];
    const unfaithful = [];
    for (const entry of listed) {
        const number = Number(entry["number"]);
        if (seen.has(number) || !openAt(entry, at)) continue;
        seen.add(number);
        const item = await itemAt(call, base, owner, repo, entry, at);
        if ("unfaithful" in item) unfaithful.push(item);
        else items.push(item);
    }
    items.sort((a, b) => Number(a.entry["number"]) - Number(b.entry["number"]));
    const { body: file } = await call("GET", `${base}/contents/sdk-automations.yml`);
    const config = Buffer.from(
        String((file as { content?: string }).content ?? ""),
        "base64",
    ).toString("utf8");
    return scrubPayload(
        blankProse(
            pruned({ repository: { full_name: fullName }, at: instant, config, unfaithful, items }),
        ),
    );
}

/** One line per item: a fixture a reviewer can scan, and a re-pull diffs item by item. */
export function oneItemPerLine(history: unknown): string {
    const { items, ...rest } = history as { items: unknown[] };
    const head = JSON.stringify(rest, null, 2).slice(0, -2);
    const lines = items.map((item) => `    ${JSON.stringify(item)}`).join(",\n");
    return `${head},\n  "items": [\n${lines}\n  ]\n}\n`;
}

async function main(): Promise<void> {
    const [fullName, instant, out] = process.argv.slice(2);
    const token = process.env["GITHUB_TOKEN"];
    if (
        fullName === undefined ||
        instant === undefined ||
        out === undefined ||
        token === undefined
    ) {
        throw new Error(
            "usage: GITHUB_TOKEN=... tsx src/history.ts <owner/repo> <instant ISO> <out.json>",
        );
    }
    const history = await pullHistory(createGitHub(token), fullName, instant);
    writeFileSync(out, oneItemPerLine(history));
}

if (process.argv[1]?.endsWith("history.ts") === true) await main();
