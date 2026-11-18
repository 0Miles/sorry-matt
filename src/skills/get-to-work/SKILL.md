---
name: get-to-work
description: 以逐票流水線清空一組已開好的 tickets：可開工且檔案不重疊的票同時實作，做完一張就審查與整併，每條線交付一支 GitHub 總 PR 或本地整合分支
disable-model-invocation: true
---

# get-to-work：把已開好的 tickets 全部完成

## 0. 選定模式並凍結票集

以本 skill 載入時標示的 base directory 為起點，讀同層的
[`../have-it-all-done/ASKING.md`](../have-it-all-done/ASKING.md) 全文，依它第 0 節開場。它是
共用契約，全程適用，無論本 skill 是被使用者直接執行還是由 `have-it-all-done` 組合。由
`have-it-all-done` 組合時沿用它的 run ledger；獨立執行時依 `ASKING.md` 第 7 節自建或接手，第 10 欄
要有本 skill 的 `SKILL.md` 與 `ASKING.md` 的絕對路徑，缺的補上。

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
   逐票累積於此。

**硬護欄**：執行期間新發現或新開的票只作為背景，初始票集一經凍結便不再擴張。

完成判準：已選定且驗證 tracker 模式；每張初始票都有發布出處、tracker
原生識別、所屬線與 blocker map；每條被他線佔用而排除的票都有佔用來源與解除條件；每條線
都有從同一基底尖端建立的整合分支及 worktree。

## 1. 用 `/loop` 推進流水線

每張可開工的票各走一條**流水線**：派票 → 實作 → 收票（審查、修正、整併）。票與票之間不分輪、不互等：
**互斥**只看預計檔案是否重疊，不看是否同線，同一個 repo 裡跨線也判；一張票做完就收票，整併後立即重算
frontier 並補派。

每張票在對帳表有一個**階段**：候選 → 展開中（等展開 agent）→ 實作中 → 審查中 → 修正中 → 待整併（在整併佇列
裡等）→ 整併中 → 終局（已交付、卡住、待裁決）。**在途**指實作中到整併中；退回重做的票回到候選。恢復時
（`ASKING.md` 第 7 節）靠階段與負責 agent 的 id 接回每張沒到終局的票。

進入不帶間隔、可自我調速的 `/loop`，prompt 設為「get-to-work：重讀 `<ledger 絕對路徑>` 與它
第 10 欄列出的規則檔，再推進流水線」；沒有 ledger 時改為重讀本 skill 的 `SKILL.md` 與 `ASKING.md`
的絕對路徑。每次喚醒都帶著這句，恢復（`ASKING.md` 第 7 節）不靠記憶。

實作、展開、修正與整併 agent 一律在背景跑；有 agent 在跑時使用較長 fallback 等候通知。每次喚醒依序做：

1. 有線在紅燈處置中時，依「讀 CI」讀那條線。
2. 處理已回報的 agents：實作或修正 agent 回報的票照「收票」往下走；展開或整併 agent 回報的，接回
   等它的那一步。
3. 依各線的**整併佇列**整併審查通過的票（收票步驟 4–8）。
4. 有**派票點**觸發時，在最後做一次（「派票」）。
5. 把 ledger 寫到最新才結束這次喚醒。沒有輪的邊界：每次喚醒的結尾就是交接點。

### 讀 CI

派票點與收官都以**整合分支最新 SHA 的 CI 結果**為準；有線在紅燈處置中時，每次喚醒也讀那條線。最新 SHA 是
`git rev-parse origin/<整合分支>`；它和本地整合分支不同時，先照收票步驟 6 push 再讀：

```bash
gh run list --branch <整合分支> --commit <SHA> --limit 100 --json databaseId,workflowName,status,conclusion
```

只讀 GitHub Actions；其他 CI 在這裡讀不到，當作沒有 run。一個 SHA 的所有 run 合起來判一個結果，依下列
順序，先符合的為準；結果與 SHA 記進 ledger 第 4 欄：

- **查詢失敗**：`gh` 非零結束。不猜，記下原因，下一次再讀。
- **沒有 run**：清單是空的。剛 push 的 SHA 可能還沒登記，先當成還在跑。連續兩個派票點都讀到空清單，
  而且 `gh run list --branch <整合分支> --limit 1 --json databaseId` 也是空的（這條分支從來沒有 run），
  才定案為 **CI 不涵蓋整合分支**；定案沿用到收官，之後這條線不再讀 CI。
