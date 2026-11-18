# AGENTS.md — 開發這個 repo 的規則

## 結構

- `src/skills/<name>/SKILL.md` — 繁體中文原稿,**single source of truth**
- `src/skills/<name>/agents/openai.yaml` — OpenAI UI 與 invocation metadata 原稿
- `src/skills/<name>/references/upstream/` — runtime 直接讀取、亦供升級對帳的 pinned 上游原文
- `src/skills/<name>/<REFERENCE>.md` — 只有部分 branch 會走到的自有 reference,或多個 skill
  共讀的契約,由 `SKILL.md` 以相對路徑指標帶入(如 `review-pr/FOLLOW-UP.md`;
  `have-it-all-done/ASKING.md` 由 `have-it-all-done`、`get-to-work`、`take-this` 三者共讀;
  `build-the-ui-right/FRONTEND.md` 由五支前端 skill 共讀)
- `src/skills/<name>/scripts/` — skill 執行(不載入)的零依賴腳本,由 `SKILL.md` 以
  `${CLAUDE_SKILL_DIR}/scripts/<file>` 呼叫;測試放 repo 根目錄的 `scripts/*.test.mjs` 並掛進 CI
- `skills/<name>/SKILL.md` — 英文 dist 版;plugin 實際載入的是這份,供人使用
- `skills/<name>/agents/openai.yaml` — 與 src 同步的 OpenAI metadata dist 版
- `skills/<name>/references/upstream/` — 與 src 相同的 pinned 上游原文
- `skills/<name>/scripts/` — 與 src 逐位元組相同的腳本(不翻譯)
- `skills/<name>/<REFERENCE>.md` — 與 src 對應的英文 dist 版自有 reference
- `hooks/hooks.json`、`hooks/*.mjs` — plugin 自帶的 PreToolUse guard(需要確認的動作:兩段確認與確認一次,
  含會立即觸發正式部署的合併);不分 src/dist,測試在 `scripts/guard.test.mjs` 與 `scripts/deploy-on-merge.test.mjs`
- `scripts/` — repo 檢查腳本(src/dist 結構對帳、vendored SHA-256)與它們的測試,
  由 `.github/workflows/check.yml` 在 PR 上執行
- `docs/matt-skills.md` — 用到的每個 matt skill 的決定(原樣使用/自有流程取代/只傳參數)與理由

## 開發規則

**讀寫都在 `src/`。** 討論、審視、修改 skill 一律針對 `src/skills/` 的繁中原稿;
`skills/`(dist)不直接編輯 —— 它只從 src 重寫產生,直接改 dist 的變更會在下次
重寫時被覆蓋。

**完成編輯後,對每個動過的 skill 額外做一次翻譯:基於 src 全文重寫英文 dist 版**
到 `skills/<name>/SKILL.md`。是重寫,不是逐字翻譯:

- 語義與 src 一致:步驟、判準、護欄、技術細節(指令、路徑、API 欄位)逐一對應
- Leading words 換成英文裡同樣有分量的詞,沿用既有對照(見下表),新詞自己選好
  並補進表裡
- 僅適用於原作者的細節要一般化或移除(如個人的輸出語言偏好、個人環境路徑)
- frontmatter 的 `name` 兩版相同;`description` 用英文重寫

### 待落地標記

之後會改由腳本或 hook 執行的規則,在 src 與 dist 的同一處加 `<!-- pending #N -->`(N 是負責落地的票)。
那張票落地後刪掉規則文字與標記。結構對帳腳本會比對兩版的標記是否一致。

## 跨 skill 組合

Model 只能用 Skill tool 呼叫 **model-invoked**(frontmatter 沒有
`disable-model-invocation: true`)的 skills;user-invoked 的不在 model 的可呼叫清單上,
skill 之間也 reach 不到 —— 寫成「執行 <user-invoked skill>」的指令會讓 agent 攤手
自己模擬。skill 內文引用其他 skill 時:

- 對方是 **model-invoked**(自家的 `grill-them`、`issue-chain`、`speak-human`、`no-bullshit`、
  `clean-it-up`、`prove-it`、`figure-out-the-ui`、`build-the-ui-right`、`actually-look-at-the-ui`、
  `make-the-ui-fast`;第三方與 harness 的以 frontmatter 認定 —— 寫進 skill 前確認它存在、且沒有
  `disable-model-invocation: true`)→ 措辭必須明寫
  **「呼叫 Skill tool 帶入 `<name>`」**。只寫「執行 `<name>` skill」或丟一個 `/name` 進散文
  不保證觸發載入,這是上游 `grill-with-docs` 最常被回報的問題。Skill tool 一次只吃一個
  skill:需要兩個就寫成兩次呼叫,不能寫成一次帶兩個名字
- 對方是 **user-invoked**:
  - 自家的:以本 skill 載入時標示的 base directory 為起點,讀同層的
    `../<name>/SKILL.md` 並照做
  - 第三方的:不得解析任何 agent 或 plugin 的安裝路徑。若本 skill 必須自主完成該程序,
    把 pin 住的原文與授權聲明放進自己的 `references/upstream/`,並由 `SKILL.md` 以相對路徑
    直接要求全文讀取。若它本來就是獨立的人為步驟,請使用者執行
- 要「人」執行的指令(`/setup-matt-pocock-skills`、`/triage`、`/implement` 等
  下一步建議)措辭必須是「請使用者執行」,不能寫成 agent 的動作

- 不寫「載入上游全文,再覆寫其中幾行」:要改上游的行為,就寫自有流程取代它,或只填上游留的
  參數位置。決定與理由記進 `docs/matt-skills.md`
- 交給 subagent 的內容要自足:它問不到使用者,也讀不到主持人的 skill 檔。它要遵守的規則都寫在
  交付內容裡(如 `get-to-work/IMPLEMENTER.md`),要讀的檔案給絕對路徑

以上只約束 **operative** 指令 —— skill 自己的步驟要 agent 現在就去跑另一個 skill。純粹列給人
挑選的 router 散文(`ask-miles`、README 表格)沒有在呼叫任何東西,`/name` 在那裡是標籤,照原樣寫。

### 詞彙對照

