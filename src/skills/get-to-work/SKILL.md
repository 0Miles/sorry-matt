---
name: get-to-work
description: 以逐票流水線清空一組已開好的 tickets：可開工且檔案不重疊的票同時實作，做完一張就審查與整併；GitHub 上每張票一支 PR（依賴單一上游的以 gh stack 疊起），審查過、CI 綠就合併，Local Markdown 每條線交付一條本地整合分支
disable-model-invocation: true
---

# get-to-work：把已開好的 tickets 全部完成

確定性的流程 —— 依賴圖、階段轉移、CI、時限、重試、預算、git 指令序列與冪等 —— 都在本 skill 的
`scripts/`（`${CLAUDE_SKILL_DIR}` 是本 skill 載入時標示的 base directory）。**每支腳本的檔頭是它的契約與正本**；
本檔只寫腳本做不到的事：什麼時候呼叫、哪些要你判斷、哪些要人裁。

## 0. 開始或恢復

以 base directory 為起點，讀同層的 [`../have-it-all-done/ASKING.md`](../have-it-all-done/ASKING.md) 全文，依它
第 0 節開場；它是共用契約，全程適用。由 `have-it-all-done` 組合時沿用它的 run ledger；獨立執行時依
`ASKING.md` 第 7 節自建或接手，第 10 欄要有本 skill 的 `SKILL.md` 與 `ASKING.md` 的絕對路徑。run 的機器狀態是
ledger 旁的 `<run>.state.json`，只經由腳本寫，不手改；schema 與階段規則在 `scripts/state.mjs` 的檔頭。

**恢復**：state 檔已存在就不重新凍結。照 `ASKING.md` 第 7 節重讀之後，以 `state.mjs resume <state>` 看每張票停在
哪裡，進第 1 節。

**凍結**（新 run）。工作區含多個 repo 時每個 repo 各開一個 run：線不跨 repo。

1. **初始票集**：引數指定的 tickets（編號、URL 或本地檔案路徑）；沒有引數時只收本 session 有發布紀錄的
   tickets，Local Markdown 的發布路徑也算。都沒有就向使用者索取清單。
2. 對它跑 `scripts/frontier.mjs`，blocker **邊**與**線**取輸出，不自己讀票面推。
3. 為每張票寫預計檔案（第 2 節「預計檔案」）。
4. 寫計畫檔跑 `scripts/freeze.mjs`：前置檢查、他線佔用、排除、**合線**與候選順序都由它算。`preflight.ok` 是
   false 就照 `checks` 修好重跑；腳本看不到的佔用（本 session 已知的其他 session）寫進計畫檔的 `held`。
   `excluded` 的票標**待裁決**，寫出佔用來源與解除條件。計畫檔的 `base` 寫線要併入的基底分支（必填）；`integrate`
   寫本 run 的 `integrate`（第 6 步要寫的 profile，沒另寫就是 tracker 的預設：GitHub 是 `ticket-pr`）—— 缺了 freeze
   以 `aggregate-pr` 判，`ticket-pr` 的 default-branch、tracker 與 gh-stack 檢查都不會跑（#202）。
   **基底 CI**：`base-ci` 這項讀基底最新 SHA 的 CI，不擋下凍結。CI 來自 git remote，與票放在哪無關：Local Markdown
   也讀（`gh` 在 repo 裡由 remote 認出 GitHub repo）；repo 沒有 `origin` 時沒有 CI 可讀，`ci` 是 null，不是警告。
   `warning` 是 true（基底紅，或 CI 讀不到）時：
   - 由 `have-it-all-done` 組合時照 ledger 第 2 欄裁決點的選擇走；第 2 欄沒有這題（裁決點時基底不紅）就代答
     「繼續」，記進自答清單。
   - 獨立執行時，紅就列一題「繼續，或先修基底」（`ASKING.md` 第 2 節 (a)，建議「繼續」，寫明每條線的
     CI 都會帶著這個紅）。第 5 步要問合併授權時，延到第 5 步和它合成一次問；第 5 步不問（`integrate` 不是
     `ticket-pr`，或權限設定已涵蓋）就在這裡問。答案記進 ledger 第 2 欄；讀不到就代答「繼續」，連同
     錯誤訊息記進自答清單。
   - 「先修基底」：不凍結。基底的紅燈（分支、SHA、`ci.failed` 的 run id）進人工作業清單，初始票全數標待裁決，
     解除條件是基底轉綠。「繼續」：基底帶進來的紅由紅燈處置判為對不到票（[`RED-LIGHT.md`](RED-LIGHT.md) 第 2 點）。
   - **合票**（#205）：輸出的 `bundleCandidates` 是同一條線上、預計檔案重疊而連在一起的票。逐組依第 2 節「合票」
     的判準決定合不合、合哪幾張，寫進計畫檔的 `bundles`（每組一個票號陣列），重跑 `freeze.mjs`：不合格的組以 2
     結束並寫明原因，照它改。決定與理由記進自答清單，不問使用者。
