/**
 * A GitHub that remembers, and the intents the write path is driven with.
 *
 * The fake is stateful on purpose: a read-back has to see what a write just
 * did, because "did the write land?" is the only question the applier ever
 * asks GitHub, and a reader that answered from a script would be a fake whose
 * kindness you cannot see (`CONTRIBUTING.md`, how the tests are built). Every departure
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
    writeRequestFor,
    type ClaimedFacts,
    type Effect,
    type Intent,
    type ItemRef,
    type MappableMeaning,
    type ManagedCommentKind,
    type RepositoryConfig,
    type RepositoryMode,
} from "@hiero-hackers/automation-core";
import { intakeDeclaration } from "@hiero-hackers/automation-capabilities";
import { expect } from "vitest";
import type {
    CommentSeen,
    EffectReader,
    EffectWriter,
    ItemSeen,
    ReadAnswer,
    SeenState,
    WriteResult,
} from "../../../src/shell/apply/operations/handler.js";
import type { Allowance } from "../../../src/shell/allowance.js";
import type { Spending } from "../spending.js";

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
        `schemaVersion: 2
mode: ${mode}
capabilities:
  intake:
    enabled: true
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
        `schemaVersion: 2
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

/** The instant every intent below is dated at — one occasion, for every effect. */
export const CAUSE_AT = new Date("2026-09-02T09:00:00.000Z");

const CAUSE = { cause: "issue opened", observedAt: CAUSE_AT };

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
): Effect {
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
        claims:
            options.displacing === undefined
                ? NO_CLAIM
                : { meaningsPresent: [options.displacing], meaningsAbsent: [], closed: null },
        desired: { meaning: options.meaning ?? "ready", cause: "triageCompleted" },
        cause: CAUSE,
        explanation: EXPLANATION,
        idempotencyKey: key,
        grace: null,
    };
    return { intent, managedComment: null, records: null };
}

/**
 * One managed comment, with the identity `decide()` would have minted for it.
 *
 * `observedAt` is what makes a SECOND OCCASION of the same purpose: a later
 * delivery about the same item mints a different effect id and the same
 * identity, which is the whole of D1's fix (K1).
 */
export function commentEffect(
    options: {
        readonly body?: string;
        readonly kind?: ManagedCommentKind;
        readonly topic?: string;
        readonly observedAt?: Date;
        readonly withIdentity?: boolean;
    } = {},
): Effect {
    const kind = options.kind ?? "summary";
    const topic = options.topic ?? "";
    const cause =
        options.observedAt === undefined ? CAUSE : { ...CAUSE, observedAt: options.observedAt };
    const key = deriveIdempotencyKey({
        capability: "intake",
        repository: REPOSITORY,
        item: ITEM,
        operation: "postManagedComment",
        cause,
    });
    const intent: Intent<"postManagedComment"> = {
        capability: "intake",
        repository: REPOSITORY,
        item: ITEM,
        operation: "postManagedComment",
        claims: NO_CLAIM,
        desired: { kind, topic, body: options.body ?? "Thanks for opening this." },
        cause,
        explanation: EXPLANATION,
        idempotencyKey: key,
        grace: null,
    };
    return {
        intent,
        managedComment:
            options.withIdentity === false
                ? null
                : managedCommentOf({ capability: "intake", item: ITEM, kind, topic }),
        records: null,
    };
}

/**
 * The grace an inactivity-shaped act carries, and the two effects `decide()`
 * makes of it (grace.md §2): the platform's warning comment, and the act it is
 * holding back. Attributed to `intake` like every other effect here, because
 * this harness's repository document adopts exactly one capability and the
 * applier's gates read the document, not the design the words came from.
 *
 * Built here rather than by calling `decide()`, for the reason the whole
 * harness exists: these suites are about what the applier does with an
 * approval, and an approval produced by running the engine would make every
 * failure two suites wide.
 */
const GRACE = {
    hours: 7 * 24,
    // The person whose clock this is — one release, one warning, one notice
    // per assignee (grace.md §3, D145).
    topic: "alice",
    warning: { body: "This assignment will be released on **2026-09-09**." },
    notice: { body: "This assignment was released after 21 days of inactivity." },
    cancelledBy: "a commit or a /working comment",
    reversesWith: "re-assign / reopen",
    activityAt: null,
} as const;

/** The warning comment's body — what a world already holding it must be given. */
export const WARNING_BODY = GRACE.warning.body;

/** The act's own effect id — the key a warning is recorded under. */
export const ACT_EFFECT_ID = deriveIdempotencyKey({
    capability: "intake",
    repository: REPOSITORY,
    item: ITEM,
    operation: "releaseAssignment",
    cause: CAUSE,
});

