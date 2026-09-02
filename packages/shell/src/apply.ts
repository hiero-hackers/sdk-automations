/**
 * How one approved effect becomes a landed GitHub change, exactly once.
 *
 * Stage C. `effects.ts` says what an effect's calls ARE; this file is the
 * choreography around them — the lease, the journal, the send, the read-back
 * that proves it — and it owns every seam the choreography needs.
 *
 * The dispatch is the storage decision's recovery loop, verbatim: the journal
 * says WHAT to check, GitHub says HOW IT ENDED, and the call's idempotency
 * decides how a retry may be performed. Four journal states, four answers.
 *
 * ```
 * complete     → nothing sent; the effect already landed
 * midSequence  → resume at the next call
 * sentUnknown  → read GitHub back BEFORE anything, then close or resend
 * neverStarted → re-gate against a LIVE read, then journal → send → verify
 * ```
 *
 * Two rules run through all of it. Nothing is sent that was not journalled
 * first, so a crash between the two is a row a later pass resolves rather than
 * a change nobody recorded. And nothing is closed that was not read back, so
 * "done" always means a read said so.
 *
 * The seams below restate shapes the adapter already has. That is deliberate
 * and enforced: `.dependency-cruiser.cjs` admits the adapter at `main.ts` and
 * nowhere else, so the shell names what it needs and the composition root
 * passes the adapter's own objects, which satisfy it structurally. Same idiom
 * as `ExternalsForDelivery`, and `main.ts` is where the two shapes are checked
 * against each other.
 */

import {
    deriveWorld,
    evaluateStandingRules,
    evaluateWrite,
    INTENT_OPERATIONS,
    writeRequestFor,
    matchesManagedComment,
    meaningsOfLabels,
    projectIssueObservation,
    projectPrObservation,
    type AnyIntent,
    type ApprovedEffect,
    type HumanChangeOrdering,
    type IntentOperation,
    type ItemRef,
    type ManagedCommentKind,
    type MappableMeaning,
    type ObservationProjection,
    type RepositoryConfig,
} from "@hiero-hackers/automation-core";
import type { OpenIntent, Store } from "@hiero-hackers/automation-store";
import {
    operationOf,
    parseJournaledCall,
    planFor,
    serializeCall,
    type EffectCall,
    type EffectOutcome,
    type EffectOutcomeCode,
    type EffectOutcomeName,
} from "./effects.js";
import type { ShellExternals } from "./externals.js";
import { detailOf, type Log } from "./log.js";

// ─── The chosen bounds ───────────────────────────────────────────────

/**
 * How long an effect lease is honoured before a later worker may take it over.
 *
 * The number is the write client's bounded worst case times its attempt
 * budget, with margin: a lease stolen while a request is still in flight is
 * the one window `claim` cannot fence, because SQLite ownership cannot cancel
 * a call GitHub is already serving (D41, reopened). Ten minutes puts the
 * takeover far outside any request that could still be alive, which is the
 * first-slice posture the storage decision's risk review records — one effect
 * worker, and a margin that makes the unfenceable window unable to open.
 */
export const EFFECT_LEASE_STALE_MINUTES = 10;

/**
 * How many times one call may be declared before recovery gives up on it.
 *
 * The journal's `attempt` column counts durably, across restarts, so this is a
 * bound on the effect rather than on a process (D42). A call that has been
 * sent five times and never confirmed is not one more send away from working;
 * it is a thing an operator has to look at, which is what `effectAbandoned`
 * is for.
 */
export const EFFECT_ATTEMPT_CAP = 5;

// ─── The seams ───────────────────────────────────────────────────────

/** What one write turned out to be — the endpoint matrix's six words. */
export type WriteAnswer =
    | { readonly outcome: "applied" }
    | { readonly outcome: "already" }
    | { readonly outcome: "conflict"; readonly detail: string }
    | { readonly outcome: "forbidden"; readonly detail: string }
    | { readonly outcome: "retryLater"; readonly detail: string }
    | { readonly outcome: "unknown"; readonly detail: string };

/** The four confirmed write endpoints, and nothing else (D4). */
export interface EffectWriter {
    addLabel(item: ItemRef, label: string): Promise<WriteAnswer>;
    removeLabel(item: ItemRef, label: string): Promise<WriteAnswer>;
    createComment(item: ItemRef, body: string): Promise<WriteAnswer>;
    updateComment(commentId: number, body: string): Promise<WriteAnswer>;
}

