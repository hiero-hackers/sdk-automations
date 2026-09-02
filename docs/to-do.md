# Docs to-do

> Internal. This is the one page here not written for App users: it records what the user-facing
> pages cannot yet say truthfully, and cites the decision register rows that unblock them. When an
> item lands, its docs change ships in the same PR.

## Wrong today, and known

- ~~**Mappings are not tied to capabilities.**~~ **Mechanism landed (D84):** capabilities declare
  `configKeys` and `requiredMeanings`, and the parser reads both. Enabling a capability without a
  meaning it requires is now `meaningRequired`, with the path to the line to add; a `settings` name the
  capability never declared is now `unknownKey`, with the path to the key. `configuration.md` says so
  under "Do I have to map all of them?" and in the `settings` section. **Still blocked:** the
  per-capability requirements table that item promised. It needs a capability whose settings and
  meanings are user-facing facts, and the probes must not be documented (see below), so the table waits
  on the first shipped capability along with the rest of the per-capability pages.
- ~~**The config path is an assumption, not a decision.**~~ **Resolved by D93 (2026-08-07):** the
  path is `automations.yml` in the repository root — the file configures the platform, not GitHub, so
  it does not live in `.github/`. The `docs/` pages were renamed to match on 2026-08-17. Only the
  schema *migration* policy remains open (Q14).

## Missing, blocked on the App existing

- **Installation and credentials.** There is no page for: installing the GitHub App, what permissions
  it requests and why, org-wide versus per-repository installation, and how to revoke it. Cannot be
  written truthfully before the App and its permission manifest exist — the manifest is designed
  (`design/findings/endpoint-permission-matrix.md`) but has never been submitted to GitHub.
  Note for then: users hold **no credentials at all** — no tokens, no secrets in the repo — and
  saying that loudly will be one of the docs' best sentences.
- **Who may change the config.** The file is as powerful as branch protection; the docs should
  recommend a CODEOWNERS entry for it. One paragraph, but it belongs next to installation.
- **What reports look like.** `troubleshooting.md` explains codes with no picture of where a code
  appears. Needs real screenshots from the sandbox repository, not mockups. (P8.)

## Missing, blocked on capabilities shipping

- **Per-capability pages.** `settings.announce`, `settings.marker`, `settings.gracePeriodDays`
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
