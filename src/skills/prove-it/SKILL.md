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
- **fixed point**：依流程設定的 `integrate` 而定。
  - `aggregate-pr` 與 `direct`：線整合分支。
  - `ticket-pr`（每張票一支票級 PR，沒有整合分支）：不疊的票是 `origin/<基底分支>`；疊在上游上的票是上游的 ticket
    分支。審查範圍照樣是 `<fixed point>...<ticket 分支>`，所以疊的票只審這張票自己那一層，不審上游的改動。
- **待審 ref**：ticket 分支。
- **針對性檢查結果**：實作 agent 回報的指令、結果與它跑的 SHA（派工檔的 `targeted checks` 與 `targeted checks ran at`；
  後者是 `not reported` 時等於沒有 SHA）。開審前確認它是綠的；`light` 與 `standard` 在 SHA 等於審查 head 時沿用它當
  實跑與突變基準，其餘情況審查方自己跑（第 3 節）。
- **CI 覆蓋**：這條線的整合分支整併後有沒有 CI 跑全套 —— `covered`、`uncovered`（呼叫方已定案為 CI 不涵蓋整合
  分支）或 `no-origin`（沒有 `origin`）。`ticket-pr` 沒有整合分支：CI 覆蓋就是這張票的票級 PR 的 CI，值同樣是這三種。
  沒給時由第 3 節的範圍指令依有沒有 `origin` 判。它只寫進 `live run` 行，
  不改實跑範圍（第 3 節）。
- **模式**：`initial`（初審），或 `recheck`（集中修正後的複驗，走第 7 節）。
- **審查分級**：呼叫方審查前已判好的審查分級，與它來自的判級指令輸出檔（`tier.mjs judge` 的 JSON）。給了就照那份
  輸出，不再自己判；沒給（`none given`）時由你判（下方）。
- **接續紀錄**：該票接續紀錄的位置 —— GitHub 是第一行為 `<!-- sorry-matt:status -->` 的那則留言，Local Markdown
  是票檔。審查區塊寫在這裡（第 6 節）。
- **上一次的審查區塊**：複驗一律有，初審在審中 `stuck` 排除後續跑（第 5 節）時也有：就是接續紀錄裡現在那個
  `sorry-matt:review` 區塊，由你自己讀。其餘的初審沒有。
- **reviewer**：預設只有 `primary`，也就是本 skill 自己的 Finder 組。`full` 級的 `architecture` 專項 reviewer 由你
  依判級輸出的 `reviewers` 加上（第 2 節），不由呼叫方給。

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

**審查分級**一張票判一次，寫進審查區塊的 `tier`，整張票（含複驗）沿用。它決定 finder 的數量與各自的
lens、verifier 與 Fix Verifier 的合批方式和突變上限。呼叫方給了審查分級時，你不判：把它給的判級指令輸出檔原樣
複製到下方判級指令寫輸出的位置（`>` 後的那個檔），以下各節都讀這份。沒給時，在審查用 worktree 的根目錄執行**判級指令**：

```bash
node "${CLAUDE_SKILL_DIR}/scripts/tier.mjs" judge --base <fixed point> --head <ticket 分支> > <scratchpad>/review-<票>-tier.json 2> <scratchpad>/review-<票>-tier.err
```

輸出格式、訊號的算法、門檻與覆寫旗標都寫在腳本檔頭；照輸出讀，不自己重算：

- `tier`：寫進審查區塊。`reasons` 是判到這一級的條件。
- `finders`：第 2 節照它派 Finder。
- `verifiers.max`、`fixVerifiers`：第 4、7 節照它合批。
- `mutationCap`：第 3 節的突變上限；`null` 表示只動說明文字，沒有可執行的行。
- `reviewers`：第 2 節照它決定要不要派 architecture 專項 reviewer；只有 `full` 列了 `architecture`。

判級指令以非 0 結束時，`tier` 當成 `full`，`finders` 當成 `[["line-by-line","deleted-behaviour"],["cross-file"],["acceptance","conventions"]]`，
突變上限 10，`reviewers` 當成 `["primary","architecture"]`，第 4、7 節用 `--tier full`；`<scratchpad>/review-<票>-tier.err` 的路徑補進接續紀錄的「證據路徑」欄。

