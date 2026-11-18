---
name: take-this
description: 承接既有 grilling，將新任務整理成可執行的 spec 與 tickets
disable-model-invocation: true
---

# take-this：替新任務完成開局

引數是任務描述，或明確指向既有 grilling 成果或文件；未提供時沿用目前對話。

## 1. 鎖定 tracker 與脈絡

以本 skill 載入時標示的 base directory 為起點，讀同層的
[`../have-it-all-done/ASKING.md`](../have-it-all-done/ASKING.md) 全文，依它第 0 節開場；後續的
發布位置、識別格式與 triage 表示均依 tracker 設定。全程依 `ASKING.md` 行事：能寫出建議就依
第 3 節代答，不先問；只有落在第 2 節四類的事項才留著，交給裁決點一次問完。

**兩種情境。** 使用者直接執行時，本檔與 `ASKING.md` 寫「請使用者……」的地方照字面問人。由
`have-it-all-done` 組合、以開局 agent 執行時問不到使用者：tracker 設定不存在就停下並回報給
主持人；多份 grilling 成果都可能對應本任務時，依證據擇一並記進代答清單，證據不足以擇一就標
待裁決回報；其餘「請使用者……」一律改為寫進回報，交給主持人。

整段依序完成「需求脈絡 → spec → tickets」，並維持同一份連續脈絡；tickets 發布前，保留這份
脈絡。若接近 smart zone，在任何 compact 前完整讀取並執行
[pinned handoff 流程](references/upstream/handoff.md)，再從中斷處繼續。

完成判準：已讀取 configured tracker；目前 context 或 handoff 同時保有任務輸入、既有
grilling 成果與後續步驟所需資訊。

## 2. 建立需求脈絡

**承接優先**：先找與本任務明確對應、且已完成的 `grill-me`、`grill-with-docs` 或
`grill-them` 成果。來源可以是目前 session，也可以由引數或 handoff 帶入。找到時直接承接；
若多份成果都可能對應本任務，請使用者指定（被組合時依第 1 節的情境規則處理）。

沒有可承接成果時**預設不開訪談**：自行從 tracker、repo 檔案與 git 歷史的證據建立需求脈絡，
不確定的事依 `ASKING.md` 第 3 節代答。只有命中**重大分歧**才呼叫 Skill tool 帶入
`grill-them` —— 跨模組的介面、資料模型、對外行為，或難以反轉而且沒有測試防護的決策。
四項都沒命中就不開，理由記進代答清單。

依來源整理成一份**需求脈絡**：

- `grill-me`：使用者確認的 shared understanding、決策、約束、被否決選項及理由、未解問題。
- `grill-with-docs`：上述內容，加上該次 grilling 建立或修改的 ADR、glossary 與其他文件
  路徑。文件本身是 spec 的輸入，仍須對帳其中的決策。
- `grill-them`：題目卡、對打摘要、判決、待裁決與沉澱文件。agent-grillee 對待裁決已有明確
  立場時採用該立場，其餘保留為 open question。

需求脈絡涵蓋任務範圍、已定決策、硬約束、查證事實及出處、被否決選項、open questions
與適用文件路徑；每項均標明來自使用者、agent-grillee 或哪份文件。

完成判準：已記錄採用的 grilling 來源；逐項對帳後，上述資訊不重不漏地進入需求脈絡；承接
既有成果時，該成果是本次唯一的 grilling 輸入。

## 3. 寫成 spec

不開訪談，只綜合需求脈絡與 codebase 現況：

1. 勘查 repo 的現況。spec 全程使用專案 glossary 的詞彙，並遵守相關範圍的 ADR。
2. 草擬測試的 **seams**：優先沿用既有 seam，取最高的那層；需要新 seam 時也提在最高處。
   seam 越少越好，理想是一個。seam 依 `ASKING.md` 第 3 節代答，寫進 spec 的 Testing
   Decisions —— tickets 與實作 agent 都以它為準。
