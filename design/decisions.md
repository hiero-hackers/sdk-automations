# Decision and Evidence Register

> This register separates principles that current evidence supports from hypotheses that still need
> maintainer review or sandbox experiments. A document does not become approved merely because it appears in
> this repository or in pull request 23.

## 1. Status meanings

The register uses the following status values.

| Status | Meaning |
|---|---|
| `supported` | The audits, accepted proposal, and current research are strong enough to guide the next work. |
| `hypothesis` | The idea is technically plausible, but maintainers or experiments must still confirm it. |
| `reopened` | New evidence has challenged an earlier proposal, so it must not guide implementation yet. |
| `ratified` | Maintainers have explicitly approved the decision and recorded the date and evidence. |
| `replaced` | A later decision has replaced the earlier proposal. |

## 2. Supported product principles

| Identifier | Principle | Evidence |
|---|---|---|
| P1 | The product is one hosted GitHub App with repository-selected capabilities. | The accepted proposal and `planning/goals.md` support this direction. |
| P2 | A repository must explicitly enable every workflow-changing capability, and every user-facing capability defaults to off. | Maintainer consent and the different C++, Python, and JavaScript workflows require explicit opt-in. |
| P3 | A capability does not call or import another capability. | The coupling audit shows that direct and hidden sibling contracts are difficult to test and change. |
| P4 | A capability receives only its own configuration and a narrow platform interface. | The C++ shared-config coupling and GitHub API mock drift support a smaller boundary. |
| P5 | GitHub remains authoritative for visible repository facts. | Labels, assignees, reviews, comments, and open or closed state must continue to reflect human edits. |
| P6 | The design does not assume that GitHub alone stores every operational recovery record. | Webhook delivery, multi-call recovery, and coordination require feasibility experiments. |
| P7 | Repository labels and fields are mappings or profile defaults rather than universal platform strings. | The three audited SDKs use materially different workflow models. |
| P8 | Testing begins with a development App and personal sandbox before any Hiero repository receives writes. | The permission and failure risks require an isolated validation path. |
| P9 | A production webhook receiver durably accepts work before it acknowledges the delivery. | GitHub requires a quick response and does not automatically redeliver every failed delivery, so an acknowledged in-memory event cannot provide reliable recovery. Demonstrated in the sandbox (experiment 6.2, 2026-07-23): a crash after acknowledgement but before durable acceptance lost the delivery while GitHub's ledger recorded success; an ack-first relay in the transport path recreates the same loss window with no crash at all. |

## 3. Earlier design proposals and their current status

The identifiers below preserve references from the existing documents. Their current status is explicit so
that older text cannot be mistaken for approval.

