/**
 * GitHub that remembers what was written: comments, labels, assignees and state, read back as
 * GitHub would answer them. A write the route table only acknowledges lands here, so a test can
 * hold an active run to what the repository ends up showing, not to what was sent.
 */

export interface WorldComment {
    readonly id: number;
    body: string;
    readonly user: { readonly login: string; readonly type: "User" | "Bot" };
    readonly created_at: string;
    updated_at: string;
}

export interface WorldItem {
    readonly number: number;
    readonly pullRequest: boolean;
    readonly author: string;
    state: "open" | "closed";
    labels: string[];
    assignees: string[];
    readonly comments: WorldComment[];
    /** The human history it was seeded with; the bot's own writes are never a human change. */
    readonly timeline: readonly unknown[];
}

export interface WorldSeed {
    readonly number: number;
    readonly pullRequest?: boolean;
    readonly author: string;
    readonly labels?: readonly string[];
    readonly assignees?: readonly string[];
    /** When the author assigned each seeded assignee; the timeline records it as theirs. */
    readonly assignedAt?: string;
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
        locked: false,
        updated_at: updatedAt,
        user: { login: item.author, type: "User" },
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
        ...(issueOf(item, updatedAt) as Record<string, unknown>),
        draft: false,
        merged: false,
        mergeable: true,
        created_at: updatedAt,
        head: { sha: "a".repeat(40) },
    };
}

export function createWorld(options: {
    readonly now: () => Date;
    readonly items: readonly WorldSeed[];
    readonly labels?: readonly string[];
}): World {
    const items = new Map<number, WorldItem>(
        options.items.map((seed) => [
            seed.number,
            {
                number: seed.number,
                pullRequest: seed.pullRequest ?? false,
                author: seed.author,
                state: "open",
                labels: [...(seed.labels ?? [])],
                assignees: [...(seed.assignees ?? [])],
                comments: [],
                timeline: (seed.assignees ?? []).map((login) => ({
                    event: "assigned",
                    assignee: { login },
                    actor: { login: seed.author, type: "User" },
                    created_at: seed.assignedAt ?? options.now().toISOString(),
                })),
            },
        ]),
    );
    const labels = new Set(options.labels ?? []);
    let ids = 0;
    const stamp = (): string => options.now().toISOString();

    const onItem = (
        method: string,
        item: WorldItem,
        rest: string,
        sent: Record<string, unknown>,
    ): WorldReply | undefined => {
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
                labels.add(name);
                if (!item.labels.includes(name)) item.labels.push(name);
            }
            return { status: 200, body: item.labels.map((name) => ({ name })) };
        }
        if (rest.startsWith("/labels/") && method === "DELETE") {
            const name = decodeURIComponent(rest.slice("/labels/".length));
            if (!item.labels.includes(name))
                return { status: 404, body: { message: "Label does not exist" } };
            item.labels = item.labels.filter((held) => held !== name);
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
        answer(method, route, body) {
            const sent = sentRecord(body);
            if (route === "/labels" && method === "POST") {
                const name = String(sent["name"] ?? "");
                if (labels.has(name))
                    return { status: 422, body: { message: "Validation Failed" } };
                labels.add(name);
                return { status: 201, body: { id: (ids += 1), name } };
            }
            const label = /^\/labels\/(.+)$/.exec(route);
            if (label !== null && method === "GET") {
                const name = decodeURIComponent(label[1] ?? "");
                return labels.has(name)
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
            const issue = /^\/issues\/(\d+)(\/(?:comments|timeline|labels(?:\/.+)?|assignees))?$/.exec(
                route,
            );
            const item = issue === null ? undefined : items.get(Number(issue[1]));
            if (issue === null || item === undefined) return undefined;
            return onItem(method, item, issue[2] ?? "", sent);
        },
    };
}
