# 流程程式化的重新規劃

原則：**本來不需要 LLM 理解的流程，就不要交給 LLM 執行。** 主持人只做需要語義判斷的事；確定性的狀態轉移、
計算、git/gh 指令序列交給腳本；腳本已經算的規則從 prose 刪成一行呼叫；`Done when` 裡檢查得了的項目改成腳本的
斷言(gate)。

依據：外部評估報告（2026-11-19，main `28aa17b`），以及對 dist 檔逐段分類的結果（下一節）。

## 1. 現況：規則有多少是真的需要 LLM

逐段分類 `skills/get-to-work/SKILL.md` 與 `skills/have-it-all-done/ASKING.md`（bytes 以 `sed -n | wc -c` 實測，
不含空行，所以合計比檔案小幾百 bytes）：

| 類別 | 意思 | `get-to-work/SKILL.md` | `ASKING.md` |
| --- | --- | ---: | ---: |
| A 已腳本化 | prose 重述腳本或 hook 已經算的東西 | 4,514（10%） | 4,956（19%） |
| B 確定性、未腳本化 | 狀態機、算術、指令序列、格式紀錄 | **26,913（59%）** | 10,547（41%） |
| C 語義判斷 | 寫交付內容、判衝突、代答、裁決、讀回報 | 5,719（13%） | 6,315（24%） |
| D 護欄與重述 | `Done when`、重複的定義、指標 | 7,773（17%） | 3,764（15%） |

兩份合計約 71 KB，真正需要 LLM 的（C）只有約 12 KB。報告建議的「核心約 6–12 KB」不是硬縮文字，而是把 A、B、D
搬走之後自然剩下的量。

每次 `/loop` 喚醒重讀這兩份全文（`SKILL.md:86-89`、`:285-286`；`ASKING.md:327-330`）。重讀規則本身先不放寬
（#97 第 3 組的裁決照舊），但核心縮到約 10 KB 之後，同一條護欄的成本就只剩約七分之一。

### 28aa17b 又加進 prose 的確定性規則

這三條方向相反，要一併收進腳本：

- `prove-it` 的審查分級表（`skills/prove-it/SKILL.md:63-79`）：門檻 50／400 行、敏感路徑。#102 展開時用的是舊門檻
  （30／11 檔／301／101），**#102 的驗收快照已經過期**，要重新展開。
- 凍結時的「合線」：預計檔案重疊的線反覆合併直到不重疊（`get-to-work/SKILL.md:44-49`），是 union-find。
- 候選順序「解鎖最多的先」（`:325-331`），是 frontier 上的計數排序。

### 重複的規則（只留一個正本）

預算公式、階段時限名稱、派送紀錄欄位、階段列舉、本機驗證紀錄格式、用量更新時機、三個中途出口、合併授權、
`counters.json` 只讀、spawn `description` 前綴（重複 10 處以上）、合併衝突判準。這些在腳本落地後由腳本的檔頭當
正本，prose 不再各自重寫。

## 2. 目標架構

```
喚醒 → node tick.mjs            → 動作清單（JSON）
         每個動作：kind = exec | spawn | judge | ask
                   exec  → 主持人照抄一條腳本指令（integrate、verify、ci、deadline…）
                   spawn → 交付說明由 brief.mjs 填好，主持人只送路徑
                   judge → 需要語義判斷，附它要讀的 reference
                   ask   → 走 ASKING 的裁決點
         互不相依的動作標成同一批，同一回合送出（#107）
      → node tick.mjs record <結果> → state.json；腳本檢查斷言，不合法的轉移以非零結束
```

主持人入口（`get-to-work/SKILL.md`）只回答六件事：怎麼開始或恢復 run、怎麼拿到下一批動作、什麼時候 spawn、
怎麼回寫結果、哪些情況要人裁決、什麼時候停並交付。依賴圖、CI、時限、重試、預算、SHA 與冪等都在腳本裡。

腳本不能 spawn agent，也收不到回報，所以執行者仍是主持人；這不改變。

## 3. 票的重新編排

### 線 E：狀態引擎（地基，先做）

