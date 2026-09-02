# Managed Output and Reporting

> **Not built — build guide.** No write path exists, so nothing here is implemented. This is the
> working answer to Q9 (managed-comment marker and schema) and the spec for the first reversible
> effect in `build-plan.md`.

- How the App creates comments, reactions, and health reports.
- It does not decide that comment metadata is the durable store for every recovery problem.

## 1. Platform ownership

| Owner | Owns |
|---|---|
| Capability | structured content, intended audience |
| Platform | marker, authorship check, rendering, update, write, audit |

- A capability cannot read arbitrary comments or search another capability's rendered text.
- Shared facts use normalized observations or declared resolvers, never comment wording.

## 2. Managed comment identity

```html
<!-- hiero-automation:{"schemaVersion":1,"capability":"prQuality","kind":"summary","effect":"0a70e62c14228dbe"} -->
```

- One short marker per purpose on the current issue or pull request.
- The marker contains a schema version, capability, comment kind, and effect identity.
- `effect` is a digest of the effect id, not the id: the id carries free text that has no business
  being published, and a reader only ever compares digests (D125).
- Core derives the whole marker; a capability supplies the kind and the body and can write none.
- The repository and item are already known from the comment's location.
- A marker counts only when the GitHub App authored the comment.
- The adapter finds the App-authored marker and creates the comment when it is missing.
- It updates the comment when the content changed, and does nothing when it is current.
- Duplicate, edited, deleted, or unreadable comments remain explicit results for recovery.

- Personal-sandbox coverage: pagination · two simultaneous creates · a lost create response ·
  an edited marker · a deleted comment · a restart.
- Protocol 6.5 (2026-07-23) covered the hard middle of that list.
- Two simultaneous creates duplicate without an owned claim.
- A lost create response is unrecoverable from local state alone.
- Restart recovery works from the marker read-back plus the owned journal.
- The edited-marker and deleted-comment cases remain for the implementation test.

## 3. Candidate output types

| Output type | Audience | Candidate use |
|---|---|---|
| Configuration report | maintainer, config author | invalid config, effective values |
| Command acknowledgement | the command's author | receipt, refusal, completion, unclear |
| Capability output | the participant who needs it | a PR dashboard, an assignment reason |
| Safety warning | the person facing the action | inactivity, timing, cancel, reverse |
| Repository health report | the repository maintainer | sustained problems |
| Operator record | the App operator | failures participants cannot fix |

- The configuration report also names missing permissions.
- A health report covers sustained configuration, permission, delivery, or processing problems.
- The final channel for each type depends on the permission manifest.
- A managed issue, pull request comment, check, log entry, or dashboard may each suit an audience.

## 4. Machine-readable metadata

Any metadata the platform reads must satisfy every rule below.

- The App verifies that it authored the comment.
- The metadata includes a schema version and stable logical identity.
- The parser rejects missing, malformed, oversized, or future-version data.
- Repository users cannot cause an operation by copying a marker into their own comment.
- A newer human action or current-state conflict still overrides an older pending operation.
- The platform has a documented response when the comment is edited or deleted.

- Metadata may identify a managed comment or recover comment-specific work.
- It is not automatically the system's write-ahead log.
- The recovery experiment decided the split (protocol 6.5, 2026-07-23).
- Comment metadata carries effect identity and receipt.
- The marker is what makes a retry-after-check safe and cleanup findable.
- Intent, deduplication, claims, and schedules belong in the owned operational store.
- Metadata records nothing before a write lands and cannot coordinate concurrent writers.
- See `design/findings/storage-decision.md` (ratification pending).

## 5. Command acknowledgements

The final acknowledgement states one of these outcomes in ordinary language.

- The command completed and the App verified the result.
- The requested state was already present.
- The current state changed before the command could apply.
- The installation lacks a required permission.
- GitHub asked the App to try later.
- The App cannot yet prove whether a write happened, and recovery is continuing.

- A reaction or first reply means only that the App received the command.
- It never claims that the requested GitHub changes succeeded.
- The command parser dispatches only newly created comments.
- Editing an acknowledged comment does not repeat or retarget the command.

## 6. Safety warnings

A safety warning must state all five facts.

1. What the App observed, and when it observed it.
2. The exact action that may occur, and the earliest action time.
3. How the affected person can cancel the action.
4. How a maintainer can reverse the action if it occurs.
5. Which configuration controls the timing.

- The effect executor, not the capability, decides whether warning and grace are still valid.
- That decision is taken when the action becomes due.

## 7. Content safety and tone

- The App writes as a project tool, not a person pretending to know intent.
- Messages use complete, plain sentences and describe facts, actions, and next steps.
- Rendering neutralizes mentions and markup from untrusted titles, user names, or other input.
- The App does not copy issue or pull request bodies into comments.
- It strips marker-like text from untrusted values before rendering.
- Messages stay concise for their audience.
- They never omit technical information needed to understand a failure or recovery step.

## 8. Resolution and retention

- Whether a resolved managed comment is shortened, retained, or deleted is a per-output decision.
- Safety, audit, and command outputs may require a durable visible history.
- A transient configuration report may be updated when the problem clears.
- Retention for operator records is defined separately from repository comments.
- Repository comments are not a substitute for an audit log with a documented retention policy.

## 9. Questions that remain open

- ~~The project must choose the marker and metadata schema after the sandbox experiment.~~
  Decided by D125 (2026-09-02): platform-owned, carrying schema version, capability, comment kind,
  and the effect id — the 6.5 harness's proven shape.
- The project must decide which output types use comments, issues, checks, or operator-only records.
- SQLite is the owned operational store; the executor design must define the exact command and safety
  progress records while comments remain user-facing receipts, not coordination state.
- The project must decide how duplicate managed comments are repaired without deleting human content.
- Maintainers must review the first real templates before a capability enters a pilot.
