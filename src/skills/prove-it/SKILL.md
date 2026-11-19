---
name: prove-it
description: sorry-matt 流程專用的票級獨立審查：以證據鏈（Finder → Verifier → Fix Verifier）、實跑與只限本票 diff 的突變審一張票的 ticket 分支，輸出 pass／fix／stuck 的固定格式結論與 finding 清單，寫進該票的接續紀錄。由 get-to-work 收票時呼叫；不發 PR 評語、不產 suggestion。
---

# prove-it：審一張票，舉證到底

sorry-matt 自動流程收票時的**獨立審查**，一張票一次。證據鏈沿用 `review-pr`：Finder 找候選，
Verifier 獨立裁決，集中修正後由 Fix Verifier 複驗。差別在讀者：這裡的讀者是主持人，不是 PR
作者 —— 不發 PR 評語、不產 `suggestion` 區塊、不對外留言，只輸出第 6 節的固定格式結論，寫進
該票的接續紀錄。

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
- **針對性檢查結果**：實作 agent 回報的指令與結果。
- **模式**：`initial`（初審），或 `recheck`（集中修正後的複驗，附上一次的審查區塊，走第 7 節）。
- **reviewer**：預設只有 `primary`，也就是本 skill 自己的 Finder 組。

逐項確認，任一項不成立就不開審，以第 6 節格式輸出 `verdict: stuck` 並寫明是哪一項：

- `git rev-parse` 解得到 fixed point 與 ticket 分支，`git diff <fixed point>...<ticket 分支>` 非空。
- 針對性檢查是綠的。紅燈是實作 agent 的事，審查只收綠燈的票。
- 驗收快照與比對輸出都在，`id` 是這張票，快照至少有一項驗收。

**驗收被改過就不通過。** 比對輸出的 `check.changed` 為 true 時（含 `check.snapshotIntact` 為 false：快照本身被改過），直接記一則 blocking finding
（lens `acceptance`），不經 Finder 與 Verifier：證據是比對輸出的路徑與 `removed`／`added`，修法方向
是把 tracker 上的驗收恢復成快照，要改的項目由實作 agent 回報為待裁決。審查照常進行，驗收對照一律
以快照為準，不以改過的版本為準。

在 scratchpad 建立**審查用 worktree**，實跑與突變都只在這裡做，實作 agent 的 worktree 保持原狀：

```bash
git -C <repo> worktree add --detach <scratchpad>/review-<票> <ticket 分支>
git -C <repo> diff <fixed point>...<ticket 分支> > <scratchpad>/review-<票>.diff
```

相依沿用既有安裝；新 worktree 沒有安裝時照 lockfile 還原（`npm ci`、
`pnpm install --frozen-lockfile` 這類凍結寫法）。不加相依、不下載新工具 —— 審查不改這張票的
diff 與 repo 相依。新檔行號一律取自 `git show <ticket 分支>:<path>`。

完成判準：輸入齊全；不成立的前提已輸出 `stuck` 並停止；驗收被改過時已記下 `acceptance` finding；
審查用 worktree 位於 ticket 分支尖端，diff 已存檔。

## 2. Finder：平行找候選

每個 lens 交給一個獨立的 finder subagent，同一則訊息一次派出。以下兩種 diff 只派一個 finder，
由它套用全部 lens：

- 只有一個檔案，而且不超過數十行。
- 只動說明文字：每個改動檔都是 `.md`、`.txt` 這類文件，不含程式、測試、腳本、設定或產生檔。

本 skill 的 finder、verifier（第 4 節）與 Fix Verifier（第 7 節）一律以前景派送，不在背景跑：呼叫方在自己的
回合裡等它們全部回來才往下。`get-to-work` 不給審查設時限，前提就是這一條。

- **逐行**：對每個 hunk 的每一行追問，哪些輸入、狀態、時序或平台會讓它失效？特別檢查條件
  反轉、off-by-one、falsy zero、遺漏 `await`、copy-paste 錯變數與 catch 吞錯。
- **被刪除的行為**：辨識每段被刪除或改寫的程式碼原本維持的不變量，在新程式碼中定位重建
  位置；找不到就列為候選。