| 票 | 內容 | 狀態與調整 |
| --- | --- | --- |
| #99 | `deadline.mjs`：時限、進度指紋、四個上限 | 未整併：分支 `all-issues/99-deadline-script` @ 87f44bd，第 4 輪複驗未完成 |
| #113 | `ci.mjs` 截斷、紅 SHA 的 run id、BOM | 不變，獨立 |
| #100 | `<run>.state.json` 與階段轉移守門 | **擴充**：再收進 ledger 第 9 欄用量、本機驗證逐 SHA 紀錄（`SKILL.md:160-166`）、派送紀錄（#99 先由主持人轉抄的那部分） |
| #118 | `state.mjs check`：`Done when` 改成斷言 | 新票。七段 `Done when` 裡可檢查的項目（每次 merge 一個 SHA、`--no-ff`、origin 與本機一致、審查 `pass` 才能待整併、驗證的 SHA 等於整合分支 head…）變成腳本斷言；prose 只留「何時跑 gate、失敗怎麼辦」。blocked by #100 |
| #109 | spawn 預算依主持人 session 計數 | 不變，獨立 |

### 線 X：指令序列腳本化

| 票 | 內容 | 依賴 |
| --- | --- | --- |
| #119 `freeze.mjs` | 凍結：前置檢查（乾淨工作樹、`gh auth`）、他線佔用的檔、合線（union-find）、候選順序（解鎖最多者先，可併進 `frontier.mjs`）。輸出 JSON | 獨立 |
| #120 `brief.mjs` | 依模板填 `IMPLEMENTER.md`／`EXPANDER.md` 的佔位值、產生 spawn `description` 前綴；主持人不再為了填空讀全文 | 獨立 |
| #121 `integrate.mjs` | 整併的原子序列：`merge --no-ff` → 記 merge SHA 進 state → Local Markdown 的交付 commit → push → 清 worktree 與分支；衝突時 `merge --abort` 並回 `conflict`（要不要派整併 agent 仍是主持人判斷）。含建線與建票分支（`SKILL.md:50-51`、`:398-400`） | blocked by #100 |
| #122 `verify.mjs` | 讀 `docs/agents/commands.md` 跑本機驗證並寫逐 SHA 紀錄；契約缺檔時才回給主持人自己找 | blocked by #100 |
| #123 `merge-gate.mjs` 與紅燈／退回的指令序列 | `FINISH.md:119-142` 的 merge queue 判定（全確定性）、紅燈的 `-ci` 分支與 revert、退回的 `update-ref`。這些是按需載入的 reference，優先序最低 | blocked by #121 |

### 線 T：Tick

| 票 | 內容 | 調整 |
| --- | --- | --- |
| #101 | `tick.mjs` 與 `record` | 只 blocked by #99、#100、#113；#119–#122 落地後各自把動作種類註冊進 tick，不必等全部 |
| #107 | 同一批動作同一回合送出 | **建議併進 #101**：由 tick 的輸出標明批次，比在 prose 列舉相依更可靠；#107 關閉並註明併入 |

### 線 P：Prompt 重寫（在 E、X、T 之後）

| 票 | 內容 |
| --- | --- |
| #124 | `get-to-work/SKILL.md` 改寫成以 tick 契約為主的入口，`ASKING.md` 第 4、5、7 節刪掉腳本與 hook 已涵蓋的部分。驗收：每條刪掉的規則在對照表裡指得出接手的腳本與測試；重複規則只剩一個正本；dist 大小記在 PR，目標 `SKILL.md` ≤ 12 KB、`ASKING.md` ≤ 10 KB（目標，不是硬上限）。blocked by #101、#118–#122 |

只把 45 KB 拆成十幾個檔、主持人仍要理解同樣多的規則，不算完成這張票。

### 線 R：審查（照報告：先判級與移出主持人 context，不先刪 prove-it 的語義規則）

| 票 | 調整 |
| --- | --- |
| #102 | **重新展開**：28aa17b 已把分級表寫進 prose，這張票改成「`tier.mjs` 照 main 上的表算級別與 finder／verifier 數、lens 機械裁剪、Verifier 合批」，表從 prose 刪掉 |
| #103 | 不變，排在 #102 之後（同一份 `prove-it/SKILL.md`） |
| #108 | 不變，排在 #103 之後；這張是主持人 context 最大的一塊（46/60 份回報） |
| #104 → #105 | 不變 |

### 線 M：量測

#97 不變，第 3 組擴大為「#124 改前改後」：同一組票比主持人 token、cache 讀取、spawn 數、修正輪數、blocking finding
與交付品質。這組過關才放寬每次喚醒重讀規則檔。

### 依賴圖

```
#99 ─┐
#100 ┼─→ #101(+#107) ─┐
#113 ┘                │
#100 → #118 ───────────┤
#100 → #121 → #123       ├─→ #124 → #97 第 3 組 → 放寬重讀
#100 → #122 ───────────┤
#119、#120（獨立）────────┘
#109（獨立）
#102(重展開) → #103 → #108；#104 → #105
```

