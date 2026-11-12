/**
 * GitHub that remembers what was written: comments, labels, assignees and state, read back as
 * GitHub would answer them. A write the route table only acknowledges lands here, so a test can
 * hold an active run to what the repository ends up showing, not to what was sent.
 * Harsher than GitHub in one place: a seeded lock refuses every comment, a collaborator's too.
 * Kinder in one: the bot's own lock is acknowledged by the route table and never held here.
 */

export interface WorldComment {
    readonly id: number;
    body: string;
    /** `null` where GitHub reports no account, as it may for one since deleted. */
    readonly user: { readonly login: string; readonly type: "User" | "Bot" } | null;
    readonly created_at: string;
    updated_at: string;
}

export interface WorldItem {
    readonly number: number;
    readonly pullRequest: boolean;
    readonly author: string;
    state: "open" | "closed";
    readonly locked: boolean;
    labels: string[];
    assignees: string[];
    readonly comments: WorldComment[];
    /** The human history it was seeded with; the bot's own writes are never a human change. */
    readonly timeline: readonly unknown[];
    /** What a pull request's own reads answer, as seeded. */
    readonly pull: PullFacts;
    /** The last change; a write moves it, as GitHub's `updated_at` does. */
    updatedAt: string | undefined;
}

export interface PullFacts {
    /** The pull request as GitHub answered it; the world's own state is laid over it. */
    readonly shown: Readonly<Record<string, unknown>>;
    readonly reviews: readonly unknown[];
    readonly commits: readonly unknown[];
    /** The issues it closes, by number, in this repository. */
    readonly closes: readonly number[];
}

export interface WorldSeed {
    readonly number: number;
    readonly pullRequest?: boolean;
    readonly author: string;
    /** A locked conversation refuses the runner's comments, as GitHub refuses `GITHUB_TOKEN`'s. */
    readonly locked?: boolean;
    readonly labels?: readonly string[];
    readonly assignees?: readonly string[];
    /** When the author assigned each seeded assignee; the timeline records it as theirs. */
    readonly assignedAt?: string;
    /** A real history, replacing the one `assignedAt` would make up. */
    readonly timeline?: readonly unknown[];
    readonly comments?: readonly WorldComment[];
    readonly updatedAt?: string;
    readonly pull?: Partial<PullFacts>;
}

/** One answer from the world, or `undefined` for a route it does not hold. */
export interface WorldReply {
    readonly status: number;
    readonly body: unknown;
}

export interface World {
    readonly items: ReadonlyMap<number, WorldItem>;
    /** The repository's own labels, by name. */
    readonly labels: ReadonlySet<string>;
    answer(method: string, route: string, body: string): WorldReply | undefined;
    /** Move an item to another repository: from now on every route to it answers 301. */
    transfer(number: number): void;
}

const BOT = { login: "github-actions[bot]", type: "Bot" } as const;

function sentRecord(text: string): Record<string, unknown> {
    try {
        const parsed: unknown = JSON.parse(text);
        return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : {};
    } catch {
        return {};
    }
}

const strings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

/** The issue shape GitHub answers for an issue or a pull request read as one. */
function issueOf(item: WorldItem, updatedAt: string): unknown {
    return {
        number: item.number,
        state: item.state,
        locked: item.locked,
        updated_at: item.updatedAt ?? updatedAt,
        user: { login: item.author, type: item.author.endsWith("[bot]") ? "Bot" : "User" },
        labels: item.labels.map((name) => ({ name })),
        assignees: item.assignees.map((login) => ({ login })),
        ...(item.pullRequest
            ? { pull_request: { url: `https://api.github.com/pulls/${String(item.number)}` } }
            : {}),
    };
}

/** The pull-request shape: the issue's fields plus what only `/pulls/{n}` reports. */
function pullOf(item: WorldItem, updatedAt: string): unknown {
    return {
        draft: false,
        merged: false,
        mergeable: true,
        created_at: updatedAt,
        head: { sha: "a".repeat(40) },
        ...item.pull.shown,
        ...(issueOf(item, updatedAt) as Record<string, unknown>),
    };
}

