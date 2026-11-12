/**
 * The Action's entry point: the runner's environment in, one decided run and an exit code out.
 * Bundled as `dist/action.js` and run by the runner as `node dist/action.js`; locally, `pnpm --filter … action`.
 */

import { readFileSync } from "node:fs";
import { annotations, appendSummary, renderSummary, rowLines } from "../../observe/summary.js";
import { keepCursor, readCursor } from "./cursor.js";
import { parseActionEnvironment } from "./inputs.js";
import { runAction, runStore } from "./run.js";

const parsed = parseActionEnvironment(process.env);
if (!parsed.ok) {
    for (const refusal of parsed.errors) console.error(refusal);
    process.exit(1);
}
const { run } = parsed;
const cursor = run.sweepCursor === null ? null : readCursor(run.sweepCursor);
// Starting over re-reads items a previous run already decided; trusting a bad cursor could skip some.
if (cursor?.ok === false) console.log(`::warning::${cursor.detail}; the sweep starts over`);
const store = runStore();
try {
    const outcome = await runAction(run, {
        payload: readFileSync(run.eventPath),
        store,
        resumeAfter: cursor?.ok === true ? cursor.resumeAfter : null,
    });
    appendSummary(process.env["GITHUB_STEP_SUMMARY"], renderSummary(store, run, outcome));
    const lines = [...annotations(outcome), ...rowLines(store, run.repository, outcome)];
    for (const line of lines) console.log(line);
    process.exitCode = outcome.exitCode;
    const unkept = run.sweepCursor === null ? null : keepCursor(run.sweepCursor, outcome.events);
    if (unkept !== null) {
        console.log(`::error::${unkept}`);
        process.exitCode = 1;
    }
} finally {
    store.close();
}
