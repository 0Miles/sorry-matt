# get-to-work：紅燈處置

本檔是 [`SKILL.md`](SKILL.md)「讀 CI」的紅燈處置：有線轉紅，或有線在紅燈處置中時全文讀取。文中沒有點名檔案的節名與步驟（「讀 CI」「時限」「派票」「收票」「預算與斷路」、喚醒步驟）都指 `SKILL.md`。

**紅燈處置。** 轉紅的線**不派新票**，**整併佇列暫停**，到綠燈或撤回為止。在途的票照常實作、審查與修正，
審查通過的在佇列裡等；下面的紅燈修正與撤回不排隊。紅線上再整併別的票，最早紅 SHA 之後的 SHA 都帶著
同一個紅，新票自己的紅燈被蓋住，修完仍紅時也會錯對到原票。

1. **最早的紅 SHA**：由本 skill 的 `scripts/ci.mjs` 算，不自己沿 log 推。為這條線寫一份計畫檔
   `sorry-matt/runs/<run>/ci/<line-slug>.plan.json`：`worktree` 是整合 worktree，`line` 是整合分支，`base` 是
   基底分支；`ci` 在有 CI 的線填 `true`，本機驗證的線填 `false`（腳本就不呼叫 `gh`，沿本地整合分支走）；
   `local` 是 ledger 第 4 欄這條線的本機驗證逐 SHA 紀錄，整行照抄（有 CI 的線上原因是 `no-verdict` 的那幾筆
   也抄）；`tickets` 是已整併進這條線的票，每張的 `id`、分支 `branch`，以及 ledger 對帳表記的 merge SHA
   `merges`。輸出存成同名的 `.json`：

   ```bash
   node "${CLAUDE_SKILL_DIR}/scripts/ci.mjs" earliest-red <計畫檔>
   ```

   輸出格式寫在腳本檔頭。`earliestRed` 是最早的紅 SHA，`lowerBound` 是範圍的下界：它之前最近一個有結論而且
   是綠的 SHA（`kind` 是 `green`）；沒有更早的綠時取整合分支與基底分支的 merge-base（`kind` 是 `merge-base`），
   有 CI 的線也一樣。本機驗證紀錄算該 SHA 的結論，與其他 SHA 的 CI 結論合起來判。輸出的 `ci` 是
   `query-failed` 時，這次只用本機驗證紀錄判，照「讀 CI」的查詢失敗記下 `error`。`truncated` 是 `true` 時
   run 清單在上限被截斷：`boundary` 那個 SHA 與 `verdicts[]` 裡 `partial` 是 `true` 的 SHA 可能少了 run，
   腳本只把它們的紅當結論，不自己補判、不手動重查。這時真正最早的紅可能比 `earliestRed` 更舊，範圍照樣往下
   延伸到 `lowerBound`，`tickets` 已涵蓋。`earliestRed` 是 `null`
   （沒有 SHA 有結論，或最新一個有結論的 SHA 是綠）時這次不對票：流水線中，下一次喚醒照「讀 CI」再讀這條線；
   收官（[`FINISH.md`](FINISH.md) 步驟 3）沒有下一次喚醒，當場再跑一次 `earliest-red`，仍是 `null` 就當作
   **對不到票**，照第 3–6 點走。
2. **對到票**：同一份輸出的 `tickets` 是 `lowerBound` 到 `earliestRed` 這段的 merge commit 對到的票，由舊到新；
   對票規則在 `scripts/review-guide.mjs` 檔頭（ledger 對帳表記的 merge SHA 優先，沒記 SHA 的票
   才看 subject）。完成紀錄、卡住紀錄、期間開票這些主持人 commit 不是 merge，夾在中間也不影響。有好幾張
   票（中間的 push 沒有結論）從最早的開始，就是第一張。`unmatched` 是 `true` —— 紅燈來自主持人 commit、精簡或併入基底 —— 就
   **對不到票**。
