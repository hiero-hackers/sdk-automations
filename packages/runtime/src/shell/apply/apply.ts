/**
 * How one approved effect becomes a landed GitHub change, exactly once — stage C.
 * The lease around one effect, the loop that walks its plan, and the sweep's
 * recovery of one open send. `actions.ts` says what the loop does next,
 * `gates.ts` whether it still may, and `call.ts` sends and proves one call.
 */

import type { AnyIntent, Effect, RepositoryConfig } from "@hiero-hackers/automation-core";
import type { Fact, Ledger, OpenSend } from "../../store/index.js";
import type { Log } from "../log.js";
import type { Allowance, Lane } from "../allowance.js";
import { actionFor, type Action, type Pass, type PassResult } from "./actions.js";
import type { Call, EffectOutcome } from "../effects.js";
import type { EffectReader, EffectWriter } from "./operations/handler.js";
import { operationOf, parseJournaledCall, planFor } from "./operations/index.js";
import { createCalls, stop, type CallResult } from "./call.js";
import { createGates, type EffectExternalsSource } from "./gates.js";

/** The seam vocabulary, re-exported from its new home to keep the barrel's name set. */
export type {
    CommentSeen,
    EffectReader,
    EffectWriter,
    ItemSeen,
    ReadAnswer,
    SeenState,
    WriteResult,
} from "./operations/handler.js";
export { recordedWarningsIn, type EffectExternalsSource } from "./gates.js";

// ─── The chosen bounds ───────────────────────────────────────────────

/**
 * How long an effect lease is honoured before a later worker may take it over.
 * Not a proof GitHub stopped processing a timed-out request; live takeover stays open (D41).
 */
export const EFFECT_LEASE_STALE_MINUTES = 10;

/**
 * How many times one call may be declared before recovery gives up on it.
 * The ledger counts its sends durably, so this bounds the effect, not a process (D161).
 */
export const EFFECT_ATTEMPT_CAP = 5;

// ─── The seams ───────────────────────────────────────────────────────

export interface ApplierOptions {
    /** The whole store the applier touches: the facts, and the lease beside them (D164). */
    readonly ledger: Ledger;
    readonly writer: EffectWriter;
    readonly reader: EffectReader;
    readonly externals: EffectExternalsSource;
    /** Which worker holds a lease; the ledger releases only this name's own. */
    readonly worker: string;
    readonly clock: () => Date;
    /** Recovery has no delivery to report into, so its lines leave here. */
    readonly log: Log;
}

/** The write path, as the one box both lanes call uses it. */
export interface Applier {
    /**
     * Every approved effect of one decision, in order, each under its own lease.
     * Every call that reaches GitHub is charged to `allowance`, retries included; a local refusal is charged nothing. A webhook passes none (D192).
     */
    applyAll(
        effects: readonly Effect[],
        config: RepositoryConfig,
        allowance?: Allowance,
    ): Promise<readonly EffectOutcome[]>;
    /** One open send, resolved against GitHub — the sweep's unit of work. */
    recover(open: OpenSend, config: RepositoryConfig): Promise<void>;
}

/** An effect a spent lane holds back: nothing claimed, nothing recorded, decided again next firing. */
const heldBack = ({ intent }: Effect, lane: Lane): EffectOutcome => ({
    effectId: intent.idempotencyKey,
    capability: intent.capability,
    operation: intent.operation,
    item: intent.item,
    outcome: "refused",
    code: lane === "mutations" ? "sweepWriteCap" : "sweepRequestCap",
    detail:
        lane === "mutations"
            ? "this firing's write cap is spent; decided again next sweep"
            : `this window's ${lane} allowance is spent; decided again next sweep`,
});

