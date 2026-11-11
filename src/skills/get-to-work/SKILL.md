---
name: get-to-work
description: 逐輪清空一組已開好的 tickets，依阻塞順序平行實作與驗收，輪中不提問，交付 GitHub PR 或本地整合分支
disable-model-invocation: true
---

# get-to-work：把已開好的 tickets 全部完成

## 0. 選定模式並凍結票集

開場依序讀四份：

1. `docs/agents/issue-tracker.md`。其中的 provider 與慣例決定本次使用 GitHub 或 Local
   Markdown；檔案不存在時，請使用者先執行 `/setup-matt-pocock-skills`。
2. `git rev-parse --path-format=absolute --git-common-dir` 指出的共用目錄下的
   `sorry-matt/authority.md`，取得**常設授權**。不存在時照預設走，不停工。
3. `docs/agents/environment.md`，取得已落檔的環境事實。不存在時略過。
4. 以本 skill 載入時標示的 base directory 為起點，讀同層的
   [`../have-it-all-done/ASKING.md`](../have-it-all-done/ASKING.md) 全文。它是提問契約，
   全程適用，無論本 skill 是被使用者直接執行還是由 `have-it-all-done` 組合。

確認 git repo 與 working tree 乾淨，再依模式檢查交付條件：

- **GitHub**：`gh` 已登入；交付物是票級 PR 與線的總 PR。
- **Local Markdown**：不要求 remote 或 `gh`；交付物是線整合分支，不建立 PR。

授權級別依 `ASKING.md` 第 5 節的三層決定：常設授權有附出處的列就照它走，沒有就由呼叫方
給 —— `have-it-all-done` 的裁決點，或使用者本次的指示。force-push 一律由人；真錢交易、
正式環境資料、對外寄送與第三方溝通是永久例外，任何層級都不得授權。

設定指出工作區含多個 repo 時，逐 repo 盤票。線不跨 repo，每個 repo 各有自己的整合分支與
交付物。

接著**凍結**初始票集：

1. 引數可指定 ticket 編號、URL 或本地檔案路徑。有引數時，初始票集就是指定的 tickets；
   沒有引數時，只收錄本 session 中有發布紀錄的
   tickets，Local Markdown 的發布路徑也算紀錄。找不到任何票時，向使用者索取清單。
2. 依 tracker 契約讀取 blocker **邊**並劃分**線**：相連 tickets 同線，孤立 tickets 各自成線。
   需要 `/issue-chain` 時，明確傳入凍結票集，讓背景工作留在票集之外。
3. **排除他線佔用**：以 `git worktree list`、未合併整合分支上的 commits、open PR 的 head，
   以及本 session 已知的其他 session，推出正在被別人動的檔案。檔案與之重疊的票不凍進本次
   票集，改列為**待裁決**並寫出佔用來源與解除條件。不要等實作撞上去才發現。
4. 從目前分支尖端，為每條線建立 `<run>/<line-slug>` **整合分支**與整合 worktree；同線成果
   逐輪累積於此。

**硬護欄**：執行期間新發現或新開的票只作為背景，初始票集一經凍結便不再擴張。

完成判準：已選定且驗證 tracker 模式；已記錄常設授權；每張初始票都有發布出處、tracker
原生識別、所屬線與 blocker map；每條被他線佔用而排除的票都有佔用來源與解除條件；每條線
都有從同一基底尖端建立的整合分支及 worktree。

## 1. 用 `/loop` 推進輪次

進入不帶間隔、可自我調速的 `/loop`，prompt 設為「get-to-work：收輪／開輪」。Agents 尚在
執行時，使用較長 fallback 等候通知。

### 開輪

**Frontier** 是初始票集中尚未完成，且所有 blocker 均已解除的 tickets。跨線工作通常可平行；
同線或修改同一批檔案的**互斥** tickets 必須分輪。

對每張 frontier ticket：

1. 從所屬線的整合分支建立 `<run>/<NN>-<slug>` ticket 分支與 worktree。
2. 完整讀取[pinned implement 流程](references/upstream/implement.md)。Spawn 一個 subagent，
   提供該流程全文、worktree、ticket 在 tracker 上的原生識別碼與全文，以及整合分支；要求它
   完整照做。主持人依下方收輪流程負責
   驗收與交付。

完成判準：本輪 frontier 中每張票都有獨立分支、worktree 與負責 agent；同線或檔案重疊的票
均排入不同輪。

### 收輪

同輪所有 agents 回報後，逐票完成下列關卡：

1. **驗收**：呼叫 Skill tool 帶入 `code-review`，執行它的雙軸審查；fixed point 是該線整合分支，spec
   來源是 ticket URL 或路徑。把 finding 交回保有 context 的原 agent 修正後重驗，最多兩輪
   修正。

   **硬護欄 —— 偶發紅燈不得用重跑帶過。** 測試在同一個 commit 上時紅時綠，一律當真實
   失敗處理：必須查出根因，落在測試寫法就修測試，落在產品就修產品或登記缺陷票。不得以
   重跑、放寬等待、加 retry 或調大 timeout 讓它轉綠。兩輪修正內查不出根因就標卡住，
   不得宣告驗收通過。