- **紅**：有 run 的 `conclusion` 是 `failure`、`timed_out`、`startup_failure`、`action_required` 或
  `stale`。走下方的紅燈處置。
- **還在跑**：有 run 的 `status` 不是 `completed`。不等、不輪詢，下一次讀那時的最新 SHA —— 每個 run
  都跑全套，較新的 SHA 涵蓋較舊的。
- **被取消**：有 run 是 `cancelled`。`gh run rerun <databaseId>`，當成還在跑。
- **綠**：其餘 —— 每個 run 都 `completed`，`conclusion` 都是 `success`、`skipped` 或 `neutral`。

**紅燈處置。** 轉紅的線**不派新票**，**整併佇列暫停**，到綠燈或撤回為止。在途的票照常實作、審查與修正，
審查通過的在佇列裡等；下面的紅燈修正與撤回不排隊。紅線上再整併別的票，最早紅 SHA 之後的 SHA 都帶著
同一個紅，新票自己的紅燈被蓋住，修完仍紅時也會錯對到原票。

1. **最早的紅 SHA**：`gh run list --branch <整合分支> --limit 200 --json headSha,status,conclusion`
   按 `headSha` 彙整，每個 SHA 照上面判；沿 `git log --first-parent --format=%H origin/<整合分支>` 由新往舊，
   找出最早的紅 SHA —— 它之前最近一個有結論的 SHA 是綠。
2. **對到票**：`git log --merges --first-parent --format='%H %s' <前一個綠 SHA>..<最早的紅 SHA>` 列出這段的
   merge commit。subject 帶 ticket 分支名（`Merge branch '<run>/<NN>-<slug>'`）的就是那張票；完成紀錄、
   卡住紀錄、期間開票這些主持人 commit 不是 merge，夾在中間也不影響。有好幾張票（中間的 push 沒有結論）
   從最早的開始。沒有 ticket 分支的 merge —— 紅燈來自主持人 commit、精簡或併入基底 —— 就**對不到票**。
3. 失敗的 job 與步驟以 `gh run view <databaseId> --log-failed` 存檔，主持人只取失敗那幾行。
4. **修，最多兩輪**：對到票就交回那張票的原 agent（已不在時依 `IMPLEMENTER.md` spawn 新的，票面附上失敗
   摘要），在從整合分支新切的 `<run>/<NN>-<slug>-ci` 分支修：CI 失敗就是 finding，走收票步驟 3 的集中修正
   （`recheck` 附上該票上一次的審查區塊）與步驟 4–7，整併不排隊。對不到票就由主持人或做那一步的 agent 在整合
   worktree 修，commit（subject 不帶票 ID）、push。偶發紅燈的硬護欄照用。每輪修完都 push，下一次讀 CI 判結果。
5. **兩輪仍紅，對到票：撤回。** `git revert -m 1 <該票的 merge commit>`，並撤掉它的完成紀錄：
   - **GitHub**：依收票開卡住紀錄的 raw issue；之後的派票點把它從 `--done` 移到 `--stuck`。
   - **Local Markdown**：`git revert` 撤回完成紀錄那個 commit，再依收票追加 `## sorry-matt blocker`，原因寫
     CI 紅燈與撤回的 commit。frontier 把完成紀錄之後的 blocker 判為卡住，漏撤也不會算完成。

   ledger 對帳表該列改為卡住，總 PR 列為缺口。依賴它而已整併的票一併改成缺口：它們的 merge 不撤，對帳表
   標「上游撤回」，GitHub 從 `--done` 移到 `--stuck`，Local Markdown 在該票追加 blocker 寫明上游；
   總 PR 都不寫 `Closes`。依賴它而還在途的票（含整併佇列裡的）退出流水線，標**待裁決**，原因寫「上游撤回」
   與撤回的 commit：還在跑的 agent 回報後不收票；分支尖端照收票的退回重做留在
   `refs/sorry-matt/<run>/<NN>-<slug>/upstream-reverted`，再移除 worktree 與分支。push 後照常讀 CI。日後要
   重新整併被撤回的票，先 `git revert <撤回的 commit>` 還原撤回，否則 git 認為它已併入，不會再帶進改動。