3. 依 [`TEMPLATES.md`](TEMPLATES.md) 的 spec 模板撰寫，發布到 tracker，以 provider 原生方式
   標成 `ready-for-agent`。

完成判準：spec 已發布到 configured tracker，逐項涵蓋需求脈絡，Testing Decisions 寫明
seams，並以 provider 原生方式標成 `ready-for-agent`；已記錄其 GitHub URL 或 Local
Markdown 路徑。

## 4. 切成 tickets

以剛發布的 spec 為輸入，切成 **tracer bullet** 垂直切片：

- 每張票窄而完整地穿過每一層（schema、API、UI、測試），完成後能單獨展示或驗證，大小能在
  一個全新的 context window 內做完。前置重構排最前：先讓改動變容易，再做容易的改動。
- **大範圍重構例外**：一個機械式改動（改欄位名、改共用型別）波及整個 codebase、沒有垂直
  切片能綠著落地時，改用 **expand–contract**：先讓新形式與舊形式並存（expand）；再依波及
  範圍分批遷移呼叫點，每批一張、被 expand 阻擋，舊形式還在所以每批都綠；最後刪掉舊形式
  （contract），被每一批阻擋。連分批都無法各自綠時，保留順序，讓它們共用一條整合分支，
  全部阻擋一張最終的整合驗證票，綠燈只在那張保證。
- 每張票列出**阻塞邊**：開工前必須完成的票。沒有 blocker 的票可以立即開工。
- 粒度、阻塞邊、合併或拆分都依 `ASKING.md` 第 3 節代答，不逐張問。
- 深度只給到下一張可執行的票：frontier 上的票現在就寫滿驗收項；被阻塞的票先留範圍、
  阻塞邊與未決問題，驗收項延到它即將進入 frontier 時，由 `get-to-work` 開輪的展開 agent 在
  實作開工前補滿，不交給實作 agent。上游實作會改寫下游的事實，提前寫好的細節就是要重寫的細節。
- 票與 spec 都不寫具體檔案路徑或程式片段，它們很快就過期。例外：prototype 產生的片段比
  文字更精確地表達某個決策（狀態機、reducer、schema、型別）時，只節錄決策部分並註明出處。

依阻塞順序（blocker 先）用 [`TEMPLATES.md`](TEMPLATES.md) 的票模板發布：

- **Local Markdown**：一票一檔，`.scratch/<feature-slug>/issues/<NN>-<slug>.md`，從 `01` 依
  阻塞順序編號，不合併成單一檔案。
- **GitHub**：一票一個 issue。阻塞邊用平台原生的阻塞關係，沒有時寫進票面的 Blocked by。
  來源是既有 issue 時，依 tracker 設定把每張票設成它的 sub-issue。標上 `ready-for-agent`。
- 不關閉、也不修改母票。

完成判準：所有 tickets 均發布到同一 configured tracker；frontier 上的票有完整驗收項，被
阻塞的票至少有範圍、阻塞邊與未決問題；每張票的阻塞邊均已確認，並記錄 GitHub 識別／URL
或 Local Markdown `NN`／路徑。

## 5. 交接 frontier

輸出需求脈絡來源、spec 識別、附阻塞邊的完整票列表、**frontier**、**本次代答清單**（依
`ASKING.md` 第 3 節分層，這裡只收反轉成本跨票的那些），以及一個可立即執行的**下一步**：
請使用者執行 `/get-to-work` 清票；需要重建全局時請使用者執行 `/issue-chain`。

代答清單同時是裁決點的題庫：由 `have-it-all-done` 組合時，它依反轉成本從這份清單取出
最高的幾項，連同第 2 節四類的待裁事項一次問完。

完成判準：每張已發布 ticket 都出現在輸出中，並保留後續 skill 可直接讀取的 provider 原生
識別；frontier 與阻塞邊一致，且下一步指向可立即執行的票；每個代答都在代答清單上
且五欄俱全。
