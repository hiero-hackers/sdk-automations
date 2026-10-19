/**
 * Protocol 9.10: one armed, active file where one capability inherits `active` and its sibling's
 * block states `dry-run`: one pull request, one applied effect, one rehearsal, one write on GitHub.
 */

import { heldConfig } from "../configs.js";
import type { Subject } from "../provoke.js";
import { effectLinesIn } from "../runs.js";
import {
    actionWrites,
    botComments,
    codesOf,
    pullRef,
    verdictOf,
    type Context,
    type Protocol,
} from "./kit.js";

export const capabilityMode: Protocol = {
    id: "9.10",
    slug: "a-mode-per-capability",
    writes: true,
    long: false,
    async run(context: Context) {
        const { sandbox, provoker, watch, tag } = context;
        const differences: string[] = [];
        await sandbox.prepare();
        await sandbox.arm(heldConfig(), `lab ${tag}: 9.10 armed, configReport held at dry-run`);

        // The pull request edits the config, so both capabilities act on the one event.
        const subject: Subject = { issue: null, pull: null };
        const opened = await provoker.provoke(
            { kind: "openPull", editsConfig: true },
            subject,
            `lab-${tag}-9.10-held`,
        );
        const settled = await watch.settle(opened.since, ["pull_request_target"]);
        if ("failed" in settled) return verdictOf([`the pull request: ${settled.failed}`]);
        const read = await watch.read(settled.runs);
        const pull = pullRef(subject.pull ?? 0);

        const applied = read.texts
            .flatMap((text) => effectLinesIn(text))
            .filter((line) => line.outcome === "applied")
            .map((line) => line.capability);
        if (applied.join(", ") !== "prDashboard") {
            differences.push(`applied: ${applied.join(", ") || "none"}, expected prDashboard`);
        }
        const rehearsed = read.rows
            .filter((row) => row.code === "wouldApply")
            .map((row) => row.capability);
        if (rehearsed.join(", ") !== "configReport") {
            differences.push(
                `wouldApply: ${rehearsed.join(", ") || "none"}, expected configReport`,
            );
        }
        differences.push(...(await actionWrites(context, pull, opened.since, { commented: 1 })));
        const comments = (await botComments(context, pull.number)).length;
        if (comments !== 1) differences.push(`${String(comments)} App comments, expected 1`);
        return verdictOf(differences, [`pull request: ${codesOf(read.rows).join("; ")}`]);
    },
};
