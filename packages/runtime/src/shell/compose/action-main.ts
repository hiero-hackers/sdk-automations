/**
 * The Action's entry point: the runner's environment in, one decided run and an exit code out.
 * Run by the runner as `node dist/action.js`; locally, `pnpm --filter … action`.
 */

import { readFileSync } from "node:fs";
import { annotations, appendSummary, renderSummary, rowLines } from "../observe/summary.js";
import { parseActionEnvironment, runAction, runStore } from "./action.js";

const parsed = parseActionEnvironment(process.env);
if (!parsed.ok) {
    for (const refusal of parsed.errors) console.error(refusal);
    process.exit(1);
}
const { run } = parsed;
const store = runStore();
try {
    const outcome = await runAction(run, { payload: readFileSync(run.eventPath), store });
    appendSummary(process.env["GITHUB_STEP_SUMMARY"], renderSummary(store, run, outcome));
    const lines = [...annotations(outcome), ...rowLines(store, run.repository, outcome)];
    for (const line of lines) console.log(line);
    process.exitCode = outcome.exitCode;
} finally {
    store.close();
}
