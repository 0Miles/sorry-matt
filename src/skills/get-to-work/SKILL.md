---
name: get-to-work
description: 逐輪清空一組已開好的 tickets，依阻塞順序平行實作與驗收，交付 GitHub PR 或本地整合分支
disable-model-invocation: true
---

# get-to-work：把已開好的 tickets 全部完成

## 0. 選定模式並凍結票集

以本 skill 載入時標示的 base directory 為起點，讀同層的
[`../have-it-all-done/ASKING.md`](../have-it-all-done/ASKING.md) 全文，依它第 0 節開場。它是
共用契約，全程適用，無論本 skill 是被使用者直接執行還是由 `have-it-all-done` 組合。由
`have-it-all-done` 組合時沿用它的 run ledger；獨立執行時依 `ASKING.md` 第 7 節自建。

確認 git repo 與 working tree 乾淨；tracker 設定為 GitHub 時另確認 `gh` 已登入。Local
Markdown 模式不要求 remote 或 `gh`。兩種模式的交付物見第 2 節。

授權依 `ASKING.md` 第 5 節：常設授權有附出處的列就照它走，沒有就由呼叫方給 ——
`have-it-all-done` 的裁決點，或使用者本次的指示。<!-- pending #8 -->

設定指出工作區含多個 repo 時，逐 repo 盤票。線不跨 repo，每個 repo 各有自己的整合分支與
交付物。

接著**凍結**初始票集：

1. 引數可指定 ticket 編號、URL 或本地檔案路徑。有引數時，初始票集就是指定的 tickets；
   沒有引數時，只收錄本 session 中有發布紀錄的
   tickets，Local Markdown 的發布路徑也算紀錄。找不到任何票時，向使用者索取清單。
2. 依 tracker 契約讀取 blocker **邊**並劃分**線**：相連 tickets 同線，孤立 tickets 各自成線。
   需要排鏈時，呼叫 Skill tool 帶入 `issue-chain` 並明確傳入凍結票集，讓背景工作留在
   票集之外。<!-- pending #11 -->
3. **排除他線佔用**：以 `git worktree list`、未合併整合分支上的 commits、open PR 的 head，
   以及本 session 已知的其他 session，推出正在被別人動的檔案。檔案與之重疊的票不凍進本次
   票集，改列為**待裁決**並寫出佔用來源與解除條件。
4. 從目前分支尖端，為每條線建立 `<run>/<line-slug>` **整合分支**與整合 worktree；同線成果
   逐輪累積於此。

**硬護欄**：執行期間新發現或新開的票只作為背景，初始票集一經凍結便不再擴張。

完成判準：已選定且驗證 tracker 模式；已記錄常設授權；每張初始票都有發布出處、tracker
原生識別、所屬線與 blocker map；每條被他線佔用而排除的票都有佔用來源與解除條件；每條線
都有從同一基底尖端建立的整合分支及 worktree。

## 1. 用 `/loop` 推進輪次

進入不帶間隔、可自我調速的 `/loop`，prompt 設為「get-to-work：收輪／開輪」。Agents 尚在
執行時，使用較長 fallback 等候通知。收輪邊界是唯一的交接點，所以把 ledger 寫到最新才結束
那一輪。

### 開輪

**Frontier** 是初始票集中尚未完成，且所有 blocker 均已解除的 tickets。<!-- pending #11 -->
跨線工作通常可平行；同線或修改同一批檔案的**互斥** tickets 必須分輪。

對每張 frontier ticket：

1. 從所屬線的整合分支建立 `<run>/<NN>-<slug>` ticket 分支與 worktree。
2. 讀同層的 [`IMPLEMENTER.md`](IMPLEMENTER.md)，填好其中的佔位，以填好的全文為 prompt
   spawn 一個實作 agent，不另加規則。它定義的**接續紀錄**是該票的唯一正本，其他位置只引用它。

完成判準：本輪 frontier 中每張票都有獨立分支、worktree 與負責 agent，且每個 agent 的
prompt 都是填好佔位的 `IMPLEMENTER.md` 全文；同線或檔案重疊的票均排入不同輪。

### 收輪

同輪所有 agents 回報後，逐票完成下列關卡。順序固定是**針對性檢查 → 一次獨立審查 → 集中
修正 → 按影響範圍複驗**；完整驗證只在收官做一次。

1. **針對性檢查**：確認 agent 回報的受影響範圍檢查是綠的。紅燈先交回原 agent 修到綠，
   審查只收綠燈的票。
2. **獨立審查**：呼叫 Skill tool 帶入 `code-review`，fixed point 是該線整合分支，spec 來源
   是 ticket URL 或路徑。**一張票預設只有這一位 reviewer**，規範與需求符合性由它的雙軸同時
   涵蓋。只有具體風險需要時才加專項 reviewer，而且要指名是哪個風險、理由記進自答清單；
   「再看一遍比較保險」不是風險。