| Identifier | Earlier proposal | Current status | Required next evidence |
|---|---|---|---|
| D1 | GitHub and App-authored comments provide all durable state, so the App needs no owned operational store. | `replaced` | Rejected by experiment 6.5 (2026-07-23): deduplication, pending-effect detection, and coordination each required owned state, and GitHub's delivery ledger records success for deliveries the receiver lost (6.2). Replaced by the storage decision (`design/operations/storage-decision.md`): a small single-file owned store, with GitHub keeping all effect outcomes. Ratification pending per §5. |
| D2 | Issues and pull requests use separate workflow models, and cross-entity writes require an explicit operation. | `hypothesis` | Candidate capabilities must show which cross-entity reads and writes they need. |
| D3 | Every repository uses one fixed twelve-label taxonomy. | `replaced` | P7 replaces this proposal with stable internal meanings and repository mappings or optional profiles. |
| D4 | The platform removes only named managed labels and never removes a namespace prefix. | `supported` | Adapter tests must enforce the rule for every label operation. |
| D5 | The full Hiero workflow profile has one invariant for each position. | `hypothesis` | Repositories that want the profile must review the invariants before activation. |
| D6 | Human edits and capability requests use different rulebooks. | `hypothesis` | Concurrency and manual-edit scenarios must confirm the behavior for each selected capability. |
| D7 | The App does not reverse a newer human change unless maintainers approve a named exception. | `supported` | Effect tests must prove the precondition and newer-change checks. |
| D8 | Incoherent mapped states use the five classes described in `core/manual-edits.md`. | `hypothesis` | The selected workflow profile must prove that all five classes are needed and understandable. |
| D9 | Timeline timestamps can enforce the newer-fact rule at acceptable cost. | `supported` | Cost confirmed by experiment 6.4 (2026-07-23): a busy issue's full timeline is one request (up to one hundred events, about half a second), conditional re-reads cost nothing, and a fifty-repository sweep fits the measured budget. Timestamp reliability for the newer-fact rule still rides with the D6/D8 manual-edit scenarios. |
| D10 | Clock-triggered destructive actions always warn before they act and provide a simple reversal. | `supported` | Each destructive capability must provide its own warning, grace, cancellation, and rollback tests. |
| D11 | Removing `blocked` resets an inactivity clock instead of resuming it. | `hypothesis` | Maintainers must decide this policy for a profile that enables inactivity handling. |
| D12 | Capabilities provide structured comment content, while the platform owns managed comment identity and writes. | `supported` | The managed-comment sandbox test must prove idempotent update and authorship checks. |
| D13 | Exactly two comment types may carry metadata that the platform reads back. | `supported` | Narrowed by experiment 6.5 (2026-07-23): metadata is read back as effect identity and receipt — the marker is what made retry-after-check safe — but it is not operational storage and records nothing before a write lands. See `design/operations/storage-decision.md`. |
| D14 | Resolved managed comments are shortened instead of deleted. | `hypothesis` | Maintainers must review the contributor experience for the first real comment type. |
| D15 | GitHub closing references are the only supported issue and pull request link mechanism. | `hypothesis` | The first capability that needs links must confirm the repository policy and fork behavior. |
| D16 | Skill credit is organization-wide while each repository chooses issue difficulty. | `reopened` | A skill ladder is optional, and repositories that request it must decide credit scope and completion rules. |
| D17 | Configuration exposes only choices on which reasonable repositories differ. | `supported` | Each key must state the repository choice that justifies it and the safe validation range. |
| D18 | One process and business-hours operation are sufficient because later sweeps repair missed work. | `supported` | Experiments 6.2 and 6.5 (2026-07-23): a single durable-first process plus the owned journal and a reconciliation sweep over the deliveries API (thirty-day retention) recovered every induced loss, including deliveries GitHub records as successfully delivered. Two conditions attach: detection requires the owned store (the ledger never flags a loss), and availability beyond business hours remains an operator decision under Q1/Q13. |
| D19 | A hosted App is preferable to copied repository workflows. | `supported` | The project still needs an operator and hosting decision before production deployment. |
| D20 | One adapter controls rate limits, retries, pacing, and conditional reads. | `supported` | Measured by experiment 6.4 (2026-07-23): uniform one-unit pricing, free 304 re-reads, and a content-creation secondary limit that arrives with no `retry-after` header near eighty writes per minute. One consequence is now explicit: the adapter must own retry and backoff itself — Octokit's default plugins absorb exactly these signals invisibly. |
| D21 | Every failure class has one primary audience and a clear recovery message. | `supported` | The first implementation must verify the channel and permission needed for each message. |
| D22 | Rollout uses a personal sandbox, a Hiero Hackers sandbox, shadow mode, reversible writes, and explicit kill switches. | `supported` | Owners and entry criteria must be recorded before each environment is used. |
| D23 | A capability declares its configuration, inputs, intents, permissions, triggers, and operational needs. | `hypothesis` | The first two candidate capabilities must fit the contract without receiving a raw GitHub client. Experiment 6.3 (`FINDING(config-capability-registry-gap)`) adds a requirement: the platform needs a capability registry checked at configuration load, or configurations enabling unknown capabilities pass validation silently. Experiment 6.5 adds another: each declared effect should name its idempotency class, since a lost-response retry duplicates comment creation but is harmless for label addition. |
| D24 | Current-state checks and comment records can recover every interrupted multi-call operation. | `replaced` | Rejected by experiment 6.5 (2026-07-23): current state cannot see pending work (an absent effect is indistinguishable from one never requested), and after a lost response a naive retry duplicated the effect on the first attempt. Replaced by the storage decision's model — the intent journal detects, a GitHub re-read resolves. Ratification pending per §5. |
| D25 | The threat controls in `operations/threat-model.md` are sufficient for the first release. | `hypothesis` | A red-team pass and sandbox evidence must confirm the controls before a real pilot. |
| D26 | The twelve GitHub label strings are fixed in code and cannot be configured. | `replaced` | P7 replaces this proposal. Code may keep stable meanings, while repositories configure mappings or select a profile. |
| D27 | Comment metadata is the App's write-ahead log and only durable operational state. | `replaced` | Rejected by experiment 6.5 (2026-07-23) on observed grounds: it records nothing before a write lands, covers only comment-shaped effects, and cannot coordinate — the two-worker race duplicated the effect even with the read-check this proposal relies on, because GitHub offers no conditional create. Each write-ahead write would also cost into the unsignaled secondary limit measured in 6.4. Replaced by the storage decision. Ratification pending per §5. |

