/** Repository configuration identity and the seam it arrives through. */

import { createHash } from "node:crypto";

/** The path inside the configured repository, relative to its root (D93). */
export const CONFIG_PATH = "sdk-automations.yml";
export const ABSENT_CONFIG_REVISION = "sha256:absent";
export const UNREADABLE_CONFIG_REVISION = "sha256:unreadable";

/** Content-addressed: the SAME text is the SAME revision, whichever source loaded it. */
export function revisionOf(text: string): string {
    return `sha256:${createHash("sha256").update(text).digest("hex").slice(0, 12)}`;
}

export interface ConfigDocument {
    readonly revision: string;
    readonly text: string;
}

/** One load attempt's outcome, never a throw (D122). `permanent` means no retry helps. */
export type ConfigLoadOutcome =
    | { readonly ok: true; readonly document: ConfigDocument }
    | {
          readonly ok: false;
          readonly permanent: true;
          readonly detail: string;
          /** The defective file's own revision, when the source saw one. */
          readonly revision?: string;
      }
    | { readonly ok: false; readonly permanent: false; readonly detail: string };

/** Where a repository's configuration text comes from; one per composition. */
export interface ConfigSource {
    load(): Promise<ConfigLoadOutcome>;
}