5. **合併授權**：只在本 run 的 `integrate` 是 `ticket-pr` 時做（第 6 步要寫的 profile；沒另寫就是 `state.mjs`
   檔頭依 tracker 給的預設）。`ticket-pr` 下合併預設視為授權，授權在開局就拿到，不等到收官才被擋。
   - **讀設定**：讀權限設定 —— `~/.claude/settings.json`、repo 的 `.claude/settings.json` 與
     `.claude/settings.local.json` —— 的 `permissions.allow`，看它涵不涵蓋 `gh pr merge` 與 `gh stack merge` 兩條
     指令。`Bash(...)` 與 `PowerShell(...)` 兩種寫法都讀，以主持人送合併時用的那個 shell 的寫法判定；兩條都有
     allow 規則涵蓋、且沒有同指令的 `ask` 或 `deny` 規則，就是**常設授權**，不問。讀設定只決定要不要問：合併送不送，
     仍由權限設定在確認呼叫時決定（`ASKING.md` 第 5 節，agent 不判斷授權）。
   - **沒涵蓋**：獨立執行時只問一次「本 run 凍結的這串票，每張票的 PR 審查過、CI 綠了，可以由我送出合併
     （`gh pr merge`，疊在 `gh stack` 裡的用 `gh stack merge`）嗎」，建議「可以」，附上 `ASKING.md` 第 5 節
     「以後都這樣」的權限規則片段，說明加進設定之後的 run 就不再問。這題照 `ASKING.md` 第 1 節的提問前置檢查，
     並和凍結的其他問題（第 4 步基底 CI 那題）合成一次提問，一次問完。由 `have-it-all-done` 組合時不問：照
     ledger 第 5 欄裁決點記下的結果走；第 5 欄沒有這題，就依「拒絕」處理，記進自答清單。
   - **同意**：算「使用者本 run 指示合併」（`ASKING.md` 第 5 節），記進 ledger 第 5 欄（題目、答案與時間）。
     **拒絕或沒回應**：也記進 ledger 第 5 欄；PR 照常開、照常疊，但合併一律留給人，不送合併指令。
6. `state.mjs init --run <run> --tracker github|local`（`integrate` 的預設依它：GitHub 是 `ticket-pr`，Local Markdown
   是 `aggregate-pr`）；這個 run 要放寬流程時，在這裡以 `state.mjs profile` 寫一次（`ASKING.md` 第 4 節；組合時
   沿用裁決點寫好的）。`state.mjs add` 每條線的票、`state.mjs line --lines` 記合線，對 `freeze.mjs` 輸出的每個
   `bundles` 跑 `state.mjs bundle <state> <lead> <其餘的票>...`，再對每條線跑 `scripts/integrate.mjs line-init`。
7. `docs/agents/commands.md` 不存在時照 `ASKING.md` 第 0 節的產生規則產生，在每條線的整合分支上 commit
   （subject 不帶票 ID），不 commit 到使用者目前的分支。
8. 獨立執行時，照 `ASKING.md` 第 4 節以凍結票數改寫 ledger 第 9 欄的 `budget: spawns` 與 `budget: rounds`。
9. `tick.mjs setup`，再跑 `state.mjs check <state> freeze --base <基底>`。gate 以 4 結束時照輸出列的每一項補齊
   再跑，過了才進第 1 節。

