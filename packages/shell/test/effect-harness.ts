/**
 * A GitHub that remembers, and the intents the write path is driven with.
 *
 * The fake is stateful on purpose: a read-back has to see what a write just
 * did, because "did the write land?" is the only question the applier ever
 * asks GitHub, and a reader that answered from a script would be a fake whose
 * kindness you cannot see (`design/guides/testing.md` §9). Every departure
 * from that — a read that refuses, a presence that cannot be established, a
 * write that dies mid-call — is set on `faults` by the test that needs it, so
 * the kindness is visible one line above the assertion.
 *
 * `faults.crashOn` is what places a crash inside a named window. A throw
 * BEFORE the world changes is a process that died between journalling and
 * GitHub; a throw AFTER it changed is one that died between GitHub and the
 * acknowledgement. Those are the two halves the recovery loop has to tell
 * apart, and nothing else in this repository can produce them.
 */

import {
    deriveIdempotencyKey,
    managedCommentOf,
    parseConfigDocument,
    type ApprovedEffect,
    type ClaimedFacts,
    type Intent,
    type ItemRef,
    type MappableMeaning,
    type ManagedCommentKind,
    type RepositoryConfig,
    type RepositoryMode,
} from "@hiero-hackers/automation-core";
import { intakeDeclaration } from "@hiero-hackers/automation-probes";
import { expect } from "vitest";
import type {
    CommentSeen,
    EffectReader,
    EffectWriter,
    ItemSeen,
    ReadAnswer,
    SeenState,
    WriteAnswer,
} from "../src/apply.js";

// ─── The repository under test ───────────────────────────────────────

export const REPOSITORY = { owner: "hiero-hackers", repo: "sdk-automations" } as const;
export const ITEM: ItemRef = { kind: "issue", number: 164 };

/** The instant every clock in these suites starts at. */
export const BASE = new Date("2026-09-02T10:00:00.000Z");

export const TRIAGE_LABEL = "status: triage";
export const READY_LABEL = "status: ready";
export const REVIEW_LABEL = "status: needs review";
export const MERGE_LABEL = "status: ready to merge";

/**
 * One repository configuration, in the mode the test needs.
 *
 * Parsed rather than built as a literal: `RepositoryConfig` carries a revision
 * and a validated shape, and a hand-made one would let a test pass against a
 * document the real parser would have rejected.
 *
 * `intake` is enabled in EVERY mode, including `disabled`. The two are
 * separate refusals with separate codes, and the capability rule runs first —
 * so a `disabled` document that also turned the capability off would refuse
 * under `capabilityDisabled` and never exercise the mode rule at all.
 */
export function configFor(mode: RepositoryMode = "active", revision = "rev-1"): RepositoryConfig {
    const result = parseConfigDocument(
        `schemaVersion: 1
mode: ${mode}
capabilities:
  intake:
    enabled: true
    settings:
      announce: false
mappings:
  labels:
    awaitingTriage: "${TRIAGE_LABEL}"
    ready: "${READY_LABEL}"
    needsReview: "${REVIEW_LABEL}"
    readyToMerge: "${MERGE_LABEL}"
`,
        { revision, knownCapabilities: [intakeDeclaration] },
    );
    expect(result.ok, "the harness configuration parses").toBe(true);
    if (!result.ok) throw new Error("unreachable: asserted above");
    return result.config;
}

/** The same document with `intake` disabled, which is its own refusal. */
export function configWithCapabilityOff(): RepositoryConfig {
    const result = parseConfigDocument(
        `schemaVersion: 1
mode: active
capabilities:
  intake:
    enabled: false
mappings:
  labels:
    awaitingTriage: "${TRIAGE_LABEL}"
    ready: "${READY_LABEL}"
    needsReview: "${REVIEW_LABEL}"
    readyToMerge: "${MERGE_LABEL}"
`,
        { revision: "rev-1", knownCapabilities: [intakeDeclaration] },
    );
    expect(result.ok, "the harness configuration parses").toBe(true);
    if (!result.ok) throw new Error("unreachable: asserted above");
    return result.config;
}

