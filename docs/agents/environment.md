# Environment

這個 repo 已落檔的環境事實（`src/skills/have-it-all-done/ASKING.md` 第 0 節讀它）。

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