6. **兩輪仍紅，對不到票**：這條線**驗證未過**：不送 `gh pr merge`、不進 merge queue，總 PR 寫明並留給人
   合併，人工作業清單列出失敗的 job。這條線之後不再派票：該線的候選與還沒派過的票標待裁決，原因寫「線驗證
   未過」與失敗的 job；在途的票照常收票，佇列不再為紅燈暫停。這件事觸發一個派票點，讓預算與停止條件照常判。

### 預算與斷路

上限與用量都在 ledger 第 9 欄（`ASKING.md` 第 7 節）。用量在兩個時點更新：每個派票點的第一件事（下列三步），
與每張票收票結束把 ledger 寫到最新時（只做步驟 1；進展與上限只在派票點判）。

1. **更新用量**：spawn 數讀 ledger 旁 `<run>.counters.json` 的 `spawns`（沒有這個檔就用主持人自己累計的數）；
   經過時間照第 9 欄的算法 —— 現在減開始時間，再減等人時間。第一個派票點記開始時間；接手沒有開始時間的
   ledger 時記接手的時刻，並註明之前的時間未計。
2. **判進展**：「一次」是一個派票點。等 agents 的喚醒、只推進收票的喚醒都不算。比對上個派票點記下的進度
   快照 —— 每條線整合分支的 tip SHA，與對帳表中已到終局（已交付、卡住、待裁決）的票：兩者都沒變，連續
   無進展次數加一；任何一項變了就歸零。票在終局之前的階段之間移動，或被退回重做，都不算
   進展；ticket 分支上的 commit 也不算：沒整併的嘗試沒有改變任何交付。然後把這次的快照記進第 9 欄；第一個
   派票點只記快照。
3. **判上限**：派票點次數達到 `rounds`、spawn 數達到 `spawns`、經過時間達到 `hours`，或連續無進展
   次數達到 `no-progress`，就**停下**。沒停下才把派票點次數加一，往下派票。

**停下**：這個派票點不派票、不展開，之後也不再有派票點。在途的票照「收票」收到整併、卡住或退回為止，讀 CI
與紅燈處置照常；退回的票不再派。凍結票集中沒派過的（含展開中的）、退回後等重派的、spawn 被擋下的票標**待裁決**，原因寫
停在哪個上限與當時的用量。第 9 欄記停止原因；無進展斷路時寫出最近這幾個派票點裡，每張未交付的票停在哪一步、
在等什麼，並指向它的接續紀錄。在途的票都收完就停止 loop，照第 2 節收官。

派票或收票中途，spawn 被 plugin 的 hook 以預算為由擋下：不重試、不換路。已派出的 agents 照常收票；沒派出的
票，與收票缺了那個 agent 就走不下去的票，照上一段標待裁決；下一個派票點在步驟 3 停下。收官的步驟需要 spawn
而被擋下，照 `ASKING.md` 第 4 節記進人工作業清單。

完成判準：每個派票點都先更新了第 9 欄的用量、判過進展與四個上限，每張票收票結束都更新了用量；停下之後
沒有再派票，未交付的票都已標待裁決並寫出停在哪個上限，第 9 欄有停止原因；被預算擋下的 spawn 沒有重試或換路。

### 派票

**派票點**在這些時刻觸發，在那次喚醒的最後做一次，一次喚醒至多一個：第一次喚醒；有票整併進整合分支或被
撤回；有票離開流水線（卡住、待裁決、退回重做）；轉紅的線回到綠燈或判為驗證未過；展開 agent 回報。其他
喚醒不派票。

每個派票點先照「預算與斷路」判上限；沒停下，再依「讀 CI」讀每條 push 過、還沒定案為 CI 不涵蓋的線。轉紅的
線走紅燈處置，在綠燈或撤回之前不派新票；其他結果照常派票。

接著重跑 `scripts/frontier.mjs`，**frontier** 就是輸出的 `frontier`：

- **GitHub**：已整併進線整合分支的票在 GitHub 上仍是 open（關票等總 PR 合併），取 ledger 對帳表
  中已整併的票以 `--done <n,...>` 傳入；卡住的票以 `--stuck <n,...>` 傳入。
- **Local Markdown**：每條線各跑一次，傳整個凍結票集，加 `--ref <該線整合分支>` 與
  `--line <該線的 line>`（凍結時輸出的值）；frontier 是各線輸出 `frontier` 的聯集。完成與
  卡住由該分支票檔上的 `sorry-matt completion`／`sorry-matt blocker` 判定，`ready-for-human`
  不算完成。

