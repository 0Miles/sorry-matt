# AGENTS.md — 開發這個 repo 的規則

## 結構

- `src/skills/<name>/SKILL.md` — 繁體中文原稿,**single source of truth**
- `src/skills/<name>/agents/openai.yaml` — OpenAI UI 與 invocation metadata 原稿
- `src/skills/<name>/references/upstream/` — runtime 直接讀取、亦供升級對帳的 pinned 上游原文
- `src/skills/<name>/<REFERENCE>.md` — 只有部分 branch 會走到的自有 reference,由 `SKILL.md`
  以相對路徑指標帶入(如 `review-pr/FOLLOW-UP.md`)
- `skills/<name>/SKILL.md` — 英文 dist 版;plugin 實際載入的是這份,供人使用
- `skills/<name>/agents/openai.yaml` — 與 src 同步的 OpenAI metadata dist 版
- `skills/<name>/references/upstream/` — 與 src 相同的 pinned 上游原文
- `skills/<name>/<REFERENCE>.md` — 與 src 對應的英文 dist 版自有 reference

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

## 跨 skill 組合

Model 只能用 Skill tool 呼叫 **model-invoked**(frontmatter 沒有
`disable-model-invocation: true`)的 skills;user-invoked 的不在 model 的可呼叫清單上,
skill 之間也 reach 不到 —— 寫成「執行 <user-invoked skill>」的指令會讓 agent 攤手
自己模擬。skill 內文引用其他 skill 時:

- 對方是 **model-invoked**(目前:自家的 `grill-them`、`issue-chain`、`speak-human`、
  `no-bullshit`、`clean-it-up`;matt 的 `grilling`、`prototype`、`research`、`tdd`、`domain-modeling`、
  `codebase-design`、`code-review`、`resolving-merge-conflicts`)→ 措辭必須明寫
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
| 收輪/開輪 | close the round / open the round |
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

## 收尾檢查

1. 動過的每個 `src/skills/<name>/` 都有對應重寫過的 `skills/<name>/`
2. 每個 dist skill 都有 `agents/openai.yaml`,且與 src 對應檔一致
3. `SKILL.md` 以相對路徑直接引用每份 vendored runtime reference
4. Vendored 上游檔案保留 pin、來源、hash 與授權聲明;更新上游 pin 時,抓新的 tag 或發布版,
   diff 並更新 `references/upstream/`。**hash 一律取 LF 正規化後的內容**
   (`git show HEAD:<path> | sha256sum`),不要量 working tree —— checkout 會把它轉成 CRLF,
   量到的值換一台機器就對不上
5. 新 skill 已加進 `.claude-plugin/plugin.json` 的 `skills` 陣列
6. `.claude-plugin/plugin.json` 的 `version` 已 bump
7. `README.md` 的 skills 表格與 src 一致
