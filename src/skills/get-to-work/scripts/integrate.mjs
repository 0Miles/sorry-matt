#!/usr/bin/env node
// integrate: the git sequences of get-to-work's lines and close-out, each step idempotent and written into the run
// state through state.mjs (its header is the schema; this script never edits the state file itself). No
// dependencies: runs on a bare Node 20+.
//
// Usage (every command takes the state file first; `--now <UTC>` is passed on to state.mjs's writes)
//   node integrate.mjs line-init   <state> --branch <branch> [--worktree <path>] [--from <ref>] [--repo <dir>]
//   node integrate.mjs ticket-init <state> <ticket> --branch <ticket branch> --worktree <path>
//                                  [--base <base branch>] [--repo <dir>]
//   node integrate.mjs pr-open     <state> <ticket> --title <text> [--base <base branch>] [--repo <dir>]
//   node integrate.mjs pr-push     <state> <ticket> [--repo <dir>]
//   node integrate.mjs pr-merge    <state> <ticket> [--base <base branch>] [--ready | --merged] [--repo <dir>]
//   node integrate.mjs patch-id    <state> <ticket> --from <ref> [--repo <dir>]
//   node integrate.mjs merge       <state> <ticket> --worktree <integration worktree> [--branch <ticket branch>]
//                                  [--local <ticket file> [--checks <text>]] [--push]
//   node integrate.mjs merge       <state> <ticket> --worktree <integration worktree> --ci [--push]
//   node integrate.mjs ci-init     <state> <ticket> --worktree <path> [--repo <dir>]
//   node integrate.mjs revert      <state> <ticket> --worktree <integration worktree> --reason <text>
//                                  [--local <ticket file>] [--dependent <ticket>[=<ticket file>]]... [--push]
//                                  [--base <base branch>] [--repo <dir>]     (the last two: integrate: ticket-pr)
//   node integrate.mjs send-back   <state> <ticket> [--conflicts <file>,<file>] [--predicted <file>,<file>]
//                                  [--base <base branch>] [--repo <dir>]     (--base: integrate: ticket-pr)
//   node integrate.mjs stuck       <state> <ticket> --reason <text> [--worktree <integration worktree>
//                                  [--local <ticket file> [--attempts <text>]]] [--review-worktree <path>] [--push]
//                                  [--repo <dir>]
//
// Every command decides nothing: which ticket a red light belongs to, which tickets depend on it, whether to send
// a ticket back or mark it stuck, are the host's calls. The commands run the git sequence after that call. A
// ticket's kept refs are `refs/sorry-matt/<run>/<NN>-<slug>/<leaf>`: the ticket branch `<run>/<NN>-<slug>` with
// its run prefix dropped (a branch without it is used whole), under the state's `run`.
//
// `--repo` is any worktree of the repository (default: the current directory). Paths are compared through their
// real paths, so a Windows short name and its long name are one worktree.
//
// line-init    Creates a line's integration branch and its worktree, by the run's profile `integrate`
//              (state.mjs; default aggregate-pr):
//                aggregate-pr  `--branch` is the line's own `<run>/<line-slug>` branch, created at `--from`
//                              (default HEAD of `--repo`) with a worktree at `--worktree`. The base branch itself
//                              (main, master, origin's default branch) is refused. A branch that already exists is
//                              reused as it is (`--from` is then ignored); a worktree already holding it must be
//                              the one at `--worktree`.
//                direct        `--branch` is the base branch: tickets merge straight into it, and nothing is
//                              created from a ref (`--from` is refused). The branch must exist. The worktree that
//                              already has it checked out is the line's worktree (a different `--worktree` is
//                              refused); when none has, one is added at `--worktree`.
//                ticket-pr     The line has no integration branch and no worktree (#193): every ticket is its own
//                              pull request. `--branch` is only the line's name in the state; nothing is created,
//                              and `--from` and `--worktree` are refused. The line is recorded in the state with
//                              no tip (`state.mjs line <branch>`) when it is not there yet; a rerun writes nothing.
//              Records the line in the state with its tip (`state.mjs line <branch> --tip <sha>`) when the state
//              does not already have that tip.
//              Output: { "format", "command": "line-init", "integrate", "branch", "worktree", "tip",
//                        "created": { "branch": true | false, "worktree": true | false } }
//              (ticket-pr: "worktree" and "tip" are null.)
// ticket-init  Creates the ticket branch from the current tip of its line's integration branch (the ticket's
//              `line` in the state), with a worktree at `--worktree`, and records the branch on the ticket
//              (`state.mjs set --branch`). An existing branch is reused as it is; a worktree already holding it must
//              be the one at `--worktree`. Refused for a ticket at an end state.
//              Under integrate: ticket-pr (#193) the cut point comes from the ticket's #188 fields instead:
//                - `waitingOn` not empty: refused (exit 3), no branch is cut until those upstreams are merged;
//                - `stackParent` null: cut from `origin/<--base>` (`--base` is the base branch, required here;
//                  refused when `origin/<--base>` is not a commit);
//                - `stackParent` set: cut from the upstream ticket's recorded branch (refused when it has none, or
//                  the branch is gone) by `gh stack` itself, non-interactively with explicit branch names (#199
//                  live run: `gh stack add` runs only on a branch of the stack and creates the new branch): the new
//                  worktree is added detached and checks out the upstream branch (`--ignore-other-worktrees`,
//                  beside the upstream's own worktree; nothing is committed there); `gh stack init <upstream
//                  branch>` (which adopts the existing branch) when `gh stack view` there says it is in no stack
//                  yet, then `gh stack add <ticket branch>` cuts the ticket branch on top and checks it out. Run
//                  only when the branch does not exist yet: a rerun reuses the branch and calls gh not at all. The output's "stack" lists the gh stack subcommands run
//                  (e.g. ["init <upstream>", "add <branch>"]; [] on a rerun or an unstacked ticket).
//              `--base` outside ticket-pr is refused (2).
//              The base rule (#219; ticket-init, pr-open, pr-merge and revert under ticket-pr, checked before
//              anything is touched): the first of them given `--base` for a ticket records it as the base of the
//              ticket's PR (`state.mjs set --pr-base`; a stacked ticket's: the base its stack merges toward), and a
//              later `--base` that differs from the recorded one is refused (3).
//              Ticket branch rule (ticket-init and merge, checked before anything is touched): the branch is
//              refused when it is an integration branch of the run (the ticket's line or another), a protected
//              branch (see push), or another ticket's recorded branch; once the ticket has a recorded branch, a
//              different `--branch` is refused too.
//              Output: { "format", "command": "ticket-init", "ticket", "line", "branch", "worktree", "head",
//                        "from": "<line tip it was cut from>" | null, "created": { "branch", "worktree" } }
//              (ticket-pr: "from" is the SHA it was cut from — origin/<base> or the upstream branch tip — and the
//              output adds "stack" as above.)
// pr-open      integrate: ticket-pr only (#193; any other integrate is refused). Pushes the ticket branch
//              (`git push -u origin <branch>`; an origin remote is required) and opens the ticket's draft pull
//              request. Idempotent: a branch that already has an open PR (`gh pr list --head <branch> --state open`)
//              reuses it, opens nothing new, pushes nothing (#219: a restacked branch is no fast-forward of what is on
//              origin; a fix goes out with pr-push), and records its number. Its body (`gh pr view <number> --json
//              body`) is made sure of every `Closes` line below (#219: a create interrupted between `gh stack
//              submit` and `gh pr edit` leaves a PR that would not close the ticket): a body that has them all
//              (a whole line each, case aside) is kept; one missing some gets the missing ones appended (right
//              under its last line when that is a `Closes` line, else after a blank line); an empty one gets the body below (`gh pr edit <number> --body`). Otherwise the branch is
//              pushed, then:
//                - `stackParent` null: `gh pr create --draft --base <--base> --head <branch>` (`--base` is the base
//                  branch, required here) with `--title <--title>` and the body below; the number is read from the
//                  pull request URL it prints.
//                - `stackParent` set: `gh stack submit --auto` (the PRs it creates are drafts), run in the worktree
//                  holding the branch; this layer's number is then read with `gh pr list --head <branch>` (not from
//                  submit's output), and the body below is written onto it with `gh pr edit <number> --body`.
//              Body: the ticket title (`--title`), then this ticket's commit subjects (oldest first, from
//              `<cut point>..<branch>`, merge commits left out: #219, a base merge taken into the branch is not the
//              ticket's change), then one final `Closes <ticket>` line — for a bundle (state.mjs `members`)
//              one `Closes` line per member, the lead first, and the one PR is the lead's branch with the number
//              recorded on the lead. Commit messages themselves carry no closing keyword. The number is recorded
//              with `state.mjs set <ticket> --pr <number>` (skipped when already recorded). Refused for a ticket at
//              an end state or with no recorded branch.
//              Output: { "format", "command": "pr-open", "ticket", "line", "branch", "stacked": true | false,
//                        "pr": <number>, "created": true | false,
//                        "body": "created" | "kept" | "appended" | "written" }   (the last three: a reused PR)
// pr-push      integrate: ticket-pr only (#193). Pushes a fix commit to the same pull request: the ticket branch is
//              pushed again — `gh stack push` (in the worktree holding the branch) for a stacked ticket,
//              `git push -u origin <branch>` otherwise. A ticket branch is never a protected branch (the ticket
//              branch rule holds), so the push always runs here and the output carries no `host` marker. #222: a
//              ticket sent back (`sendBacks` 1 or more) is redone from its fixed point, so origin's head of the
//              branch (the old attempt) is not in the redo's history. That head is read from origin
//              (`git ls-remote`, never the tracking ref a fetch moves); when it is no ancestor of the branch, it must
//              be part of the old attempt kept at `sent-back-<sendBacks>` (an ancestor of that ref, or the ref
//              itself), and the push is `git push --force-with-lease=refs/heads/<branch>:<that head>`: the same
//              pull request takes the redo. A head that is not part of it (someone else pushed to the PR branch) is
//              refused (3), nothing pushed. A ticket never sent back is never force-pushed.
//              Output: { "format", "command": "pr-push", "ticket", "branch", "stacked", "pushed": "git push" |
//                        "git push --force-with-lease" | "gh stack push", "head": "<sha pushed>" }
// pr-merge     integrate: ticket-pr only (#194). Brings a reviewed ticket-level PR (recorded with pr-open) to
//              mergeable: the ticket is queued or integrating (a first call moves it queued → integrating; #196:
//              --ready also takes awaiting-ci and --merged also takes awaiting-merge, the waiting stages tick
//              parks the ticket in between the phases), and the
//              script itself never polls and never sends the merge. Three calls, each one phase:
//                (default)  Phase "push": syncs the base, then pushes the ticket branch.
//                             - not stacked: `git merge` of `origin/<--base>` (`--base` is the base branch, required
//                               here; refused when `origin/<--base>` is not a commit) into the ticket branch, in the
//                               worktree holding it; skipped ("already") when `origin/<--base>` is already an
//                               ancestor. A conflict: `git merge --abort`, exit 4 with { "result": "conflict",
//                               "files" }; the state, the worktree and HEAD are as before (the host hands it to a
//                               merge agent as with merge; after the resolution is committed a rerun pushes).
//                               Then `git push -u origin <branch>`. The worktree is looked up only for the merge
//                               (#219): with the base already taken, no worktree needs to hold the branch.
//                             - stacked: non-interactive `gh stack sync` in the worktree holding the branch. A sync
//                               that aborted on stack divergence still exits 0: its output is read — stdout and
//                               stderr both (#219), so the channel gh stack names it on does not decide — and any
//                               line matching /diverg/i marks the divergence — exit 5 with { "result": "diverged",
//                               "divergence": [those lines] }, nothing pushed and nothing recorded, for the host to
//                               rule on. Then `gh stack push`.
//                           The output reports the branch and pushed head SHA; waiting for CI is tick's fallback
//                           wake-up, not this script's.
//                           Output: { "format", "command": "pr-merge", "phase": "push", "ticket", "line", "pr",
//                                     "branch", "stacked", "result": "pushed", "synced": "merged origin/<base>" |
//                                     "already" | "gh stack sync", "head": "<sha pushed>" }
//                --ready    Phase "ready", after the host confirms CI is green on that head: `gh pr ready <PR>`,
//                           then merge-gate.mjs (unchanged, via its main) with `--base <--base>` (required here) and
//                           `--repo` read from `gh repo view --json nameWithOwner`. The gate's decision and reason
//                           are carried in the output; on "merge" or "queue" the output gives the merge command for
//                           the host to run with its own tool ("host", as merge's protected-branch push does):
//                           `gh pr merge <PR>` for a ticket that is in no stack, `gh stack merge <PR> --yes --squash`
//                           for one in a stack — stacked itself, or with a live ticket stacked on it (#199: GitHub
//                           refuses `gh pr merge` for any PR of a stack; the #198 sandbox run merged with exactly
//                           this) — never `--admin`, never auto-merge (`gh stack merge` supports neither rule bypass
//                           nor auto-merge). On "human" nothing is sent: human-work list.
//                           Output: { "format", "command": "pr-merge", "phase": "ready", "ticket", "line", "pr",
//                                     "branch", "stacked", "base", "gate": { "decision", "reason" },
//                                     "send": { "status": "host", "command" } | { "status": "human" } }
//                --merged   Phase "merged", after the host reports the merge done: the merge SHA and confirmation
//                           are read with `gh pr view <PR> --json mergeCommit,state` (refused unless "MERGED"; #220:
//                           "CLOSED", closed without a merge, exits 6 with { "result": "closed", "state": "CLOSED" }
//                           and records nothing, unlike a PR still open — the merge queue running — refused), the
//                           SHA is recorded (`state.mjs merge`, in integrating or awaiting-merge), the ticket becomes delivered, and the cleanup
//                           removes the ticket's worktree and local branch (`git branch -D`: the merge lives on the
//                           remote). The remote branch is never deleted here: it is deleted with the merge itself
//                           only when the authorization scope allows the host that.
//                           Output: { "format", "command": "pr-merge", "phase": "merged", "ticket", "line", "pr",
//                                     "branch", "stacked", "merge": "<sha>", "stage": "delivered", "cleanup" }
// patch-id     integrate: ticket-pr only (#199). The patch-id of this ticket's own change: `git diff` from the merge
//              base of `--from` and the ticket branch to the branch, through `git patch-id --stable` (line numbers
//              and whitespace do not count). tick takes it when a stacked ticket's review passes, against its fixed
//              point then (the upstream branch), and again after the stack was synced (rebased), against the fixed
//              point now: the same id means the rebase changed nothing of this ticket's and its review stands.
//              Output: { "format", "command": "patch-id", "ticket", "branch", "from": "<ref>", "base": "<merge
//                        base sha>", "head": "<sha>", "patchId": "<id>" | null }   (null: the diff is empty)
//              Every `gh stack` call these commands make is non-interactive (explicit branch names or flags, no
//              wizard) and runs with GH_STACK_NO_UPDATE_NOTIFIER=1 in its environment. The #187 live run (#199,
//              docs/agents/environment.md) confirmed that `gh stack submit --auto` is idempotent over PRs already open
//              lower in the stack and that this layer's number is read back with `gh pr list`; how `gh stack sync`
//              names a divergence it aborted on while exiting 0 is still stubbed per its docs, read from stdout and
//              stderr both (#219).
// merge        Integrates one ticket (stage queued, integrating, or delivered for a rerun) in the integration
//              worktree, which must have the ticket's line checked out. The steps, in order; each one checks
//              whether it is already done and only does what is missing, so a rerun after an interruption at any
//              point finishes the rest and never merges twice:
//                1. merge   Already merged when (the rule of #101's git reconciliation): the ticket has a merge SHA
//                           in the state (it must be on the line, else refused: state and git disagree); else
//                           the ticket branch, when it exists, is an ancestor of the line and a merge of it is on
//                           the line's first-parent history (its second parent is the branch tip, or merges.mjs
//                           matches it: `Merge branch '<branch>'`, `Merge <ticket>`); when the branch is gone, the
//                           second way alone. Otherwise `git merge --no-ff --no-edit <branch>` (git's default
//                           message). The worktree must be clean (tracked files) with no merge in progress.
//                           A conflict: `git merge --abort`, exit 4 with { "result": "conflict", "files" }; the
//                           state, the worktree and HEAD are as before. Whether to hand it to a merge agent is the
//                           host's call; after the agent commits the resolution (`git commit --no-edit`), a rerun
//                           finds that merge and goes on from step 2.
//                2. record  queued → integrating (`state.mjs stage`), then the merge SHA (`state.mjs merge`) unless
//                           it is recorded. `found` in the output says where the merge came from: "merged" (this
//                           run), "state" (recorded) or "git" (on the line but not in the state: git wins and it
//                           is recorded now).
//                3. deliver Local Markdown only (`--local <ticket file>`, relative to the integration worktree):
//                           in the file as committed at HEAD, every `- [ ]` of the ticket's own text (outside
//                           fenced code and the `Comments` / `sorry-matt …` sections, as ticket.mjs reads it) and of
//                           its `sorry-matt expansion` sections is ticked, the `Status:` value becomes
//                           `ready-for-human` (a `Status: ready-for-human` line is added under the title when there
//                           is none), and a `## sorry-matt completion` section is appended listing the merge, the
//                           integration branch, the implementation commits (`<merge>^1..<merge>^2`) and the checks
//                           passed (`--checks`, else the ticket's `verification` in the state; one of them is
//                           required). Committed alone as `<ticket>: sorry-matt completion`. Already done when the
//                           file at HEAD has a non-empty completion record after its last `sorry-matt blocker`
//                           (frontier.mjs's done rule); a working-tree copy that differs from both HEAD and the
//                           delivery is refused (uncommitted edits). GitHub delivers nothing here (the ticket stays
//                           open for the aggregate PR).
//                4. stage   integrating → delivered; then the line's tip in the state becomes the worktree's HEAD.
//                5. push    Only with `--push`: `git push -u origin <line>`. Skipped without an `origin` remote
//                           ("no-origin"). A push to a protected branch (main, master, origin's default branch;
//                           only under integrate: direct) is never run here: the output gives the command for the
//                           host to run with its own tool, under the user's permission settings ("host").
//                6. clean   Removes the ticket's worktree (`git worktree remove`, never forced) and the local ticket
//                           branch (`git branch -d`). A worktree with changes is refused; the earlier steps stay
//                           done, and a rerun after it is cleaned finishes.
//              Output: { "format", "command": "merge", "ticket", "line", "branch", "result": "merged",
//                        "merge": "<sha>", "found": "merged" | "state" | "git", "stage": "delivered",
//                        "delivery": "committed" | "already" | "none", "tip": "<sha>",
//                        "push": { "status": "pushed" | "not-requested" | "no-origin" | "host", "command"? },
//                        "cleanup": { "worktree": "removed" | "absent", "branch": "deleted" | "absent" } }
//              With `--ci` (a red-light fix; no `--branch`, `--local` or `--checks`): the ticket is delivered, and
//              the branch merged is its red-light fix branch `<ticket branch>-ci` (see ci-init). Step 1 finds the
//              merge as above, except that with the fix branch gone, the latest merge recorded on the ticket whose
//              subject is git's default `Merge branch '<ticket branch>-ci'` is the one (a rerun after the cleanup);
//              a fix branch with no commits of its own is refused. Step 2 records the merge SHA alone (the ticket
//              stays delivered: state.mjs takes a `-ci` merge in delivered); there is no delivery; steps 4–6 as
//              above, the cleanup removing the fix branch's worktree and branch. Output as above, with
//              "ci": true and "delivery": "none".
// ci-init      Cuts the red-light fix branch `<ticket branch>-ci` from the current tip of the ticket's line, with a
//              worktree at `--worktree` (RED-LIGHT.md step 4). The ticket must be delivered with its ticket branch
//              recorded; the fix branch is not recorded in the state (it is always that name). An existing fix
//              branch is reused as it is. The fix branch is refused when it is an integration branch of the run, a
//              protected branch, or another ticket's ticket branch or fix branch.
//              Output: { "format", "command": "ci-init", "ticket", "line", "branch", "worktree", "head",
//                        "from": "<line tip>" | null, "created": { "branch", "worktree" } }
// revert       The red-light revert of a ticket (RED-LIGHT.md step 5), in the integration worktree, which must have
//              the ticket's line checked out. The ticket is delivered, or integrating with a merge recorded (a
//              merge whose later steps were refused), or stuck from an earlier run of this command (some merge of
//              it is already reverted; a ticket stuck another way is refused). Each step
//              checks whether it is done first, so a rerun after an interruption finishes the rest:
//                1. revert    Every merge recorded on the ticket (the `-ci` merges included; each must be on the
//                             line), newest first: `git revert -m 1 --no-edit <merge>` (no `-m` for a commit with
//                             one parent). A merge is already reverted when a commit on the line's first-parent
//                             history after it says `This reverts commit <merge>` (git's default message). Needs a
//                             clean worktree. A conflict: `git revert --abort`, exit 4 with { "result":
//                             "conflict", "merge", "files" }; the reverts before it stay committed. Resolve it with
//                             git's message kept (`git revert -m 1 <merge>`, resolve, `git revert --continue`),
//                             then rerun.
//                2. record    Local Markdown (`--local <ticket file>`): the completion record commit (the latest
//                             `<ticket>: sorry-matt completion` commit touching the file) is reverted the same
//                             way, when the file at HEAD is still delivered; then a `## sorry-matt blocker` section
//                             is appended (reason, each merge and its revert, the integration branch, the run) and
//                             `Status:` set to `ready-for-human`, committed alone as `<ticket>: sorry-matt
//                             blocker`. Done when the file's last blocker after its last completion names the
//                             ticket's first merge SHA. A working-tree copy that differs from both HEAD and that
//                             result is refused. GitHub: nothing here; the host files the raw issue (SEND-BACK.md
//                             "mark stuck") and moves the ticket from `--done` to `--stuck` ("record": "host").
//                3. state     The ticket → stuck, the reason `<--reason>; reverted <merge> by <revert>, …`.
//                4. dependents  Each `--dependent` (the host's list of tickets that depend on it; same line, not
//                             the ticket itself):
//                               integrated  delivered, or with a merge recorded: its merge stays. Local Markdown:
//                                           a blocker naming the upstream ticket, its merge and revert (the file
//                                           after `=` is required; done when the last blocker after the last
//                                           completion names the upstream's first merge SHA). Then → stuck, the
//                                           reason `upstream reverted: <ticket> (<revert>, …)`.
//                               in flight   any other stage not at an end state: → awaiting-ruling with that
//                                           reason; then, when it has a ticket branch, the branch tip is kept at
//                                           `…/upstream-reverted` (`git update-ref`), its worktree removed (never
//                                           forced) and the branch deleted (`git branch -D`; the ref keeps it).
//                                           While its assignment still has a deadline (an agent in flight) the
//                                           branch and worktree are left ("cleanup": "agent-in-flight"): release it
//                                           when the agent reports or is stopped, then rerun.
//                               otherwise   stuck or awaiting-ruling already: nothing ("none").
//                             The ticket branch rule (see ticket-init) holds for every branch removed here.
//                5. tip and push  As merge's steps 4 (the line's tip only) and 5.
//              Output: { "format", "command": "revert", "ticket", "line", "result": "reverted",
//                        "reverts": [{ "merge", "revert": "<sha>", "found": "reverted" | "git" }],
//                        "completion": "reverted" | "absent" | "not-found" | "none",
//                        "record": "committed" | "already" | "host", "stage": "stuck",
//                        "dependents": [{ "ticket", "treatment": "integrated" | "in-flight" | "none", "stage",
//                                         "record": "committed" | "already" | "none",
//                                         "kept": { "ref", "sha" } | null, "agent": "<id>" | null,
//                                         "cleanup": { "worktree", "branch" } | "agent-in-flight" | null }],
//                        "tip", "push" }
//              `completion` "not-found": the file at HEAD is delivered but no completion commit was found; the
//              blocker after it still makes frontier.mjs read the ticket as stuck.
//              Under integrate: ticket-pr (#197) the ticket's merges are on the base branch, so the revert goes out
//              as a pull request and the base branch itself is never pushed (#222: `--base` and `--repo` belong to
//              this form only; under any other integrate either is a usage error, 2). `--base` is required
//              (`--local` and `--push` are refused: the record is the host's raw issue, and the revert branch is
//              always pushed):
//              each merge is reverted, newest first, on the revert branch `<ticket branch>-revert`, cut from
//              `origin/<--base>` with a worktree at `--worktree` (an existing one is reused; a merge is already
//              reverted when a commit on the revert branch says `This reverts commit <merge>`). The ticket and each
//              `--dependent` are recorded exactly as above (the ticket stuck, an integrated dependent stuck, an
//              in-flight one awaiting a ruling with its branch tip kept), the cleanup running in `--repo`'s
//              repository. Then the revert branch is pushed and a revert pull request opened against `--base`
//              (`gh pr create`, not a draft; an open PR with that head is reused). Whether and when the revert PR is
//              merged is not this command's call: tick waits for the revert PR's own CI and hands the merge to the
//              host as a prompting call (RED-LIGHT.md, the ticket-pr handling). Output as above plus
//              "revertBranch", "head" (its tip), "pr", "prCreated", with "completion" "none", "record" "host" and
//              "push" { "status": "revert-pr", "branch" }.
// send-back    The git part of a send back for a redo (SEND-BACK.md steps 1 and 3), for a ticket queued or
//              integrating that has no merge recorded (a candidate already sent back, for a rerun). Refused when the
//              ticket was sent back once already (mark it stuck). The steps:
//                1. keep    `git update-ref refs/sorry-matt/<run>/<NN>-<slug>/sent-back-<k> <ticket branch>` (create
//                           only; `<k>` is the ticket's `sendBacks` + 1). Done when the ref is there and the branch is
//                           at it or gone; a branch at another commit (a new attempt) is refused.
//                2. state   queued → integrating → candidate (`sendBacks` + 1, state.mjs's guard).
//                3. clean   Removes the ticket's worktree (never forced) and deletes the branch (`git branch -D`;
//                           the ref keeps it).
//              Output: { "format", "command": "send-back", "ticket", "branch", "ref", "sha", "k", "line",
//                        "lineTip", "conflicts": [file], "touched": [file], "uncovered": [file] | null,
//                        "predicted": [file] | null, "stage": "candidate", "cleanup" }
//              `touched` is what the old attempt changed (`git diff --name-only <line>...<ref>`); with
//              `--predicted`, `uncovered` is touched minus predicted and `predicted` the widened list (predicted,
//              then the conflicts and touched files not in it): the send-back record and step 2 of SEND-BACK.md.
//              #222, integrate: ticket-pr: the line has no integration branch, so `<line>` above is the ticket's
//              fixed point — `origin/<--base>` (`--base` required for a ticket that is not stacked), or the
//              upstream's ticket branch for a stacked one — and `lineTip` is its tip; `--base` is refused under any
//              other integrate. The ticket's pull request and its branch on origin are left as they are (the PR
//              number stays recorded): the redo is pushed to the same PR by pr-push.
// stuck        The git part of "mark stuck" (SEND-BACK.md), for a ticket with no merge recorded, at any stage but
//              awaiting-ruling (stuck: a rerun). A ticket with a merge on the line (delivered, or integrating after a
//              refused later step) is refused: rerun merge to finish it, or revert it (revert marks it stuck).
//                1. record  Local Markdown (`--local`, with `--worktree` the integration worktree on the ticket's
//                           line): a `## sorry-matt blocker` section (reason, `--attempts`, the ticket branch and its
//                           kept ref, the integration branch, the run) and `Status: ready-for-human`, committed as
//                           `<ticket>: sorry-matt blocker`. Done when the last blocker after the last completion
//                           names this run. GitHub: the host files the raw issue ("record": "host").
//                2. keep    When the ticket branch exists: its tip kept at `…/stuck` (create only), then its worktree
//                           removed (never forced) and the branch deleted (`git branch -D`).
//                3. review  `--review-worktree`: prove-it's review worktree, removed with `git worktree remove
//                           --force` when registered. Checked before anything is touched, it must be this ticket's:
//                           detached, its HEAD one of the ticket's own commits (an ancestor of the ticket branch,
//                           or of its kept ref once the branch is gone, and not on the line). Any other worktree
//                           there (a branch checked out, another ticket's review worktree) is refused.
//                4. state   → stuck with `--reason`.
//                5. push    As merge's step 5 (the line of `--worktree`; without it "not-requested").
//              Output: { "format", "command": "stuck", "ticket", "line", "record": "committed" | "already" |
//                        "host", "kept": { "ref", "sha" } | null, "cleanup", "review": "removed" | "absent" |
//                        "not-requested", "stage": "stuck", "push" }
//
// Output is JSON on stdout, format "sorry-matt/integrate@1" (fields are only ever added, never renamed).
// Exit codes: 0 done; 1 git or the state could not be read or written (the message says which step); 2 bad
// arguments; 3 refused: well-formed, but the state or the repository does not allow it (the message says what
// is missing; steps finished before it stay finished); 4 merge or revert conflict (JSON on stdout; the step that
// conflicted changed nothing); 5 stack divergence: `gh stack sync` aborted on a diverged stack (JSON on stdout;
// nothing was pushed and nothing recorded); 6 closed: pr-merge --merged found the pull request closed without a merge
// (#220; JSON on stdout; nothing recorded, nothing cleaned). On 1, 2 and 3 nothing is written to stdout.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { UsageError, run, gh, canonical, failure, parseJson, runIfEntry } from './cli.mjs';
import { main as stateMain, load, leadOf, TERMINAL, profileOf } from './state.mjs';
import { ticketOwners } from './merges.mjs';
import { scan, ownRows, lastRecordIndex, sectionAt } from './ticket.mjs';
import { main as gateMain } from './merge-gate.mjs';