完成判準：輸入齊全，含針對性檢查跑的 SHA 或它沒有回報；不成立的前提已輸出 `stuck` 並停止；驗收被改過時已記下 `acceptance` finding；
審查用 worktree 由 `worktree.mjs open` 開在 ticket 分支尖端，相依依 `install` 處理，diff 已存檔；`tier` 取自呼叫方給的判級輸出，
沒給時取自判級指令的輸出，或在它失敗時是 `full`。

## 2. Finder：平行找候選

判級輸出的 `finders` 每個內層陣列派一個 finder，套用陣列裡列的 lens，同一則訊息一次派出，Agent tool 的
`description` 是 `finder` 後接票的識別碼。`pruned` 列的 lens 已依 diff 機械裁剪，不派、不寫進任何 prompt：沒有
刪除行不派被刪除的行為，沒有規則檔涵蓋改動檔不派 repo 慣例，簽章沒變時跨檔案契約併入逐行。

本 skill 的 finder、architect（下方）、verifier（第 4 節）與 Fix Verifier（第 7 節）一律由你以前景派送：你在自己的
回合裡等它們全部回來才往下。呼叫方以前景 spawn 你，但 Agent tool 可能把你放到背景：這時呼叫方等你的完成通知
來了才收你的回報，你的做法不變。`get-to-work` 給審查主持 agent 一個時限（`timeout-review`）：你被放到背景時它
照樣掃時限，超時就停下你，改派一次、重發同一模式的審查。
spawn 被拒 —— 拿不到 Agent tool，或被 plugin 的 hook 以預算為由擋下 —— 時不重試、不換路，也不自己兼任：結論
`stuck`，原因寫被拒的訊息，已完成的節照第 5 節留給續跑。

**四者是 plugin 的 agent 定義檔。** Agent tool 的 `subagent_type` 依序是 `sorry-matt:finder`、`sorry-matt:architect`、
`sorry-matt:verifier`、`sorry-matt:fix-verifier`；定義檔在 plugin 根目錄的 `agents/`，即本 skill base directory 往上兩層的
`../../agents/finder.md`、`../../agents/architect.md`、`../../agents/verifier.md`、`../../agents/fix-verifier.md`。工具與固定規則（工作規則、裁決規則、
回報格式）都在定義檔：派工只傳各節列的值（路徑、lens、候選或 finding），不重述規則，也不指定模型。定義檔的
`tools:` 不給 Edit 與 Write，但留著 shell —— 審查要跑測試與 `git` —— 而 shell 寫得了檔，所以這不是唯讀保證：
「審查不改這張票的 diff」仍靠定義檔的文字規則，加上第 6 節 `worktree.mjs status` 的 `git status --porcelain`
檢查來發現。這些 agent 類型不在可用清單時改派通用 agent、不指定模型：prompt 是定義檔 frontmatter 以下的本文
（其中的 `${CLAUDE_PLUGIN_ROOT}` 換成 plugin 根目錄的絕對路徑）接上同樣的派工內容，`description` 相同。

四者的回報只有定義檔指定的欄位。推理過程、probe 的程式與輸出寫進筆記目錄 `<scratchpad>/review-<票>-notes/`
底下的檔案（派工時給這個路徑），回報給路徑：你的 context 只收裁決要用的欄位。

四者的 Agent tool `description` 一律以角色字開頭、後接票的識別碼（GitHub 是 `#N`，Local Markdown 是票檔名）：
`finder #72`、`architect #72`、`verifier #72`、`fix-verifier #72`。plugin 的 hook 把它記進 run 的 counters 檔，`get-to-work` 收官時靠
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

Finder 看不到目前對話，派工內容只有值：repo 與審查用 worktree 的絕對路徑、fixed point、ticket 分支、diff 檔路徑、
票面全文、筆記目錄，以及它套用的每個 lens 的全文（上列）。向外追查的範圍、只找不裁決、回報欄位與每個 finder
至多六則都寫在定義檔。回報的每則候選有 `file`、`line`（新檔行號）、`lens`、`summary`、`failure_scenario` 與
`suspected`（疑似 spec 層級或既有）；`suspected` 是 `spec`（附被指定的原文）、`pre-existing`（附 fixed point 上的
位置）或 `none`。

