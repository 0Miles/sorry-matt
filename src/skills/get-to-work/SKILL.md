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
5. 獨立執行時，照 `ASKING.md` 第 4 節以凍結票數改寫 ledger 第 9 欄的 `budget: spawns` 與 `budget: rounds`。
   由 `have-it-all-done` 組合時，它們在裁決點前已寫定，不改。
6. `docs/agents/commands.md` 不存在時，照 `ASKING.md` 第 0 節的產生規則產生它，在每條線的整合分支建立之後、
   派出任何票之前 commit 到該整合分支：subject 不帶票 ID，各線內容相同。不 commit 到使用者目前的分支。ticket
   分支從整合分支切出，實作 agent 的 worktree 因此讀得到。

**硬護欄**：執行期間新發現或新開的票只作為背景，初始票集一經凍結便不再擴張。

完成判準：已選定且驗證 tracker 模式；每張初始票都有發布出處、tracker
原生識別、所屬線與 blocker map；每條被他線佔用而排除的票都有佔用來源與解除條件；每條線
都有從同一基底尖端建立的整合分支及 worktree；獨立執行時 `budget: spawns` 與 `budget: rounds` 已依凍結票數
寫定；每條線的整合分支上都有 `docs/agents/commands.md`，原本沒有的已在派出任何票之前產生並 commit。

## 1. 用 `/loop` 推進流水線

每張可開工的票各走一條**流水線**：派票 → 實作 → 收票（審查、修正、整併）。票與票之間不分批、不互等：
**互斥**只看預計檔案是否重疊，不看是否同線，同一個 repo 裡跨線也判；一張票做完就收票，整併後立即重算
frontier 並補派。

每張票在對帳表有一個**階段**：候選 → 展開中（等展開 agent）→ 實作中 → 審查中 → 修正中 → 待整併（在整併佇列
裡等）→ 整併中 → 終局（已交付、卡住、待裁決）。**在途**指實作中到整併中；退回重做的票回到候選。恢復時
（`ASKING.md` 第 7 節）靠階段與負責 agent 的 id 接回每張沒到終局的票。

進入不帶間隔、可自我調速的 `/loop`，prompt 設為「get-to-work：重讀 `<ledger 絕對路徑>` 與它
第 10 欄列出的規則檔，再推進流水線」；沒有 ledger 時改為重讀本 skill 的 `SKILL.md` 與 `ASKING.md`
的絕對路徑。每次喚醒都帶著這句，恢復（`ASKING.md` 第 7 節）不靠記憶。

實作、展開、修正與整併 agent 一律在背景跑，各有**階段時限**；**在途 agent** 是對帳表裡到期時間不是 `—` 的
agent，含展開 agent 與紅燈修正的 agent（「時限」）。每次喚醒依序做：

1. 有線在紅燈處置中時，依「讀 CI」讀那條線。
2. 處理已回報的 agents：只收 agent id 與對帳表該票記的一致的回報；已被 `TaskStop` 或被改派取代的舊 agent
   回報時不收，在該票接續紀錄記一行（agent id、回報時間、已忽略）。實作或修正 agent 回報的票照「收票」往下走；
   展開或整併 agent 回報的，接回等它的那一步。
3. **時限掃描**：照「時限」處理超時的在途 agent。
4. 依各線的**整併佇列**整併審查通過的票（收票步驟 4–8）。
5. 有**派票點**觸發時，在最後做一次（「派票」）。
6. 把 ledger 寫到最新。沒有批次的邊界：每次喚醒的結尾就是交接點。
7. 還有在途 agent 時排 **fallback 喚醒**（「時限」），才結束這次喚醒。

### 讀 CI

