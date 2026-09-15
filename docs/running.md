# Running the shell

> The App is in development and not yet installable. These pages describe the configuration it ships with.

For whoever runs the endpoint: what it reads from the environment, what arms each lane, the two
switches, and the commands that ask it what happened.

## Start it

```bash
pnpm install
pnpm start
```

It drains the deliveries already in the store before it listens. `GET /healthz` answers `200 ok` for
a liveness probe; every other GET is 405. After that, everything the process does is one JSON line
per event — `at`, `event` from a closed vocabulary, and that event's own fields, with `deliveryId` on
every line about one delivery, so `grep` on a GUID returns its whole passage. Lines an operator
should notice go to stderr and the rest to stdout. A refusal to boot is the exception and stays a
human sentence: it precedes the process being alive, and has no delivery to name. Node prints an
`ExperimentalWarning` for its SQLite module; it is not an error.

## The environment

```
WEBHOOK_SECRET=…            # the App's webhook secret
REPO_OWNER=owner-sandbox    # required without App credentials: the repository the local file serves
REPO_NAME=automation-sandbox
APP_ID=…                    # optional App credentials; provide all three together
PRIVATE_KEY_PATH=…
INSTALLATION_ID=…
APP_SLUG=…                  # optional; the App's URL slug. Arms the write path
PORT=8790                   # optional
HOST=127.0.0.1              # optional; omit to use Node's default bind host
CONFIG_FILE=…               # credential-free fallback; default <state home>/automations.yml
STORE_PATH=…                # optional; default <state home>/shell.sqlite
TICK_SECONDS=60             # optional; the reconciliation tick: requeue, recover, drain, fire
SWEEP_CADENCE_HOURS=1       # optional; arms the fact sweep and sets how often a repository is read
SWEEP_WRITE_CALLS=20        # optional; how many writes one reconciliation tick may send
SWEEP_SHARE=0.4             # optional; the share of GitHub's own rate limit the sweep may spend
CONTENT_CREATION_HOURLY=400 # optional; comments both lanes may create per hour
SNAPSHOT_MAX_AGE_HOURS=24   # optional; how long an item may be decided from its last read
KILL_SWITCH=1               # optional; refuse everything, loudly — including armed writes
SUSPENDED=1                 # optional; accept every delivery, decide and send nothing
XDG_STATE_HOME=…            # optional; where the state home lives
```

`SWEEP_REQUESTS` and `SWEEP_READ_REQUESTS` are no longer read; a set value fails the boot and names
`SWEEP_SHARE`, which replaces both.

The three credentials are required together, and a key file that is not there fails the boot before
the process listens. Without them the shell reads a local configuration file and stubbed external
facts, which is CI's permanent path — and dry-run reports on that path **overstate** what an armed
endpoint would apply, because an ordering nobody could read is not a conflict.

## What arms writes, and what arms the sweep

**`APP_SLUG` arms the write path, and it is not a fourth credential.** The three credentials buy
reads; writing needs one thing more, because a read-back that cannot tell this App's own comment from
a person's cannot recognise what it wrote — the check that stops a duplicate comment and stops the
platform editing someone else's writing. The slug becomes the bot login `<slug>[bot]`, and `APP_ID`
supplies the other half of that identity. Credentials with no slug boot as they do today; a slug with
no credentials, or one that cannot spell a login (empty, spaced, bracketed), fails closed before the
process listens.

**`SWEEP_CADENCE_HOURS` is the same shape for the other lane.** Absent, this process reads a
repository only when GitHub speaks first, and a capability that runs on a clock is configured and
never woken; present, a due schedule row is claimed on the reconciliation tick and becomes one fact
record per open item. It needs the credentials for the reason the slug does — a cadence is an
instruction to read GitHub.

The `startup` line carries `writes: "armed" | "absent"` and `sweep: "armed" | "absent"`, so which
composition is running is readable before any delivery arrives.

