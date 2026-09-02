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
| [`hooks.test.ts`](test/hooks.test.ts) | The opt-in pre-commit hook stays executable and formats the same tracked source scope as CI |
| [`mutation-coverage.test.ts`](test/mutation-coverage.test.ts) | Stryker's mutate globs cover every core module — born from `src/*.ts` silently skipping three modules the day they moved into subdirectories |
| [`mutation-invalidation.test.ts`](test/mutation-invalidation.test.ts) | Incremental mutation reuse is invalidated when a package, dependency, shared testkit, or mutation configuration change could make cached results stale |
| [`catalogue-drift.test.ts`](test/catalogue-drift.test.ts) | The capability catalogue's observation, resolver, intent-operation and meaning identifiers match code exactly; each intent row also carries its permission, idempotency and action-class facts |
| [`contract-drift.test.ts`](test/contract-drift.test.ts) | The capability contract's declaration and operational-needs interfaces match the TypeScript types exactly |
| [`safety-drift.test.ts`](test/safety-drift.test.ts) | The safety contract lists every refusal and record-only verdict code exactly |
| [`spec-drift.test.ts`](test/spec-drift.test.ts) | The configuration contract's modes, top-level keys, and rejection codes exactly match the parser vocabularies |
| [`docs.test.ts`](test/docs.test.ts) | User-doc mode, key, meaning and error-code membership stays aligned with code; troubleshooting codes stay in their implementation-derived severity groups and its record kinds stay in the shell's union; entry links, examples and scoped drift promises stay intact |
| [`examples.test.ts`](test/examples.test.ts) | `docs/examples/` is documentation that runs: the shipped configurations still parse against the capability list the composition root actually wires, and still mean what they say |
| [`commands.test.ts`](test/commands.test.ts) | Contributor-facing `pnpm` commands resolve to real scripts, and every ordinary CI gate is documented where contributors will see it |
| [`doc-drift.test.ts`](test/doc-drift.test.ts) | The drift detector `core/README.md` promised and did not have: the design document's diagrams against the transition tables in code |
| [`workflows.test.ts`](test/workflows.test.ts) | The three security claims the workflow comments make: actions stay SHA-pinned with version comments, and fork code never runs privileged |
| [`never-tracked.test.ts`](test/never-tracked.test.ts) | Every local-only layer stays out of the repository — the lab's credentials and unscrubbed captures, and the shell's raw payload store — checked as written, as effective, and as untracked |
| [`provenance.test.ts`](test/provenance.test.ts) | The perishable-facts provenance table in `core/src/github/README.md` matches the code it describes |
| [`architecture.test.ts`](test/architecture.test.ts) | Workspace package imports follow the allowed dependency direction, use public exports, and stay acyclic — and the testkit stays test-only in both directions: `devDependencies` in a manifest, `test/` in a source file. The source-side edges come from [dependency-cruiser](../../../.dependency-cruiser.cjs) rather than a hand-written AST walk; this file is that rule set's enforcement gate, and reads the manifests itself because no import scanner opens a `package.json` |
| [`codeowners.test.ts`](test/codeowners.test.ts) | Every non-comment pattern in `.github/CODEOWNERS` matches at least one tracked file, checked with `git` itself rather than a hand-rolled matcher |
| [`node-floor.test.ts`](test/node-floor.test.ts) | The Node floor agrees everywhere it is stated: every workspace package's `engines.node`, the README badge, the CI matrix, CONTRIBUTING's prose, and dependabot's `@types/node` policy comment |
| [`placement.test.ts`](test/placement.test.ts) | Every file in a package's test tree answers to a name a maintainer can find: a spec mirrors the module it holds to account or is registered with the question it answers, and nothing under `test/` is named by kind |
| [`invariants.test.ts`](test/invariants.test.ts) | This table and the checks directory agree in both directions — the invariant map is itself an invariant (#92) |
| [`repository.test.ts`](test/repository.test.ts) | Portable repository parsing: the path, line-ending, and directory derivations every check above shares ([`repository.ts`](test/repository.ts)) — one home, so a layout move edits one file |

Every one carries a negative control — a case asserting the check would still fail if the thing it
guards regressed. A check that cannot fail is not a check, and several of these were written only
after a silent-when-wrong failure proved the point.

## Running them

```bash
pnpm --filter @hiero-hackers/automation-checks test
```

They also run as part of `pnpm -r test`. Several read the git index rather than the working tree, so
a change must be staged or committed before the check sees it.
