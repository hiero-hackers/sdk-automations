# Project Goals

## Vision

Turn repeated repository automation into a **hosted, configuration-driven GitHub App**. A repository
installs one App and enables only the workflow features it wants.

## The problem

Maintainers carry avoidable load: PRs pile up unassigned and unlinked, issues sit untriaged, stale work isn't reclaimed.

Existing bots in the C++ and Python SDK solve much of this, but there is no easy way to take part of the functionality, and copying the same scripts creates maintenance overhead that distracts from the core goals of the repository.

There are some AI solutions available but these can involve added token costs and require fine-tuning.

There is a use case for maintainers to have a reliable, low cost way of automating many of their repository-health tasks.

## Assumptions

- Maintainers want to focus on core tasks related to their repositories, rather than improving workflows.

- Maintainers want a low-touch way of automating many of the repetitive tasks.

- Maintainers require the app to use minimal permissions.

- Maintainers have different preferences as to what repetitive tasks they want automated.

- Some maintainers will increase (or decrease) their involvement with the app over time. Preferences should be able to easily scale up (or down)

- No single service will remain desirable. The app should be able to evolve with changing maintainer needs.

- AI use will increase and app services should be complementary or eventually offer such an option.

## Goals

1. **Each capability is separated by function.** A capability does not call or import another capability. Each one can be
   enabled or disabled on its own. Any compatibility rule must be declared and checked.
2. **Every repository makes a configuration-driven choice.** A repository declares its choices in a reviewed file on its default
   branch. No configuration means no workflow-changing writes. Every user-facing capability defaults to off,
   and profiles may provide settings without silently enabling one. The first version does not inherit
   configuration from another repository or organization.
3. **The project uses phased adoption.** The team starts with the shared App foundation, then adds capabilities that maintainers have
   asked for. Move from observation to reversible writes before any destructive action.
4. **The App uses minimal and clearly explained permissions.** Each released product slice uses the smallest
   practical App permission set for its supported capabilities. Runtime checks prevent a capability from
   using an undeclared or unavailable permission. Repository configuration does not change the installation
   grant. The App never needs permission to change repository code.
5. **The App must be safe and trustworthy.** Destructive actions, such as automatic closure or
   unassignment, require an advance warning and a grace period, and they must be reversible.

## What success looks like

- A repo installs the App, writes a few config lines, and gets exactly the automation it chose.
- Turning a feature off is one config edit and has no side effects on the others.
- Repositories can use different workflow policies, labels, checks, thresholds, and contributor rules.
- Stable internal meanings can be mapped to repository-specific labels or fields.
- No surprise actions: the bot warns before it closes or unassigns, and explains each action in a comment.

## Non-goals

- Absorbing CI / build / release pipelines — those stay as native Actions per repo.
- A one-size-fits-all bot: the point is configurable subsets, not a fixed suite.
- Inventing workflow policy without maintainer demand. Existing automation is the starting evidence, and
  new behavior needs a clear user need.
