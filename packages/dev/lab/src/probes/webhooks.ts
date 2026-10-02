/**
 * The events pass: provoke each captured webhook on the sandbox, read its delivery back off
 * the App's delivery log, and hold the payload to the paths the normalizer reads.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { scrubPayload } from "../scrub.js";
import { missingFields, objectOf, parsed, type Sent } from "./drift.js";
import { EVENT_SHAPES, type EventShape, type Provocation } from "./events.js";

export interface WebhookResult {
    readonly name: string;
    readonly ok: boolean;
    readonly drift?: readonly string[];
    readonly unreadable?: string;
}

export type Outcome =
    { readonly ok: true; readonly sent: Sent } | { readonly ok: false; readonly detail: string };

/** One paced request against the API origin, as the installation or as the App. */
export type Requester = (
    step: string,
    path: string,
    method: "GET" | "POST" | "PATCH",
    body?: string,
) => Promise<Outcome>;

export interface WebhookProbe {
    readonly owner: string;
    readonly repo: string;
    /** The standing pull request the two pull-request shapes close and reopen. */
    readonly eventsPullRequest: number | null;
    readonly asInstallation: Requester;
    readonly asApp: Requester;
    readonly wait: (ms: number) => Promise<void>;
    readonly pendingDir?: string;
}

/** One delivery as the App's log lists it; the id outgrows a double, so it stays text. */
export interface Delivery {
    readonly id: string;
    readonly event: string;
    readonly action: string | null;
    readonly deliveredAt: string;
}

type Provoked = { readonly number: number } | { readonly unreadable: string };

type Acted =
    | { readonly ok: true; readonly number: number }
    | { readonly ok: false; readonly detail: string };

const LABEL = "conformance-probe";
const SETTLE_MS = 5_000;
const LIST_ATTEMPTS = 12;
const PENDING_DIR = fileURLToPath(new URL("../../evidence/pending/", import.meta.url));

/** The log's rows as deliveries; a row missing any field is dropped. */
export function deliveriesOf(body: string): Delivery[] {
    const held = parsed(body.replace(/"id":\s*(\d+)/g, '"id":"$1"'));
    if (!Array.isArray(held)) return [];
    return held.flatMap((row: unknown) => {
        const record = objectOf(row);
        const id = record?.["id"];
        const event = record?.["event"];
        const action = record?.["action"] ?? null;
        const deliveredAt = record?.["delivered_at"];
        return typeof id === "string" &&
            typeof event === "string" &&
            (action === null || typeof action === "string") &&
            typeof deliveredAt === "string"
            ? [{ id, event, action, deliveredAt }]
            : [];
    });
}

/** Listed under the shape's event and action, and delivered after the run began. */
export function matches(delivery: Delivery, shape: EventShape, since: string): boolean {
    return (
        delivery.event === shape.event &&
        delivery.action === shape.action &&
        delivery.deliveredAt >= since
    );
}

/** The item number the payload is about, read where the shape's event keeps it. */
export function itemNumberOf(shape: EventShape, payload: unknown): number | null {
    const item = objectOf(
        objectOf(payload)?.[shape.event === "pull_request" ? "pull_request" : "issue"],
    );
    const number = item?.["number"];
    return typeof number === "number" ? number : null;
}

/** Every path the normalizer reads that the payload lacks, plus an action that disagrees. */
export function fieldDrift(shape: EventShape, payload: unknown): string[] {
    const action = objectOf(payload)?.["action"];
    return [
        ...(action === shape.action ? [] : [`action: ${shape.action} → ${String(action)}`]),
        ...missingFields(JSON.stringify(payload), shape.fields).map(
            (path) => `field ${path}: missing`,
        ),
    ];
}

const accepted = (outcome: Outcome, number: number): Acted =>
    !outcome.ok
        ? { ok: false, detail: outcome.detail }
        : outcome.sent.status >= 200 && outcome.sent.status < 300
          ? { ok: true, number }
          : { ok: false, detail: `GitHub answered ${String(outcome.sent.status)}` };