### Hypotheses surfaced by the pure-logic implementation

Coding the taxonomy, safety, and configuration prose into `core/` forced four ambiguities into concrete
choices. Each choice is tagged `FINDING(...)` in the source at the exact place the assumption was made, and
the invariant tests in `core/test/` exercise the chosen behavior. The code is evidence that the choice is
*coherent*, not that it is *right* — each row still needs the named review.

| Identifier | Choice the code had to make | Current status | Required next evidence |
|---|---|---|---|
| D28 | `blocked` is an orthogonal pause flag, not a workflow position: an item keeps its position while blocked, and unblocking restores it unchanged. `taxonomy.md` §2 lists `blocked` as a meaning, but neither state diagram contains it, and `safety.md` treats it as a pause. (`core/src/taxonomy.ts`, `FINDING(taxonomy-blocked)`.) | `hypothesis` | Maintainers must confirm the flag model when reviewing the workflow profile, or the diagrams must gain explicit `blocked` positions. |
| D29 | Manual entry into any state is recorded as observed reality to reconcile, not as a requestable transition: the exhaustive transition matrix rejects module requests for edges the diagrams do not contain, while human edits may still land anywhere. The prose rule "every state has a non-module way in" implies edges the diagrams omit. (`core/src/taxonomy.ts`, `FINDING(taxonomy-manual-entry)`.) | `hypothesis` | The manual-edit scenarios under D6/D8 must confirm reconciliation matches maintainer expectations for each profile state. |
| D30 | Grace periods have a floor of one day (`MIN_GRACE_DAYS = 1`): a destructive clock-triggered action cannot be configured to warn and act in the same instant. `safety.md` §4 requires "safe" bounds but names none. (`core/src/safety.ts`, `FINDING(safety-grace-floor)`.) | `hypothesis` | Maintainers must ratify the floor value (or a different one) when the first destructive capability is reviewed under D10. |
| D31 | The no-configuration mode is named `observe`: with no reviewed configuration, the App reads and reports but performs no workflow-changing writes. `schema.md` §2.2 requires the behavior but does not name the mode; `observe` was chosen over `disabled` because the platform still watches and audits. (`core/src/config.ts`, `FINDING(config-no-config-mode)`.) | `hypothesis` | The configuration review under Q14 must confirm the mode name. That fail-closed validation always lands in `observe` is now demonstrated: experiment 6.3 (2026-07-23) drove every invalid fetched configuration — bad value, unknown key, wrong schema version — to zero configuration and `observe`, identical to the unit fixtures. |
| D32 | The stage-three feasibility experiments (build plan §6.1–§6.6) are capability-independent and may run while the stage-two capability-ranking gate is still open. None of the six protocols references a specific capability; the ranking is consumed by stage four's review, not by the experiments. The experiment protocols (local evidence records under `experiments/`, untracked by design) are the evidence that no step depends on the ranking. | `supported` | If any protocol step turns out to need a capability choice mid-run, this row is `reopened` and that step waits for the stage-two gate. |

