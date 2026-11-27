# ASKING：提問與 run 狀態的共用契約

`have-it-all-done`、`get-to-work` 與 `take-this` 在開場時全文讀取本檔，全程適用。

一句話版本：**能寫出建議就代答，真的要人裁的事一次問完。**

## 0. 開場

讀完本檔後依序讀三份：

1. `docs/agents/issue-tracker.md`：provider 與慣例。不存在時，請使用者執行
   `/setup-matt-pocock-skills`，取得設定後再繼續。
2. `docs/agents/environment.md`，取得已落檔的環境事實。不存在時略過。
3. `docs/agents/commands.md`：**專案指令契約**，定義在下面。不存在時照下面的「缺檔時」。

**專案指令契約**是 repo 自己的檢查指令，寫一次，實作、審查與本機驗證都讀同一份，不各自從 manifest 與 CI
設定找。它是 Markdown，五個固定的英文 `##` 標題，順序固定；標題是給 skill 對照的鍵，不翻譯、不改名。標題底下
的說明用專案自己的語言，指令放在 fenced code 或反引號裡，在 repo 根目錄原樣可執行。沒有內容的欄寫 `none`。

| 標題 | 寫什麼 |
| --- | --- |
| `Full checks` | repo 完整的自動檢查：test、typecheck、lint 與 CI 跑的其他檢查，一行一條指令。每條結束代碼 0 才算綠。 |
| `Targeted checks` | 怎麼把檢查縮到單一檔案或單一 package：指令的寫法，以及改到的檔對應哪些檢查。 |
| `Coverage` | 產出 lcov 的指令，與 lcov 檔的位置。 |
| `Failures only` | 這個專案只印失敗的行與結尾摘要的寫法。通過與否仍取檢查指令本身的結束代碼，在任何過濾之前取得。 |
| `Sensitive paths` | 審查判級用的敏感路徑，一行一個 repo 相對路徑，目錄以 `/` 結尾：改動會影響權限、guard、CI、發布或部署的地方。一行也可以寫成 `path#symbol`（寫法同預計檔案），只有碰到該 symbol 的改動才算敏感。 |

**缺檔時。** `get-to-work` 的主持人在凍結票集前產生它（`get-to-work` 第 0 節）；其他 skill 不產生。讀取點
—— 實作 agent 的針對性檢查、`prove-it` 的實跑、`get-to-work` 的本機驗證 —— 在沒有這份檔時照現況自己從
manifest 與 CI 設定找指令。有這份檔、但讀取點要用的那一欄是 `none` 時，那一欄照缺檔處理：自己找，回報寫
`self-found`；`none` 不代表沒有檢查要跑。每個讀取點都在回報寫明用的是哪一種：`commands.md` 或 `self-found`。

**產生規則。** 內容只從 repo 讀出來：manifest 的 scripts、CI 設定的執行步驟、既有的覆蓋率設定；敏感路徑取
repo 裡實際存在的 CI 設定、hook 與 guard、發布與部署設定、權限設定與資料庫 migration 的路徑。每一欄附來源檔案
路徑。讀不到的欄寫 `none`，不問使用者，也不寫沒在 repo 裡看到的指令。這次產生記進 run 層自答清單（第 3 節）。

## 1. 提問前置檢查

每個提問先過三關，三關全過才問：

1. **查得到嗎**：這個事實能不能用指令、repo 檔案或 git 歷史查到？能就去查。
2. **他用過這個詞嗎**：題目裡的專有名詞是不是使用者命名或用過的？不是就先解釋，
   或換成他用過的詞。
3. **有沒有在要他回想狀態**：凡是「你記得有沒有……」「你是不是已經設過……」的選項一律刪掉。
   他記得的事，agent 查得到。

反向義務：agent 自己建立的環境產物 —— 網域、主機、代理規則、白名單、憑證位置、
測試店識別、預覽站 —— 當輪就寫進 `docs/agents/environment.md`。沒落檔，下一輪一定
再問一次同一件事。

完成判準：送出的每個提問都通過三關；本輪新建立的每個環境產物都已落檔。

## 2. 什麼該問

