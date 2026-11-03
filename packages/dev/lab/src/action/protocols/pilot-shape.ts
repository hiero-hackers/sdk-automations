/**
 * Protocol 9.9: every capability on, in `active`, under one config. Steps 1 to 4 are triage,
 * claim and release, the dashboard and the report; under `--long` step 5 runs the ladders.
 * The writes on GitHub are then counted against the effects the logs applied.
 */

import {
    fullConfig,
    MAPPED_LABELS,
    NEEDS_REVIEW_LABEL,
    NEEDS_REVISION_LABEL,
    READY_LABEL,
} from "../configs.js";
import { actionEventsSince, duplicateWrites } from "../judge.js";
import type { Subject } from "../provoke.js";
import {
    actionWrites,
    appliedIn,
    BOT,
    botComments,
    issueRef,
    pullRef,
    skipped,
    sweepOnce,
    verdictOf,
    writeCountDifferences,
    type Context,
    type Protocol,
} from "./kit.js";

/** The ladder run: sweeps from the first reminder on, `/working` before the second hour. */
const FIRST_SWEEP_MS = 65 * 60_000;
const SWEEP_EVERY_MS = 15 * 60_000;
const WORKING_AT_MS = 95 * 60_000;
const CEILING_MS = 5 * 60 * 60_000;

interface Run {
    readonly differences: string[];
    readonly notes: string[];
    readonly texts: string[];
    readonly touched: { item: ReturnType<typeof issueRef>; since: string }[];
}

/** A fixture issue opened, written to by the armed run, and the run's log kept. */
async function opened(context: Context, run: Run, name: string) {
    const made = await context.person.open(`lab-${context.tag}-9.9-${name}`);
    const settled = await context.watch.settle(made.since, ["issues"]);
    if ("failed" in settled) {
        run.differences.push(`${name}: ${settled.failed}`);
        return made;
    }
    run.texts.push(...(await context.watch.read(settled.runs)).texts);
    run.touched.push({ item: issueRef(made.number), since: made.since });
    return made;
}

/** A comment as the person, then the runs it raised, settled and kept. */
async function said(context: Context, run: Run, issue: number, body: string): Promise<string> {
    const { since } = await context.person.comment(issue, body);
    const settled = await context.watch.settle(since, ["issue_comment"]);
    if ("failed" in settled) run.differences.push(`${body}: ${settled.failed}`);
    else run.texts.push(...(await context.watch.read(settled.runs)).texts);
    return since;
}

async function triage(context: Context, run: Run): Promise<number> {
    const first = await opened(context, run, "triage");
    const item = issueRef(first.number);
    run.differences.push(
        ...(await actionWrites(context, item, first.since, {
            labeled: 1,
            commented: 1,
            locked: 1,
        })),
    );
    const swap = await context.person.setLabels(first.number, [READY_LABEL]);
    const settled = await context.watch.settle(swap.since, ["issues"], ["cancelled"]);
    if ("failed" in settled) run.differences.push(`the swap: ${settled.failed}`);
    else run.texts.push(...(await context.watch.read(settled.runs)).texts);
    run.differences.push(
        ...(await actionWrites(context, item, swap.since, { unlocked: 1, commented: 1 })),
    );
    return first.number;
}

async function claim(context: Context, run: Run, ready: number): Promise<void> {
    const item = issueRef(ready);
    const assigned = await said(context, run, ready, "/assign");
    run.differences.push(
        ...(await actionWrites(context, item, assigned, { assigned: 1, commented: 1 })),
    );
    // The release notice rewrites the claim notice in place (R2): no new comment appears.
    const released = await said(context, run, ready, "/unassign");
    run.differences.push(...(await actionWrites(context, item, released, { unassigned: 1 })));
    const history = (await botComments(context, ready)).some((comment) =>
        comment.body.includes("unassigned"),
    );
    if (!history) run.differences.push("release: no notice reads as unassigned after /unassign");
    const waiting = await opened(context, run, "awaiting");
    const refused = await said(context, run, waiting.number, "/assign");
    run.differences.push(
        ...(await actionWrites(context, issueRef(waiting.number), refused, { commented: 1 })),
    );
}

