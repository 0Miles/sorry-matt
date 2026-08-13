---
name: take-this
description: 承接既有 grilling，將新任務整理成可執行的 spec 與 tickets
disable-model-invocation: true
---

# take-this：替新任務完成開局

引數是任務描述，或明確指向既有 grilling 成果或文件；未提供時沿用目前對話。

## 1. 鎖定 tracker 與脈絡

第一個動作是讀 `docs/agents/issue-tracker.md`；不存在時，請使用者執行
`/setup-matt-pocock-skills`，取得設定後再繼續。後續的發布位置、識別格式與 triage 表示
均依該設定。

整段依序完成「需求脈絡 → to-spec → to-tickets」，並維持同一份連續脈絡；to-tickets 完成
前，保留這份脈絡。若接近 smart zone，在任何 compact 前解析並照做
`~/.claude/plugins/cache/mattpocock/mattpocock-skills/*/skills/productivity/handoff/SKILL.md`
（版本段用萬用字元），把完整脈絡交到新 session，再從中斷處繼續。

完成判準：已讀取 configured tracker；目前 context 或 handoff 同時保有任務輸入、既有
grilling 成果與後續步驟所需資訊。

## 2. 建立需求脈絡

**承接優先**：先找與本任務明確對應、且已完成的 `grill-me`、`grill-with-docs` 或
`grill-them` 成果。來源可以是目前 session，也可以由引數或 handoff 帶入。找到時直接承接；
若多份成果都可能對應本任務，請使用者指定。沒有可承接成果時，才執行 `grill-them`。

依來源整理成一份**需求脈絡**：

- `grill-me`：使用者確認的 shared understanding、決策、約束、被否決選項及理由、未解問題。
- `grill-with-docs`：上述內容，加上該次 grilling 建立或修改的 ADR、glossary 與其他文件
  路徑。文件本身是 `to-spec` 的輸入，仍須對帳其中的決策。
- `grill-them`：題目卡、對打摘要、判決、待裁決與沉澱文件。agent-grillee 對待裁決已有明確
  立場時採用該立場，其餘保留為 open question。

需求脈絡涵蓋任務範圍、已定決策、硬約束、查證事實及出處、被否決選項、open questions
與適用文件路徑；每項均標明來自使用者、agent-grillee 或哪份文件。

完成判準：已記錄採用的 grilling 來源；逐項對帳後，上述資訊不重不漏地進入需求脈絡；承接
既有成果時，該成果是本次唯一的 grilling 輸入。

## 3. 寫成 spec（to-spec）

解析
`~/.claude/plugins/cache/mattpocock/mattpocock-skills/*/skills/engineering/to-spec/SKILL.md`
（版本段用萬用字元），以完整需求脈絡照做全文，完成其 seam 與使用者確認。Open questions
放入 Further Notes 或 Out of Scope；requirements 僅保留採用的選項。

完成判準：spec 已發布到 configured tracker，逐項涵蓋需求脈絡，並以 provider 原生方式標成
`ready-for-agent`；已記錄其 GitHub URL 或 Local Markdown 路徑。

## 4. 切成 tickets（to-tickets）

解析同一 cache 目錄的 `skills/engineering/to-tickets/SKILL.md`，以剛發布的 spec 照做全文，
完成其切票與阻塞關係確認。

完成判準：所有 tickets 均發布到同一 configured tracker；每張票的範圍與阻塞邊均已確認，
並記錄 GitHub 識別／URL 或 Local Markdown `NN`／路徑。

## 5. 交接 frontier

輸出需求脈絡來源、spec 識別、附阻塞邊的完整票列表、**frontier**，以及一個可立即執行的
**下一步**。每張票在新的 session 中執行 `/implement`；需要重建全局時執行 `/issue-chain`。

完成判準：每張已發布 ticket 都出現在輸出中，並保留後續 skill 可直接讀取的 provider 原生
識別；frontier 與阻塞邊一致，且下一步指向其中一張可立即執行的票。