可以先平行的：#99（收尾）、#113、#109、#119、#120、#102 的重新展開。

## 4. 不在這次範圍

- 無人值守（#88–#96、#106、#112）：guard 功能，不是流程程式化。
- 前端 skills（#84、#110）。
- 腳本缺陷（#72、#73、#111）：照原票修；#111 修的是引擎的輸入，可以排進線 E 一起做。

## 5. 已做的整理（2026-11-20）

- run `2026-11-19-all-issues` 最小化收尾，不再做審查與修改：線 72、73、84、87 併入最新 main 後開總 PR #114–#117（line-84 的 `AGENTS.md` 詞彙表衝突兩邊都保留）；已在 main 的 #75、#76、#83、#98 直接關閉；ledger 標成 ended。#99 沒有整併，分支保留。
- 新開 #118–#124；#79 改成這份規劃的總票；#100、#101、#102、#97 補上調整；#107 併入 #101 後關閉；#4 關閉（#19 照舊擱置）。

## 6. `Done when` 的斷言對照（#118）

`state.mjs check <state> <gate>`（斷言在 `get-to-work/scripts/gates.mjs`，檔頭是 gate 與斷言的正本）把下列項目改成
斷言；「保留文字」的項目需要判斷，或狀態不在 state.json 與 git 裡。#118 只交付 gate 與測試：把 `Done when` 換成
「跑 `check <gate>`，失敗時怎麼辦」是 #124 的工作，這張表是它的依據。gate 失敗以 4 結束，stdout 列出每個失敗的
斷言與缺什麼，state 不變。

表中 `gate/斷言` 指 `check <gate>` 的斷言 id。

### `get-to-work/SKILL.md`

