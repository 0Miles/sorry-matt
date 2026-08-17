---
name: get-to-work
description: 逐輪清空一組已開好的 tickets，依阻塞順序平行實作與驗收，交付 GitHub PR 或本地整合分支
disable-model-invocation: true
---

# get-to-work：把已開好的 tickets 全部完成

## 0. 選定模式並凍結票集

先讀 `docs/agents/issue-tracker.md`。其中的 provider 與慣例決定本次使用 GitHub 或 Local
Markdown；檔案不存在時，請使用者先執行 `/setup-matt-pocock-skills`。

確認 git repo 與 working tree 乾淨，再依模式檢查交付條件：

- **GitHub**：`gh` 已登入；交付物是票級 PR 與線的總 PR。
- **Local Markdown**：不要求 remote 或 `gh`；交付物是線整合分支，不建立 PR。

授權止於線整合分支與 GitHub 模式的 PR。基底分支合併、force-push、部署及發布均由人處理。

接著**凍結**初始票集：

1. 引數可指定 ticket 編號、URL 或本地檔案路徑。有引數時，初始票集就是指定的 tickets；
   沒有引數時，只收錄本 session 中有發布紀錄的
   tickets，Local Markdown 的發布路徑也算紀錄。找不到任何票時，向使用者索取清單。
2. 依 tracker 契約讀取 blocker **邊**並劃分**線**：相連 tickets 同線，孤立 tickets 各自成線。
   需要 `/issue-chain` 時，明確傳入凍結票集，讓背景工作留在票集之外。
3. 從目前分支尖端，為每條線建立 `<run>/<line-slug>` **整合分支**與整合 worktree；同線成果
   逐輪累積於此。

**硬護欄**：執行期間新發現或新開的票只作為背景，初始票集一經凍結便不再擴張。

完成判準：已選定且驗證 tracker 模式；每張初始票都有發布出處、tracker 原生識別、所屬線與
blocker map；每條線都有從同一基底尖端建立的整合分支及 worktree。

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

範圍外的 bug、前置重構（prefactor）或技術債只建立 raw ticket，並連回來源 finding：

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

最終輸出每條線的總 PR 或整合分支、涵蓋全部初始票的**對帳表**，以及期間新開的 raw tickets
清單並建議執行 `/triage`。

完成判準：每條線恰有一項可供人合併的交付；對帳表不重不漏地涵蓋凍結票集；所有 ticket
worktree 與本地 ticket 分支均已移除；Local Markdown 的整合 worktree 已移除而整合分支仍
保留。