/** A read that answered, or the reason it established nothing. */
export type ReadAnswer<T> =
    { readonly ok: true; readonly value: T } | { readonly ok: false; readonly detail: string };

/** D46's three answers; `unknown` is not a soft "absent". */
export type SeenState = "present" | "absent" | "unknown";

/** One comment, as the marker matcher needs it. */
export interface CommentSeen {
    readonly id: number;
    readonly body: string;
    readonly authoredByApp: boolean;
}

/** The item's own facts, as the apply-time re-gate rebuilds a projection from. */
export interface ItemSeen {
    readonly labels: readonly string[];
    readonly closed: boolean;
    readonly merged: boolean;
}

/** What GitHub says is there now. Presence answers on sight; absence obeys D46. */
export interface EffectReader {
    comments(item: ItemRef): Promise<ReadAnswer<readonly CommentSeen[]>>;
    labels(item: ItemRef): Promise<ReadAnswer<readonly string[]>>;
    item(item: ItemRef): Promise<ReadAnswer<ItemSeen>>;
    commentPresence(item: ItemRef, matches: (comment: CommentSeen) => boolean): Promise<SeenState>;
    labelPresence(item: ItemRef, label: string): Promise<SeenState>;
}

/**
 * A FRESH externals set, built per apply pass.
 *
 * Never the delivery's own: that one memoises each item's ordering evidence
 * for the length of one decision, which is right for a decision and wrong
 * here. Between deciding and applying, a human can change the item — and a
 * memo would answer the apply-time gate with the instant the DECISION read,
 * which is the one thing a re-gate exists to stop believing.
 */
export type EffectExternalsSource = () => ShellExternals | Promise<ShellExternals>;

export interface ApplierOptions {
    readonly store: Store;
    readonly writer: EffectWriter;
    readonly reader: EffectReader;
    readonly externals: EffectExternalsSource;
    /** Which worker holds a lease; the store releases only this name's own. */
    readonly worker: string;
    readonly clock: () => Date;
    /** Recovery has no delivery to report into, so its lines leave here. */
    readonly log: Log;
}

/** The write path, as the processor and the sweep each use it. */
export interface Applier {
    /** Every approved effect of one decision, in order, each under its own lease. */
    applyAll(
        effects: readonly ApprovedEffect[],
        config: RepositoryConfig,
    ): Promise<readonly EffectOutcome[]>;
    /** One open journal row, resolved against GitHub — the sweep's unit of work. */
    recover(open: OpenIntent, config: RepositoryConfig): Promise<void>;
}

// ─── What a pass is working on ───────────────────────────────────────

/** Everything one pass over one effect shares. */
interface Pass {
    readonly effectId: string;
    readonly capability: string;
    readonly item: ItemRef;
    readonly config: RepositoryConfig;
}

/** What a pass concluded, before it is dressed as an `EffectOutcome`. */
interface PassResult {
    readonly outcome: EffectOutcomeName;
    readonly code: EffectOutcomeCode | null;
    readonly detail: string | null;
}

/** One call either landed, or ended the pass. */
type CallResult =
    | { readonly kind: "done"; readonly changed: boolean }
    | { readonly kind: "stop"; readonly result: PassResult };

/** A gate passed, or the result its refusal produces. */
type GateVerdict = { readonly ok: true } | { readonly ok: false; readonly result: PassResult };

/** Whether a read-back says a call's postcondition holds. */
type Confirmation = "held" | "notHeld" | "unknown";

const stop = (
    outcome: EffectOutcomeName,
    code: EffectOutcomeCode | null,
    detail: string,
): CallResult => ({ kind: "stop", result: { outcome, code, detail } });

const refuse = (code: EffectOutcomeCode, detail: string): GateVerdict => ({
    ok: false,
    result: { outcome: "refused", code, detail },
});

const held = (seen: SeenState, holds: SeenState): Confirmation =>
    seen === "unknown" ? "unknown" : seen === holds ? "held" : "notHeld";

/**
 * The live item as a projection.
 *
 * A closed item's reason is read as far as this endpoint can tell it: a merged
 * pull request is `merged`, and everything else closed is `closedByHuman`. The
 * third reason — an issue completed by a linked merge — is not distinguishable
 * from an item read, and does not need to be: every closure refuses the write
 * with the same rule, so the choice cannot change a verdict.
 */
