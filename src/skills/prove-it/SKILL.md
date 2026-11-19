---
name: prove-it
description: sorry-matt 流程專用的票級獨立審查：以證據鏈（Finder → Verifier → Fix Verifier）、實跑與只限本票 diff 的突變審一張票的 ticket 分支，輸出 pass／fix／stuck 的固定格式結論與 finding 清單，寫進該票的接續紀錄。由 get-to-work 收票時 spawn 的審查主持 agent 呼叫；不發 PR 評語、不產 suggestion。
---

# prove-it：審一張票，舉證到底

sorry-matt 自動流程收票時的**獨立審查**，一張票一次。證據鏈沿用 `review-pr`：Finder 找候選，
Verifier 獨立裁決，集中修正後由 Fix Verifier 複驗。差別在讀者：這裡的讀者是**審查主持 agent**，不是 PR
作者 —— 不發 PR 評語、不產 `suggestion` 區塊、不對外留言，只輸出第 6 節的固定格式結論，寫進
該票的接續紀錄。

審查主持 agent 就是你：`get-to-work` 收票時以前景 spawn、照它的交付說明（`get-to-work/REVIEWER.md`）
主持一張票的審查。本 skill 的每一步由你做，finder、verifier 與 Fix Verifier 由你 spawn，是主持人底下的第二層；
它們的回報只進你的 context。**呼叫方**是 `get-to-work` 的主持人：它給第 1 節的輸入，只收第 6 節末的固定格式
回報，不載入本 skill，也不讀 finding 全文。

**舉證責任在你身上**：通過要有證據，不是「沒找到問題」。測試抓不抓得到缺陷由審查方以突變
證明，實作者的說法與新增的測試行數都不算。

## 1. 輸入與開審

呼叫方給：

- **票**：tracker 原生識別碼、原票票面全文，以及開頭是 `<!-- sorry-matt:expansion -->` 的展開
  區塊（有的話）。
- **驗收快照與比對**：實作開工前存下的驗收快照，與交付後對它的比對輸出（兩者都是
  `sorry-matt/acceptance@1`，比對輸出多一個 `check`）。快照的 `items` 是本次的驗收項，每項標出處：
  `from: original` 來自原票，`from: expansion` 是展開時補上的，附 `by`、`run`、`round`。
- **fixed point**：線整合分支。
- **待審 ref**：ticket 分支。
- **針對性檢查結果**：實作 agent 回報的指令與結果。只用來確認是綠的；實跑的指令由審查方自己選（第 3 節）。
- **CI 覆蓋**：這條線的整合分支整併後有沒有 CI 跑全套 —— `covered`、`uncovered`（呼叫方已定案為 CI 不涵蓋整合
  分支）或 `no-origin`（沒有 `origin`）。沒給時由第 3 節的範圍指令依有沒有 `origin` 判。
- **模式**：`initial`（初審），或 `recheck`（集中修正後的複驗，走第 7 節）。
- **接續紀錄**：該票接續紀錄的位置 —— GitHub 是第一行為 `<!-- sorry-matt:status -->` 的那則留言，Local Markdown
  是票檔。審查區塊寫在這裡（第 6 節）。
- **上一次的審查區塊**：複驗，或審中 `stuck` 排除後續跑（第 5 節）時，就是接續紀錄裡現在那個 `sorry-matt:review`
  區塊，由你自己讀；初審沒有。
- **reviewer**：預設只有 `primary`，也就是本 skill 自己的 Finder 組。

逐項確認，任一項不成立就不開審，以第 6 節格式輸出 `verdict: stuck` 並寫明是哪一項：

- `git rev-parse` 解得到 fixed point 與 ticket 分支，`git diff <fixed point>...<ticket 分支>` 非空。
- 針對性檢查是綠的。紅燈是實作 agent 的事，審查只收綠燈的票。
- 驗收快照與比對輸出都在，`id` 是這張票，快照至少有一項驗收。
- 你有 Agent tool。spawn 深度到了上限（Claude Code 的 `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`）時拿不到它；這時
  不自己兼任 finder、verifier 或 Fix Verifier —— 證據鏈要的是各自獨立的 agent —— `stuck` 的原因寫 `no Agent tool`。

**驗收被改過就不通過。** 比對輸出的 `check.changed` 為 true 時（含 `check.snapshotIntact` 為 false：快照本身被改過），直接記一則 blocking finding
（lens `acceptance`），不經 Finder 與 Verifier：證據是比對輸出的路徑與 `removed`／`added`，修法方向
是把 tracker 上的驗收恢復成快照，要改的項目由實作 agent 回報為待裁決。審查照常進行，驗收對照一律
以快照為準，不以改過的版本為準。

