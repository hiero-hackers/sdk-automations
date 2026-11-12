/**
 * The exemptions a repository chose, recorded only where one held back a
 * reminder or a release, so the run counts the work they hide (D252).
 */

import type { PlatformHandle } from "@hiero-hackers/automation-core/author";
import type { InactivityDeclaration } from "./declaration.js";

type Platform = PlatformHandle<InactivityDeclaration>;

/** The author-side rules a pull request can be exempt under. */
export type AuthorExemption = "exemptMaintainers" | "exemptBots";

export function exemptedAsBlocked(platform: Platform, stale: readonly string[]): void {
    platform.exempt("Exempt under exemptBlocked: the item carries the blocked meaning.", ...stale);
}

export function exemptedAssignee(platform: Platform, login: string, stale: string): void {
    platform.exempt(`Exempt under exemptMaintainers: ${login} is listed.`, stale);
}

export function exemptedAuthor(
    platform: Platform,
    rule: AuthorExemption,
    author: string,
    stale: string,
): void {
    const who = rule === "exemptBots" ? "a bot" : "a listed maintainer";
    platform.exempt(`Exempt under ${rule}: ${author}, ${who}, opened this pull request.`, stale);
}