export const FORMAT = 'sorry-matt/integrate@1';
const CONFLICT = 4;
const DIVERGED = 5;
const CLOSED = 6;

/** Well-formed, but the state or the repository does not allow it: exit 3. */
class Refusal extends Error {}

// ---- git ---------------------------------------------------------------------------------------------------------

const git = (cwd, ...args) => run('git', args, cwd).replace(/\s+$/, '');
const tryGit = (cwd, ...args) => {
  try {
    return git(cwd, ...args);
  } catch {
    return null;
  }
};
const commitOf = (cwd, ref) => tryGit(cwd, 'rev-parse', '--verify', '-q', `${ref}^{commit}`);
const branchTip = (cwd, branch) => commitOf(cwd, `refs/heads/${branch}`);
const isAncestor = (cwd, a, b) => tryGit(cwd, 'merge-base', '--is-ancestor', a, b) !== null;
const mergeInProgress = (cwd) => tryGit(cwd, 'rev-parse', '--verify', '-q', 'MERGE_HEAD') !== null;
const currentBranch = (cwd) => tryGit(cwd, 'symbolic-ref', '--short', '-q', 'HEAD');

const samePath = (a, b) => {
  const x = canonical(a);
  const y = canonical(b);
  return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y;
};

/** The repository's worktrees: [{ path, branch (short name) | null }]. Prunes stale entries first. */
function worktrees(cwd) {
  git(cwd, 'worktree', 'prune');
  const out = [];
  for (const block of git(cwd, 'worktree', 'list', '--porcelain').split(/\r?\n\r?\n/)) {
    const path = /^worktree (.+)$/m.exec(block)?.[1];
    if (!path) continue;
    const ref = /^branch (.+)$/m.exec(block)?.[1] ?? null;
    out.push({ path, branch: ref ? ref.replace(/^refs\/heads\//, '') : null });
  }
  return out;
}

// Protected branches: main, master, and origin's default branch when the clone knows it. A push to one of them is
// left to the host's own tool, under the user's permission settings; tick.mjs marks its own such push `host`.
function isProtected(cwd, branch) {
  if (branch === 'main' || branch === 'master') return true;
  const head = tryGit(cwd, 'symbolic-ref', '--short', '-q', 'refs/remotes/origin/HEAD');
  return !!head && head.slice(head.indexOf('/') + 1) === branch;
}

/**
 * Make sure `branch` has a worktree at `path`: reuse the one holding it there, refuse one elsewhere, add one
 * otherwise. `create` is the start point when the branch does not exist yet. Returns what was created.
 */
function ensureWorktree(repo, branch, path, create) {
  const exists = branchTip(repo, branch) !== null;
  const all = worktrees(repo);
  const holder = all.find((w) => w.branch === branch);
  if (holder) {
    if (!samePath(holder.path, path)) throw new Refusal(`${branch} is already checked out at ${holder.path}, not at ${path}`);
    return { branch: false, worktree: false, path: holder.path };
  }
  const occupant = all.find((w) => samePath(w.path, path));
  if (occupant) throw new Refusal(`${path} is already the worktree of ${occupant.branch ?? 'a detached HEAD'}`);
  if (exists) {
    git(repo, 'worktree', 'add', path, branch);
    return { branch: false, worktree: true, path };
  }
  if (!create) throw new Refusal(`${branch} does not exist`);
  git(repo, 'worktree', 'add', '-b', branch, path, create);
  return { branch: true, worktree: true, path };
}

// ---- state -------------------------------------------------------------------------------------------------------

/** Run a state.mjs command; a refusal there is one here, any other failure is exit 1. */
function state(ctx, command, ...args) {
  const argv = [command, ctx.state, ...args, ...(ctx.now ? ['--now', ctx.now] : [])];
  const r = stateMain(argv);
  if (r.code === 0) return JSON.parse(r.out);
  const message = r.err.trim().replace(/^state: (refused: )?/, '');
  if (r.code === 3) throw new Refusal(`state.mjs ${command}: ${message}`);
  throw new Error(`state.mjs ${command}: ${message}`);
}

/** The ticket branch rule (see the header): refuse a branch that is not this ticket's own to merge and delete. */
function checkTicketBranch(s, id, t, branch, repo) {
  if (t.branch && branch !== t.branch) throw new Refusal(`${id}'s recorded ticket branch is ${t.branch}, not ${branch}`);
  if (branch in s.lines) throw new Refusal(`${branch} is an integration branch of this run, not a ticket branch`);
  if (isProtected(repo, branch)) throw new Refusal(`${branch} is a protected branch, not a ticket branch`);
  const other = Object.entries(s.tickets).find(([k, o]) => k !== id && o.branch === branch);
  if (other) throw new Refusal(`${branch} is ${other[0]}'s ticket branch`);
}

const ticketOf = (s, id) => {
  const t = s.tickets[id];
  if (t) return t;
  // #219: a bundle member is not missing; its lead stands for it (state.mjs's own refusal, word for word)
  const lead = leadOf(s, id);
  throw new Refusal(lead ? `${id} is a member of bundle ${lead}: name its lead, ${lead}` : `${id} is not a ticket of this run (add it with state.mjs add)`);
};

/**
 * #219: the base branch of a ticket's pull request is the state's (`prBase`, written by the first command given
 * `--base` for the ticket); a `--base` that differs from the recorded one is refused before anything is touched.
 */
function checkBase(id, t, base) {
  const recorded = t.prBase ?? null;
  if (base !== undefined && recorded !== null && base !== recorded) {
    throw new Refusal(`${id}'s pull request base is ${recorded} (recorded), not --base ${base}`);
  }
}

/** Records `--base` as the ticket's pull request base when none is recorded yet (after checkBase let it through). */
function recordBase(ctx, id, t, base) {
  if (base !== undefined && (t.prBase ?? null) === null) state(ctx, 'set', id, '--pr-base', base);
}

// ---- commands ----------------------------------------------------------------------------------------------------

function lineInit(ctx, rest, flags) {
  if (rest.length) throw new UsageError('line-init takes no positional arguments after the state file');
  if (!flags.branch) throw new UsageError('line-init needs --branch');
  const repo = ctx.repo;
  const s = load(ctx.state);
  const mode = profileOf(s).integrate;
  const branch = flags.branch;
  if (mode === 'ticket-pr') {
    if (flags.from !== undefined) throw new UsageError('--from: under integrate: ticket-pr the line has no integration branch; nothing is created');
    if (flags.worktree !== undefined) throw new UsageError('--worktree: under integrate: ticket-pr the line has no worktree');
    if (!(branch in s.lines)) state(ctx, 'line', branch);
    return {
      out: { command: 'line-init', integrate: mode, branch, worktree: null, tip: null, created: { branch: false, worktree: false } },
    };
  }
  let made;
  if (mode === 'direct') {
    if (flags.from !== undefined) throw new UsageError('--from: under integrate: direct the line is the base branch itself; nothing is created from a ref');
    if (branchTip(repo, branch) === null) throw new Refusal(`integrate: direct merges into the base branch ${branch}, which does not exist`);
    const holder = worktrees(repo).find((w) => w.branch === branch);
    if (holder) {
      if (flags.worktree !== undefined && !samePath(holder.path, flags.worktree)) {
        throw new Refusal(`integrate: direct: ${branch} is checked out at ${holder.path}; that is the line's worktree`);
      }
      made = { branch: false, worktree: false, path: holder.path };
    } else {
      if (flags.worktree === undefined) throw new UsageError(`line-init needs --worktree: ${branch} is not checked out anywhere`);
      made = ensureWorktree(repo, branch, ctx.path(flags.worktree), null);
    }
  } else {
    if (flags.worktree === undefined) throw new UsageError('line-init needs --worktree');
    if (isProtected(repo, branch)) {
      throw new Refusal(`integrate: aggregate-pr needs the line's own integration branch; ${branch} is the base branch`);
    }
    const from = flags.from ?? 'HEAD';
    if (branchTip(repo, branch) === null && commitOf(repo, from) === null) throw new Refusal(`--from ${from} is not a commit`);
    made = ensureWorktree(repo, branch, ctx.path(flags.worktree), from);
  }
  const tip = branchTip(repo, branch);
  if (s.lines[branch]?.tip !== tip) state(ctx, 'line', branch, '--tip', tip);
  return {
    out: { command: 'line-init', integrate: mode, branch, worktree: made.path, tip, created: { branch: made.branch, worktree: made.worktree } },
  };
}

function ticketInit(ctx, rest, flags) {
  if (rest.length !== 1) throw new UsageError('ticket-init takes exactly one ticket');
  if (!flags.branch) throw new UsageError('ticket-init needs --branch');
  if (!flags.worktree) throw new UsageError('ticket-init needs --worktree');
  const [id] = rest;
  const repo = ctx.repo;
  const s = load(ctx.state);
  const mode = profileOf(s).integrate;
  if (flags.base !== undefined && mode !== 'ticket-pr') throw new UsageError('--base is for integrate: ticket-pr');
  const t = ticketOf(s, id);
  if (TERMINAL.includes(t.stage)) throw new Refusal(`${id} is ${t.stage}, an end state`);
  if (mode === 'ticket-pr') return ticketInitPr(ctx, id, s, t, flags);
  const lineTip = branchTip(repo, t.line);
  if (lineTip === null) throw new Refusal(`${id}'s integration branch ${t.line} does not exist (line-init first)`);
  checkTicketBranch(s, id, t, flags.branch, repo);
  const made = ensureWorktree(repo, flags.branch, ctx.path(flags.worktree), lineTip);
  if (t.branch !== flags.branch) state(ctx, 'set', id, '--branch', flags.branch);
  return {
    out: {
      command: 'ticket-init',
      ticket: id,
      line: t.line,
      branch: flags.branch,
      worktree: made.path,
      head: branchTip(repo, flags.branch),
      from: made.branch ? lineTip : null,
      created: { branch: made.branch, worktree: made.worktree },
    },
  };
}

// ---- ticket-pr (#193) ----------------------------------------------------------------------------------------------

/** A non-interactive `gh stack` call, with the update notifier silenced. */
const STACK_ENV = Object.freeze({ GH_STACK_NO_UPDATE_NOTIFIER: '1' });
const ghStack = (ctx, cwd, ...args) => ctx.gh(['stack', ...args], cwd, STACK_ENV);

/** The run's effective integrate mode; a command that is ticket-pr only refuses any other. */
function ticketPrOnly(s, command) {
  const mode = profileOf(s).integrate;
  if (mode !== 'ticket-pr') throw new Refusal(`${command} is for integrate: ticket-pr; this run's integrate is ${mode}`);
}

/** The worktree holding `branch`, where `gh stack` acts on it. */
function stackCwd(repo, branch) {
  const holder = worktrees(repo).find((w) => w.branch === branch);
  if (!holder) throw new Refusal(`gh stack needs ${branch} checked out in a worktree, and none has it`);
  return holder.path;
}

/** ticket-init under integrate: ticket-pr — cut by the ticket's #188 fields (see the header). */
function ticketInitPr(ctx, id, s, t, flags) {
  const repo = ctx.repo;
  const waiting = t.waitingOn ?? [];
  if (waiting.length) throw new Refusal(`${id} is waiting on ${waiting.join(', ')} to merge; no branch is cut until they are`);
  checkTicketBranch(s, id, t, flags.branch, repo);
  checkBase(id, t, flags.base);
  const parent = t.stackParent ?? null;
  let from;
  if (parent !== null) {
    const up = s.tickets[parent];
    if (!up) throw new Refusal(`${id}'s stackParent ${parent} is not a ticket of this run`);
    if (!up.branch) throw new Refusal(`${id} is stacked on ${parent}, which has no ticket branch recorded (ticket-init it first)`);
    from = up.branch;
  } else {
    if (!flags.base) throw new UsageError('ticket-init under integrate: ticket-pr needs --base (the base branch) for a ticket that is not stacked');
    from = `origin/${flags.base}`;
  }
  const fromSha = commitOf(repo, from);
  if (fromSha === null) {
    throw new Refusal(
      parent !== null ? `${id} is stacked on ${parent}, whose branch ${from} does not exist` : `${from} is not a commit; fetch the base branch first`,
    );
  }
  const stack = [];
  let made;
  if (parent !== null && branchTip(repo, flags.branch) === null) {
    // #199 live run: `gh stack add` only runs on a branch of the stack, and creates the new branch itself. So the
    // worktree starts detached, checks out the upstream branch beside the upstream's own worktree
    // (--ignore-other-worktrees: nothing is committed there), joins it to a stack when it is in none yet (`init`
    // adopts an existing branch), and `add` cuts the ticket branch on top and checks it out.
    const wt = ctx.path(flags.worktree);
    const occupant = worktrees(repo).find((w) => samePath(w.path, wt));
    if (occupant) throw new Refusal(`${wt} is already the worktree of ${occupant.branch ?? 'a detached HEAD'}`);
    git(repo, 'worktree', 'add', '-q', '--detach', wt, from);
    git(wt, 'checkout', '-q', '--ignore-other-worktrees', from);
    let inStack = true;
    try {
      ghStack(ctx, wt, 'view');
    } catch {
      inStack = false;
    }
    if (!inStack) {
      ghStack(ctx, wt, 'init', from);
      stack.push(`init ${from}`);
    }
    ghStack(ctx, wt, 'add', flags.branch);
    stack.push(`add ${flags.branch}`);
    if (branchTip(repo, flags.branch) === null) throw new Error(`gh stack add did not create ${flags.branch}`);
    made = { branch: true, worktree: true, path: wt };
  } else made = ensureWorktree(repo, flags.branch, ctx.path(flags.worktree), from);
  if (t.branch !== flags.branch) state(ctx, 'set', id, '--branch', flags.branch);
  recordBase(ctx, id, t, flags.base);
  return {
    out: {
      command: 'ticket-init',
      ticket: id,
      line: t.line,
      branch: flags.branch,
      worktree: made.path,
      head: branchTip(repo, flags.branch),
      from: made.branch ? fromSha : null,
      created: { branch: made.branch, worktree: made.worktree },
      stack,
    },
  };
}

/** The ticket's recorded branch, checked by the ticket branch rule; refused when none is recorded. */
function recordedBranch(s, id, t, repo) {
  if (!t.branch) throw new Refusal(`${id} has no ticket branch recorded (ticket-init first)`);
  checkTicketBranch(s, id, t, t.branch, repo);
  return t.branch;
}

/** The branch must exist, and an origin remote must be there to push it to. */
function pushable(repo, id, branch, why) {
  if (branchTip(repo, branch) === null) throw new Refusal(`${id}'s ticket branch ${branch} does not exist`);
  if (tryGit(repo, 'remote', 'get-url', 'origin') === null) throw new Refusal(`the repository has no origin remote; ${why}`);
}

/** The ticket pr-open and pr-push act on: { t, branch, parent }, not at an end state, its branch pushable. */
function prTicket(ctx, s, id) {
  const t = ticketOf(s, id);
  if (TERMINAL.includes(t.stage)) throw new Refusal(`${id} is ${t.stage}, an end state`);
  const branch = recordedBranch(s, id, t, ctx.repo);
  pushable(ctx.repo, id, branch, 'ticket-pr pushes every ticket branch there');
  return { t, branch, parent: t.stackParent ?? null };
}

/** The number of the open pull request whose head is `branch`, or null. */
const openPrNumber = (ctx, repo, branch) => parseJson(ctx.gh(['pr', 'list', '--head', branch, '--state', 'open', '--json', 'number'], repo))[0]?.number ?? null;

/** The `Closes` lines of the PR body: one per bundled ticket, the lead first. */
const closeLines = (id, t) => [id, ...(t.members ?? [])].map((m) => `Closes ${m}`);

/**
 * The PR body: the ticket title, this ticket's commit subjects (no merges: a base merge taken into the branch is not
 * the ticket's change, #219), one final `Closes` line per bundled ticket.
 */
function prBody(repo, id, t, title, fromRef, branch) {
  const subjects = git(repo, 'log', '--no-merges', '--reverse', '--format=%s', `${fromRef}..refs/heads/${branch}`).split(/\r?\n/).filter(Boolean);
  return [title, '', ...subjects.map((x) => `- ${x}`), '', ...closeLines(id, t)].join('\n');
}

/** The ref this ticket's own commits are counted from: origin/<base>, or the upstream ticket's branch. */
function bodyFrom(repo, s, id, parent, base) {
  const fromRef = parent === null ? `origin/${base}` : s.tickets[parent]?.branch;
  if (!fromRef) throw new Refusal(`${id} is stacked on ${parent}, which has no ticket branch recorded`);
  if (commitOf(repo, fromRef) === null) throw new Refusal(`${fromRef} is not a commit`);
  return fromRef;
}

/**
 * #219: a reused PR's body holds every `Closes` line, whatever interrupted the create (`gh stack submit` opened it,
 * then `gh pr edit` failed). "kept": all there; "appended": the missing ones added under what is there; "written":
 * an empty body gets the body a create writes.
 */
function ensureCloses(ctx, repo, s, id, t, pr, flags, parent, branch) {
  const body = String(parseJson(ctx.gh(['pr', 'view', String(pr), '--json', 'body'], repo))?.body ?? '');
  const have = new Set(body.split(/\r?\n/).map((l) => l.trim().toLowerCase()));
  const missing = closeLines(id, t).filter((l) => !have.has(l.toLowerCase()));
  if (!missing.length) return 'kept';
  const blank = body.trim() === '';
  const kept = body.trimEnd();
  // under a Closes line already there the missing ones join its block; under anything else, after a blank line
  const gap = /^closes\s/i.test(kept.split(/\r?\n/).at(-1).trim()) ? '\n' : '\n\n';
  const next = blank ? prBody(repo, id, t, flags.title, bodyFrom(repo, s, id, parent, flags.base), branch) : `${kept}${gap}${missing.join('\n')}`;
  ctx.gh(['pr', 'edit', String(pr), '--body', next], repo);
  return blank ? 'written' : 'appended';
}

function prOpen(ctx, rest, flags) {
  if (rest.length !== 1) throw new UsageError('pr-open takes exactly one ticket');
  if (!flags.title) throw new UsageError('pr-open needs --title (the ticket title for the PR body)');
  const [id] = rest;
  const repo = ctx.repo;
  const s = load(ctx.state);
  ticketPrOnly(s, 'pr-open');
  const { t, branch, parent } = prTicket(ctx, s, id);
  checkBase(id, t, flags.base);
  if (parent === null && !flags.base) throw new UsageError('pr-open needs --base (the base branch) for a ticket that is not stacked');

  // 1. reuse an open PR: nothing is pushed (#219: a restacked branch is no fast-forward of what is on origin; a fix
  //    goes out with pr-push), the body only made sure of its Closes lines
  let pr = openPrNumber(ctx, repo, branch);
  const created = pr === null;
  let body = 'created';
  if (!created) body = ensureCloses(ctx, repo, s, id, t, pr, flags, parent, branch);
  else {
    // 2. push, then 3. create the draft
    const fromRef = bodyFrom(repo, s, id, parent, flags.base);
    git(repo, 'push', '-q', '-u', 'origin', branch);
    const text = prBody(repo, id, t, flags.title, fromRef, branch);
    if (parent === null) {
      const out = String(ctx.gh(['pr', 'create', '--draft', '--base', flags.base, '--head', branch, '--title', flags.title, '--body', text], repo));
      const m = /\/pull\/(\d+)/.exec(out);
      if (!m) throw new Error(`gh pr create printed no pull request URL: ${out.trim()}`);
      pr = Number(m[1]);
    } else {
      ghStack(ctx, stackCwd(repo, branch), 'submit', '--auto');
      pr = openPrNumber(ctx, repo, branch);
      if (pr === null) throw new Refusal(`gh stack submit --auto opened no pull request for ${branch}`);
      ctx.gh(['pr', 'edit', String(pr), '--body', text], repo);
    }
  }

  // 4. record
  if ((t.pr ?? null) !== pr) state(ctx, 'set', id, '--pr', String(pr));
  recordBase(ctx, id, t, flags.base);
  return { out: { command: 'pr-open', ticket: id, line: t.line, branch, stacked: parent !== null, pr, created, body } };
}

function prPush(ctx, rest, _flags) {
  if (rest.length !== 1) throw new UsageError('pr-push takes exactly one ticket');
  const [id] = rest;
  const repo = ctx.repo;
  const s = load(ctx.state);
  ticketPrOnly(s, 'pr-push');
  const { t, branch, parent } = prTicket(ctx, s, id);
  let pushed = 'git push';
  if (parent !== null) {
    ghStack(ctx, stackCwd(repo, branch), 'push');
    pushed = 'gh stack push';
  } else {
    // #222: a redo after a send-back is cut anew from the base, so the pull request's head (the old attempt) is not
    // in its history. Origin's head is read from origin itself, never from the tracking ref a fetch moves; it is
    // replaced — leased on it, on the same pull request — only when it is part of the old attempt kept at the
    // sent-back ref. A head that is not (someone else pushed to the PR branch) is refused, and nothing is pushed.
    const tip = branchTip(repo, branch);
    const remote = t.sendBacks >= 1 ? (tryGit(repo, 'ls-remote', 'origin', `refs/heads/${branch}`) ?? '').split(/\s+/)[0] || null : null;
    if (remote !== null && !(commitOf(repo, remote) !== null && isAncestor(repo, remote, tip))) {
      const ref = keptRef(s.run, branch, `sent-back-${t.sendBacks}`);
      const kept = commitOf(repo, ref);
      if (kept === null || commitOf(repo, remote) === null || !isAncestor(repo, remote, kept)) {
        throw new Refusal(`origin's ${branch} is at ${remote}, which is not part of the old attempt kept at ${ref}: someone else pushed to the pull request's branch; it is not overwritten`);
      }
      git(repo, 'push', '-q', '-u', `--force-with-lease=refs/heads/${branch}:${remote}`, 'origin', branch);
      pushed = 'git push --force-with-lease';
    } else git(repo, 'push', '-q', '-u', 'origin', branch);
  }
  return {
    out: { command: 'pr-push', ticket: id, branch, stacked: parent !== null, pushed, head: branchTip(repo, branch) },
  };
}

// ---- pr-merge (#194) -----------------------------------------------------------------------------------------------

/**
 * The ticket pr-merge acts on: { t, branch, pr, parent }, with its branch and PR recorded. `stages` is the phase's
 * allowed stages (#196: --ready also takes awaiting-ci, --merged also takes awaiting-merge and delivered reruns).
 */
function prMergeTicket(ctx, s, id, stages) {
  const t = ticketOf(s, id);
  if (!stages.includes(t.stage)) throw new Refusal(`${id} is ${t.stage}; pr-merge takes a ticket that is ${stages.join(' or ')}`);
  const branch = recordedBranch(s, id, t, ctx.repo);
  if ((t.pr ?? null) === null) throw new Refusal(`${id} has no pull request recorded (pr-open first)`);
  return { t, branch, pr: t.pr, parent: t.stackParent ?? null };
}

const prMergeOut = (phase, id, t, rest) => ({
  command: 'pr-merge', phase, ticket: id, line: t.line, pr: t.pr, branch: t.branch, stacked: (t.stackParent ?? null) !== null, ...rest,
});

/** Phase "push": sync the base into the ticket branch, push it, and report the head for tick's CI wake-up. */
function prMergePush(ctx, id, s, flags) {
  const repo = ctx.repo;
  const { t, branch, parent } = prMergeTicket(ctx, s, id, ['queued', 'integrating']);
  pushable(repo, id, branch, 'pr-merge pushes the ticket branch there');
  checkBase(id, t, flags.base);
  let synced;
  // #219: the worktree holding the branch is looked up only where it is used — the merge and the stack — so a rerun
  // whose base is already taken pushes from the repository with no worktree left holding the branch
  if (parent === null) {
    if (!flags.base) throw new UsageError('pr-merge needs --base (the base branch) for a ticket that is not stacked');
    const from = `origin/${flags.base}`;
    const fromSha = commitOf(repo, from);
    if (fromSha === null) throw new Refusal(`${from} is not a commit; fetch the base branch first`);
    if (isAncestor(repo, fromSha, `refs/heads/${branch}`)) synced = 'already';
    else {
      const m = mergeBranch(stackCwd(repo, branch), from);
      if (m.files) return { code: CONFLICT, out: prMergeOut('push', id, t, { result: 'conflict', files: m.files }) };
      synced = `merged ${from}`;
    }
    git(repo, 'push', '-q', '-u', 'origin', branch);
  } else {
    const wt = stackCwd(repo, branch);
    // A sync that aborted on stack divergence exits 0; its output names the divergence (#187 live-run item), on
    // stdout or stderr: both are read (#219), so the channel gh stack picks does not decide it. A seam that answers
    // with a string gave stdout alone.
    const r = ctx.gh(['stack', 'sync'], wt, STACK_ENV, { both: true });
    const out = typeof r === 'string' ? r : `${r?.stdout ?? ''}\n${r?.stderr ?? ''}`;
    const divergence = out.split(/\r?\n/).filter((l) => /diverg/i.test(l));
    if (divergence.length) return { code: DIVERGED, out: prMergeOut('push', id, t, { result: 'diverged', divergence }) };
    synced = 'gh stack sync';
    ghStack(ctx, wt, 'push');
  }
  if (t.stage === 'queued') state(ctx, 'stage', 'integrating', id);
  recordBase(ctx, id, t, flags.base);
  return { out: prMergeOut('push', id, t, { result: 'pushed', synced, head: branchTip(repo, branch) }) };
}

/** Phase "ready" (after the host confirms CI green): `gh pr ready`, then merge-gate.mjs decides what may be sent. */
function prMergeReady(ctx, id, s, flags) {
  const repo = ctx.repo;
  const { t, pr, parent } = prMergeTicket(ctx, s, id, ['queued', 'integrating', 'awaiting-ci']);
  if (!flags.base) throw new UsageError('pr-merge --ready needs --base (the base branch) for merge-gate.mjs');
  checkBase(id, t, flags.base);
  ctx.gh(['pr', 'ready', String(pr)], repo);
  const slug = parseJson(ctx.gh(['repo', 'view', '--json', 'nameWithOwner'], repo))?.nameWithOwner;
  if (typeof slug !== 'string' || !/^[^/\s]+\/[^/\s]+$/.test(slug)) throw new Error(`gh repo view printed no nameWithOwner: ${String(slug)}`);
  const r = gateMain(['--repo', slug, '--base', flags.base], {
    cwd: repo,
    gh: ctx.gh,
    git: (args, cwd) => spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 << 20 }),
  });
  if (r.code !== 0) throw new Error(`merge-gate.mjs exited ${r.code}: ${r.err.trim()}`);
  const gate = JSON.parse(r.out);
  // The script never sends the merge: on "merge" or "queue" the command goes to the host, never --admin, never
  // auto-merge; on "human" nothing is sent.
  // #199: a PR in a stack — stacked itself, or with a live ticket stacked on it — merges with gh stack merge only
  const inStack = parent !== null || Object.values(s.tickets).some((o) => o.stackParent === id && !['stuck', 'awaiting-ruling'].includes(o.stage));
  const send = ['merge', 'queue'].includes(gate.decision)
    ? { status: 'host', command: inStack ? `gh stack merge ${pr} --yes --squash` : `gh pr merge ${pr}` }
    : { status: 'human' };
  if (t.stage === 'queued') state(ctx, 'stage', 'integrating', id);
  recordBase(ctx, id, t, flags.base);
  return { out: prMergeOut('ready', id, t, { base: flags.base, gate: { decision: gate.decision, reason: gate.reason }, send }) };
}

/** Phase "merged" (after the host reports the merge done): record the merge SHA, deliver, and clean up locally. */
function prMergeMerged(ctx, id, s) {
  const repo = ctx.repo;
  const { t, branch, pr } = prMergeTicket(ctx, s, id, ['queued', 'integrating', 'awaiting-merge', 'delivered']);
  const view = parseJson(ctx.gh(['pr', 'view', String(pr), '--json', 'mergeCommit,state'], repo));
  // #220: closed without a merge is not "not merged yet": its own exit, for tick's pr-closed judge
  if (view?.state === 'CLOSED') return { code: CLOSED, out: prMergeOut('merged', id, t, { result: 'closed', state: 'CLOSED' }) };
  if (view?.state !== 'MERGED') throw new Refusal(`${id}'s pull request ${pr} is ${view?.state ?? 'in an unknown state'}, not MERGED; the host sends the merge first`);
  const sha = view?.mergeCommit?.oid;
  if (typeof sha !== 'string' || !/^[0-9a-f]{40}$/.test(sha)) throw new Error(`gh pr view printed no merge commit for pull request ${pr}`);
  if (t.stage === 'queued') state(ctx, 'stage', 'integrating', id);
  if (!t.merges.some((m) => m.sha === sha)) state(ctx, 'merge', id, sha);
  // `state.mjs merge` never moves the stage: after the writes above the ticket is integrating unless it entered delivered.
  if (t.stage !== 'delivered') state(ctx, 'stage', 'delivered', id);
  const cleanup = cleanBranch(repo, branch, `${id} is merged and recorded`, true);
  return { out: prMergeOut('merged', id, t, { merge: sha, stage: 'delivered', cleanup }) };
}

function prMerge(ctx, rest, flags) {
  if (rest.length !== 1) throw new UsageError('pr-merge takes exactly one ticket');
  if (flags.ready && flags.merged) throw new UsageError('--ready and --merged are different calls: one phase at a time');
  const [id] = rest;
  const s = load(ctx.state);
  ticketPrOnly(s, 'pr-merge');
  if (flags.merged) return prMergeMerged(ctx, id, s);
  if (flags.ready) return prMergeReady(ctx, id, s, flags);
  return prMergePush(ctx, id, s, flags);
}

/** patch-id (#199, see the header): the patch-id of the ticket's own change against `--from`. */
function patchIdOf(ctx, rest, flags) {
  if (rest.length !== 1) throw new UsageError('patch-id takes exactly one ticket');
  if (!flags.from) throw new UsageError('patch-id needs --from (the ref the ticket\'s own change is taken against)');
  const [id] = rest;
  const repo = ctx.repo;
  const s = load(ctx.state);
  ticketPrOnly(s, 'patch-id');
  const t = ticketOf(s, id);
  const branch = recordedBranch(s, id, t, repo);
  if (commitOf(repo, flags.from) === null) throw new Refusal(`${flags.from} is not a commit`);
  const head = branchTip(repo, branch);
  const base = git(repo, 'merge-base', flags.from, `refs/heads/${branch}`);
  const diff = git(repo, 'diff', '--no-color', '--no-ext-diff', base, `refs/heads/${branch}`);
  let patchId = null;
  if (diff.trim()) {
    const r = spawnSync('git', ['patch-id', '--stable'], { cwd: repo, input: `${diff}\n`, encoding: 'utf8', maxBuffer: 256 << 20 });
    if (r.status !== 0) throw new Error(`git patch-id failed: ${String(r.stderr).trim()}`);
    patchId = String(r.stdout).trim().split(/\s+/)[0] || null;
  }
  return { out: { command: 'patch-id', ticket: id, branch, from: flags.from, base, head, patchId } };
}

/** The merges on the line's first-parent history, oldest first: [{ sha, parents, subject }]. */
function firstParentMerges(wt, line) {
  return git(wt, 'log', '--first-parent', '--merges', '--reverse', '--format=%H%x09%P%x09%s', `refs/heads/${line}`)
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => {
      const [sha, parents, ...s] = l.split('\t');
      return { sha, parents: parents.split(' ').filter(Boolean), subject: s.join('\t') };
    });
}

