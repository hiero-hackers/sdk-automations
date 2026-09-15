/**
 * One call: recorded, sent, and proved — or read back after the fact.
 * Two rules run through it: nothing is sent the ledger did not record first, and
 * nothing is closed that was not read back. It knows no verb and no gate.
 */

import { matchesManagedComment, parseManagedMarker } from "@hiero-hackers/automation-core";
import type { FactKind, Ledger, StoredWarning } from "../../store/index.js";
import type { Pass, PassResult } from "./actions.js";
import type { Call, EffectOutcomeCode, EffectOutcomeName } from "../effects.js";
import type {
    CommentSeen,
    Confirmation,
    EffectReader,
    EffectWriter,
    SendContext,
    WriteResult,
} from "./operations/handler.js";
import { confirmCall, sendCall as sendByHandler, serializeCall } from "./operations/index.js";

const HOUR_MS = 60 * 60 * 1000;

/** One call either landed, or ended the pass. */
export type CallResult =
    | { readonly kind: "done"; readonly changed: boolean }
    | { readonly kind: "stop"; readonly result: PassResult };

/** What a read-back established; `landed` is recorded before it is answered. */
export type ReadBack = "landed" | "unknown" | "notHeld";

export const stop = (
    outcome: EffectOutcomeName,
    code: EffectOutcomeCode | null,
    detail: string,
): CallResult => ({ kind: "stop", result: { outcome, code, detail } });

/** What a fact says beyond the call it is about. */
interface Said {
    readonly code?: string | null;
    readonly detail?: string | null;
    readonly payload?: string;
}

/** The login a call names; every other verb names none. */
const loginOf = (call: Call): string | null => ("login" in call ? call.login : null);

/**
 * Is this comment the one the call about to be sent would BE? Authorship and identity (D125).
 * The identity comes from the call's own rendered body, which is all a resend has, so a recovery pass and a fresh one ask exactly the same question (D145).
 */
const isMine = (body: string): ((comment: CommentSeen) => boolean) => {
    const published = parseManagedMarker(body);
    const mine = "recognized" in published ? published.recognized : null;
    return (comment: CommentSeen): boolean =>
        mine !== null &&
        matchesManagedComment({ body: comment.body, authoredByApp: comment.authoredByApp }, mine)
            .matches;
};

export interface CallOptions {
    /** The facts a send is recorded in, and the warning a landed comment promises (D164). */
    readonly ledger: Ledger;
    readonly writer: EffectWriter;
    readonly reader: EffectReader;
    readonly clock: () => Date;
}

/** Everything one call of a pass can do. */
export interface Calls {
    /** Append the send, send it, prove it — in that order, always. */
    sendCall(pass: Pass, seq: number, call: Call): Promise<CallResult>;
    /** One open send, asked of GitHub; a call it holds is recorded landed here. */
    readBack(pass: Pass, seq: number, call: Call): Promise<ReadBack>;
    /** A refusal settles the effect, so the fact is appended and the pass stops at it. */
    refuseCall(
        pass: Pass,
        seq: number,
        call: Call,
        code: EffectOutcomeCode,
        detail: string,
    ): CallResult;
    /** Append one fact about one call: the identity is the pass's, the verb the call's (D161). */
    appendFact(pass: Pass, kind: FactKind, seq: number, call: Call | null, said?: Said): void;
}