在 scratchpad 開**審查用 worktree**，實跑與突變都只在這裡做，實作 agent 的 worktree 保持原狀。在 repo 內執行：

```bash
node "${CLAUDE_SKILL_DIR}/scripts/worktree.mjs" open --path <scratchpad>/review-<票> --ref <ticket 分支> > <scratchpad>/review-<票>-r<round>-worktree.json
git -C <repo> diff <fixed point>...<ticket 分支> > <scratchpad>/review-<票>.diff
```

**一張票只建一次審查用 worktree**：初審建立，複驗（第 7 節）以同一條指令沿用、移到修正後的尖端，結論定案後才
移除（第 6 節）。`open` 的判斷與輸出寫在腳本檔頭：`created` 是新建，`reused` 是沿用，`rebuilt` 是上一輪留下了
改動、丟掉重建。輸出的 `install` 為 true 時照 lockfile 還原相依（`npm ci`、`pnpm install --frozen-lockfile`
這類凍結寫法），為 false 時沿用既有安裝。不加相依、不下載新工具 —— 審查不改這張票的 diff 與 repo 相依。
新檔行號一律取自 `git show <ticket 分支>:<path>`。

**審查分級**在這裡由 diff 判一次，寫進審查區塊的 `tier`，整張票（含複驗）沿用。它決定 finder 的數量與各自的
lens、verifier 與 Fix Verifier 的合批方式和突變上限。在審查用 worktree 的根目錄執行**判級指令**：

```bash
node "${CLAUDE_SKILL_DIR}/scripts/tier.mjs" judge --base <fixed point> --head <ticket 分支> > <scratchpad>/review-<票>-tier.json 2> <scratchpad>/review-<票>-tier.err
```

輸出格式、訊號的算法、門檻與覆寫旗標都寫在腳本檔頭；照輸出讀，不自己重算：

- `tier`：寫進審查區塊。`reasons` 是判到這一級的條件。
- `finders`：第 2 節照它派 Finder。
- `verifiers.max`、`fixVerifiers`：第 4、7 節照它合批。
- `mutationCap`：第 3 節的突變上限；`null` 表示只動說明文字，沒有可執行的行。

判級指令以非 0 結束時，`tier` 當成 `full`，`finders` 當成 `[["line-by-line","deleted-behaviour"],["cross-file"],["acceptance","conventions"]]`，
突變上限 10，第 4、7 節用 `--tier full`；`<scratchpad>/review-<票>-tier.err` 的路徑補進接續紀錄的「證據路徑」欄。

完成判準：輸入齊全；不成立的前提已輸出 `stuck` 並停止；驗收被改過時已記下 `acceptance` finding；
審查用 worktree 由 `worktree.mjs open` 開在 ticket 分支尖端，相依依 `install` 處理，diff 已存檔；`tier` 取自判級指令的輸出，或在它失敗時是 `full`。

## 2. Finder：平行找候選

判級輸出的 `finders` 每個內層陣列派一個 finder，套用陣列裡列的 lens，同一則訊息一次派出，Agent tool 的
`description` 是 `finder` 後接票的識別碼。`pruned` 列的 lens 已依 diff 機械裁剪，不派、不寫進任何 prompt：沒有
刪除行不派被刪除的行為，沒有規則檔涵蓋改動檔不派 repo 慣例，簽章沒變時跨檔案契約併入逐行。

本 skill 的 finder、verifier（第 4 節）與 Fix Verifier（第 7 節）一律由你以前景派送：你在自己的
回合裡等它們全部回來才往下，而你本身也是呼叫方以前景派出的。`get-to-work` 不給審查設時限，前提就是這一條。
spawn 被拒 —— 拿不到 Agent tool，或被 plugin 的 hook 以預算為由擋下 —— 時不重試、不換路，也不自己兼任：結論
`stuck`，原因寫被拒的訊息，已完成的節照第 5 節留給續跑。

三者的回報只有各節指定的欄位。推理過程、probe 的程式與輸出寫進 `<scratchpad>/review-<票>-notes/` 底下的檔案，
回報給路徑：你的 context 只收裁決要用的欄位。

三者的 Agent tool `description` 一律以角色字開頭、後接票的識別碼（GitHub 是 `#N`，Local Markdown 是票檔名）：
`finder #72`、`verifier #72`、`fix-verifier #72`。plugin 的 hook 把它記進 run 的 counters 檔，`get-to-work` 收官時靠
這個前綴把 spawn 依角色與票分段計量；寫錯的會算成不明用途的通用 agent。

- **逐行**（`line-by-line`）：對每個 hunk 的每一行追問，哪些輸入、狀態、時序或平台會讓它失效？特別檢查條件
  反轉、off-by-one、falsy zero、遺漏 `await`、copy-paste 錯變數與 catch 吞錯。跨檔案契約被併入時，也檢查被改
  函式的回傳值、例外與時序在它的直接呼叫端是否仍成立。
