# automation-checks

Tests about the **repository**, not about any package: docs and examples stay
true to core's vocabularies, design diagrams match the edge tables, and
artifacts hold their invariants. There is no `src/`, so nothing in this
package can or should kill a mutant. That is the point: a repository check is
not a package test, and keeping it here prevents it from being mistaken for
one.

## The inclusion rule

From [D85](../design/decisions.md#D85): a test that reads another package's
files, or the repository root, belongs in `checks/`; a test that can kill a
mutant in `core/src` stays in `core/test`.

From [D89](../design/decisions.md#D89): `checks/test/` uses one file per
invariant or per watched target. A target earns a subdirectory only when it
needs a second file. Shared parsing helpers live in `test/helpers.ts`.

## The invariants

| File | What it locks |
|---|---|
| `citations.test.ts` | References resolve: cited paths exist, named files exist, and cited decision rows exist. |
| `doc-drift.test.ts` | The transition tables in `src/taxonomy.ts` match the state diagrams in `design/core/taxonomy.md`. |
| `docs.test.ts` | Every table in `docs/` restates a closed vocabulary the code owns, so the copy stays truthful. |
| `enumerations.test.ts` | Every exported const array derives its union. |
| `examples.test.ts` | `examples/config/` is documentation that runs. |
| `helpers.test.ts` | Portable repository parsing helpers normalize paths and line endings. |
| `lab.test.ts` | Checkable lab invariants: the local-only layer and the evidence rules stay true today. |
| `mutation-coverage.test.ts` | Stryker's mutate globs cover every core module. |
| `sources.test.ts` | Source files stay readable to text tools. |
| `toplevel.test.ts` | The top level holds packages and three knowledge roots. |

## Dependencies

This package depends on `core` only through its public barrel. It does not
import core internals, and core does not know the repository exists.
