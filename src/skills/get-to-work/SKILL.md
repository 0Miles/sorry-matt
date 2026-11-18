---
name: get-to-work
description: 逐輪清空一組已開好的 tickets，依阻塞順序平行實作與驗收，每條線交付一支 GitHub 總 PR 或本地整合分支
disable-model-invocation: true
---

# get-to-work：把已開好的 tickets 全部完成

## 0. 選定模式並凍結票集

以本 skill 載入時標示的 base directory 為起點，讀同層的
[`../have-it-all-done/ASKING.md`](../have-it-all-done/ASKING.md) 全文，依它第 0 節開場。它是
共用契約，全程適用，無論本 skill 是被使用者直接執行還是由 `have-it-all-done` 組合。由
`have-it-all-done` 組合時沿用它的 run ledger；獨立執行時依 `ASKING.md` 第 7 節自建，第 10 欄
填本 skill 的 `SKILL.md` 與 `ASKING.md` 的絕對路徑。

確認 git repo 與 working tree 乾淨；tracker 設定為 GitHub 時另確認 `gh` 已登入。Local
Markdown 模式不要求 remote 或 `gh`。兩種模式的交付物見第 2 節。

設定指出工作區含多個 repo 時，逐 repo 盤票。線不跨 repo，每個 repo 各有自己的整合分支與
交付物。

接著**凍結**初始票集：

1. 引數可指定 ticket 編號、URL 或本地檔案路徑。有引數時，初始票集就是指定的 tickets；
   沒有引數時，只收錄本 session 中有發布紀錄的
   tickets，Local Markdown 的發布路徑也算紀錄。找不到任何票時，向使用者索取清單。
2. 對凍結票集執行本 skill 的 `scripts/frontier.mjs`（`${CLAUDE_SKILL_DIR}` 是本 skill 載入時
   標示的 base directory），以輸出的 `blockedBy` 為 blocker **邊**、`line` 為**線**，不自己讀票面推：

   ```bash
   node "${CLAUDE_SKILL_DIR}/scripts/frontier.mjs" github --repo <owner>/<repo> <n>...
   node "${CLAUDE_SKILL_DIR}/scripts/frontier.mjs" local <票檔路徑>...
   ```

   輸出格式寫在腳本檔頭。
3. **排除他線佔用**：以 `git worktree list`、未合併整合分支上的 commits、open PR 的 head，
   以及本 session 已知的其他 session，推出正在被別人動的檔案。檔案與之重疊的票不凍進本次
   票集，改列為**待裁決**並寫出佔用來源與解除條件。有票被排除時，對剩下的票集重跑一次腳本，
   以重跑輸出的 `line` 定線 —— 排除可能讓一條線分裂。
4. 從目前分支尖端，為每條線建立 `<run>/<line-slug>` **整合分支**與整合 worktree；同線成果
   逐輪累積於此。

**硬護欄**：執行期間新發現或新開的票只作為背景，初始票集一經凍結便不再擴張。

完成判準：已選定且驗證 tracker 模式；每張初始票都有發布出處、tracker
原生識別、所屬線與 blocker map；每條被他線佔用而排除的票都有佔用來源與解除條件；每條線
都有從同一基底尖端建立的整合分支及 worktree。

## 1. 用 `/loop` 推進輪次

進入不帶間隔、可自我調速的 `/loop`，prompt 設為「get-to-work：重讀 `<ledger 絕對路徑>` 與它
第 10 欄列出的規則檔，再收輪／開輪」；沒有 ledger 時改為重讀本 skill 的 `SKILL.md` 與 `ASKING.md`
的絕對路徑。每次喚醒都帶著這句，恢復動作（`ASKING.md` 第 7 節）不靠記憶。Agents 尚在
執行時，使用較長 fallback 等候通知。收輪邊界是唯一的交接點，所以把 ledger 寫到最新才結束
那一輪。

### 開輪

每次開輪先重跑 `scripts/frontier.mjs`，**frontier** 就是輸出的 `frontier`：

- **GitHub**：已整併進線整合分支的票在 GitHub 上仍是 open（關票等總 PR 合併），取 ledger 對帳表
  中已整併的票以 `--done <n,...>` 傳入；卡住的票以 `--stuck <n,...>` 傳入。
