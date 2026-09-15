/** What one firing of the sweep may spend, and how long until the next one. */

/** How often a repository is read when nothing says otherwise; the smallest reap a `duration` may state is two hours. */
export const DEFAULT_SWEEP_CADENCE_MS = 60 * 60_000;

/** How many writes one tick may send before it carries the rest to the next (D167, D192). */
export const SWEEP_WRITE_CALLS = 20;

/** The share of each of GitHub's own pools one installation's sweep may spend (D192, D193). */
export const SWEEP_SHARE = 0.4;

/** How long a change settles before the item is decided from a read (`2026-09-15T15-18-19-663Z`). */
export const REVIEW_SETTLE_MS = 60_000;

/** How long a stored read may be decided from, whatever `updated_at` says (`2026-09-15T15-24-19-397Z`). */
export const SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60_000;