派票點與收官都以**整合分支最新 SHA 的 CI 結果**為準；有線在紅燈處置中時，每次喚醒也讀那條線。最新 SHA 是
`git rev-parse origin/<整合分支>`；它和本地整合分支不同時，先照收票步驟 6 push 再讀（從未 push 過、
或已定案為 CI 不涵蓋整合分支的線不讀）：

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
  `stale`。走 [`RED-LIGHT.md`](RED-LIGHT.md) 的紅燈處置。
- **還在跑**：有 run 的 `status` 不是 `completed`。不等、不輪詢，下一次讀那時的最新 SHA —— 每個 run
  都跑全套，較新的 SHA 涵蓋較舊的。
- **被取消**：有 run 是 `cancelled`。`gh run rerun <databaseId>`，當成還在跑。
- **綠**：其餘 —— 每個 run 都 `completed`，`conclusion` 都是 `success`、`skipped` 或 `neutral`。

**本機驗證的線。** 流水線中，沒有 `origin` 或已定案為 CI 不涵蓋整合分支的線不讀 CI：在原本要讀 CI 的
時刻 —— 派票點；該線在紅燈處置中時的每次喚醒 —— 改對整合分支最新 SHA（`git rev-parse <整合分支>`）照下方的
「本機驗證」跑一次並記錄。本機驗證紅的線與 CI 紅的線同樣處理，走 `RED-LIGHT.md` 的紅燈處置。

**本機驗證**（本 skill 唯一的正本，其他地方引用這裡）：沒有 `origin`、這條線已定案為 CI 不涵蓋整合
分支，或這個 SHA 讀不到結論（查詢失敗，或再讀一次仍沒有 run）時，改在這個 SHA 上本機跑一次 repo
完整的自動檢查，報告寫明是哪一種。repo 完整的自動檢查，在這個 SHA 的樹有 `docs/agents/commands.md` 時就是它的
「Full checks」，逐條照跑；沒有時照現況自己從 manifest 與 CI 設定找。完整驗證的報告在來源旁寫明指令取自
`commands.md` 或自行找到（`self-found`）。在整合 worktree、樹正是這個 SHA 時跑：收官時整併 agent 還在
解 conflict 就等它結束；流水線的派票點或喚醒遇到整合 worktree 的樹不是這個 SHA（整併進行中）時不等，這次
不驗，這條線沿用上一次的結果 —— 不在紅燈處置中就照常派票 —— 由該次整併觸發的派票點驗那時的最新 SHA。前兩種線在流水線中就照第 1 節「讀 CI」逐 SHA 驗證，不只在收官。

**每次本機驗證都在 ledger 第 4 欄為該線追加一筆本機驗證逐 SHA 紀錄**，一行：
`local: <整合分支> <完整 SHA> <green 或 red> <原因>` —— 行首的 `local:` 表明來源是本機，原因是 `no-origin`、
`ci-not-covering` 或 `no-verdict`（上面三種條件）。一個 SHA 一筆，新紀錄不覆蓋舊紀錄；已有紀錄的 SHA 不重跑，
沿用那筆結果。跑的時候把輸出存檔（`RED-LIGHT.md` 紅燈處置第 3 點）。本機轉紅走 `RED-LIGHT.md` 完整的紅燈處置（第 1–6 點），每輪
修完在新 SHA 上本機重跑。

**紅燈處置**在同層的 [`RED-LIGHT.md`](RED-LIGHT.md)：有線轉紅，或有線在紅燈處置中時，走到這裡時全文讀取並照做。

完成判準：每條該讀 CI 的線都讀了最新 SHA 的結果並記進 ledger；本機驗證的線每個驗過的 SHA 都有 ledger 第 4 欄的
紀錄，有 CI 的線上 `no-verdict` 的本機驗證也一樣。

### 預算與斷路

上限與用量都在 ledger 第 9 欄（`ASKING.md` 第 7 節）。用量在兩個時點更新：每個派票點的第一件事（下列三步），
與每張票收票結束把 ledger 寫到最新時（只做步驟 1；進展與上限只在派票點判）。