- **Local Markdown**：每條線各跑一次，傳整個凍結票集，加 `--ref <該線整合分支>` 與
  `--line <該線的 line>`（凍結時輸出的值）；frontier 是各線輸出 `frontier` 的聯集。完成與
  卡住由該分支票檔上的 `sorry-matt completion`／`sorry-matt blocker` 判定，`ready-for-human`
  不算完成。

`stalled` 不為 null 的票（`cycle`、`missing`、`blocked-external`、`blocked-upstream`）在本 run
內不會變成可開工，列為**待裁決**並寫出原因與相關 blocker。

跨線工作通常可平行；同線或修改同一批檔案的**互斥** tickets 必須分輪。

對每張 frontier ticket，先補齊驗收再開工。補驗收項的不能是要通過它的人，所以實作 agent 只讀
驗收項、不寫也不改：

1. **驗收**：以本 skill 的 `scripts/acceptance.mjs` 讀出該票的驗收項與出處，不自己讀票面判斷：

   ```bash
   node "${CLAUDE_SKILL_DIR}/scripts/acceptance.mjs" github --repo <owner>/<repo> <n>
   node "${CLAUDE_SKILL_DIR}/scripts/acceptance.mjs" local --ref <該線整合分支> <票檔路徑>
   ```

   輸出格式寫在腳本檔頭。`needsExpansion` 為 true 的票（一項驗收都沒有，常見於延到進 frontier
   才完整展開的票）交給**展開 agent**：讀同層的 [`EXPANDER.md`](EXPANDER.md)，把本輪所有這類票
   填進佔位，以填好的全文 spawn 一個展開 agent，不另加規則。它在 tracker 寫下標明 `by`、`run`、
   `round` 的展開區塊。它回報後重跑腳本；仍為 true 或被回報為待裁決的票列為**待裁決**，本 run
   不再派，之後開輪從 frontier 剔除。
2. **驗收快照**：把每張要派的票的腳本輸出存成 `sorry-matt/runs/<run>/acceptance/<ticket>.json`
   （`<ticket>` 是票號或票檔名；與 ledger 同在共用目錄，沒有 ledger 時存在 scratchpad），存了就不再覆寫。它是收輪比對驗收
   有沒有被改過的基準。輸出的 `sha256` 同時記進 ledger 對帳表該票那一列：快照路徑推得出來，比對時以
   這個值驗快照本身沒被改過。
3. 從所屬線的整合分支建立 `<run>/<NN>-<slug>` ticket 分支與 worktree。Local Markdown 的展開區塊
   已 commit 在整合分支上，ticket 分支從它之後切出。
4. 讀同層的 [`IMPLEMENTER.md`](IMPLEMENTER.md)，填好其中的佔位，以填好的全文為 prompt
   spawn 一個實作 agent，不另加規則。展開區塊的佔位取自該票驗收快照的 `expansions[].text`：GitHub
   的展開區塊在留言裡，票面全文裡沒有。它定義的**接續紀錄**是該票的唯一正本，其他位置只引用它。

完成判準：本輪派出的每張票在 spawn 實作 agent 之前都已有驗收項與驗收快照，展開補上的驗收項都出自
展開 agent 並標明 `by`、`run`、`round`；本輪 frontier 中每張票都有獨立分支、worktree 與負責 agent，
或已列為待裁決；每個實作 agent 的 prompt 都是填好佔位的 `IMPLEMENTER.md` 全文；同線或檔案重疊的票
均排入不同輪。

### 收輪

同輪所有 agents 回報後，逐票完成下列關卡。順序固定是**針對性檢查 → 一次獨立審查 → 集中
修正 → 按影響範圍複驗**；完整驗證只在收官做一次。

1. **針對性檢查**：確認 agent 回報的受影響範圍檢查是綠的。紅燈先交回原 agent 修到綠，
   審查只收綠燈的票。
2. **獨立審查**：先比對驗收 —— 以 `acceptance.mjs` 加 `--against <驗收快照> --sha <對帳表記的 sha256>`
   重讀該票（Local Markdown 改用 `--ref <ticket 分支>`），輸出存檔。結束代碼 3 表示快照本身被改過，
   輸出照樣存檔交給審查，`check.changed` 為 true。再呼叫 Skill tool 帶入 `prove-it`，模式
   `initial`，傳入票（識別碼、原票票面與展開區塊）、驗收快照與比對輸出的路徑、fixed point（該線
   整合分支）、ticket 分支與步驟 1 的針對性檢查結果。它由審查方做實跑與只限
   本票 diff 的突變，輸出 `pass`／`fix`／`stuck` 的固定格式結論與 finding 清單，並寫進該票的
   接續紀錄。`pass` 進整併，`fix` 進集中修正，`stuck` 依它寫的解除條件排除：開審前的 `stuck`
   不算審查，排除後重跑 `initial`；審中的 `stuck` 排除後只續跑它記下未完成的部分。排除不了就
   標卡住。**一張票預設只有這一位 reviewer**，規範與需求符合性由它的 lens 同時涵蓋。
   只有具體風險需要時才加專項 reviewer，而且要指名是哪個風險、理由記進自答清單；
   「再看一遍比較保險」不是風險。
