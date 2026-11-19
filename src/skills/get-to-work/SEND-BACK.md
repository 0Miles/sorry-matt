# get-to-work：退回重做與標卡住

本檔是 [`SKILL.md`](SKILL.md)「收票」的退回重做與標卡住：要退回重做或標卡住時全文讀取。文中沒有點名檔案的節名（「派票」）都指 `SKILL.md`。

**退回重做。** 預計檔案猜錯，整併時才撞上別張票的改動。不硬解：該票從最新的整合分支重做。

1. **留紀錄**：以 `git update-ref refs/sorry-matt/<run>/<NN>-<slug>/sent-back-<k> <ticket 分支>` 留住舊嘗試
   （`<k>` 是第幾次退回）；該票接續紀錄加一段退回紀錄 —— 這個 ref 與 SHA、衝突的檔案、當時的整合分支 SHA、
   舊嘗試動到而預計檔案沒涵蓋的檔；ledger 對帳表該列的退回次數加一、階段改回候選。
2. **加寬預測**：把衝突的檔案與舊嘗試動到的檔補進該票的預計檔案。
3. 移除 ticket worktree，`git branch -D` 本地 ticket 分支 —— 內容已留在上面的 ref。
4. 下一個派票點照「派票」重派：沿用驗收快照，從整合分支最新尖端重建同名的分支與 worktree。舊嘗試只供
   參考，不合併。

一張票只退回一次：重做後整併仍衝突解不了，標卡住。

**標卡住**（本 skill 各處寫「標卡住」時都照這裡做）：

- **GitHub**：另開 raw issue 記錄失敗，body 依 `ASKING.md` 第 6 節潤稿。
- **Local Markdown**：在整合分支的原 ticket 追加 `## sorry-matt blocker`，列出原因、已做嘗試
  與相關分支；將 `Status` 改為 `ready-for-human` 後 commit。

完成卡住紀錄後也移除 ticket worktree 與本地 ticket 分支。主持人在整合分支上的其他 commit（卡住紀錄、
期間開票）在那次喚醒結束前一併 push。

完成判準：每張退回的票都有 `sent-back` ref、接續紀錄裡的退回紀錄、對帳表的退回次數與加寬的預計檔案，且至多退回一次。