3. 失敗的 job 與步驟以 `gh run view <id> --log-failed` 存檔，主持人只取失敗那幾行；`<id>` 是同一份
   `earliest-red` 輸出裡 `verdicts[]` 中 `earliestRed` 那筆的 `failed` 列出的每個 id，不另跑 `gh run list`。本機驗證沒有
   run（本機驗證的線，以及有 CI 的線上 `no-verdict` 的那一次）：跑檢查時就把輸出存成 `sorry-matt/runs/<run>/verify/<line-slug>-<SHA>.log`（跟 ledger 同在共用目錄），
   紅的那份就是失敗輸出，主持人只取失敗的行。
4. **修，最多兩輪**：對到票就交回那張票的原 agent（已不在時依 `IMPLEMENTER.md` spawn 新的，Agent tool 的 `description` 是 `ci-fix` 後接票的識別碼，票面附上失敗
   摘要），在從整合分支新切的 `<run>/<NN>-<slug>-ci` 分支修：CI 失敗就是 finding，走收票步驟 3 的集中修正
   （`recheck` 附上該票上一次的審查區塊）與步驟 4–7，整併不排隊。對不到票就由主持人或做那一步的 agent 在整合
   worktree 修（為此新 spawn agent 時，`description` 是 `ci-fix` 後接該線的整合分支），commit（subject 不帶票 ID）、push。偶發紅燈的硬護欄照用。修正的 agent 超時被停下也算一輪（[`TIMEOUTS.md`](TIMEOUTS.md)）。每輪修完都 push（沒有 `origin` 時
   略過），由下一次驗證判結果：流水線中是下一次讀 CI（本機驗證的線是那時在新 SHA 上的本機驗證），收官是 [`FINISH.md`](FINISH.md)
   步驟 3 當場再驗。
5. **兩輪仍紅，對到票：撤回。** `git revert -m 1 <該票的 merge commit>`，並撤掉它的完成紀錄：
   - **GitHub**：照 [`SEND-BACK.md`](SEND-BACK.md) 的「標卡住」開 raw issue；之後的派票點把它從 `--done` 移到 `--stuck`。
   - **Local Markdown**：`git revert` 撤回完成紀錄那個 commit，再照 `SEND-BACK.md` 的「標卡住」追加
     `## sorry-matt blocker`，原因寫 CI 紅燈與撤回的 commit。frontier 把完成紀錄之後的 blocker 判為卡住，漏撤也不會算完成。

   ledger 對帳表該列改為卡住，總 PR 列為缺口。依賴它而已整併的票一併改成缺口：它們的 merge 不撤，對帳表
   標「上游撤回」，GitHub 從 `--done` 移到 `--stuck`，Local Markdown 在該票追加 blocker 寫明上游；
   總 PR 都不寫 `Closes`。依賴它而還在途的票（含整併佇列裡的）退出流水線，標**待裁決**，原因寫「上游撤回」
   與撤回的 commit：還在跑的 agent 回報後不收票；分支尖端照 `SEND-BACK.md` 的退回重做留在
   `refs/sorry-matt/<run>/<NN>-<slug>/upstream-reverted`，再移除 worktree 與分支。push 後照常由下一次驗證判
   結果。日後要重新整併被撤回的票，先 `git revert <撤回的 commit>` 還原撤回，否則 git 認為它已併入，不會再帶進改動。
6. **兩輪仍紅，對不到票**：這條線**驗證未過**：不送 `gh pr merge`、不進 merge queue（`FINISH.md`），總 PR 寫明並留給人
   合併，人工作業清單列出失敗的 job。這條線之後不再派票：該線的候選與還沒派過的票標待裁決，原因寫「線驗證
   未過」與失敗的 job；在途的票照常收票，佇列不再為紅燈暫停。流水線中，這件事觸發一個派票點，讓預算與停止條件
   照常判。

完成判準：轉紅的線在綠燈或撤回之前沒有派新票、整併佇列
沒有前進；撤回的票與依賴它的已整併票都已從 `--done` 移出、對帳表改為卡住或缺口，依賴它的在途票已標待裁決並
寫明上游撤回；驗證未過的線之後沒有派票，它的候選都已標待裁決。
