/**
 * The settings prDashboard reads beside its `enabled`: `design.md`'s `checks`
 * block — five checks, each off until a repository enables it.
 */

import { block, meanings, section, spec, text } from "@hiero-hackers/automation-core/author";

/** Where a failing check sends the contributor; the maintainer's own text. */
const guide = (doc: string) => text({ optional: true, doc });

const COMMIT_GUIDE =
    "A page explaining how to sign commits, shown to the contributor when this check fails";

export const PR_DASHBOARD_SETTINGS = spec({
    checks: section(
        {
            dcoSignoff: block(
                { guide: guide(COMMIT_GUIDE) },
                { doc: "Say so when a commit carries no Signed-off-by trailer" },
            ),
            gpgSignature: block(
                { guide: guide(COMMIT_GUIDE) },
                { doc: "Say so when a commit has no verified signature" },
            ),
            mergeConflicts: block({}, { doc: "Say so when the branch does not merge cleanly" }),
            linkedIssues: block(
                {
                    guide: guide(
                        "A page explaining how to link an issue, shown to the contributor when this check fails",
                    ),
                    assignedIssues: block(
                        {
                            guide: guide(
                                "A page explaining how to get assigned, shown to the contributor when this check fails",
                            ),
                        },
                        { doc: "Say so when the author is not assigned to every linked issue" },
                    ),
                },
                { doc: "Say so when a pull request references no issue" },
            ),
        },
        { doc: "The quality checks this repository runs — each one off until it is enabled" },
    ),
    applyLabels: meanings({
        doc: "The positions the dashboard may set: needsRevision on any failure, or when a review's change request is outstanding; needsReview when every check passes on a ready pull request the sweep read clear of outstanding change requests",
    }),
});