**硬護欄**：初始票集一經凍結便不再擴張；執行期間新發現或新開的票只作為背景。

完成判準：已選定且驗證 tracker 模式；每張初始票有發布出處、tracker 原生識別與 blocker map；被排除的票都有
佔用來源與解除條件；每組 `bundleCandidates` 的合或不合都在自答清單上，合了的都已 `state.mjs bundle`；`base-ci` 的警告已有裁決點的選擇、使用者的答案或代答紀錄；`integrate` 是 `ticket-pr` 且權限設定沒涵蓋兩條合併
指令時，ledger 第 5 欄有合併授權的結果（同意、拒絕或沒回應），獨立執行時凍結期間的提問合成了一次；`check freeze` 通過；獨立執行時
兩行 `budget:` 已依凍結票數寫定。

## 1. 用 tick 推進流水線

每張可開工的票各走一條**流水線**：派票 → 實作 → 收票（審查、修正、整併）。票與票不分批、不互等。誰現在該做
什麼、一次喚醒的順序與派票點何時觸發，都由 `scripts/tick.mjs` 算（檔頭）。

進入不帶間隔、可自我調速的 `/loop`，prompt 設為「get-to-work：重讀 `<ledger 絕對路徑>` 與它第 10 欄列出的
規則檔，再以 tick 推進流水線」；沒有 ledger 時改為重讀本 skill 的 `SKILL.md` 與 `ASKING.md` 的絕對路徑。每次
喚醒都帶著這句，恢復不靠記憶。

每次喚醒：

1. `node "${CLAUDE_SKILL_DIR}/scripts/tick.mjs" run <state>`，每個送來完成通知的 agent 加一個
   `--reported <agent id>`。收不收它的回報由 tick 判。`run` 反覆跑 `next`，把每份清單 batch 1 的 exec 依序在 bash
   跑完並 record，直到 batch 1 還剩 spawn、judge、ask 或留給你的 exec，或 `then` 是 `end`／`done`。留給你的 exec
   是 tick 標了 `host` 的：推到受保護分支（main、master 或 run 的基底分支）的 push，其他都由 `run` 代跑。輸出是
   剩下的清單，`ran` 列出它跑過的 exec（id、結束代碼、錯誤輸出的 log 檔；被訊號殺掉的另有 `signal`，結束代碼記成
   128 加訊號編號，不算正常結束），`lists` 依序列出它做過的每份清單的 `reports`、`reconcile`、`dispatch`、`wrote`
   與從那份清單跑的 exec：較早清單收下的回報、對帳與寫出的檔都從這裡讀，不只看最後一份。`run` 以 1 結束、訊息說
   bash 不能用時，這次喚醒改跑 `next`，exec 自己照抄 `command`。

   Bash tool 把 `run` 移到背景時，等它結束、讀到它的輸出，才處理清單。**背景化的 `run` 結束前不可再開一個**
   `run`，也不跑 `next` 或 `record`：兩者會搶寫同一份 state 檔。

   `run` 非零結束時，stdout 仍是 JSON：`ran` 與 `lists` 是停下前已跑且已記錄的，`blocked` 是它停在哪個 exec
   （停在 `next` 時是 null）。`blocked.at` 是 `execute` 時那個 exec 沒跑完、什麼都沒記；是 `record` 時它已經跑過
   （結束代碼是 `blocked.exit`，副作用已發生），記錄失敗。tick 在記錄前就記下它跑過，之後的 `run` 只補記、不重跑
   （state 檔整個寫不進去時記不下來）。這次 `run` 交出的清單沒送到你手上，裡面 batch 1 的 spawn 不算已發出，之後
   照常發下。`run` 以 **3** 結束是 `blocked` 的 record 被拒：
   - 不手改 state。照 `error` 的訊息處理拒絕的原因，和 `record` 被拒時一樣，不換一種寫法硬寫。
   - 處理好後再跑 `run`：它以 `blocked.exit` 補記 `blocked`，不再跑一次（`error` 說它已經記錄過時，沒有要補記的）。
   - 處理不了的拒絕是裁決點，照第 3 節問。

   輸出的 `do` 也寫著這段處置。
