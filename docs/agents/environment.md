# Environment

這個 repo 已落檔的環境事實（`src/skills/have-it-all-done/ASKING.md` 第 0 節讀它）。

## Git for Windows 與測試

2026-11-27 在本機 Windows 11 實測（#235 之後），git 2.40.1.windows.1、Node 24。

- **一個 git 程序約 120–150 ms**（空機），平行負載下再慢一倍以上；同一套測試 CI 上 ubuntu 約 1.5 分、windows 約 14 分，
  差距幾乎都在起 git 程序。降低程序數的手法見 `scripts/git-env.mjs`、`tier.mjs` 的 `fileReader` 與 `tick.mjs run`
  的 `views`。
- **`GIT_TRACE2_EVENT` 會讓 git 偶爾印不出 stdout、卻以 0 結束**：32 個 worker 各跑 120 次 `git rev-parse HEAD`，
  不開 trace 0／3840 次空輸出；trace 寫同一個檔 13／3840，寫目錄（每程序一檔）10／3840。測試會因此出現假紅
  （`got ""`、`does not exist`、`no local branch`、`copyfile … -> ''`）。數 git 程序（`"event":"start"`）與驗正確性
  要分開跑：開 trace 的那輪只取程序數，紅燈不算。
- **本機 push 的 receive-pack 拿不到 `GIT_CONFIG_COUNT` 的值**（git 對另一個 repo 清掉這組環境變數），所以
  `receive.autogc` 要寫在 bare repo 自己的 config 裡（`noAutoGc`）。

## gh stack（`integrate: ticket-pr`）

2026-11-26 在拋棄式 private repo `0Miles/sorry-matt-stack-sandbox` 實測（#187 裁決 6，#198 留言）。版本：gh 2.65.0、
gh-stack 0.3.0，全程非互動，`GH_STACK_NO_UPDATE_NOTIFIER=1`。

- **疊法**：`gh stack init <branch>` 建 stack `main ← <branch>`；commit 後 `gh stack add <next>` 直接建分支疊上去。帶分支名
  就完全非互動，exit 0。
- **修正推回同一支 PR**：下層加 commit 後 `gh stack push`，原 PR 多出那個 commit，不開新 PR；上層被標成要 restack，
  `gh stack rebase` + `gh stack push` 復原。
- **合併**：stack 裡的 PR 用 `gh pr merge` 會被拒（要走非同步的 merge REST API），必須
  `gh stack merge <PR> --yes --squash`（可只合到指定的 PR 為止）。draft PR 擋 `gh stack merge`（exit 2）；
  `gh stack submit --auto` 開的是 draft，合併前要 `gh pr ready`。
- **下層合併後**：上層 PR 的 base 由 GitHub 自動改成 `main`；`gh stack sync` 偵測已合併的層，把上層 rebase 到新的
  `main` 並推上去。
- **`Closes #N`**：base 指向非預設分支的 PR 連 `closingIssuesReferences` 都不建；stack 內的 PR 等 retarget 到 `main`
  並合併後才關票。所以關票不能只靠 `Closes`：合併後查 issue 實際狀態，沒關就補關（#196）。
- **`gh stack submit --auto` 冪等**：第二次執行回報 `up to date`，exit 0，不開重複的 PR；PR body 自動帶入 commit body。

### 線上腳本端到端（#199，2026-11-26，同一個 sandbox）

用線上分支的 `integrate.mjs` 對 A（issue #8）與疊在 A 上的 B（issue #9）跑完一輪：

- **`gh stack add` 只在 stack 的分支上跑，而且自己建新分支**：在下游自己的 worktree（已在下游分支上）跑
  `gh stack init <上游>` 後 `gh stack add <下游>` 會失敗（`current branch ... is not part of a stack`）。可行的順序：
  下游 worktree 以 detached 建出，`git checkout --ignore-other-worktrees <上游分支>`，`gh stack view` 失敗才
  `gh stack init <上游分支>`（`init` 會採用已存在的分支），再 `gh stack add <下游分支>`。`ticket-init` 照此實作。
- `.git/gh-stack` 是 repo 層級的 JSON（所有 worktree 共用）；`gh stack merge <數字>` 先當 stack 編號、再當 PR 編號，
  stack 與 PR 共用編號序列，所以不會撞。
- A：`pr-merge --ready` 給 `gh stack merge 10 --yes --squash`（B 疊在它上面），squash 合併成功，`Closes #8` 生效。
- B：GitHub 自動把 PR 的 base 改成 `main`；`pr-merge` 的 push phase 跑 `gh stack sync`，B 被 rebase 到新 `main`
  （SHA 換了），`patch-id` 前後相同 → 審查沿用；`gh stack merge 11 --yes --squash` 成功。
- **B 的 `Closes #9` 沒有生效**：PR 建立與寫 body 時 base 是 A 的分支，retarget 到 `main` 後 GitHub 也沒補建關聯。
  #196 的合併後關票檢查（`gh issue close` 附 PR 留言）是必要的，不是保險。