/** The ticket's merge on the line: { sha, found } or null when it is not merged yet (see step 1). */
function findMerge(wt, line, id, t, branch) {
  if (t.merges.length) {
    const sha = commitOf(wt, t.merges[0].sha);
    if (sha === null) throw new Refusal(`${id}: the recorded merge ${t.merges[0].sha} is not a commit in this repository`);
    if (!isAncestor(wt, sha, `refs/heads/${line}`)) throw new Refusal(`${id}: the recorded merge ${sha} is not on ${line}; the state and git disagree`);
    return { sha, found: 'state' };
  }
  const tip = branchTip(wt, branch);
  if (tip !== null && !isAncestor(wt, tip, `refs/heads/${line}`)) return null;
  const commits = firstParentMerges(wt, line);
  const exact = tip === null ? undefined : commits.find((c) => c.parents[1] === tip);
  if (exact) return { sha: exact.sha, found: 'git' };
  const { owners } = ticketOwners([{ id, branch, merges: [] }], (ref) => git(wt, 'rev-parse', '--verify', `${ref}^{commit}`));
  const named = commits.find((c) => owners(c).owners.length);
  if (named) return { sha: named.sha, found: 'git' };
  if (tip !== null) throw new Refusal(`${id}: ${branch} is already contained in ${line}, but no merge of it is there (does it have commits of its own?)`);
  throw new Refusal(`${id}: ${branch} does not exist and no merge of ${id} is on ${line}`);
}