| src | dist |
| --- | --- |
| 完成判準 | Done when: |
| 對打 | duel |
| 題目卡 | topic card |
| 拷問者/受審者 | griller / respondent |
| 待裁決 | awaiting ruling |
| 支線 | side quest |
| 待支線 | parked |
| 實例 | worked instance |
| 鏈/環 | chain / link |
| 邊 | edge |
| 互斥 | mutually exclusive |
| 線(票的分組) | line |
| 整合分支 | integration branch |
| 對帳表 | reconciliation table |
| 語義帳本 | semantic ledger |
| 母語重寫 | native rewrite |
| 回帳 | reconcile |
| 卡住 | stuck |
| 期間開票 | filing along the way |
| 紅燈/全綠 | red light / all green |
| 自答清單 | self-answer log |
| 硬護欄 | hard rail |
| 沉澱 | distillation |
| Git 的拒絕就是判決 | a refusal is a verdict |
| 降級為保留 | downgrade to keep |
| 臨場重驗 | last-minute recheck |
| 修法 | fix |
| 反駁優先 | disprove-first |
| 延伸/推翻/來回 | extends / reverses / flip-flops |
| 實跑 | live run |
| 突變 | mutation |
| 釘住 | pinned |
| 舉證責任在你身上 | the burden is on you |
| 來源與規模 | source and scale |
| 裁決點 | ruling point |
| 常設授權 | standing authority |
| 代答 | answer on their behalf |
| 提問前置檢查 | pre-ask check |
| 人工作業清單 | human-work list |
| 目視驗收 | eyes-on acceptance |
| 他線佔用 | held by another line |
| 並行佔用 | concurrent holds |
| 偶發紅燈 | flaky red |
| 反轉成本 | cost to reverse |
| 環境事實 | environment facts |
| 專案例外 | project exception |
| 需要確認的動作 | actions needing confirmation |
| 兩段確認 | two-step confirmation |
| 確認一次 | single confirmation |
| 災難級操作 | catastrophic actions |
| 硬停 | hard stop |
| 確認呼叫 | prompting call |
| 精簡 | simplify pass |
| 展開(票) | expand |
| 兩段展開 | two-stage expansion |
| 完整展開 | full expansion |
| 接續紀錄 | status record |
| 延伸契約 | extension contract |
| 上下文預算 | context budget |
| 正本 | source of truth |
| 開局 agent | kickoff agent |
| 整併 agent | merge agent |
| 針對性檢查 | targeted checks |
| 獨立審查 | independent review |
| 集中修正 | batched fix |
| 完整驗證 | full verification |
| 證據失效 | evidence expiry |
| 重大分歧 | material disagreement |
| 計量 | run metrics |
| 壓縮 | compaction |
| 流水線 | pipeline |
| 派票 | dispatch |
| 派票點 | dispatch point |
| 收票 | close-out |
| 補派 | refill |
| 在途 | in flight |
| 候選（票） | candidate |
| 終局 | end state |
| 整併佇列 | integration queue |
| 預計檔案 | predicted files |
| 檔案重疊 | file overlap |
| 退回重做 | send back for a redo |
| 退回紀錄 | send-back record |
| 退回次數 | send-back count |
| 階段 | stage |
| 展開中 | expanding |
| 實作中 | implementing |
| 審查中 | in review |
| 修正中 | fixing |
| 待整併 | queued |
| 整併中 | integrating |
| 喚醒 | wake-up |
| 上游撤回 | upstream reverted |
| 預算與斷路 | budget and breaker |
| 無進展斷路 | no-progress breaker |
| 上限/用量 | limit / usage |
| 停止原因 | stop reason |
| 進度快照 | progress snapshot |
| 等人時間 | waiting time |
| 併入基底 | sync the base |
| 未併入 | unsynced |
| 逐票導覽 | per-ticket guide |
| 線級 commit | line-level commit |
| 審查門檻 | review threshold |
| 還在跑 | still running |
| 沒有 run | no run |
| 查詢失敗 | query failed |
| 被取消 | cancelled |
| CI 不涵蓋整合分支 | CI does not cover the integration branch |
| 讀 CI | reading CI |
| 紅/綠(CI 結果) | red / green |
| 紅燈處置 | red-light handling |
| 最早的紅 SHA | earliest red SHA |
| 對不到票 | maps to no ticket |
| 撤回 | revert |
| 驗證未過 | failed verification |
| 本機驗證 | local verification |
| 恢復 | resuming |
| 規則檔 | rule files |
| 狀態標記 | state marker |
| 總 PR | aggregate PR |
| 缺口 | gap |
| 對打目錄 | exchange directory |
| 問題檔/答案檔 | question file / answer file |
| 補完答案 | completed answer |
| 關票 | closing tickets |
| 放行 | let through |
| 擋下 | blocked |
| 權限規則片段 | permission rule snippet |
| 需授權動作的結果 | authorization outcomes |
| 以後都這樣 | from now on |
| 開場 | opening |
| 共用契約 | shared contract |
| 交付說明 | brief |
| 潤稿 | polish pass |
| 原樣使用/自有流程取代/只傳參數 | used as-is / replaced by own flow / parameters only |
| 審查用 worktree | review worktree |
| 初審/複驗 | initial review / recheck |
| 驗收對照 | acceptance check |
| 範圍蔓延 | scope creep |
| 修法方向 | fix direction |
| 突變紀錄 | mutation record |
| 存活/殺掉(mutant) | survived / killed |
| 等價 mutant | equivalent mutant |
| 基準(實跑) | baseline |
| 上限(突變) | cap |
| 成立/不成立(裁決) | confirmed / invalid |
| 展開 agent | expansion agent |
| 展開區塊 | expansion block |
| 驗收快照 | acceptance snapshot |
| 驗收比對 | acceptance diff |
| 出處(驗收項) | source |
| 驗收只讀 | read-only acceptance criteria |
| 前端契約 | frontend contract |
| 仲裁順序 | precedence |
| 狀態矩陣 | state matrix |
| 無障礙底線 | accessibility floor |
| 證據等級 | evidence grade |
| 實測/推導/判斷 | measured / derived / judged |
| 未驗證 | unverified |
| 主張 | claim |
| 介面定案 | UI brief |
| 有用的結果 | useful outcome |
| 主要動作 | primary action |
| 假設 | assumption |
| 前後對照 | before/after pair |
| 給人看的清單 | eyes-on list |
| 觀看條件 | viewing conditions |
| 量測條件 | measurement conditions |
| 基準值 | baseline |
| 雜訊 | noise |
| 瓶頸 | bottleneck |
| 行為基準 | behavior baseline |
| 整段旅程 | whole journey |
| 中斷情境 | interruption |
| 時限 | time limit |
| 階段時限 | stage time limit |
| 派送 | assignment |
| 派送時間 | assigned time |
| 到期時間 | deadline |
| 超時 | overdue |
| 延長（時限） | extend |
| 進度指紋 | progress fingerprint |
| 時限掃描 | deadline scan |
| 改派 | reassign |
| 超時改派次數 | timeout reassignment count |
| 時限處置 | timeout handling |
| fallback 喚醒 | fallback wake-up |
| 派送紀錄 | assignment record |
| 超時延長次數 | timeout extensions |
| 超時停止次數 | timeout stops |
| 在途 agent | agent in flight |
| 探查 | explore |
| 元件庫 | component library |
| 共用元件 | shared component |
| 元件地圖 | component map |
| 重複實作 | duplicate implementation |
| 既有、不再新用 | existing, not for new use |
| 指示檔 | instructions file |
| 建議答案 | recommended answer |
| 參考流程 | reference flow |