2. 照 `actions` 做，但一份清單只送出 `batch` 為 1 的動作，在同一回合一起送出。每做完一個就跑它 `record` 欄的
   指令。較後的 batch 這次不做：前面的動作 record 後，它們會在之後的清單再發下來（tick 只把 batch 1 的背景 spawn
   當成已發出）。沒做的不記，不做沒發下來的事。`reference` 是這個動作要讀的段落。
   - **exec**：`run` 已代跑。留在清單裡的 exec 帶 `host`（推到受保護分支），用你自己的 Bash tool 跑，讓使用者的權限設定看得到：在 bash
     （Windows 是 Git Bash）照抄 `command`，以結束代碼 record。帶 `ran` 的 exec 已經跑過、只是沒記成：不再跑，
     照 `note` 處理後跑它 `record` 欄的指令（已帶結束代碼）。不在 `okExit` 的結束代碼會在下一份清單變成要你處理的 `failed`
     judge，`run` 跑的 exec 由它的 `do` 指名 log 檔。
   - **spawn**：Agent tool 照 `spawn` 欄原樣送出，不另加規則：實作與展開 agent 的固定規則在 plugin 的 agent 定義檔
     （`sorry-matt:implementer`、`sorry-matt:expander`），派工檔的值已由 `scripts/brief.mjs` 填好，`description` 的
     規則在它的檔頭。`subagent_type` 不在可用清單時改送 `fallback` 欄的通用 agent 與 prompt（定義檔本文接上同樣的
     值），不指定模型，`description` 不變，record 加 `--type general-purpose`。
   - **judge**：要你判斷的事。讀 `reference`，做 `do` 寫的事，以 `outcomes` 之一 record。
   - **ask**：只有人能裁的事，照第 3 節。
3. batch 1 的動作都 record 完，就再跑 `run`，直到 `then` 是 `end` 或 `done`。同一批的結果用**一條**指令記：各動作
   `record` 欄的指令只留第一個的 `node tick.mjs record <state>`，其餘接在後面以 ` + <動作 id> <旗標>` 串起，再以
   `&&` 接下一次 `run`，一次 Bash 呼叫做完（主持人的每次呼叫都要把整段 context 再讀一次）。中間有一筆被拒時，它之後的都沒記，
   輸出的 `failed` 指出是哪一筆；照拒絕的訊息處理後，從那一筆重記。`end` 的最後一個動作收尾這次喚醒：ledger 的敘事欄寫到最新，
   有任何背景工作在跑 —— 在途 agent，或主持人自己在背景跑的命令 —— 就排 **fallback 喚醒** —— 有 `ScheduleWakeup`
   就用它，否則以 Bash 在背景跑 `sleep`，task id 記進 record；兩者都不能用時，以 interval 模式重新進入同一個
   `/loop`，間隔取最短的階段時限。只剩主持人自己的命令時 tick 不給等待秒數，最多等 `budget: wake-check` 分鐘。
   `done` 是 run 已收官。
   **主持人自己在背景跑的長命令**（例如收尾時自己重跑的全量測試）比照 `verify.mjs` 的 check：輸出導進一個 log 檔，
   以 `budget: timeout-verify`（沒寫就是 30 分鐘）為上限，另加 10 分鐘的輸出閒置 watchdog。不能只靠完成通知：
   掛住的命令不會有通知。每次喚醒都看它的 log 有沒有繼續長；超過上限或閒置 10 分鐘，就殺掉整棵程序樹（Windows
   `taskkill /PID <pid> /T /F`，其他平台殺它的程序群組），在 ledger 記成 timeout，附命令與 log 路徑，不記成紅燈。

`record` 以 3 結束是拒絕：結果不合 state 的守門，照訊息處理，不換一種寫法硬寫。

完成判準：每次喚醒都跑 `run`（bash 不能用時是 `next`）到 `end` 或 `done`；每份清單只送出 batch 1 的動作；
`run` 留下的每個做了的動作都照它的 `record` 回寫；同一時間只有一個 `run` 在跑；`run` 以 3 結束後，拒絕的原因
處理好才再跑 `run`；state 檔沒有被手改。