`stalled` 不為 null 的票（`cycle`、`missing`、`blocked-external`、`blocked-upstream`）在本 run
內不會變成可開工，列為**待裁決**並寫出原因與相關 blocker。`warnings` 記進 ledger，不改變結果。

**候選**是 frontier 中階段為候選的票，照 frontier 的順序；展開中、在途與到了終局的票都不是。驗證未過的線上
的候選標待裁決（「讀 CI」紅燈處置第 6 點），不往下派。補驗收項的不能是要通過它的人，所以實作 agent 只讀
驗收項、不寫也不改。對每張候選票依序：

1. **驗收**：以本 skill 的 `scripts/acceptance.mjs` 讀出該票的驗收項與出處，不自己讀票面判斷：

   ```bash
   node "${CLAUDE_SKILL_DIR}/scripts/acceptance.mjs" github --repo <owner>/<repo> <n>
   node "${CLAUDE_SKILL_DIR}/scripts/acceptance.mjs" local --ref <該線整合分支> <票檔路徑>
   ```

   輸出格式寫在腳本檔頭。`needsExpansion` 為 true 的票（一項驗收都沒有，常見於延到進 frontier
   才完整展開的票）交給**展開 agent**：讀同層的 [`EXPANDER.md`](EXPANDER.md)，把這個派票點所有這類票
   填進佔位，以填好的全文在背景 spawn 一個展開 agent，不另加規則。它在 tracker 寫下標明 `by`、`run`、
   `round` 的展開區塊，`round` 是這個派票點的次數（第 9 欄）。這些票的階段改為展開中，這個派票點不再往下
   走，所以下一個派票點不會再為它們 spawn 展開。展開 agent 回報觸發派票點，這些票回到候選，從本步驟重跑
   腳本；仍為 true 或被回報為待裁決的票列為**待裁決**，本 run 不再派，之後的派票點從 frontier 剔除。
2. **驗收快照**：把腳本輸出存成 `sorry-matt/runs/<run>/acceptance/<ticket>.json`
   （`<ticket>` 是票號或票檔名；與 ledger 同在共用目錄，沒有 ledger 時存在 scratchpad），存了就不再覆寫。它是收票比對驗收
   有沒有被改過的基準。輸出的 `sha256` 同時記進 ledger 對帳表該票那一列：快照路徑推得出來，比對時以
   這個值驗快照本身沒被改過。退回後重派的票沿用原快照，不重新展開。
3. **預計檔案**：主持人在整合 worktree 預測這張票會動的檔，存成 `sorry-matt/runs/<run>/files/<ticket>.txt`：
   一行一個 repo 相對路徑，涵蓋該路徑本身與底下的一切，`/` 表示整個 repo。來源依序：
   - 票面、展開區塊與驗收項點名的路徑；
   - 票面點名的模組、skill、指令、設定鍵或識別字，以 `git grep -l` 與 `git ls-files` 找到的定義與主要
     使用處；
   - repo 規則檔（`AGENTS.md`、`CLAUDE.md` 這類）要求一起改的檔，例如翻譯版、索引表、CI 設定。

   寧寬勿窄：寫寬只少一點並行，寫窄會在整併時撞上、退回重做。什麼都推不出來就寫 `/`。不叫實作 agent
   開工前回報：那要多一次 spawn 與往返，它沒讀 code 之前的猜測也不比主持人準。存了就不改，只在退回重做時
   加寬（「收票」）。
4. **檔案重疊**：每個 repo 寫一份計畫檔 `sorry-matt/runs/<run>/overlap/<n>.plan.json`（`<n>` 是派票點次數；
   多 repo 時檔名前加 `<repo>-`），涵蓋這個 repo 的每一條線：`running` 是在途的票、它們的預計檔案、ticket
   worktree，以及所屬線的整合分支作為 `base`；`candidates` 是候選票與預計檔案。執行本 skill 的
   `scripts/overlap.mjs`，輸出存成同名的 `.json`：

   ```bash
   node "${CLAUDE_SKILL_DIR}/scripts/overlap.mjs" <計畫檔>
   ```

   輸出格式寫在腳本檔頭。在途的票除了預計檔案，也佔住它的 worktree 已經動到的檔。`start` 的票這個派票點
   全部派出，同一條線、檔案不重疊的票因此同時開工；`wait` 的票留在候選，下個派票點再判。跨線也判：兩條線
   同時改同一個檔，兩支總 PR 之間會衝突，延後派出讓同一處的改動不並行。跨線的票整併進各自的整合分支後就
   不再佔檔，總 PR 之間仍有的衝突由第 2 節的併入基底與人合併處理。