每位 reviewer 是一個候選來源，候選帶 `by` 欄標明來自哪位：Finder 的是 `primary`，第 1 節的 `acceptance` finding
與第 3 節的實跑、突變候選也算 `primary`。

**architecture 專項 reviewer。** 判級輸出的 `reviewers` 列了 `architecture`（只有 `full` 級，也就是高風險的票）時，
在派 Finder 的同一則訊息多派一個 architect（`sorry-matt:architect`），`description` 是 `architect` 後接票的識別碼；
其他級不派。派工內容與 Finder 相同，只是不給 lens：它的 lens —— 不變式歸屬、接縫位置、單一事實來源、失敗模式、
能不能更簡單 —— 與回報欄位都在定義檔。它的產出以觀察為主，回報兩份清單：

- `observations`：還沒有可達失效情境的架構問題，每則有 `file`、`line`、`lens`、`summary`、`evidence` 與 `cost`
  （哪個可預見的後續改動要因此多碰哪些地方）。不經 verifier、不影響結論，照第 6 節寫進審查區塊的
  `reviewer: architecture` 段。
- `candidates`：已經造成使用者看得到失效的，欄位與 Finder 的候選相同，`by` 是 `architecture`。和其餘候選一起
  去重，走第 4 節的合批與裁決。

多一位 reviewer 只是多一個候選來源，第 3 節以後的步驟不變。

完成判準：所有 finder 都已回報，`reviewers` 列了 `architecture` 時 architect 也已回報；同一行、同一失效機制的候選已去重，保留 `failure_scenario`
最具體的一則；每則候選都有 `suspected`；每個 hunk 都至少經過一次逐行 lens。

## 3. 實跑與突變

這一步由審查方做，不交給實作者。

### 實跑

**審查只跑受影響範圍，全套不在審查裡跑。** 有 CI 的線由 CI 在整併後跑全套；CI 不涵蓋整合分支或沒有 `origin`
的線，由呼叫方在收官跑一次全套（`get-to-work` 的本機驗證）。`ticket-pr` 沒有整合分支，全套由這張票的票級 PR 的
CI 跑。CI 覆蓋不改變範圍。

**同一組測試在一次審查裡至多跑一次。** 實作 agent 已經跑過針對性檢查；審查依審查分級決定沿用還是自己跑：

- **`light` 與 `standard`：SHA 相同就沿用。** 把第 1 節回報的 SHA 與審查 head 都解成完整 SHA 比對：

  ```bash
  git -C <repo> rev-parse --verify "<回報的 SHA>^{commit}" "<ticket 分支>^{commit}"
  ```

  兩行相同時不跑：實跑的結果就是回報的指令與結果，不跑 `scope.mjs`。`live run` 行寫 `scope=affected`、`ci` 照第 1 節
  的 CI 覆蓋、`source` 照回報的 `source`，另加 `reused=<SHA>`，log 路徑寫回報檔的路徑（第 6 節）。兩行不同、回報沒有
  SHA，或解不出來時，照下面的 `full` 自己跑一次 —— 絕不沿用別的 commit 的結果。
- **`full`：自己跑一次。** 不論 SHA 相不相同，照下面判範圍、實跑一次 `affected`。實作 agent 的結果只用來確認開審
  前提（第 1 節）。敏感改動保有一次獨立實跑，也只多這一次。

自己跑的時候，在審查用 worktree 的根目錄先判範圍：

```bash
node "${CLAUDE_SKILL_DIR}/scripts/scope.mjs" --base <fixed point> --ci <第 1 節的 CI 覆蓋> > <scratchpad>/review-<票>-scope.json
```

呼叫方沒給 CI 覆蓋時省略 `--ci`。範圍與指令來源的規則寫在腳本檔頭，照輸出讀：輸出的 `scope` 一律是
`affected`，這裡只跑 typecheck、涵蓋改動檔的測試、改動檔相關的 lint。把輸出的 `targeted`（指令契約「Targeted
checks」原文）套到 `changed` 上得出指令；它是 `null` 時自己從 manifest 與測試設定推。`tests` 是候選的測試檔，沿
import 或契約的對照確認涵蓋改動檔才算。專案沒有 typecheck 或 lint 就不跑那一項。

