# automation-checks (tests about the repository)

Tests about the **repository**, not about any package: docs and examples stay true to core's
vocabularies, design diagrams match the edge tables, artifacts hold their invariants. It depends on
core only through core's public barrel.

**There is no `src/`, and that is the point.** Nothing in this package can kill a mutant, so nobody
can mistake a repository check for a package test — and the mutation gate on `core/` cannot be
flattered by tests that were never going to reach its code. If a test here starts needing more than
core's barrel, it has probably stopped being a repository check.

## What belongs here

Two rules, both from the register.

**Inclusion (D85).** A test that reads another package's files, or the repository root, goes here; a
test that can kill a mutant in a package's `src/` stays in that package. This boundary was not
theoretical: four such tests once lived in `core/test/`, which meant core's suite failed when a
markdown file changed, and the rejection fixtures scored `document.ts` at 0.00% mutation because
Stryker's sandbox is the package directory and root-level files are not in it.

**Naming (D89).** One file per watched **target** (`docs`, `examples`, `lab`) or per **invariant**; a
target earns a subdirectory only when it needs a second file. The rule exists because the original
single artifacts file had absorbed seven unrelated `describe`s and the next reader would have added
an eighth.

The standing risk is drift toward a junk drawer — this package accepting behaviour tests because it
is convenient. The no-`src/` shape is the guard, and the trigger to revisit is the first test here
that imports more than core's barrel.

## The invariants

One row per file; the summary is that file's own header, not a paraphrase.

| File | What it locks |
|---|---|
| [`citations.test.ts`](test/citations.test.ts) | References resolve: cited paths exist, named files exist, cited decision rows exist — a reference that points at nothing breaks nothing, so only a test can see it |
| [`links.test.ts`](test/links.test.ts) | Markdown links resolve from the document that carries them — the relative-link blind spot that made the `packages/` move unverifiable by eye (D96) |
| [`toplevel.test.ts`](test/toplevel.test.ts) | The top level holds `packages/` and two knowledge roots, with the package root derived from the workspace file rather than assumed |
| [`sources.test.ts`](test/sources.test.ts) | Source files stay readable to text tools — born from the NUL byte that turned a source file binary to `grep` |
| [`enumerations.test.ts`](test/enumerations.test.ts) | Every exported const array derives its union (D76) — the answer to the fifth sighting of one fact stored twice |
| [`mutation-coverage.test.ts`](test/mutation-coverage.test.ts) | Stryker's mutate globs cover every core module — born from `src/*.ts` silently skipping three modules the day they moved into subdirectories |
| [`docs.test.ts`](test/docs.test.ts) | `docs/` is mostly tables, and every table restates a closed vocabulary the code owns — so the tables are locked in both directions |
| [`examples.test.ts`](test/examples.test.ts) | `docs/examples/` is documentation that runs: the shipped configurations still parse, and still mean what they say |
| [`doc-drift.test.ts`](test/doc-drift.test.ts) | The drift detector `core/README.md` promised and did not have: the design document's diagrams against the transition tables in code |
| [`workflows.test.ts`](test/workflows.test.ts) | The three security claims the workflow comments make: actions stay SHA-pinned with version comments, and fork code never runs privileged |
| [`never-tracked.test.ts`](test/never-tracked.test.ts) | Every local-only layer stays out of the repository — the lab's credentials and unscrubbed captures, and the shell's raw payload store — checked as written, as effective, and as untracked |
| [`provenance.test.ts`](test/provenance.test.ts) | The perishable-facts provenance table in `core/src/github/README.md` matches the code it describes |
| [`architecture.test.ts`](test/architecture.test.ts) | Workspace package imports follow the allowed dependency direction, use public exports, and stay acyclic |
| [`codeowners.test.ts`](test/codeowners.test.ts) | Every non-comment pattern in `.github/CODEOWNERS` matches at least one tracked file, checked with `git` itself rather than a hand-rolled matcher |
| [`node-floor.test.ts`](test/node-floor.test.ts) | The Node floor agrees everywhere it is stated: every workspace package's `engines.node`, the README badge, the CI matrix, CONTRIBUTING's prose, and dependabot's `@types/node` policy comment |
| [`helpers.test.ts`](test/helpers.test.ts) | Portable repository parsing: the path and line-ending normalization every check above shares ([`helpers.ts`](test/helpers.ts)) |

Every one carries a negative control — a case asserting the check would still fail if the thing it
guards regressed. A check that cannot fail is not a check, and several of these were written only
after a silent-when-wrong failure proved the point.

## Running them

```bash
pnpm --filter @hiero-hackers/automation-checks test
```

They also run as part of `pnpm -r test`. Several read the git index rather than the working tree, so
a change must be staged or committed before the check sees it.