- **跨檔案契約**：追蹤被改函式的呼叫端與被呼叫端，檢查新的前置條件、回傳形狀、例外或時序
  是否破壞任一端。
- **驗收對照**：把驗收快照的每一項定位到 diff 中實現它的位置與驗證它的測試。列出缺漏或只做一半
  的、看起來做了但做錯的，以及票沒要求的改動（範圍蔓延）。每則引用驗收項原文與出處（`original`，
  或 `expansion` 附 `by`、`round`）。
- **repo 慣例**：套用涵蓋變更檔的 `CLAUDE.md`、`AGENTS.md`、`CONTRIBUTING.md`、
  `CODING_STANDARDS.md` 規則。只有能引用規則原文的才列；工具已經強制的不列。

Finder 看不到目前對話，prompt 要自足：repo 與審查用 worktree 的絕對路徑、fixed point、
ticket 分支、diff 檔路徑、票面全文、該 lens 全文，以及必須向外追查的範圍（完整的新檔內容、
被呼叫函式的實作、所有呼叫端與型別定義）。Finder 只找候選、不裁決；尚未確定的也回報。

回報格式：`file`、`line`（新檔行號）、`lens`、一句 `summary`、描述使用者可見後果的
`failure_scenario`（錯誤輸出、crash、資料遺失，而非中間狀態），以及 `suspected`（疑似 spec 層級
或既有）：

- `spec`：候選指的行為或措辭，正是票面或驗收項指定的。附上被指定的原文。
- `pre-existing`：fixed point 上就已經這樣。附上 fixed point 上的位置。
- `none`：兩者都不像。

每個 finder 最多六則，沒有就回傳空清單。

每位 reviewer 是一組 Finder，候選帶 `by` 欄標明來自哪位。目前只有 `primary`；多一位 reviewer
只是多一個候選來源，第 3 節以後的步驟不變。

完成判準：所有 finder 都已回報；同一行、同一失效機制的候選已去重，保留 `failure_scenario`
最具體的一則；每則候選都有 `suspected`；每個 hunk 都至少經過一次逐行 lens。

## 3. 實跑與突變

這一步由審查方做，不交給實作者。

### 實跑

在審查用 worktree 跑專案定義的 test、typecheck、lint，各一次。審查用 worktree 有 `docs/agents/commands.md`
時，指令取它的「Full checks」；沒有這份檔，或它的「Full checks」是 `none` 時，照現況自己從 manifest 與 CI 設定找，
來源寫 `self-found`。這是突變的基準：

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
2. **每行至多一個 mutant，每張票上限 10 個。** 超過上限時依序取：Finder 候選指到的行 → 驗收項
   直接依賴的行 → 條件、邊界與回傳值 → 其他敘述；同一優先級分散到不同 hunk。
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

在審查用 worktree 的根目錄執行。`--cmd` 用涵蓋選定行的最窄測試指令。腳本先跑一次基準；
拒絕不在本票 diff 改動行上、或 lcov 標為未覆蓋的 mutant，拒絕同一行兩個 mutant、`original`
與現行內容不符的 plan，也拒絕 plan 加上 ledger 已用的數量超過上限；`--cap` 只能調低。每個
mutant 跑完就寫回原始位元組並比對 SHA-256，跑過的記進 ledger。**一輪審查只用一個 ledger**：
同一輪可以分幾次 `run`，但不換 ledger、不另開一輪來繞過上限。結束代碼 3 表示還原失敗：立刻停，
審查用 worktree 整個丟棄，結論 `stuck`。
跑完以 `git -C <審查用 worktree> status --porcelain` 確認輸出為空。

結果：`killed` 與 `timeout` 算被測試抓到；`survived` 是一則候選（lens `mutation`），
`failure_scenario` 寫一個會讓原碼與 mutant 產生不同可觀察結果、而現有測試都沒擋下的具體輸入。

