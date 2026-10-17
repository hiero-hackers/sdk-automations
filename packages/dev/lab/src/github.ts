/**
 * The lab's person on GitHub: every call is made with the operator's own token, so each change
 * reaches the shell or the Action as a human's. The App's calls are the shell's, never made here.
 */

const API_ORIGIN = "https://api.github.com";

const API_VERSION = "2026-03-10";

const USER_AGENT = "hiero-hackers-sdk-automations-rehearsal";

/** Why the run stopped. Thrown only inside the rehearsal and caught once, before restoring. */
export class Halt extends Error {}

export interface Answer {
    readonly status: number;
    readonly body: unknown;
    /** GitHub's clock as it answered, ISO; `null` where the header was absent. */
    readonly date: string | null;
}

/** One API call, answered with a status the caller accepts or halted with what came back. */
export type Call = (
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    options?: { readonly body?: unknown; readonly accept?: readonly number[] },
) => Promise<Answer>;

const headersFor = (token: string): Record<string, string> => ({
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "user-agent": USER_AGENT,
    "x-github-api-version": API_VERSION,
});

/** A `date` header as ISO, where GitHub sent one that parses. */
function isoOf(header: string | null): string | null {
    const parsed = header === null ? Number.NaN : Date.parse(header);
    return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

export function createGitHub(token: string): Call {
    return async (method, path, { body, accept = [200] } = {}) => {
        let response: Response;
        try {
            response = await fetch(`${API_ORIGIN}${path}`, {
                method,
                headers: headersFor(token),
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
                redirect: "manual",
            });
        } catch {
            throw new Halt(`${method} ${path} did not complete`);
        }
        const text = await response.text().catch(() => "");
        if (!accept.includes(response.status)) {
            const retryAfter = response.headers.get("retry-after");
            const limit = retryAfter === null ? "" : ` with retry-after ${retryAfter}, a limit,`;
            throw new Halt(
                `${method} ${path} answered ${String(response.status)}${limit}: ${text.slice(0, 200)}`,
            );
        }
        return {
            status: response.status,
            body: parsedOrHalt(text, `${method} ${path}`),
            date: isoOf(response.headers.get("date")),
        };
    };
}

/** A text body, following the one redirect a log download answers with, where the token must not go. */
export async function fetchText(token: string, path: string): Promise<string> {
    const first = await fetch(`${API_ORIGIN}${path}`, {
        headers: headersFor(token),
        redirect: "manual",
    }).catch(() => null);
    const location = first?.headers.get("location") ?? null;
    const redirected = first !== null && first.status >= 300 && first.status < 400;
    const answer =
        redirected && location !== null ? await fetch(location).catch(() => null) : first;
    if (answer === null) throw new Halt(`GET ${path} did not complete`);
    if (answer.status !== 200) throw new Halt(`GET ${path} answered ${String(answer.status)}`);
    return answer.text();
}

/** A JSON body, or a halt naming the call that answered something else. */
export function parsedOrHalt(text: string, call: string): unknown {
    if (text === "") return null;
    try {
        return JSON.parse(text, exactIntegers) as unknown;
    } catch {
        throw new Halt(`${call} answered a body that is not JSON`);
    }
}

/** Webhook delivery ids exceed 2^53, so an integer a double cannot hold keeps its source text. */
function exactIntegers(_key: string, value: unknown, context?: { source?: string }): unknown {
    return typeof value === "number" && Number.isInteger(value) && !Number.isSafeInteger(value)
        ? context?.source
        : value;
}

/** A field of an untrusted body, or `undefined`; never throws. */
export function field(value: unknown, name: string): unknown {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)[name]
        : undefined;
}

/** An array body, or a halt naming what was read. */
export function listOf(answer: Answer, what: string): readonly unknown[] {
    if (!Array.isArray(answer.body)) throw new Halt(`${what} was not a list`);
    return answer.body;
}

/** The token's person, after proving the sandbox is that person's own private repository. */
export async function sandboxOwner(call: Call, owner: string, repo: string): Promise<string> {
    const login = field((await call("GET", "/user")).body, "login");
    if (login !== owner) {
        throw new Halt(`the sandbox must belong to the token's own account, not ${owner}`);
    }
    const sandbox = await call("GET", `/repos/${owner}/${repo}`);
    if (field(sandbox.body, "private") !== true) throw new Halt("the sandbox must be private");
    return owner;
}

/** What a caught value says, for a person reading the run. */
export function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