| 段落 | 項目 | 分類 |
| --- | --- | --- |
| §0 凍結 | 已選定且驗證 tracker 模式 | 保留文字（環境判斷） |
| | 每張初始票有發布出處、tracker 原生識別、blocker map | 保留文字（不在 state） |
| | 每張初始票有所屬線 | 斷言：state 結構（`load` 驗證票的 `line` 是已知整合分支）；`freeze/tickets` |
| | 被他線佔用而排除的票有佔用來源與解除條件 | 保留文字（`freeze.mjs` 的輸出，#119） |
| | 每張票有預計檔案、任兩條線不重疊 | 保留文字（`freeze.mjs`／`overlap.mjs` 已算，#119） |
| | 每條線有從同一基底尖端建立的整合分支 | 斷言：`freeze/line-branch`、`freeze/line-base` |
| | 每條線有 worktree | 斷言：`freeze/line-worktree` |
| | 獨立執行時 `budget: spawns`／`rounds` 已依票數寫定 | 保留文字（數值是判斷；行的存在見 `ledger/budget-limits`） |
| | 整合分支上有 `docs/agents/commands.md`，在派出任何票之前 | 斷言：`freeze/commands-contract`、`freeze/not-dispatched` |
| 讀 CI | 該讀 CI 的線讀了最新 SHA 的結果並記下 | 斷言：`ci/ci-latest` |
| | 本機驗證的線每個驗過的 SHA 都有紀錄 | 斷言：`ci/local-record`（tip 的紀錄；`state.mjs local` 拒絕同一 SHA 第二筆） |
| | 有 CI 的線上 `no-verdict` 的本機驗證也有紀錄 | 保留文字（是否走了 `no-verdict` 是主持人的判斷） |
| 預算與斷路 | 每個派票點先更新用量、判進展與上限 | 保留文字（順序；交給 #101 的 tick） |
| | 收票結束都更新了用量 | 保留文字（時機） |
| | 停下之後沒有再派票 | 斷言：`stopped/no-dispatch-after-stop` |
| | 未交付的票標待裁決並寫出停在哪個上限 | 斷言：`stopped/undispatched-set-aside`、`stopped/stop-reason` |
| | 第 9 欄有停止原因 | 斷言：`stopped/stop-recorded`（停止原因已移進 state 的 `stop`） |
| | 被預算擋下的 spawn 沒有重試或換路 | 保留文字（hook 擋，`hooks/budget.mjs`） |
| 時限 | 每次派送有派送紀錄（agent id、類型、派送時間、時限、到期時間、指紋） | 斷言：`dispatch/assignment`、`wake-end/assignment`（欄位齊全由 `state.mjs assign` 的格式檢查保證） |
| | spawn `description` 以角色字開頭、後接票的識別碼 | 保留文字（`spawns.mjs`、`brief.mjs` 已腳本化） |
| | 每次喚醒處理回報後掃描每個在途 agent | 保留文字（順序；`deadline.mjs scan`） |
| | 舊 agent 的回報沒有被收 | 保留文字（判斷） |
| | 喚醒結束時有在途 agent 就排了 fallback 喚醒，背景 `sleep` 至多一個 | 斷言：`wake-end/fallback-wake`（`sleepTask` 只有一格，所以至多一個是結構保證） |
| 派票 | 先判上限、再讀 CI，才往下派 | 保留文字（順序；交給 #101） |
| | 派出的票在 spawn 前有驗收項、驗收快照與預計檔案 | 斷言：`dispatch/snapshot`（也是 `stage implementing` 的守門）；驗收項與預計檔案保留文字（`acceptance.mjs`、`overlap.mjs`） |
| | 展開補上的驗收項出自展開 agent 並標明 `by`、`run`、`round` | 保留文字（`acceptance.mjs` 已腳本化） |
| | 展開中的票沒有被重複送去展開 | 保留文字（`stage` 的邊已擋 expanding → expanding） |
| | 每個派票點有 `overlap.mjs` 的計畫檔與輸出，`start` 全部派出，不與在途的票重疊 | 保留文字（`overlap.mjs` 已腳本化） |
| | frontier 每張票都已展開中、在途、在 `wait` 或待裁決 | 保留文字（需要 frontier 輸出；交給 #101） |
| | 實作 agent 的 prompt 是填好的 `IMPLEMENTER.md` | 保留文字（`brief.mjs`，#120） |
| 收票 | 回報的票沒等其他票就進了收票 | 保留文字（時機） |
| | 每張票恰好一次獨立審查，每輪修正後各一次 `recheck` | 斷言：`review/one-initial`、`review/recheck-per-fix` |
| | 每次呼叫附驗收比對、結論寫進接續紀錄 | 保留文字（內容） |
| | 交修的內容是 `findings` 原文 | 保留文字（內容） |
| | 修正輪數不超過二並記下 | 斷言：`review/fix-rounds`（也是 `stage fixing` 的守門） |
| | 進待整併前最近一次審查是 `pass` | 斷言：`review/queued-review`（與 `stage queued` 共用同一個守門函式） |
| | 有觀察或 pre-existing 的票都有 raw ticket | 保留文字（判斷） |
| | 針對性檢查回到綠，有交付或卡住紀錄 | 保留文字（`verify.mjs`，#122） |
| | 專項 reviewer 指名了風險 | 保留文字（判斷） |
| | 每條線同一時間至多一張票在整併 | 斷言：`dispatch/one-integrating`、`merged/one-integrating` |
| | 紅燈處置中的線沒有票被整併 | 保留文字（紅燈處置的狀態不在 state；`merge-gate.mjs`，#123） |
| | 每次整併是帶 git 預設 message 的 `--no-ff` merge commit | 斷言：`merged/no-ff`、`integrated/no-ff` |
| | SHA 記進了對帳表，每次整併恰好一個 | 斷言：`merged/one-merge`、`merged/branch-recorded`、`merged/on-line`、`merged/tip-recorded` |
| | 衝突解法只在 merge commit 裡，ticket 分支沒有被改寫 | 斷言：`merged/not-rewritten`（清理前跑；清理後分支已不在） |
| | 每次整併之後都做了派票點 | 保留文字（順序；交給 #101） |
| | 接續紀錄寫到最新 | 保留文字（內容） |
| | 成功票已整併並清理 ticket worktree 與本地分支 | 斷言：`integrated/stage`、`integrated/cleaned` |
| | 有 `origin` 的線每次整併各 push 一次；喚醒結束時 `origin/<整合分支>` 與本地同 SHA | 斷言：`integrated/pushed`、`wake-end/pushed`（`git ls-remote`，不信任 remote-tracking ref） |
| 期間開票 | 每張初始票恰好對帳為已交付、卡住或待裁決 | 斷言：`finish/end-state`、`finish/end-reason`、`finish/delivered-merge` |
| | 期間新開的 raw tickets 有來源連結，沒有混入凍結票集 | 保留文字（tracker 內容） |

`FINISH.md` 的完成判準不在七段之內，其中可檢查的也進了 `finish`：一次併入基底（`finish/base-sync`）、完整驗證是
整合分支最新 SHA 的結果（`finish/full-verification`：記下的 CI 結論 green／red 或本機驗證紀錄的 SHA 等於本地 tip）、
tip 已記下且已 push（`finish/tip-recorded`、`finish/pushed`）、所有 ticket worktree 與本地分支已移除（`finish/cleaned`）。
ledger 的 ended 標記是 `ledger --ended`。

