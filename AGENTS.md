# AGENTS.md — 開發這個 repo 的規則

## 結構

- `src/skills/<name>/SKILL.md` — 繁體中文原稿,**single source of truth**
- `skills/<name>/SKILL.md` — 英文 dist 版;plugin 實際載入的是這份,供人使用

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

- 對方是 **model-invoked**(目前:自家的 `grill-them`、`issue-chain`;matt 的
  `grilling`、`prototype`、`research`、`tdd`、`domain-modeling`、`codebase-design`、
  `code-review`、`resolving-merge-conflicts`)→ 可直接指名執行
- 對方是 **user-invoked** → 寫成「讀 SKILL.md 並照做」:
  - 自家的:以本 skill 載入時標示的 base directory 為起點,讀同層的
    `../<name>/SKILL.md`
  - matt 的:cache 萬用字元路徑
    `~/.claude/plugins/cache/mattpocock/mattpocock-skills/*/skills/<分類>/<name>/SKILL.md`
- 要「人」執行的指令(`/setup-matt-pocock-skills`、`/triage`、`/implement` 等
  下一步建議)措辭必須是「請使用者執行」,不能寫成 agent 的動作

### 詞彙對照

| src | dist |
| --- | --- |
| 完成判準 | Done when: |
| 對打 | duel |
| 題目卡 | topic card |
| 拷問者/受審者 | griller / respondent |
| 待裁決 | awaiting ruling |
| 支線 | side quest |
| 鏈/環 | chain / link |
| 邊 | edge |
| 互斥 | mutually exclusive |
| 線(票的分組) | line |
| 整合分支 | integration branch |
| 收輪/開輪 | close the round / open the round |
| 對帳表 | reconciliation table |
| 卡住 | stuck |
| 期間開票 | filing along the way |
| 紅燈/全綠 | red light / all green |
| 自答清單 | self-answer log |
| 硬護欄 | hard rail |
| 沉澱 | distillation |

## 收尾檢查

1. 動過的每個 `src/skills/<name>/` 都有對應重寫過的 `skills/<name>/`
2. 新 skill 已加進 `.claude-plugin/plugin.json` 的 `skills` 陣列
3. `.claude-plugin/plugin.json` 的 `version` 已 bump
4. `README.md` 的 skills 表格與 src 一致