/** The linked-issue read, answered per pull request the query names: one, or a batch of aliases. */
function linkedIssues(
    items: ReadonlyMap<number, WorldItem>,
    repository: string,
    sent: Record<string, unknown>,
): WorldReply | undefined {
    const query = typeof sent["query"] === "string" ? sent["query"] : "";
    if (!query.includes("closingIssuesReferences")) return undefined;
    const variables = (sent["variables"] ?? {}) as Record<string, unknown>;
    const asked = Object.entries(variables).filter(
        ([name, value]) => (name === "number" || /^n\d+$/.test(name)) && typeof value === "number",
    );
    const answered: Record<string, unknown> = { nameWithOwner: repository };
    for (const [name, value] of asked) {
        const item = items.get(value as number);
        if (item?.pullRequest !== true) return undefined;
        answered[name === "number" ? "pullRequest" : `p${name.slice(1)}`] = {
            number: item.number,
            closingIssuesReferences: {
                nodes: item.pull.closes.map((number) => ({
                    number,
                    repository: { nameWithOwner: repository },
                })),
                pageInfo: { hasNextPage: false, endCursor: null },
            },
        };
    }
    return { status: 200, body: { data: { rateLimit: { cost: 1 }, repository: answered } } };
}

export function createWorld(options: {
    readonly now: () => Date;
    readonly items: readonly WorldSeed[];
    readonly labels?: readonly string[];
    readonly repository?: string;
}): World {
    const items = new Map<number, WorldItem>(
        options.items.map((seed) => [
            seed.number,
            {
                number: seed.number,
                pullRequest: seed.pullRequest ?? false,
                author: seed.author,
                state: "open",
                locked: seed.locked ?? false,
                labels: [...(seed.labels ?? [])],
                assignees: [...(seed.assignees ?? [])],
                comments: (seed.comments ?? []).map((comment) => ({ ...comment })),
                timeline:
                    seed.timeline ??
                    (seed.assignees ?? []).map((login) => ({
                        event: "assigned",
                        assignee: { login },
                        actor: { login: seed.author, type: "User" },
                        created_at: seed.assignedAt ?? options.now().toISOString(),
                    })),
                pull: {
                    shown: seed.pull?.shown ?? {},
                    reviews: seed.pull?.reviews ?? [],
                    commits: seed.pull?.commits ?? [],
                    closes: seed.pull?.closes ?? [],
                },
                updatedAt: seed.updatedAt,
            },
        ]),
    );
    const labels = new Set(options.labels ?? []);
    // GitHub matches a label name without regard to case, and keeps the spelling it was made with.
    const spellingOf = (name: string): string | undefined =>
        [...labels].find((held) => held.toLowerCase() === name.toLowerCase());
    const moved = new Set<number>();
    const repository = options.repository ?? "scrubbed-1/scrubbed-2";
    // Ids continue past every seeded comment's, so a new one never answers as an old one.
    let ids = Math.max(
        0,
        ...[...items.values()].flatMap((item) => item.comments.map(({ id }) => id)),
    );
    const stamp = (): string => options.now().toISOString();

    const onItem = (
        method: string,
        item: WorldItem,
        rest: string,
        sent: Record<string, unknown>,
    ): WorldReply | undefined => {
        if (rest === "/comments" && method === "POST" && item.locked) {
            return {
                status: 403,
                body: { message: "Unable to create comment because issue is locked." },
            };
        }
        if (method !== "GET") item.updatedAt = stamp();
        if (rest === "" && method === "GET") return { status: 200, body: issueOf(item, stamp()) };
        if (rest === "" && method === "PATCH") {
            if (sent["state"] === "closed" || sent["state"] === "open") item.state = sent["state"];
            return { status: 200, body: issueOf(item, stamp()) };
        }
        if (rest === "/comments" && method === "GET") return { status: 200, body: item.comments };
        if (rest === "/timeline" && method === "GET") return { status: 200, body: item.timeline };
        if (rest === "/comments" && method === "POST") {
            const at = stamp();
            const comment = {
                id: (ids += 1),
                body: String(sent["body"] ?? ""),
                user: BOT,
                created_at: at,
                updated_at: at,
            };
            item.comments.push(comment);
            return { status: 201, body: comment };
        }
        if (rest === "/labels" && method === "GET") {
            return { status: 200, body: item.labels.map((name) => ({ name })) };
        }
        if (rest === "/labels" && method === "POST") {
            for (const name of strings(sent["labels"])) {
                const spelled = spellingOf(name) ?? name;
                labels.add(spelled);
                if (!item.labels.includes(spelled)) item.labels.push(spelled);
            }
            return { status: 200, body: item.labels.map((name) => ({ name })) };
        }
        if (rest.startsWith("/labels/") && method === "DELETE") {
            const name = decodeURIComponent(rest.slice("/labels/".length)).toLowerCase();
            if (!item.labels.some((held) => held.toLowerCase() === name))
                return { status: 404, body: { message: "Label does not exist" } };
            item.labels = item.labels.filter((held) => held.toLowerCase() !== name);
            return { status: 200, body: item.labels.map((held) => ({ name: held })) };
        }
        if (rest === "/assignees" && method === "POST") {
            for (const login of strings(sent["assignees"])) {
                if (!item.assignees.includes(login)) item.assignees.push(login);
            }
            return { status: 201, body: issueOf(item, stamp()) };
        }
        if (rest === "/assignees" && method === "DELETE") {
            const leaving = strings(sent["assignees"]);
            item.assignees = item.assignees.filter((login) => !leaving.includes(login));
            return { status: 200, body: issueOf(item, stamp()) };
        }
        return undefined;
    };

    const onComment = (
        method: string,
        id: number,
        sent: Record<string, unknown>,
    ): WorldReply | undefined => {
        const comment = [...items.values()]
            .flatMap((item) => item.comments)
            .find((held) => held.id === id);
        if (comment === undefined) return { status: 404, body: { message: "Not Found" } };
        if (method === "PATCH") {
            comment.body = String(sent["body"] ?? comment.body);
            comment.updated_at = stamp();
        }
        return { status: 200, body: comment };
    };

    return {
        items,
        labels,
        transfer(number) {
            moved.add(number);
        },
        answer(method, route, body) {
            const sent = sentRecord(body);
            if (route === "/graphql") return linkedIssues(items, repository, sent);
            const away = /^\/(?:issues|pulls)\/(\d+)(?:\/|$)/.exec(route);
            if (away !== null && moved.has(Number(away[1]))) {
                return { status: 301, body: { message: "Moved Permanently" } };
            }
            if (route === "/issues" && method === "GET") {
                const open = [...items.values()].filter(
                    (item) => item.state === "open" && !moved.has(item.number),
                );
                return { status: 200, body: open.map((item) => issueOf(item, stamp())) };
            }
            const pullRead = /^\/pulls\/(\d+)\/(reviews|commits)$/.exec(route);
            const read = pullRead === null ? undefined : items.get(Number(pullRead[1]));
            if (read?.pullRequest === true && method === "GET") {
                const facts = pullRead?.[2] === "reviews" ? read.pull.reviews : read.pull.commits;
                return { status: 200, body: facts };
            }
            if (route === "/labels" && method === "POST") {
                const name = String(sent["name"] ?? "");
                if (spellingOf(name) !== undefined)
                    return { status: 422, body: { message: "Validation Failed" } };
                labels.add(name);
                return { status: 201, body: { id: (ids += 1), name } };
            }
            const label = /^\/labels\/(.+)$/.exec(route);
            if (label !== null && method === "GET") {
                const name = spellingOf(decodeURIComponent(label[1] ?? ""));
                return name !== undefined
                    ? { status: 200, body: { name } }
                    : { status: 404, body: { message: "Not Found" } };
            }
            const comment = /^\/issues\/comments\/(\d+)$/.exec(route);
            if (comment !== null) return onComment(method, Number(comment[1]), sent);
            const pull = /^\/pulls\/(\d+)$/.exec(route);
            const pulled = pull === null ? undefined : items.get(Number(pull[1]));
            if (pulled?.pullRequest === true) {
                if (
                    method === "PATCH" &&
                    (sent["state"] === "closed" || sent["state"] === "open")
                ) {
                    pulled.state = sent["state"];
                }
                return { status: 200, body: pullOf(pulled, stamp()) };
            }
            const issue =
                /^\/issues\/(\d+)(\/(?:comments|timeline|labels(?:\/.+)?|assignees))?$/.exec(route);
            const item = issue === null ? undefined : items.get(Number(issue[1]));
            if (issue === null || item === undefined) return undefined;
            return onItem(method, item, issue[2] ?? "", sent);
        },
    };
}
