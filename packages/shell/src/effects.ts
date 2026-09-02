/**
 * What one approved effect becomes: the ordered calls that realise it, the
 * JSON each call's journal row carries, and the words an outcome is reported
 * in.
 *
 * Pure — no store, no GitHub, no clock. `apply.ts` is the choreography that
 * drives a plan and owns every I/O seam; this file is the vocabulary it and
 * the recovery sweep both speak.
 *
 * The row format is the load-bearing part. The storage decision's recovery
 * loop resends FROM THE ROW, never by re-deciding, so a row must carry
 * everything a send needs — and nothing a reader would have to trust. What it
 * deliberately does not carry is identity: the effect id is the journal's own
 * key, and the marker a comment is recognised by is rebuilt from that key, so
 * a tampered row cannot make some other comment match.
 */

import {
    ISSUE_MEANINGS,
    MANAGED_COMMENT_KINDS,
    PR_MEANINGS,
    type ApprovedEffect,
    type Intent,
    type IntentOperation,
    type ItemRef,
    type ManagedCommentKind,
    type MappableMeaning,
    type RecordOnlyCode,
    type RepositoryConfig,
    type SafetyRefusalCode,
} from "@hiero-hackers/automation-core";

// ─── The words an outcome is reported in ─────────────────────────────

/**
 * What one apply pass made of one effect.
 *
 * `applied` and `already` are the two ways the plan is realised: because this
 * pass changed GitHub, or because it did not have to. `refused` is a gate or
 * GitHub saying no, and it is FINAL for the world it was decided in — the
 * journal row is closed. `retryLater` and `unknown` both leave the row open
 * for the sweep; they differ in what is known, which is what the endpoint
 * matrix's own two words mean (`WriteResult`).
 */
export const EFFECT_OUTCOMES = ["applied", "already", "refused", "retryLater", "unknown"] as const;

/** One of `EFFECT_OUTCOMES`. */
export type EffectOutcomeName = (typeof EFFECT_OUTCOMES)[number];

/**
 * Why an outcome is what it is, for the reasons the safety ladder has no code
 * for — everything that happens BELOW a verdict.
 *
 * Core's `SafetyRefusalCode` and `RecordOnlyCode` cover every refusal a gate
 * reaches, and those are reported unchanged. These are the applier's own:
 * `leaseHeld` and `rowUnreadable` are states of the store, the four `write*`
 * words are GitHub's answer as the matrix names it, and the remaining three
 * are reads that established nothing.
 */
export const EFFECT_CODES = [
    "leaseHeld",
    "rowUnreadable",
    "identityMissing",
    "labelUnmapped",
    "itemUnreadable",
    "externalsUnavailable",
    "writeConflict",
    "writeForbidden",
    "writeRetryLater",
    "writeUnknown",
    "postconditionUnconfirmed",
] as const;

/** One of `EFFECT_CODES`. */
export type EffectCode = (typeof EFFECT_CODES)[number];

/** Every code an outcome may carry: a verdict's, or one of the applier's own. */
export type EffectOutcomeCode = SafetyRefusalCode | RecordOnlyCode | EffectCode;

/**
 * One effect's fate, as the decision record and the operator log report it.
 *
 * `code` is `null` only when nothing refused and nothing was ambiguous.
 * `detail` is prose about what happened and the one field nothing should
 * parse.
 */
export interface EffectOutcome {
    readonly effectId: string;
    readonly capability: string;
    readonly operation: IntentOperation;
    readonly item: ItemRef;
    readonly outcome: EffectOutcomeName;
    readonly code: EffectOutcomeCode | null;
    readonly detail: string | null;
}

// ─── What one call is ────────────────────────────────────────────────

/**
 * One GitHub call, named by the postcondition it establishes rather than by
 * the verb it happens to use.
 *
 * `postComment` is deliberately not "create": its realisation is D12's — an
 * App-authored comment bearing this effect's marker either does not exist and
 * is created, or exists and is left alone or updated. One name, because a
 * resend must not have to know which of the three the first attempt chose.
 *
 * `body` is the RENDERED body, marker first. `parseManagedMarker` requires the
 * marker to be the body's opening bytes, so composing it at plan time is what
 * makes the bytes in the row exactly the bytes that will be sent.
 */
