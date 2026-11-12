/**
 * What the Action would decide about one item under a local configuration file: the item read
 * as GitHub holds it now, delivered to an unarmed run as its `opened` event. Unarmed is the
 * Action's own `observe`/`dry-run` path, so no write path exists to send anything.
 */

import { CAPABILITIES } from "@hiero-hackers/automation-capabilities";
import {
    revisionOf,
    type ConfigSource,
    type EngineCapability,
    type ItemRef,
    type RepositoryRef,
} from "@hiero-hackers/automation-core";
import type { Store } from "../../../store/index.js";
import { createLogger, type Log } from "../../log.js";
import { deliveryIdOf, RUNNER_IDENTITY, type ActionRun } from "./inputs.js";
import { runAction, runnerGitHub, type RunOutcome } from "./run.js";

/** One item named by its GitHub page. */
export interface SimulatedItem {
    readonly repository: RepositoryRef;
    readonly item: ItemRef;
}

/** `https://github.com/{owner}/{repo}/issues/{n}` or `…/pull/{n}`; anything after the number is ignored. */
export function itemOfUrl(url: string): SimulatedItem | null {
    const page =
        /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/(issues|pull)\/([1-9]\d*)(?:[/?#]|$)/;
    const match = page.exec(url);
    if (match === null) return null;
    const [, owner = "", repo = "", kind, number = ""] = match;
    return {
        repository: { owner, repo },
        item: { kind: kind === "pull" ? "pullRequest" : "issue", number: Number(number) },
    };
}

export interface SimulateOptions {
    readonly store: Store;
    readonly token: string;
    readonly clock?: () => Date;
    readonly log?: Log;
    readonly capabilities?: readonly EngineCapability[];
}

export type SimulateOutcome =
    | { readonly ok: true; readonly run: ActionRun; readonly outcome: RunOutcome }
    | { readonly ok: false; readonly detail: string };

/** The webhook an item's opening would have sent, rebuilt from the item as it is now. */
function openedPayload(target: SimulatedItem, record: Record<string, unknown>): Uint8Array {
    const key = target.item.kind === "pullRequest" ? "pull_request" : "issue";
    const { owner, repo } = target.repository;
    const payload = {
        action: "opened",
        number: target.item.number,
        [key]: record,
        repository: { name: repo, owner: { login: owner } },
        sender: record["user"],
    };
    return Buffer.from(JSON.stringify(payload));
}

/** The configuration under test, in place of the default branch's file. */
function textConfigSource(text: string): ConfigSource {
    return {
        load: () => Promise.resolve({ ok: true, document: { revision: revisionOf(text), text } }),
    };
}

/** An unarmed run for the item's event; never armed, whatever the configuration's mode. */
function simulatedRun(target: SimulatedItem, token: string): ActionRun {
    return {
        repository: target.repository,
        eventName: target.item.kind === "pullRequest" ? "pull_request" : "issues",
        eventPath: "",
        token,
        armWrites: false,
        apiOrigin: null,
        identity: RUNNER_IDENTITY,
        deliveryId: deliveryIdOf("simulate", "1"),
        runUrl: null,
    };
}

export async function simulate(
    target: SimulatedItem,
    configText: string,
    options: SimulateOptions,
): Promise<SimulateOutcome> {
    const clock = options.clock ?? (() => new Date());
    const log = options.log ?? createLogger({ clock });
    const capabilities = options.capabilities ?? CAPABILITIES;
    const run = simulatedRun(target, options.token);
    const github = runnerGitHub(run, { store: options.store, clock, log, capabilities });
    const read = await github.readItem(target.repository, target.item);
    if (!read.ok) return { ok: false, detail: read.detail };
    if (target.item.kind === "issue" && read.value["pull_request"] !== undefined) {
        return {
            ok: false,
            detail: `#${String(target.item.number)} is a pull request: use its /pull/ URL`,
        };
    }
    const outcome = await runAction(run, {
        payload: openedPayload(target, read.value),
        store: options.store,
        clock,
        log,
        capabilities,
        configSource: textConfigSource(configText),
    });
    return { ok: true, run, outcome };
}
