/**
 * The shell's log: one JSON line per event, over a closed vocabulary.
 *
 * The question this exists to answer is "what happened to delivery X", so
 * every line about one delivery carries `deliveryId`, and the union below
 * is what enforces that — a variant that omitted the field would fail to
 * compile at the site that emits it. Every line also carries `at` and
 * `event`; nothing else is universal.
 *
 * There is deliberately no `level` field. The vocabulary is closed and
 * small enough to read, so the event name already says whether a line is
 * routine, and a second severity vocabulary would only be a thing to keep
 * in step with the first. `PROBLEM_EVENTS` picks stderr over stdout
 * instead, for the operator who watches only one of the two.
 *
 * No dependency, and none wanted: a logging library arrives with
 * transports, levels and configuration for a surface of nineteen events.
 */

import type { ReleaseDeliveryAfterFailureResult } from "@hiero-hackers/automation-store";
import type { EffectOutcomeCode } from "./effects.js";

/**
 * Every line the shell may write.
 *
 * `detail` is always prose about what went wrong — the one field no
 * consumer should parse. `kind` mirrors the record union in `processor.ts`,
 * so a fifth record kind fails to compile here until this list admits it.
 */
export type ShellEvent =
    | {
          readonly event: "startup";
          readonly port: number;
          /** `null` is the unnamed bind: every interface (see `main.ts`). */
          readonly host: string | null;
          readonly repository: string;
          readonly configSource: "live" | "local";
          readonly configPath: string;
          readonly storePath: string;
          /**
           * Whether this composition wired a write path. `absent` is the
           * shipped default and the reason `mode: active` records
           * `modeUnsupported`; see `main.ts` on `APP_SLUG`.
           */
          readonly writes: "armed" | "absent";
      }
    | { readonly event: "shutdown"; readonly signal: string }
    | {
          /** The superseded default holds a store this run will not read. */
          readonly event: "legacyStoreFound";
          readonly legacyPath: string;
          readonly storePath: string;
      }
    | {
          readonly event: "deliveryAccepted";
          readonly deliveryId: string;
          readonly eventName: string;
      }
    | {
          readonly event: "deliveryDuplicate";
          readonly deliveryId: string;
          readonly eventName: string;
      }
    | {
          readonly event: "deliveryConflict";
          readonly deliveryId: string;
          readonly eventName: string;
      }
    | { readonly event: "acceptFailed"; readonly deliveryId: string; readonly detail: string }
    | {
          readonly event: "deliveryClaimed";
          readonly deliveryId: string;
          readonly eventName: string;
          /** Failures already counted against this delivery; 0 on its first pass. */
          readonly attempts: number;
      }
    | {
          readonly event: "deliveryCompleted";
          readonly deliveryId: string;
          readonly kind: "decision" | "configRejected" | "modeUnsupported" | "repositoryMismatch";
      }
    | {
          readonly event: "deliveryAttemptFailed";
          readonly deliveryId: string;
          readonly disposition: ReleaseDeliveryAfterFailureResult["outcome"];
          /** `null` when the claim was already lost, so nothing was counted. */
          readonly attempts: number | null;
          readonly maxAttempts: number;
          readonly retryNotBefore: string | null;
          readonly detail: string;
      }
    | {
          readonly event: "deliveryDeadLettered";
          readonly deliveryId: string;
          readonly attempts: number;
      }
    | { readonly event: "orderingUnknown"; readonly deliveryId: string; readonly detail: string }
    | {
          /**
           * A recovery pass closed an effect's open call — the write landed
           * after all, or a resend made it land. The delivery lane reports its
           * own effects in the record instead; only the sweep says it here.
           */
          readonly event: "effectApplied";
          readonly effectId: string;
          readonly seq: number;
      }
    | {
          /** A recovery pass refused an effect's open call and closed the row. */
          readonly event: "effectRefused";
          readonly effectId: string;
          readonly seq: number;
          readonly code: EffectOutcomeCode | null;
          readonly detail: string | null;
      }
    | {
          /** The attempt cap ran out: the row is closed and nothing will resend it. */
          readonly event: "effectAbandoned";
          readonly effectId: string;
          readonly seq: number;
          readonly attempts: number;
      }
    | {
          readonly event: "sweepRequeued";
          readonly requeued: number;
          readonly deliveryIds: readonly string[];
      }
    | { readonly event: "sweepFailed"; readonly detail: string }
    | {
          readonly event: "drainFailed";
          /** Which pump: the one a start, an acknowledgement, or a sweep began. */
          readonly phase: "startup" | "accepted" | "sweep";
          readonly detail: string;
      }
    | { readonly event: "storeCloseFailed"; readonly detail: string };

/** Say one thing. The seam every shell component is handed. */
export type Log = (event: ShellEvent) => void;

/**
 * The events an operator is meant to notice. Everything else is the shell
 * doing its job, and goes to stdout.
 *
 * `sweepRequeued` and `deliveryConflict` are here on purpose: a requeue
 * means some worker died holding a claim, and a conflict means one delivery
 * GUID arrived under two different bodies. `effectRefused` and
 * `effectAbandoned` join them for the same reason: each is a repository change
 * this platform decided on, journalled, and then did not make.
 * `effectApplied` stays on stdout — a recovery that worked is the recovery
 * doing its job.
 */
const PROBLEM_EVENTS: ReadonlySet<ShellEvent["event"]> = new Set([
    "legacyStoreFound",
    "deliveryConflict",
    "acceptFailed",
    "deliveryAttemptFailed",
    "deliveryDeadLettered",
    "orderingUnknown",
    "effectRefused",
    "effectAbandoned",
    "sweepRequeued",
    "sweepFailed",
    "drainFailed",
    "storeCloseFailed",
]);

/**
 * What a caught `unknown` says in a log line. Total by construction: the
 * fallback reads a tag off the prototype rather than calling `toString`,
 * which is code the thrower could have written.
 */
export function detailOf(error: unknown): string {
    if (error instanceof Error) return error.stack ?? `${error.name}: ${error.message}`;
    if (typeof error === "string") return error;
    return Object.prototype.toString.call(error);
}

/**
 * A log that cannot change what it observes.
 *
 * The seam is called from `catch` blocks and from timer callbacks, where an
 * escaping throw would turn a diagnostic into the failure it was describing.
 * Contained once, at the seam — the same treatment the adapter's
 * `onUnknownOrdering` gets, for the same reason.
 */
export function contained(log: Log): Log {
    return (event) => {
        try {
            log(event);
        } catch {
            // Nothing to report it to: reporting is the thing that broke.
        }
    };
}

export interface LoggerOptions {
    readonly clock?: () => Date;
    /** The two sinks, injectable so a test can read the bytes themselves. */
    readonly out?: (line: string) => void;
    readonly err?: (line: string) => void;
}

/**
 * The production log. Serialization cannot fail: every field in the union
 * above is a string, a number, a boolean, `null`, or a list of strings, so
 * there is no cycle for `JSON.stringify` to meet and no `undefined` to drop.
 */
export function createLogger(options: LoggerOptions = {}): Log {
    const clock = options.clock ?? (() => new Date());
    const out = options.out ?? ((line: string) => void process.stdout.write(line));
    const err = options.err ?? ((line: string) => void process.stderr.write(line));
    return (event) => {
        const line = `${JSON.stringify({ at: clock().toISOString(), ...event })}\n`;
        if (PROBLEM_EVENTS.has(event.event)) err(line);
        else out(line);
    };
}