export type EffectCall =
    | {
          readonly verb: "postComment";
          readonly kind: ManagedCommentKind;
          readonly body: string;
      }
    | { readonly verb: "addLabel"; readonly label: string }
    | { readonly verb: "removeLabel"; readonly label: string }
    | { readonly verb: "unassign"; readonly login: string };

/**
 * One call as its journal row spells it — the row's `intent` column, parsed.
 *
 * `capability` and `item` ride along because a resend addresses a call the
 * decision that planned it is long gone from. The operation is not stored: it
 * follows from the verb, and a fact derivable from the row is a fact that
 * cannot disagree with it.
 */
export interface JournaledCall {
    readonly capability: string;
    readonly item: ItemRef;
    readonly call: EffectCall;
}

/** The operation a call belongs to — the derivation the row relies on. */
export function operationOf(call: EffectCall): IntentOperation {
    switch (call.verb) {
        case "postComment":
            return "postManagedComment";
        case "addLabel":
        case "removeLabel":
            return "applyMappedLabel";
        case "unassign":
            return "unassign";
    }
}

/**
 * The row's bytes for one call.
 *
 * Every field is written out rather than spread, for the reason
 * `deriveManagedMarker` writes its payload out: `JSON.stringify` preserves
 * insertion order, and a row's spelling must not depend on how the record
 * reached this function.
 */
export function serializeCall(journaled: JournaledCall): string {
    const { capability, item, call } = journaled;
    const head = { capability, item: { kind: item.kind, number: item.number } };
    switch (call.verb) {
        case "postComment":
            return JSON.stringify({ ...head, verb: call.verb, kind: call.kind, body: call.body });
        case "addLabel":
        case "removeLabel":
            return JSON.stringify({ ...head, verb: call.verb, label: call.label });
        case "unassign":
            return JSON.stringify({ ...head, verb: call.verb, login: call.login });
    }
}

const isManagedCommentKind = (value: string): value is ManagedCommentKind =>
    (MANAGED_COMMENT_KINDS as readonly string[]).includes(value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

/** One field, own properties only, so no prototype value arrives as a row's. */
const at = (value: unknown, name: string): unknown =>
    isRecord(value) && Object.hasOwn(value, name) ? value[name] : undefined;

const text = (value: unknown, name: string): string | null => {
    const read = at(value, name);
    return typeof read === "string" && read.length > 0 ? read : null;
};

/** The item a row names, or `null` when it names none this platform could act on. */
function itemOf(value: unknown): ItemRef | null {
    const kind = at(value, "kind");
    const number = at(value, "number");
    if (kind !== "issue" && kind !== "pullRequest") return null;
    if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 1) return null;
    return { kind, number };
}

/** The call one row carries, or `null` when the bytes are not one. */
function callOf(row: unknown): EffectCall | null {
    const verb = at(row, "verb");
    if (verb === "postComment") {
        const kind = text(row, "kind");
        const body = text(row, "body");
        if (kind === null || !isManagedCommentKind(kind) || body === null) return null;
        return { verb, kind, body };
    }
    if (verb === "addLabel" || verb === "removeLabel") {
        const label = text(row, "label");
        return label === null ? null : { verb, label };
    }
    if (verb === "unassign") {
        const login = text(row, "login");
        return login === null ? null : { verb, login };
    }
    return null;
}

/**
 * The call a journal row holds, or `null` when it holds none.
 *
 * Defensive in full, though this process wrote the bytes: they crossed a
 * durability boundary that outlives the version that wrote them, and the
 * caller's answer to `null` — close the row, resend nothing — is one it can
 * only give if this never throws.
 */