3. **集中修正**：本票的 finding 一次全部交回保有 context 的原 agent，一輪修完，不逐則來回。
   修完只重跑受影響範圍的針對性檢查。最多兩輪修正。

   **硬護欄 —— 偶發紅燈一律查到根因。** 測試在同一個 commit 上時紅時綠，當真實失敗
   處理：查出根因，落在測試寫法就修測試，落在產品就修產品或登記缺陷票。重跑、放寬等待、
   加 retry 與調大 timeout 都不算修好。兩輪修正內查不出根因就標卡住。
4. **票級 PR（GitHub only）**：push ticket 分支，建立以線整合分支為 base 的 PR；body
   必須含 `Closes #N` 與驗收摘要。
5. **整併**：在整合 worktree 合併 ticket 分支。有 conflict 時交給一個**整併 agent** 逐塊解：
   給它整合 worktree、兩邊的票面與 commit message，以及這條判準 —— 判的是兩個意圖而不是
   兩段文字，先追兩邊的 primary source（票面與 commit message），相容就都保留，不相容就取
   合乎本次合併目標的那邊，落地的行為限於某一邊實際寫過的。它逐塊回報取捨摘要，主持人把
   取捨記進自答清單。解完執行受影響範圍的針對性檢查。
6. **完成交付**：
   - **GitHub**：push 整合分支；保留已因整併顯示為 merged 的票級 PR 作為審查紀錄。
   - **Local Markdown**：在整合分支的 ticket 檔勾選每項已驗證的 acceptance criterion，將
     `Status` 改為 `ready-for-human`，追加 `## sorry-matt completion`，列出 implementation
     commit、整合分支及通過的檢查，再 commit 這份交付紀錄。
7. 移除 ticket worktree 與本地 ticket 分支。

中途事項走 `ASKING.md` 第 4 節的三條出路。獨立執行而沒有裁決點時，答不出來的事累積到
下一次開輪前一次問完。

Local Markdown 的 blocker 只在同一整合分支可讀到前置票的完整 `sorry-matt completion`，且
其 acceptance criteria 全部勾選後解除；`ready-for-human` 單獨出現仍是未完成。

兩輪修正後仍未通過驗收，或 conflict 無法安全解決時，將票標為**卡住**：

- **GitHub**：另開 raw issue 記錄失敗，body 依 `ASKING.md` 第 6 節潤稿。
- **Local Markdown**：在整合分支的原 ticket 追加 `## sorry-matt blocker`，列出原因、已做嘗試
  與相關分支；將 `Status` 改為 `ready-for-human` 後 commit。

完成卡住紀錄後也移除 ticket worktree 與本地 ticket 分支；卡住票的下游 tickets 保持阻塞。

完成判準：本輪每張票都恰好經過一次獨立審查、針對性檢查回到綠，並有通過驗收的模式原生
交付，或有可追溯的卡住紀錄；加了專項 reviewer 的票都指名了風險；每張票的接續紀錄都寫到
最新；成功票已整併並清理 ticket worktree 與本地分支；Local Markdown 只有符合 completion
契約的前置票會解除 blocker。

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

- **GitHub**：建立「線整合分支 → 基底分支」的**總 PR**。Body 收錄票級 PR，且只為已完成票
  列 `Closes #N`；卡住與待裁決票列為缺口。總 PR body 依 `ASKING.md` 第 6 節潤稿。
- **Local Markdown**：保留線整合分支供人審查與合併；記錄 branch name 與 tip SHA，再移除
  整合 worktree。票據狀態與實作一同留在該分支，不模擬 PR 或 close。

常設授權允許合併時，GitHub 模式在總 PR 的 CI 轉綠後直接合併並回報結果；授權缺漏時維持
交給人，並在輸出中指名缺的是哪一條授權，不為此另開一輪提問。<!-- pending #8 -->

線交付完成後清理：呼叫 Skill tool 帶入 `clean-it-up`，照它的證據規則收掉本輪產生的
ticket worktree 與已合併的本地分支。**待人審查的交付物不在清理範圍**：Local Markdown 的
線整合分支、以及尚未合併的總 PR 來源分支一律保留 —— 對未合併項目，`clean-it-up` 本身就是
降級為保留。遠端分支仍須使用者在本次明確授權，不為此另開提問。

最終輸出每條線的總 PR 或整合分支、涵蓋全部初始票的**對帳表**與**本輪計量**（`ASKING.md`
第 7 節）、本輪授權表（第 5 節），以及期間新開的 raw tickets 清單並請使用者執行 `/triage`。

完成判準：每條線都跑過一次線級精簡與一次完整驗證並收在綠燈，且恰有一項可供人合併的交付，
或已依常設授權合併並回報；對帳表不重不漏地涵蓋凍結票集，每列都指向該票的接續紀錄；所有
ticket worktree 與本地 ticket 分支均已移除；Local Markdown 的整合 worktree 已移除而整合
分支仍保留；輸出已列出本輪採用的授權與本輪計量。