## 2. tick 留給你的判斷

### 預計檔案

一張票會動的檔，一行一個 repo 相對路徑（涵蓋路徑本身與底下的一切，`/` 是整個 repo），存在
`sorry-matt/runs/<run>/files/<ticket>.txt`。來源依序：票面、展開區塊與驗收項點名的路徑；票面點名的模組、skill、
指令、設定鍵或識別字以 `git grep -l` 與 `git ls-files` 找到的定義與主要使用處；repo 規則檔（`AGENTS.md`、
`CLAUDE.md` 這類）要求一起改的檔，例如翻譯版。目錄只在票面點名整個目錄時寫，什麼都推不出來才寫 `/`。
**寫到 symbol**：票面或驗收項把改動限定在檔內某個函式、區塊或 markdown 標題時，那一行寫成 `path#symbol`（標題照原文寫，
不帶前面的 `#`）；巢狀的從最外層寫起，`path#外層#內層`。同一路徑的兩張票都寫了 symbol，且沒有一方的 symbol 鏈是另一方
的開頭時，不算重疊、凍結時不合線；任一方只寫路徑，照舊以整檔判斷。git 看得到的佔用（其他 worktree、分支、PR）一律是
整檔；在途的票改到它以 symbol 預計的檔，只佔那些 symbol。拿不準改動會不會跑出 symbol 就寫整檔：猜錯的代價是整併時
的衝突與退回重做。路徑本身不能含 `#`，`/` 不帶 symbol。
**索引檔留在清單外**：每張票各加一行的檔 —— 詞彙表、索引表、CI 的測試清單、README 的表格、manifest 的陣列 ——
列進去會讓所有票互斥，兩張票各加一行的衝突由整併 agent 兩邊都保留。清單只加不減：展開時補、退回重做時加寬。

### 合票

合票（bundle）要省的是**無效與重複的審查**：同一個審查面被好幾張票各審一次，同一則觀察在每張票的審查裡再報一次；
或審查回報了另一張票本來就會改掉的東西。合了的票由一個實作 agent 在一條 ticket 分支上做完，只審一次（審查分級
以整組的 diff 判），只整併一次；每張票保留身分：驗收項標出處，終局與 merge SHA 是主票的、也是每張成員票的。

`freeze.mjs` 只列候選與重疊證據（`overlaps`、`edges`、`through`），合不合由你判。連在一起的票超過上限（計畫檔的
`bundleCap`，預設 3）時，腳本依候選順序切成幾組，每組帶 `cutFrom`（原本的整組）；切法不合用就在 `bundles` 直接寫
你挑的幾張，同樣受上限與候選條件檢查。

- **合**：審查會讀到同一段程式碼；後一張會改寫或刪掉前一張加的東西（例如同一批檔案上的 expand–contract）；或拆開審
  只會讓同一則觀察重複出現。
- **不合**：某張是使用者會想分開落地的獨立交付；合起來的驗收項明顯超過一次審查審得完的量（約 8 項；被阻塞、還沒
  展開的票依範圍估）；某張範圍不清，可能拖住整組 —— 一張卡住，整組一起卡住。
- `through` 不是空的組不能整組合：只能挑不跨過它的幾張。拿不準就不合：多審一次的代價，比整組一起卡住小。

合票只是本 run 的排程：tracker 上的票不合併、不關、不改寫。主票的接續紀錄帶整組的審查區塊；實作 agent 在其他
成員票的接續紀錄留一行指到主票。交付時每張成員票都要關（總 PR 與 FINISH.md 的對帳表逐張列出）。

### 收票的檢查與審查

- **針對性檢查**：實作 agent 回報的受影響範圍檢查是綠的才進審查；紅的交回原 agent 修到綠。記 green（複驗前的
  修正輪記 fixed）之前，先把它回報的全文原樣寫進 collect 指名的檔：審查的派工檔從那裡取 targeted checks，
  沒寫就記不進去。
- **合票**：主票代表整組。派工檔的票面、驗收快照與比對輸出都是整組的，每項驗收標 `ticket`；tick 會等每張成員票的
  驗收快照與預計檔案都齊了才派票。