自己跑時指令由審查方自己選，不照抄實作 agent 回報的那條。輸出的 `scope`、`ci`、`source` 照抄進 `live run` 行（第 6 節），
所以看得出 CI 覆蓋、指令來自契約還是自己推的。實跑的結果 —— 沿用的或自己跑的 —— 就是突變的基準，突變不再為基準
另跑一次（下方的 `--green-at`）：

- 全綠 → 進突變。
- 紅燈 → 紅燈本身是一則候選（lens `live-run`），交 Verifier 裁決。基準不綠，突變沒有意義，
  這次不突變，突變紀錄寫 `skipped: red baseline`（格式見第 6 節）。沿用的結果不會是紅的：第 1 節只收綠燈的票。

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
node "${CLAUDE_SKILL_DIR}/scripts/mutate.mjs" run --base <fixed point> [--lcov <lcov 檔>] --plan <scratchpad>/mutants.json --ledger <scratchpad>/review-<票>-r<round>-ledger.json --cmd "<測試指令>" [--green-at <實跑的 SHA>] > <scratchpad>/mutants-result.json
```

在審查用 worktree 的根目錄執行。`--cmd` 用涵蓋選定行的測試指令，取自實跑的指令或它的縮小版。

**基準沿用實跑。** `--cmd` 是實跑裡綠過的一條指令原文 —— 沿用時是回報裡的一條，自己跑時是你跑過的一條 —— 而且
在審查用 worktree 的根目錄照原文就能跑時，加 `--green-at <實跑的 SHA>`（沿用時是回報的 SHA，自己跑時是審查
head）：那個 SHA 就是審查用 worktree 的 HEAD 時，腳本不再跑基準，輸出 `baselineSource: "reused"`。輸出
`greenAtIgnored` 時是 SHA 不是 HEAD，腳本照常跑了基準。`--cmd` 要比實跑的指令窄、或要改寫才能跑時不加
`--green-at`：腳本先跑一次那條窄指令當基準 —— 一條每次都失敗的指令會把每個 mutant 都算成殺掉，基準就是擋這件事的。

腳本拒絕不在本票 diff 改動行上、或 lcov 標為未覆蓋的 mutant，拒絕同一行兩個 mutant、`original`
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
`light` 與 `standard` 在回報的 SHA 等於審查 head 時沿用了回報、沒有重跑，SHA 不同或沒有 SHA 時與 `full` 一樣自己跑；
自己跑的範圍與指令來源取自 `scope.mjs` 的輸出，指令不是照抄實作 agent 的；同一組測試在本輪只跑了一次：`--cmd` 是實跑
綠過的指令原文時帶了 `--green-at`，只有更窄或改寫過的 `--cmd` 由腳本另跑基準；
突變只碰本票 diff 中有覆蓋的行，每行至多一個、總數不超過上限，超過上限時本票新測試宣稱守住的行排最前；
每個 mutant 都有結果；`mutate.mjs` 非 0 結束時已照上面三種情況處理；每個存活的 mutant 都成為候選。

## 4. Verifier：逐項獨立裁決

候選（含第 3 節的實跑與突變候選）由腳本**合批**。每個候選給一個 `id`，把 `id`、`file`、`suspected` 寫成 JSON
陣列，在審查用 worktree 的根目錄執行：

```bash
node "${CLAUDE_SKILL_DIR}/scripts/tier.mjs" batch --tier-file <scratchpad>/review-<票>-tier.json --items <scratchpad>/review-<票>-candidates.json
```

判級指令失敗時以 `--tier full` 取代 `--tier-file`。輸出的 `batches` 每批交給一個 verifier（`sorry-matt:verifier`），
全部並行派出，`description` 是 `verifier` 後接票的識別碼。標了 `suspected` 的候選整批交給一個 verifier（批的
`short`），其餘依檔案分組（批的 `normal`），總批數不超過判級輸出的 `verifiers.max`。合批只決定 verifier 的數量，
不合併候選。

派工內容只有值：repo 與審查用 worktree 的絕對路徑、ticket 分支、fixed point、票面與驗收快照（或兩者的檔案路徑）、
筆記目錄，以及該批候選的欄位。省略 finder 的推理，避免錨定偏誤；`suspected` 與它附的原文或位置照給。裁決規則
—— 簡化流程、反駁優先與三關、四種裁決、五條 blocking 判準、修法方向與回報格式 —— 都在定義檔，派工不重述。

Verifier 對批內每個候選回報一項裁決：**成立**、**pre-existing**、**spec 層級**或**不成立**，附 `file:line` 證據；
成立的寫出命中的 `rule`（`acceptance`、`regression`、`red`、`safety`、`unpinned` 之一，沒命中寫 `none`），命中的
就是 blocking，附修法方向；最後一行 `noticed` 是它裁決途中看到的其他問題，由你當成觀察。引用與它標明的
來源對不上時，才換一個 verifier 重驗。

分流（結果寫進候選 `by` 的那位 reviewer 的段落，見第 6 節；`noticed` 一律進 `primary` 段）：

- **成立且 blocking** → finding，帶 `rule`。
- **成立但不 blocking** → 觀察。
- **spec 層級** → 觀察，句末標 `(spec-level)`。
- **pre-existing** → 列進 `pre-existing`。
- **不成立** → 丟棄；突變候選的處置寫進突變紀錄（例如「等價 mutant，不成立」）。

觸發修正的只有 finding。觀察與 pre-existing 由呼叫方依 get-to-work 的期間開票處理，這張票照結論往下走。

完成判準：每個候選恰有一項裁決，附 `file:line` 證據，以及三關結果或簡化流程查過的兩項；同批的
候選也逐條裁決；每則 finding 都有命中的 `rule`、它的引用與可證偽的修法方向；每個 mutant 在突變紀錄都有處置。

## 5. 結論

- `pass`：沒有成立且 blocking 的 finding，驗收比對也沒有變。
- `fix`：至少一則成立且 blocking 的 finding；第 1 節的 `acceptance` finding 算一則。
- `stuck`：審查做不完 —— 開審前提不成立、還原失敗、審查用 worktree 跑不起測試。寫明原因、
  解除條件，以及已完成到哪一節。開審前的 `stuck`（第 1 節）不算一次審查，排除後重跑 `initial`；
  審中的 `stuck` 排除後只續跑未完成的節，沿用區塊裡已有的候選、裁決與突變紀錄，不重派 Finder 與 architect。`stuck` 時
  審查用 worktree 照第 6 節移除，續跑時由 `open` 重建。

**結論以 verifier 的裁決為準。** 你把每則裁決原樣抄進區塊：finding 就是 verifier 判為 blocking 的那幾則，
觀察就是其餘成立的，加上 architect 回報的 `observations`（不經裁決，原樣抄進它的段落）。你認為某則觀察該擋下整併時，另派一個 verifier 只重判那一則的 `rule`，以它的裁決為準。

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

live run: scope=<affected | findings> ci=<covered | uncovered | no-origin> source=<commands.md | self-found> [reused=<sha>] -> green | red (<log path>)
- <command> -> green | red
mutation (round <n>): tool=<manual | stryker | cargo-mutants | mutmut> cap=<n> baseline=<reused | ran> mutated=<n> survived=<n> uncovered=<n> coverage=<lcov | inferred>
- <file>:<line> <operator> -> killed | timeout | survived | restore-failed: <disposition: F2 | equivalent, invalid | ...>
- error: <message> (<mutation output path>)
restored: yes | no | n/a
```

