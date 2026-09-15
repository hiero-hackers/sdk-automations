/**
 * The shell's log: one JSON line per event, over a closed vocabulary.
 * Every line about one delivery carries `deliveryId`, and the union below enforces it.
 * No `level` field and no dependency: `PROBLEM_EVENTS` picks stderr over stdout instead.
 */

import type { ReleaseDeliveryAfterFailureResult } from "../store/index.js";
import type { Lane, Spent } from "./allowance.js";
import type { EffectOutcomeCode } from "./effects.js";

/**
 * Every line the shell may write.
 * `detail` is always prose and the one field no consumer should parse.
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
          /** Whether this composition wired a write path; `absent` is the shipped default. */
          readonly writes: "armed" | "absent";
          /** Whether this composition reads the repository on a clock; `absent` is the default. */
          readonly sweep: "armed" | "absent";
          /** Whether `SUSPENDED=1` holds this installation: nothing is decided or read (D171). */
          readonly suspended: boolean;
      }
    | { readonly event: "shutdown"; readonly signal: string }
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
          /** Failures already counted against this delivery; 0 on its first pass. */
          readonly eventName: string;
          readonly attempts: number;
      }
    | {
          readonly event: "deliveryCompleted";
          readonly deliveryId: string;
          readonly kind:
              | "decision"
              | "configRejected"
              | "modeUnsupported"
              | "repositoryMismatch"
              | "installationSuspended";
          /** What an undecided record found: the errors, the mismatch, the reason. */
          readonly detail?: string;
      }
    | {
          readonly event: "deliveryAttemptFailed";
          readonly deliveryId: string;
          readonly disposition: ReleaseDeliveryAfterFailureResult["outcome"];
          /** `null` when the claim was already lost, so nothing was counted. */
          readonly attempts: number | null;
          readonly maxAttempts: number;
          readonly retryNotBefore: string | null;
          /** The lane whose allowance refused a read of this pass, where one did (D192). */
          readonly pool?: Lane;
          readonly detail: string;
      }
    | {
          readonly event: "deliveryDeadLettered";
          readonly deliveryId: string;
          readonly attempts: number;
      }
    | { readonly event: "orderingUnknown"; readonly deliveryId: string; readonly detail: string }
    | {
          /** A recovery pass closed an effect's open call; only the sweep says it here. */
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
          /** A due `sweep:` schedule row was claimed; a firing has begun. */
          readonly event: "sweepClaimed";
          readonly scheduleId: string;
          readonly dueAt: string;
      }
    | {
          /** The installation is suspended, so this firing read nothing at all (D171). */
          readonly event: "sweepSuspended";
          readonly scheduleId: string;
      }
    | {
          /** The open-item list could not be read, so this firing decided nothing. */
          readonly event: "sweepUnreadable";
          readonly scheduleId: string;
          readonly detail: string;
      }
    | {
          /** Stored reads this firing could not decode; each is read again and rewritten (D193). */
          readonly event: "snapshotUnreadable";
          readonly scheduleId: string;
          readonly rows: number;
      }
    | {
          /** The allowance stopped a firing short; the next one continues from the cursor (D192). */
          readonly event: "sweepPartial";
          readonly scheduleId: string;
          /** Items this firing answered before the allowance stopped it, stored reads included. */
          readonly read: number;
          readonly remaining: number;
          /** The item number the next firing resumes after. */
          readonly resumeAfter: number;
          /** Core requests this firing's reading spent (D192). */
          readonly requests: number;
      }
    | {
          /** GitHub's own numbers for one pool, said once as each window opens (D192). */
          readonly event: "limits";
          readonly pool: "core" | "graphql";
          readonly limit: number;
          readonly remaining: number;
          readonly resetAt: string;
      }
    | {
          /** A firing's retention pass removed something; it says nothing when it removed nothing. */
          readonly event: "sweepPruned";
          readonly deliveries: number;
          readonly effects: number;
          readonly decisions: number;
      }
    | {
          /** A firing ended and the next one is armed. */
          readonly event: "sweepFinished";
          readonly scheduleId: string;
          /** Open items the list held; `decided` says how many of them this firing answered. */
          readonly items: number;
          readonly decided: number;
          /** Records whose links went unread; see `sweep.ts` on the inverse. */
          readonly unread: number;
          /** Writes this firing spent of its cap (D167). */
          readonly writes: number;
          /** Approved effects the cap held back; the next firing decides each again. */
          readonly heldBack: number;
          /** Items the allowance left for the next firing (D192). */
          readonly remaining: number;
          /** Where the next firing starts reading; null starts the list again. */
          readonly resumeAfter: number | null;
          /** Items answered from their stored read rather than read again (D193). */
          readonly reused: number;
          /** What this firing spent of the allowance, per lane (D192). */
          readonly spent: Spent;
          /** This repository was left untouched for the next tick: the allowance was spent. */
          readonly deferred: boolean;
          readonly nextDueAt: string;
      }
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
 * The events an operator is meant to notice; everything else goes to stdout.
 * Each is a repository change this platform decided on, recorded, then did not make.
 */
const PROBLEM_EVENTS: ReadonlySet<ShellEvent["event"]> = new Set([
    "deliveryConflict",
    "acceptFailed",
    "deliveryAttemptFailed",
    "deliveryDeadLettered",
    "orderingUnknown",
    "effectRefused",
    "effectAbandoned",
    "sweepRequeued",
    "sweepFailed",
    "sweepUnreadable",
    "snapshotUnreadable",
    "drainFailed",
    "storeCloseFailed",
]);

/**
 * What a caught `unknown` says in a log line. Total by construction.
 * The fallback reads a prototype tag rather than calling code the thrower wrote.
 */
export function detailOf(error: unknown): string {
    if (typeof error === "string") return error;
    try {
        if (error instanceof Error) return error.stack ?? `${error.name}: ${error.message}`;
        return Object.prototype.toString.call(error);
    } catch {
        return "[unreadable thrown value]";
    }
}

/**
 * A log that cannot change what it observes.
 * Called from `catch` blocks and timer callbacks, where a throw would become the failure.
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

/** The production log. Serialization cannot fail: every field is a scalar or a string list. */
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