- **審查方式**：審查前 tick 先發一個 exec，以 `prove-it` 的 `tier.mjs judge` 判**審查分級**（每次初審判一次，
  複驗與 stuck 後的 retry 沿用同一個），再依流程設定 `review` 決定審查方式：`review: minimal` 一律走 minimal
  審查；`review: full` 下 light 走 minimal 審查 —— 沿用它的報告檔、`--kind minimal` 記錄與新鮮度檢查，record
  不帶計數，也沒有派送紀錄與時限 —— standard 與 full 走下面的 prove-it 審查，審查分級寫進派工檔，計數與派送紀錄
  照下面兩項。你不自己判級。
- **獨立審查**：tick 寫好值檔，由 `brief.mjs review` 產出審查主持 agent 的派工檔 —— 同層
  [`REVIEWER.md`](REVIEWER.md) 的固定規則接上這次的值（repo、tracker、票面檔、接續紀錄、驗收快照、比對輸出、
  固定點、ticket 分支、targeted checks 與它跑的 SHA、CI 覆蓋、審查分級，複驗時另含前次審查區塊）—— 再交給你一個前景 spawn。你照動作
  發出，不填值、不加規則。它呼叫 `prove-it`；你不載入 `prove-it`，只收它至多六行的審查回報，以 `--outcome`
  記下結論，並照回報的 `counts:` 行帶 `--observations <n> --pre-existing <n>`（兩個都要帶，沒有就寫 0；少一個
  record 以 2 拒絕），以及 `--candidates <n> --confirmed <n> --invalid <n> --blocking <n>`（#156：四個一起帶，只帶
  幾個以 2 拒絕；回報的 `counts:` 行沒有這四個時都不帶）與 `--covered <n>`（#205：回報有 `covered=` 時帶）。
  minimal 審查只回報擋下整併的 finding，這些計數都不帶。
- **兄弟票範圍**：prove-it 審查的派工檔帶 `sibling scope`，列出同 run 還沒到終局、不在本組的票。某張兄弟票本來就要
  做的事，審查判為 `covered`，不算 finding、也不進觀察 —— 除非它命中 `acceptance`、`regression`、`red` 或
  `safety`：每張票各自落地。
- **審查的派送紀錄**：spawn 之前 tick 先寫派送紀錄（`deadline.mjs record` 在 ticket worktree、時限
  `timeout-review`，再 `state.mjs assign`），審查主持 agent 和其他 agent 一樣有時限。回報隨 spawn 回來時，record
  帶 `--agent`、`--outcome` 與上面的計數；Agent tool 把它放到背景、spawn 只回 agent id 時，record 只帶 `--agent`
  （這時帶計數會以 2 拒絕）：它在途，tick 照樣掃時限、排 fallback 喚醒，完成通知來了以 `--reported` 交給 tick，由
  `collect` 記結論，同樣帶 `--observations <n> --pre-existing <n>`（少一個以 2 拒絕）。
- **照回報落地**：`findings` 交集中修正。`observations` 或 `pre-existing` 不是 0 時，tick 發下一個 `observations`
  judge，要你只讀審查區塊的這兩段，為這條線開一張 raw ticket（「期間開票」），以 `--value <issue id>` 記下；同一條線
  之後的審查（別張票的、複驗、retry）再帶出的，tick 發下的 judge 指名那張 raw ticket，新項目補進去，不另開，記別的
  id 會被拒絕（3）。位置相同或講同一件事的項目不重寫：在既有那項補上來源票。同一條線一次只發一個這種 judge。
  這個 judge 不擋這張票：審查的結論照常往下走。派工檔的 reviewer 是 `primary`；專項 reviewer 由
  `prove-it` 依審查分級自己加（`full` 級的 `architecture`）。

### 集中修正

把審查區塊的位置交回保有 context 的原 agent，要它讀每則 finding 的 `summary`、`evidence` 與 `fix` 原文，一輪
關上全部；主持人不轉述。`review: minimal` 時，以及 `review: full` 下審查分級 light 的票，走的是 minimal 審查，
沒有審查區塊：交回原 agent 的是 reviewer 報告檔
（`tick/review/<ticket key>-<tag>.report.md`）的路徑，不是審查區塊的位置，它讀報告裡每則 finding 的原文。輪數上限由
state 守。

