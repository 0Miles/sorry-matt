# get-to-work：紅燈處置

本檔是一條線轉紅時的處置：tick 發下 `red-light` 的 `judge` 時全文讀取，一次做一輪。轉紅的線不派新票、整併佇列
暫停，到綠燈或撤回為止，這部分由 tick 守；在途的票照常實作、審查與修正。下面的紅燈修正與撤回不排隊。

1. **最早的紅 SHA**：由 `scripts/ci.mjs earliest-red` 算，不自己沿 log 推。計畫檔
   `sorry-matt/runs/<run>/ci/<line-slug>.plan.json` 的欄位在腳本檔頭：`local` 照抄 `state.mjs resume` 輸出裡這條線的
   `local` 行，`tickets` 的 `merges` 取 state 記的 merge SHA；本機驗證的線 `ci` 填 `false`。`earliestRed` 是
   `null` 時這次不對票：流水線中下一次喚醒再讀；收官（[`FINISH.md`](FINISH.md) 步驟 3）當場再跑一次，仍是
   `null` 就當作**對不到票**，照第 3–6 點走。`truncated` 是 `true` 時腳本已把範圍延伸到 `lowerBound`，不自己補判、
   不手動重查。
2. **對到票**：輸出的 `tickets` 由舊到新，從最早的開始，就是第一張（對票規則在 `scripts/review-guide.mjs` 檔頭）。
   `unmatched` 是 `true` —— 紅燈來自主持人 commit、精簡或併入基底 —— 就**對不到票**。
3. **失敗輸出**：有 CI 的線以 `gh run view <id> --log-failed` 存檔，`<id>` 是同一份輸出裡 `earliestRed` 那筆
   `failed` 的每個 id；本機驗證的紅取 `verify.mjs` 輸出的 `log`。主持人只取失敗那幾行。
4. **修，最多兩輪**：
   - 對到票：`integrate.mjs ci-init` 從整合分支切 `<ticket 分支>-ci` 與 worktree，交回那張票的原 agent；不在了就照
     `IMPLEMENTER.md` 以 `brief.mjs` 的角色字 `ci-fix` 新 spawn（agent 類型與退回通用 agent 照 `SKILL.md` 第 1 節的
     spawn），票面附上失敗摘要。CI 失敗就是 finding，走
     集中修正（`recheck` 附上該票上一次的審查區塊），修完 `integrate.mjs merge --ci --push`，不排隊。
   - 對不到票：主持人或新 spawn 的 `ci-fix` agent（目標是整合分支）在整合 worktree 修，commit（subject 不帶票 ID）、
     push。
   - 修正 agent 的派送照常有派送紀錄與時限；超時被停下也算一輪（[`TIMEOUTS.md`](TIMEOUTS.md)）。偶發紅燈的硬護欄
     照用。每輪修完都 push（沒有 `origin` 時略過），由下一次驗證判結果：流水線中是 tick 下一次的讀 CI 或本機驗證，
     收官是 `FINISH.md` 步驟 3 當場再驗。record `handled`。
5. **兩輪仍紅，對到票：撤回。** 依 frontier 的 `blockedBy` 列出依賴它的同線票，跑
   `integrate.mjs revert <state> <票> --worktree <整合 worktree> --reason <CI 紅燈與失敗的 job> --push`，每張依賴票加一個
   `--dependent`（Local Markdown 附票檔）。它撤回每個 merge 與完成紀錄、標卡住、處置依賴票（已整併的標卡住並寫明
   上游撤回；在途的標待裁決並留住分支尖端），檔頭寫了每一步。GitHub 另照 [`SEND-BACK.md`](SEND-BACK.md) 的
   「標卡住」開 raw issue。總 PR 把它們列為缺口，不寫 `Closes`。日後要重新整併被撤回的票，先
   `git revert <撤回的 commit>` 還原撤回。record `reverted`。
6. **兩輪仍紅，對不到票**：這條線**驗證未過**，record `failed`：tick 把它的候選與沒派過的票標待裁決、佇列不再
   為紅燈暫停。不送 `gh pr merge`、不進 merge queue，總 PR 寫明並留給人合併，人工作業清單列出失敗的 job。

完成判準：撤回都經 `integrate.mjs revert`，依賴票都列為 `--dependent`；驗證未過的線在人工作業清單列出失敗的
job；每輪的結果都已 record。