只有落在下列四類、而且通過第 1 節的事項才准問。四類的預設值如下；repo 自己的
`CLAUDE.md` 或通用 `AGENTS.md` 另有規定（**專案例外**）時以 repo 為準。

### (a) 做多遠

範圍與停點由使用者裁。**提案一律從「全開」起跳**：先給完整範圍，再逐項列出風險。
推薦縮小時，指名命中了哪一項需要授權的動作、災難級操作（第 5 節）或專案例外，並附那一項的證據。

### (b) 產品行為正確性

預設是**顧客看得到的缺陷就修、同形缺陷一次全改、修了就登記偏離**。
「照抄上游、登記偏離、不改程式」是省流程成本，不是工程結論，所以它不是推薦選項。
同一個失效形態在別處還有幾處，一併查出來寫進選項。

### (c) 跨 repo 或別人負責的範圍

不問，也不提議代修。只開票、連回來源證據、不排進本次時程。

### (d) 設計定案

保留提問，但預設選項不挑限制最緊的那個。涉及權限、觸發面或對外介面時，
提案一律附速率限制與稽核紀錄。

完成判準：每個提問都能歸到四類之一；不屬四類的事項都已依第 3 節代答。

## 3. 什麼該代答

**能寫出建議等於有能力代答。** 不屬第 2 節四類的事項一律代答，不先問。每個代答記一列：

| # | 決定 | 理由 | 反轉成本 | 證據位置 |
| --- | --- | --- | --- | --- |

反轉成本寫「改回來要動哪些檔、要不要重跑什麼、會不會動到已交付的東西」，寫得出數量就
寫數量。它是裁決點與複核的排序依據，不是形容詞。

同一個代答只寫一次，分兩層：只影響單一票、而且在那張票的 worktree 內可逆的實作細節，
記在該票的接續紀錄（開工前展開時做的，記在該票的展開區塊）；反轉成本跨票或跨交付的才進 run 層**自答清單**。使用者在既有
grilling 中親自做出的決策屬於需求依據，不列入。

完成判準：風險閘門之後的每個非四類決定都已記錄在其中一層，且每列五欄俱全。

## 4. 裁決點與節流

- 風險閘門之後，整個 run 有且只有**一個裁決點**，位置固定在規劃交付完成、實作開工之前。
- 裁決點**一次問完**：一次提問，多題或多選，每題附建議。工具上限四題；待裁事項超過四項時
  依反轉成本由高到低只問最高的四項，其餘代答記檔。
- 裁決點之後到最終報告之間，中途冒出來的事情走這三條出路，沒有第四條：
  1. 能代答 → 代答記檔，繼續跑。
  2. 答不出來 → 標**待裁決**，讓該票卡住，繼續跑其他票。
  3. 只有人能做 → 進**人工作業清單**，繼續跑其他票。
- 最終報告做一次**複核**：一題多選「這些代答要翻哪一項」，選項取 run 層自答清單中反轉成本
  最高的四項，完整清單放在報告本文。
- **流程設定**（run profile）：這個 run 要不要放寬流程 —— 審查深度、修正輪數、複驗、修不掉的 finding 的去處、
  展開、整併方式、讀不讀 CI、精簡 —— 在裁決點定案（獨立執行的 `get-to-work` 在凍結時），以 `get-to-work` 的
  `scripts/state.mjs profile` 寫一次，之後不能改；欄位、預設與它放寬的守門寫在該腳本檔頭。預設是嚴格流程，不列題；
  使用者要求放寬，或專案例外指出某一項不適用時才寫，理由記進自答清單。profile 放寬不了第 5 節的授權規則與災難級操作，
  也放寬不了下一點的上限。