5. 從所屬線整合分支的最新尖端建立 `<run>/<NN>-<slug>` ticket 分支與 worktree。Local Markdown 的展開區塊
   已 commit 在整合分支上，ticket 分支從它之後切出。
6. 讀同層的 [`IMPLEMENTER.md`](IMPLEMENTER.md)，填好其中的佔位，以填好的全文為 prompt
   在背景 spawn 一個實作 agent，不另加規則。展開區塊的佔位取自該票驗收快照的 `expansions[].text`：GitHub
   的展開區塊在留言裡，票面全文裡沒有。它定義的**接續紀錄**是該票的唯一正本，其他位置只引用它。
   退回後重派的票：原 agent 還在就以 SendMessage 交給它退回紀錄與重建的 worktree，不新 spawn；不在了才照
   `IMPLEMENTER.md` 新 spawn，退回紀錄填進它的佔位。對帳表記下每張票的階段與負責 agent 的 id。

完成判準：每個派票點都先判過預算；每條該讀 CI 的線都讀了最新 SHA 的結果並記進 ledger，轉紅的線在綠燈或
撤回之前沒有派新票、整併佇列沒有前進，撤回的票與依賴它的已整併票都已從 `--done` 移出、對帳表改為卡住或缺口，
依賴它的在途票已標待裁決並寫明上游撤回；驗證未過的線之後沒有派票，它的候選都已標待裁決；每張派出的票在 spawn
實作 agent 之前都已有驗收項、驗收快照與預計檔案，展開補上的驗收項都出自展開 agent 並標明 `by`、`run`、`round`，
展開中的票沒有被重複送去展開；每個派票點每個 repo 都有 `overlap.mjs` 的計畫檔與輸出，`start` 的票全部派出，
派出的票與同 repo 任何一條線上在途的票沒有重疊；frontier 中每張票都已展開中或在途、在 `wait` 中有重疊理由，
或已列為待裁決；每個實作 agent 的 prompt 都是填好佔位的 `IMPLEMENTER.md` 全文。

### 收票

實作 agent 回報後，該票逐一完成下列關卡，不等同線或其他票。順序固定是**針對性檢查 → 一次獨立審查 → 集中
修正 → 按影響範圍複驗 → 整併**。全套交給 CI：每次整併後 push 整合分支，CI 在背景跑，主持人不等，下一個
派票點再讀結果。

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
4. **整併**：審查通過的票排進所屬線的**整併佇列**：一條線一次整併一張，照進佇列的順序；紅燈處置中的線
   佇列暫停（「讀 CI」）。輪到時階段改為整併中，在整合 worktree 以 `git merge --no-ff --no-edit <ticket 分支>`
   合併，一張票一個 merge commit，message 用 git 預設的 `Merge branch '<ticket 分支>'`：紅燈對票與收官的
   **逐票導覽**都靠它認出是哪張票。這個 merge 的第二親代範圍 `<merge>^1..<merge>^2` 就是這張票的 commit。
   有 conflict 時交給一個**整併 agent** 逐塊解：給它整合 worktree、兩邊的票面與 commit message，
   以及這條判準 —— 判的是兩個意圖而不是兩段文字，先追兩邊的 primary source（票面與 commit
   message），相容就都保留，不相容就取合乎本次合併目標的那邊，落地的行為限於某一邊實際寫過的。解法只留在
   這個 merge commit 裡（`git commit --no-edit` 收尾），不改寫 ticket 分支；`git show --remerge-diff <merge>`
   只顯示解法那部分。它逐塊回報取捨摘要，主持人把取捨記進自答清單。解完執行受影響範圍的針對性檢查；還要再改
   就在整合分支另做一個 commit，subject 不帶票 ID。整併 agent 回報無法安全解決時 `git merge --abort`，
   該票**退回重做**（下方），佇列換下一張。