- **被刪除的行為**（`deleted-behaviour`）：辨識每段被刪除或改寫的程式碼原本維持的不變量，在新程式碼中定位重建
  位置；找不到就列為候選。
- **跨檔案契約**（`cross-file`）：追蹤被改函式的呼叫端與被呼叫端，檢查新的前置條件、回傳形狀、例外或時序
  是否破壞任一端。
- **驗收對照**（`acceptance`）：把驗收快照的每一項定位到 diff 中實現它的位置與驗證它的測試。列出缺漏或只做一半
  的、看起來做了但做錯的，以及票沒要求的改動（範圍蔓延）。每則引用驗收項原文與出處（`original`，
  或 `expansion` 附 `by`、`round`）。
- **repo 慣例**（`conventions`）：套用判級輸出 `signals.ruleFiles` 列的規則檔（涵蓋變更檔的 `CLAUDE.md`、
  `AGENTS.md`、`CONTRIBUTING.md`、`CODING_STANDARDS.md`）。只有能引用規則原文的才列；工具已經強制的不列。

Finder 看不到目前對話，prompt 要自足：repo 與審查用 worktree 的絕對路徑、fixed point、
ticket 分支、diff 檔路徑、票面全文、它套用的每個 lens 的全文，以及必須向外追查的範圍（完整的新檔內容、
被呼叫函式的實作、所有呼叫端與型別定義）。Finder 只找候選、不裁決；尚未確定的也回報。

回報格式：`file`、`line`（新檔行號）、`lens`、一句 `summary`、描述使用者可見後果的
`failure_scenario`（錯誤輸出、crash、資料遺失，而非中間狀態），以及 `suspected`（疑似 spec 層級
或既有）：

- `spec`：候選指的行為或措辭，正是票面或驗收項指定的。附上被指定的原文。
- `pre-existing`：fixed point 上就已經這樣。附上 fixed point 上的位置。
- `none`：兩者都不像。

每個 finder 最多六則，依 `failure_scenario` 的後果由重到輕排，沒有就回傳空清單。

每位 reviewer 是一組 Finder，候選帶 `by` 欄標明來自哪位。目前只有 `primary`；多一位 reviewer
只是多一個候選來源，第 3 節以後的步驟不變。

完成判準：所有 finder 都已回報；同一行、同一失效機制的候選已去重，保留 `failure_scenario`
最具體的一則；每則候選都有 `suspected`；每個 hunk 都至少經過一次逐行 lens。

## 3. 實跑與突變

這一步由審查方做，不交給實作者。

### 實跑

**全套交給 CI，審查只跑受影響範圍。** 在審查用 worktree 的根目錄先判範圍：

```bash
node "${CLAUDE_SKILL_DIR}/scripts/scope.mjs" --base <fixed point> --ci <第 1 節的 CI 覆蓋> > <scratchpad>/review-<票>-scope.json
```

呼叫方沒給 CI 覆蓋時省略 `--ci`。範圍與指令來源的規則寫在腳本檔頭，照輸出讀：

- `scope: full`：CI 不涵蓋整合分支或沒有 `origin`，收官前沒有別人會跑全套，所以照舊跑專案完整的 test、
  typecheck、lint，各一次。指令取輸出的 `commands`；它是 `null` 時自己從 manifest 與 CI 設定找。
- `scope: affected`：整併後 CI 會跑全套，這裡只跑 typecheck、涵蓋改動檔的測試、改動檔相關的 lint。把輸出的
  `targeted`（指令契約「Targeted checks」原文）套到 `changed` 上得出指令；它是 `null` 時自己從 manifest 與測試
  設定推。`tests` 是候選的測試檔，沿 import 或契約的對照確認涵蓋改動檔才算。專案沒有 typecheck 或 lint 就不跑
  那一項。

指令由審查方自己選，不照抄實作 agent 回報的那條。輸出的 `scope`、`ci`、`source` 照抄進 `live run` 行（第 6 節），
所以看得出這次是全套還是受影響範圍、指令來自契約還是自己推的。這是突變的基準：

- 全綠 → 進突變。
- 紅燈 → 紅燈本身是一則候選（lens `live-run`），交 Verifier 裁決。基準不綠，突變沒有意義，
  這次不突變，突變紀錄寫 `skipped: red baseline`（格式見第 6 節）。

### 突變

**沒有可執行的行就跳過突變。** 本票 diff 的改動全落在文件、註解、設定或產生檔，沒有一行可執行
程式行時，不跑 `mutate.mjs lines`、不寫 plan，突變紀錄寫 `skipped: no executable lines`（格式見
第 6 節）。實跑照跑。