完成判準：實跑結果已記錄；沒有可執行的行時突變已跳過，紀錄寫 `skipped: no executable lines`；
突變只碰本票 diff 中有覆蓋的行，每行至多一個、總數不超過上限；每個 mutant 都有結果；
審查用 worktree 的 `git status --porcelain` 為空；每個存活的 mutant 都成為候選。

## 4. Verifier：逐項獨立裁決

候選（含第 3 節的實跑與突變候選）依「檔案＋失效機制」分組：同一個檔案、同一種失效機制的候選
交給同一個 verifier subagent，其餘各自一個，全部並行派出。失效機制由主持人依 `summary` 與
`failure_scenario` 判斷，拿不準就分開。分組只減少 verifier 的數量，不合併候選：verifier 對組內
每個候選逐條裁決，各附 `file:line` 證據。Verifier 只處理候選，不重讀整份 diff。

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

分流：

- **成立且 blocking**（會改變這張票該不該整併的決定）→ finding。測試沒釘住本票改的行為，所以
  成立的存活 mutant 一律算 blocking。
- **成立但不 blocking** → 觀察，不觸發修正。
- **spec 層級** → 觀察，句末標 `(spec-level)`，不觸發修正。
- **pre-existing** → 交主持人依 get-to-work 的期間開票處理。
- **不成立** → 丟棄；突變候選的處置寫進突變紀錄（例如「等價 mutant，不成立」）。

每則 finding 附一句**修法方向**，說出修前修後可觀察的差異（輸出、錯誤、某個測試由紅轉綠）。
說不出來的是風格偏好，撤掉。存活 mutant 的修法方向是補一個殺得掉它的測試，寫出輸入。

完成判準：每個候選恰有一項裁決，附 `file:line` 證據，以及三關結果或簡化流程查過的兩項；同組的
候選也逐條裁決；每則 finding 都有可證偽的修法方向；每個 mutant 在突變紀錄都有處置。

## 5. 結論

- `pass`：沒有成立且 blocking 的 finding，驗收比對也沒有變。
- `fix`：至少一則成立且 blocking 的 finding；第 1 節的 `acceptance` finding 算一則。
- `stuck`：審查做不完 —— 開審前提不成立、還原失敗、審查用 worktree 跑不起測試。寫明原因、
  解除條件，以及已完成到哪一節。開審前的 `stuck`（第 1 節）不算一次審查，排除後重跑 `initial`；
  審中的 `stuck` 排除後只續跑未完成的節，沿用區塊裡已有的候選、裁決與突變紀錄，不重派 Finder。

完成判準：結論恰為三者之一，而且由第 1 節的驗收比對與第 4 節的分流推得，不是自評。

## 6. 輸出與接續紀錄

固定格式，key 一律英文、src 與 dist 相同，讓呼叫方與後續 agent 機械讀取：

```text
<!-- sorry-matt:review -->
review: <round>  mode: initial | recheck
verdict: pass | fix | stuck
base: <fixed point>@<sha>  head: <ticket branch>@<sha>
stuck: <reason and how to clear it, or none>
acceptance: unchanged | changed (<acceptance diff path>)  original=<n> expansion=<n> (<by>, round <n>)

reviewer: primary
findings:
- F1 blocking <file>:<line> [<lens>]
  summary: <one sentence>
  evidence: <file:line the verifier opened; path of the live-run or mutation output>
  fix: <fix direction, with the observable before/after difference>
observations:
- <file>:<line> <one sentence> (evidence: <file:line>)
pre-existing:
- <file>:<line> <one sentence> (evidence: <file:line>)

live run: <command> -> green | red (<log path>) source=<commands.md | self-found>
mutation (round <n>): tool=<manual | stryker | cargo-mutants | mutmut> cap=10 mutated=<n> survived=<n> uncovered=<n> coverage=<lcov | inferred>
- <file>:<line> <operator> -> killed | timeout | survived: <disposition: F2 | equivalent, invalid | ...>
restored: yes | no
```

`live run` 的 `source` 是指令的來源：取自 `docs/agents/commands.md` 寫 `commands.md`，自己找的寫 `self-found`。沒有內容的清單寫 `none`。`acceptance` finding 的位置寫比對輸出的路徑，不寫 `file:line`。spec 層級的
觀察在句末、`(evidence: …)` 之前標 `(spec-level)`。

