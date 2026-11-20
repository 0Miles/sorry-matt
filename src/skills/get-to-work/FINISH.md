# get-to-work：收官

本檔是流水線停止之後的收官：tick 的 `judge` 指到這裡時全文讀取。線級三道關的順序、併入基底與完整驗證的指令都
由 tick 發下；這裡只寫要你判斷或撰寫的部分。

每條線先過**線級的三道關**，順序固定：

1. **精簡**：對整條線累積的改動做一次品質收斂 —— 復用、簡化、效率、抽象層級。跨票的重複只有整併之後才看得見，
   所以在這裡做一次。你不自己呼叫 `simplify`，整條線的 diff 也不進你的 context：tick 發一個前景 spawn
   （`general-purpose`，`description` 照 `brief.mjs` 檔頭是 `simplify <整合分支>`），派工檔由 tick 寫好。照發，
   只收它回的兩行。精簡 agent 先依整條線的改動判斷要不要精簡：
   - 只改文件、只有刪除、只改設定或資料檔、沒有新增邏輯時**跳過精簡**，不呼叫 `simplify`。
   - 有新增或改寫的邏輯，且可能有重複實作、可復用函式、可拿掉的分支或間接層時要做。
   - 拿不準時要做。不設行數門檻：看改了什麼，不看改了多少。

   要做時它在整合 worktree 呼叫 Skill tool 帶入 `simplify`。套用的修法收成**一個獨立 commit**（subject
   `refactor: simplify <整合分支>`，不帶票 ID；body 列出套用的修法，與每個退掉的修法及一行理由），沒有修法就不
   commit。它回報三種結果之一並附一行理由，你以 `--outcome` 與 `--value` 記錄：`applied`（有 commit）、`none`
   （做了、沒有修法）、`skipped`（判斷不需要、沒有呼叫 `simplify`）。`skipped` 的線由 tick 在收尾的 `wrap-up`
   列出：理由寫進自答清單，線列進結尾摘要。流程設定 `simplify: false` 時整步不做，不派任何 agent。
2. **併入基底**：把最新的基底尖端合併進整合分支，綠燈要跑在最新基底上才算數。衝突交給整併 agent，判準照
   [`SKILL.md`](SKILL.md) 第 2 節「合併衝突」：一邊是這條線（各票票面與 commit message），另一邊是基底
   （`git log --format=%B <merge-base>..<併入的基底 ref>`），目標是讓線的意圖落在最新基底上；`description` 照
   `brief.mjs` 檔頭以整合分支為目標。整併 agent 無法安全解決時，這條線**未併入**：交付物與人工作業清單寫明衝突的
   檔案與嘗試的基底 SHA，交付一律留給人合併。
3. **完整驗證**：整合分支最新 SHA 的結果才有效 —— 他票整併、衝突解法、紅燈修正、精簡與併入基底都會讓較早的綠燈
   過期。紅就走 [`RED-LIGHT.md`](RED-LIGHT.md)。報告寫出驗證的 SHA、來源（CI，或本機與原因；本機時另寫
   `verify.mjs` 輸出的 `source`）與併入的基底 SHA；未併入的線照樣驗證未併入的樹。

接著依模式交付每條線：

- **GitHub**：建立「線整合分支 → 基底分支」的**總 PR**，body 的主體是**逐票導覽**。先在整合 worktree 跑
  `scripts/review-guide.mjs sorry-matt/runs/<run>/guide/<line-slug>.plan.json`（計畫檔欄位在腳本檔頭：`base` 是
  `origin/<基底分支>`，`web` 取 `gh repo view --json url --jq .url`，`tickets` 是 state 裡整併過這條線的每張票，含
  後來成為缺口的，帶 merge SHA、ticket 分支、票名、凍結時的 `blockedBy` 與接續紀錄的連結）。結束代碼 3 時照
  `missing` 與 `warnings` 核對 state 的 merge SHA 與分支名、修正計畫檔重跑；仍找不到就在該票那節寫明「commit
  範圍對不到」，不猜範圍。Body 依輸出寫，順序固定：
  1. **審查門檻提醒**：`size.over` 為 true 時，第一段寫出行數與門檻，建議照逐票導覽按 commit 範圍一張一張審。
  2. **逐票導覽**：每張完成票一節，照 `tickets` 的 `order`。每節寫：標題（順序、票號與票名）；每個 merge 的
     `compare` 連結、commit 數與 `stat`，紅燈修正的 `-ci` merge 另列；改了什麼 —— 對每個 `range` 各跑一次
     `git log --format=%B <range>` 彙整，不以票號搜尋 commit（別票 commit body 提到的票號會被抓進來）；接續紀錄的
     連結；`resolved` 的 merge 附 `remergeDiff` 指令並註明只能在本機（git 2.36 以上）看；退回次數；節末 `Closes #N`。
  3. **線級 commit**：`lineCommits` 逐項附連結與用途，含衝突解法的附 `remergeDiff` 指令。
  4. **缺口**：卡住與待裁決的票，不寫 `Closes`；在線上有 merge 的附它的 commit 範圍。

  總 PR body 依 `ASKING.md` 第 6 節潤稿；潤稿後門檻提醒仍在開頭，每個 commit 連結與每行 `Closes #N` 仍要在。
