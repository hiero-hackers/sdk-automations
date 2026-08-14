# Docs to-do

> Internal. This is the one page here not written for App users: it records what the user-facing
> pages cannot yet say truthfully, and cites the decision register rows that unblock them. When an
> item lands, its docs change ships in the same PR.

## Wrong today, and known

- **Mappings are not tied to capabilities.** A user can enable `intake` and drop `awaitingTriage`
  from their mappings, and nothing in the file is wrong — the capability silently skips at runtime
  and says so only in a report. `configuration.md` documents this honestly under "Do I have to map
  all of them?", but honesty is not the fix: capabilities must declare the meanings they need, so an
  enabled capability with an unmapped meaning becomes a **configuration error with a path**, caught
  at PR time. Then `configuration.md` gains a per-capability requirements table, locked like every
  other list. (D84.)
- **The config path is an assumption, not a decision.** Every page says
  `.github/hiero-automations.yml`; the register still has the path unchosen. If the decision goes
  another way, every page and example needs the rename. (D84 notes; `design/config/schema.md` §12.)

## Missing, blocked on the App existing

- **Installation and credentials.** There is no page for: installing the GitHub App, what permissions
  it requests and why, org-wide versus per-repository installation, and how to revoke it. Cannot be
  written truthfully before the App and its permission manifest exist — the manifest is designed
  (`design/operations/endpoint-permission-matrix.md`) but has never been submitted to GitHub.
  Note for then: users hold **no credentials at all** — no tokens, no secrets in the repo — and
  saying that loudly will be one of the docs' best sentences.
- **Who may change the config.** The file is as powerful as branch protection; the docs should
  recommend a CODEOWNERS entry for it. One paragraph, but it belongs next to installation.
- **What reports look like.** `troubleshooting.md` explains codes with no picture of where a code
  appears. Needs real screenshots from the sandbox repository, not mockups. (P8.)

## Missing, blocked on capabilities shipping

- **Per-capability pages.** `settings.announce`, `settings.marker`, `settings.maxOpenAssignments`
  appear in examples but are defined nowhere — `settings` is each capability's own contract, and the
  platform docs cannot define keys the platform does not own. Each shipped capability gets a page:
  what it does, its settings, required meanings, and platform-derived permissions.
- **The available capability list.** Every configured name absent from the application's direct
  capability list is an error, but no page lists what ships. Blocked on the first real capability;
  the probes must not be documented.

## Examples: deliberately few, for now

`docs/examples/` stays at four. The tempting additions are mode variants (`dry-run.yml`) and
setting variants — both wrong: mode is a documented one-word change, and settings belong to
capabilities that do not ship yet, so more files now would document fiction and multiply maintenance
without adding a decision a user can copy. The trigger for growth is the first shipped capability;
then examples differ by **scenario** (a docs-repo, a high-traffic SDK repo, an org rollout), never by
one word.

## Style debts

- `configuration.md` mixes flat and dotted heading names; the at-a-glance tree mitigates, but once
  capabilities ship their settings pages should follow one convention.
- The mode ladder appears in `quickstart.md` and `configuration.md` with different columns.
  Deliberate today (one sells, one defines) — revisit if a third copy ever appears.
