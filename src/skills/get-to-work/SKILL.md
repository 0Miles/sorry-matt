---
name: get-to-work
description: 以逐票流水線清空一組已開好的 tickets：可開工且檔案不重疊的票同時實作，做完一張就審查與整併，每條線交付一支 GitHub 總 PR 或本地整合分支
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
   `excluded` 的票標**待裁決**，寫出佔用來源與解除條件。
5. `state.mjs init`；這個 run 要放寬流程時，在這裡以 `state.mjs profile` 寫一次（`ASKING.md` 第 4 節；組合時
   沿用裁決點寫好的）。`state.mjs add` 每條線的票、`state.mjs line --lines` 記合線，再對每條線跑
   `scripts/integrate.mjs line-init`。
6. `docs/agents/commands.md` 不存在時照 `ASKING.md` 第 0 節的產生規則產生，在每條線的整合分支上 commit
   （subject 不帶票 ID），不 commit 到使用者目前的分支。
7. 獨立執行時，照 `ASKING.md` 第 4 節以凍結票數改寫 ledger 第 9 欄的 `budget: spawns` 與 `budget: rounds`。
8. `tick.mjs setup`，再跑 `state.mjs check <state> freeze --base <基底>`。gate 以 4 結束時照輸出列的每一項補齊
   再跑，過了才進第 1 節。

**硬護欄**：初始票集一經凍結便不再擴張；執行期間新發現或新開的票只作為背景。

完成判準：已選定且驗證 tracker 模式；每張初始票有發布出處、tracker 原生識別與 blocker map；被排除的票都有
佔用來源與解除條件；`check freeze` 通過；獨立執行時兩行 `budget:` 已依凍結票數寫定。

## 1. 用 tick 推進流水線

每張可開工的票各走一條**流水線**：派票 → 實作 → 收票（審查、修正、整併）。票與票不分批、不互等。誰現在該做
什麼、一次喚醒的順序與派票點何時觸發，都由 `scripts/tick.mjs` 算（檔頭）。

進入不帶間隔、可自我調速的 `/loop`，prompt 設為「get-to-work：重讀 `<ledger 絕對路徑>` 與它第 10 欄列出的
規則檔，再以 tick 推進流水線」；沒有 ledger 時改為重讀本 skill 的 `SKILL.md` 與 `ASKING.md` 的絕對路徑。每次
喚醒都帶著這句，恢復不靠記憶。

每次喚醒：

1. `node "${CLAUDE_SKILL_DIR}/scripts/tick.mjs" run <state>`，每個送來完成通知的 agent 加一個
   `--reported <agent id>`。收不收它的回報由 tick 判。`run` 反覆跑 `next`，把每份清單 batch 1 的 exec（`push`
   除外）依序在 bash 跑完並 record，直到 batch 1 還剩 spawn、judge、ask 或 `push`，或 `then` 是 `end`／`done`。
   輸出是剩下的清單，`ran` 列出它跑過的 exec（id、結束代碼、錯誤輸出的 log 檔）。`run` 以 1 結束、訊息說 bash
   不能用時，這次喚醒改跑 `next`，exec 自己照抄 `command`。
2. 照 `actions` 做，但一份清單只送出 `batch` 為 1 的動作，在同一回合一起送出。每做完一個就跑它 `record` 欄的
   指令。較後的 batch 這次不做：前面的動作 record 後，它們會在之後的清單再發下來（tick 只把 batch 1 的背景 spawn
   當成已發出）。沒做的不記，不做沒發下來的事。`reference` 是這個動作要讀的段落。
   - **exec**：`run` 已代跑。留在清單裡的 exec 是 `push`，留給你推，guard hook 才看得到：在 bash（Windows 是
     Git Bash）照抄 `command`，以結束代碼 record。不在 `okExit` 的結束代碼會在下一份清單變成要你處理的 `failed`
     judge，`run` 跑的 exec 由它的 `do` 指名 log 檔。
   - **spawn**：Agent tool 照 `spawn` 欄原樣送出，不另加規則：實作與展開 agent 的固定規則在 plugin 的 agent 定義檔
     （`sorry-matt:implementer`、`sorry-matt:expander`），派工檔的值已由 `scripts/brief.mjs` 填好，`description` 的
     規則在它的檔頭。`subagent_type` 不在可用清單時改送 `fallback` 欄的通用 agent 與 prompt（定義檔本文接上同樣的
     值），不指定模型，`description` 不變，record 加 `--type general-purpose`。
   - **judge**：要你判斷的事。讀 `reference`，做 `do` 寫的事，以 `outcomes` 之一 record。
   - **ask**：只有人能裁的事，照第 3 節。