- run 層上限與階段時限（第 7 節第 9 欄）只有使用者能調整。`budget: spawns` 與 `budget: rounds` 依票數計：
  - `spawns` = max(`20 × 票數 + 50`, 已用 spawn 數 + `20 × 票數`)。每張票典型約 12 個 spawn —— 展開、實作、
    初審與複驗各一個審查主持 agent、`prove-it` 標準級的兩個 finder、至多三個 verifier 與一輪修正的 Fix Verifier、
    整併 —— 每票 20 個留了將近一倍的餘裕當最後保險，常數 50 涵蓋規劃與收官；規劃已用掉超過 50 個時，改以已用數
    加上每票 20 個，票的份額不被規劃吃掉。
  - `rounds` = `3 × 票數 + 1`：每張票至多帶出三個派票點（自己的整併、一次退回、一次卡住／撤回／紅轉綠），加上
    第一個。

  裁決點前以開局發布的票數改寫這兩行；獨立執行的 `get-to-work` 沒有裁決點，在凍結票集時改寫。上限與時限預設
  不列題；有具體理由預期預設不夠（例如票面寫明的長時間資料遷移或大型測試）時，把調整列為一題，照反轉成本與
  其他題一起排序。中途不夠用時不代答調高：上限到了就停止派票，時限到了延長一次或停下，都由 `get-to-work` 的
  腳本判。
- 目視驗收（`have-it-all-done` 步驟 5）是驗收程序，不是裁決，不受本節限制。

完成判準：風險閘門與最終複核之間恰好一個裁決點，且該裁決點之後沒有任何提問；
每個中途事項都能在自答清單、待裁決或人工作業清單找到落點；放寬流程的 run 已在裁決點前（獨立執行時在凍結時）
寫好 profile；`budget: spawns` 與 `budget: rounds` 已在裁決點前（獨立執行時在凍結票集時）依票數改寫，使用者
在裁決點指定的值除外。

## 5. 授權與災難級操作

授權不由 agent 判斷，也不記在任何 agent 讀的檔案裡：需要授權的動作放不放行，交給 Claude Code
的權限設定；三類災難級操作由 plugin 的 hook 直接擋下。

### 需要授權的動作

合併 PR（`integrate: ticket-pr` 的票級 PR，或總 PR）、部署到非正式環境這類動作，直接用正規指令送出 ——
合併一律用 `gh pr merge`，疊在 `gh stack` 裡的票級 PR 用 `gh stack merge` —— 它是確認呼叫，排到最後。
放不放行由 Claude Code 的權限設定決定，不另外問，也不依 agent 自己寫的任何紀錄判斷。合併只在有**常設授權**
（權限設定的 `permissions.allow` 涵蓋要送的 `gh pr merge` 或 `gh stack merge`）或使用者本 run 指示合併時送出，
否則留給人合併。`ticket-pr` 下沒有常設授權時，開局問一次本 run 能不能合併（`get-to-work` 的 `SKILL.md` 第 0 節
凍結第 5 步；組合時在第 4 節的裁決點）：開局讀設定只決定要不要問，不取代確認呼叫時權限設定的決定。被擋下或
被拒就記進人工作業清單，附上能放行它的權限規則；不換指令繞道。每個送出的動作與放行結果記進 ledger 第 5 欄。

### 以後都這樣

使用者說某個動作以後都照做時，輸出一段權限規則片段，請使用者自己加進設定。本 skill 不寫
任何設定檔，寫入時 hook 也會先跳確認。只用在這個 repo 就加進 `.claude/settings.local.json`（Claude Code
建立它時會排除在 git 之外），所有專案通用就加進 `~/.claude/settings.json`。檔案已經有
`permissions.allow` 時，把規則併進既有陣列，不要整段覆蓋：

```json
{
  "permissions": {
    "allow": [
      "Bash(gh pr merge:*)",
      "PowerShell(gh pr merge:*)",
      "Bash(gh stack merge:*)",
      "PowerShell(gh stack merge:*)"
    ]
  }
}
```

權限提示裡選「不再詢問」效果相同，由 Claude Code 自己寫入。

### 災難級操作

plugin 的 `hooks/hooks.json` 以 PreToolUse 檢查 Bash 與 PowerShell 指令，下列三類直接擋下（deny，不問），
判斷寫在 `hooks/classify.mjs`：

- 遞迴刪除檔案系統根目錄、系統目錄或家目錄（如 `rm -rf /`、`rm -rf ~`、`Remove-Item -Recurse C:\Windows`）；
- 刪除遠端的 main 或 master 分支；
- force-push 遠端的 main 或 master 分支。