**範圍只限本票 diff 中有測試覆蓋的行。** 在審查用 worktree 列出改動行與覆蓋
（`${CLAUDE_SKILL_DIR}` 是本 skill 載入時標示的 base directory）：

```bash
node "${CLAUDE_SKILL_DIR}/scripts/mutate.mjs" lines --base <fixed point> [--lcov <lcov 檔>]
```

輸出格式寫在腳本檔頭。覆蓋資料來自 repo 已安裝的覆蓋工具（c8、nyc、jest／vitest 的
coverage、coverage.py）或執行環境內建的（Node 22 的
`node --test --experimental-test-coverage --test-reporter=lcov`），產出 lcov 傳入 `--lcov`。
有 `docs/agents/commands.md` 而且它的「Coverage」不是 `none` 時，用它的指令產出 lcov。
兩者都沒有時 `covered` 為 `null`：由審查方從測試沿呼叫鏈追到該行才算覆蓋，紀錄標
`coverage=inferred`。

選行：

1. 只取有覆蓋、可執行的程式行；測試檔本身、註解、文件、設定與產生檔不突變。未覆蓋的行不
   突變，行數寫進紀錄。本票改了可執行程式行卻沒有一行有覆蓋時，這件事本身是一則候選
   （lens `mutation`）。
2. **每行至多一個 mutant，每張票的上限是判級輸出的 `mutationCap`**（以 `--cap` 傳給腳本；`light` 的上限較低）。
   超過上限時依序取：**本票新增或改動的測試宣稱守住的行**（該測試直接呼叫並斷言的程式行；測試名稱、斷言訊息
   或 commit message 說它守住的行為所在的行）→ Finder 候選指到的行 → 驗收項直接依賴的行 → 條件、邊界與
   回傳值 → 其他敘述；同一優先級分散到不同 hunk。第一級排最前，因為新測試宣稱守住卻殺不掉 mutant，是最直接的
   「測試沒釘住」證據。
3. 每行挑一個最可能被測試漏掉的運算子：條件反轉、邊界移位（`<` ↔ `<=`）、回傳值換成常數或
   空值、刪除敘述（呼叫、賦值、`await`）。mutant 必須改變某個可觀察行為。

**repo 已安裝突變工具就用工具。** 已安裝指 repo manifest 的相依裡已有、或 PATH 上已有的
指令，而且本機現在就能執行（`node_modules/.bin/stryker`、`cargo mutants --version` 成功、
專案 venv 裡的 `mutmut`）。沒裝的不裝。用工具自己的範圍選項限縮到選定的行：StrykerJS 用 `--mutate <file>:<起>-<迄>`（它的
`--incremental` 比對的是上次的報告檔，不是 git ref，只能加速、不能限縮範圍）；cargo-mutants
用 `--in-diff <diff 檔>`；mutmut 傳變更檔路徑。工具在同一行產生多個 mutant 時每行只計一個
（該行有存活者就計存活者），總數仍受上限約束。

**沒有工具就手動突變**，用腳本跑。在 scratchpad 寫 plan，格式寫在腳本檔頭：

```bash
node "${CLAUDE_SKILL_DIR}/scripts/mutate.mjs" run --base <fixed point> [--lcov <lcov 檔>] --plan <scratchpad>/mutants.json --ledger <scratchpad>/review-<票>-r<round>-ledger.json --cmd "<測試指令>" > <scratchpad>/mutants-result.json
```

在審查用 worktree 的根目錄執行。`--cmd` 用涵蓋選定行的最窄測試指令，取自實跑的指令或它的縮小版。腳本先跑
一次基準；拒絕不在本票 diff 改動行上、或 lcov 標為未覆蓋的 mutant，拒絕同一行兩個 mutant、`original`
與現行內容不符的 plan，也拒絕 plan 加上 ledger 已用的數量超過上限；`--cap` 只能調低。每個
mutant 跑完就寫回原始位元組並比對 SHA-256，跑過的記進 ledger。**一輪審查只用一個 ledger**：
同一輪可以分幾次 `run`，但不換 ledger、不另開一輪來繞過上限。

結束代碼不是 0 時照輸出處理，紀錄的寫法見第 6 節：

- **1，`baseline: "red"`**（實跑綠、腳本自己的基準紅）：`--cmd` 比實跑的指令窄時，是挑的指令錯了 —— 改用
  涵蓋同幾行、在實跑裡綠的指令，沿用同一個 ledger 再跑一次（紅的基準沒有跑任何 mutant，不佔上限）。`--cmd`
  就是實跑裡綠過的那一條時，同一個 commit 時紅時綠是偶發紅燈：成為一則候選（lens `live-run`，證據是實跑 log 與
  這份輸出的路徑），本輪不再突變。