## 4. Open product and engineering questions

| Identifier | Question | Decision owner or evidence | What the answer blocks |
|---|---|---|---|
| Q1 | Which organization hosts and operates the GitHub App? | The Hiero or LFDT infrastructure owner must decide. | Production deployment is blocked. |
| Q2 | Which maintainer problems become the first user-facing capabilities? | Maintainer demand and the capability review must decide. | The user-facing minimum viable product is blocked. |
| Q3 | Do any repositories want the optional skill ladder, and what counts as a completion? | The affected repository maintainers must decide. | Skill-based assignment and progression are blocked. |
| Q4 | Which human actions may automation ever refuse or reverse? | Maintainers must review the selected capability policies. | Manual-edit enforcement is blocked. |
| Q5 | How does assignment behave with native assignment and multiple assignees? | The assignment specification and sandbox scenarios must decide. | The assignment capability is blocked. |
| Q6 | Is review queue state stored, derived, or left to native GitHub review rules? | Repositories that request review routing must decide. | Review routing is blocked. |
| Q7 | How are old labels, configuration, and writers migrated without two systems writing the same state? | A per-repository migration plan must decide. | Existing repository cutover is blocked. |
| Q8 | Which repository volunteers for a read-only or reversible pilot? | Repository maintainers and the operator must decide. | Ring-one testing is blocked. |
| Q9 | What is the managed-comment marker and schema migration format? | The managed-comment implementation and sandbox test must decide. | Stable comment recovery is blocked. |
| Q10 | What rate and timeline-read budget is safe for the fleet? | Answered by experiment 6.4 (2026-07-23): every call costs one unit of the 5,000-per-hour installation budget, conditional 304 re-reads are free, and content creation hits an unsignaled secondary limit near eighty writes per minute — write pacing must stay well below that, serialized per GitHub's guidance. A sweep of fifty repositories with twenty active issues each costs about one fifth of an hour's budget uncached; with conditional reads, steady-state cost tracks changed issues only. | Unblocked: sweep cadence can be designed against these numbers. |
| Q11 | Is the App installed only on selected repositories or more broadly with repository configuration as a second gate? | Organization governance must decide. | Installation guidance is blocked. |
| Q12 | Which implementation documents should be written alongside working code? | The first implementation work packet must decide. | This question does not block feasibility work. |
| Q13 | Who owns architecture review, the development App, the platform components, testing, and rollout? | Sophie and the project maintainers must name owners. | Committed dates and production work are blocked. |
| Q14 | What path, strict YAML schema, and schema migration policy should the App use? | The configuration design review must decide the final path and migration policy. Experiment 6.3 (2026-07-23) validated the mechanics against `.github/hiero-automation.yml`: strict parsing, unknown-key rejection, and `schemaVersion` rejection all fail closed, and a default-branch config change is event-observable within seconds. Inheritance is deferred from the first version. | The configuration implementation is blocked only on the path and migration decisions. |
| Q15 | What minimum owned operational storage is required, and which technology should provide it? | Answered by experiment 6.5 (2026-07-23): a single-file SQLite store with four small tables — seen delivery ids, effect intent/done journal, claims, schedules. GitHub keeps all effect outcomes and resolves every sent-but-unconfirmed write. See `design/operations/storage-decision.md`; ratification pending per §5. | Unblocked: production recovery and hosting design can proceed from the storage decision. |
| Q16 | What exact narrow operations and typed results belong in the first adapter? | Answered by the endpoint and permission matrix (`design/operations/endpoint-permission-matrix.md`, completed 2026-07-23): every operation the first capabilities need is confirmed with its permission, quota cost, conditional-read support, and failure shape; the matrix rows are the first adapter's operation list, and the failure catalogue fixes the error types it must expose. | Unblocked: the adapter implementation can be specified from the matrix. |

## 5. Ratification rule

A hypothesis becomes `ratified` only after the register names the approving maintainers, the date, and the
evidence they reviewed. A sandbox result may reject a hypothesis without selecting the final replacement.
When that happens, the row becomes `reopened` until a later decision is ready.
