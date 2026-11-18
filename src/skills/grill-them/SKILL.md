---
name: grill-them
description: 交由兩個 agents 自主為完善計劃或設計而進行的反覆訪談
---

# grill-them：讓兩個 agent 對打，人只看結論

把 `/grill-me` 的「拷問者 ↔ 受審者」交鋒交給兩個 subagent：**agent-griller（拷問者）**負責追問，
**agent-grillee（受審者）**勘查專案後作答。雙方透過**對打目錄**裡的檔案交換問答。你是主持人，只負責
準備題目卡、傳遞檔案路徑、開支線與整理結論；不替任何一方回答，也不代替人做最後裁決。

引數（可選）＝要拷問的計畫、決策或想法。未提供時，沿用目前對話的主題。

## 1. 製作題目卡與對打目錄

把主題整理成一張**自足的題目卡**，只放入：

- 要釐清的問題
- 理解問題不可或缺的背景
- 已知硬約束，例如 repo 路徑、期限與既定技術選擇

中性陳述資訊，不預設答案。兩個 agent 都只拿到這張題目卡，以不繼承目前對話的乾淨 context 啟動。

為本場建立一個**對打目錄**，放在 repo 之外，收場後保留：

- 環境有提供 scratchpad 目錄時（例如 harness 在 system prompt 列出的路徑），在其下建
  `grill-them-<時間戳>/`。
- 沒有時建在系統暫存目錄。macOS、Linux：`mktemp -d "${TMPDIR:-/tmp}/grill-them-XXXXXX"`。Windows 一律用
  PowerShell：`New-Item -ItemType Directory -Path (Join-Path ([IO.Path]::GetTempPath()) "grill-them-$([guid]::NewGuid())")`；
  在 Git Bash 裡 `mktemp` 回的是 `/c/...` 形式的 MSYS 路徑，別的 agent 不一定認得，不要直接交出。

不假設任何 subagent 自己的 scratchpad 在哪：目錄由主持人建立，再把它的**絕對路徑**交給雙方與每個
支線 agent。題目卡寫成目錄下的 `topic.md`。

檔名規則（`<r>` 是兩位數輪次，從 `01` 起；`<n>` 是該輪問題檔裡的題號）：

| 檔案 | 誰寫 | 內容 |
| --- | --- | --- |
| `topic.md` | 主持人 | 題目卡 |
| `round-<r>-questions.md` | agent-griller | 第 `<r>` 輪 frontier 上的全部問題，逐題編號並附建議答案 |
| `round-<r>-answers.md` | agent-grillee | 與問題檔同號的回答；待支線的題寫明缺口與支線類型 |
| `side-<r>-<n>/` | 支線 agent | 實例、執行輸出或查證 findings；結論寫在 `side-<r>-<n>/result.md` |
| `round-<r>-answer-<n>.md` | agent-grillee | 待支線題補完後的回答 |
| `verdict.md` | agent-griller | 最終判決，內容見步驟 4 |

每份檔案寫好後不再改寫；主持人不改任何一方寫的檔案。

完成判準：題目卡脫離目前對話仍能讀懂；所有必要背景與硬約束都已列入；沒有暗示答案或偏袒立場的措辭；
對打目錄在 repo 之外、以絕對路徑表示，`topic.md` 已寫入。

## 2. 讓雙方就位

先 spawn agent-griller，再 spawn agent-grillee。兩者各自只收到對打目錄的絕對路徑、上面的檔名規則與
自己的角色指令，題目卡從 `topic.md` 讀。兩者不修改 repo 與外部狀態，只在對打目錄寫自己負責的檔；
主持人只在步驟 4 沉澱共識時寫入 repo。

雙方回給主持人的訊息只含寫好的檔案路徑與狀態，不附內容：agent-griller 回報問題檔路徑，或回報結束；
agent-grillee 回報答案檔路徑，有待支線的題時再列出題號與支線類型。

- **agent-griller（拷問者）**：指示它呼叫 Skill tool 帶入 `grilling`，並把其中的「使用者」視為
  agent-grillee：向它提問就是寫 `round-<r>-questions.md`，它的回答在主持人交來的答案檔裡。`grilling`
  的行為原樣保留：它每輪一次問完 **frontier** 上的所有問題、逐題編號並附建議答案，也自行 spawn
  sub-agent 查證事實。主持人不干預這兩件事。
- **agent-grillee（受審者）**：指示它先讀取專案適用的 `CLAUDE.md` 或通用 `AGENTS.md`，再勘查相關
  docs、code 與 git 現況，從整體專案的角度作答，答案寫進同輪的 `round-<r>-answers.md`。每個事實主張
  都附出處；每個決策答案都說明取捨；資訊不足時指出缺口；問題前提與證據衝突時直接指出衝突。

對打的分工只有一條：**決策與取捨**一律由 agent-grillee 回答。**事實**兩邊都可以自己查——
agent-griller 依 `grilling` 查它要問的，agent-grillee 勘查整個專案——兩邊查到的事實衝突時，
由 agent-grillee 附出處指出衝突。

完成判準：agent-griller 已根據題目卡寫出 `round-01-questions.md`；agent-grillee 已完成必要勘查，
能以證據與取捨作答；兩者只收到對打目錄、檔名規則與各自角色指令，且都未修改 repo 或外部狀態。

## 3. 進行對打

回合以 agent-griller 的 frontier 為單位，每回合嚴格依序進行：

