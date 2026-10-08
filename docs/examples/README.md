# Example configurations

Every file here is parsed by the test suite. They are not illustrations of the schema — they are the
schema's only worked examples, and a change that breaks one fails the build.

`packages/dev/checks/test/examples.test.ts` reads this directory through `parseConfigDocument`, the same entry
point the shell will use on a real repository.

## The valid ones

| File | What it shows |
|---|---|
| `empty.yml` | A file with nothing in it. Identical to having no file: `observe`, no writes. |
| `minimal.yml` | The smallest configuration that says anything — three lines. |
| `observe-only.yml` | A real repository with mappings and a capability, still writing nothing. |
| `full.yml` | Every shipped capability on, every mapping family filled, every option commented — the catalogue. The suite holds it to that: a capability the App gains and this file does not is a failing check. |
| `inactivity.yml` | Schedule-driven capabilities only, at their defaults, with the two optional mappings `inactivity` reads. |
| `active.yml` | An active configuration, for the day writes are turned on. Rejected until then. |

`active.yml` remains parseable because active mode stays in Core's general vocabulary. The runnable shell
records `modeUnsupported` before `decide()` unless it was started with an applier, which is not the default
composition.

## Where the rejections live

Not here. Every way a configuration can be *wrong* is in `packages/core/test/config/documents.ts` — a
corpus of documents, at least one per `ConfigErrorCode`, each asserted to produce that code and no other.
Adding a member to `ConfigErrorCode` fails compilation until a document reaches it.

They are in the package rather than in this directory for a reason worth knowing: Stryker's sandbox
contains `core/` and nothing above it, so a fixture at the repository root is invisible to mutation
testing. As files here they ran, passed, and measured nothing.

## What is deliberately not decided here

These files show the SHAPE of a configuration at the decided repository-root path, `sdk-automations.yml`.
They do not implement the future default-branch fetch. A capability's own keys — everything in its
block beside `enabled` — are opaque to the shared parser, which checks the key names against each
capability's declaration and nothing more; the values are read by the capability's own spec, and
`packages/capabilities/test/examples.test.ts` holds every file here to those specs, enabled or not.
