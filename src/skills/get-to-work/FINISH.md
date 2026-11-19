# get-to-work：收官

本檔是 [`SKILL.md`](SKILL.md) 第 2 節「收官」的全部步驟：流水線停止、進入收官時全文讀取。文中的「步驟 N」指本檔線級三道關的步驟；沒有點名檔案的節名與步驟（第 0 節、第 1 節的「讀 CI」與收票步驟）都指 `SKILL.md`。

每條線先過**線級的三道關**，順序固定：

1. **精簡**：在整合 worktree 呼叫 Skill tool 帶入 `simplify`，對整條線累積的改動做一次品質
   收斂 —— 復用、簡化、效率、抽象層級 —— 它會直接套用修法。跨票的重複只有整併之後才看得
   見，所以精簡在這裡做一次，不在每張票各做一次。退掉的修法記進自答清單。套用的修法收成**一個獨立
   commit**（subject 如 `refactor: simplify <整合分支>`，不帶票 ID；沒有修法就不 commit），不 amend 進任何
   merge 或票的 commit。
2. **併入基底**：整合分支是第 0 節從當時的基底尖端建的，run 期間基底可能已前進，綠燈要跑在
   最新基底上才算數。在整合 worktree 把最新的基底尖端合併進整合分支：有 `origin` 時
   `git fetch origin <基底分支>` 再 `git merge origin/<基底分支>`；Local Markdown 沒有 remote 時
   合併本地 `<基底分支>`，都帶 `--no-edit`。併入的基底 SHA 記進 ledger 第 4 欄。有 conflict 時交給第 1 節收票
   步驟 4 的**整併 agent**（這個 merge 不屬於任何一張票，Agent tool 的 `description` 是 `merge` 後接該線的整合分支），判準與「解法只留在這個 merge commit 裡」照用：一邊是這條線（各票票面與 commit message），另一邊是基底
   （`git log --format=%B <merge-base>..<併入的基底 ref>`），合併目標是讓線的意圖落在最新基底上。
   主持人把取捨記進自答清單。整併 agent 回報無法安全解決時 `git merge --abort`，這條線就是
   **未併入**：ledger 第 4 欄記嘗試併入的基底 SHA 與「未併入」，交付物與人工作業清單寫明衝突的
   檔案，交付一律留給人合併（見下方合併段）。
3. **完整驗證**：以整合分支最新 SHA 的 CI 為準。照收票步驟 6 push 步驟 1–2 之後的整合分支，依第 1 節
   「讀 CI」讀它。還在跑時，`verdict` 輸出的 `runs` 裡每個 `status` 不是 `completed` 的 run，以它的 `id`
   各執行一次 `gh run watch <id> --exit-status` 等它
   結束 —— 每個 run 一次阻塞呼叫，不逐次輪詢，執行環境能背景執行就背景執行。沒有 run 時稍後再讀一次。
   紅就走 [`RED-LIGHT.md`](RED-LIGHT.md) 的紅燈處置。

   **本機驗證**：條件、做法與逐 SHA 紀錄格式照 [`SKILL.md`](SKILL.md)「讀 CI」的「本機驗證」，那裡是唯一的正本。

   報告寫出驗證的 SHA、來源（CI 或本機與原因；本機時另寫指令取自 `commands.md` 或 `self-found`）與併入的基底 SHA；未併入的線照樣驗證未併入的樹，報告
   寫出嘗試併入的基底 SHA 與「未併入」。唯一有效的綠燈是最後這個 SHA 的結果。

**證據失效規則。** 綠燈只對它跑過的那個 SHA 有效。整合分支每多一個 commit —— 他票整併、conflict
解法、CI 紅燈的修正、線級精簡、併入基底 —— 較早的綠燈與票級驗收的綠燈就過期，有效的只有整合分支
最新 SHA 的結果。

接著依模式交付每條線：

