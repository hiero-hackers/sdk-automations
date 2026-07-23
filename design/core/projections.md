# Managed Comments and Other Human-Facing Output

> This document proposes how the App creates comments, reactions, and health reports. It does not decide that
> comment metadata is the durable store for every recovery problem.

## 1. Platform ownership

Capabilities provide structured content and an intended audience. The platform owns the marker, authorship
check, rendering, update, write, and audit information.

A capability cannot read arbitrary comments or search another capability's rendered text. Shared facts must
use normalized observations or declared resolvers instead of comment wording.

## 2. Managed comment identity

A managed comment needs one short marker for its purpose on the current issue or pull request. For example:

```html
<!-- hiero-automation:v1:pr-quality:summary -->
```

The marker contains a schema version, capability, and comment kind. The repository and item are already
known from the comment's location. A marker counts only when the GitHub App authored the comment.

The adapter finds the App-authored marker, creates the comment when it is missing, updates it when the
content changed, and does nothing when the content is already current. Duplicate, edited, deleted, or
unreadable comments remain explicit results for recovery.

The personal-sandbox test must cover pagination, two simultaneous create attempts, a lost create response,
an edited marker, a deleted comment, and a restart. Protocol 6.5 (2026-07-23) covered the hard middle of
this list: two simultaneous creates duplicate without an owned claim, a lost create response is
unrecoverable from local state alone, and restart recovery works from the marker read-back plus the owned
journal. The edited-marker and deleted-comment cases remain for the managed-comment implementation test.

## 3. Candidate output types

| Output type | Intended audience | Candidate use |
|---|---|---|
| Configuration report | The repository maintainer or configuration author. | The report explains invalid configuration, effective values, and missing permissions. |
| Command acknowledgement | The person who issued a command. | The acknowledgement distinguishes receipt, refusal, completion, and an unclear result. |
| Capability output | The repository participant who needs the result. | Examples include a pull request dashboard or an assignment explanation. |
| Safety warning | The person affected by a later destructive action. | The warning states the observed inactivity, action time, cancellation path, and reversal path. |
| Repository health report | The repository maintainer. | The report explains sustained configuration, permission, delivery, or processing problems. |
| Operator record | The App operator. | The record explains failures that repository participants cannot fix. |

The final channel for each type depends on the permission manifest. A managed issue, pull request comment,
check, log entry, or dashboard may be appropriate for different audiences.

## 4. Machine-readable metadata

Comment metadata may help identify a managed comment or recover comment-specific work. It is not automatically
the system's write-ahead log.

Any metadata that the platform reads must satisfy the following rules.

- The App verifies that it authored the comment.
- The metadata includes a schema version and stable logical identity.
- The parser rejects missing, malformed, oversized, or future-version data.
- Repository users cannot cause an operation by copying a marker into their own comment.
- A newer human action or current-state conflict still overrides an older pending operation.
- The platform has a documented response when the comment is edited or deleted.

The recovery experiment decided this split (protocol 6.5, 2026-07-23): comment metadata carries effect
identity and receipt — the marker is what makes a retry-after-check safe and cleanup findable — while
intent, deduplication, claims, and schedules belong in the owned operational store. Metadata records nothing
before a write lands and cannot coordinate concurrent writers, so it is not the write-ahead log. See
`design/operations/storage-decision.md` (ratification pending).

## 5. Command acknowledgements

A reaction or first reply means only that the App received the command. It does not claim that all requested
GitHub changes succeeded.

The final acknowledgement states one of the following outcomes in ordinary language.

- The command completed and the App verified the result.
- The requested state was already present.
- The current state changed before the command could apply.
- The installation lacks a required permission.
- GitHub asked the App to try later.
- The App cannot yet prove whether a write happened, and recovery is continuing.

The command parser dispatches only newly created comments. Editing an acknowledged comment does not repeat or
retarget the command.

## 6. Safety warnings

A safety warning must state the following information.

1. The warning states what the App observed and when it observed it.
2. The warning states the exact action that may occur and the earliest action time.
3. The warning states how the affected person can cancel the action.
4. The warning states how a maintainer can reverse the action if it occurs.
5. The warning states which configuration controls the timing.

The effect executor, not the capability, decides whether the warning and grace period are still valid when
the action becomes due.

## 7. Content safety and tone

The App writes as a project tool, not as a person pretending to know intent. Its messages use complete,
plain sentences and describe facts, actions, and next steps.

Rendered repository content must neutralize mentions and markup that came from untrusted titles, user names,
or other input. The App does not copy issue or pull request bodies into comments. The App strips marker-like
text from untrusted values before rendering.

Messages remain concise enough for their audience, but they do not omit technical information needed to
understand a failure or recovery step.

## 8. Resolution and retention

Whether a resolved managed comment is shortened, retained, or deleted remains a per-output decision. Safety,
audit, and command outputs may require a durable visible history. A transient configuration report may be
updated when the problem clears.

The project must define retention for operator records separately from repository comments. Repository
comments are not a substitute for an operational audit log with a documented retention policy.

## 9. Questions that remain open

- The project must choose the marker and metadata schema after the sandbox experiment.
- The project must decide which output types use comments, issues, checks, or operator-only records.
- The storage experiment must decide whether command and safety progress belongs in comments or an owned
  store.
- The project must decide how duplicate managed comments are repaired without deleting human content.
- Maintainers must review the first real templates before a capability enters a pilot.