hook 只比對常見寫法的指令文字，不是安全邊界：藏在變數、直譯器包裝（`bash -c`、`pwsh -Command`、`eval`）、
subshell 或 pipe 後面的寫法它看不到。災難級操作一律不做：被擋下的不換寫法重試、不設法繞過、不停下來等；
hook 沒擋下的同類操作也一樣不做。subagent 把它寫進回報交給主持人；主持人記進人工作業清單，附上要執行的指令與
後果，繼續做其他做得了的事。

其他有風險的動作 —— 發布版本、部署正式環境、寫入 Claude Code 設定、對外發訊、金流、force-push 一般分支、
專案內的刪除 —— hook 不判斷，放不放行交給使用者自己的 Claude Code 權限設定；權限提示本身就讓它成為
**確認呼叫**（`have-it-all-done` 第 0 節）。被權限擋下或使用者在提示拒絕的，照上一節記進人工作業清單。

完成判準：本輪每個需要授權的動作都以正規指令送出，放行結果已記進 ledger 第 5 欄；沒有執行任何災難級
操作，需要的都已列在人工作業清單並附要執行的指令；被擋下的動作都在人工作業清單上，並附權限規則片段或
要執行的指令；本輪沒有寫入任何設定檔。

## 6. 語言與對外文字

- 提問、選項與結尾問句一律使用使用者在當前對話使用的語言。
- **潤稿只給人看的兩種文字**：總 PR body，以及等人 triage 或處理的 issue（期間開票的
  raw issue、卡住紀錄的 raw issue）。呼叫 Skill tool 帶入 `no-bullshit`。
- 其餘寫到 tracker 或 git 的文字 —— spec、tickets、commit message、接續紀錄、tracker 留言 —— 以及
  run ledger，讀者是下一個 agent，不潤稿。
- 所有對外文字都只講結論與方向，不反問對方偏好、不加客套與結尾邀請。

完成判準：本輪每個提問與每份對外文字都符合上述四條。

## 7. run ledger 與上下文預算

**run ledger** 是本 run 敘事狀態的正本，位置是**共用目錄**（`git rev-parse --path-format=absolute
--git-common-dir`）下的 `sorry-matt/runs/<run>.md`。同一任務已有 ledger 時直接接手，不從對話的
壓縮摘要重建；沒有時建立一份。`get-to-work` 的機器狀態 —— 線、對帳表、用量與停止原因 —— 在 ledger 旁的
`<run>.state.json`，只由它的腳本寫，schema 在 `get-to-work` 的 `scripts/state.mjs` 檔頭。

第一行是狀態標記：建立時寫 `<!-- sorry-matt:run active -->`；整個 run 的最後一個步驟結束時改成
`<!-- sorry-matt:run ended -->` —— 組合時是 `have-it-all-done` 的交棒（步驟 5 不執行時）或目視驗收
之後，獨立執行的 `get-to-work` 是收官之後。標記前不能有任何一行：plugin 的 hook 只認第一行（BOM 不算）。
十個欄位：

