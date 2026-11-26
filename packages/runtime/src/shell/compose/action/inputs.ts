/**
 * The Action's pure half: the runner's environment read into one run, and the payload's item.
 * Nothing here touches GitHub, the store or the clock.
 */

import { createHash } from "node:crypto";
import {
    asDeliveryGuid,
    type DeliveryGuid,
    type ItemRef,
    type PermissionGrant,
    type RepositoryRef,
} from "@hiero-hackers/automation-core";

type Environment = Readonly<Partial<Record<string, string>>>;

/** The refusals, word for word: a misconfigured workflow has one reader, whoever wrote it. */
export const ACTION_REFUSAL = {
    repository: "GITHUB_REPOSITORY must be owner/repo; the runner sets it.",
    event: "GITHUB_EVENT_NAME and GITHUB_EVENT_PATH are required; the runner sets both.",
    token: "the token input is required: pass `token: ${{ github.token }}` or leave the default.",
    arm: 'arm-writes must be "true" or "false".',
    run: "GITHUB_RUN_ID is required; the runner sets it.",
    apiUrl: "GITHUB_API_URL must be an https origin with no path (http only on loopback); the runner sets it.",
    identity:
        "bot-login must end in [bot] and app-id must be a whole number: the identity the token writes as, so a run recognises its own comments.",
} as const;

/** What one run is, read from the runner's environment and the action's inputs. */
export interface ActionRun {
    readonly repository: RepositoryRef;
    readonly eventName: string;
    readonly eventPath: string;
    readonly token: string;
    /** The second gate on writes beside the config's mode; `false` lowers `active` to `dry-run`. */
    readonly armWrites: boolean;
    /** The GitHub API origin the runner names; `null` is api.github.com. */
    readonly apiOrigin: string | null;
    /** Whose comments are the run's own: the runner's unless the token belongs to another App; `slug` is the login without `[bot]`. */
    readonly identity: { readonly appId: string; readonly botLogin: string; readonly slug: string };
    /** One GUID per run attempt, so a re-run is a new delivery and a redelivery is not. */
    readonly deliveryId: DeliveryGuid;
    readonly runUrl: string | null;
    /** The file the workflow's cache carries the sweep's cursor in; `null` starts every sweep over (D248). */
    readonly sweepCursor: string | null;
}

export type ParsedRun =
    | { readonly ok: true; readonly run: ActionRun }
    | { readonly ok: false; readonly errors: readonly string[] };

/** A GUID GitHub never issued, derived from the run attempt so the same attempt is one delivery. */
export function deliveryIdOf(runId: string, attempt: string): DeliveryGuid {
    const hex = createHash("sha256").update(`${runId}.${attempt}`).digest("hex");
    const guid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
    return asDeliveryGuid(guid) as DeliveryGuid;
}

/** The webhook GitHub would have sent: a `pull_request_target` run carries a `pull_request` payload. */
function webhookEventOf(runnerEvent: string): string {
    return runnerEvent === "pull_request_target" ? "pull_request" : runnerEvent;
}

function repositoryOf(spelled: string | undefined): RepositoryRef | null {
    const halves = /^([^/\s]+)\/([^/\s]+)$/.exec(spelled ?? "");
    return halves === null ? null : { owner: halves[1] as string, repo: halves[2] as string };
}

/** The grants the documented workflow gives; a narrower one surfaces as a refused write. */
export const RUNNER_GRANTS: readonly PermissionGrant[] = [
    "contents:read",
    "issues:write",
    "metadata:read",
    "pull_requests:write",
];

/** GitHub Actions' own App and bot login: what the read-back recognises as this run's writes. */
export const RUNNER_IDENTITY = {
    appId: "15368",
    botLogin: "github-actions[bot]",
    slug: "github-actions",
} as const;

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** The origin a `GITHUB_API_URL` names when it is an https origin and nothing more, else `null`; http only on loopback, so a token never crosses a network in clear. */
function apiOriginOf(spelled: string): string | null {
    let url: URL;
    try {
        url = new URL(spelled);
    } catch {
        return null;
    }
    const bare =
        (url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK.has(url.hostname))) &&
        url.pathname === "/" &&
        url.search === "" &&
        url.hash === "" &&
        url.username === "" &&
        url.password === "";
    return bare ? url.origin : null;
}

/** Pure: every refusal the environment earns, or the run it describes. */
export function parseActionEnvironment(env: Environment): ParsedRun {
    const errors: string[] = [];
    const repository = repositoryOf(env["GITHUB_REPOSITORY"]);
    if (repository === null) errors.push(ACTION_REFUSAL.repository);
    const eventName = webhookEventOf(env["GITHUB_EVENT_NAME"] ?? "");
    const eventPath = env["GITHUB_EVENT_PATH"] ?? "";
    if (eventName === "" || eventPath === "") errors.push(ACTION_REFUSAL.event);
    const token = env["INPUT_TOKEN"] ?? env["GITHUB_TOKEN"] ?? "";
    if (token === "") errors.push(ACTION_REFUSAL.token);
    const arm = env["INPUT_ARM-WRITES"] ?? "false";
    if (arm !== "true" && arm !== "false") errors.push(ACTION_REFUSAL.arm);
    const runId = env["GITHUB_RUN_ID"] ?? "";
    if (runId === "") errors.push(ACTION_REFUSAL.run);
    const botLogin = env["INPUT_BOT-LOGIN"] ?? RUNNER_IDENTITY.botLogin;
    const appId = env["INPUT_APP-ID"] ?? RUNNER_IDENTITY.appId;
    if (!botLogin.endsWith("[bot]") || !/^\d+$/.test(appId)) errors.push(ACTION_REFUSAL.identity);
    const apiUrl = env["GITHUB_API_URL"];
    const apiOrigin = apiUrl === undefined ? null : apiOriginOf(apiUrl);
    if (apiUrl !== undefined && apiOrigin === null) errors.push(ACTION_REFUSAL.apiUrl);
    const slug = botLogin.replace(/\[bot\]$/, "");
    const sweepCursor = env["INPUT_SWEEP-CURSOR"] ?? "";
    if (errors.length > 0 || repository === null) return { ok: false, errors };
    const server = env["GITHUB_SERVER_URL"];
    return {
        ok: true,
        run: {
            repository,
            eventName,
            eventPath,
            token,
            armWrites: arm === "true",
            apiOrigin,
            identity: { appId, botLogin, slug },
            deliveryId: deliveryIdOf(runId, env["GITHUB_RUN_ATTEMPT"] ?? "1"),
            runUrl:
                server === undefined
                    ? null
                    : `${server}/${repository.owner}/${repository.repo}/actions/runs/${runId}`,
            sweepCursor: sweepCursor === "" ? null : sweepCursor,
        },
    };
}

/** The item an event payload is about, for the summary; the engine reads it again properly. */
export function itemNamedBy(payload: Uint8Array): ItemRef | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(Buffer.from(payload).toString("utf8"));
    } catch {
        return null;
    }
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    const pull = record["pull_request"] as Record<string, unknown> | undefined;
    if (typeof pull?.["number"] === "number")
        return { kind: "pullRequest", number: pull["number"] };
    const issue = record["issue"] as Record<string, unknown> | undefined;
    if (typeof issue?.["number"] !== "number") return null;
    return {
        kind: issue["pull_request"] === undefined ? "issue" : "pullRequest",
        number: issue["number"],
    };
}
