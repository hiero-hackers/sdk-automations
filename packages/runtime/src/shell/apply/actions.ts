/**
 * What one pass carries, and what the loop does next with it: the fold's five
 * states, one action each. The only file that names those states (D172).
 */

import type {
    ItemRef,
    RepositoryConfig,
    RepositoryRef,
    WarningToRecord,
} from "@hiero-hackers/automation-core";
import type { Allowance } from "../allowance.js";
import type { LedgerState } from "../../store/index.js";
import type { EffectOutcomeCode, EffectOutcomeName } from "../effects.js";

/** Everything one pass over one effect shares; the last three are what it learns. */
export interface Pass {
    readonly effectId: string;
    readonly capability: string;
    /** The intent's own, or the open send's on a recovery pass (D169). */
    readonly repository: RepositoryRef;
    readonly item: ItemRef;
    readonly config: RepositoryConfig;
    /** The warning this comment records when it lands; `null` for every recovery pass. */
    readonly records: WarningToRecord | null;
    /** What this pass's calls are charged to; a webhook pass carries none (D192). */
    readonly allowance: Allowance | undefined;
    /** A gate has passed; every remaining call of this pass is sent without one. */
    gated: boolean;
    /** Something landed this pass: `applied` rather than `already` at the end. */
    changed: boolean;
    /** A call went to GitHub; only such a pass can spend a write. */
    sent: boolean;
}

/** What a pass concluded, before it is dressed as an `EffectOutcome`. */
export interface PassResult {
    readonly outcome: EffectOutcomeName;
    readonly code: EffectOutcomeCode | null;
    readonly detail: string | null;
}

/** The next thing the loop does: one call at `seq`, or the end of the pass. */
export type Action =
    | { readonly kind: "fresh"; readonly seq: number }
    | { readonly kind: "resume"; readonly seq: number }
    | { readonly kind: "send"; readonly seq: number }
    | { readonly kind: "resolve"; readonly seq: number; readonly payload: string | null }
    | { readonly kind: "stop"; readonly result: PassResult };

/** What a settled effect tells the next pass: nothing follows a refusal or an abandonment (D161). */
const settledDetail = (how: "refused" | "abandoned"): string =>
    `this effect settled as ${how}; nothing more is sent`;

/** A plan the ledger says is complete: what THIS pass did, or what it found. */
const landed = (pass: Pass): PassResult =>
    pass.changed
        ? { outcome: "applied", code: null, detail: null }
        : {
              outcome: "already",
              code: null,
              detail: pass.sent
                  ? "every call in this plan already held"
                  : "the ledger says every call in this effect's plan landed",
          };

/** The table: where the ledger says this effect stands, and what follows from it (D161). */
export function actionFor(state: LedgerState, pass: Pass): Action {
    switch (state.kind) {
        case "neverStarted":
            return { kind: "fresh", seq: 1 };
        case "resumable":
            return pass.gated
                ? { kind: "send", seq: state.nextSeq }
                : { kind: "resume", seq: state.nextSeq };
        case "open":
            return { kind: "resolve", seq: state.seq, payload: state.payload };
        case "settled":
            return {
                kind: "stop",
                result:
                    state.how === "landed"
                        ? landed(pass)
                        : { outcome: "already", code: null, detail: settledDetail(state.how) },
            };
        case "inconsistent":
            return {
                kind: "stop",
                result: { outcome: "refused", code: "ledgerInconsistent", detail: state.detail },
            };
    }
}
