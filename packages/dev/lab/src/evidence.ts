/**
 * A run's raw evidence: one append-only JSONL per run under the untracked `evidence/`.
 * Nothing tracked reads it, and no credential reaches it — `safeHeaders` drops the carriers.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Header names whose value is or may carry a credential. */
const CREDENTIAL_HEADERS: ReadonlySet<string> = new Set([
    "authorization",
    "cookie",
    "set-cookie",
    "proxy-authorization",
]);

export interface EvidenceRecord {
    /** Citable id, `<run>#<seq>`. */
    readonly id: string;
    readonly at: string;
    readonly experiment: string;
    readonly step: string;
    readonly detail: Readonly<Record<string, unknown>>;
}

/** Every header except the ones that carry a credential. */
export function safeHeaders(headers: Readonly<Record<string, string>>): Record<string, string> {
    return Object.fromEntries(
        Object.entries(headers).filter(([name]) => !CREDENTIAL_HEADERS.has(name.toLowerCase())),
    );
}

/** One run's log. Write-once: a record is appended and never rewritten. */
export class EvidenceLog {
    private sequence = 0;
    private readonly path: string;

    constructor(
        private readonly experiment: string,
        private readonly runId: string = new Date().toISOString().replace(/[:.]/g, "-"),
        directory: string = fileURLToPath(new URL("../evidence/", import.meta.url)),
    ) {
        mkdirSync(directory, { recursive: true });
        this.path = join(directory, `${experiment}-${this.runId}.jsonl`);
    }

    record(step: string, detail: Readonly<Record<string, unknown>>): string {
        this.sequence += 1;
        const written: EvidenceRecord = {
            id: `${this.runId}#${String(this.sequence)}`,
            at: new Date().toISOString(),
            experiment: this.experiment,
            step,
            detail,
        };
        appendFileSync(this.path, `${JSON.stringify(written)}\n`);
        return written.id;
    }

    get file(): string {
        return this.path;
    }
}