**硬護欄 —— 偶發紅燈一律查到根因。** 同一個 commit 上時紅時綠的測試當真實失敗處理：根因在測試寫法就修測試，
在產品就修產品或登記缺陷票。重跑、放寬等待、加 retry、調大 timeout 都不算修好；修正輪內查不出根因就標卡住。

### 合併衝突

`integrate.mjs merge` 遇到衝突會 abort 並以 4 結束；tick 接著要你派**整併 agent**。這裡是合併衝突判準的唯一
正本：判的是兩個意圖而不是兩段文字。先追兩邊的 primary source（票面與 commit message），相容就都保留（索引檔
裡兩邊各加的行都留），不相容就取合乎本次合併目標的那邊，落地的行為限於某一邊實際寫過的。整併 agent 在整合
worktree 重做 `git merge --no-ff --no-edit <ticket 分支>`、逐塊解，以 `git commit --no-edit` 收尾：解法只在這個
merge commit 裡，不改寫 ticket 分支。它逐塊回報取捨，你記進自答清單；無法安全解決時它 `git merge --abort`，
該票退回重做。收官併入基底的衝突用同一條判準，一邊是線，一邊是基底。

### 期間開票

範圍外的 bug、前置重構、技術債、根因落在範圍外的偶發紅燈，以及審查的 `observations` 與 `pre-existing`（tick 的
`observations` judge 發下時才做：一條線合開一張，逐則列出位置、一句話、證據路徑與來源票，同一條線之後的審查帶出的
補進同一張、重複的併成一項；收官時 tick 再發一個 `observations-final` judge，對照線的最終 tip 逐項標「仍存在」或
「已由 <票>（<SHA>）解決」），只建立 raw ticket，連回來源：

- **GitHub**：`gh issue create`，不加 `ready-for-agent`；body 依 `ASKING.md` 第 6 節潤稿。
- **Local Markdown**：依 tracker 慣例建下一個未使用編號的 ticket 檔，`Status` 設為 `needs-triage`，commit 到
  發現它的線整合分支，有 `origin` 時在那次喚醒結束前 push。

這些票留在初始票集與 frontier 之外。

### 走到才讀的 reference

`judge` 的 `reference` 指到下列檔案時全文讀取並照做：紅燈處置 [`RED-LIGHT.md`](RED-LIGHT.md)、超時處置
[`TIMEOUTS.md`](TIMEOUTS.md)、退回重做與標卡住 [`SEND-BACK.md`](SEND-BACK.md)、收官 [`FINISH.md`](FINISH.md)。

完成判準：交修的都是 `findings` 原文的位置；有觀察或 pre-existing 的線都恰有一張 raw ticket，收官時逐項對照過最終 tip；每個衝突解法只在
merge commit 裡，取捨在自答清單；期間新開的 raw tickets 都有來源連結，
沒有混入凍結票集。

## 3. 裁決與停止

- 中途事項走 `ASKING.md` 第 4 節的三條出路。`ask` 動作同樣：答不出來的標待裁決，只有人能做的進人工作業清單。
  獨立執行而沒有裁決點時，答不出來的事累積到下一個派票點前一次問完。
- spawn 被 plugin 的 hook 以預算為由擋下：不重試、不換路。沒派出的票以 `state.mjs release` 與
  `state.mjs stage awaiting-ruling --reason <hook 的訊息>` 擱置；下一個派票點由 tick 判上限而停下。收官需要的
  spawn 被擋下，照 `ASKING.md` 第 4 節記進人工作業清單。
- 停下、終局與收官的順序由 tick 帶：停下後不再派票，在途的票照常收完，沒派過的標待裁決；所有票到終局後，
  tick 發下收官的動作與 gate，最後一個 `judge` 指向 [`FINISH.md`](FINISH.md)。

完成判準：每張初始票恰好對帳為已交付、卡住或待裁決（`check finish`；停下時另有 `check stopped`）；被預算擋下的
spawn 沒有重試或換路。
