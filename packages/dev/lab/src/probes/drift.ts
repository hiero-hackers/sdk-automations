/**
 * The probe's comparisons: what a live response has to show against a recorded shape.
 * Pure, so a test can hold them.
 */

import { permissionAccepted } from "./compare.js";
import type { Pagination, Shape } from "./reads.js";

export interface Sent {
    readonly status: number;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
}

/** GitHub's body, or `null` when what came back was not JSON. */
export function parsed(body: string): unknown {
    try {
        return JSON.parse(body) as unknown;
    } catch {
        return null;
    }
}

export function objectOf(held: unknown): Readonly<Record<string, unknown>> | null {
    return typeof held === "object" && held !== null && !Array.isArray(held)
        ? (held as Record<string, unknown>)
        : null;
}

/** Does this path resolve anywhere in the body? An empty array resolves every path under it. */
export function resolves(held: unknown, segments: readonly string[]): boolean {
    const [head, ...rest] = segments;
    if (head === undefined) return true;
    if (head === "[]") {
        if (!Array.isArray(held)) return false;
        return held.length === 0 || held.some((entry) => resolves(entry, rest));
    }
    const inner = objectOf(held);
    return inner !== null && Object.hasOwn(inner, head) && resolves(inner[head], rest);
}

export function segmentsOf(path: string): readonly string[] {
    return path
        .replace(/\[\]/g, ".[].")
        .split(".")
        .filter((segment) => segment !== "");
}

/** The recorded fields the body does not carry; a `?` path is recorded and never drift. */
export function missingFields(body: string, fields: readonly string[]): readonly string[] {
    const held = parsed(body);
    const root = Array.isArray(held) ? ["[]"] : [];
    return fields
        .filter((path) => !path.endsWith("?"))
        .filter((path) => !resolves(held, [...root, ...segmentsOf(path)]));
}

export const advertises = (link: string | undefined, rel: string): boolean =>
    link !== undefined && link.includes(`rel="${rel}"`);

/** A link header that contradicts the recorded advertisement, as one drift line. */
export function paginationDrift(recorded: Pagination, link: string | undefined): string | null {
    const next = advertises(link, "next");
    const last = advertises(link, "last");
    if (recorded === "next-only" && last) return "pagination: next-only → last-named";
    if (recorded === "last-named" && next && !last) return "pagination: last-named → next-only";
    return null;
}

/** A fixture that no longer answers in one page is unreadable, not drifted. */
export function outgrewOnePage(recorded: Pagination, link: string | undefined): boolean {
    return recorded === "none" && (advertises(link, "next") || advertises(link, "last"));
}

/** A failure of GitHub's rather than a change of GitHub's. */
export function weather(status: number): boolean {
    return status >= 500 || status === 429;
}

export const drifted = (property: string, recorded: string, seen: string): string =>
    `${property}: ${recorded} → ${seen}`;

/** Every property of the record the response contradicts, one line each. */
export function driftOf(shape: Shape, sent: Sent): readonly string[] {
    const lines: string[] = [];
    if (sent.status !== shape.status) {
        lines.push(drifted("status", String(shape.status), String(sent.status)));
    }
    const accepted = sent.headers["x-accepted-github-permissions"];
    if (accepted !== undefined && !permissionAccepted(shape.permission, accepted)) {
        lines.push(drifted("permission", shape.permission, accepted));
    }
    for (const name of shape.headers) {
        if (sent.headers[name] === undefined) lines.push(drifted("headers", name, "absent"));
    }
    const pagination = paginationDrift(shape.pagination, sent.headers["link"]);
    if (pagination !== null) lines.push(pagination);
    for (const field of missingFields(sent.body, shape.fields)) {
        lines.push(drifted("fields", field, "absent"));
    }
    return lines;
}
