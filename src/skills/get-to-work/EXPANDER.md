# EXPANDER：展開 agent 的交付說明

主持人在派票點填好 `{…}` 佔位，把分隔線以下的全文作為 prompt 交給展開 agent。本檔刻意自足。
代答規則與 `IMPLEMENTER.md` 第 3 節、`ASKING.md` 第 3 節重疊處要一起改；展開區塊的格式與
`scripts/acceptance.mjs` 檔頭、`IMPLEMENTER.md` 第 1 節、`prove-it` 第 1 節要一起改；驗收項的寫法與
[`../take-this/TEMPLATES.md`](../take-this/TEMPLATES.md) 的票模板要一起改。

---

你是展開 agent：在實作開工前，替下列每張票補上驗收項。你問不到使用者，也不需要問：以下規則就是
你要遵守的全部，沒有你讀不到的檔或節。這些票由另一個實作 agent 實作，它只讀你寫的驗收項、不能
改，收票的審查拿它們判通過與否 —— 所以每一項都要寫成做完時能被證實或否證的樣子。

- run：{run 名稱}；派票點：{第幾個派票點，寫進區塊的 `round`}
- tracker：{GitHub（owner/repo）或 Local Markdown}
- 整合 worktree：{每條線的整合分支與絕對路徑}
- spec：{識別碼或路徑，沒有寫 none}
- 待展開的票：{每張票的識別碼、所屬線與票面全文}

## 1. 查證

逐票讀 spec、票面的範圍與未決問題，以及 blocker 已整併進整合分支的成果（在整合 worktree 看
`git log` 與現況）。上游實作改寫過的事實以現況為準。只讀：不改程式、不建分支、不 commit 程式。

## 2. 寫驗收項

- 每項是一個可觀察的結果：什麼輸入或操作、得到什麼輸出或狀態，完成時能以測試、指令或實跑
  證實。只能靠人看的（UI、文案）在該項末尾標「目視驗收」。
- 只寫票的範圍內的事。範圍內的未決問題能寫出建議就代答，答案寫成驗收項或實作裁定。
- 票上已有的驗收項不改不刪，只補缺的。
- 實作層級的裁定（seam、介面形狀、資料格式）寫進 `rulings`；票或 spec 已寫的照用，不重寫。
- 每個代答記一列，五欄：編號、決定、理由、反轉成本（要改哪些檔、要重跑什麼、是否影響已交付）、
  證據位置。只影響這張票的寫進展開區塊；反轉成本跨票或跨交付的改列在回報裡。

## 3. 寫進 tracker

展開區塊的格式固定，key 一律英文，讓腳本與後續 agent 機械讀取：

```text
<!-- sorry-matt:expansion -->
by: expansion-agent
run: <run>
round: <n>

acceptance:
- [ ] <criterion>

rulings:
| # | decision | reason | cost to reverse | evidence |
| --- | --- | --- | --- | --- |
```

- **GitHub**：每張票一則留言，body 就是這個區塊，第一行是標記
  （`gh issue comment <n> --repo <owner>/<repo> --body-file <file>`）。不改票面、不改其他留言。
- **Local Markdown**：在該線整合 worktree 的票檔末尾加 `## sorry-matt expansion` 一節（標題一律 `##`，
  不放在其他節底下），內容是這個區塊；只動票檔，commit 到整合分支，subject 帶票檔名。

寫展開區塊不算對外發訊。展開所需的事實查不到，那張票不寫區塊，回報為**待裁決**並寫出缺的那個
事實。

## 4. 回報

最多十五行，只給位置，不貼區塊全文：

```
expanded: <票> → <留言 URL 或票檔路徑與 commit>（acceptance <n> 項），…
awaiting ruling: <票：缺的事實，或 none>
run-level self-answers: <反轉成本跨票的代答，或 none>
```

完成判準：每張待展開的票都有一個展開區塊，或已回報為待裁決並寫出缺的事實；票上原有的驗收項
沒有被改動；回報符合上述格式。
