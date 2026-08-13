---
name: "Intermediate Issue"
about: A multi-module task requiring independent research and thorough testing (~25 hours)
labels: "intermediate"
---

<!-- Everything outside "The task" is boilerplate — leave it, or trim what doesn't apply. -->

> 🧑‍💻 **Intermediate Issue** — a complex task spanning multiple modules, with real design decisions to own.
> **Time:** ~25 hours · **Prerequisites:** comfortable navigating this repo (a completed [beginner issue](https://github.com/hiero-hackers/sdk-automations/issues?q=is%3Aissue+state%3Aopen+no%3Aassignee+label%3Abeginner) is the usual route; demonstrated CI/CD proficiency substitutes for workflow-focused issues).
> We expect more than "it works": maintainable code that fits the existing architecture.

## The task

<!-- ✍️ Author: this is the only section you write. Articulate the problem and its
     impact for someone who can already navigate the packages and their tests.
     State the expected outcome; name the modules involved and any constraints or
     risks you already know about. The contributor owns the design. -->

**Problem:**

**What done looks like:**

**Modules involved / constraints:**

## How to work on this

1. **Claim it:** comment on the issue and wait to be assigned before opening a PR.
2. **Propose your approach as a comment before coding.** A paragraph is enough; early feedback here routinely saves days of rework.
3. **Check the house invariants** in the [contributor guide](https://github.com/hiero-hackers/sdk-automations/blob/main/CONTRIBUTING.md#ground-rules): one fact, one place; every check gets a negative control; never weaken a mutation threshold.

**Worth knowing about this repo before you design:**

- `core/` is pure by construction: no I/O and no clock reads.
- Claims become invariants; a change that makes a claim should expect a check that keeps it true.
- `store/` and `probes/` have deliberately narrow boundaries described in their READMEs.

**Before opening your PR:**

- [ ] I proposed my approach on this issue and incorporated any feedback
- [ ] The solution fits the existing architecture and house invariants, and is clear enough for others to debug without me
- [ ] Tests cover the happy path, edge cases, and error handling
- [ ] I reviewed my own diff line by line; scope is limited to this issue
- [ ] CI is green, commits are signed, and the issue is linked

**Stuck?** Comment here with what you have tried. See the [contributor guide](https://github.com/hiero-hackers/sdk-automations/blob/main/CONTRIBUTING.md) for setup and expectations.