### `have-it-all-done/ASKING.md`

| 段落 | 項目 | 分類 |
| --- | --- | --- |
| §1 提問前置檢查 | 每個提問通過三關；新建的環境產物已落檔 | 保留文字（判斷） |
| §2 什麼該問 | 每個提問歸到四類之一；其餘已代答 | 保留文字（判斷） |
| §3 什麼該代答 | 非四類決定記在其中一層，每列五欄俱全 | 保留文字（自答清單是敘事欄位；五欄可在 #124 決定是否腳本化） |
| §4 裁決點與節流 | 恰好一個裁決點，之後沒有提問 | 保留文字（對話層） |
| | 中途事項都有落點 | 保留文字（判斷） |
| | `budget: spawns`／`rounds` 已在裁決點前依票數改寫 | 保留文字（數值是判斷；行的存在見 `ledger/budget-limits`） |
| §5 授權 | 需要授權的動作以正規指令送出，結果記進第 5 欄 | 保留文字（guard hook 擋，紀錄是敘事） |
| | 需要確認的動作在確認後才執行或列進人工作業清單 | 保留文字（guard hook） |
| | 被擋下的動作在人工作業清單並附片段或指令 | 保留文字（內容） |
| | 沒有寫入任何設定檔 | 保留文字（guard hook 擋） |
| §6 語言與對外文字 | 每個提問與對外文字符合四條 | 保留文字（判斷） |
| §7 run ledger | 第一行是與 run 狀態相符的標記 | 斷言：`ledger/marker`（`--ended` 檢查 ended） |
| | 十個欄位都有內容或明記「無」 | 斷言：`ledger/fields` |
| | 第 9 欄四行上限、四行階段時限 | 斷言：`ledger/budget-limits`、`ledger/stage-limits` |
| | 第 9 欄最新用量 | 保留文字 → 用量已移進 state（#100），由 `state.mjs usage` 寫 |
| | 讀得到 session id 時一行相符的 `session:` | 斷言：`ledger/session` |
| | 第 10 欄列出規則檔的絕對路徑 | 斷言：`ledger/rule-files`（「從建立時就」是時機，保留文字） |
| | 恢復的第一個動作是重讀 ledger 與規則檔 | 保留文字（順序；`hooks/reread.mjs` 提示） |
| | 沒有共用目錄時已明記正本改為最終報告 | 保留文字 |
| | 主持人上下文沒有 diff、日誌或報告原文 | 保留文字（判斷） |

### `prove-it/SKILL.md`

`prove-it` 在審查 agent 裡執行，它的中間產物（候選、裁決、突變紀錄、審查用 worktree）不在 state.json，主持人也
不該讀它們，所以七段都保留文字，只有結論層的兩項由 state 守住：

| 段落 | 項目 | 分類 |
| --- | --- | --- |
| §1 輸入與開審 | 輸入齊全；前提不成立輸出 `stuck`；驗收被改過記 finding；worktree 在分支尖端、diff 存檔 | 保留文字（審查 agent 內部） |
| | `tier` 取自判級指令的輸出，或失敗時是 `full` | 保留文字（`tier.mjs` 已腳本化） |
| §2 Finder | finder 都回報；去重；每則有 `suspected`；每個 hunk 經過逐行 lens | 保留文字 |
| §3 實跑與突變 | 實跑記錄；突變範圍與上限；mutant 都有結果；worktree 乾淨；存活成候選 | 保留文字（`mutate.mjs` 已腳本化範圍與上限） |
| §4 Verifier | 每個候選恰有一項裁決與證據；finding 有 `rule` 與修法方向 | 保留文字 |
| §5 結論 | 結論恰為三者之一 | 斷言：`state.mjs review --verdict` 只收 pass／fix／stuck（既有守門） |
| | 由驗收比對與分流推得；`rule` 出自 verifier | 保留文字 |
| §6 輸出 | 區塊格式；只有一個最新 review 區塊；沒有 PR 評語；worktree 已移除 | 保留文字（tracker 內容） |
| §7 複驗 | 每則舊 finding 有 Fix Verifier 裁決；實跑與突變範圍；新 finding 在修正行上；寫進接續紀錄 | 保留文字；「每輪修正後一次複驗」由 `review/recheck-per-fix` 在主持人側檢查 |
