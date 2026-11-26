/**
 * The settings prDashboard reads beside its `enabled`: `design.md`'s `checks`
 * block — five checks, each off until a repository enables it — and the
 * `signals` block of facts for reviewers, which no check or verdict reads.
 */

import { block, count, meanings, section, spec, text } from "@hiero-hackers/automation-core/author";

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
    signals: section(
        {
            blankDescription: block(
                {},
                { doc: "Tell reviewers whether the description is blank, HTML comments aside" },
            ),
            firstContribution: block(
                {},
                {
                    doc: "Tell reviewers whether GitHub counts this as the author's first contribution here",
                },
            ),
            diffSize: block(
                {
                    lines: count({
                        default: 500,
                        doc: "Lines added plus removed above which the size is called out",
                    }),
                },
                { doc: "Tell reviewers how many lines and files the pull request changes" },
            ),
        },
        {
            doc: "Facts for reviewers under the checks — never a check, never the verdict, each one off until it is enabled",
        },
    ),
    applyLabels: meanings({
        doc: "The positions the dashboard may set: needsRevision on any failure, needsReview when every check passes on a pull request that is ready for review",
    }),
});