function projectionFrom(
    seen: ItemSeen,
    kind: ItemRef["kind"],
    config: RepositoryConfig,
): ObservationProjection<MappableMeaning> {
    const observation = {
        closedBy: seen.closed
            ? seen.merged
                ? ("merged" as const)
                : ("closedByHuman" as const)
            : null,
        meanings: meaningsOfLabels(config, seen.labels),
    };
    return kind === "issue"
        ? projectIssueObservation(observation)
        : projectPrObservation(observation);
}

export function createApplier(options: ApplierOptions): Applier {
    const { store, writer, reader, externals, worker, clock, log } = options;

    const now = (): string => clock().toISOString();

    /** Take the lease, or learn that a live worker holds it. */
    const claim = (effectId: string): boolean => {
        const at = clock();
        return store.claim(
            effectId,
            worker,
            at.toISOString(),
            new Date(at.getTime() - EFFECT_LEASE_STALE_MINUTES * 60_000).toISOString(),
        );
    };

    /** The externals for this pass, with the seam CONTAINED. */
    const freshExternals = async (): Promise<ReadAnswer<ShellExternals>> => {
        try {
            return { ok: true, value: await externals() };
        } catch (error) {
            return { ok: false, detail: detailOf(error) };
        }
    };

    /**
     * The ordering evidence for one item, CONTAINED the way `decide()`
     * contains it: a lookup that threw established nothing, and D51 rules an
     * unestablished ordering a conflict — which the rules already refuse.
     */
    const orderingFor = async (
        facts: ShellExternals,
        item: ItemRef,
    ): Promise<HumanChangeOrdering> => {
        try {
            return await facts.latestHumanChangeAt(item);
        } catch {
            return "unknown";
        }
    };

    /**
     * The brakes an operator can still pull between deciding and applying:
     * the kill switch, the repository's mode, whether the capability is
     * enabled, and whether the installation still grants the permission.
     *
     * Core's own rules, run by core (`evaluateStandingRules`) — not a copy.
     * The five checks were written out here once, and a shell that restates a
     * safety ladder is a second ladder waiting to disagree with the first
     * about whether a repository still says yes. What the shell decides is
     * WHICH rules to run; how each one answers, in what order, and under which
     * code stays core's.
     *
     * The subset is the item-independent half, and it is the whole gate a
     * RESUME passes. The full ladder is not re-run on a resume, and the reason
     * is add-then-remove: a half-done label swap leaves the item holding two
     * position labels, which projects as a conflict, which `deriveWorld`
     * reports as no authoritative precondition — so `evaluateWrite` could only
     * ever answer `preconditionStale` there. The conflict is this platform's
     * own intermediate, and the remaining call is exactly what clears it;
     * refusing would leave the item conflicted for good, which is worse for a
     * human than finishing the move they can then re-edit.
     */
    const brakes = (pass: Pass, operation: IntentOperation, facts: ShellExternals): GateVerdict => {
        const operationFacts = INTENT_OPERATIONS[operation];
        const verdict = evaluateStandingRules(
            {
                capability: pass.capability,
                actionClass: operationFacts.actionClassFloor,
                requiredPermissions: [operationFacts.permission],
            },
            pass.config,
            {
                killSwitchActive: facts.killSwitchActive,
                installationGrants: facts.installationGrants,
            },
        );
        return verdict.outcome === "apply" ? { ok: true } : refuse(verdict.code, verdict.reason);
    };

    /** The brakes, over externals read fresh for this pass. */
    const resumeGate = async (pass: Pass, operation: IntentOperation): Promise<GateVerdict> => {
        const facts = await freshExternals();
        return facts.ok
            ? brakes(pass, operation, facts.value)
            : {
                  ok: false,
                  result: {
                      outcome: "retryLater",
                      code: "externalsUnavailable",
                      detail: `the apply-time externals could not be built: ${facts.detail}`,
                  },
              };
    };

    /**
     * The whole ladder again, against a LIVE read of the item.
     *
     * This is what makes an approval a permission to act NOW rather than a
     * permission banked at decision time. The item is re-read, the projection
     * rebuilt from its current labels, and the ordering evidence taken from a
     * source built for this pass — so a human change made in the gap between
     * deciding and applying refuses the write, which a memo carried over from
     * the decision could not do.
     */
    const freshGate = async (pass: Pass, intent: AnyIntent): Promise<GateVerdict> => {
        const seen = await reader.item(intent.item);
        if (!seen.ok) {
            return {
                ok: false,
                result: {
                    outcome: "retryLater",
                    code: "itemUnreadable",
                    detail: `the item could not be read at apply time: ${seen.detail}`,
                },
            };
        }
        const facts = await freshExternals();
        if (!facts.ok) {
            return {
                ok: false,
                result: {
                    outcome: "retryLater",
                    code: "externalsUnavailable",
                    detail: `the apply-time externals could not be built: ${facts.detail}`,
                },
            };
        }
        const verdict = evaluateWrite(writeRequestFor(intent), pass.config, {
            killSwitchActive: facts.value.killSwitchActive,
            installationGrants: facts.value.installationGrants,
            latestHumanChangeAt: await orderingFor(facts.value, intent.item),
            world: deriveWorld(
                projectionFrom(seen.value, intent.item.kind, pass.config),
                intent.expected,
            ),
        });
        return verdict.outcome === "apply" ? { ok: true } : refuse(verdict.code, verdict.reason);
    };

    // ── Recognising this effect's own comment ───────────────────────

    /** Is this comment THIS effect's? Authorship and marker, both required (D125). */
    const isMine =
        (pass: Pass, kind: ManagedCommentKind) =>
        (comment: CommentSeen): boolean =>
            matchesManagedComment(
                { body: comment.body, authoredByApp: comment.authoredByApp },
                { capability: pass.capability, kind, effectId: pass.effectId },
            ).matches;

    /**
     * This effect's managed comment, `null` when there provably is none, or
     * the reason neither could be established.
     *
     * The `null` costs D46's gap, and that is the whole point: a stale
     * "absent" here is what makes a comment create run twice, which is the
     * duplicate protocol 6.5 measured. A match found on the first read is
     * believed at once, because a visible comment is a landed one.
     */
    const matchedComment = async (
        pass: Pass,
        kind: ManagedCommentKind,
    ): Promise<ReadAnswer<CommentSeen | null>> => {
        const mine = isMine(pass, kind);
        const listed = await reader.comments(pass.item);
        if (!listed.ok)
            return { ok: false, detail: `the comment read-back failed: ${listed.detail}` };
        const found = listed.value.find(mine);
        if (found !== undefined) return { ok: true, value: found };
        const confirmed = await reader.commentPresence(pass.item, mine);
        if (confirmed === "absent") return { ok: true, value: null };
        return {
            ok: false,
            detail:
                confirmed === "present"
                    ? "this effect's managed comment appeared between two reads"
                    : "the read-back could not establish whether this effect's comment exists",
        };
    };

    // ── Sending and proving one call ────────────────────────────────

    /**
     * One call, sent.
     *
     * `postComment` is where D12 lives. The marker read-back runs first: no
     * match creates, a match with the same body is `already`, and a match with
     * a different body is updated in place — which is also the documented
     * answer to a human editing a managed comment. The restoration happens
     * only because a fresh decision produced this effect and reached this
     * line. Nothing repairs a comment in the background: the read-back that
     * recovery uses matches on IDENTITY alone, so an edited comment is a
     * landed comment and no resend is triggered by the edit.
     *
     * `unassign` is refused here rather than earlier, so the plan, the journal
     * row and the dispatch stay identical for every operation. The write
     * surface is the four endpoints the matrix confirmed, and none of them
     * unassigns.
     */
    const send = async (pass: Pass, call: EffectCall): Promise<WriteAnswer> => {
        switch (call.verb) {
            case "addLabel":
                return await writer.addLabel(pass.item, call.label);
            case "removeLabel":
                return await writer.removeLabel(pass.item, call.label);
            case "unassign":
                return {
                    outcome: "forbidden",
                    detail: "no confirmed write endpoint unassigns; the adapter has four, and none of them is this",
                };
            case "postComment": {
                const found = await matchedComment(pass, call.kind);
                if (!found.ok) return { outcome: "retryLater", detail: found.detail };
                if (found.value === null) return await writer.createComment(pass.item, call.body);
                if (found.value.body === call.body) return { outcome: "already" };
                return await writer.updateComment(found.value.id, call.body);
            }
        }
    };

    /**
     * Does GitHub say this call's postcondition holds?
     *
     * The same question serves both jobs: verifying a write that reported
     * success, and reconciling a row whose answer was lost. That is why the
     * comment case asks about IDENTITY and not about the body — a comment
     * bearing this effect's marker is this effect's call, landed, whatever a
     * human has since done to its text.
     */
    const confirm = async (pass: Pass, call: EffectCall): Promise<Confirmation> => {
        switch (call.verb) {
            case "postComment":
                return held(
                    await reader.commentPresence(pass.item, isMine(pass, call.kind)),
                    "present",
                );
            case "addLabel":
                return held(await reader.labelPresence(pass.item, call.label), "present");
            case "removeLabel":
                return held(await reader.labelPresence(pass.item, call.label), "absent");
            case "unassign":
                // Nothing reads an assignee list, so nothing can prove one.
                // Unreachable: `send` refuses this verb before it is proved.
                return "unknown";
        }
    };

    /**
     * Journal, send, prove — in that order, always.
     *
     * `store.intent` is the row that survives a crash between here and
     * GitHub; re-declaring an open call increments its durable attempt
     * counter, which is what a resend does and what the cap counts. A definite
     * refusal — conflict or forbidden — CLOSES the row: nothing landed and
     * nothing will, so leaving it open would ask the sweep to re-decide a
     * question GitHub has already answered.
     */
    const journalAndSend = async (
        pass: Pass,
        seq: number,
        call: EffectCall,
    ): Promise<CallResult> => {
        store.intent(
            pass.effectId,
            seq,
            serializeCall({ capability: pass.capability, item: pass.item, call }),
            now(),
            pass.config.revision,
        );
        const answer = await send(pass, call);
        switch (answer.outcome) {
            case "applied": {
                const proof = await confirm(pass, call);
                if (proof !== "held") {
                    return stop(
                        "unknown",
                        "postconditionUnconfirmed",
                        `GitHub accepted the ${call.verb} but the read-back answered ${proof}`,
                    );
                }
                store.done(pass.effectId, seq, now());
                return { kind: "done", changed: true };
            }
            case "already":
                store.done(pass.effectId, seq, now());
                return { kind: "done", changed: false };
            case "conflict":
                store.done(pass.effectId, seq, now());
                return stop("refused", "writeConflict", answer.detail);
            case "forbidden":
                store.done(pass.effectId, seq, now());
                return stop("refused", "writeForbidden", answer.detail);
            case "retryLater":
                return stop("retryLater", "writeRetryLater", answer.detail);
            case "unknown":
                return stop("unknown", "writeUnknown", answer.detail);
        }
    };

    /**
     * One open `sent` row, resolved — the whole of `SENT-UNKNOWN`.
     *
     * GitHub is asked BEFORE anything else, because the row says only that a
     * call was declared. A confirmed postcondition closes the row without a
     * second send. A confirmed absence earns a resend, and only that branch
     * meets a gate: by then nothing has landed, so a world that now says no
     * makes the row final rather than pending. An unknown read leaves the row
     * exactly as it was, for a later pass with a luckier read.
     */
    const resolveOpen = async (pass: Pass, seq: number, call: EffectCall): Promise<CallResult> => {
        const proof = await confirm(pass, call);
        if (proof === "held") {
            store.done(pass.effectId, seq, now());
            return { kind: "done", changed: true };
        }
        if (proof === "unknown") {
            return stop(
                "unknown",
                "writeUnknown",
                "the read-back could not establish whether this call landed",
            );
        }
        const gate = await resumeGate(pass, operationOf(call));
        if (!gate.ok) {
            if (gate.result.outcome === "refused") store.done(pass.effectId, seq, now());
            return { kind: "stop", result: gate.result };
        }
        return await journalAndSend(pass, seq, call);
    };

    /** The plan from one call onward. The first stop ends the pass. */
    const runFrom = async (
        pass: Pass,
        calls: readonly EffectCall[],
        startSeq: number,
        changedAlready: boolean,
    ): Promise<PassResult> => {
        let changed = changedAlready;
        for (let seq = startSeq; seq <= calls.length; seq += 1) {
            const result = await journalAndSend(pass, seq, calls[seq - 1]!);
            if (result.kind === "stop") return result.result;
            changed ||= result.changed;
        }
        return changed
            ? { outcome: "applied", code: null, detail: null }
            : { outcome: "already", code: null, detail: "every call in this plan already held" };
    };

    /** The open row a `sentUnknown` names, then whatever the plan has left. */
    const continueOpen = async (
        pass: Pass,
        seq: number,
        row: string,
        calls: readonly EffectCall[],
    ): Promise<PassResult> => {
        const journaled = parseJournaledCall(row);
        if (journaled === null) {
            // Nothing can be resent from bytes nobody can read, and leaving
            // the row open would hand the sweep the same dead end forever.
            store.done(pass.effectId, seq, now());
            return {
                outcome: "refused",
                code: "rowUnreadable",
                detail: "the journal row for this call could not be read; it is closed and nothing was resent",
            };
        }
        const resolved = await resolveOpen(pass, seq, journaled.call);
        if (resolved.kind === "stop") return resolved.result;
        if (seq >= calls.length) {
            return { outcome: "applied", code: null, detail: null };
        }
        const gate = await resumeGate(pass, operationOf(journaled.call));
        if (!gate.ok) return gate.result;
        return await runFrom(pass, calls, seq + 1, true);
    };

    /** The dispatch: the recovery loop's four states, four answers. */
    const drive = async (
        pass: Pass,
        intent: AnyIntent,
        calls: readonly EffectCall[],
    ): Promise<PassResult> => {
        const state = store.effectState(pass.effectId, calls.length);
        if (state.state === "complete") {
            return {
                outcome: "already",
                code: null,
                detail: "the journal says every call in this effect's plan is done",
            };
        }
        if (state.state === "sentUnknown") {
            return await continueOpen(pass, state.seq, state.intent, calls);
        }
        if (state.state === "midSequence") {
            const gate = await resumeGate(pass, intent.operation);
            return gate.ok ? await runFrom(pass, calls, state.lastDoneSeq + 1, true) : gate.result;
        }
        const gate = await freshGate(pass, intent);
        return gate.ok ? await runFrom(pass, calls, 1, false) : gate.result;
    };

    /** One approved effect, under its own lease, released on every exit. */
    const apply = async (
        effect: ApprovedEffect,
        config: RepositoryConfig,
    ): Promise<EffectOutcome> => {
        const { intent } = effect;
        const pass: Pass = {
            effectId: intent.idempotencyKey,
            capability: intent.capability,
            item: intent.item,
            config,
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
            // Not a failure: the holder is working on it, or will be told it
            // lost the lease. Either way this pass has nothing safe to add.
            return outcomeOf({
                outcome: "unknown",
                code: "leaseHeld",
                detail: "a live worker holds this effect's lease",
            });
        }
        try {
            return outcomeOf(await drive(pass, intent, plan.calls));
        } finally {
            store.release(pass.effectId, worker);
        }
    };

    return {
        async applyAll(effects, config) {
            const outcomes: EffectOutcome[] = [];
            for (const effect of effects) outcomes.push(await apply(effect, config));
            return outcomes;
        },

        /**
         * One open row the sweep found, resolved and reported.
         *
         * Log-only: a recovery pass has no delivery record to write into, so
         * the operator log is the whole account of it. A row still open at the
         * end says nothing — the sweep meets it again next tick, and a line
         * every minute would bury the ones that matter.
         */
        async recover(open, config) {
            const journaled = parseJournaledCall(open.intent);
            if (journaled === null) {
                store.done(open.effectId, open.seq, now());
                log({
                    event: "effectRefused",
                    effectId: open.effectId,
                    seq: open.seq,
                    code: "rowUnreadable",
                    detail: "the journal row could not be read; it is closed and nothing was resent",
                });
                return;
            }
            if (open.attempt >= EFFECT_ATTEMPT_CAP) {
                store.done(open.effectId, open.seq, now());
                log({
                    event: "effectAbandoned",
                    effectId: open.effectId,
                    seq: open.seq,
                    attempts: open.attempt,
                });
                return;
            }
            const pass: Pass = {
                effectId: open.effectId,
                capability: journaled.capability,
                item: journaled.item,
                config,
            };
            if (!claim(open.effectId)) return;
            try {
                const resolved = await resolveOpen(pass, open.seq, journaled.call);
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
                store.release(open.effectId, worker);
            }
        },
    };
}
