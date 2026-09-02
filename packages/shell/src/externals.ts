/**
 * The facts core cannot know, and how the processor obtains them for one
 * delivery. The live fill lives in the adapter and is composed only at
 * `main.ts`; the stub below is the credential-free path — CI permanently,
 * and any run without App credentials.
 */

import type { DecideExternals } from "@hiero-hackers/automation-core";

export type ShellExternals = Omit<DecideExternals, "now">;

/**
 * One delivery's externals, built from its raw payload.
 *
 * The live path resolves grants and binds the delivery's ordering-evidence
 * memo here; the stub path ignores both fields. A rejection releases the
 * processor's claim, so the delivery retries later rather than deciding on
 * facts that could not be established.
 *
 * `deliveryId` is passed for correlation only — nothing decides on it. It
 * is here because the live fill's diagnostics leave through seams of its
 * own, and a line about evidence that could not be read is worth nothing
 * unless it names the delivery that could not read it.
 */
export type ExternalsForDelivery = (delivery: {
    readonly payload: unknown;
    readonly deliveryId: string;
}) => ShellExternals | Promise<ShellExternals>;

export function stubbedExternals(overrides: Partial<ShellExternals> = {}): ShellExternals {
    return {
        killSwitchActive: false,
        installationGrants: ["issues:write"],
        /**
         * `null` (no ordering evidence), NOT `"unknown"`: `"unknown"` is a
         * safe conflict (manual-edits.md §2) and would refuse every write,
         * burying dry-run's interesting findings under a uniform refusal.
         * On this CREDENTIAL-FREE path dry-run reports OVERSTATE what
         * would apply (D93); the live path answers from the issue
         * timeline instead (D119).
         */
        latestHumanChangeAt: () => null,
        ...overrides,
    };
}