- **1，有 `error`**（執行期錯誤，已跑的檔案已還原）：已跑的 mutant 照 `results` 記，沒跑的不補；結論 `stuck`，
  原因是突變沒跑完，排除後照第 5 節只續跑突變，沿用同一個 ledger。
- **3**（還原失敗）：立刻停，結論 `stuck`。審查用 worktree 不再使用：寫完區塊後照第 6 節移除，下一輪由
  `open` 重建。

跑完不憑結束代碼斷定 worktree 乾淨：`restored` 一律取自第 6 節的 `worktree.mjs status`。

結果：`killed` 與 `timeout` 算被測試抓到；`survived` 是一則候選（lens `mutation`），
`failure_scenario` 寫一個會讓原碼與 mutant 產生不同可觀察結果、而現有測試都沒擋下的具體輸入。

完成判準：實跑結果已記錄；沒有可執行的行時突變已跳過，紀錄寫 `skipped: no executable lines`；
實跑的範圍與指令來源取自 `scope.mjs` 的輸出，指令不是照抄實作 agent 的；
突變只碰本票 diff 中有覆蓋的行，每行至多一個、總數不超過上限，超過上限時本票新測試宣稱守住的行排最前；
每個 mutant 都有結果；`mutate.mjs` 非 0 結束時已照上面三種情況處理；每個存活的 mutant 都成為候選。

## 4. Verifier：逐項獨立裁決

候選（含第 3 節的實跑與突變候選）由腳本**合批**。每個候選給一個 `id`，把 `id`、`file`、`suspected` 寫成 JSON
陣列，在審查用 worktree 的根目錄執行：

```bash
node "${CLAUDE_SKILL_DIR}/scripts/tier.mjs" batch --tier-file <scratchpad>/review-<票>-tier.json --items <scratchpad>/review-<票>-candidates.json
```

判級指令失敗時以 `--tier full` 取代 `--tier-file`。輸出的 `batches` 每批交給一個 verifier subagent，全部並行派出，
`description` 是 `verifier` 後接票的識別碼。標了 `suspected` 的候選整批交給一個 verifier（批的 `short`），其餘依
檔案分組（批的 `normal`），總批數不超過判級輸出的 `verifiers.max`。合批只決定 verifier 的數量，不合併候選：verifier
對批內每個候選逐條裁決，各附 `file:line` 證據；`short` 的候選走簡化流程，兩項都不成立的由同一個 verifier 接著走
一般流程。Verifier 只處理交給它的候選；裁決途中看到的其他問題，寫成一行放在回報的 `noticed`，由你
當成觀察。

Prompt 自足，只含 repo 與審查用 worktree 的絕對路徑、ticket 分支、fixed point、該組候選的欄位與
以下裁決規則。省略 finder 的推理，避免錨定偏誤；`suspected` 與它附的原文或位置照給，那是待查的
線索，不是裁決。

**標了 `suspected`（`spec` 或 `pre-existing`）的候選走簡化流程**，不走完三關。兩項都查：

- 在 fixed point 上做同一項檢查（第二關）。fixed point 也有 → 直接裁決 **pre-existing**。
- 對照票面與驗收快照的原文。fixed point 正常，但候選指的行為或措辭正是 spec 指定的 → 直接裁決
  **spec 層級**：實作照 spec 做，要改的是 spec。
- 兩項都不成立 → 當成 `none`，照下面的一般流程從反駁開始。

`suspected: none` 的候選走一般流程。先嘗試**反駁**：找出能推翻候選的程式碼並引用。不確定的
技術事實用一次性的程式實跑查證。
存活 mutant 的反駁是證明它是等價 mutant —— 沒有任何輸入能讓原碼與 mutant 的可觀察結果不同。
反駁失敗後逐關檢查：

1. **Traced**：引用 verifier 實際開啟過的 `file:line`。
2. **由本票引入**：在 fixed point 上做同一項檢查；只有 fixed point 正常、ticket 分支失效才通過。
   突變候選（存活 mutant、改動行沒有覆蓋）落在本票 diff 的改動行上，腳本已保證這點，視為
   通過這一關。
3. **具體失效情境**：失效路徑真實可達，後果可觀察。

裁決四種，都附 `file:line` 證據：**成立**（三關全過）、**pre-existing**（只在第二關失敗，或簡化
流程查到 fixed point 也有）、**spec 層級**（只出自簡化流程）、**不成立**。每則引用標明出自哪裡：
ticket 分支（預設）、fixed point，或票面／驗收快照。引用與它標明的來源對不上時，才換一個
verifier 重驗。