3. **集中修正**：本票的 finding 一次全部交回保有 context 的原 agent，一輪修完，不逐則來回。
   修完重跑受影響範圍的針對性檢查與驗收比對，再呼叫 Skill tool 帶入 `prove-it`，模式 `recheck`，
   附上一次的審查區塊與新的比對輸出：它只對 finding 涉及的行重跑實跑與突變，不是第二次審查。最多兩輪修正。

   **硬護欄 —— 偶發紅燈一律查到根因。** 測試在同一個 commit 上時紅時綠，當真實失敗
   處理：查出根因，落在測試寫法就修測試，落在產品就修產品或登記缺陷票。重跑、放寬等待、
   加 retry 與調大 timeout 都不算修好。兩輪修正內查不出根因就標卡住。
4. **整併**：在整合 worktree 合併 ticket 分支。有 conflict 時交給一個**整併 agent** 逐塊解：
   給它整合 worktree、兩邊的票面與 commit message，以及這條判準 —— 判的是兩個意圖而不是
   兩段文字，先追兩邊的 primary source（票面與 commit message），相容就都保留，不相容就取
   合乎本次合併目標的那邊，落地的行為限於某一邊實際寫過的。它逐塊回報取捨摘要，主持人把
   取捨記進自答清單。解完執行受影響範圍的針對性檢查。
5. **完成交付**：
   - **GitHub**：push 整合分支。票保持 open，關票交給總 PR（第 2 節）；本票的摘要在它的
     commit message 裡（`IMPLEMENTER.md` 第 2 節）。
   - **Local Markdown**：在整合分支的 ticket 檔勾選每項已驗證的 acceptance criterion（含展開區塊的），將
     `Status` 改為 `ready-for-human`，追加 `## sorry-matt completion`，列出 implementation
     commit、整合分支及通過的檢查，再 commit 這份交付紀錄。
6. 移除 ticket worktree 與本地 ticket 分支。

中途事項走 `ASKING.md` 第 4 節的三條出路。獨立執行而沒有裁決點時，答不出來的事累積到
下一次開輪前一次問完。

兩輪修正後仍未通過驗收，或 conflict 無法安全解決時，將票標為**卡住**：

- **GitHub**：另開 raw issue 記錄失敗，body 依 `ASKING.md` 第 6 節潤稿。
- **Local Markdown**：在整合分支的原 ticket 追加 `## sorry-matt blocker`，列出原因、已做嘗試
  與相關分支；將 `Status` 改為 `ready-for-human` 後 commit。

完成卡住紀錄後也移除 ticket worktree 與本地 ticket 分支。

完成判準：本輪每張票都恰好經過一次獨立審查（`prove-it` 的 `initial`，開審前的 `stuck` 不算），每輪修正後各有一次
`recheck`，每次呼叫都附上當次對驗收快照的比對輸出，結論都寫進接續紀錄；針對性檢查回到綠，並有通過驗收的模式原生
交付，或有可追溯的卡住紀錄；加了專項 reviewer 的票都指名了風險；每張票的接續紀錄都寫到
最新；成功票已整併並清理 ticket worktree 與本地分支。

### 期間開票

範圍外的 bug、前置重構（prefactor）、技術債，以及偶發紅燈查出而根因落在範圍外的缺陷，
只建立 raw ticket，並連回來源 finding：

- **GitHub**：用 `gh issue create`，不加 `ready-for-agent`；body 依 `ASKING.md` 第 6 節潤稿。
- **Local Markdown**：依 tracker 慣例建立下一個未使用編號的 ticket 檔，將 `Status` 設為
  `needs-triage`，並 commit 到發現它的線整合分支。

這些 raw tickets 留在初始票集與本次 frontier 之外。