1. **下一個動作**：一行，恢復後照著做。
2. 任務範圍與採用的 grilling 來源落點。
3. 風險閘門三燈與放行紀錄。
4. 線與整合分支：state 檔的路徑；線、tip、CI 結果、本機驗證逐 SHA 紀錄與併入的基底都在 state 裡。
5. 需授權動作的結果：送出的每個需要授權的動作（第 5 節）與放行結果，擋下的附權限規則片段或要執行的指令。
6. run 層自答清單。
7. 人工作業清單。
8. **對帳表**：state 檔的路徑（`state.mjs show`；一列一票的階段、派送紀錄、計數與 merge SHA）。
9. **計量與預算**：
   - **上限**：一行一項 `budget: <名稱> <整數>`，建立 ledger 時寫入預設值，接手沒有這幾行的 ledger 時補上：
     `budget: spawns 200`、`budget: rounds 40`（派票點次數，不是審查或修正的輪）、`budget: hours 12`、
     `budget: no-progress 3`。`spawns` 與 `rounds` 在票數確定時照第 4 節改寫。
   - **階段時限**：同樣格式，單位分鐘：`budget: timeout-implement 30`、`budget: timeout-fix 20`（含紅燈修正）、
     `budget: timeout-expand 15`、`budget: timeout-merge 15`、`budget: timeout-review 60`（審查主持 agent）、
     `budget: timeout-verify 30`（本機驗證的每個 check，以及主持人自己在背景跑的長命令：超過就殺掉整棵程序樹，
     記成 timeout，不是紅燈；另有固定 10 分鐘的輸出閒置上限）。建立 ledger 時一併寫入；接手沒有
     `timeout-verify` 這行的 ledger 時照預設 30 算，ledger 檢查不因缺它轉紅。另有一行可省略的 `budget: wake-check 20`：fallback 喚醒最多等幾分鐘（沒寫就是 20），讓回合結束卻沒交回報的
     agent 不必等到它的階段時限才被看到。
   - **用量與停止原因**在 state 的 `usage` 與 `stop`。spawn 數取自 hook 寫的 `<run>.counters.json`，只讀不寫。
     向使用者提問時，從送出到收到回答的秒數以 `state.mjs usage --wait` 加進等人時間。token 數除非執行環境自己
     提供，一律標為未知，不以耗時或 agent 數量推算。
   - **主持人 session**：一行 `session: <id>`，值是主持人自己的 shell 指令裡環境變數 `CLAUDE_CODE_SESSION_ID`
     的值（以 `node -e "console.log(process.env.CLAUDE_CODE_SESSION_ID || '')"` 讀）。建立 ledger 時寫入；接手
     ledger 與每次恢復時（`/loop` 喚醒除外）重讀一次，值不同就改寫成當前的。讀不到值時不寫這行。
10. **規則檔**：主持人本 run 以讀檔帶入、全程要遵守的每份規則檔，一行一份 `rule: <絕對路徑>`，建立 ledger
    時就填好，接手既有 ledger 時補齊缺的。經 Skill tool 載入的那份 `SKILL.md` 也列：壓縮只重附它的
    前 5,000 tokens。只在某一步讀的檔（交付說明的模板、`get-to-work` 的 `RED-LIGHT.md`、`TIMEOUTS.md`、
    `SEND-BACK.md`、`FINISH.md`）不列：用到的那一步本來就會讀它。

plugin 的 hook 收整份 ledger 裡每一行 `budget:`、`rule:` 與第一行 `session:`，所以其他欄不要以這三個字開頭寫行。

共用目錄不可寫，或當前目錄不在 git repo 內時沒有 ledger —— 正本改為最終報告，在報告明記，
不為此停工。每個步驟結束、`get-to-work` 每次喚醒結束都把它寫到最新。

**恢復**：壓縮發生過、`/loop` 重新喚醒，或任何一次恢復之後，第一個動作是重讀 ledger，
再重讀第 10 欄列出的每份規則檔全文，然後才照第 1 欄做，不從上下文的摘要推。壓縮後 plugin
的 SessionStart hook 會把進行中的 ledger 與它的規則檔路徑印進 context；沒看到提示時這條照樣
適用。

**主持人的上下文有預算。** diff、測試日誌、agent 報告與票面全文都留在 subagent 與檔案裡；
主持人收的是固定格式的摘要（上限十五行）與證據路徑，需要細節時用指令只取那幾行。審查由收票時 spawn 的審查主持
agent 主持，主持人只收它至多六行的審查回報（`get-to-work/REVIEWER.md`）；`prove-it` 的 finder、verifier 與 Fix
Verifier 的回報留在審查主持 agent 那裡。主持人交給 subagent 的任務以它的交付說明為界：交付說明
沒寫的檢查，要做就開成 raw ticket，留給下一個 run。

完成判準：`get-to-work` 的 run 在凍結之後與改成 ended 之後各跑一次 `state.mjs check <state> ledger --ledger <路徑>`
（後者加 `--ended`）並通過；每次恢復的第一個動作都是重讀 ledger 與它列出的規則檔；沒有共用目錄時已明記正本
改為最終報告；主持人的上下文裡沒有 diff、測試日誌或 agent 報告的原文。