`live run` 一行寫範圍、CI 覆蓋與指令來源，底下每條指令一行：`scope` 是第 3 節 `scope.mjs` 輸出的 `affected`，
複驗（第 7 節）寫 `findings`；`ci` 照輸出的 `ci`；`source` 取自契約寫 `commands.md`，自己找或自己推的
寫 `self-found`。`reused=<sha>` 只在第 3 節沿用實作 agent 的結果時出現：值是它跑的完整 SHA，底下的指令與結果照
回報，log 路徑是回報檔；自己跑的不寫。`mutation` 行的 `baseline` 照 `mutate.mjs` 輸出的 `baselineSource`
（`reused` 是沿用實跑、`ran` 是腳本另跑了基準）；用突變工具時寫 `ran`。`- error:` 只在 `mutate.mjs` 以執行期錯誤結束時出現；`restore-failed` 只用在結束代碼 3 那個
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
重排；`verdict` 以全部 reviewer 的 finding 推得。判級輸出的 `reviewers` 列了 `architecture` 時，`reviewer: primary` 那段
之後接一段 `reviewer: architecture`，欄位相同：`findings`、`pre-existing` 與成立但不 blocking 的觀察來自 `by` 是
`architecture` 的候選的裁決；它回報的 `observations` 也進這段的 `observations`，每則寫成
`- <file>:<line> [<lens>] <summary>; cost: <cost> (evidence: <evidence>)`。finding 的編號（`F1`、`F2`…）整個區塊連續，
不因分段重來；審查回報的 `counts` 加總全部段落。