/** The graced act itself: two calls, the release and then its notice. */
export function releaseEffect(): Effect {
    const intent: Intent<"releaseAssignment"> = {
        capability: "intake",
        repository: REPOSITORY,
        item: ITEM,
        operation: "releaseAssignment",
        claims: NO_CLAIM,
        desired: { login: "alice" },
        cause: CAUSE,
        explanation: EXPLANATION,
        idempotencyKey: ACT_EFFECT_ID,
        grace: GRACE,
    };
    return {
        intent,
        managedComment: managedCommentOf({
            capability: "intake",
            item: ITEM,
            kind: "notice",
            topic: GRACE.topic,
        }),
        records: null,
    };
}

/**
 * The pull request a mode-claiming act names — a second item because a mode is
 * a pull request's and an issue is in neither.
 */
export const PULL: ItemRef = { kind: "pullRequest", number: 165 };

/** The close's own effect id — the key its warning is recorded under. */
export const CLOSE_EFFECT_ID = deriveIdempotencyKey({
    capability: "intake",
    repository: REPOSITORY,
    item: PULL,
    operation: "closePullRequest",
    cause: CAUSE,
});

/**
 * A graced close claiming a NATIVE MODE — inactivity's two mode reasons in the
 * shape the applier meets them.
 *
 * The claim is the whole point of the fixture: the re-gate re-reads the mode
 * and refuses the close when it moved, which is what makes an approval to
 * close a permission to close NOW.
 */
export function closeEffect(
    mode: "draft" | "changesRequested",
    activityAt: Date | null = null,
): Effect {
    const intent: Intent<"closePullRequest"> = {
        capability: "intake",
        repository: REPOSITORY,
        item: PULL,
        operation: "closePullRequest",
        claims: { meaningsPresent: [], meaningsAbsent: [], closed: false, pullRequestMode: mode },
        desired: { reason: "This pull request was closed after 60 days of inactivity." },
        cause: CAUSE,
        explanation: EXPLANATION,
        idempotencyKey: CLOSE_EFFECT_ID,
        grace: { ...GRACE, topic: mode, activityAt },
    };
    return {
        intent,
        managedComment: managedCommentOf({
            capability: "intake",
            item: PULL,
            kind: "notice",
            topic: mode,
        }),
        records: null,
    };
}

/** The platform's warning for that act, carrying what it records when it lands. */
export function warningEffect(): Effect {
    const effectId = `${ACT_EFFECT_ID}:warning`;
    const intent: Intent<"postManagedComment"> = {
        capability: "intake",
        repository: REPOSITORY,
        item: ITEM,
        operation: "postManagedComment",
        claims: NO_CLAIM,
        desired: { kind: "warning", topic: GRACE.topic, body: GRACE.warning.body },
        cause: CAUSE,
        explanation: EXPLANATION,
        idempotencyKey: effectId,
        grace: null,
    };
    return {
        intent,
        managedComment: managedCommentOf({
            capability: "intake",
            item: ITEM,
            kind: "warning",
            topic: GRACE.topic,
        }),
        records: {
            effectId: ACT_EFFECT_ID,
            request: writeRequestFor(releaseEffect().intent),
            gracePeriodHours: GRACE.hours,
            cancelledBy: GRACE.cancelledBy,
            reversesWith: GRACE.reversesWith,
        },
    };
}

/** The marker `decide()` mints for a comment effect — what a body must open with. */
export function markerOf(effect: Effect): string {
    const marker = effect.managedComment?.marker;
    expect(marker, "the effect carries a managed-comment identity").toBeDefined();
    return marker ?? "";
}

// ─── The GitHub that remembers ───────────────────────────────────────

/** One item, as this fake holds it. */
export interface FakeWorld {
    labels: string[];
    comments: CommentSeen[];
    /** The logins on the item, which a release takes one name off. */
    assignees: string[];
    closed: boolean;
    merged: boolean;
    /** The two native pull-request modes an apply-time claim is judged against. */
    draft: boolean;
    changesRequested: boolean;
    activityAt: Date | null;
}