1. **更新用量**：照 `ASKING.md` 第 7 節第 9 欄更新 spawn 數與經過時間（開始時間的記法也在那裡）。
2. **判進展**：「一次」是一個派票點。等 agents 的喚醒、只推進收票的喚醒都不算。比對上個派票點記下的進度
   快照 —— 每條線整合分支的 tip SHA，與對帳表中已到終局（已交付、卡住、待裁決）的票：兩者都沒變，連續
   無進展次數加一；任何一項變了就歸零。票在終局之前的階段之間移動，或被退回重做，都不算
   進展；ticket 分支上的 commit 也不算：沒整併的嘗試沒有改變任何交付。然後把這次的快照記進第 9 欄；第一個
   派票點只記快照。
3. **判上限**：派票點次數達到 `rounds`、spawn 數達到 `spawns`、經過時間達到 `hours`，或連續無進展
   次數達到 `no-progress`，就**停下**。沒停下才把派票點次數加一，往下派票。

**停下**：這個派票點不派票、不展開，之後也不再有派票點。在途的票照「收票」收到整併、卡住或退回為止，讀 CI
與紅燈處置（`RED-LIGHT.md`）照常；退回的票不再派。凍結票集中沒派過的（含展開中的）、退回後等重派的、spawn 被擋下的票標**待裁決**，原因寫
停在哪個上限與當時的用量。第 9 欄記停止原因；無進展斷路時寫出最近這幾個派票點裡，每張未交付的票停在哪一步、
在等什麼，並指向它的接續紀錄。之後照「期間開票」末段的停止條件收尾。

派票或收票中途，spawn 被 plugin 的 hook 以預算為由擋下：不重試、不換路。已派出的 agents 照常收票；沒派出的
票，與收票缺了那個 agent 就走不下去的票，照上一段標待裁決；下一個派票點在步驟 3 停下。收官的步驟需要 spawn
而被擋下，照 `ASKING.md` 第 4 節記進人工作業清單。

完成判準：每個派票點都先更新了第 9 欄的用量、判過進展與四個上限，每張票收票結束都更新了用量；停下之後
沒有再派票，未交付的票都已標待裁決並寫出停在哪個上限，第 9 欄有停止原因；被預算擋下的 spawn 沒有重試或換路。

### 時限

Claude Code 不能給 subagent 設時限，所以由主持人在每次喚醒時掃描。**派送**是把工作交給一個背景 agent：spawn
實作、展開或整併 agent，或以 SendMessage 把集中修正、紅燈修正、退回紀錄交回原 agent；紅燈對不到票時交給 agent
做的修正也算。`prove-it` 的 finder、verifier 與 Fix Verifier 以前景派送（`prove-it` 第 2 節），在主持人自己的
回合裡跑完才回來，主持人等的期間不會被喚醒，所以審查不設時限。

**階段時限**是 ledger 第 9 欄的四行 `budget:`，單位分鐘（`ASKING.md` 第 7 節）：`timeout-implement`（實作中）、
`timeout-fix`（修正中，含紅燈修正）、`timeout-expand`（展開中）、`timeout-merge`（整併中的整併 agent）。

**派送紀錄**：每次派送時在對帳表該票那一列記下（一個展開 agent 負責的每張票都記）：

- agent id、派送時間、階段時限與到期時間。時間一律 UTC，寫成 `date -u +%Y-%m-%dT%H:%M:%SZ` 的格式，到期時間 =
  派送時間 + 階段時限；同格式的時間可以直接按字串比大小。延長記 `no`。