該輪沒有跑突變時，`mutation` 那段只寫一行、不列 mutant：

- 沒有可執行的行：`mutation (round <n>): skipped: no executable lines`
- 實跑紅燈：`mutation (round <n>): skipped: red baseline`

這兩種情況 `restored` 都照寫，值是 `restored: yes`：沒有檔案被改過，等同已還原。

有第二位 reviewer 時，每位各一段 `reviewer:`，finding 分開列、不合併
重排；`verdict` 以全部 reviewer 的 finding 推得。

把這個區塊寫進該票接續紀錄的「驗證結果」欄，取代上一個 `sorry-matt:review` 區塊，`round`
遞增。被取代的區塊裡每一段 `mutation (round <n>)` 原樣帶進新區塊、放在本輪那段之前，所以初審
的完整突變紀錄不會被複驗蓋掉；「證據路徑」欄補上 diff、實跑與突變輸出的路徑。GitHub 原地更新那則第一行是
`<!-- sorry-matt:status -->` 的留言
（`gh api --method PATCH repos/<owner>/<repo>/issues/comments/<id> -F body=@<file>`）；Local
Markdown 寫進票檔的 `## sorry-matt status` 區塊。這是給下一個 agent 讀的機器紀錄，不用潤稿。
同一個區塊也回傳給呼叫方。

最後移除審查用 worktree：`git -C <repo> worktree remove <scratchpad>/review-<票>`。

完成判準：區塊符合上述格式；接續紀錄只有一個最新的 review 區塊，而且保有歷輪的突變紀錄；沒有發出任何 PR 評語、
review 或 `suggestion` 區塊；審查用 worktree 已移除。

## 7. 複驗

集中修正之後，呼叫方以 `recheck` 模式並附上一次的審查區塊再呼叫本 skill。這不是第二次審查：
不派 Finder，只對上一次的 finding 涉及的行重做驗證。審查用 worktree 依第 1 節以修正後的
ticket 分支尖端重建。

1. **Fix Verifier**：每則 finding（`acceptance` 除外，見第 4 步）各交給一個獨立的 subagent，並行派出。Prompt 自足，含審查用
   worktree 路徑、finding 的 `summary`、`evidence` 與 `fix`，以及修正 commit 的 diff
   （`git diff <上次 head>..<ticket 分支>`）；省略實作者的說明。先嘗試反駁修法，四題逐一作答並附
   `file:line`：
   1. finding 的每一個失效窗口都關上了嗎？
   2. 修正有沒有開出新的窗口？
   3. 修前修後可觀察的差異是什麼？說不出來就是沒修到。
   4. 其他呼叫端會不會壞？

   裁決兩種：**已關閉**，或**未關閉**。第二題找到的新窗口照第 4 節的三關裁決，成立且 blocking
   的成為本輪新 finding。
2. **實跑**：只跑涵蓋 finding 行的測試，加上修正新增的測試。
3. **突變**：只突變 finding 涉及的行，規則同第 3 節（每行至多一個、上限 10），用本輪新的
   ledger。上次存活的 mutant 若該行內容未變，重跑同一個 mutant，這次必須被殺掉。
4. **驗收比對**：讀呼叫方附上的新比對輸出。`check.changed` 為 false，`acceptance` finding 才算
   關閉；為 true 時它維持未關閉，原本沒有的就依第 1 節記成本輪新 finding。

結論：每則 finding 都已關閉、實跑全綠、finding 行上的 mutant 全被殺掉、驗收比對沒有變，而且沒有
新的 blocking finding → `pass`；否則 `fix`。修正輪數由呼叫方控管。輸出照第 6 節，`mode: recheck`，每則舊
finding 的 `summary` 前標 `closed` 或 `open`。

完成判準：每則舊 finding 都有一項 Fix Verifier 裁決與證據（`acceptance` finding 以新的比對輸出裁決）；實跑與突變只碰 finding 涉及的行；
結論與區塊已依第 6 節寫進接續紀錄。