// ─── The intents ─────────────────────────────────────────────────────

const CAUSE = { cause: "issue opened", observedAt: new Date("2026-09-02T09:00:00.000Z") };

const EXPLANATION = {
    capability: "intake",
    summary: "the issue is newly opened",
    detail: ["no position label was present"],
};

const NO_CLAIM: ClaimedFacts = { meaningsPresent: [], meaningsAbsent: [], closed: null };

/** One label move, with the position it claims to displace. */
export function labelEffect(
    options: {
        readonly meaning?: MappableMeaning;
        readonly displacing?: MappableMeaning;
        readonly item?: ItemRef;
    } = {},
): ApprovedEffect {
    const item = options.item ?? ITEM;
    const key = deriveIdempotencyKey({
        capability: "intake",
        repository: REPOSITORY,
        item,
        operation: "applyMappedLabel",
        cause: CAUSE,
    });
    const intent: Intent<"applyMappedLabel"> = {
        capability: "intake",
        repository: REPOSITORY,
        item,
        operation: "applyMappedLabel",
        expected:
            options.displacing === undefined
                ? NO_CLAIM
                : { meaningsPresent: [options.displacing], meaningsAbsent: [], closed: null },
        desired: { meaning: options.meaning ?? "ready", cause: "triageCompleted" },
        cause: CAUSE,
        explanation: EXPLANATION,
        idempotencyKey: key,
    };
    return { intent, managedComment: null };
}

/** One managed comment, with the identity `decide()` would have minted for it. */
export function commentEffect(
    options: {
        readonly body?: string;
        readonly kind?: ManagedCommentKind;
        readonly withIdentity?: boolean;
    } = {},
): ApprovedEffect {
    const kind = options.kind ?? "summary";
    const key = deriveIdempotencyKey({
        capability: "intake",
        repository: REPOSITORY,
        item: ITEM,
        operation: "postManagedComment",
        cause: CAUSE,
    });
    const intent: Intent<"postManagedComment"> = {
        capability: "intake",
        repository: REPOSITORY,
        item: ITEM,
        operation: "postManagedComment",
        expected: NO_CLAIM,
        desired: { kind, body: options.body ?? "Thanks for opening this." },
        cause: CAUSE,
        explanation: EXPLANATION,
        idempotencyKey: key,
    };
    return {
        intent,
        managedComment:
            options.withIdentity === false
                ? null
                : managedCommentOf({ capability: "intake", kind, effectId: key }),
    };
}

/** The marker `decide()` mints for a comment effect — what a body must open with. */
export function markerOf(effect: ApprovedEffect): string {
    const marker = effect.managedComment?.marker;
    expect(marker, "the effect carries a managed-comment identity").toBeDefined();
    return marker ?? "";
}

// ─── The GitHub that remembers ───────────────────────────────────────

/** One item, as this fake holds it. */
export interface FakeWorld {
    labels: string[];
    comments: CommentSeen[];
    closed: boolean;
    merged: boolean;
}

/** Where a test bends the fake, and how. */
export interface Faults {
    /** Throw out of a write, before or after it changes the world. */
    crashOn: { readonly verb: string; readonly when: "beforeSend" | "afterSend" } | null;
    /** Answers handed to the next writes instead of performing them. */
    scripted: WriteAnswer[];
    /** The item read refuses. */
    itemReadFails: boolean;
    /** The item read throws — an uncontained seam, which is a crash. */
    itemReadThrows: boolean;
    /** The comment list read refuses. */
    commentReadFails: boolean;
    /** Every presence question answers this instead of consulting the world. */
    presence: SeenState | null;
}

export interface FakeGitHub {
    readonly world: FakeWorld;
    readonly writer: EffectWriter;
    readonly reader: EffectReader;
    /** Every write attempted, in order, as `verb argument`. */
    readonly calls: string[];
    readonly faults: Faults;
}

/** A comment this fake believes the App wrote. */
export const appComment = (id: number, body: string): CommentSeen => ({
    id,
    body,
    authoredByApp: true,
});