- **進度指紋**：agent 工作的 worktree 的 HEAD 與工作樹的 tree。實作與修正是 ticket worktree（紅燈修正是 `-ci`
  分支的 worktree；對不到票的是整合 worktree），整併是整合 worktree。一律以 Bash 執行 —— PowerShell 的管線與
  編碼會讓同一棵樹算出不同的結果：

  ```bash
  git -C <worktree> rev-parse HEAD
  idx="$(git -C <worktree> rev-parse --path-format=absolute --git-path sorry-matt-fingerprint.index)"
  cp "$(git -C <worktree> rev-parse --path-format=absolute --git-path index)" "$idx" \
    && GIT_INDEX_FILE="$idx" git -C <worktree> add -A 2>/dev/null \
    && GIT_INDEX_FILE="$idx" git -C <worktree> write-tree
  rm -f "$idx"
  ```

  第二段在一份暫存 index 裡把整個工作樹（含未追蹤檔，不含 ignored）寫成一棵 tree，輸出它的 hash；真正的 index
  不動。未追蹤檔改內容、新檔放進未追蹤的目錄、已暫存的檔再改，都會讓它不同。展開 agent 不在 worktree 裡工作，
  改記它負責的每張票以 `acceptance.mjs` 讀出的 `expansions` 數。

agent 回報或被停下後，那一列的到期時間改為 `—`。**在途 agent** 就是到期時間不是 `—` 的 agent。

**時限掃描**：每次喚醒 —— `/loop` 的喚醒、agent 通知、fallback 喚醒都算 —— 在處理完已回報的 agents 之後做。
取現在時間（同上格式），到期時間早於它的在途 agent 就是**超時**。對每個超時的 agent：
照同層的 [`TIMEOUTS.md`](TIMEOUTS.md) 處置 —— 判進展、延長、停下後的各分支、留紀錄；時限掃描發現超時的 agent 時，走到這裡時全文讀取並照做。

**fallback 喚醒**：每次喚醒結束時還有在途 agent，就以最早的到期時間排下一次喚醒；所有 agent 都不回報時，主持人
也會在第一個時限到期時醒來。派送過的喚醒結束時一定有在途 agent，所以每次派送之後都排了一次。延遲是最早的到期
時間減現在，換成秒：

- **`ScheduleWakeup`**（第 1 節進入的 `/loop` 動態模式可用）：延遲只能在 60–3600 秒之間。不到 60 秒排 60；超過
  3600 秒排 3600，醒來沒有超時就照這一段再排一次。
- 沒有 `ScheduleWakeup`：以 Bash 在背景執行 `sleep <秒>`（不設上限），把它的 task id 記進 ledger 第 9 欄。同一時間
  只留一個：排新的之前，先以 `TaskStop` 停掉第 9 欄記的上一個（已結束就略過）。它結束時的通知就是喚醒，第一件事
  照 `ASKING.md` 第 7 節的恢復重讀 ledger 與規則檔，再照第 1 節的喚醒步驟做。
- 背景 `sleep` 也不能用：以 interval 模式重新進入第 1 節的 `/loop`，prompt 不變，間隔取最短的階段時限。沒有在途
  agent、run 也已照「期間開票」末段的停止條件停止時，結束這個 interval loop。

沒有在途 agent 時照 `/loop` 本來的自我調速。

完成判準：每次派送都在對帳表留下派送紀錄（agent id、派送時間、階段時限、到期時間與進度指紋）；每次喚醒都在
處理回報之後掃描了每個在途 agent，含展開與紅燈修正的；舊 agent 的回報沒有被收；每次喚醒結束時還有在途 agent 就排了 fallback 喚醒，背景 `sleep` 同一時間至多一個。

### 派票

**派票點**在這些時刻觸發，在那次喚醒的最後做一次，一次喚醒至多一個：第一次喚醒；有票整併進整合分支或被
撤回；有票離開流水線（卡住、待裁決、退回重做）；轉紅的線回到綠燈或判為驗證未過；展開 agent 回報。其他
喚醒不派票。