**blocking 由 verifier 判，判準只有五條。** 成立的候選命中其中一條才是 blocking；verifier 在裁決寫出命中的
`rule`，並引用它依據的原文或輸出：

| `rule` | 命中條件 | 引用 |
| --- | --- | --- |
| `acceptance` | 驗收快照的某一項在 ticket 分支上不成立 | 該驗收項原文 |
| `regression` | fixed point 上成立、票面與驗收項都沒要求改的行為，在 ticket 分支上壞了 | fixed point 與 ticket 分支各自的輸出 |
| `red` | 實跑紅燈 | 實跑輸出的路徑 |
| `safety` | 資料遺失、憑證或權限外洩，或敏感路徑上的檢查失效 | 觸發它的輸入與結果 |
| `unpinned` | 存活 mutant 成立：測試沒釘住本票改的行為 | 突變輸出的路徑 |

五條都沒命中的成立候選是觀察：邊界輸入的強化、訊息措辭、驗收項沒涵蓋的情境、其他寫法也該一併檢查，都屬這一類。

分流：

- **成立且 blocking** → finding，帶 `rule`。
- **成立但不 blocking** → 觀察。
- **spec 層級** → 觀察，句末標 `(spec-level)`。
- **pre-existing** → 列進 `pre-existing`。
- **不成立** → 丟棄；突變候選的處置寫進突變紀錄（例如「等價 mutant，不成立」）。

觸發修正的只有 finding。觀察與 pre-existing 由呼叫方依 get-to-work 的期間開票處理，這張票照結論往下走。

每則 finding 附一句**修法方向**，說出修前修後可觀察的差異（輸出、錯誤、某個測試由紅轉綠），範圍就是關上
這則 finding 引用的那個情境。說不出來的是風格偏好，撤掉。存活 mutant 的修法方向是補一個殺得掉它的測試，寫出輸入。

Verifier 的回報，每個候選一段，至多五行：裁決、`rule`（成立時；沒命中寫 `none`）、`file:line` 證據、三關結果或
簡化流程查過的兩項、修法方向（finding 才有）。最後一行 `noticed`，沒有寫 `none`。

完成判準：每個候選恰有一項裁決，附 `file:line` 證據，以及三關結果或簡化流程查過的兩項；同批的
候選也逐條裁決；每則 finding 都有命中的 `rule`、它的引用與可證偽的修法方向；每個 mutant 在突變紀錄都有處置。

## 5. 結論

- `pass`：沒有成立且 blocking 的 finding，驗收比對也沒有變。
- `fix`：至少一則成立且 blocking 的 finding；第 1 節的 `acceptance` finding 算一則。
- `stuck`：審查做不完 —— 開審前提不成立、還原失敗、審查用 worktree 跑不起測試。寫明原因、
  解除條件，以及已完成到哪一節。開審前的 `stuck`（第 1 節）不算一次審查，排除後重跑 `initial`；
  審中的 `stuck` 排除後只續跑未完成的節，沿用區塊裡已有的候選、裁決與突變紀錄，不重派 Finder。`stuck` 時
  審查用 worktree 照第 6 節移除，續跑時由 `open` 重建。

**結論以 verifier 的裁決為準。** 你把每則裁決原樣抄進區塊：finding 就是 verifier 判為 blocking 的那幾則，
觀察就是其餘成立的。你認為某則觀察該擋下整併時，另派一個 verifier 只重判那一則的 `rule`，以它的裁決為準。

完成判準：結論恰為三者之一，而且由第 1 節的驗收比對與第 4 節的分流推得；區塊裡每則 finding 的 `rule` 都出自
verifier 的回報。

## 6. 輸出與接續紀錄

固定格式，key 一律英文、src 與 dist 相同，讓呼叫方與後續 agent 機械讀取：

```text
<!-- sorry-matt:review -->
review: <round>  mode: initial | recheck  tier: light | standard | full
verdict: pass | fix | stuck
base: <fixed point>@<sha>  head: <ticket branch>@<sha>
stuck: <reason and how to clear it, or none>
acceptance: unchanged | changed (<acceptance diff path>)  original=<n> expansion=<n> (<by>, round <n>)

reviewer: primary
findings:
- F1 blocking <file>:<line> [<lens>] rule=<acceptance | regression | red | safety | unpinned>
  summary: <one sentence>
  evidence: <file:line the verifier opened; path of the live-run or mutation output>
  fix: <fix direction, with the observable before/after difference>
observations:
- <file>:<line> <one sentence> (evidence: <file:line>)
pre-existing:
- <file>:<line> <one sentence> (evidence: <file:line>)

live run: scope=<affected | full | findings> ci=<covered | uncovered | no-origin> source=<commands.md | self-found> -> green | red (<log path>)
- <command> -> green | red
mutation (round <n>): tool=<manual | stryker | cargo-mutants | mutmut> cap=<n> mutated=<n> survived=<n> uncovered=<n> coverage=<lcov | inferred>
- <file>:<line> <operator> -> killed | timeout | survived | restore-failed: <disposition: F2 | equivalent, invalid | ...>
- error: <message> (<mutation output path>)
restored: yes | no | n/a
```