/** One sandbox action, as the installation; the issue flow carries the number it opened. */
async function provoke(
    what: Provocation,
    probe: WebhookProbe,
    since: string,
    issue: number | null,
): Promise<Acted> {
    const base = `/repos/${encodeURIComponent(probe.owner)}/${encodeURIComponent(probe.repo)}`;
    const json = JSON.stringify;
    if (what === "openIssue") {
        const sent = await probe.asInstallation(
            "webhook-open-issue",
            `${base}/issues`,
            "POST",
            json({
                title: `conformance probe ${since}`,
                body: "Opened and closed by the conformance probe (protocol 7.2).",
            }),
        );
        const number = sent.ok ? objectOf(parsed(sent.sent.body))?.["number"] : undefined;
        return typeof number === "number"
            ? accepted(sent, number)
            : { ok: false, detail: "GitHub opened no issue" };
    }
    if (what === "closePullRequest" || what === "reopenPullRequest") {
        const pull = probe.eventsPullRequest;
        if (pull === null) return { ok: false, detail: "SANDBOX_EVENTS_PR pins no pull request" };
        const state = what === "closePullRequest" ? "closed" : "open";
        return accepted(
            await probe.asInstallation(
                `webhook-${what}`,
                `${base}/pulls/${String(pull)}`,
                "PATCH",
                json({ state }),
            ),
            pull,
        );
    }
    if (issue === null) return { ok: false, detail: "no issue was opened to act on" };
    const item = `${base}/issues/${String(issue)}`;
    if (what === "labelIssue") {
        await probe.asInstallation(
            "webhook-define-label",
            `${base}/labels`,
            "POST",
            json({ name: LABEL, color: "ededed" }),
        );
        return accepted(
            await probe.asInstallation(
                "webhook-label-issue",
                `${item}/labels`,
                "POST",
                json({ labels: [LABEL] }),
            ),
            issue,
        );
    }
    if (what === "commentOnIssue") {
        return accepted(
            await probe.asInstallation(
                "webhook-comment",
                `${item}/comments`,
                "POST",
                json({ body: "Conformance probe comment." }),
            ),
            issue,
        );
    }
    return accepted(
        await probe.asInstallation("webhook-close-issue", item, "PATCH", json({ state: "closed" })),
        issue,
    );
}

/** The payload a listed delivery carried, read by id as the App. */
async function payloadOf(probe: WebhookProbe, delivery: Delivery): Promise<unknown> {
    const sent = await probe.asApp(
        `webhook-delivery-${delivery.id}`,
        `/app/hook/deliveries/${delivery.id}`,
        "GET",
    );
    return sent.ok
        ? objectOf(objectOf(parsed(sent.sent.body))?.["request"])?.["payload"]
        : undefined;
}

/** Poll the App's log until every provoked shape has its delivery, or the attempts run out. */
async function collect(
    probe: WebhookProbe,
    since: string,
    provoked: ReadonlyMap<string, Provoked>,
): Promise<Map<string, unknown>> {
    const found = new Map<string, unknown>();
    const fetched = new Set<string>();
    const wanted = EVENT_SHAPES.filter((shape) => "number" in (provoked.get(shape.name) ?? {}));
    for (let attempt = 0; attempt < LIST_ATTEMPTS && found.size < wanted.length; attempt += 1) {
        if (attempt > 0) await probe.wait(SETTLE_MS);
        const listed = await probe.asApp(
            "webhook-deliveries",
            "/app/hook/deliveries?per_page=100",
            "GET",
        );
        if (!listed.ok) continue;
        for (const shape of wanted) {
            if (found.has(shape.name)) continue;
            const number = (provoked.get(shape.name) as { number: number }).number;
            for (const delivery of deliveriesOf(listed.sent.body)) {
                if (!matches(delivery, shape, since) || fetched.has(delivery.id)) continue;
                fetched.add(delivery.id);
                const payload = await payloadOf(probe, delivery);
                if (itemNumberOf(shape, payload) === number) {
                    found.set(shape.name, payload);
                    break;
                }
            }
        }
    }
    return found;
}

function keep(dir: string, shape: EventShape, payload: unknown): void {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
        join(dir, `${shape.event}.${shape.action}.json`),
        `${JSON.stringify(scrubPayload(payload), null, 4)}\n`,
    );
}

function judge(
    shape: EventShape,
    provoked: Provoked,
    payload: unknown,
    dir: string,
): WebhookResult {
    if ("unreadable" in provoked)
        return { name: shape.name, ok: false, unreadable: provoked.unreadable };
    if (payload === undefined) {
        return {
            name: shape.name,
            ok: false,
            unreadable: `no ${shape.event}.${shape.action} delivery for #${String(provoked.number)} reached the App's log`,
        };
    }
    keep(dir, shape, payload);
    const drift = fieldDrift(shape, payload);
    return drift.length === 0
        ? { name: shape.name, ok: true }
        : { name: shape.name, ok: false, drift };
}

/** Every shape provoked in order, every delivery read back, every payload judged and kept for review. */
export async function probeWebhooks(probe: WebhookProbe): Promise<WebhookResult[]> {
    const since = new Date().toISOString();
    const provoked = new Map<string, Provoked>();
    let issue: number | null = null;
    for (const shape of EVENT_SHAPES) {
        const acted = await provoke(shape.provoke, probe, since, issue);
        if (acted.ok && shape.provoke === "openIssue") issue = acted.number;
        provoked.set(
            shape.name,
            acted.ok ? { number: acted.number } : { unreadable: acted.detail },
        );
    }
    await probe.wait(SETTLE_MS);
    const found = await collect(probe, since, provoked);
    const dir = probe.pendingDir ?? PENDING_DIR;
    return EVENT_SHAPES.map((shape) =>
        judge(shape, provoked.get(shape.name)!, found.get(shape.name), dir),
    );
}