The sweep spends a share of the installation's own rate limit rather than a count of its own.
`SWEEP_SHARE` is that share of each pool — REST and GraphQL — of whatever `x-ratelimit-limit` the
installation reports, 5,000 assumed until a response says otherwise, and it is spent over GitHub's
own window rather than over a tick; the rest is the webhook lane's, which spends its own allowance
with no write cap on it. The client charges what GitHub charges: a conditional read
answered `304` costs nothing, a GraphQL query costs its own points, and a write costs one request.
Configuration, facts, resolvers, apply-time checks, writes, retries and read-back all come out of it.

`SWEEP_WRITE_CALLS` stays a per-tick lane on that allowance, because content creation has limits of
its own: `CONTENT_CREATION_HOURLY` bounds comments per hour across both lanes, and creations are
spaced two seconds apart whoever asks for them. A comment either ceiling turns away is retried later,
never dropped.

Most of that share is never spent, because an item the list says has not changed since the sweep last
read it is decided from that read rather than read again. The store keeps one row per open item — the
list's own `updated_at`, when it was read, and the groups the read filled — and a row stands only
while `updated_at` is unchanged, is at least a minute older than the list read (a submitted review
reaches the field up to thirty seconds late), and was read inside `SNAPSHOT_MAX_AGE_HOURS`. A row is
dropped when its item leaves the open list, and rewritten whenever the item is read. `sweepFinished`
says how many items a firing answered this way as `reused`. Because the store outlives the process, a
restart is warm; the in-process conditional-read cache never was.

A repository left untouched when a pool is spent, and one stopped part-way through its list, are both
due again on the next tick; due repositories are read oldest-first, so none starves. An act held back
is refused `sweepRequestCap` (naming the pool) or `sweepWriteCap` and decided again from the same
cause next firing. `sweepFinished` carries `spent` per lane, `writes`, `heldBack` and `deferred`, and
a `limits` line reports GitHub's own `limit`, `remaining` and `resetAt` once per pool per window.

## The two switches

- **`KILL_SWITCH=1`** refuses everything at the decision gate, and an armed write path meets it again
  between deciding and applying: the applier re-checks it before every send and before every resend.
- **`SUSPENDED=1`** verifies and accepts every delivery and then finishes it without deciding —
  nothing is read, nothing runs, nothing is sent. A delivery completed this way is not reconsidered
  when the suspension lifts; the next event on the item is decided normally
  ([`installationSuspended`](troubleshooting.md)).

## Where the store lives

The state home is `$XDG_STATE_HOME/sdk-automations`, or `~/.local/state/sdk-automations` when that
variable is unset or relative. The store is `shell.sqlite` there unless `STORE_PATH` names another
file, and the credential-free configuration copy is `automations.yml` beside it unless `CONFIG_FILE`
does. It is deliberately outside the package: in a container `packages/runtime/data/` is an image
layer, and a redeploy would take the decision rows with it. That directory is never tracked, and an
operator who points `STORE_PATH` back at it is still writing raw payloads and real repository names.

## Ask it what happened

```bash
pnpm shell:status
pnpm shell:explain <effect-id>
pnpm shell:explain --item issue#40 --repo owner/repo
```

A store file written before this version is not opened: the schema is version 1 and rewritten in
place, so a file whose shape does not match it is refused before the process listens. Delete the file
`STORE_PATH` names — `shell.sqlite` in the state home by default — and start again. The fleet is then
cold for one sweep; see [troubleshooting.md](troubleshooting.md).

`shell:status` prints what the store can say about the platform now, one line per question — the
deliveries, the open sends, the standing warnings, the schedule rows, the stored reads each repository
holds with the oldest of them, the comments landed in the last hour, and the decisions of the last
day. The allowance is the running process's and no store holds it, so that line says so; the `limits`
and `sweepFinished` lines are where an operator reads what a window has spent.
`shell:explain` prints one effect's facts and where it stands, or one item's effects and decisions.
Both only read, and exit 1 when no store answered. Every code either prints is in
[troubleshooting.md](troubleshooting.md).

## Stop it

`SIGINT` or `SIGTERM`, in the order that loses nothing: the socket closes, the tick stops, the pass
already in flight is awaited, then the store. A second signal during a shutdown is ignored. Nothing
is claimed on the way out — work left pending is claimed by the next start.