`live run` 一行寫範圍、CI 覆蓋與指令來源，底下每條指令一行：`scope` 是第 3 節 `scope.mjs` 輸出的 `full` 或
`affected`，複驗（第 7 節）寫 `findings`；`ci` 照輸出的 `ci`；`source` 取自契約寫 `commands.md`，自己找或自己推的
寫 `self-found`。`- error:` 只在 `mutate.mjs` 以執行期錯誤結束時出現；`restore-failed` 只用在結束代碼 3 那個
mutant（輸出的 `restoreFailed`）。沒有內容的清單寫 `none`。`acceptance` finding 的位置寫比對輸出的路徑，不寫
`file:line`。spec 層級的觀察在句末、`(evidence: …)` 之前標 `(spec-level)`。

該輪沒有跑突變時，`mutation` 那段只寫一行、不列 mutant：

- 沒有可執行的行：`mutation (round <n>): skipped: no executable lines`
- 實跑紅燈：`mutation (round <n>): skipped: red baseline`
- 實跑綠、`mutate.mjs` 的基準紅，而且是偶發紅燈（第 3 節）：`mutation (round <n>): skipped: red baseline (mutate.mjs, <mutation output path>)`。
  換指令重跑後綠了的，照完整格式寫重跑的結果。
- 開審前或審中在突變之前就 `stuck`：`mutation (round <n>): skipped: stuck before mutation`

`mutate.mjs` 以執行期錯誤或還原失敗結束時，照完整格式寫：`mutated` 是輸出 `results` 的筆數加上還原失敗的那一個。

**`restored` 一律取自腳本，不憑推斷寫 `yes`。** 不論跑過突變、跳過突變或在哪一節 `stuck`，寫區塊之前都在 repo
內執行：

```bash
node "${CLAUDE_SKILL_DIR}/scripts/worktree.mjs" status --path <scratchpad>/review-<票> > <scratchpad>/review-<票>-r<round>-restored.json
```

照抄輸出的 `restored`：`yes` 是 `git status --porcelain` 為空；`no` 是測試、lint 或突變留下了改動，輸出的路徑補進
「證據路徑」欄，下一輪 `open` 會丟掉重建；`n/a` 是這一輪沒有審查用 worktree（開審前就 `stuck`）。`mutate.mjs`
以結束代碼 3 結束的輪次，`restored` 一律 `no`。

有第二位 reviewer 時，每位各一段 `reviewer:`，finding 分開列、不合併
重排；`verdict` 以全部 reviewer 的 finding 推得。

把這個區塊寫進該票接續紀錄的「驗證結果」欄，取代上一個 `sorry-matt:review` 區塊，`round`
遞增。被取代的區塊裡每一段 `mutation (round <n>)` 原樣帶進新區塊、放在本輪那段之前，所以初審
的完整突變紀錄不會被複驗蓋掉；「證據路徑」欄補上 diff、實跑與突變輸出的路徑。GitHub 原地更新那則第一行是
`<!-- sorry-matt:status -->` 的留言
（`gh api --method PATCH repos/<owner>/<repo>/issues/comments/<id> -F body=@<file>`）；Local
Markdown 寫進票檔的 `## sorry-matt status` 區塊。這是給下一個 agent 讀的機器紀錄，不用潤稿。

**回傳給呼叫方的只有審查回報**，不是這個區塊：finding、觀察與 pre-existing 的全文留在接續紀錄，呼叫方要時
自己去讀。區塊寫進接續紀錄（含開審前的 `stuck`）、要移除的審查用 worktree 也移除之後，你的最後一則訊息就是
下面這段，至多六行，不加別的：

```text
<!-- sorry-matt:review-report -->
ticket: <id>  review: <round>  mode: initial | recheck  tier: light | standard | full
verdict: pass | fix | stuck
counts: findings=<n> observations=<n> pre-existing=<n>
block: <where the review block is: the status comment's URL, or the ticket file's path; none when no block was written>
stuck: <reason (clear: <how to clear it>; completed: <last section done, or none>), or none>
```

`verdict`、`review`、`mode`、`tier` 與區塊裡的相同；`counts` 數的是區塊裡的條目，沒有寫 0。寫不進接續紀錄時
（tracker 拒絕、檔案被鎖），`verdict` 寫 `stuck`、`block` 寫你存下的區塊檔的路徑，原因寫寫入失敗的訊息。

