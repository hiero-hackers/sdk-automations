/**
 * The one-shot composition: one GitHub Actions run decides one event or one sweep, then exits.
 * The run is the durable record, so the store lives in memory and is gone at exit; every seam
 * is the hosted shell's, built once for the one repository the runner names.
 */

import { createHash } from "node:crypto";
import { CAPABILITIES } from "@hiero-hackers/automation-capabilities";
import {
    asDeliveryGuid,
    type DeliveryGuid,
    type DestructiveWarning,
    type EngineCapability,
    type ItemRef,
    type PermissionGrant,
    type RepositoryRef,
} from "@hiero-hackers/automation-core";
import { Store } from "../../store/index.js";
import { createApplier, recordedWarningsIn } from "../apply/apply.js";
import { createItemDecider, type DecideItem } from "../decide/item.js";
import { declareSweep } from "../decide/schedule.js";
import { hydrateWarnings } from "../decide/warnings.js";
import type { EffectOutcome } from "../effects.js";
import { createDeliveries } from "../inbound/deliveries.js";
import { contained, createLogger, type Log, type ShellEvent } from "../log.js";
import {
    DEFAULT_SWEEP_CADENCE_MS,
    SNAPSHOT_MAX_AGE_MS,
    SWEEP_WRITE_CALLS,
} from "../sweep/budgets.js";
import { createSweep } from "../sweep/sweep.js";
import { liveGitHub } from "./live.js";
import type { RepositorySeams, ShellOptions } from "./shell.js";

type Environment = Readonly<Partial<Record<string, string>>>;

/** The refusals, word for word: a misconfigured workflow has one reader, whoever wrote it. */
export const ACTION_REFUSAL = {
    repository: "GITHUB_REPOSITORY must be owner/repo; the runner sets it.",
    event: "GITHUB_EVENT_NAME and GITHUB_EVENT_PATH are required; the runner sets both.",
    token: "the token input is required: pass `token: ${{ github.token }}` or leave the default.",
    arm: 'arm-writes must be "true" or "false".',
    run: "GITHUB_RUN_ID is required; the runner sets it.",
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
    /** Whose comments are the run's own: the runner's unless the token belongs to another App. */
    readonly identity: { readonly appId: string; readonly botLogin: string };
    /** One GUID per run attempt, so a re-run is a new delivery and a redelivery is not. */
    readonly deliveryId: DeliveryGuid;
    readonly runUrl: string | null;
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
            identity: { appId, botLogin },
            deliveryId: deliveryIdOf(runId, env["GITHUB_RUN_ATTEMPT"] ?? "1"),
            runUrl:
                server === undefined
                    ? null
                    : `${server}/${repository.owner}/${repository.repo}/actions/runs/${runId}`,
        },
    };
}

/** What one run came to, for the summary and the exit code. */
export interface RunOutcome {
    readonly kind: "delivery" | "sweep" | "idle";
    readonly events: readonly ShellEvent[];
    /** The items decided, in order; the summary explains each from the store. */
    readonly items: readonly ItemRef[];
    /** What became of every effect the run applied, in order. */
    readonly effects: readonly EffectOutcome[];
    /** `active` was decided as `dry-run` because the workflow did not arm writes. */
    readonly modeLowered: boolean;
    readonly exitCode: 0 | 1;
}

export interface RunActionOptions {
    readonly payload: Uint8Array;
    readonly store: Store;
    readonly clock?: () => Date;
    readonly log?: Log;
    readonly capabilities?: readonly EngineCapability[];
}

/** The grants the documented workflow gives; a narrower one surfaces as a refused write. */
export const RUNNER_GRANTS: readonly PermissionGrant[] = [
    "contents:read",
    "issues:write",
    "metadata:read",
    "pull_requests:write",
];

/** GitHub Actions' own App and bot login: what the read-back recognises as this run's writes. */
export const RUNNER_IDENTITY = { appId: "15368", botLogin: "github-actions[bot]" } as const;

/** The runner token outlives any job; a job is six hours at most. */
const TOKEN_LIFETIME_MS = 6 * 60 * 60_000;

/** The lane a run uses takes nearly the whole pool; the other lane never fires in this run. */
const SWEEP_SHARE_ON_SCHEDULE = 0.95;
const SWEEP_SHARE_ON_EVENT = 0.05;

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