5. **完成交付**：
   - **GitHub**：票保持 open，關票交給總 PR（第 2 節）；本票的摘要在它的 commit message 裡
     （`IMPLEMENTER.md` 第 2 節）。
   - **Local Markdown**：在整合分支的 ticket 檔勾選每項已驗證的 acceptance criterion（含展開區塊的），將
     `Status` 改為 `ready-for-human`，追加 `## sorry-matt completion`，列出 implementation
     commit、整合分支及通過的檢查，再 commit 這份交付紀錄。
6. **push**：有 `origin` 時 `git push -u origin <整合分支>`，兩種模式都是；Local Markdown 沒有 remote
   時略過，收官走第 2 節步驟 3 的本機驗證。每次整併各 push 一次，不攢幾張票一起推：紅燈要指得到是哪次整併。
   push 完不等 CI。
7. 移除 ticket worktree 與本地 ticket 分支。
8. **補派**：這次整併改變了 frontier 與在途的檔案，在這次喚醒的最後做一個派票點。

**退回重做。** 預計檔案猜錯，整併時才撞上別張票的改動。不硬解：該票從最新的整合分支重做。

1. **留紀錄**：以 `git update-ref refs/sorry-matt/<run>/<NN>-<slug>/sent-back-<k> <ticket 分支>` 留住舊嘗試
   （`<k>` 是第幾次退回）；該票接續紀錄加一段退回紀錄 —— 這個 ref 與 SHA、衝突的檔案、當時的整合分支 SHA、
   舊嘗試動到而預計檔案沒涵蓋的檔；ledger 對帳表該列的退回次數加一、階段改回候選。
2. **加寬預測**：把衝突的檔案與舊嘗試動到的檔補進該票的預計檔案。
3. 移除 ticket worktree，`git branch -D` 本地 ticket 分支 —— 內容已留在上面的 ref。
4. 下一個派票點照「派票」重派：沿用驗收快照，從整合分支最新尖端重建同名的分支與 worktree。舊嘗試只供
   參考，不合併。

一張票只退回一次：重做後整併仍衝突解不了，標卡住。

中途事項走 `ASKING.md` 第 4 節的三條出路。獨立執行而沒有裁決點時，答不出來的事累積到
下一個派票點前一次問完。

兩輪修正後仍未通過驗收，或退回重做後整併仍衝突解不了時，將票標為**卡住**：

- **GitHub**：另開 raw issue 記錄失敗，body 依 `ASKING.md` 第 6 節潤稿。
- **Local Markdown**：在整合分支的原 ticket 追加 `## sorry-matt blocker`，列出原因、已做嘗試
  與相關分支；將 `Status` 改為 `ready-for-human` 後 commit。

完成卡住紀錄後也移除 ticket worktree 與本地 ticket 分支。主持人在整合分支上的其他 commit（卡住紀錄、
期間開票）在那次喚醒結束前一併 push。

完成判準：每張回報的票都沒等其他票就進了收票；每張票都恰好經過一次獨立審查（`prove-it` 的 `initial`，開審前的
`stuck` 不算），每輪修正後各有一次 `recheck`，每次呼叫都附上當次對驗收快照的比對輸出，結論都寫進接續紀錄；
針對性檢查回到綠，並有通過驗收的模式原生交付，或有可追溯的卡住紀錄；加了專項 reviewer 的票都指名了風險；
每條線同一時間至多一張票在整併，紅燈處置中的線沒有整併佇列裡的票被整併；每次整併都是帶 git 預設 message 的
`--no-ff` merge commit，衝突解法只在 merge commit 裡，ticket 分支沒有被改寫；每次整併之後都做了派票點；
每張退回的票都有 `sent-back` ref、接續紀錄裡的退回紀錄、對帳表的退回次數與加寬的預計檔案，且至多退回一次；
每張票的接續紀錄都寫到最新；成功票已整併並清理 ticket worktree 與本地分支；有 `origin` 的線，每次整併都各
push 了一次，每次喚醒結束時 `origin/<整合分支>` 與本地整合分支同一個 SHA。

### 期間開票

範圍外的 bug、前置重構（prefactor）、技術債，以及偶發紅燈查出而根因落在範圍外的缺陷，
只建立 raw ticket，並連回來源 finding：

- **GitHub**：用 `gh issue create`，不加 `ready-for-agent`；body 依 `ASKING.md` 第 6 節潤稿。
- **Local Markdown**：依 tracker 慣例建立下一個未使用編號的 ticket 檔，將 `Status` 設為
  `needs-triage`，並 commit 到發現它的線整合分支。

這些 raw tickets 留在初始票集與本次 frontier 之外。