/** A comment carrying a copied marker under a person's name (D125's attack). */
export const copiedComment = (id: number, body: string): CommentSeen => ({
    id,
    body,
    authoredByApp: false,
});

export function fakeGitHub(initial: Partial<FakeWorld> = {}): FakeGitHub {
    const world: FakeWorld = {
        labels: [...(initial.labels ?? [])],
        comments: [...(initial.comments ?? [])],
        closed: initial.closed ?? false,
        merged: initial.merged ?? false,
    };
    const calls: string[] = [];
    const faults: Faults = {
        crashOn: null,
        scripted: [],
        itemReadFails: false,
        itemReadThrows: false,
        commentReadFails: false,
        presence: null,
    };
    let nextCommentId = 1;

    /** One write: recorded, faulted where a test asked, then performed. */
    const perform = (verb: string, argument: string, change: () => WriteAnswer): WriteAnswer => {
        calls.push(`${verb} ${argument}`);
        if (faults.crashOn?.verb === verb && faults.crashOn.when === "beforeSend") {
            throw new Error(`crash before ${verb}`);
        }
        const scripted = faults.scripted.shift();
        const answer = scripted ?? change();
        if (faults.crashOn?.verb === verb && faults.crashOn.when === "afterSend") {
            throw new Error(`crash after ${verb}`);
        }
        return answer;
    };

    const writer: EffectWriter = {
        addLabel: (_item, label) =>
            Promise.resolve(
                perform("addLabel", label, () => {
                    if (!world.labels.includes(label)) world.labels.push(label);
                    return { outcome: "applied" };
                }),
            ),
        removeLabel: (_item, label) =>
            Promise.resolve(
                perform("removeLabel", label, () => {
                    const at = world.labels.indexOf(label);
                    if (at < 0) return { outcome: "already" };
                    world.labels.splice(at, 1);
                    return { outcome: "applied" };
                }),
            ),
        createComment: (_item, body) =>
            Promise.resolve(
                perform("createComment", body, () => {
                    world.comments.push(appComment(nextCommentId, body));
                    nextCommentId += 1;
                    return { outcome: "applied" };
                }),
            ),
        updateComment: (commentId, body) =>
            Promise.resolve(
                perform("updateComment", `#${String(commentId)}`, () => {
                    const found = world.comments.find((comment) => comment.id === commentId);
                    if (found === undefined)
                        return { outcome: "conflict", detail: "no such comment" };
                    world.comments = world.comments.map((comment) =>
                        comment.id === commentId ? { ...comment, body } : comment,
                    );
                    return { outcome: "applied" };
                }),
            ),
    };

    const presenceOf = (holds: boolean): SeenState =>
        faults.presence ?? (holds ? "present" : "absent");

    const reader: EffectReader = {
        comments: () =>
            Promise.resolve(
                faults.commentReadFails
                    ? { ok: false, detail: "GitHub refused the read" }
                    : { ok: true, value: [...world.comments] },
            ),
        labels: () => Promise.resolve({ ok: true, value: [...world.labels] }),
        item: (): Promise<ReadAnswer<ItemSeen>> => {
            if (faults.itemReadThrows) throw new Error("the item read seam broke");
            return Promise.resolve(
                faults.itemReadFails
                    ? { ok: false, detail: "GitHub refused the read" }
                    : {
                          ok: true,
                          value: {
                              labels: [...world.labels],
                              closed: world.closed,
                              merged: world.merged,
                          },
                      },
            );
        },
        commentPresence: (_item, matches) =>
            Promise.resolve(presenceOf(world.comments.some(matches))),
        labelPresence: (_item, label) => Promise.resolve(presenceOf(world.labels.includes(label))),
    };

    return { world, writer, reader, calls, faults };
}

/** Every write of one verb, in order — what a duplicate would show up in. */
export function callsOf(github: FakeGitHub, verb: string): string[] {
    return github.calls.filter((call) => call.startsWith(`${verb} `));
}

/** Comments this fake believes the App wrote. */
export function appComments(github: FakeGitHub): readonly CommentSeen[] {
    return github.world.comments.filter((comment) => comment.authoredByApp);
}