export function parseJournaledCall(row: string): JournaledCall | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(row);
    } catch {
        return null;
    }
    const capability = text(parsed, "capability");
    const item = itemOf(at(parsed, "item"));
    const call = callOf(parsed);
    if (capability === null || item === null || call === null) return null;
    return { capability, item, call };
}

// ─── The plan ────────────────────────────────────────────────────────

/** The calls one effect takes, or the reason it takes none. */
export type EffectPlan =
    | { readonly ok: true; readonly calls: readonly EffectCall[] }
    | { readonly ok: false; readonly code: EffectCode; readonly detail: string };

/**
 * The bytes a managed comment is posted as: the marker, then the capability's
 * content, separated by a blank line so GitHub renders the content as its own
 * first block. The marker must be first — `parseManagedMarker` requires it,
 * and a marker anywhere else is not even a claim (D125).
 */
export function renderManagedBody(marker: string, body: string): string {
    return `${marker}\n\n${body}`;
}

/** The own-flow positions of one entity kind, in `MAPPABLE_MEANINGS` order. */
function positionsOf(kind: ItemRef["kind"]): readonly MappableMeaning[] {
    return kind === "issue" ? ISSUE_MEANINGS : PR_MEANINGS;
}

/**
 * The position this move displaces, or `undefined` when the item held none.
 *
 * Read from the capability's own claim rather than from a live read, and that
 * is what makes it honest: `deriveWorld` refuses the write unless every
 * claimed meaning is one the authoritative projection actually observed, so a
 * claim that survives the gate is a fact. At most one own-flow position can
 * survive it — two project as a conflict, which `screenIntent` refuses — so
 * the first match is the only match.
 */
function displacedBy(intent: Intent<"applyMappedLabel">): MappableMeaning | undefined {
    return positionsOf(intent.item.kind).find(
        (meaning) =>
            meaning !== intent.desired.meaning && intent.expected.meaningsPresent.includes(meaning),
    );
}

/**
 * The calls one approved effect takes, in the order they must be sent.
 *
 * `applyMappedLabel` is add-then-remove, and the order is the decision. The
 * intermediate state carries two position labels, which projects as a conflict
 * — so every other capability's decision about the item safe-holds until the
 * removal lands, and a human sees an item that is obviously mid-move. Removing
 * first would leave a window with NO position, which reads as untriaged and
 * invites exactly the automation that should be waiting.
 *
 * `unassign` plans mechanically, one call like any other, and is refused where
 * every call is sent: the write surface is the four endpoints the matrix
 * confirmed, and none of them unassigns. Nothing in the catalogue constructs
 * it today, so the refusal is a shape this file keeps total rather than a path
 * anything travels.
 */
export function planFor(effect: ApprovedEffect, config: RepositoryConfig): EffectPlan {
    const { intent } = effect;
    if (intent.operation === "postManagedComment") {
        if (effect.managedComment === null) {
            return {
                ok: false,
                code: "identityMissing",
                detail: "the approved effect carries no managed-comment identity to post under",
            };
        }
        return {
            ok: true,
            calls: [
                {
                    verb: "postComment",
                    kind: intent.desired.kind,
                    body: renderManagedBody(effect.managedComment.marker, intent.desired.body),
                },
            ],
        };
    }
    if (intent.operation === "unassign") {
        return { ok: true, calls: [{ verb: "unassign", login: intent.desired.login }] };
    }

    const target = config.mappings.labels[intent.desired.meaning];
    if (target === undefined) {
        return {
            ok: false,
            code: "labelUnmapped",
            detail: `the repository maps no label to ${intent.desired.meaning}`,
        };
    }
    const displaced = displacedBy(intent);
    if (displaced === undefined) return { ok: true, calls: [{ verb: "addLabel", label: target }] };
    const previous = config.mappings.labels[displaced];
    if (previous === undefined) {
        return {
            ok: false,
            code: "labelUnmapped",
            detail: `the repository maps no label to the displaced position ${displaced}`,
        };
    }
    return {
        ok: true,
        calls: [
            { verb: "addLabel", label: target },
            { verb: "removeLabel", label: previous },
        ],
    };
}