初始票集全數有完成交付時停止 loop。沒有展開中或在途的票、沒有線在紅燈處置中，也沒有可派的候選 —— 沒有
候選，或剩下的候選都在不可派的線上（驗證未過）—— 但仍有卡住或**待裁決**票時也停止。「預算與斷路」停下、
在途的票都收完時也停止。

完成判準：每張初始票恰好對帳為已交付、卡住或待裁決；期間新開的 raw tickets 均有來源連結，
且沒有混入凍結票集。

## 2. 收官

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
   步驟 4 的**整併 agent**，判準與「解法只留在這個 merge commit 裡」照用：一邊是這條線（各票票面與 commit message），另一邊是基底
   （`git log --format=%B <merge-base>..<併入的基底 ref>`），合併目標是讓線的意圖落在最新基底上。
   主持人把取捨記進自答清單。整併 agent 回報無法安全解決時 `git merge --abort`，這條線就是
   **未併入**：ledger 第 4 欄記嘗試併入的基底 SHA 與「未併入」，交付物與人工作業清單寫明衝突的
   檔案，交付一律留給人合併（見下方合併段）。
3. **完整驗證**：以整合分支最新 SHA 的 CI 為準。照收票步驟 6 push 步驟 1–2 之後的整合分支，依第 1 節
   「讀 CI」讀它。還在跑時，每個未完成的 run 各執行一次 `gh run watch <databaseId> --exit-status` 等它
   結束 —— 每個 run 一次阻塞呼叫，不逐次輪詢，執行環境能背景執行就背景執行。沒有 run 時稍後再讀一次。
   紅就走第 1 節的紅燈處置：流水線停止後沒有下一個派票點，所以每輪修完、push 後就在這裡再讀；撤回後
   同樣再讀；對不到票而兩輪仍紅，這條線就是**驗證未過**。

   **本機驗證**（本 skill 唯一的正本，其他地方引用這裡）：沒有 `origin`、這條線已定案為 CI 不涵蓋整合
   分支，或這個 SHA 讀不到結論（查詢失敗，或再讀一次仍沒有 run）時，改在這個 SHA 上本機跑一次 repo
   完整的自動檢查，報告寫明是哪一種。本機轉紅照紅燈處置第 4–6 點修，修完重跑。

   報告寫出驗證的 SHA、來源（CI 或本機與原因）與併入的基底 SHA；未併入的線照樣驗證未併入的樹，報告
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
  （含後來成為缺口的），帶 ticket 分支、票名、凍結時 frontier 輸出的 `blockedBy` 與接續紀錄的連結。腳本沿
  `git log --first-parent` 以 merge 的 message 認出每張票的 merge，票的 commit 就是 `<merge>^1..<merge>^2`；其他
  first-parent commit（精簡、併入基底、主持人 commit、對不到票的修正、撤回）是**線級 commit**。結束代碼 3 表示
  `missing` 裡的票在線上找不到 merge：照 ledger 核對它的分支名，修正計畫檔重跑；仍找不到就在該票那節寫明
  「commit 範圍對不到」，不猜範圍。

  Body 依輸出寫，順序固定：

  1. **審查門檻提醒**：`size.over` 為 true —— PR diff 的增刪合計（`git diff --shortstat <基底>...<線整合分支>`）
     超過門檻，預設 400 行，約是一次審得完的量 —— 時，body 第一段寫出行數與門檻，建議照逐票導覽按 commit
     範圍一張一張審，不要一次看整支 diff。
  2. **逐票導覽**：每張完成票一節，照 `tickets` 的 `order` —— 阻擋邊的拓撲序，被依賴的票先讀。每節寫：
     - 標題：順序、票號與票名；
     - commit 範圍：每個 merge 的 `compare` 連結，附 commit 數與 `stat`；紅燈修正的 `-ci` merge 另列一段；
     - 改了什麼：主持人彙整該票整併進線的全部 commit message，含集中修正的 commit：
       `git log --format=%B -E --grep='#N([^0-9]|$)' <基底分支>..<線整合分支>`；
     - 驗收證據：接續紀錄的連結；
     - `resolved` 為 true 的 merge 寫明含衝突解法並附它的 `remergeDiff` 指令；退回重做過的票註明退回次數；
     - 節末 `Closes #N`。
  3. **線級 commit**：`lineCommits` 逐項附連結與用途；含衝突解法的附 `remergeDiff` 指令。
  4. **缺口**：卡住與待裁決的票，不寫 `Closes`；在線上有 merge 的（上游撤回、被撤回）附它的 commit 範圍。

  總 PR body 依 `ASKING.md` 第 6 節潤稿，潤稿後門檻提醒、每個 commit 連結與每行 `Closes #N` 仍要在。