3. batch 1 的動作逐一 record 完，就再跑 `run`，直到 `then` 是 `end` 或 `done`。`end` 的最後一個動作收尾這次喚醒：ledger 的敘事欄寫到最新，
   還有在途 agent 就排 **fallback 喚醒** —— 有 `ScheduleWakeup` 就用它，否則以 Bash 在背景跑 `sleep`，task id
   記進 record；兩者都不能用時，以 interval 模式重新進入同一個 `/loop`，間隔取最短的階段時限。`done` 是 run
   已收官。

`record` 以 3 結束是拒絕：結果不合 state 的守門，照訊息處理，不換一種寫法硬寫。

完成判準：每次喚醒都跑 `run`（bash 不能用時是 `next`）到 `end` 或 `done`；每份清單只送出 batch 1 的動作；
`run` 留下的每個做了的動作都照它的 `record` 回寫；state 檔沒有被手改。

## 2. tick 留給你的判斷

### 預計檔案

一張票會動的檔，一行一個 repo 相對路徑（涵蓋路徑本身與底下的一切，`/` 是整個 repo），存在
`sorry-matt/runs/<run>/files/<ticket>.txt`。來源依序：票面、展開區塊與驗收項點名的路徑；票面點名的模組、skill、
指令、設定鍵或識別字以 `git grep -l` 與 `git ls-files` 找到的定義與主要使用處；repo 規則檔（`AGENTS.md`、
`CLAUDE.md` 這類）要求一起改的檔，例如翻譯版。目錄只在票面點名整個目錄時寫，什麼都推不出來才寫 `/`。
**索引檔留在清單外**：每張票各加一行的檔 —— 詞彙表、索引表、CI 的測試清單、README 的表格、manifest 的陣列 ——
列進去會讓所有票互斥，兩張票各加一行的衝突由整併 agent 兩邊都保留。清單只加不減：展開時補、退回重做時加寬。

### 收票的檢查與審查

- **針對性檢查**：實作 agent 回報的受影響範圍檢查是綠的才進審查；紅的交回原 agent 修到綠。
- **獨立審查**：填好同層 [`REVIEWER.md`](REVIEWER.md) 的佔位，以前景 spawn 一個審查主持 agent。它呼叫
  `prove-it`；你不載入 `prove-it`，只收它至多六行的審查回報。CI 覆蓋填 `no-origin`（沒有 `origin`）、
  `uncovered`（已定案為 CI 不涵蓋整合分支）或 `covered`。
- **照回報落地**：`findings` 交集中修正；`observations` 或 `pre-existing` 不是 0 時只讀審查區塊的這兩段，合開
  一張 raw ticket（「期間開票」）。一張票預設只有這一位 reviewer；只有具體風險才加專項 reviewer，指名風險並記進
  自答清單，「再看一遍比較保險」不是風險。

### 集中修正

把審查區塊的位置交回保有 context 的原 agent，要它讀每則 finding 的 `summary`、`evidence` 與 `fix` 原文，一輪
關上全部；主持人不轉述。`review: minimal` 時沒有審查區塊：交回原 agent 的是 reviewer 報告檔
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

範圍外的 bug、前置重構、技術債、根因落在範圍外的偶發紅燈，以及審查的 `observations` 與 `pre-existing`（一張票合開
一張，逐則列出位置、一句話與證據路徑，複驗帶出的補進同一張），只建立 raw ticket，連回來源：

- **GitHub**：`gh issue create`，不加 `ready-for-agent`；body 依 `ASKING.md` 第 6 節潤稿。
- **Local Markdown**：依 tracker 慣例建下一個未使用編號的 ticket 檔，`Status` 設為 `needs-triage`，commit 到
  發現它的線整合分支，有 `origin` 時在那次喚醒結束前 push。

這些票留在初始票集與 frontier 之外。

### 走到才讀的 reference

`judge` 的 `reference` 指到下列檔案時全文讀取並照做：紅燈處置 [`RED-LIGHT.md`](RED-LIGHT.md)、超時處置
[`TIMEOUTS.md`](TIMEOUTS.md)、退回重做與標卡住 [`SEND-BACK.md`](SEND-BACK.md)、收官 [`FINISH.md`](FINISH.md)。

完成判準：交修的都是 `findings` 原文的位置；有觀察或 pre-existing 的票都有一張 raw ticket；加了專項 reviewer
的票都指名了風險；每個衝突解法只在 merge commit 裡，取捨在自答清單；期間新開的 raw tickets 都有來源連結，
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