/** The red-light fix's merge on the line: { sha, found } or null when it is not merged yet (see merge --ci). */
function findCiMerge(wt, line, id, t, branch) {
  const recorded = t.merges.map((m) => commitOf(wt, m.sha)).filter(Boolean);
  const tip = branchTip(wt, branch);
  if (tip === null) {
    const subject = `Merge branch '${branch}'`;
    const sha = [...recorded].reverse().find((r) => git(wt, 'log', '-1', '--format=%s', r).startsWith(subject));
    if (sha && isAncestor(wt, sha, `refs/heads/${line}`)) return { sha, found: 'state' };
    throw new Refusal(`${id}: ${branch} does not exist and no merge of it is recorded (ci-init first)`);
  }
  if (!isAncestor(wt, tip, `refs/heads/${line}`)) return null;
  const exact = firstParentMerges(wt, line).find((c) => c.parents[1] === tip);
  if (exact) return { sha: exact.sha, found: recorded.includes(exact.sha) ? 'state' : 'git' };
  throw new Refusal(`${id}: ${branch} is already contained in ${line}, but no merge of it is there (does it have commits of its own?)`);
}

/** `git merge --no-ff --no-edit <branch>`: { sha }, or { files } after aborting a conflict. */
function mergeBranch(wt, branch) {
  if (git(wt, 'status', '--porcelain', '--untracked-files=no')) throw new Refusal(`${wt} has uncommitted changes; the merge needs a clean worktree`);
  try {
    git(wt, 'merge', '--no-ff', '--no-edit', branch);
  } catch (error) {
    if (!mergeInProgress(wt)) throw error;
    const files = git(wt, 'diff', '--name-only', '--diff-filter=U').split(/\r?\n/).filter(Boolean);
    git(wt, 'merge', '--abort');
    return { files };
  }
  return { sha: git(wt, 'rev-parse', 'HEAD') };
}