export function createApplier(options: ApplierOptions): Applier {
    const { ledger, writer, reader, externals, worker, clock, log } = options;

    const now = (): string => clock().toISOString();
    const gates = createGates({ ledger, reader, externals, clock });
    const calls = createCalls({ ledger, writer, reader, clock });

    /** Take the lease, or learn that a live worker holds it. */
    const claim = (effectId: string): boolean => {
        const at = clock();
        return ledger.claim(
            effectId,
            worker,
            at.toISOString(),
            new Date(at.getTime() - EFFECT_LEASE_STALE_MINUTES * 60_000).toISOString(),
        );
    };

    /** The newest send of an effect — the identity and revision a closing fact repeats. */
    const sendOf = (effectId: string): Fact => {
        const sends = ledger.factsOf(effectId).filter((fact) => fact.kind === "sent");
        return sends[sends.length - 1]!;
    };

    /** Is the effect still being applied under the configuration it started under? */
    const underSameRevision = (pass: Pass): boolean =>
        sendOf(pass.effectId).revision === pass.config.revision;

    /** One call of the plan, with whatever it changed carried into the pass. */
    const sendAt = async (pass: Pass, seq: number, plan: readonly Call[]): Promise<CallResult> => {
        const step = await calls.sendCall(pass, seq, plan[seq - 1]!);
        if (step.kind === "done") pass.changed ||= step.changed;
        return step;
    };

    /**
     * One open send, resolved — the whole of `SENT-UNKNOWN`.
     * Only the resend branch meets a gate, because by then nothing has landed, so a world that now says no settles the effect. Whatever it takes, the open send is what this pass changed.
     */
    const resolveOne = async (
        pass: Pass,
        seq: number,
        call: Call,
        revision: string,
    ): Promise<CallResult> => {
        const back = await calls.readBack(pass, seq, call);
        if (back === "landed") {
            pass.changed = true;
            return { kind: "done", changed: true };
        }
        if (back === "unknown") {
            return stop(
                "unknown",
                "writeUnknown",
                "the read-back could not establish whether this call landed",
            );
        }
        if (revision !== pass.config.revision) {
            return calls.refuseCall(
                pass,
                seq,
                call,
                "configurationChanged",
                "the configuration changed after this call was recorded; nothing was resent",
            );
        }
        const gate = await gates.resume(pass, operationOf(call));
        if (!gate.ok) {
            if (gate.result.outcome === "refused") {
                calls.appendFact(pass, "refused", seq, call, gate.result);
            }
            return { kind: "stop", result: gate.result };
        }
        const step = await calls.sendCall(pass, seq, call);
        if (step.kind === "done") pass.changed = true;
        return step;
    };

    /** The open send the fold named, from the bytes the ledger kept of it. */
    const resolve = async (
        pass: Pass,
        seq: number,
        payload: string | null,
    ): Promise<CallResult> => {
        // Nothing can be resent from bytes nobody can read, and leaving the send open
        // would hand the sweep the same dead end forever.

        const journaled = payload === null ? null : parseJournaledCall(payload);
        if (journaled === null) {
            const detail =
                "the ledger's bytes for this call could not be read; it is closed and nothing was resent";
            calls.appendFact(pass, "refused", seq, null, { code: "rowUnreadable", detail });
            return stop("refused", "rowUnreadable", detail);
        }
        return await resolveOne(pass, seq, journaled.call, sendOf(pass.effectId).revision);
    };

    /** One action, taken. A pass meets a gate once, and sends every call after it. */
    const perform = async (
        action: Action,
        pass: Pass,
        intent: AnyIntent,
        plan: readonly Call[],
    ): Promise<CallResult> => {
        switch (action.kind) {
            case "stop":
                return { kind: "stop", result: action.result };
            case "resolve":
                return await resolve(pass, action.seq, action.payload);
            case "send":
                return await sendAt(pass, action.seq, plan);
            case "fresh": {
                const gate = await gates.fresh(pass, intent);
                if (!gate.ok) return { kind: "stop", result: gate.result };
                pass.gated = true;
                return await sendAt(pass, action.seq, plan);
            }
            case "resume": {
                if (!underSameRevision(pass)) {
                    return stop(
                        "refused",
                        "configurationChanged",
                        pass.changed
                            ? "the configuration changed after this effect started; nothing else was sent"
                            : "the configuration changed after this effect started; nothing was resumed",
                    );
                }
                const gate = await gates.resume(pass, intent.operation);
                if (!gate.ok) return { kind: "stop", result: gate.result };
                pass.gated = true;
                // Resuming past the first call means an earlier one landed.

                pass.changed ||= action.seq > 1;
                return await sendAt(pass, action.seq, plan);
            }
        }
    };

    /** The plan, walked: where the ledger says the effect stands, then the action it earns. */
    const drive = async (
        pass: Pass,
        intent: AnyIntent,
        plan: readonly Call[],
    ): Promise<PassResult> => {
        for (;;) {
            const state = ledger.stateOf(pass.effectId, plan.length);
            const action = actionFor(state, pass);
            const step = await perform(action, pass, intent, plan);
            if (step.kind === "stop") return step.result;
        }
    };

    /** One approved effect, under its own lease, released on every exit. */
    const apply = async (
        effect: Effect,
        config: RepositoryConfig,
        allowance: Allowance | undefined,
    ): Promise<EffectOutcome> => {
        const { intent } = effect;
        const pass: Pass = {
            effectId: intent.idempotencyKey,
            capability: intent.capability,
            repository: intent.repository,
            item: intent.item,
            config,
            records: effect.records,
            allowance,
            gated: false,
            changed: false,
            sent: false,
        };
        const outcomeOf = (result: PassResult): EffectOutcome => ({
            effectId: pass.effectId,
            capability: pass.capability,
            operation: intent.operation,
            item: pass.item,
            ...result,
        });

        const plan = planFor(effect, config);
        if (!plan.ok) {
            return outcomeOf({ outcome: "refused", code: plan.code, detail: plan.detail });
        }
        if (!claim(pass.effectId)) {
            return outcomeOf({
                outcome: "unknown",
                code: "leaseHeld",
                detail: "a live worker holds this effect's lease",
            });
        }
        try {
            return outcomeOf(await drive(pass, intent, plan.calls));
        } finally {
            ledger.release(pass.effectId, worker);
        }
    };

    return {
        async applyAll(effects, config, allowance) {
            const outcomes: EffectOutcome[] = [];
            for (const effect of effects) {
                const spent = allowance?.exhausted() ?? null;
                outcomes.push(
                    spent === null
                        ? await apply(effect, config, allowance)
                        : heldBack(effect, spent),
                );
            }
            return outcomes;
        },

        /**
         * One open send the sweep found, resolved and reported.
         * Log-only, and a send still open at the end says nothing: the sweep meets it again.
         */
        async recover(open, config) {
            const journaled = open.payload === null ? null : parseJournaledCall(open.payload);
            if (journaled === null) {
                const sent = sendOf(open.effectId);
                const detail =
                    "the ledger's bytes could not be read; it is closed and nothing was resent";
                // Only the send it closes can say which item and capability this was.

                ledger.record({
                    ...sent,
                    kind: "refused",
                    at: now(),
                    code: "rowUnreadable",
                    detail,
                    payload: null,
                });
                log({
                    event: "effectRefused",
                    effectId: open.effectId,
                    seq: open.seq,
                    code: "rowUnreadable",
                    detail,
                });
                return;
            }
            const pass: Pass = {
                effectId: open.effectId,
                capability: journaled.capability,
                repository: open.repository,
                item: journaled.item,
                config,
                records: null,
                allowance: undefined,
                gated: false,
                changed: false,
                sent: false,
            };
            if (open.attempts >= EFFECT_ATTEMPT_CAP) {
                calls.appendFact(pass, "abandoned", open.seq, journaled.call, {
                    code: "effectAbandoned",
                    detail: `this call was sent ${String(open.attempts)} times and nothing more is sent`,
                });
                log({
                    event: "effectAbandoned",
                    effectId: open.effectId,
                    seq: open.seq,
                    attempts: open.attempts,
                });
                return;
            }
            if (!claim(open.effectId)) return;
            try {
                const resolved = await resolveOne(pass, open.seq, journaled.call, open.revision);
                if (resolved.kind === "done") {
                    log({ event: "effectApplied", effectId: open.effectId, seq: open.seq });
                } else if (resolved.result.outcome === "refused") {
                    log({
                        event: "effectRefused",
                        effectId: open.effectId,
                        seq: open.seq,
                        code: resolved.result.code,
                        detail: resolved.result.detail,
                    });
                }
            } finally {
                ledger.release(open.effectId, worker);
            }
        },
    };
}