## 外部語義來源

`have-it-all-done` 的第 0 節對帳 `0Miles/claude-work-mode` 的 auto mode
(`plugins/work-mode/hooks/tempo.ts` 的 `autonomousText()`,MIT)。那邊的 auto 規則改了就回來
對一次。它不在 runtime 被讀取 —— 規則已寫進 skill 本文 —— 所以不進 `references/upstream/`,
也不需要 pin 與 hash。

被自有流程取代的 matt skills(`implement`、`tdd`、`to-spec`、`to-tickets`、`research`、`code-review`)同理:
不在 runtime 被讀取,對帳用的上游路徑與取代時的 hash 記在 `docs/matt-skills.md`。

五支前端 skill 的知識來源是兩個第三方 model-invoked skill:`master-design`
(`master-co/design`,MIT)與 `modern-web-guidance`(`GoogleChrome/modern-web-guidance`,
Apache-2.0)。它們在 runtime 以 Skill tool 呼叫,不 vendor,所以同樣不進 `references/upstream/`;
缺席時的行為寫在 `build-the-ui-right/FRONTEND.md` 的「仲裁順序」一節。`FRONTEND.md` 的狀態矩陣、
無障礙底線與證據等級對帳 Master Design 的 `principles.md`、`accessibility.md` 與 `evidence.md`
(寫入時為 0.3.7),上游改了就回來對一次。

## 收尾檢查

`node scripts/check-structure.mjs`、`node scripts/check-vendored.mjs` 與 `claude plugin validate .`
機械檢查第 2、3、4(hash)、5、7 項,以及第 1 項的結構部分(檔案、標題、完成判準數、引用的檔名);
語義是否一致仍要人看。

1. 動過的每個 `src/skills/<name>/` 都有對應重寫過的 `skills/<name>/`
2. 每個 dist skill 都有 `agents/openai.yaml`,且與 src 對應檔一致
3. `SKILL.md` 以相對路徑直接引用每份 vendored runtime reference
4. Vendored 上游檔案保留 pin、來源、hash 與授權聲明;更新上游 pin 時,抓新的 tag 或發布版,
   diff 並更新 `references/upstream/`。**hash 一律取 LF 正規化後的內容**
   (`git show HEAD:<path> | sha256sum`),不要量 working tree —— checkout 會把它轉成 CRLF,
   量到的值換一台機器就對不上。更新 pin 的同一輪,把本 repo 以 Skill tool 引用的每個第三方
   skill 逐一確認仍存在且仍是 model-invoked:上游移除或改名不會讓任何檢查轉紅
5. 新 skill 已加進 `.claude-plugin/plugin.json` 的 `skills` 陣列
6. `.claude-plugin/plugin.json` 的 `version` 已 bump
7. `README.md` 的 skills 表格與 src 一致

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues (`0Miles/sorry-matt`), via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default roles, each label string equal to its role name (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