// ---- Local Markdown records ----------------------------------------------------------------------------------------

const UNCHECKED = /^(\s*[-*+]\s+)\[ \]/;
const STATUS = /^[ \t]*(?:\*\*)?Status(?::\*\*|\*\*:|:)[ \t]*(.*)$/i;
const COMPLETION = (t) => /^sorry-matt completion$/i.test(t);
const BLOCKER = (t) => /^sorry-matt blocker$/i.test(t);

/** frontier.mjs's done rule, minus the boxes: a non-empty completion record after the last blocker. */
export function delivered(text) {
  const rows = scan(text);
  const at = lastRecordIndex(rows, COMPLETION);
  return at >= 0 && lastRecordIndex(rows, BLOCKER) < at && sectionAt(rows, at).some((r) => r.line.trim());
}

/** True when the file's last blocker comes after its last completion and names `marker`. */
export function blocked(text, marker) {
  const rows = scan(text);
  const at = lastRecordIndex(rows, BLOCKER);
  return at >= 0 && lastRecordIndex(rows, COMPLETION) < at && sectionAt(rows, at).some((r) => r.line.includes(marker));
}

/** The ticket's own `Status:` set to ready-for-human in `out` (rows' lines); a line is added under the title when none. */
function setReady(rows, out) {
  const own = ownRows(rows);
  const status = own.findIndex((r) => r.line && !r.level && STATUS.test(r.line));
  if (status >= 0) {
    const value = STATUS.exec(out[status])[1];
    out[status] = `${out[status].slice(0, out[status].length - value.length)}ready-for-human`;
    return;
  }
  const title = rows.findIndex((r) => r.level === 1);
  if (title >= 0) out.splice(title + 1, 0, '', 'Status: ready-for-human');
  else out.unshift('Status: ready-for-human', '');
}

/** `out` with its trailing blank lines dropped, then `## <title>`, `items` and a final newline. */
function appendSection(out, title, items, eol) {
  while (out.length && !out[out.length - 1].trim()) out.pop();
  out.push('', `## ${title}`, '', ...items, '');
  return out.join(eol);
}

