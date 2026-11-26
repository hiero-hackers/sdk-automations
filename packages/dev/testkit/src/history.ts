/**
 * A real repository's items as they stood at one instant, pulled and scrubbed by the lab's
 * `history.ts` (protocol 7.1), and the world seeds that replay them.
 */

import { readFileSync } from "node:fs";
import type { WorldComment, WorldSeed } from "./world.js";

interface Account {
    readonly login: string;
    readonly type?: string;
}

export interface HistoryItem {
    readonly entry: {
        readonly number: number;
        readonly user: Account;
        readonly labels: readonly { readonly name: string }[];
        readonly assignees: readonly Account[];
        readonly updated_at: string;
        readonly pull_request?: unknown;
    };
    readonly comments: readonly {
        readonly id: number;
        readonly body: string;
        readonly user: Account;
        readonly created_at: string;
        readonly updated_at: string;
    }[];
    readonly timeline: readonly unknown[];
    readonly pull?: Readonly<Record<string, unknown>>;
    readonly reviews?: readonly unknown[];
    readonly commits?: readonly unknown[];
    readonly closes?: readonly number[];
}

export interface History {
    readonly name: string;
    readonly repository: { readonly full_name: string };
    /** The instant the items were cut at: nothing later is in them. */
    readonly at: string;
    /** The repository's `sdk-automations.yml` at that instant. */
    readonly config: string;
    readonly items: readonly HistoryItem[];
}

/** Listed rather than discovered, as the captures are. */
export type HistoryName = "analytics-2026-11-05T2120Z" | "analytics-2026-11-12T0630Z";

export function history(name: HistoryName): History {
    const text = readFileSync(new URL(`../fixtures/history/${name}.json`, import.meta.url), "utf8");
    return { name, ...(JSON.parse(text) as Omit<History, "name">) };
}

const userOf = (account: Account): WorldComment["user"] => ({
    login: account.login,
    type: account.type === "Bot" ? "Bot" : "User",
});

/** Each item as the world holds it: its labels, assignees, comments and timeline as recorded. */
export function seedsOf(recorded: History): WorldSeed[] {
    return recorded.items.map(({ entry, comments, timeline, pull, reviews, commits, closes }) => ({
        number: entry.number,
        pullRequest: entry.pull_request !== undefined,
        author: entry.user.login,
        labels: entry.labels.map(({ name }) => name),
        assignees: entry.assignees.map(({ login }) => login),
        timeline,
        comments: comments.map((comment) => ({ ...comment, user: userOf(comment.user) })),
        updatedAt: entry.updated_at,
        ...(pull === undefined
            ? {}
            : {
                  pull: {
                      shown: pull,
                      reviews: reviews ?? [],
                      commits: commits ?? [],
                      closes: closes ?? [],
                  },
              }),
    }));
}