- **Local Markdown**：保留線整合分支供人審查與合併；記錄 branch name 與 tip SHA，再移除整合 worktree。票據狀態與
  實作一同留在該分支，不模擬 PR 或 close。

線交付完成後呼叫 Skill tool 帶入 `clean-it-up`，照它的證據規則收掉本 run 產生的 ticket worktree 與已合併的本地
分支。**待人審查的交付物不在清理範圍**：Local Markdown 的線整合分支與尚未合併的總 PR 來源分支一律保留。遠端分支
仍須使用者在本次明確授權，不為此另開提問。

**合併**：GitHub 模式在總 PR 的 CI 轉綠後，照 `ASKING.md` 第 5 節「需要授權的動作」決定送不送 `gh pr merge`；
未併入或驗證未過的線不送，總 PR 留給人合併。送出前跑 `scripts/merge-gate.mjs --repo <owner>/<repo> --base <基底分支>`：
`decision` 是 `merge` 或 `queue` 就送同一個 `gh pr merge <PR>`（`queue` 不帶合併策略也不帶 `--admin`），`human`
就不送，改列人工作業清單並附 `reason` 與 `requiredChecks` 或失敗的查詢。它是確認呼叫，留到清理之後送出。送出後回報
已合併，或仍在 queue 中與 PR URL；仍在 queue 中的總 PR，關票照「留給人合併」處理。

**關票**在 `gh pr merge` 送出之後做。GitHub 只在 PR 指向 repo 預設分支時解析 `Closes`；預設分支以
`gh repo view --json defaultBranchRef --jq .defaultBranchRef.name` 查得：

- 總 PR 已合併：確認每張完成票都已關閉。基底不是預設分支，或合併後仍 open 的票，由主持人依 tracker 契約的 Close
  逐張關閉，留言指向總 PR。
- 總 PR 留給人合併、且基底不是預設分支：人工作業清單列出合併後要執行的關票指令。

**最終輸出**：每條線的總 PR 或整合分支、併入的基底 SHA（未併入時標明）、完整驗證的 SHA 與來源、涵蓋全部初始
票的**對帳表**（`state.mjs show`，含每張票的退回次數，每列指向接續紀錄）、**本 run 的計量與預算**（state 的
`usage`，停下時含 `stop`）與**分段計量**、需授權動作的結果（ledger 第 5 欄）、**跳過精簡的線**（`wrap-up` 的
`meta.simplifySkipped`，每條附理由；沒有就不列），以及期間新開的 raw tickets 清單並請使用者執行 `/triage`。
分段計量是 `scripts/spawns.mjs <ledger 所在目錄>/<run>.counters.json` 輸出的 `byType` 與 `byTicket` 原樣附上；沒有 counters 檔或腳本以非 0 結束時，寫明本 run 沒有分段計量與原因，不自己估。獨立執行時，
輸出後把 ledger 第一行改成 `<!-- sorry-matt:run ended -->`；由 `have-it-all-done` 組合時不改，留給它的交棒。

完成判準：精簡的修法與併入基底各是自己的 commit；總 PR body 有依 `review-guide.mjs` 輸出寫的逐票導覽，
`size.over` 為 true 時開頭有門檻提醒；未併入的線寫明衝突檔案與嘗試的基底 SHA，並留給人合併；每條線恰有一項
可供人合併的交付，或已依 `merge-gate.mjs` 的決定送出合併並回報；已合併的總 PR，其完成票都已關閉，關鍵字不生效的
在人工作業清單有關票指令；輸出列出了對帳表、需授權動作的結果與計量（含分段計量或沒有的原因），以及跳過精簡的線，
其理由在自答清單；獨立執行時 ledger 第一行已是 ended 標記。