async function pullRequests(context: Context, run: Run, ready: number): Promise<number> {
    const { provoker, person, sandbox, watch, tag } = context;
    const subject: Subject = { issue: null, pull: null };
    const name = `lab-${tag}-9.9-dashboard`;
    // Signed off and linked from the start: the open run fails only on the unassigned issue,
    // and the flip to needsReview is reachable once the issue is claimed again.
    const open = await provoker.provoke(
        { kind: "openPull", editsConfig: false, signedOff: true, fixes: ready },
        subject,
        name,
    );
    const settled = await watch.settle(open.since, ["pull_request_target"]);
    if ("failed" in settled) run.differences.push(`the dashboard: ${settled.failed}`);
    else run.texts.push(...(await watch.read(settled.runs)).texts);
    const pull = pullRef(subject.pull ?? 0);
    run.touched.push({ item: pull, since: open.since });
    const dashboard = (await botComments(context, pull.number)).length;
    if (dashboard !== 1)
        run.differences.push(`dashboard: ${String(dashboard)} comments, expected 1`);
    if (!(await person.labelsOf(pull.number)).includes(NEEDS_REVISION_LABEL)) {
        run.differences.push(`dashboard: ${NEEDS_REVISION_LABEL} is absent`);
    }

    const reclaimed = await said(context, run, ready, "/assign");
    run.differences.push(
        ...(await actionWrites(context, issueRef(ready), reclaimed, { assigned: 1 })),
    );

    const branch = `rehearsal/${name}`;
    const file = await sandbox.fileAt(`rehearsal/${name}.md`, branch);
    const email = `${context.owner}@users.noreply.github.com`;
    const pushedAt = new Date().toISOString();
    await sandbox.put(
        `rehearsal/${name}.md`,
        `# ${name}\nsigned off\n`,
        `${name}: close the issue\n\nFixes #${String(ready)}\n\nSigned-off-by: ${context.owner} <${email}>`,
        { branch, ...(file === null ? {} : { sha: file.sha }) },
    );
    const synced = await watch.settle(pushedAt, ["pull_request_target"]);
    if ("failed" in synced) run.differences.push(`the push: ${synced.failed}`);
    else run.texts.push(...(await watch.read(synced.runs)).texts);
    const labels = await person.labelsOf(pull.number);
    if (!labels.includes(NEEDS_REVIEW_LABEL) || labels.includes(NEEDS_REVISION_LABEL)) {
        run.differences.push(
            `dashboard: after the push the labels are ${labels.join(", ") || "none"}`,
        );
    }
    if ((await botComments(context, pull.number)).length !== 1) {
        run.differences.push("dashboard: the comment was not rewritten in place");
    }

    const report: Subject = { issue: null, pull: null };
    const edit = await provoker.provoke(
        { kind: "openPull", editsConfig: true },
        report,
        `lab-${tag}-9.9-report`,
    );
    const reported = await watch.settle(edit.since, ["pull_request_target"]);
    if ("failed" in reported) run.differences.push(`the report: ${reported.failed}`);
    else run.texts.push(...(await watch.read(reported.runs)).texts);
    const second = report.pull ?? 0;
    run.touched.push({ item: pullRef(second), since: edit.since });
    const comments = (await botComments(context, second)).length;
    if (comments !== 2)
        run.differences.push(
            `report: ${String(comments)} comments, expected 2 (dashboard and report)`,
        );
    return pull.number;
}

async function ladders(context: Context, run: Run, issue: number, pull: number): Promise<void> {
    const { person, provoker, tag } = context;
    await person.comment(issue, "/assign");
    const subject: Subject = { issue: null, pull: null };
    const draft = await provoker.provoke(
        { kind: "openPull", editsConfig: false, draft: true },
        subject,
        `lab-${tag}-9.9-draft`,
    );
    const drafted = subject.pull ?? pull;
    run.touched.push({ item: pullRef(drafted), since: draft.since });
    const start = Date.now();
    let working = false;
    for (let at = FIRST_SWEEP_MS; at <= CEILING_MS; at += SWEEP_EVERY_MS) {
        await context.sleep(Math.max(0, start + at - Date.now()));
        if (!working && at >= WORKING_AT_MS) {
            await person.comment(issue, "/working");
            working = true;
        }
        run.texts.push(await sweepOnce(context, `-ladder${String(at / 60_000)}`));
        if ((await person.stateOf("pulls", drafted)) === "closed") break;
    }
    const events = actionEventsSince(await context.watch.timeline(pullRef(drafted)), draft.since);
    const closedAt = events.find((event) => event.event === "closed")?.at ?? null;
    const warned = (await botComments(context, drafted)).filter(
        (comment) => closedAt === null || comment.createdAt < closedAt,
    );
    if (closedAt === null) run.differences.push("ladders: the draft was not closed");
    if (warned.length === 0) run.differences.push("ladders: no warning before the close");
    const released = actionEventsSince(await context.watch.timeline(issueRef(issue)), draft.since);
    if (released.some((event) => event.event === "unassigned")) {
        run.differences.push("ladders: the issue was released despite /working");
    }
    if ((await botComments(context, issue)).length === 0)
        run.differences.push("ladders: no reminder on the issue");
}

export const pilotShape: Protocol = {
    id: "9.9",
    slug: "the-pilot-shape",
    writes: true,
    long: false,
    async run(context) {
        const { sandbox, tag } = context;
        if (!context.human) return skipped("claim and release need a person's token");
        const run: Run = { differences: [], notes: [], texts: [], touched: [] };
        for (const label of MAPPED_LABELS) await sandbox.ensureLabel(label);
        await sandbox.arm(fullConfig(), `lab ${tag}: 9.9 armed`);

        const ready = await triage(context, run);
        await claim(context, run, ready);
        const pull = await pullRequests(context, run, ready);
        if (context.long) await ladders(context, run, ready, pull);

        let written = 0;
        for (const { item, since } of run.touched) {
            const events = actionEventsSince(await context.watch.timeline(item), since);
            written += events.length;
            const doubled = duplicateWrites(
                events.filter((event) => (event.label ?? null) !== null),
            );
            run.differences.push(
                ...doubled.map(
                    (line) => `${item.kind}#${String(item.number)}: written twice: ${line}`,
                ),
            );
        }
        const applied = appliedIn(run.texts);
        if (written > applied) run.differences.push(...writeCountDifferences(applied, written));
        run.notes.push(
            `${String(written)} writes by ${BOT} on GitHub, ${String(applied)} applied in the logs`,
        );
        return verdictOf(run.differences, run.notes);
    },
};
