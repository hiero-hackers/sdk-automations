# Project Goals

## Vision

Turn the per-repo GitHub Actions automation into a **hosted, config-driven GitHub App** that any
Hiero (or other) repo can install and switch on using a config file **only the contributor-workflow features it wants**.


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

1. **Decoupled by function.** Every capability is an independent feature a repo can enable, disable, or dial up.
2. **Config-driven opt-in.** A repo declares its choices in `.github/hiero-automation.json` (with `_extends` org defaults). No config means safe defaults.
3. **Phased adoption.** the core services should be split into a phased construction, starting with the most core and commonly needed functions.
4. **Minimal, legible permissions.** `Issues:write` · `PR:write` · `Contents:read` only — never
   `contents:write`.
5. **Safe and trustworthy.** Destructive actions (auto-close, unassign) are
   warned ahead with a grace period, and are reversible.

## What success looks like

- A repo installs the App, writes a few config lines, and gets exactly the automation it chose.
- Turning a feature off is one config edit and has no side effects on the others.
- One authoritative skill ladder, label taxonomy, and status state machine shared across features.
- No surprise actions: the bot warns before it closes or unassigns, and explains each action in a comment.

## Non-goals

- Absorbing CI / build / release pipelines — those stay as native Actions per repo.
- A one-size-fits-all bot: the point is configurable subsets, not a fixed suite.
- Adding new services - the focus of the app (for now) is safely abstracting current services.

