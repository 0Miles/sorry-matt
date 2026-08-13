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