2. **票級 PR（GitHub only）**：push ticket 分支，建立以線整合分支為 base 的 PR；body
   必須含 `Closes #N` 與驗收摘要。
3. **整併**：在整合 worktree 合併 ticket 分支。遇到 conflict 時，呼叫 Skill tool 帶入
   `resolving-merge-conflicts`，保留雙方意圖並執行 repo 自動檢查。
4. **完成交付**：
   - **GitHub**：push 整合分支；保留已因整併顯示為 merged 的票級 PR 作為審查紀錄。
   - **Local Markdown**：在整合分支的 ticket 檔勾選每項已驗證的 acceptance criterion，將
     `Status` 改為 `ready-for-human`，追加 `## sorry-matt completion`，列出 implementation
     commit、整合分支及通過的檢查，再 commit 這份交付紀錄。這是 sorry-matt 的延伸契約；
     上游沒有為普通 local ticket 定義完成狀態。
5. 移除 ticket worktree 與本地 ticket 分支。

**輪中不得提問。** 要問的事累積到下一次開輪前；由 `have-it-all-done` 組合時一律交給它的
唯一裁決點。能代答的代答記檔，答不出來的標卡住，只有人能做的進人工作業清單 —— 依
`ASKING.md` 第 4 節的三條出路，沒有第四條。

Local Markdown 的 blocker 只在同一整合分支可讀到前置票的完整 `sorry-matt completion`，且
其 acceptance criteria 全部勾選後解除；`ready-for-human` 單獨出現仍是未完成。

兩輪修正後仍未通過驗收，或 conflict 無法安全解決時，將票標為**卡住**：

- **GitHub**：另開 raw issue 記錄失敗。
- **Local Markdown**：在整合分支的原 ticket 追加 `## sorry-matt blocker`，列出原因、已做嘗試
  與相關分支；將 `Status` 改為 `ready-for-human` 後 commit。

完成卡住紀錄後也移除 ticket worktree 與本地 ticket 分支；卡住票的下游 tickets 保持阻塞。

完成判準：本輪每張票都有通過驗收的模式原生交付，或有可追溯的卡住紀錄；成功票已整併並
清理 ticket worktree 與本地分支；Local Markdown 只有符合 completion 契約的前置票會解除
blocker。

### 期間開票

範圍外的 bug、前置重構（prefactor）、技術債，以及偶發紅燈查出而根因落在範圍外的缺陷，
只建立 raw ticket，並連回來源 finding：

- **GitHub**：用 `gh issue create`，不加 `ready-for-agent`。
- **Local Markdown**：依 tracker 慣例建立下一個未使用編號的 ticket 檔，將 `Status` 設為
  `needs-triage`，並 commit 到發現它的線整合分支。

這些 raw tickets 留在初始票集與本次 frontier 之外。

初始票集全數有完成交付時停止 loop；frontier 已空但仍有卡住或**待裁決**票時也停止。

完成判準：每張初始票恰好對帳為已交付、卡住或待裁決；期間新開的 raw tickets 均有來源連結，
且沒有混入凍結票集。

## 2. 收官

依模式交付每條線：

- **GitHub**：建立「線整合分支 → 基底分支」的**總 PR**。Body 收錄票級 PR，且只為已完成票
  列 `Closes #N`；卡住與待裁決票列為缺口。
- **Local Markdown**：保留線整合分支供人審查與合併；記錄 branch name 與 tip SHA，再移除
  整合 worktree。票據狀態與實作一同留在該分支，不模擬 PR 或 close。

常設授權允許合併時，GitHub 模式在總 PR 的 CI 轉綠後直接合併並回報結果；授權缺漏時維持
交給人，並在輸出中指名缺的是哪一條授權，不為此另開一輪提問。

對外文字 —— raw issue body、PR body、tracker 留言 —— 依 `ASKING.md` 第 6 節處理。

線交付完成後清理：呼叫 Skill tool 帶入 `clean-it-up`，照它的證據規則收掉本輪產生的
ticket worktree 與已合併的本地分支。**待人審查的交付物不在清理範圍**：Local Markdown 的
線整合分支、以及尚未合併的總 PR 來源分支一律保留 —— 對未合併項目，`clean-it-up` 本身就是
降級為保留。遠端分支仍須使用者在本次明確授權，不為此另開提問。

最終輸出每條線的總 PR 或整合分支、涵蓋全部初始票的**對帳表**、本輪實際採用的授權，
以及期間新開的 raw tickets 清單並建議執行 `/triage`。

完成判準：每條線恰有一項可供人合併的交付，或已依常設授權合併並回報；對帳表不重不漏地
涵蓋凍結票集；所有 ticket worktree 與本地 ticket 分支均已移除；Local Markdown 的整合
worktree 已移除而整合分支仍保留；輸出已列出本輪採用的授權。
