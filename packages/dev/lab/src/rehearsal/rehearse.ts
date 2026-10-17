/**
 * One scenario, acted and judged: each step is a person's change, then a wait until every
 * delivery GitHub sent is decided, then GitHub and the store read back against the step.
 * `run.ts` owns the order around it; `judge.ts` owns the verdicts.
 */

import type { EvidenceLog } from "../evidence.js";
import { field, Halt, listOf, type Call } from "../github.js";
import {
    decisionDifferences,
    issueDifferences,
    settlementOf,
    tickedRows,
    type HookDelivery,
    type IssueState,
} from "./judge.js";
import type { Sandbox } from "./sandbox.js";
import { TEMPLATE_FILE } from "./sandbox.js";
import { LABELS, type Action, type Expected, type Scenario } from "./scenarios.js";
import type { Shell } from "./shell.js";

// ─── Bounds ──────────────────────────────────────────────────────────

const POLL_MS = 2_000;

/** Long enough for the echo of the App's own writes to arrive after their cause is done. */
const QUIET_MS = 10_000;

const SETTLE_DEADLINE_MS = 180_000;

/** How long a person has to submit the template form. */
const TEMPLATE_DEADLINE_MS = 15 * 60_000;

const PAGE = 100;

// ─── The seam ────────────────────────────────────────────────────────

export interface RehearsalOptions {
    readonly call: Call;
    readonly shell: Shell;
    readonly sandbox: Sandbox;
    readonly log: EvidenceLog;
    readonly sleep: (ms: number) => Promise<void>;
    readonly owner: string;
    readonly repo: string;
    readonly login: string;
    readonly appLogin: string;
    readonly hookId: number;
    readonly runId: string;
}

export interface ScenarioResult {
    readonly name: string;
    readonly passed: boolean;
    readonly differences: readonly string[];
}

export interface Rehearsal {
    /** Waits for the webhook's ping to be accepted and stored: the route works end to end. */
    pinged(): Promise<void>;
    rehearse(scenario: Scenario): Promise<ScenarioResult>;
}

/** The issue a scenario acts on, and the `opened` delivery a redelivery repeats. */
interface Subject {
    issue: number | null;
    openedDelivery: string | null;
}