/** The ticket file with its boxes ticked, Status ready-for-human and a completion section appended. */
export function deliver(text, { merge, line, commits, checks }) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const rows = scan(text);
  const own = ownRows(rows);
  const out = rows.map((r) => r.line);
  const tick = (i) => {
    out[i] = out[i].replace(UNCHECKED, '$1[x]');
  };
  own.forEach((r, i) => r.line && tick(i));
  rows.forEach((r, i) => {
    if (!r.level || !/^sorry-matt expansion$/i.test(r.title)) return;
    sectionAt(rows, i).forEach((row, k) => !row.fenced && tick(i + 1 + k));
  });
  setReady(rows, out);
  return appendSection(out, 'sorry-matt completion', [
    `- Merge: ${merge}`,
    `- Integration branch: ${line}`,
    '- Implementation commits:',
    ...(commits.length ? commits.map((c) => `  - ${c}`) : ['  - (none)']),
    `- Checks passed: ${checks}`,
  ], eol);
}

/** The ticket file with Status ready-for-human and a blocker section listing `items` appended. */
export function block(text, items) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const rows = scan(text);
  const out = rows.map((r) => r.line);
  setReady(rows, out);
  return appendSection(out, 'sorry-matt blocker', items.map((i) => `- ${i}`), eol);
}

/** The ticket file inside the integration worktree: { abs, rel, head } with its text as committed at HEAD. */
function localFile(wt, file, line) {
  const abs = resolve(wt, file);
  const rel = relative(canonical(wt), canonical(abs)).split(sep).join('/');
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Refusal(`--local ${file} is outside the integration worktree ${wt}`);
  try {
    return { abs, rel, head: run('git', ['show', `HEAD:${rel}`], wt) };
  } catch {
    throw new Refusal(`--local ${rel} is not committed on ${line}`);
  }
}

/**
 * Commit the ticket file as `make(text)` alone. The working copy must equal HEAD (or be missing) or already be
 * that result: anything else is someone's uncommitted edit, refused.
 */
function commitLocal(wt, { abs, rel, head }, make, message) {
  // Compared with line endings normalized: a checkout may turn the committed LF into CRLF.
  const lf = (x) => x.replace(/\r\n/g, '\n');
  const now = existsSync(abs) ? readFileSync(abs, 'utf8') : null;
  let body;
  if (now === null || lf(now) === lf(head)) body = make(now ?? head);
  else if (lf(now) === lf(make(head))) body = now;
  else throw new Refusal(`${rel} has uncommitted changes in ${wt}; commit or discard them, then rerun`);
  writeFileSync(abs, body);
  git(wt, 'add', '--', rel);
  git(wt, 'commit', '-q', '-m', message, '--', rel);
  return 'committed';
}

function deliverLocal(wt, file, info, id) {
  const f = localFile(wt, file, info.line);
  if (delivered(f.head)) return 'already';
  return commitLocal(wt, f, (text) => deliver(text, info), `${id}: sorry-matt completion`);
}

/** Append a blocker naming `marker` to the ticket file, unless its last blocker already does. */
function blockLocal(wt, file, line, id, marker, items) {
  const f = localFile(wt, file, line);
  if (blocked(f.head, marker)) return 'already';
  return commitLocal(wt, f, (text) => block(text, items), `${id}: sorry-matt blocker`);
}

// ---- shared steps --------------------------------------------------------------------------------------------------

/** Step 5 of merge: push the line, or leave a push to a protected branch to the host. */
function pushLine(wt, line, requested) {
  if (!requested) return { status: 'not-requested' };
  if (tryGit(wt, 'remote', 'get-url', 'origin') === null) return { status: 'no-origin' };
  if (isProtected(wt, line)) return { status: 'host', command: `git -C "${wt}" push -u origin ${line}` };
  git(wt, 'push', '-q', '-u', 'origin', line);
  return { status: 'pushed' };
}

/**
 * Remove the worktree holding `branch` (never forced), then delete the branch (`-d`, or `-D` when `force`: its tip
 * is kept elsewhere). `done` opens the refusal: what stays done when this cannot finish.
 */
function cleanBranch(cwd, branch, done, force = false) {
  const cleanup = { worktree: 'absent', branch: 'absent' };
  const holder = worktrees(cwd).find((w) => w.branch === branch);
  if (holder) {
    try {
      git(cwd, 'worktree', 'remove', holder.path);
    } catch (error) {
      throw new Refusal(`${done}, but its worktree ${holder.path} could not be removed (${String(error.stderr ?? error.message).trim()}); clean it, then rerun`);
    }
    cleanup.worktree = 'removed';
  }
  if (branchTip(cwd, branch) !== null) {
    try {
      git(cwd, 'branch', '-q', force ? '-D' : '-d', branch);
    } catch (error) {
      throw new Refusal(`${done}, but ${branch} could not be deleted (${String(error.stderr ?? error.message).trim()})`);
    }
    cleanup.branch = 'deleted';
  }
  return cleanup;
}

/** `refs/sorry-matt/<run>/<branch without its run prefix>/<leaf>`. */
const keptRef = (run, branch, leaf) => `refs/sorry-matt/${run}/${branch.startsWith(`${run}/`) ? branch.slice(run.length + 1) : branch}/${leaf}`;

/**
 * Keep the branch's tip at `ref` (created only when missing). { ref, sha }, or null when neither the branch nor the
 * ref exists. A ref at another commit than a branch that still exists is refused: that is a new attempt.
 */
function keepTip(cwd, branch, ref) {
  const tip = branchTip(cwd, branch);
  const kept = commitOf(cwd, ref);
  if (tip === null) return kept === null ? null : { ref, sha: kept };
  if (kept === null) {
    git(cwd, 'update-ref', ref, tip, '');
    return { ref, sha: tip };
  }
  if (kept !== tip) throw new Refusal(`${ref} already keeps ${kept}, but ${branch} is at ${tip} (a new attempt?); nothing was removed`);
  return { ref, sha: tip };
}

const revertInProgress = (cwd) => tryGit(cwd, 'rev-parse', '--verify', '-q', 'REVERT_HEAD') !== null;
const dirty = (cwd) => git(cwd, 'status', '--porcelain', '--untracked-files=no') !== '';
const list = (text) => (text === undefined ? [] : text.split(',').map((x) => x.trim()).filter(Boolean));

/** The commit on the line's first-parent history after `sha` that reverts it (git's default message), or null. */
function revertOf(wt, sha, line) {
  const out = git(wt, 'log', '--first-parent', '--format=%H', '--fixed-strings', `--grep=This reverts commit ${sha}`, `${sha}..refs/heads/${line}`);
  return out.split(/\r?\n/).filter(Boolean).pop() ?? null;
}

/** `git revert --no-edit` (with `-m 1` for a merge): { sha }, or { files } after aborting a conflict. */
function revertCommit(wt, sha) {
  const parents = git(wt, 'rev-list', '--parents', '-n', '1', sha).split(' ').length - 1;
  try {
    git(wt, 'revert', '--no-edit', ...(parents > 1 ? ['-m', '1'] : []), sha);
  } catch (error) {
    if (!revertInProgress(wt)) throw error;
    const files = git(wt, 'diff', '--name-only', '--diff-filter=U').split(/\r?\n/).filter(Boolean);
    git(wt, 'revert', '--abort');
    return { files };
  }
  return { sha: git(wt, 'rev-parse', 'HEAD') };
}

/** The integration worktree checks every command run in it shares. */
function onLine(wt, line, id) {
  const on = currentBranch(wt);
  if (on !== line) throw new Refusal(`${wt} has ${on ?? 'no branch'} checked out, not ${id}'s integration branch ${line}`);
  if (mergeInProgress(wt)) throw new Refusal(`a merge is in progress in ${wt}: finish it (git commit --no-edit) or abort it (git merge --abort), then rerun`);
  if (revertInProgress(wt)) throw new Refusal(`a revert is in progress in ${wt}: finish it (git revert --continue) or abort it (git revert --abort), then rerun`);
}

// ---- merge -------------------------------------------------------------------------------------------------------

function merge(ctx, rest, flags) {
  if (rest.length !== 1) throw new UsageError('merge takes exactly one ticket');
  if (!flags.worktree) throw new UsageError('merge needs --worktree (the integration worktree)');
  if (flags.checks !== undefined && flags.local === undefined) throw new UsageError('--checks goes with --local');
  if (flags.ci && (flags.branch !== undefined || flags.local !== undefined)) throw new UsageError('--ci merges the ticket\'s <branch>-ci: no --branch, --local or --checks');
  const [id] = rest;
  const wt = ctx.path(flags.worktree);
  let s = load(ctx.state);
  let t = ticketOf(s, id);
  if (flags.ci) return ciMerge(ctx, id, s, wt, flags);
  if (!['queued', 'integrating', 'delivered'].includes(t.stage)) {
    throw new Refusal(`${id} is ${t.stage}; merge takes a ticket that is queued, integrating, or delivered (a rerun)`);
  }
  const branch = flags.branch ?? t.branch;
  if (!branch) throw new Refusal(`${id} has no ticket branch recorded: pass --branch, or create it with ticket-init`);
  checkTicketBranch(s, id, t, branch, wt);
  const line = t.line;
  const checks = flags.checks ?? t.verification;
  onLine(wt, line, id);
  if (flags.local !== undefined && !checks) throw new Refusal(`${id}: the delivery record needs the checks passed: pass --checks, or set --verification in the state`);

  // 1. merge
  let found = findMerge(wt, line, id, t, branch);
  if (!found) {
    const m = mergeBranch(wt, branch);
    if (m.files) return { code: CONFLICT, out: { command: 'merge', ticket: id, line, branch, result: 'conflict', files: m.files } };
    found = { sha: m.sha, found: 'merged' };
  }

  // 2. record
  if (t.stage === 'queued') state(ctx, 'stage', 'integrating', id);
  if (!t.merges.some((m) => commitOf(wt, m.sha) === found.sha)) state(ctx, 'merge', id, found.sha);

  // 3. deliver
  let delivery = 'none';
  if (flags.local !== undefined) {
    const commits = git(wt, 'log', '--reverse', '--format=%h %s', `${found.sha}^1..${found.sha}^2`).split(/\r?\n/).filter(Boolean);
    delivery = deliverLocal(wt, flags.local, { merge: found.sha, line, commits, checks }, id);
  }

  // 4. stage and tip
  s = load(ctx.state);
  t = s.tickets[id];
  if (t.stage === 'integrating') state(ctx, 'stage', 'delivered', id);
  const tip = git(wt, 'rev-parse', 'HEAD');
  if (s.lines[line]?.tip !== tip) state(ctx, 'line', line, '--tip', tip);

  // 5. push and 6. clean
  const push = pushLine(wt, line, flags.push);
  const cleanup = cleanBranch(wt, branch, `${id} is merged and recorded`);
  return {
    out: {
      command: 'merge',
      ticket: id,
      line,
      branch,
      result: 'merged',
      merge: found.sha,
      found: found.found,
      stage: load(ctx.state).tickets[id].stage,
      delivery,
      tip,
      push,
      cleanup,
    },
  };
}

// ---- red-light fix -------------------------------------------------------------------------------------------------

/** The fix branch rule: never a line, a protected branch, or another ticket's ticket or fix branch. */
function checkCiBranch(s, id, branch, repo) {
  if (branch in s.lines) throw new Refusal(`${branch} is an integration branch of this run, not a red-light fix branch`);
  if (isProtected(repo, branch)) throw new Refusal(`${branch} is a protected branch, not a red-light fix branch`);
  const other = Object.entries(s.tickets).find(([k, o]) => o.branch && (o.branch === branch || (k !== id && `${o.branch}-ci` === branch)));
  if (other) throw new Refusal(`${branch} is ${other[0]}'s branch`);
}

/** The delivered ticket and its fix branch name, refused when it has none. */
function ciTicket(s, id) {
  const t = ticketOf(s, id);
  if (t.stage !== 'delivered') throw new Refusal(`${id} is ${t.stage}; a red-light fix is for a delivered ticket`);
  if (!t.branch) throw new Refusal(`${id} has no ticket branch recorded; its fix branch is <ticket branch>-ci`);
  return { t, branch: `${t.branch}-ci` };
}

function ciInit(ctx, rest, flags) {
  if (rest.length !== 1) throw new UsageError('ci-init takes exactly one ticket');
  if (!flags.worktree) throw new UsageError('ci-init needs --worktree');
  const [id] = rest;
  const repo = ctx.repo;
  const s = load(ctx.state);
  const { t, branch } = ciTicket(s, id);
  const lineTip = branchTip(repo, t.line);
  if (lineTip === null) throw new Refusal(`${id}'s integration branch ${t.line} does not exist`);
  checkCiBranch(s, id, branch, repo);
  const made = ensureWorktree(repo, branch, ctx.path(flags.worktree), lineTip);
  return {
    out: {
      command: 'ci-init',
      ticket: id,
      line: t.line,
      branch,
      worktree: made.path,
      head: branchTip(repo, branch),
      from: made.branch ? lineTip : null,
      created: { branch: made.branch, worktree: made.worktree },
    },
  };
}