- **GitHub**：建立「線整合分支 → 基底分支」的**總 PR**，body 的主體是**逐票導覽**。先在整合 worktree 執行
  本 skill 的 `scripts/review-guide.mjs`：

  ```bash
  node "${CLAUDE_SKILL_DIR}/scripts/review-guide.mjs" sorry-matt/runs/<run>/guide/<line-slug>.plan.json
  ```

  計畫檔與輸出（同名的 `.json`）跟 ledger 同在共用目錄，格式寫在腳本檔頭：`base` 是併入的基底 ref
  （`origin/<基底分支>`），`web` 取 `gh repo view --json url --jq .url`，`tickets` 是對帳表中整併過這條線的每張票
  （含後來成為缺口的），帶對帳表記的 merge SHA（`merges`）、ticket 分支、票名、凍結時 frontier 輸出的
  `blockedBy` 與接續紀錄的連結。腳本照檔頭的規則把 first-parent 上的 merge 對到
  票，票的 commit 就是 `<merge>^1..<merge>^2`；其他 first-parent commit（精簡、併入基底、主持人 commit、對不到
  票的修正、撤回）是**線級 commit**。結束代碼 3 表示 `missing` 裡的票在線上找不到 merge，`warnings` 列出不在線上的 SHA：照 ledger 核對它的 merge SHA 與分支名，修正計畫檔重跑；仍找
  不到就在該票那節寫明「commit 範圍對不到」，不猜範圍。

  Body 依輸出寫，順序固定：

  1. **審查門檻提醒**：`size.over` 為 true —— PR diff 的增刪合計（`git diff --shortstat <基底>...<線整合分支>`）
     超過門檻，預設 400 行，約是一次審得完的量 —— 時，body 第一段寫出行數與門檻，建議照逐票導覽按 commit
     範圍一張一張審，不要一次看整支 diff。
  2. **逐票導覽**：每張完成票一節，照 `tickets` 的 `order` —— 阻擋邊的拓撲序，被依賴的票先讀。每節寫：
     - 標題：順序、票號與票名；
     - commit 範圍：每個 merge 的 `compare` 連結，附 commit 數與 `stat`；紅燈修正的 `-ci` merge 另列一段；
     - 改了什麼：主持人彙整該票整併進線的全部 commit message。取法是對該票 `merges` 的每個 `range`
       （`<merge>^1..<merge>^2`）各跑一次 `git log --format=%B <range>`，紅燈修正的 `-ci` merge 也算在內；
       不以票號搜尋 commit —— 別票 commit body 提到的票號（如 `Refs #8`）會被一併抓進來。集中修正在
       ticket 分支上、整併前完成，已在該票的 merge 範圍內，不需另外撈。`missing` 裡的票照上面「commit
       範圍對不到」的寫法處理，不提供任何替代的取法；
     - 驗收證據：接續紀錄的連結；
     - `resolved` 為 true 的 merge 寫明含衝突解法並附它的 `remergeDiff` 指令，註明只能在本機
       （git 2.36 以上）看、GitHub 網頁看不到；退回重做過的票註明退回次數；
     - 節末 `Closes #N`。
  3. **線級 commit**：`lineCommits` 逐項附連結與用途；含衝突解法的附 `remergeDiff` 指令，同樣註明只能在本機看。
  4. **缺口**：卡住與待裁決的票，不寫 `Closes`；在線上有 merge 的（上游撤回、被撤回）附它的 commit 範圍。

  總 PR body 依 `ASKING.md` 第 6 節潤稿；潤稿後門檻提醒仍在 body 開頭，每個 commit 連結與每行 `Closes #N`
  仍要在。
- **Local Markdown**：保留線整合分支供人審查與合併；記錄 branch name 與 tip SHA，再移除
  整合 worktree。票據狀態與實作一同留在該分支，不模擬 PR 或 close。

線交付完成後清理：呼叫 Skill tool 帶入 `clean-it-up`，照它的證據規則收掉本 run 產生的
ticket worktree 與已合併的本地分支。**待人審查的交付物不在清理範圍**：Local Markdown 的
線整合分支、以及尚未合併的總 PR 來源分支一律保留 —— 對未合併項目，`clean-it-up` 本身就是
降級為保留。遠端分支仍須使用者在本次明確授權，不為此另開提問。

GitHub 模式在總 PR 的 CI 轉綠後，有常設授權（權限設定的 `permissions.allow` 涵蓋 `gh pr merge`）
或使用者本 run 指示合併時，以 `gh pr merge` 送出合併；兩者都沒有就不送，總 PR 留給人合併，輸出附上
能放行它的權限規則片段。未併入或驗證未過的線不送，也不進 merge queue，總 PR 留給人合併。它是確認
呼叫，留到清理之後送出；放不放行由 Claude Code 的權限設定決定，合併會立即觸發正式部署時 hook 會再
跳一次確認（`ASKING.md` 第 5 節）。放行就回報合併結果；被擋下或被拒就維持交給人，輸出附上能放行它的
權限規則片段，不為此另開提問。

**merge queue。** 送出前查基底分支有沒有啟用 merge queue：

```bash
gh api graphql -f query='query($owner:String!,$name:String!,$branch:String!){repository(owner:$owner,name:$name){mergeQueue(branch:$branch){url}}}' -f owner=<owner> -f name=<repo> -f branch=<基底分支>
```

`mergeQueue` 是 null 就是沒有啟用，照上一段，行為不變。啟用時合併改走 merge queue：同一個
`gh pr merge <PR>`，不帶合併策略也不帶 `--admin` —— gh 會把 PR 排進 queue，queue 把它與最新
基底、排在前面的 PR 組成 merge group 再驗一次才合併。送不送、放不放行都同上一段；不用 `--admin`
跳過 queue，也不用 GraphQL 的 `enqueuePullRequest` 排進 queue 而繞過 `gh pr merge` 的權限檢查。

queue 只在 `merge_group` 事件上跑檢查，所以送出前先確認它的檢查會跑：

- 基底 ref 上有一支 workflow 的 `on:` 含 `merge_group`
  （`git grep -l merge_group origin/<基底分支> -- .github/workflows`）：送。
