# automation-testkit — test-only support

What more than one package's tests need: the captured webhook payloads — scrubbed, human-reviewed,
each carrying its own provenance — the journeys table that says what every capability decides on
each of them, and the two temp-dir helpers, in callback and hook form. It imports nothing, ships
nothing, and can kill no mutant. `createWorld` lets the shared route table remember what was
written, so an active run is held to what the repository ends up showing; it lives beside the table
it extends. `history(name)` is a real repository's items cut at one instant, pulled and scrubbed by
the lab's `history.ts` (protocol 7.1), and `seedsOf` makes them a world, so a replayed sweep can be
held to what the live one wrote.

The world pages a list by `per_page` and `page` with a `Link` header, and matches a label name
without regard to case, keeping the repository's spelling, as GitHub does. The rest of GitHub's rough
edges are set by the test that wants them: a seeded `locked` item refuses comments with 403,
`transfer(n)` makes every route to an item answer 301, and `losesWriteReply` applies a write but
answers 502. [`rough-edges.test.ts`](../../runtime/test/shell/compose/rough-edges.test.ts) runs the Action
through each of them.

**A fixture is reached through the module, never through a path.** `capture("issues.opened.json")`
and `WEBHOOK_CAPTURES`, never a URL assembled from another package. Stryker's sandbox is the mutated
package's own directory, so a fixture read by path from above it is simply absent when the mutants
run — the tests pass, kill nothing, and score zero; one reached through an export travels in with the
dependency (D82). There is deliberately no exported directory path, so there is none to leak.

**It is test-only in both directions**: declared under `devDependencies` alone and imported from
`test/` alone, both enforced by [`architecture.test.ts`](../checks/test/architecture.test.ts); the
lab's instrument, which ships nothing, is the one `src/` reader of the journeys table. A helper
graduates here when a SECOND package needs it; config and declaration builders are refused,
because they would need core, whose own tests need this package.

```bash
pnpm --filter @hiero-hackers/automation-testkit test
```
