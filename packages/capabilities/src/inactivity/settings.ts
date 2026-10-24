/**
 * The settings inactivity reads beside its `enabled` — `design.md`'s config
 * section as a spec: two ladders over one reminder and one reap.
 *
 * A level that acts is an enabled-block; one that only states a clock is a
 * section. Clocks inherit by name (`design/guides/capability-kits.md` §3.1).
 */

import {
    block,
    duration,
    flag,
    MIN_GRACE_HOURS,
    MIN_REAP_HOURS,
    section,
    spec,
} from "@hiero-hackers/automation-core/author";

/** The reminder every level below the root inherits. */
const remindAfter = duration({
    inherits: "remindAfter",
    doc: "Silence before this level's reminder, taken from the level above when unset",
});

/** One acting level's two clocks, spelled once and used at the four that act. */
const ladder = {
    remindAfter,
    reap: block(
        {
            after: duration({
                inherits: "reap.after",
                above: ["remindAfter", MIN_GRACE_HOURS],
                atLeast: MIN_REAP_HOURS,
                doc: "Silence before this level's release, taken from the level above when unset",
            }),
        },
        {
            doc: "Release what this level reminded about — absent or off means remind and never act",
        },
    ),
};

/** The five keys a repository may state, and what each is worth unstated. */
export const INACTIVITY_SETTINGS = spec({
    exemptBlocked: flag({
        default: true,
        doc: "Leave anything carrying the blocked meaning alone — no reminder, no release",
    }),
    remindAfter: duration({
        default: "30d",
        doc: "Silence before a reminder, for every ladder and reason that sets none of its own",
    }),
    reap: section(
        {
            after: duration({
                default: "60d",
                doc: "Silence before release — an issue is unassigned, a pull request closed",
            }),
        },
        {
            doc: "The release clock every ladder and reason inherits — consent is each acting level's own",
        },
    ),
    issues: block(
        { ...ladder },
        { doc: "Run the ladder on assigned issues that have no open pull request" },
    ),
    pullRequests: block(
        {
            remindAfter,
            reap: section(
                {
                    after: duration({
                        inherits: "reap.after",
                        doc: "The release clock this ladder's reasons inherit, taken from the capability default when unset",
                    }),
                },
                {
                    doc: "The release clock every reason below inherits — consent is each reason's own",
                },
            ),
            reapWhen: section(
                {
                    draft: block(
                        { ...ladder },
                        { doc: "Pull requests GitHub is holding as drafts — no mapping needed" },
                    ),
                    changesRequested: block(
                        { ...ladder },
                        {
                            doc: "Pull requests a reviewer asked for changes on, with no commit since — no mapping needed",
                        },
                    ),
                    needsRevision: block(
                        { ...ladder },
                        {
                            doc: "Pull requests carrying your needsRevision label, where a quality failure moves fast",
                        },
                    ),
                },
                {
                    doc: "The pull-request states the ladder applies in — one outside them is left alone",
                },
            ),
        },
        { doc: "Run the ladder on pull requests, linked to an issue or not" },
    ),
});