- 沒有這種 workflow，而基底分支沒有必要檢查：送。必要檢查是 rulesets 的
  `gh api repos/<owner>/<repo>/rules/branches/<基底分支> --jq '[.[]|select(.type=="required_status_checks")|.parameters.required_status_checks[].context]'`
  與 branch protection 的 `gh api repos/<owner>/<repo>/branches/<基底分支> --jq '.protection.required_status_checks.contexts'`
  兩者的聯集。
- 沒有這種 workflow，卻有必要檢查（可能來自第三方 CI，回不回應 `merge_group` 查不到）：不送，
  送出只會卡在 queue。改列人工作業清單，寫明缺的觸發與那幾項必要檢查。

以上任何一個查詢失敗都不猜，不送，改列人工作業清單：`gh` 非零結束、GraphQL 回應帶 `errors`，或
`git grep` 結束代碼大於 1（1 是「沒有」，0 是「有」）。`contexts` 回 null 當空集合。送出後回報
PR 已合併，或仍在 queue 中與 PR URL；仍在 queue 中的總 PR，關票照「留給人合併」處理。

**關票**在 `gh pr merge` 送出之後做。GitHub 只在 PR 指向 repo 預設分支時解析 `Closes`；
預設分支以 `gh repo view --json defaultBranchRef --jq .defaultBranchRef.name` 查得：

- 總 PR 已合併：確認每張完成票都已關閉。基底不是預設分支，或合併後仍 open 的票，由主持人依
  tracker 契約的 Close 逐張關閉，留言指向總 PR。
- 總 PR 留給人合併、且基底不是預設分支：人工作業清單列出合併後要執行的關票指令。

最終輸出每條線的總 PR 或整合分支、併入的基底 SHA（未併入時標明）、完整驗證的 SHA 與來源（CI，或
本機與原因）、涵蓋全部初始票的**對帳表**（含每張票的退回次數）
與**本 run 的計量與預算**（`ASKING.md` 第 7 節第 9 欄，停下時含停止原因；附下一段的分段計量）、需授權動作的結果（ledger
第 5 欄），以及期間新開的 raw tickets 清單並請使用者執行 `/triage`。獨立執行時，輸出後把 ledger 第一行改成
`<!-- sorry-matt:run ended -->`；由 `have-it-all-done` 組合時不改，留給它的交棒。

**分段計量**：本 run 的計量與預算附上 spawn 依 agent 類別、依票的彙總。對 ledger 旁由 hook 寫的 `<run>.counters.json`
執行本 skill 的 `scripts/spawns.mjs`，輸出格式寫在腳本檔頭：

```bash
node "${CLAUDE_SKILL_DIR}/scripts/spawns.mjs" <ledger 所在目錄>/<run>.counters.json
```

把輸出的 `byType`（每一類 agent 的 spawn 數，總和等於 `spawns`）與 `byTicket`（每張票各類的 spawn 數）原樣附上。類別是
具名的 agent 類型（如 `sorry-matt:expander`）；通用 agent 是它 `description` 開頭的角色字（`SKILL.md` 第 1 節「時限」），
所以退回通用 agent 的展開會列在 `expand` 而不是 `sorry-matt:expander`；`unknown` 是 hook 開始逐筆記錄之前計入的
spawn。沒有 counters 檔（hook 沒有載入）或腳本以非 0 結束時，寫明本 run 沒有分段計量與原因，不自己估。

完成判準：每條線都跑過一次線級精簡、一次併入基底與一次完整驗證，收在綠燈或標明驗證未過並留給人
合併；精簡的修法與併入基底各是自己的 commit，沒有混進票的 commit；總 PR body 有依 `review-guide.mjs` 輸出寫的
逐票導覽，每張完成票照阻擋邊的順序、有可點的 commit 範圍、摘要與接續紀錄連結，`size.over` 為 true 時開頭有
門檻提醒；完整驗證是已併入最新基底的整合分支最新 SHA 的 CI 結果，或在步驟 3 的本機驗證條件下同一 SHA 的
本機檢查且報告寫明原因，本機驗證的線每個驗過的 SHA、以及有 CI 的線上 `no-verdict` 的那一次都有 ledger 第 4 欄的紀錄，報告寫出驗證的 SHA 與基底 SHA；未併入的線寫明衝突檔案與嘗試的基底 SHA，在未併入的樹
上驗證，並留給人合併；每條線恰有一項可供人合併的交付，或已經權限設定放行而合併（基底啟用
merge queue 時走 queue）並回報；已合併的總 PR，其完成票都已關閉；留給人合併而關鍵字不生效的，
人工作業清單有關票指令；對帳表不重不漏地涵蓋凍結票集，每列都指向該票的接續紀錄；所有
ticket worktree 與本地 ticket 分支均已移除；Local Markdown 的整合 worktree 已移除而整合
分支仍保留；輸出已列出需授權動作的結果與本 run 的計量與預算，計量附有 `spawns.mjs` 的 `byType` 與 `byTicket`，或寫明沒有分段計量與原因；獨立執行時 ledger 第一行已是 ended 標記。