function ciMerge(ctx, id, s, wt, flags) {
  const { t, branch } = ciTicket(s, id);
  checkCiBranch(s, id, branch, wt);
  const line = t.line;
  onLine(wt, line, id);
  let found = findCiMerge(wt, line, id, t, branch);
  if (!found) {
    const m = mergeBranch(wt, branch);
    if (m.files) return { code: CONFLICT, out: { command: 'merge', ci: true, ticket: id, line, branch, result: 'conflict', files: m.files } };
    found = { sha: m.sha, found: 'merged' };
  }
  if (!t.merges.some((m) => commitOf(wt, m.sha) === found.sha)) state(ctx, 'merge', id, found.sha);
  const tip = git(wt, 'rev-parse', 'HEAD');
  if (load(ctx.state).lines[line]?.tip !== tip) state(ctx, 'line', line, '--tip', tip);
  const push = pushLine(wt, line, flags.push);
  const cleanup = cleanBranch(wt, branch, `${id}'s red-light fix is merged and recorded`);
  return {
    out: {
      command: 'merge',
      ci: true,
      ticket: id,
      line,
      branch,
      result: 'merged',
      merge: found.sha,
      found: found.found,
      stage: load(ctx.state).tickets[id].stage,
      delivery: 'none',
      tip,
      push,
      cleanup,
    },
  };
}

// ---- revert --------------------------------------------------------------------------------------------------------

/** A dependent whose merge is on the line: it stays, and the dependent becomes stuck. */
const INTEGRATED = (t) => t.merges.length > 0 && t.stage !== 'awaiting-ruling';

function revert(ctx, rest, flags) {
  if (rest.length !== 1) throw new UsageError('revert takes exactly one ticket');
  if (!flags.worktree) throw new UsageError('revert needs --worktree (the integration worktree)');
  if (!flags.reason) throw new UsageError('revert needs --reason');
  const s0 = load(ctx.state);
  if (profileOf(s0).integrate === 'ticket-pr') return revertPr(ctx, rest, flags, s0);
  if (flags.base !== undefined) throw new UsageError('--base is for integrate: ticket-pr');
  if (flags.repo !== undefined) throw new UsageError('--repo is for integrate: ticket-pr (the integration worktree is --worktree)');
  const local = flags.local !== undefined;
  const deps = (flags.dependent ?? []).map((d) => {
    const at = d.indexOf('=');
    const dep = at < 0 ? { id: d, file: null } : { id: d.slice(0, at), file: d.slice(at + 1) };
    if (dep.file !== null && !local) throw new UsageError(`--dependent ${d}: a ticket file goes with --local`);
    return dep;
  });
  const [id] = rest;
  const wt = ctx.path(flags.worktree);
  let s = s0;
  const t = ticketOf(s, id);
  if (!['delivered', 'integrating', 'stuck'].includes(t.stage)) {
    throw new Refusal(`${id} is ${t.stage}; revert takes a delivered ticket, or an integrating one with its merge recorded`);
  }
  if (!t.merges.length) throw new Refusal(`${id} has no merge recorded; there is nothing to revert`);
  const line = t.line;
  onLine(wt, line, id);
  const seen = new Set([id]);
  for (const dep of deps) {
    const d = ticketOf(s, dep.id);
    if (seen.has(dep.id)) throw new UsageError(`--dependent ${dep.id} is given twice, or is the reverted ticket`);
    seen.add(dep.id);
    if (d.line !== line) throw new Refusal(`${dep.id} is on ${d.line}, not on ${id}'s line ${line}`);
    if (local && INTEGRATED(d) && dep.file === null) throw new Refusal(`${dep.id} is integrated: pass its ticket file (--dependent ${dep.id}=<file>) for its blocker`);
    if (d.branch && !INTEGRATED(d)) checkTicketBranch(s, dep.id, d, d.branch, wt);
    if (dep.file !== null) localFile(wt, dep.file, line);
  }
  if (local) localFile(wt, flags.local, line);
  const merges = [...new Set(t.merges.map((m) => {
    const sha = commitOf(wt, m.sha);
    if (sha === null) throw new Refusal(`${id}: the recorded merge ${m.sha} is not a commit in this repository`);
    if (!isAncestor(wt, sha, `refs/heads/${line}`)) throw new Refusal(`${id}: the recorded merge ${sha} is not on ${line}; the state and git disagree`);
    return sha;
  }))];
  const already = new Map(merges.map((m) => [m, revertOf(wt, m, line)]));
  if (t.stage === 'stuck' && merges.every((m) => already.get(m) === null)) {
    throw new Refusal(`${id} is stuck, but none of its merges is reverted on ${line}: it was marked stuck another way`);
  }

  // 1. revert, newest first
  const reverts = [];
  for (const m of [...merges].reverse()) {
    if (already.get(m)) {
      reverts.push({ merge: m, revert: already.get(m), found: 'git' });
      continue;
    }
    if (dirty(wt)) throw new Refusal(`${wt} has uncommitted changes; the revert needs a clean worktree`);
    const r = revertCommit(wt, m);
    if (r.files) return { code: CONFLICT, out: { command: 'revert', ticket: id, line, result: 'conflict', merge: m, files: r.files } };
    reverts.push({ merge: m, revert: r.sha, found: 'reverted' });
  }
  reverts.reverse();
  const pairs = reverts.map((r) => `${r.merge} by ${r.revert}`).join(', ');
  const revertShas = reverts.map((r) => r.revert).join(', ');

  // 2. record
  let completion = 'none';
  let record = 'host';
  if (local) {
    const f = localFile(wt, flags.local, line);
    const subject = `${id}: sorry-matt completion`;
    const c = git(wt, 'log', '--first-parent', '--format=%H%x09%s', `refs/heads/${line}`, '--', f.rel)
      .split(/\r?\n/)
      .map((l) => l.split('\t'))
      .find(([, sub]) => sub === subject)?.[0];
    if (!c) completion = delivered(f.head) ? 'not-found' : 'absent';
    else if (revertOf(wt, c, line)) completion = 'reverted';
    else if (!delivered(f.head)) completion = 'absent';
    else {
      if (dirty(wt)) throw new Refusal(`${wt} has uncommitted changes; the revert needs a clean worktree`);
      const r = revertCommit(wt, c);
      if (r.files) return { code: CONFLICT, out: { command: 'revert', ticket: id, line, result: 'conflict', merge: c, files: r.files } };
      completion = 'reverted';
    }
    record = blockLocal(wt, flags.local, line, id, merges[0], [
      `Reason: ${flags.reason}`,
      ...reverts.map((r) => `Reverted: ${r.merge} by ${r.revert}`),
      `Integration branch: ${line}`,
      `Run: ${s.run}`,
    ]);
  }

  // 3. state
  if (t.stage !== 'stuck') state(ctx, 'stage', 'stuck', id, '--reason', `${flags.reason}; reverted ${pairs}`);

  // 4. dependents
  const upstream = `upstream reverted: ${id} (${revertShas})`;
  const dependents = [];
  for (const dep of deps) {
    s = load(ctx.state);
    const d = s.tickets[dep.id];
    const row = { ticket: dep.id, treatment: 'none', stage: d.stage, record: 'none', kept: null, agent: null, cleanup: null };
    if (INTEGRATED(d)) {
      row.treatment = 'integrated';
      if (local) {
        row.record = blockLocal(wt, dep.file, line, dep.id, merges[0], [
          `Reason: ${upstream}`,
          ...reverts.map((r) => `Upstream merge: ${r.merge} reverted by ${r.revert}`),
          `Integration branch: ${line}`,
          `Run: ${s.run}`,
        ]);
      }
      if (d.stage !== 'stuck') state(ctx, 'stage', 'stuck', dep.id, '--reason', upstream);
    } else if (!TERMINAL.includes(d.stage) || (d.stage === 'awaiting-ruling' && d.reason === upstream)) {
      row.treatment = 'in-flight';
      if (d.stage !== 'awaiting-ruling') state(ctx, 'stage', 'awaiting-ruling', dep.id, '--reason', upstream);
      if (d.assignment?.deadline) {
        row.agent = d.assignment.agentId ?? null;
        row.cleanup = 'agent-in-flight';
      } else if (d.branch) {
        row.kept = keepTip(wt, d.branch, keptRef(s.run, d.branch, 'upstream-reverted'));
        row.cleanup = cleanBranch(wt, d.branch, `${dep.id} is awaiting a ruling`, true);
      }
    }
    row.stage = load(ctx.state).tickets[dep.id].stage;
    dependents.push(row);
  }

  // 5. tip and push
  const tip = git(wt, 'rev-parse', 'HEAD');
  if (load(ctx.state).lines[line]?.tip !== tip) state(ctx, 'line', line, '--tip', tip);
  const push = pushLine(wt, line, flags.push);
  return {
    out: {
      command: 'revert',
      ticket: id,
      line,
      result: 'reverted',
      reverts,
      completion,
      record,
      stage: load(ctx.state).tickets[id].stage,
      dependents,
      tip,
      push,
    },
  };
}

// ---- revert under integrate: ticket-pr (#197) ----------------------------------------------------------------------

/** The revert branch rule: never a line, a protected branch, or another ticket's ticket or revert branch. */
function checkRevertBranch(s, id, branch, repo) {
  if (branch in s.lines) throw new Refusal(`${branch} is an integration branch of this run, not a revert branch`);
  if (isProtected(repo, branch)) throw new Refusal(`${branch} is a protected branch, not a revert branch`);
  const other = Object.entries(s.tickets).find(([k, o]) => o.branch && (o.branch === branch || (k !== id && `${o.branch}-revert` === branch)));
  if (other) throw new Refusal(`${branch} is ${other[0]}'s branch`);
}

/**
 * revert under integrate: ticket-pr (#197, see the header): the merges are on the base branch, so the revert goes
 * out as a pull request on the revert branch `<ticket branch>-revert`, and the base branch is never pushed.
 */
function revertPr(ctx, rest, flags, s) {
  if (!flags.base) throw new UsageError('revert under integrate: ticket-pr needs --base (the base branch the revert PR targets)');
  if (flags.local !== undefined) throw new UsageError('--local is the Local Markdown record; integrate: ticket-pr runs on GitHub');
  if (flags.push) throw new UsageError('--push: under integrate: ticket-pr the revert branch is always pushed and the base branch never is');
  const deps = (flags.dependent ?? []).map((d) => {
    if (d.includes('=')) throw new UsageError(`--dependent ${d}: a ticket file goes with --local, which integrate: ticket-pr does not take`);
    return d;
  });
  const [id] = rest;
  const repo = ctx.repo;
  const t = ticketOf(s, id);
  checkBase(id, t, flags.base);
  if (!['delivered', 'integrating', 'stuck'].includes(t.stage)) {
    throw new Refusal(`${id} is ${t.stage}; revert takes a delivered ticket, or an integrating one with its merge recorded`);
  }
  if (!t.merges.length) throw new Refusal(`${id} has no merge recorded; there is nothing to revert`);
  if (!t.branch) throw new Refusal(`${id} has no ticket branch recorded; the revert branch is <ticket branch>-revert`);
  const branch = `${t.branch}-revert`;
  checkRevertBranch(s, id, branch, repo);
  const base = `origin/${flags.base}`;
  if (commitOf(repo, base) === null) throw new Refusal(`${base} is not a commit; fetch the base branch first`);
  const seen = new Set([id]);
  for (const dep of deps) {
    const d = ticketOf(s, dep);
    if (seen.has(dep)) throw new UsageError(`--dependent ${dep} is given twice, or is the reverted ticket`);
    seen.add(dep);
    if (d.branch && !INTEGRATED(d)) checkTicketBranch(s, dep, d, d.branch, repo);
  }
  const merges = [...new Set(t.merges.map((m) => {
    const sha = commitOf(repo, m.sha);
    if (sha === null) throw new Refusal(`${id}: the recorded merge ${m.sha} is not a commit in this repository`);
    if (!isAncestor(repo, sha, base)) throw new Refusal(`${id}: the recorded merge ${sha} is not on ${base}; the state and git disagree`);
    return sha;
  }))];
  const made = ensureWorktree(repo, branch, ctx.path(flags.worktree), base);
  const wt = made.path;
  const already = new Map(merges.map((m) => [m, revertOf(wt, m, branch)]));
  if (t.stage === 'stuck' && merges.every((m) => already.get(m) === null)) {
    throw new Refusal(`${id} is stuck, but none of its merges is reverted on ${branch}: it was marked stuck another way`);
  }

  // 1. revert, newest first, on the revert branch
  const reverts = [];
  for (const m of [...merges].reverse()) {
    if (already.get(m)) {
      reverts.push({ merge: m, revert: already.get(m), found: 'git' });
      continue;
    }
    if (dirty(wt)) throw new Refusal(`${wt} has uncommitted changes; the revert needs a clean worktree`);
    const r = revertCommit(wt, m);
    if (r.files) return { code: CONFLICT, out: { command: 'revert', ticket: id, line: t.line, result: 'conflict', merge: m, files: r.files } };
    reverts.push({ merge: m, revert: r.sha, found: 'reverted' });
  }
  reverts.reverse();
  const pairs = reverts.map((r) => `${r.merge} by ${r.revert}`).join(', ');
  const revertShas = reverts.map((r) => r.revert).join(', ');

  // 2. state (GitHub: the host files the raw issue, as the line revert has it: "record" is "host")
  if (t.stage !== 'stuck') state(ctx, 'stage', 'stuck', id, '--reason', `${flags.reason}; reverted ${pairs}`);

  // 3. dependents, treated as the line revert treats them; the cleanup runs in the repository, there is no line worktree
  const upstream = `upstream reverted: ${id} (${revertShas})`;
  const dependents = [];
  for (const dep of deps) {
    const live = load(ctx.state);
    const d = live.tickets[dep];
    const row = { ticket: dep, treatment: 'none', stage: d.stage, record: 'none', kept: null, agent: null, cleanup: null };
    if (INTEGRATED(d)) {
      row.treatment = 'integrated';
      if (d.stage !== 'stuck') state(ctx, 'stage', 'stuck', dep, '--reason', upstream);
    } else if (!TERMINAL.includes(d.stage) || (d.stage === 'awaiting-ruling' && d.reason === upstream)) {
      row.treatment = 'in-flight';
      if (d.stage !== 'awaiting-ruling') state(ctx, 'stage', 'awaiting-ruling', dep, '--reason', upstream);
      if (d.assignment?.deadline) {
        row.agent = d.assignment.agentId ?? null;
        row.cleanup = 'agent-in-flight';
      } else if (d.branch) {
        row.kept = keepTip(repo, d.branch, keptRef(live.run, d.branch, 'upstream-reverted'));
        row.cleanup = cleanBranch(repo, d.branch, `${dep} is awaiting a ruling`, true);
      }
    }
    row.stage = load(ctx.state).tickets[dep].stage;
    dependents.push(row);
  }

  // 4. push the revert branch (never the base) and open the revert PR; an open one with that head is reused
  pushable(repo, id, branch, 'the revert PR needs the revert branch on origin');
  git(repo, 'push', '-q', '-u', 'origin', branch);
  let pr = openPrNumber(ctx, repo, branch);
  const created = pr === null;
  if (created) {
    const body = [
      `Reverts the merge${merges.length > 1 ? 's' : ''} of ${id}: the base branch turned red.`,
      '',
      `Reason: ${flags.reason}`,
      '',
      ...reverts.map((r) => `- Reverted: ${r.merge} by ${r.revert}`),
    ].join('\n');
    const out = String(ctx.gh(['pr', 'create', '--base', flags.base, '--head', branch, '--title', `Revert ${id}`, '--body', body], repo));
    const m = /\/pull\/(\d+)/.exec(out);
    if (!m) throw new Error(`gh pr create printed no pull request URL: ${out.trim()}`);
    pr = Number(m[1]);
  }
  return {
    out: {
      command: 'revert',
      ticket: id,
      line: t.line,
      result: 'reverted',
      reverts,
      completion: 'none',
      record: 'host',
      stage: load(ctx.state).tickets[id].stage,
      dependents,
      revertBranch: branch,
      head: branchTip(repo, branch),
      pr,
      prCreated: created,
      push: { status: 'revert-pr', branch },
    },
  };
}