export function createRehearsal(options: RehearsalOptions): Rehearsal {
    const { call, shell, sandbox, log, sleep, owner, repo, login, appLogin, hookId, runId } =
        options;
    const repository = `/repos/${owner}/${repo}`;
    const seenAttempts = new Set<string>();
    const decidedGuids = new Set<string>();

    const hookDeliveries = async (): Promise<HookDelivery[]> => {
        const path = `${repository}/hooks/${String(hookId)}/deliveries?per_page=${String(PAGE)}`;
        const listed = listOf(await call("GET", path), "the webhook's deliveries");
        if (listed.length >= PAGE) throw new Halt("the webhook has a page of deliveries or more");
        return listed.map((entry) => ({
            id: String(field(entry, "id")),
            guid: String(field(entry, "guid")),
            event: String(field(entry, "event")),
            action:
                typeof field(entry, "action") === "string" ? String(field(entry, "action")) : null,
            statusCode: Number(field(entry, "status_code")),
        }));
    };

    /** The attempts past `before`, once the hook's log and the store agree and stay quiet. */
    const settle = async (before: number): Promise<HookDelivery[]> => {
        let quietSince: number | null = null;
        let quietCount = -1;
        for (const deadline = Date.now() + SETTLE_DEADLINE_MS; Date.now() < deadline;) {
            const hook = await hookDeliveries();
            const settlement = settlementOf(hook, shell.deliveries(), before);
            if (settlement.kind === "failed") throw new Halt(settlement.reason);
            if (settlement.kind === "waiting") {
                quietSince = null;
            } else if (quietSince === null || hook.length !== quietCount) {
                quietSince = Date.now();
                quietCount = hook.length;
            } else if (Date.now() - quietSince >= QUIET_MS) {
                const fresh = hook.filter((attempt) => !seenAttempts.has(attempt.id));
                for (const attempt of fresh) seenAttempts.add(attempt.id);
                return fresh;
            }
            await sleep(POLL_MS);
        }
        throw new Halt(`deliveries did not settle within ${String(SETTLE_DEADLINE_MS)} ms`);
    };

    const observe = async (issue: number): Promise<IssueState> => {
        const path = `${repository}/issues/${String(issue)}`;
        const read = await call("GET", path);
        const labels = (field(read.body, "labels") as unknown[] | undefined) ?? [];
        const comments = listOf(
            await call("GET", `${path}/comments?per_page=${String(PAGE)}`),
            "comments",
        );
        const events = listOf(
            await call("GET", `${path}/events?per_page=${String(PAGE)}`),
            "events",
        );
        const byApp = (entry: unknown, key: string): boolean =>
            field(field(entry, key), "login") === appLogin;
        const appComments = comments.filter((comment) => byApp(comment, "user"));
        return {
            labels: labels.map((label) => String(field(label, "name"))),
            locked: field(read.body, "locked") === true,
            appComments: appComments.length,
            ticked: appComments
                .map((comment) => tickedRows(String(field(comment, "body") ?? "")))
                .reduce((total, rows) => total + rows, 0),
            appLabelWrites: events.filter(
                (event) => field(event, "event") === "labeled" && byApp(event, "actor"),
            ).length,
        };
    };

    const label = (
        subject: Subject,
        meaning: keyof typeof LABELS,
        add: boolean,
    ): Promise<unknown> => {
        const path = `${repository}/issues/${String(issueOf(subject))}/labels`;
        return add
            ? call("POST", path, { body: { labels: [LABELS[meaning]] } })
            : call("DELETE", `${path}/${encodeURIComponent(LABELS[meaning])}`);
    };

    const openFromTemplate = async (title: string): Promise<number> => {
        const form = `https://github.com/${owner}/${repo}/issues/new?template=${TEMPLATE_FILE}`;
        console.log(
            `\n  submit the form, title unchanged: ${form}&title=${encodeURIComponent(title)}`,
        );
        const path = `${repository}/issues?state=open&creator=${login}&per_page=20`;
        for (const deadline = Date.now() + TEMPLATE_DEADLINE_MS; Date.now() < deadline;) {
            const found = listOf(await call("GET", path), "open issues").find(
                (issue) => field(issue, "title") === title,
            );
            if (found !== undefined) return Number(field(found, "number"));
            await sleep(POLL_MS);
        }
        throw new Halt("no issue was opened from the template in time");
    };

    const act = async (action: Action, subject: Subject, title: string): Promise<void> => {
        switch (action.kind) {
            case "open": {
                const created = await call("POST", `${repository}/issues`, {
                    body: {
                        title,
                        body: "Temporary fixture for the triage rehearsal.",
                        labels: action.labels.map((meaning) => LABELS[meaning]),
                    },
                    accept: [201],
                });
                subject.issue = Number(field(created.body, "number"));
                break;
            }
            case "openFromTemplate":
                subject.issue = await openFromTemplate(title);
                break;
            case "add":
            case "remove":
                await label(subject, action.meaning, action.kind === "add");
                break;
            case "redeliverOpened": {
                if (subject.openedDelivery === null) throw new Halt("no opened delivery to repeat");
                const path = `${repository}/hooks/${String(hookId)}/deliveries/${subject.openedDelivery}/attempts`;
                await call("POST", path, { accept: [202] });
                break;
            }
            case "releaseAtOnce":
                await Promise.all([label(subject, "ready", true), label(subject, "triage", false)]);
                break;
        }
        if (subject.issue !== null) sandbox.adopt(subject.issue);
    };

    /** The step's differences from what it expected, the issue and its decisions together. */
    const judged = async (subject: Subject, expected: Expected, fresh: readonly HookDelivery[]) => {
        const issue = issueOf(subject);
        const want: IssueState = {
            ...expected,
            labels: expected.labels.map((meaning) => LABELS[meaning]),
        };
        const observed = await observe(issue);
        // A redelivery repeats a guid already judged; its decisions belong to that earlier step.
        const guids = new Set(
            fresh.map((attempt) => attempt.guid).filter((guid) => !decidedGuids.has(guid)),
        );
        for (const guid of guids) decidedGuids.add(guid);
        const decisions = shell.decisionsAbout(issue).filter((row) => guids.has(row.sourceId));
        const differences = [
            ...issueDifferences(want, observed),
            ...decisionDifferences(decisions, expected.refusals ?? []),
        ];
        return { observed, decisions, differences };
    };

    return {
        async pinged() {
            const fresh = await settle(0);
            if (!fresh.some((delivery) => delivery.event === "ping")) {
                throw new Halt("the webhook's ping was not among its first deliveries");
            }
            log.record("ping", { deliveries: fresh });
        },

        async rehearse(scenario) {
            const subject: Subject = { issue: null, openedDelivery: null };
            const title = `rehearsal ${runId} ${scenario.name}`;
            for (const [index, step] of scenario.steps.entries()) {
                const before = (await hookDeliveries()).length;
                await act(step.action, subject, title);
                const fresh = await settle(before);
                subject.openedDelivery ??=
                    fresh.find((delivery) => delivery.action === "opened")?.id ?? null;
                const { observed, decisions, differences } = await judged(
                    subject,
                    step.expected,
                    fresh,
                );
                log.record("step", {
                    scenario: scenario.name,
                    step: index + 1,
                    action: step.action,
                    issue: subject.issue,
                    deliveries: fresh,
                    decisions,
                    observed,
                    differences,
                });
                if (differences.length > 0) {
                    const where = `step ${String(index + 1)} (${step.action.kind})`;
                    return {
                        name: scenario.name,
                        passed: false,
                        differences: differences.map((d) => `${where}: ${d}`),
                    };
                }
            }
            return { name: scenario.name, passed: true, differences: [] };
        },
    };
}

function issueOf(subject: Subject): number {
    if (subject.issue === null) throw new Halt("a step acted before its issue was opened");
    return subject.issue;
}