每個派票點先照「預算與斷路」判上限；沒停下，再依「讀 CI」讀各線。轉紅的
線走紅燈處置（`RED-LIGHT.md`），在綠燈或撤回之前不派新票；其他結果照常派票。

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
的候選標待裁決（`RED-LIGHT.md` 紅燈處置第 6 點），不往下派。補驗收項的不能是要通過它的人，所以實作 agent 只讀
驗收項、不寫也不改。對每張候選票依序：

1. **驗收**：以本 skill 的 `scripts/acceptance.mjs` 讀出該票的驗收項與出處，不自己讀票面判斷：

   ```bash
   node "${CLAUDE_SKILL_DIR}/scripts/acceptance.mjs" github --repo <owner>/<repo> <n>
   node "${CLAUDE_SKILL_DIR}/scripts/acceptance.mjs" local --ref <該線整合分支> <票檔路徑>
   ```

   輸出格式寫在腳本檔頭。`needsExpansion` 為 true 的票（一項驗收都沒有，常見於延到進 frontier
   才完整展開的票）交給**展開 agent**：讀同層的 [`EXPANDER.md`](EXPANDER.md)，把這個派票點所有這類票
   填進佔位，以填好的全文在背景 spawn 一個展開 agent，不另加規則。Agent tool 的 `subagent_type` 是
   `sorry-matt:expander` —— plugin 的 agent 定義檔 `agents/expander.md`，展開 agent 的模型與可用工具由它定，主持人
   不另外指定。這個 agent 類型不在可用清單時改用通用 agent、不指定模型，prompt 相同。它在 tracker 寫下標明 `by`、`run`、
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
   加寬（`SEND-BACK.md`）。
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
   的展開區塊在留言裡，票面全文裡沒有。專案指令契約的佔位填 ticket worktree 裡 `docs/agents/commands.md` 的絕對
   路徑，那裡沒有這份檔就填 none。它定義的**接續紀錄**是該票的唯一正本，其他位置只引用它。
   退回後重派的票：原 agent 還在就以 SendMessage 交給它退回紀錄與重建的 worktree，不新 spawn；不在了才照
   `IMPLEMENTER.md` 新 spawn，退回紀錄填進它的佔位。對帳表記下每張票的階段與負責 agent 的 id，以及「時限」的
   派送紀錄。

完成判準：每個派票點都先照「預算與斷路」判過上限、再照「讀 CI」讀過該讀的線，才往下派；每張派出的票在 spawn
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
   接續紀錄。`pass` 進整併，`fix` 進集中修正，`stuck` 依它寫的解除條件排除後，照 `prove-it` 第 5 節
   重新呼叫；排除不了就標卡住（`SEND-BACK.md`）。**一張票預設只有這一位 reviewer**，規範與需求符合性由它的 lens 同時涵蓋。
   只有具體風險需要時才加專項 reviewer，而且要指名是哪個風險、理由記進自答清單；
   「再看一遍比較保險」不是風險。
3. **集中修正**：本票的 finding 一次全部交回保有 context 的原 agent，一輪修完，不逐則來回。
   修完重跑受影響範圍的針對性檢查與驗收比對，再呼叫 Skill tool 帶入 `prove-it`，模式 `recheck`，
   附上一次的審查區塊與新的比對輸出：它只對 finding 涉及的行重跑實跑與突變，不是第二次審查。最多兩輪修正；
   兩輪後仍未通過就標卡住（`SEND-BACK.md`）。

   **硬護欄 —— 偶發紅燈一律查到根因。** 測試在同一個 commit 上時紅時綠，當真實失敗
   處理：查出根因，落在測試寫法就修測試，落在產品就修產品或登記缺陷票。重跑、放寬等待、
   加 retry 與調大 timeout 都不算修好。兩輪修正內查不出根因就標卡住（`SEND-BACK.md`）。