1. agent-griller 寫好 `round-<r>-questions.md`，回報路徑。
2. 主持人把問題檔路徑與輪次交給 agent-grillee，並給出答案檔路徑 `round-<r>-answers.md`。
3. agent-grillee 逐題作答，題號與問題檔對應，回報答案檔路徑。
4. 主持人把答案檔路徑與輪次交給 agent-griller，連同上次交回後補完的 `round-*-answer-*.md`（檔名是原題的
   輪次，可能早於本輪）。
5. agent-griller 重算 frontier，寫下一輪問題檔；判定結束時改為寫入 `verdict.md` 並回報結束。

主持人傳給雙方的訊息只含路徑與輪次：不轉述、摘要、潤飾或加入立場，也不挑題 —— 問題檔與答案檔都
整份交出。對打期間主持人不讀雙方的檔案，只看回報的路徑與狀態。

某題現有證據無法回答時，agent-grillee 在答案檔把該題標為**待支線**，寫明缺口與支線類型。該題不擋
整輪：同輪答案檔照步驟 4 先交回，主持人依回報的類型另開一條不計入回合數的**支線**，交給支線 agent
的只有問題檔與答案檔路徑、題號，以及它的輸出目錄 `side-<r>-<n>/`（這裡的 `<r>`、`<n>` 是待支線題
所屬的輪次與題號）：

- **可執行驗證**，例如狀態模型、業務邏輯或視覺化 UI：spawn subagent，要它寫一個**實例**——
  能實際跑起來、且只涵蓋該題爭點的最小案例——並真的執行它。實例與執行輸出都寫入 `side-<r>-<n>/`，
  不寫入 repo，也不建立 worktree 或分支。`side-<r>-<n>/result.md` 記實例路徑、實際跑出來的結果，
  以及它對原問題的 verdict。
- **外部事實查證**，例如 API 行為或套件文件：spawn agent，要它對一手來源（官方文件、原始碼、
  規格、第一方 API）查證，每個主張都追到擁有它的來源並附出處。findings、結論與出處寫入
  `side-<r>-<n>/result.md`，不寫入 repo。

支線 agent 只回報 `side-<r>-<n>/result.md` 的路徑。主持人把這個路徑和補完答案的路徑
`round-<r>-answer-<n>.md` 交給 agent-grillee，由它完成該題回答；補完答案在下一次步驟 4 一併交給
agent-griller。支線結果只補足證據，不替 agent-grillee 做決策。待支線題對 agent-griller 而言是未解除的
前置：只有依賴它的問題等待，其餘 frontier 照常推進。

每題最多一條支線。支線回來後證據仍不足時，agent-grillee 在補完答案寫明剩下的缺口，該題進**待裁決**；
agent-griller 判定結束或到上限時仍未回來的支線，該題同樣直接進待裁決。

人直接執行時不設回合上限：frontier 清空、且 agent-griller 判定已達成共識並無新的重大疑慮
時才結束。

**被自動流程組合時有上限。** 由 `take-this` 或 `have-it-all-done` 呼叫進來時，主持人開場就在雙方的
角色指令裡宣告上限：回合三輪（問題檔三份），支線合計兩條（`side-*` 目錄兩個）。到上限時，主持人把
最後一輪答案檔與 `verdict.md` 的路徑交給 agent-griller，由它寫最終判決；仍未收斂的題目直接進
**待裁決**交回呼叫方，不再加輪 —— 訪談是用來消滅分歧的，不是用來窮盡問題的。

完成判準：每份問題檔的每個問題，在同輪答案檔都有同號的完整回答，或已標為待支線並有對應的
`round-<r>-answer-<n>.md`；例外是支線後證據仍不足、或結束時支線未回的題目，這些都已進待裁決；每條已回來的
支線，其 `side-<r>-<n>/result.md` 都已交給 agent-grillee，並反映在補完答案中；主持人傳給雙方的每則訊息只含路徑與輪次，對打期間未讀、未改雙方的檔案，也未挑題；agent-griller
已在 `verdict.md` 記錄結束理由；被自動流程組合時，回合與支線都在上限內，超出上限的題目已進待裁決。

## 4. 收場與沉澱

`verdict.md` 是 agent-griller 的**最終判決**：結束理由；逐題裁定，以輪次與題號標明接受、戳破或存疑；
哪些論點站得住腳、哪些已被戳破，以及應如何修正。主持人隨後讀對打目錄裡的全部檔案，交付恰好四個區塊：

- **題目卡**：原始題目與硬約束。
- **交鋒摘要**：每題一行並標明所屬回合，列出問題、agent-grillee 的最終立場，以及 agent-griller
  的裁定（接受、戳破或存疑）。
- **判決**：保留的論點、暴露的弱點與修正後的決策。
- **待裁決**：雙方仍無共識，或只能由人拍板的事項。

題目涉及 repo 時，主持人再做**沉澱**：呼叫 Skill tool 帶入 `domain-modeling`，把共識術語寫入
`GLOSSARY.md` 詞彙表，並依其慣例把難以逆轉的決策記成 ADR。若沒有可沉澱項目，明確註記不適用。

完成判準：報告恰有上述四個區塊；交鋒摘要與每份問題檔逐題對帳且無遺漏；判決中的每個結論都能追溯到
對打目錄裡的問題檔、答案檔或 `verdict.md`；所有未達共識事項都在待裁決區；每個共識術語與難以逆轉的
決策均已沉澱，或已註記不適用。
