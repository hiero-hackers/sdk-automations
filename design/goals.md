# Project Goals

## The problem

Maintainers face load to grow a contributor ecosystem: PRs pile up unassigned and unlinked, issues sit untriaged, stale work isn't reclaimed. Building and maintaining such contributor-facing automations takes maintainer time away from the repo's core goals. There is a use-case to abstract contributor-facing automations away from the repositories.

What the audits established about maintainers is in [`findings/services.md`](findings/services.md): the
three SDKs diverge sharply in what they automate, every one of them drives its workflow from labels
with manual entry paths throughout, and one already runs its whole automation off a maintained
config file. Those findings are why the model is opt-in capabilities over mapped label
meanings, configured per repository, yielding to humans. What is still only believed is below.

## Vision

Turn repeated repository contributor-facing automation into a **hosted, configuration-driven GitHub App**. A repository
installs one App and switches on/off and configures the features it wants.

## Goals

1. **Each capability is separate.** Each capability can switch on/off and be configured without impacting other capabilities.
2. **Every repository makes a configuration-driven choice.** A repository declares its choices in an
   `sdk-automations.yml` file on its default branch, configuring labels, thresholds, and contributor rules
   within each capability it enables.
3. **Each config combination safely defaults.** No configuration means no workflow-changing writes. Every user-facing capability defaults to off.
4. **The project is capability neutral.** The team starts with the shared App foundation, then adds capabilities that maintainers have
   asked for. These can be removed if no longer popular.
5. **The App uses minimal and clearly explained permissions.** Each released product slice uses the smallest
   practical App permission set for its supported capabilities, and the App never needs permission to change
   repository code.
6. **The App must be safe and trustworthy.** Destructive actions, such as automatic closure or
   unassignment, require an advance warning and a grace period, and they must be reversible. It warns before
   it closes or unassigns, and explains each action in a comment.

## Non-goals

- Absorbing CI / build / release pipelines — those stay as native Actions per repo.
- A one-size-fits-all bot: the point is configurable subsets, not a fixed suite.
- Inventing workflow policy without maintainer demand. Existing automation is the starting evidence, and
  new behavior needs a clear user need.
- Configuration inheritance: the first version does not inherit configuration from an organization `.github`.

## Open questions about maintainers

Each of these licenses something already built, and none of them has evidence yet — they are
beliefs, written down so that a maintainer conversation can settle them rather than confirm them.
Answers are recorded per repository, not per person: disagreement between repositories is signal.

1. **Will maintainers grant a third-party hosted App write access to issues and pull requests at
   all?** The largest untested belief in the project — everything downstream of observe mode rests
   on it, and the permission ceiling only matters if the answer is yes.
2. **Would they rather have the automation than be free of a hosted dependency?** If not, the
   alternative was always a template repository of Actions they copy.
3. **Do they want to focus on the repository rather than on its workflow code?** A maintainer who
   enjoys owning workflow code wants a framework, not this — which is also the answer to whether
   configuration is the right surface, or extension is.
4. **Do they want to see what automation would do before it does it?** The `observe` → `dry-run` →
   `active` ladder assumes yes. If they want value immediately, the ramp reads as friction.
5. **Do they want an explanation for every action rather than silent success?** The findings, the
   severities and the canonical report are a large share of what is built.
6. **Is minimal permission a requirement or a nicety?** The ceiling and the refusal of
   `contents: write` assume the former; it is the safer error either way.
7. **Who governs the config file?** It is as powerful as branch protection, and nothing in the App
   restrains who merges a change to it. The documentation owes a recommended CODEOWNERS entry.
8. **Is per-repository configuration enough?** The no-inheritance non-goal fails if repositories
   turn out to want one policy set centrally.
9. **Will preferences change over time, up and down?** Per-capability toggles and the disposability
   of any one capability assume they will; so does the belief that no capability stays desirable
   forever.
10. **Where does increasing AI use leave this?** Unaddressed by anything built so far.
11. **Will a maintainer retire an existing bot rather than run both?** Two writers on the same
    managed state is the one thing the rules forbid outright, and this is the hardest belief to walk
    back if it is wrong. Wherever a bot is in play the question is literally: *would you turn yours
    off?*
12. **Will at least one repository volunteer for a reversible pilot?** None is identified.
13. **Who hosts, operates and funds the App, and will organization governance permit installing it
    where it is wanted?** Nothing in this repository can substitute for an owner, and that question
    has been open since the beginning.