4. **整併**：審查通過的票排進所屬線的**整併佇列**：一條線一次整併一張，照進佇列的順序；紅燈處置中的線
   佇列暫停（`RED-LIGHT.md`）。輪到時階段改為整併中，在整合 worktree 以 `git merge --no-ff --no-edit <ticket 分支>`
   合併，一張票一個 merge commit，message 用 git 預設的 `Merge branch '<ticket 分支>'`。merge 完成後把它的 SHA
   （`git rev-parse HEAD`）記進 ledger 對帳表該票的 merge SHA，紅燈修正的 `-ci` merge 也記：紅燈對票與收官（`FINISH.md`）的
   **逐票導覽**都以它為準，subject 只是沒記 SHA 時的退路。這個 merge 的第二親代範圍 `<merge>^1..<merge>^2` 就是
   這張票的 commit。
   有 conflict 時交給一個**整併 agent** 逐塊解：給它整合 worktree、兩邊的票面與 commit message，
   以及這條判準 —— 判的是兩個意圖而不是兩段文字，先追兩邊的 primary source（票面與 commit
   message），相容就都保留，不相容就取合乎本次合併目標的那邊，落地的行為限於某一邊實際寫過的。解法只留在
   這個 merge commit 裡（`git commit --no-edit` 收尾），不改寫 ticket 分支；本機的
   `git show --remerge-diff <merge>`（git 2.36 以上）只顯示解法那部分，GitHub 網頁看不到。它逐塊回報取捨摘要，主持人把取捨記進自答清單。解完執行受影響範圍的針對性檢查；還要再改
   就在整合分支另做一個 commit，subject 不帶票 ID。整併 agent 回報無法安全解決時 `git merge --abort`，
   該票**退回重做**（`SEND-BACK.md`），佇列換下一張。
5. **完成交付**：
   - **GitHub**：票保持 open，關票交給總 PR（第 2 節）；本票的摘要在它的 commit message 裡
     （`IMPLEMENTER.md` 第 2 節）。
   - **Local Markdown**：在整合分支的 ticket 檔勾選每項已驗證的 acceptance criterion（含展開區塊的），將
     `Status` 改為 `ready-for-human`，追加 `## sorry-matt completion`，列出 implementation
     commit、整合分支及通過的檢查，再 commit 這份交付紀錄。
6. **push**：有 `origin` 時 `git push -u origin <整合分支>`，兩種模式都是；Local Markdown 沒有 remote
   時略過，收官走「讀 CI」的本機驗證。每次整併各 push 一次，不攢幾張票一起推：紅燈要指得到是哪次整併。
   push 完不等 CI。
7. 移除 ticket worktree 與本地 ticket 分支。
8. **補派**：這次整併改變了 frontier 與在途的檔案，在這次喚醒的最後做一個派票點。

**退回重做**與**標卡住**在同層的 [`SEND-BACK.md`](SEND-BACK.md)：要退回重做或標卡住時，走到這裡時全文讀取並照做。

中途事項走 `ASKING.md` 第 4 節的三條出路。獨立執行而沒有裁決點時，答不出來的事累積到
下一個派票點前一次問完。

完成判準：每張回報的票都沒等其他票就進了收票；每張票都恰好經過一次獨立審查（`prove-it` 的 `initial`，開審前的
`stuck` 不算），每輪修正後各有一次 `recheck`，每次呼叫都附上當次對驗收快照的比對輸出，結論都寫進接續紀錄；
針對性檢查回到綠，並有通過驗收的模式原生交付，或有可追溯的卡住紀錄；加了專項 reviewer 的票都指名了風險；
每條線同一時間至多一張票在整併，紅燈處置中的線沒有整併佇列裡的票被整併；每次整併都是帶 git 預設 message 的
`--no-ff` merge commit，SHA 記進了對帳表，衝突解法只在 merge commit 裡，ticket 分支沒有被改寫；每次整併之後都做了派票點；
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

流水線停止後進入收官。線級的三道關、交付、清理、合併、merge queue、關票與最終輸出在同層的 [`FINISH.md`](FINISH.md)：走到這裡時全文讀取並照做。
