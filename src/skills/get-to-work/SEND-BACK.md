# get-to-work：退回重做與標卡住

本檔是退回重做與標卡住：tick 的 `judge` 指到這裡時全文讀取。git 與 state 的部分由 `scripts/integrate.mjs` 做，
各步驟寫在它的檔頭；這裡只寫它做不到的。

**退回重做。** 預計檔案猜錯，整併時才撞上別張票的改動。不硬解：該票從最新的整合分支重做。

1. `integrate.mjs send-back <state> <票> --conflicts <衝突的檔> --predicted <預計檔案的每一行>`：留住舊嘗試的 ref、
   階段改回候選、移除 worktree 與分支。一張票只退回一次，第二次它會拒絕：改標卡住。`integrate: ticket-pr` 下線沒有
   整合分支：加 `--base <基底分支>`，舊嘗試改與該票的 fixed point（`origin/<基底分支>`，疊的票是上游分支）比對，
   `lineTip` 是那個 fixed point 的尖端。票級 PR 不關、origin 上的分支不動，PR 號碼留在 state。
2. **退回紀錄**：照輸出在該票接續紀錄加一段 —— `ref` 與 `sha`、`conflicts`、`lineTip`、`uncovered`（舊嘗試動到而
   預計檔案沒涵蓋的檔）—— 同一段也寫到 `sorry-matt/runs/<run>/sendback/<ticket>.md`，重派時 tick 交給新的實作 agent。
3. **加寬預測**：把輸出的 `predicted` 寫回該票的預計檔案。
4. 重派由 tick 在下一個派票點做：沿用驗收快照，從整合分支最新尖端重建同名分支。舊嘗試只供參考，不合併。
   `ticket-pr` 下從 fixed point 的最新尖端重建；重做的 agent 回報 commit 後，tick 發 `pr-push` 到同一支 PR，不再
   `pr-open`，而 `pr-push` 以 `--force-with-lease` 換掉 PR 的 head：head 從 origin 讀，必須屬於留在 `sent-back` ref
   的舊嘗試，lease 就在它上面；別人推上去的 head 不屬於舊嘗試，`pr-push` 拒絕（3）、不覆蓋，交給人處理。

**標卡住**（本 skill 各處寫「標卡住」時都照這裡做）：

- `integrate.mjs stuck <state> <票> --reason <原因>`：留住分支尖端、移除 worktree 與分支、標卡住。Local Markdown
  加 `--worktree <整合 worktree> --local <票檔> --attempts <已做的嘗試>`，它在原 ticket 追加 `## sorry-matt blocker`
  並 commit；`prove-it` 的審查用 worktree 還在時加 `--review-worktree <scratchpad>/review-<票>`；有 `origin` 時加
  `--push`。
- **GitHub**：另開 raw issue 記錄失敗，列出原因與已做的嘗試，body 依 `ASKING.md` 第 6 節潤稿。

完成判準：每張退回的票在接續紀錄有退回紀錄、預計檔案已加寬；每張卡住的票都經 `integrate.mjs stuck`，GitHub
的另有 raw issue。