export async function runAction(run: ActionRun, options: RunActionOptions): Promise<RunOutcome> {
    const clock = options.clock ?? (() => new Date());
    const events: ShellEvent[] = [];
    const sink = options.log ?? createLogger({ clock });
    const log: Log = contained((event) => {
        events.push(event);
        sink(event);
    });
    const capabilities = options.capabilities ?? CAPABILITIES;
    const { store, payload } = options;
    const worker = `action-${run.deliveryId}`;
    const sweeping = run.eventName === "schedule";
    let modeLowered = false;
    const items: ItemRef[] = [];
    const effects: EffectOutcome[] = [];

    const live = liveGitHub({
        auth: {
            kind: "token",
            token: {
                value: run.token,
                expiresAt: new Date(clock().getTime() + TOKEN_LIFETIME_MS),
                grants: RUNNER_GRANTS,
            },
            identity: run.identity,
        },
        writes: run.armWrites ? { appSlug: run.identity.botLogin.slice(0, -"[bot]".length) } : null,
        killSwitchActive: false,
        clock,
        share: sweeping ? SWEEP_SHARE_ON_SCHEDULE : SWEEP_SHARE_ON_EVENT,
        contentCreationHourly: null,
        knownCapabilities: capabilities.map(({ declaration }) => declaration),
        ownWrites: (served) => (item) => store.ledger.landedOn(served, item),
        log,
    });

    /** The shared box over one seam set, with the arming ceiling and the item list on it. */
    const deciderOver = (seams: RepositorySeams): DecideItem => {
        const applier =
            seams.writePath === null
                ? undefined
                : createApplier({ ledger: store.ledger, ...seams.writePath, worker, clock, log });
        /** The item under decision, so the warning seam below can read its comments. */
        let deciding: { readonly item: ItemRef; readonly revision: string } | null = null;
        const recorded = recordedWarningsIn(store.ledger);
        /** Asked only for a destructive act: the comments are read once, then the store answers. */
        const warningFor = async (effectId: string): Promise<DestructiveWarning | null> => {
            if (deciding !== null && seams.reader !== undefined) {
                const { item, revision } = deciding;
                deciding = null;
                await hydrateWarnings({
                    ledger: store.ledger,
                    reader: seams.reader,
                    repository: run.repository,
                    item,
                    revision,
                });
            }
            return recorded(effectId);
        };
        const decide = createItemDecider({
            store,
            capabilities,
            externals: async (delivery) => ({ ...(await seams.externals(delivery)), warningFor }),
            repository: run.repository,
            clock,
            ...(applier === undefined ? {} : { applier }),
        });
        return async (input, config, at, allowance) => {
            const item = input.kind === "facts" ? input.facts.item : itemNamedBy(payload);
            if (item !== null) items.push(item);
            deciding = item === null ? null : { item, revision: config.revision };
            const lowered = config.mode === "active" && !run.armWrites;
            if (lowered) modeLowered = true;
            const decided = await decide(
                input,
                lowered ? { ...config, mode: "dry-run" } : config,
                at,
                allowance,
            );
            // Stryker disable next-line ConditionalExpression: armed writes wire the path, so an active decision never ends unsupported here.
            if (decided.kind === "decided") effects.push(...decided.outcomes);
            return decided;
        };
    };

    /** Typed as the shell's own seam so the sweep's allowance passes as it does there. */
    const seamsFor: ShellOptions["seams"] = live.seamsFor;
    const laneSeams = seamsFor(run.repository);
    const deliveries = createDeliveries({
        store,
        capabilities,
        lane: () => ({ configSource: laneSeams.configSource, decideItem: deciderOver(laneSeams) }),
        repository: run.repository,
        allowance: live.deliveryAllowance,
        worker,
        clock,
        log,
    });

    if (!sweeping) {
        store.inbox.acceptDelivery({
            deliveryId: run.deliveryId,
            eventName: run.eventName,
            payload,
            receivedAt: clock().toISOString(),
        });
        log({ event: "deliveryAccepted", deliveryId: run.deliveryId, eventName: run.eventName });
        await deliveries.drain();
        // A payload naming another repository completes as a mismatch: the workflow is misplaced.
        const finished = events.some(
            (event) =>
                event.event === "deliveryCompleted" &&
                event.deliveryId === run.deliveryId &&
                event.kind !== "repositoryMismatch",
        );
        return {
            kind: "delivery",
            events,
            items,
            effects,
            modeLowered,
            exitCode: finished ? 0 : 1,
        };
    }

    const config = await deliveries.configuration(run.repository, laneSeams.configSource);
    if (config === null) {
        return { kind: "idle", events, items, effects, modeLowered, exitCode: 0 };
    }
    declareSweep({ store, repository: run.repository, config, capabilities, now: clock() });
    const sweep = createSweep({
        store,
        capabilities,
        processorFor: (repository, allowance) => {
            const seams = seamsFor(repository, allowance);
            return {
                decideItem: deciderOver(seams),
                facts: seams.facts,
                configuration: () => deliveries.configuration(repository, seams.configSource),
            };
        },
        clock,
        cadenceMs: DEFAULT_SWEEP_CADENCE_MS,
        writeCap: SWEEP_WRITE_CALLS,
        allowance: live.sweepAllowance,
        snapshotMaxAgeMs: SNAPSHOT_MAX_AGE_MS,
        log,
    });
    await sweep.runDue();
    const fired = events.some((event) => event.event === "sweepClaimed");
    const failed = events.some((event) => event.event === "sweepFailed");
    return {
        kind: fired ? "sweep" : "idle",
        events,
        items,
        effects,
        modeLowered,
        exitCode: failed ? 1 : 0,
    };
}

/** The in-memory store one run decides through. */
export function runStore(): Store {
    return new Store(":memory:");
}
