# automation-testkit — test-only support

What more than one package's tests need: the captured webhook payloads — scrubbed, human-reviewed,
each carrying its own provenance — the journeys table that says what every capability decides on
each of them, and the two temp-dir helpers, in callback and hook form. It imports nothing, ships
nothing, and can kill no mutant.

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