**結論定案時移除審查用 worktree。** `verdict` 是 `pass` 或 `stuck`，或這是第二次複驗（上一個區塊是
`mode: recheck` 的 `fix`）而結論仍是 `fix` —— 不會再有複驗 —— 時，寫完區塊後在 repo 內執行：

```bash
node "${CLAUDE_SKILL_DIR}/scripts/worktree.mjs" close --path <scratchpad>/review-<票>
```

其餘的 `fix` 留著它，給下一次複驗沿用。

完成判準：區塊符合上述格式；`live run` 行看得出範圍是 `full`、`affected` 還是 `findings`；`restored` 取自
`worktree.mjs status`；接續紀錄只有一個最新的 review 區塊，而且保有歷輪的突變紀錄；沒有發出任何 PR 評語、
review 或 `suggestion` 區塊；結論定案時審查用 worktree 已移除，其餘的 `fix` 留著它；回傳給呼叫方的只有至多
六行的審查回報，不含 finding 全文。

## 7. 複驗

集中修正之後，呼叫方再以前景 spawn 一個審查主持 agent，模式 `recheck`；你從接續紀錄讀上一次的審查區塊。複驗只回答一個問題：上一次的每則
finding 關上了沒有。它的範圍是那幾則 finding 與修正 commit 的 diff（`git diff <上次 head>..<ticket 分支>`），
所以每一輪要驗的東西只會變少。審查用 worktree 照第 1 節的 `worktree.mjs open` 沿用初審那一個、移到修正後的
ticket 分支尖端，不另建；`tier` 沿用初審的。

1. **Fix Verifier**：把 finding（`acceptance` finding 除外，它走第 4 步）的 `id`、`file` 寫成 JSON 陣列，以
   `node "${CLAUDE_SKILL_DIR}/scripts/tier.mjs" batch --tier <沿用的 tier> --stage fix --items <scratchpad>/review-<票>-r<round>-findings.json`
   合批：`light` 與 `standard` 一張票一批，`full`
   一個檔案一批。每批一個 subagent，並行派出；同批的每則 finding 各自作答、各得一項裁決。`description` 是
   `fix-verifier` 後接票的識別碼。Prompt 自足，
   含審查用 worktree 路徑、每則 finding 的 `summary`、`evidence`、`rule` 與 `fix`，以及修正 commit 的 diff；
   省略實作者的說明。它對每則 finding 重跑 `evidence` 記的那個情境，兩題作答並附 `file:line`：
   1. 那個情境現在的可觀察結果是什麼？和 `fix` 寫的修後結果一致就是**已關閉**，否則**未關閉**。
   2. 修正 diff 的改動行裡，有沒有命中第 4 節五條 `rule` 之一的缺陷？有就照第 4 節的三關裁決，第二關的
      fixed point 換成上次的 head；成立的成為本輪新 finding。

   同一則 finding 的其他寫法、修正 diff 以外的行、沒命中 `rule` 的問題，寫成一行放在回報的 `noticed`，
   由你當成觀察。回報每則 finding 至多四行，最後一行 `noticed`。
2. **實跑**：只跑涵蓋 finding 行的測試，加上修正新增的測試。`live run` 行寫 `scope=findings`，`ci` 照第 1 節的
   CI 覆蓋，`source` 是這幾條指令的來源。
3. **突變**：只重跑上次存活的 mutant，這次必須被殺掉；該行內容變了，就在取代它的那一行做同一個運算子的
   mutant。用本輪新的 ledger。修正新增的行由第 1 步第 2 題把關。
4. **驗收比對**：讀呼叫方附上的新比對輸出。`check.changed` 為 false，`acceptance` finding 才算
   關閉；為 true 時它維持未關閉，原本沒有的就依第 1 節記成本輪新 finding。

結論：每則 finding 都已關閉、實跑全綠、上次存活的 mutant 全被殺掉、驗收比對沒有變，而且沒有
新的 finding → `pass`；否則 `fix`。輸出照第 6 節，`mode: recheck`，每則舊 finding 的 `summary` 前標 `closed` 或
`open`；`noticed` 的每一行進 `observations`。

**一張票至多兩次 `recheck`。** 第二次的結論仍是 `fix` 時，區塊照寫，呼叫方依 get-to-work 的規則把這張票標
卡住；本輪新 finding 與舊 finding 算在同一個輪數裡。

完成判準：每則舊 finding 都有一項 Fix Verifier 裁決與證據（`acceptance` finding 以新的比對輸出裁決）；實跑只碰
finding 涉及的行，突變只重跑上次存活的 mutant；本輪新 finding 都落在修正 diff 的改動行上並帶 `rule`；
結論與區塊已依第 6 節寫進接續紀錄。
