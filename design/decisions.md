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
| P2 | A repository must explicitly enable every workflow-changing capability. | Maintainer consent and the different C++, Python, and JavaScript workflows require explicit opt-in. |
| P3 | A capability does not call or import another capability. | The coupling audit shows that direct and hidden sibling contracts are difficult to test and change. |
| P4 | A capability receives only its own configuration and a narrow platform interface. | The C++ shared-config coupling and GitHub API mock drift support a smaller boundary. |
| P5 | GitHub remains authoritative for visible repository facts. | Labels, assignees, reviews, comments, and open or closed state must continue to reflect human edits. |
| P6 | The design does not assume that GitHub alone stores every operational recovery record. | Webhook delivery, multi-call recovery, and coordination require feasibility experiments. |
| P7 | Repository labels and fields are mappings or profile defaults rather than universal platform strings. | The three audited SDKs use materially different workflow models. |
| P8 | Testing begins with a development App and personal sandbox before any Hiero repository receives writes. | The permission and failure risks require an isolated validation path. |
| P9 | A production webhook receiver durably accepts work before it acknowledges the delivery. | GitHub requires a quick response and does not automatically redeliver every failed delivery, so an acknowledged in-memory event cannot provide reliable recovery. |

## 3. Earlier design proposals and their current status

The identifiers below preserve references from the existing documents. Their current status is explicit so
that older text cannot be mistaken for approval.

| Identifier | Earlier proposal | Current status | Required next evidence |
|---|---|---|---|
| D1 | GitHub and App-authored comments provide all durable state, so the App needs no owned operational store. | `reopened` | A sandbox must test duplicate delivery, restart recovery, scheduling, unclear API results, and concurrent processing. |
| D2 | Issues and pull requests use separate workflow models, and cross-entity writes require an explicit operation. | `hypothesis` | Candidate capabilities must show which cross-entity reads and writes they need. |
| D3 | Every repository uses one fixed twelve-label taxonomy. | `replaced` | P7 replaces this proposal with stable internal meanings and repository mappings or optional profiles. |
| D4 | The platform removes only named managed labels and never removes a namespace prefix. | `supported` | Adapter tests must enforce the rule for every label operation. |
| D5 | The full Hiero workflow profile has one invariant for each position. | `hypothesis` | Repositories that want the profile must review the invariants before activation. |
| D6 | Human edits and capability requests use different rulebooks. | `hypothesis` | Concurrency and manual-edit scenarios must confirm the behavior for each selected capability. |
| D7 | The App does not reverse a newer human change unless maintainers approve a named exception. | `supported` | Effect tests must prove the precondition and newer-change checks. |
| D8 | Incoherent mapped states use the five classes described in `core/manual-edits.md`. | `hypothesis` | The selected workflow profile must prove that all five classes are needed and understandable. |
| D9 | Timeline timestamps can enforce the newer-fact rule at acceptable cost. | `hypothesis` | Ring-zero measurements must confirm the API cost and timestamp reliability. |
| D10 | Clock-triggered destructive actions always warn before they act and provide a simple reversal. | `supported` | Each destructive capability must provide its own warning, grace, cancellation, and rollback tests. |
| D11 | Removing `blocked` resets an inactivity clock instead of resuming it. | `hypothesis` | Maintainers must decide this policy for a profile that enables inactivity handling. |
| D12 | Capabilities provide structured comment content, while the platform owns managed comment identity and writes. | `supported` | The managed-comment sandbox test must prove idempotent update and authorship checks. |
| D13 | Exactly two comment types may carry metadata that the platform reads back. | `reopened` | The storage experiment must decide whether comment metadata is appropriate for each recovery need. |
| D14 | Resolved managed comments are shortened instead of deleted. | `hypothesis` | Maintainers must review the contributor experience for the first real comment type. |
| D15 | GitHub closing references are the only supported issue and pull request link mechanism. | `hypothesis` | The first capability that needs links must confirm the repository policy and fork behavior. |
| D16 | Skill credit is organization-wide while each repository chooses issue difficulty. | `reopened` | A skill ladder is optional, and repositories that request it must decide credit scope and completion rules. |
| D17 | Configuration exposes only choices on which reasonable repositories differ. | `supported` | Each key must state the repository choice that justifies it and the safe validation range. |
| D18 | One process and business-hours operation are sufficient because later sweeps repair missed work. | `reopened` | Hosting, queue, webhook, and recovery experiments must determine the required process and availability model. |
| D19 | A hosted App is preferable to copied repository workflows. | `supported` | The project still needs an operator and hosting decision before production deployment. |
| D20 | One adapter controls rate limits, retries, pacing, and conditional reads. | `supported` | Endpoint tests must measure real primary and secondary rate-limit behavior. |
| D21 | Every failure class has one primary audience and a clear recovery message. | `supported` | The first implementation must verify the channel and permission needed for each message. |
| D22 | Rollout uses a personal sandbox, a Hiero Hackers sandbox, shadow mode, reversible writes, and explicit kill switches. | `supported` | Owners and entry criteria must be recorded before each environment is used. |
| D23 | A capability declares its configuration, inputs, intents, permissions, triggers, and operational needs. | `hypothesis` | The first two candidate capabilities must fit the contract without receiving a raw GitHub client. |
| D24 | Current-state checks and comment records can recover every interrupted multi-call operation. | `reopened` | The effect executor experiment must crash after every call and compare comment-backed and owned-store recovery. |
| D25 | The threat controls in `operations/threat-model.md` are sufficient for the first release. | `hypothesis` | A red-team pass and sandbox evidence must confirm the controls before a real pilot. |
| D26 | The twelve GitHub label strings are fixed in code and cannot be configured. | `replaced` | P7 replaces this proposal. Code may keep stable meanings, while repositories configure mappings or select a profile. |
| D27 | Comment metadata is the App's write-ahead log and only durable operational state. | `reopened` | The storage and recovery experiment must compare GitHub reconstruction, comment metadata, and a small owned store. |

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
| Q10 | What rate and timeline-read budget is safe for the fleet? | Ring-zero measurements must decide. | Sweep cadence and some manual-edit rules are blocked. |
| Q11 | Is the App installed only on selected repositories or more broadly with repository configuration as a second gate? | Organization governance must decide. | Installation guidance is blocked. |
| Q12 | Which implementation documents should be written alongside working code? | The first implementation work packet must decide. | This question does not block feasibility work. |
| Q13 | Who owns architecture review, the development App, the platform components, testing, and rollout? | Sophie and the project maintainers must name owners. | Committed dates and production work are blocked. |
| Q14 | What configuration path, format, inheritance rule, and schema migration policy should the App use? | The configuration design and sandbox test must decide. | The configuration implementation is blocked. |
| Q15 | What minimum owned operational storage is required, and which technology should provide it? | The webhook and effect recovery experiments must decide. | Production recovery and hosting design are blocked. |
| Q16 | What exact narrow operations and typed results belong in the first adapter? | The first capability and endpoint matrix must decide. | The adapter implementation is blocked. |

## 5. Ratification rule

A hypothesis becomes `ratified` only after the register names the approving maintainers, the date, and the
evidence they reviewed. A sandbox result may reject a hypothesis without selecting the final replacement.
When that happens, the row becomes `reopened` until a later decision is ready.