初始票集全數有完成交付時停止 loop；frontier 已空但仍有卡住或**待裁決**票時也停止。

完成判準：每張初始票恰好對帳為已交付、卡住或待裁決；期間新開的 raw tickets 均有來源連結，
且沒有混入凍結票集。

## 2. 收官

每條線先過**線級的兩道關**，順序固定：

1. **精簡**：在整合 worktree 呼叫 Skill tool 帶入 `simplify`，對整條線累積的改動做一次品質
   收斂 —— 復用、簡化、效率、抽象層級 —— 它會直接套用修法。跨票的重複只有整併之後才看得
   見，所以精簡在這裡做一次，不在每張票各做一次。退掉的修法記進自答清單。
2. **完整驗證**：跑一次 repo 完整的自動檢查。轉紅就交回那段改動的原 agent，修完重跑；本輪
   唯一有效的綠燈就是這一次。

**證據失效規則。** 某張票通過票級驗收之後，只要它碰到的檔案在整合分支上又被改動 —— 他票
整併、conflict 解法、線級精簡 —— 那張票的票級綠燈就過期，仍然有效的只有線級完整驗證。
重跑範圍依實際改動的影響面決定：預設只重跑受影響範圍的針對性檢查，只有新的修正、失敗，
或未解的風險才再跑一次完整驗證。

接著依模式交付每條線：

- **GitHub**：建立「線整合分支 → 基底分支」的**總 PR**。Body 為每張完成票寫一節：摘要與
  `Closes #N`。摘要由主持人彙整該票整併進線的全部 commit message，含集中修正的 commit：
  `git log --format=%B -E --grep='#N([^0-9]|$)' <基底分支>..<線整合分支>`。
  卡住與待裁決的票列為**缺口**，不寫 `Closes`。總 PR body 依 `ASKING.md` 第 6 節潤稿，潤稿後每行 `Closes #N` 仍要在。
- **Local Markdown**：保留線整合分支供人審查與合併；記錄 branch name 與 tip SHA，再移除
  整合 worktree。票據狀態與實作一同留在該分支，不模擬 PR 或 close。

線交付完成後清理：呼叫 Skill tool 帶入 `clean-it-up`，照它的證據規則收掉本輪產生的
ticket worktree 與已合併的本地分支。**待人審查的交付物不在清理範圍**：Local Markdown 的
線整合分支、以及尚未合併的總 PR 來源分支一律保留 —— 對未合併項目，`clean-it-up` 本身就是
降級為保留。遠端分支仍須使用者在本次明確授權，不為此另開提問。

GitHub 模式在總 PR 的 CI 轉綠後以 `gh pr merge` 送出合併。它是確認呼叫，留到清理之後送出；
放不放行由 Claude Code 的權限設定決定，`bypassPermissions` 與 `auto` 模式下一律被 hook 擋下
（`ASKING.md` 第 5 節）。放行就回報合併結果；被擋下或被拒就維持交給人，輸出附上能放行它的
權限規則片段，不為此另開提問。

**關票**在 `gh pr merge` 送出之後做。GitHub 只在 PR 指向 repo 預設分支時解析 `Closes`；
預設分支以 `gh repo view --json defaultBranchRef --jq .defaultBranchRef.name` 查得：

- 總 PR 已合併：確認每張完成票都已關閉。基底不是預設分支，或合併後仍 open 的票，由主持人依
  tracker 契約的 Close 逐張關閉，留言指向總 PR。
- 總 PR 留給人合併、且基底不是預設分支：人工作業清單列出合併後要執行的關票指令。

最終輸出每條線的總 PR 或整合分支、涵蓋全部初始票的**對帳表**與**本輪計量**（`ASKING.md`
第 7 節）、需授權動作的結果（第 5 節），以及期間新開的 raw tickets 清單並請使用者執行 `/triage`。

完成判準：每條線都跑過一次線級精簡與一次完整驗證並收在綠燈，且恰有一項可供人合併的交付，
或已經權限設定放行而合併並回報；已合併的總 PR，其完成票都已關閉；留給人合併而關鍵字不生效的，
人工作業清單有關票指令；對帳表不重不漏地涵蓋凍結票集，每列都指向該票的接續紀錄；所有
ticket worktree 與本地 ticket 分支均已移除；Local Markdown 的整合 worktree 已移除而整合
分支仍保留；輸出已列出需授權動作的結果與本輪計量。