/** Where a test bends the fake, and how. */
export interface Faults {
    /** Throw out of a write, before or after it changes the world. */
    crashOn: { readonly verb: string; readonly when: "beforeSend" | "afterSend" } | null;
    /** Answers handed to the next writes instead of performing them. */
    scripted: WriteResult[];
    /** The item read refuses. */
    itemReadFails: boolean;
    /** The reviews read refuses — the other half of a mode re-gate. */
    reviewReadFails: boolean;
    activityReadFails: boolean;
    /** The item read throws — an uncontained seam, which is a crash. */
    itemReadThrows: boolean;
    /** The item read refuses once a write has been sent — the read-back, not the re-gate. */
    itemReadFailsAfterSend: boolean;
    /** The comment list read refuses. */
    commentReadFails: boolean;
    /** The assignee read refuses — the release's whole read-back. */
    assigneeReadFails: boolean;
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
        assignees: [...(initial.assignees ?? [])],
        closed: initial.closed ?? false,
        merged: initial.merged ?? false,
        draft: initial.draft ?? false,
        changesRequested: initial.changesRequested ?? false,
        activityAt: initial.activityAt ?? null,
    };
    const calls: string[] = [];
    const faults: Faults = {
        crashOn: null,
        scripted: [],
        itemReadFails: false,
        reviewReadFails: false,
        activityReadFails: false,
        itemReadThrows: false,
        itemReadFailsAfterSend: false,
        commentReadFails: false,
        assigneeReadFails: false,
        presence: null,
    };
    let nextCommentId = 1;

    /** One write: recorded, faulted where a test asked, then performed. */
    const perform = (
        verb: string,
        argument: string,
        change: () => WriteResult,
        allowance?: Allowance,
    ): WriteResult => {
        calls.push(`${verb} ${argument}`);
        if (faults.crashOn?.verb === verb && faults.crashOn.when === "beforeSend") {
            throw new Error(`crash before ${verb}`);
        }
        const scripted = faults.scripted.shift();
        const answer = scripted ?? change();
        if (allowance !== undefined && answer.outcome !== "unsupported") {
            (allowance as Spending).charge("mutations");
        }
        if (faults.crashOn?.verb === verb && faults.crashOn.when === "afterSend") {
            throw new Error(`crash after ${verb}`);
        }
        if (faults.itemReadFailsAfterSend) faults.itemReadFails = true;
        return answer;
    };

    const writer: EffectWriter = {
        addLabel: (_item, label, allowance) =>
            Promise.resolve(
                perform(
                    "addLabel",
                    label,
                    () => {
                        if (!world.labels.includes(label)) world.labels.push(label);
                        return { outcome: "applied" };
                    },
                    allowance,
                ),
            ),
        removeLabel: (_item, label, allowance) =>
            Promise.resolve(
                perform(
                    "removeLabel",
                    label,
                    () => {
                        const at = world.labels.indexOf(label);
                        if (at < 0) return { outcome: "already" };
                        world.labels.splice(at, 1);
                        return { outcome: "applied" };
                    },
                    allowance,
                ),
            ),
        createComment: (_item, body, allowance) =>
            Promise.resolve(
                perform(
                    "createComment",
                    body,
                    () => {
                        world.comments.push(appComment(nextCommentId, body));
                        nextCommentId += 1;
                        return { outcome: "applied" };
                    },
                    allowance,
                ),
            ),
        updateComment: (commentId, body, allowance) =>
            Promise.resolve(
                perform(
                    "updateComment",
                    `#${String(commentId)}`,
                    () => {
                        const found = world.comments.find((comment) => comment.id === commentId);
                        if (found === undefined)
                            return { outcome: "conflict", detail: "no such comment" };
                        world.comments = world.comments.map((comment) =>
                            comment.id === commentId ? { ...comment, body } : comment,
                        );
                        return { outcome: "applied" };
                    },
                    allowance,
                ),
            ),
        closePullRequest: (item, allowance) =>
            Promise.resolve(
                perform(
                    "closePullRequest",
                    `#${String(item.number)}`,
                    () => {
                        if (world.closed) return { outcome: "already" };
                        world.closed = true;
                        return { outcome: "applied" };
                    },
                    allowance,
                ),
            ),
        releaseAssignment: (_item, login, allowance) =>
            Promise.resolve(
                perform(
                    "releaseAssignment",
                    login,
                    () => {
                        const at = world.assignees.indexOf(login);
                        if (at < 0) return { outcome: "already" };
                        world.assignees.splice(at, 1);
                        return { outcome: "applied" };
                    },
                    allowance,
                ),
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
                              draft: world.draft,
                          },
                      },
            );
        },
        changesRequested: () =>
            Promise.resolve(
                faults.reviewReadFails
                    ? { ok: false, detail: "GitHub refused the read" }
                    : { ok: true, value: world.changesRequested },
            ),
        pullRequestActivity: () =>
            Promise.resolve(
                faults.activityReadFails
                    ? { ok: false, detail: "GitHub refused the read" }
                    : { ok: true, value: world.activityAt },
            ),
        assignees: () =>
            Promise.resolve(
                faults.assigneeReadFails
                    ? { ok: false, detail: "GitHub refused the read" }
                    : { ok: true, value: [...world.assignees] },
            ),
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