把這個區塊寫進該票接續紀錄的「驗證結果」欄，取代上一個 `sorry-matt:review` 區塊，`round`
遞增。被取代的區塊裡每一段 `mutation (round <n>)` 原樣帶進新區塊、放在本輪那段之前，所以初審
的完整突變紀錄不會被複驗蓋掉；「證據路徑」欄補上 diff、實跑與突變輸出的路徑。

**複驗的 `stuck` 不丟掉待驗的 finding。** `mode: recheck` 的區塊結論是 `stuck`（含開審前的）時，被取代區塊的
`findings` 每則原樣帶進新區塊（本輪已有 Fix Verifier 裁決的照第 7 節在 `summary` 前標 `closed` 或 `open`），`head`
也沿用被取代區塊的 —— 那是下一次複驗要驗的 finding，與它算修正 diff 用的上次 head。排除後的複驗因此從同一批
finding 與同一個上次 head 驗起，不會因為區塊裡沒有 finding 而判 `pass`。

GitHub 原地更新那則第一行是
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
counts: findings=<n> observations=<n> pre-existing=<n> candidates=<n> confirmed=<n> invalid=<n> blocking=<n>
block: <where the review block is: the status comment's URL, or the ticket file's path; none when no block was written>
stuck: <reason (clear: <how to clear it>; completed: <last section done, or none>), or none>
```

`verdict`、`review`、`mode`、`tier` 與區塊裡的相同；`counts` 的前三個數的是區塊裡的條目，沒有寫 0。後四個數的是這一輪的
裁決（#156，供事後回顧每個成立的 finding 花了多少）：`candidates` 是送去裁決的候選數（Finder、architect 與突變的候選），
`confirmed` 與 `invalid` 是 verifier 判成立與不成立的數（pre-existing 與 spec 層級兩者都不算），`blocking` 是成立且
blocking 的數。複驗沒有 Finder：`candidates`、`confirmed` 與 `blocking` 都數 Fix Verifier 回報的本輪新 finding，
`invalid` 寫 0。寫不進接續紀錄時
（tracker 拒絕、檔案被鎖），`verdict` 寫 `stuck`、`block` 寫你存下的區塊檔的路徑，原因寫寫入失敗的訊息。

**結論定案時移除審查用 worktree。** `verdict` 是 `pass` 或 `stuck`，或這是第二次複驗（上一個區塊是
`mode: recheck` 的 `fix`）而結論仍是 `fix` —— 不會再有複驗 —— 時，寫完區塊後在 repo 內執行：

```bash
node "${CLAUDE_SKILL_DIR}/scripts/worktree.mjs" close --path <scratchpad>/review-<票>
```

其餘的 `fix` 留著它，給下一次複驗沿用。

完成判準：區塊符合上述格式；`live run` 行看得出範圍是 `affected` 還是 `findings`；`restored` 取自
`worktree.mjs status`；接續紀錄只有一個最新的 review 區塊，而且保有歷輪的突變紀錄；沒有發出任何 PR 評語、
review 或 `suggestion` 區塊；結論定案時審查用 worktree 已移除，其餘的 `fix` 留著它；回傳給呼叫方的只有至多
六行的審查回報，不含 finding 全文。

## 7. 複驗

集中修正之後，呼叫方再以前景 spawn 一個審查主持 agent，模式 `recheck`；你從接續紀錄讀上一次的審查區塊。複驗只回答一個問題：上一次的每則
finding 關上了沒有。它的範圍是那幾則 finding 與修正 commit 的 diff（`git diff <上次 head>..<ticket 分支>`），
所以每一輪要驗的東西只會變少。審查用 worktree 照第 1 節的 `worktree.mjs open` 沿用初審那一個、移到修正後的
ticket 分支尖端，不另建；`tier` 沿用初審的。複驗不派 Finder 與 architect：上一個區塊有 `reviewer: architecture`
段時，本輪照樣保留這一段，它的 finding 照下面第 1 步驗。

1. **Fix Verifier**：把 finding（`acceptance` finding 除外，它走第 4 步）的 `id`、`file` 寫成 JSON 陣列，以
   `node "${CLAUDE_SKILL_DIR}/scripts/tier.mjs" batch --tier <沿用的 tier> --stage fix --items <scratchpad>/review-<票>-r<round>-findings.json`
   合批：`light` 與 `standard` 一張票一批，`full`
   一個檔案一批。每批一個 Fix Verifier（`sorry-matt:fix-verifier`），並行派出；同批的每則 finding 各自作答、各得
   一項裁決。`description` 是 `fix-verifier` 後接票的識別碼。修正 commit 的 diff 存成
   `<scratchpad>/review-<票>-r<round>-fix.diff`。派工內容只有值：repo 與審查用 worktree 的絕對路徑、ticket 分支、
   上次的 head、修正 diff 的路徑、筆記目錄，以及每則 finding 的 `summary`、`evidence`、`rule` 與 `fix`；省略實作者的
   說明。作答規則 —— 重跑 `evidence` 記的情境、兩題、第二題照 verifier 的三關與五條 blocking 判準且第二關的
   fixed point 換成上次的 head —— 在定義檔，派工不重述。

   它對每則 finding 回報**已關閉**或**未關閉**，附 `file:line`，以及修正 diff 的改動行裡命中判準、成立的本輪新
   finding（附 `rule` 與修法方向）。回報最後一行 `noticed`：同一則 finding 的其他寫法、修正 diff 以外的行、沒命中
   判準的問題，由你當成觀察。
2. **實跑**：只跑 findings 的範圍 —— 涵蓋 finding 行的測試，加上修正新增的測試。不論審查分級，都不重跑初審的
   `affected`、不跑 `scope.mjs`，也不沿用修正 agent 回報的結果。`live run` 行寫 `scope=findings`，`ci` 照第 1 節的
   CI 覆蓋，`source` 是這幾條指令的來源。
3. **突變**：只重跑上次存活的 mutant，這次必須被殺掉；該行內容變了，就在取代它的那一行做同一個運算子的
   mutant。用本輪新的 ledger。基準沿用第 2 步：`--cmd` 是第 2 步綠過的指令原文時加 `--green-at <修正後的 head>`
   （第 3 節）。修正新增的行由第 1 步第 2 題把關。
4. **驗收比對**：讀呼叫方附上的新比對輸出。`check.changed` 為 false，`acceptance` finding 才算
   關閉；為 true 時它維持未關閉，原本沒有的就依第 1 節記成本輪新 finding。

結論：每則 finding 都已關閉、實跑全綠、上次存活的 mutant 全被殺掉、驗收比對沒有變，而且沒有
新的 finding → `pass`；否則 `fix`。輸出照第 6 節，`mode: recheck`，每則舊 finding 的 `summary` 前標 `closed` 或
`open`；`noticed` 的每一行進 `observations`。

**一張票至多兩次 `recheck`。** 第二次的結論仍是 `fix` 時，區塊照寫，呼叫方依 get-to-work 的規則把這張票標
卡住；本輪新 finding 與舊 finding 算在同一個輪數裡。

完成判準：每則舊 finding 都有一項 Fix Verifier 裁決與證據（`acceptance` finding 以新的比對輸出裁決）；實跑只跑
findings 的範圍、沒有重跑 `affected`，突變只重跑上次存活的 mutant；本輪新 finding 都落在修正 diff 的改動行上並帶 `rule`；
結論與區塊已依第 6 節寫進接續紀錄。