- **Local Markdown**：保留線整合分支供人審查與合併；記錄 branch name 與 tip SHA，再移除
  整合 worktree。票據狀態與實作一同留在該分支，不模擬 PR 或 close。

線交付完成後清理：呼叫 Skill tool 帶入 `clean-it-up`，照它的證據規則收掉本 run 產生的
ticket worktree 與已合併的本地分支。**待人審查的交付物不在清理範圍**：Local Markdown 的
線整合分支、以及尚未合併的總 PR 來源分支一律保留 —— 對未合併項目，`clean-it-up` 本身就是
降級為保留。遠端分支仍須使用者在本次明確授權，不為此另開提問。

GitHub 模式在總 PR 的 CI 轉綠後以 `gh pr merge` 送出合併；未併入或驗證未過的線不送，也不進 merge
queue，總 PR 留給人合併。它是確認呼叫，留到清理之後送出；放不放行由 Claude Code 的權限設定
決定，`bypassPermissions` 與 `auto` 模式下一律被 hook 擋下（`ASKING.md` 第 5 節）。放行就回報
合併結果；被擋下或被拒就維持交給人，輸出附上能放行它的權限規則片段，不為此另開提問。

**merge queue。** 送出前查基底分支有沒有啟用 merge queue：

```bash
gh api graphql -f query='query($owner:String!,$name:String!,$branch:String!){repository(owner:$owner,name:$name){mergeQueue(branch:$branch){url}}}' -f owner=<owner> -f name=<repo> -f branch=<基底分支>
```

`mergeQueue` 是 null 就是沒有啟用，照上一段，行為不變。啟用時合併改走 merge queue：同一個
`gh pr merge <PR>`，不帶合併策略也不帶 `--admin` —— gh 會把 PR 排進 queue，queue 把它與最新
基底、排在前面的 PR 組成 merge group 再驗一次才合併。放不放行同樣由權限設定決定，
`bypassPermissions` 與 `auto` 模式下同樣被 hook 擋下；用 `--admin` 跳過 queue，或用 GraphQL 的
`enqueuePullRequest` 排進 queue 而繞過 `gh pr merge` 的權限檢查，都一律被擋。

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
與**本 run 的計量與預算**（`ASKING.md` 第 7 節第 9 欄，停下時含停止原因）、需授權動作的結果（第 5 節），以及期間新開的 raw tickets
清單並請使用者執行 `/triage`。獨立執行時，輸出後把 ledger 第一行改成
`<!-- sorry-matt:run ended -->`；由 `have-it-all-done` 組合時不改，留給它的交棒。

完成判準：每條線都跑過一次線級精簡、一次併入基底與一次完整驗證，收在綠燈或標明驗證未過並留給人
合併；精簡的修法與併入基底各是自己的 commit，沒有混進票的 commit；總 PR body 有依 `review-guide.mjs` 輸出寫的
逐票導覽，每張完成票照阻擋邊的順序、有可點的 commit 範圍、摘要與接續紀錄連結，`size.over` 為 true 時開頭有
門檻提醒；完整驗證是已併入最新基底的整合分支最新 SHA 的 CI 結果，或在步驟 3 的本機驗證條件下同一 SHA 的
本機檢查且報告寫明原因，報告寫出驗證的 SHA 與基底 SHA；未併入的線寫明衝突檔案與嘗試的基底 SHA，在未併入的樹
上驗證，並留給人合併；每條線恰有一項可供人合併的交付，或已經權限設定放行而合併（基底啟用
merge queue 時走 queue）並回報；已合併的總 PR，其完成票都已關閉；留給人合併而關鍵字不生效的，
人工作業清單有關票指令；對帳表不重不漏地涵蓋凍結票集，每列都指向該票的接續紀錄；所有
ticket worktree 與本地 ticket 分支均已移除；Local Markdown 的整合 worktree 已移除而整合
分支仍保留；輸出已列出需授權動作的結果與本 run 的計量與預算；獨立執行時 ledger 第一行已是 ended 標記。
