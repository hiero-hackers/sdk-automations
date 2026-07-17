# <module name>: <one-line job>

> Spec for the `<name>` module. Status: draft / ratified / built. Every module spec follows this
> skeleton so any two modules can be compared section by section; delete no section — write "none"
> where empty. The contract it implements is `design/modules/contract.md`; conformance is defined by
> the kit (`design/testing/README.md`).

## 1. The job

What a maintainer would miss if this module were gone — one paragraph, one outcome. (If two
outcomes, consider two modules: lessons D1.)

## 2. The declaration

The five fields, exactly as the code will declare them:

```ts
{
  name: '<name>',
  config: /* schema of its slice — every key must pass config/schema.md's either/or test */,
  consumes: [ /* positions observed */ ],
  transitions: [ /* every edge it may request */ ],
  resolvers: [ /* every shared question, incl. cross-entity reads */ ],
  triggers: [ /* events and/or sweep */ ],
}
```

## 3. Behaviour

The rules, written against observations: "on observing X (with config Y), request Z / project W."
Include the manual-mode story explicitly: what this module looks like to a repo using it **alone**,
with every input state hand-produced (`design/architecture.md` §7).

## 4. Safety

Rows this module adds to `design/core/safety.md`'s table, or "none — nothing destructive."

## 5. Projections

The content projection(s) it hands the core (one per item — `design/modules/contract.md` §5), with
the three-part shape: what was observed · what was done or awaits · the one-line remedy.

## 6. Config knobs

Each knob with its either/or justification: which two reasonable repos answer it differently
(`design/config/schema.md`). A knob without that answer is behaviour, and belongs in §3.

## 7. Tests beyond the kit

The conformance kit is derived from §2 automatically. List only the module-specific behaviour tests
(policy correctness, edge cases in §3).

## 8. Open questions

What this spec leaves undecided, and where each gets decided.
