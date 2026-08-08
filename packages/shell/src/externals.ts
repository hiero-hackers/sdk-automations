/**
 * The facts core cannot know, in their first-slice form: stubs with the
 * shape of the truth. Every stub is a named hole the read-only adapter
 * fills — the table of which stub becomes which read is in README.md.
 */

import type { DecideExternals } from "@hiero-hackers/automation-core";

/** Per-decision `now` is the processor's job; the rest stands between deliveries. */
export type ShellExternals = Omit<DecideExternals, "now">;

export function stubbedExternals(overrides: Partial<ShellExternals> = {}): ShellExternals {
    return {
        killSwitchActive: false,
        // Mirrors the sandbox App's actual grant; the adapter replaces this
        // with the installation's live grant list.
        installationGrants: ["issues:write"],
        /**
         * `null` (no ordering evidence), NOT `"unknown"`: `"unknown"` is a
         * safe conflict (manual-edits.md §2) and would refuse every write,
         * burying dry-run's interesting findings under a uniform refusal.
         * Until the adapter supplies timeline evidence, dry-run reports
         * OVERSTATE what would apply — recorded here and in D93.
         */
        latestHumanChangeAt: () => null,
        ...overrides,
    };
}