export function createCalls(options: CallOptions): Calls {
    const { ledger, writer, reader, clock } = options;

    const now = (): string => clock().toISOString();

    /**
     * What one send of this pass's effect may know.
     * `isMine` is handed in: recognising the App's own comment is the choreography's business and not an operation's (D125).
     */
    const contextFor = (pass: Pass): SendContext => ({
        item: pass.item,
        writer,
        reader,
        allowance: pass.allowance,
        isMine,
    });

    /** One call, sent by the handler that owns its verb. */
    const send = async (pass: Pass, call: Call): Promise<WriteResult> =>
        await sendByHandler(call, contextFor(pass));

    /** Does GitHub say this call's postcondition holds? */
    const confirm = async (pass: Pass, call: Call): Promise<Confirmation> =>
        await confirmCall(call, contextFor(pass));

    const appendFact = (
        pass: Pass,
        kind: FactKind,
        seq: number,
        call: Call | null,
        said: Said = {},
    ): void => {
        ledger.record({
            effectId: pass.effectId,
            seq,
            kind,
            at: now(),
            revision: pass.config.revision,
            capability: pass.capability,
            repository: pass.repository,
            item: pass.item,
            verb: call?.verb ?? null,
            login: call === null ? null : loginOf(call),
            code: said.code ?? null,
            detail: said.detail ?? null,
            payload: said.payload ?? null,
        });
    };

    const refuseCall = (
        pass: Pass,
        seq: number,
        call: Call,
        code: EffectOutcomeCode,
        detail: string,
    ): CallResult => {
        appendFact(pass, "refused", seq, call, { code, detail });
        return stop("refused", code, detail);
    };

    /**
     * The warning this landed comment promises, written down (grace.md §3).
     * `warnedAt` is NOW, because the promise is made when the comment appears. Keyed by the ACT's effect id, and called only after a call is proved done.
     */
    const record = (pass: Pass, call: Call): void => {
        if (pass.records === null || call.verb !== "postComment") return;
        const warnedAt = clock();
        const { request } = pass.records;
        const snapshot: Omit<StoredWarning, "effectId"> = {
            warnedAt: warnedAt.toISOString(),
            gracePeriodHours: pass.records.gracePeriodHours,
            earliestActionAt: new Date(
                warnedAt.getTime() + pass.records.gracePeriodHours * HOUR_MS,
            ).toISOString(),
            cancelledBy: pass.records.cancelledBy,
            reversesWith: pass.records.reversesWith,
            actionClass: request.actionClass,
            capability: request.capability,
            causeObservedAt: request.causeObservedAt.toISOString(),
            cause: request.cause,
            item: request.target.item,
            change: request.target.change,
        };
        // The ACT's history, not this comment's, and seq 0 because no call of it (D162).

        ledger.record({
            effectId: pass.records.effectId,
            seq: 0,
            kind: "warned",
            at: snapshot.warnedAt,
            revision: pass.config.revision,
            capability: pass.capability,
            repository: pass.repository,
            item: pass.item,
            verb: null,
            login: null,
            code: null,
            detail: null,
            payload: JSON.stringify(snapshot),
        });
    };

    /** The fact that closes a landed call, and the warning it promises. */
    const land = (pass: Pass, seq: number, call: Call): void => {
        appendFact(pass, "landed", seq, call);
        record(pass, call);
    };

    return {
        /**
         * A definite refusal — conflict or forbidden — SETTLES the effect: nothing landed and nothing will, so leaving the send open would ask the sweep to re-decide a settled question.
         * A write no endpoint realises is `unsent` instead, spending no attempt: the send closes and the next pass resumes at the same call.
         */
        async sendCall(pass, seq, call) {
            const spent = pass.allowance?.exhausted() ?? null;
            if (spent === "mutations") {
                return stop(
                    "refused",
                    "sweepWriteCap",
                    "this firing's write-call budget is spent; resumed next sweep",
                );
            }
            if (spent !== null) {
                return stop(
                    "refused",
                    "sweepRequestCap",
                    `this window's ${spent} allowance is spent; resumed next sweep`,
                );
            }
            appendFact(pass, "sent", seq, call, {
                payload: serializeCall({ capability: pass.capability, item: pass.item, call }),
            });
            pass.sent = true;
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
                    land(pass, seq, call);
                    return { kind: "done", changed: true };
                }
                case "already":
                    land(pass, seq, call);
                    return { kind: "done", changed: false };
                case "conflict":
                    return refuseCall(pass, seq, call, "writeConflict", answer.detail);
                case "forbidden":
                    return refuseCall(pass, seq, call, "writeForbidden", answer.detail);
                case "unsupported":
                    appendFact(pass, "unsent", seq, call, {
                        code: "writeUnsupported",
                        detail: answer.detail,
                    });
                    return stop("refused", "writeUnsupported", answer.detail);
                case "retryLater":
                    return stop("retryLater", "writeRetryLater", answer.detail);
                case "unknown":
                    return stop("unknown", "writeUnknown", answer.detail);
            }
        },

        /** GitHub is asked before anything else: only a call it does not hold may be resent. */
        async readBack(pass, seq, call) {
            const proof = await confirm(pass, call);
            if (proof !== "held") return proof;
            land(pass, seq, call);
            return "landed";
        },

        refuseCall,
        appendFact,
    };
}
