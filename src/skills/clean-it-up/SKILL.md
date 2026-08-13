---
name: clean-it-up
description: 在一段 Git 工作結束後，安全清理已合併的本地分支與不再需要的 worktrees。當使用者收尾一段 Git 工作（clean it up），或要求清理 merged branches/worktrees 時使用。
---

# Clean it up：安全收掉已完成的 Git 工作

引數可指定 repo、合併目標分支，以及是否連遠端分支一起清理。沒有 repo 引數時使用目前 repo；
預設只移除本地分支、linked worktrees 與失效的 worktree 管理紀錄，不刪遠端分支。

兩條規則主宰全程：「已合併」是必須用證據證明的狀態；**Git 的拒絕就是判決** ——
全程只用不帶強制旗標的指令，凡是證據不足、狀態不乾淨或 Git 拒絕的項目一律**降級為保留**，
換更強的手段重試不在授權內。

## 1. 鎖定合併目標與權限

先解析 repo 根目錄與 common Git directory，再決定唯一的**合併目標**：

1. 使用者明確指定的 ref 優先。
2. 否則使用已設定 remote 的 symbolic default branch，例如 `refs/remotes/origin/HEAD`。
3. 有多個 plausible remotes、remote default 缺失，或目標 ref 不存在時，在任何刪除前請使用者裁決；
   不自行假設 `main`、`master` 或目前分支。

若合併目標是 remote-tracking ref，先對該 remote 執行正常的 `git fetch --prune`。Fetch 失敗時，
不得依賴可能過期的 remote 狀態刪除；仍可盤點並回報。明確指定 local ref 時，可只用本地證據。

本 skill 的預設授權只涵蓋本地清理。只有使用者在本次請求中明確要求清理遠端分支，才把遠端
刪除納入候選；不碰 tags、stash、未追蹤檔、GitHub PR、基底分支、部署或發布。

完成判準：repo、唯一合併目標、資料新鮮度與本地／遠端權限範圍均已明載；有歧義時尚未做
任何刪除。

## 2. 建立不遺漏的盤點

以 Git 自己回報的資料為準，不用目錄 glob 猜 worktree：

```bash
git worktree list --porcelain
git for-each-ref --format='%(refname:short)%09%(objectname)%09%(upstream:short)%09%(upstream:track)' refs/heads
git worktree prune --dry-run --verbose
```

對 `git worktree list --porcelain` 中每個絕對路徑執行
`git -C <path> status --porcelain=v1 --untracked-files=all`，並檢查是否正在 merge、rebase、
cherry-pick、revert 或 bisect。記錄：

- primary worktree、目前 worktree、locked worktrees，以及各自 checkout 的 branch 或 detached SHA。
- 每個 worktree 是否有 staged、unstaged 或 untracked 內容，或進行中的 Git operation。
- 每個本地 branch 的完整 ref、tip SHA、upstream，以及它是否被任一 worktree 使用。
- dry-run 認定可 prune 的失效管理紀錄；路徑只是暫時無法存取時不視為失效。

不要讓 branch name 或 worktree path 經過 shell 字串拼接；以 argv 傳遞，並在支援的位置用 `--`
終止 option parsing。

完成判準：每個本地 branch 與 worktree 恰好出現一次；所有 dirty、locked、detached、operation
in progress 與 primary 狀態都可追溯。

## 3. 用證據分類

本地 branch 只有通過下列任一證據，才算**已合併**：

1. `git merge-base --is-ancestor refs/heads/<branch> <merge-target>` 回傳成功。
2. Ancestry 因 squash 或 rebase merge 不成立，但 authoritative forge 顯示 PR 已 merged，PR 的
   base 正是合併目標，而且 PR 記錄的 head OID **等於目前本地 branch tip**。

第二種證據若無法透過已登入的 provider CLI/API 完整取得，就保留 branch。已 merged 的舊 PR
不涵蓋 branch 後來新增的 commits。以下均**不構成**合併證據：upstream `gone`、remote branch
不存在、commit message 相似、branch 很舊、命名像 ticket，或 diff 看起來相同。

即使已有合併證據，也保護：合併目標、本地／remote default branch、仍有未合併 tip 的 branch、
任何 dirty／locked／operation-in-progress worktree 使用的 branch，以及使用者指定保留的 branch。

Worktree 只在下列情況列入移除候選：

- 它不是 primary worktree，也不是目前工作目錄。
- 它未 locked、完全乾淨、沒有進行中的 Git operation。
- 它 checkout 的本地 branch 已依上述規則證明合併，且同時列入刪除候選。

不存在於磁碟、且 dry-run 明確認定可 prune 的管理紀錄另列為 prune 候選。

先輸出候選表：`項目 | ref/path | 合併證據 | 動作 | 保留原因`。本地候選可依本次 skill 呼叫直接
執行；遠端候選必須同時具備本次明確授權、remote 名稱、完整 branch ref 與預期 SHA。

完成判準：每個項目只屬於移除、prune 或保留之一；每個移除候選都有可重跑的合併證據，且
每個保留項都有具體原因。

## 4. 依安全順序清理

**臨場重驗**：每一步執行前立刻重查該項的 SHA、worktree 狀態與合併證據；狀態改變就
降級為保留。

1. 對 dry-run 已列出、且路徑確實不存在的管理紀錄執行 `git worktree prune --verbose`。
2. 對 linked worktree 候選執行 `git worktree remove -- <absolute-path>`；Git 拒絕時
   降級為保留並記錄原因。
3. Primary worktree 永不移除。若它目前 checkout 的 branch 是刪除候選，只有在 worktree
   乾淨、合併目標有可 checkout 的本地 branch，且該 branch 未被其他 worktree 使用時，才先
   `git switch <local-target>`；否則保留目前 branch。
4. 確認 branch 已不被任何 worktree 使用後，從 checkout 在 local merge target 的 worktree 執行
   `git branch -d -- <branch>`；沒有這種 worktree，或 `-d` 拒絕時就降級為保留。
5. 僅在遠端清理有明確授權時，重新用 remote 查詢確認完整 remote ref 仍指向預期 SHA，再以
   `git push <remote> --delete <exact-branch>` 逐支刪除；SHA 改變、ref 歧義或 API／push 失敗
   都停止該項。

每個項目獨立裁決：一個項目的失敗不改變其他項目的判準。所有刪除都經由上列 Git 指令進行；
檔案系統層的刪除（`.git/worktrees`、worktree 目錄）不在授權內。

完成判準：只執行候選表列出的精確動作；每個刪除都通過臨場重驗；每個被 Git 拒絕的項目都
降級為保留並附紀錄。

## 5. 驗證並交棒

重新執行 worktree、branch 與 status 盤點，確認保留的 worktrees 仍可存取、目前 worktree 狀態
未受損，且每個已刪 branch 都不再存在。回報：

- 合併目標與用過的證據來源。
- 已移除的 worktrees、本地 branches、遠端 branches 與 pruned records。
- 因 dirty、locked、證據不足、狀態改變或 Git 拒絕而保留的項目及原因。
- Fetch、provider 查詢或其他未完成的驗證。

完成判準：清理後盤點與實際動作逐項對得上；所有未清項目都有理由，且使用者能直接判斷下一步。