// ---- send back and stuck -------------------------------------------------------------------------------------------

function sendBack(ctx, rest, flags) {
  if (rest.length !== 1) throw new UsageError('send-back takes exactly one ticket');
  const [id] = rest;
  const repo = ctx.repo;
  const s = load(ctx.state);
  const prMode = profileOf(s).integrate === 'ticket-pr';
  if (flags.base !== undefined && !prMode) throw new UsageError('--base is for integrate: ticket-pr');
  const t = ticketOf(s, id);
  const rerun = t.stage === 'candidate' && t.sendBacks >= 1;
  if (!rerun && !['queued', 'integrating'].includes(t.stage)) throw new Refusal(`${id} is ${t.stage}; send-back takes a ticket that is queued or integrating`);
  if (!rerun && t.sendBacks >= 1) throw new Refusal(`${id} was already sent back once; a second send back is not allowed, mark it stuck`);
  if (t.merges.length) throw new Refusal(`${id} has a merge recorded; it is integrated, not sent back`);
  if (!t.branch) throw new Refusal(`${id} has no ticket branch recorded`);
  const branch = t.branch;
  checkTicketBranch(s, id, t, branch, repo);
  // #222: under integrate: ticket-pr the line has no integration branch: the redo is cut from the ticket's fixed
  // point — origin/<--base>, or its upstream's branch when stacked — and the attempt is compared with that
  let from = `refs/heads/${t.line}`;
  if (prMode) {
    const parent = t.stackParent ?? null;
    if (parent !== null) {
      const up = s.tickets[parent]?.branch;
      if (!up) throw new Refusal(`${id} is stacked on ${parent}, which has no ticket branch recorded`);
      from = `refs/heads/${up}`;
    } else {
      if (!flags.base) throw new UsageError('send-back under integrate: ticket-pr needs --base (the base branch the redo is cut from) for a ticket that is not stacked');
      from = `origin/${flags.base}`;
    }
  }
  const lineTip = commitOf(repo, from);
  if (lineTip === null) throw new Refusal(prMode ? `${from} is not a commit; fetch the base branch first` : `${id}'s integration branch ${t.line} does not exist`);
  const k = rerun ? t.sendBacks : t.sendBacks + 1;

  // 1. keep
  const kept = keepTip(repo, branch, keptRef(s.run, branch, `sent-back-${k}`));
  if (kept === null) throw new Refusal(`${branch} does not exist and nothing is kept for it; there is no attempt to send back`);
  const touched = git(repo, 'diff', '--name-only', `${lineTip}...${kept.sha}`).split(/\r?\n/).filter(Boolean);
  const conflicts = list(flags.conflicts);
  let predicted = null;
  let uncovered = null;
  if (flags.predicted !== undefined) {
    const p = list(flags.predicted);
    uncovered = touched.filter((f) => !p.includes(f));
    predicted = [...new Set([...p, ...conflicts, ...touched])];
  }

  // 2. state
  if (t.stage === 'queued') state(ctx, 'stage', 'integrating', id, '--reason', 'integration conflict');
  if (!rerun) state(ctx, 'stage', 'candidate', id, '--reason', `sent back for a redo${conflicts.length ? `: conflict in ${conflicts.join(', ')}` : ''}`);

  // 3. clean
  const cleanup = cleanBranch(repo, branch, `${id} is sent back and its attempt kept at ${kept.ref}`, true);
  return {
    out: {
      command: 'send-back',
      ticket: id,
      branch,
      ref: kept.ref,
      sha: kept.sha,
      k,
      line: t.line,
      lineTip,
      conflicts,
      touched,
      uncovered,
      predicted,
      stage: load(ctx.state).tickets[id].stage,
      cleanup,
    },
  };
}

function stuck(ctx, rest, flags) {
  if (rest.length !== 1) throw new UsageError('stuck takes exactly one ticket');
  if (!flags.reason) throw new UsageError('stuck needs --reason');
  if (flags.local !== undefined && flags.worktree === undefined) throw new UsageError('--local needs --worktree (the integration worktree)');
  if (flags.attempts !== undefined && flags.local === undefined) throw new UsageError('--attempts goes with --local');
  const [id] = rest;
  const wt = flags.worktree === undefined ? null : ctx.path(flags.worktree);
  const repo = wt ?? ctx.repo;
  const s = load(ctx.state);
  const t = ticketOf(s, id);
  if (t.stage === 'delivered') throw new Refusal(`${id} is delivered; a delivered ticket is marked stuck by revert`);
  if (t.stage === 'awaiting-ruling') throw new Refusal(`${id} is awaiting a ruling, an end state`);
  if (t.merges.length) {
    throw new Refusal(`${id} has a merge on ${t.line} (${t.merges[0].sha}); rerun merge to finish integrating it, or revert it (which marks it stuck)`);
  }
  if (t.branch) checkTicketBranch(s, id, t, t.branch, repo);
  if (wt) onLine(wt, t.line, id);
  const ref = t.branch ? keptRef(s.run, t.branch, 'stuck') : null;
  let review = 'not-requested';
  let reviewPath = null;
  if (flags['review-worktree'] !== undefined) {
    reviewPath = ctx.path(flags['review-worktree']);
    const w = worktrees(repo).find((x) => samePath(x.path, reviewPath));
    if (w?.branch) throw new Refusal(`${reviewPath} has ${w.branch} checked out; a review worktree is always detached`);
    if (w) {
      // Only this ticket's: its HEAD carries at least one of the ticket's own commits (an ancestor of the ticket
      // branch or its kept ref, not on the line). Another ticket's review worktree, or any other one, is refused.
      const attempt = t.branch ? (branchTip(repo, t.branch) ?? commitOf(repo, ref)) : null;
      const head = tryGit(w.path, 'rev-parse', '--verify', '-q', 'HEAD');
      const own = attempt !== null && head !== null && isAncestor(repo, head, attempt) && !isAncestor(repo, head, `refs/heads/${t.line}`);
      if (!own) throw new Refusal(`${w.path} is not ${id}'s review worktree: its HEAD ${head ?? '(none)'} is not one of ${id}'s own commits`);
      reviewPath = w.path;
    }
    review = w ? 'present' : 'absent';
  }
  const keeps = t.branch && (branchTip(repo, t.branch) !== null || commitOf(repo, ref) !== null);

  // 1. record
  let record = 'host';
  if (flags.local !== undefined) {
    record = blockLocal(wt, flags.local, t.line, id, `Run: ${s.run}`, [
      `Reason: ${flags.reason}`,
      ...(flags.attempts ? [`Attempts: ${flags.attempts}`] : []),
      ...(keeps ? [`Ticket branch: ${t.branch} (kept at ${ref})`] : []),
      `Integration branch: ${t.line}`,
      `Run: ${s.run}`,
    ]);
  }

  // 2. keep and clean
  let kept = null;
  let cleanup = null;
  if (t.branch) {
    kept = keepTip(repo, t.branch, ref);
    cleanup = cleanBranch(repo, t.branch, `${id}'s attempt is kept at ${ref}`, true);
  }

  // 3. review worktree
  if (review === 'present') {
    git(repo, 'worktree', 'remove', '--force', reviewPath);
    review = 'removed';
  }

  // 4. state and 5. push
  if (t.stage !== 'stuck') state(ctx, 'stage', 'stuck', id, '--reason', flags.reason);
  const push = wt ? pushLine(wt, t.line, flags.push) : { status: 'not-requested' };
  return {
    out: { command: 'stuck', ticket: id, line: t.line, record, kept, cleanup, review, stage: 'stuck', push },
  };
}

// ---- entry -------------------------------------------------------------------------------------------------------

const COMMANDS = {
  'line-init': [lineInit, { branch: 'one', worktree: 'one', from: 'one', repo: 'one', now: 'one' }],
  'ticket-init': [ticketInit, { branch: 'one', worktree: 'one', base: 'one', repo: 'one', now: 'one' }],
  'pr-open': [prOpen, { title: 'one', base: 'one', repo: 'one', now: 'one' }],
  'pr-push': [prPush, { repo: 'one', now: 'one' }],
  'pr-merge': [prMerge, { base: 'one', ready: 'bool', merged: 'bool', repo: 'one', now: 'one' }],
  'patch-id': [patchIdOf, { from: 'one', repo: 'one', now: 'one' }],
  merge: [merge, { worktree: 'one', branch: 'one', local: 'one', checks: 'one', push: 'bool', ci: 'bool', now: 'one' }],
  'ci-init': [ciInit, { worktree: 'one', repo: 'one', now: 'one' }],
  revert: [revert, { worktree: 'one', reason: 'one', local: 'one', dependent: 'many', push: 'bool', base: 'one', repo: 'one', now: 'one' }],
  'send-back': [sendBack, { conflicts: 'one', predicted: 'one', base: 'one', repo: 'one', now: 'one' }],
  stuck: [stuck, { reason: 'one', worktree: 'one', local: 'one', attempts: 'one', 'review-worktree': 'one', push: 'bool', repo: 'one', now: 'one' }],
};

function parseArgs(argv, spec) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      rest.push(a);
      continue;
    }
    const name = a.slice(2);
    if (!(name in spec)) throw new UsageError(`unknown flag ${a}`);
    if (name in flags && spec[name] !== 'many') throw new UsageError(`${a} is given twice`);
    if (spec[name] === 'bool') {
      flags[name] = true;
      continue;
    }
    if (i + 1 >= argv.length) throw new UsageError(`${a} needs a value`);
    const value = argv[(i += 1)];
    if (spec[name] === 'many') (flags[name] ??= []).push(value);
    else flags[name] = value;
  }
  return { flags, rest };
}

export function defaultDeps() {
  return {
    cwd: process.cwd(),
    // cli.mjs's gh seam, shared with freeze.mjs (#219): env, when given, is added to the environment of that one
    // call; `{ both: true }` returns { stdout, stderr }.
    gh,
  };
}

// Returns { code, out, err } instead of touching the process, so tests can drive it.
export function main(argv, deps = {}) {
  const d = { ...defaultDeps(), ...deps };
  try {
    const entry = COMMANDS[argv[0]];
    if (!entry) throw new UsageError(`expected one of ${Object.keys(COMMANDS).join(', ')}`);
    const [cmd, spec] = entry;
    const { flags, rest } = parseArgs(argv.slice(1), spec);
    if (!rest.length) throw new UsageError(`${argv[0]} needs the state file first`);
    const path = (p) => resolve(d.cwd, p);
    const ctx = { state: path(rest[0]), now: flags.now, repo: path(flags.repo ?? '.'), path, gh: d.gh };
    const { code = 0, out } = cmd(ctx, rest.slice(1), flags);
    return { code, out: `${JSON.stringify({ format: FORMAT, ...out }, null, 2)}\n`, err: '' };
  } catch (e) {
    if (e instanceof Refusal) return { code: 3, out: '', err: `integrate: refused: ${e.message}\n` };
    return failure('integrate', e);
  }
}

runIfEntry(import.meta.url, main);
