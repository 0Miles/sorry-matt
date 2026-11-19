# 規則刪減紀錄（#5、#6）

每條規則問「拿掉它會出什麼錯」。答不出來就刪；重複出現在多份 skill 的只留一個正本，其他地方引用。
本檔列出每條刪掉或搬走的規則與一句理由，以及主持人要讀的規則量前後對照。對照表見
[`matt-skills.md`](matt-skills.md)。

## 主持人要讀的規則量

組合執行（`have-it-all-done` → `get-to-work`）時主持人讀進 context 的 dist 檔，以 `wc -lw` 量測。
改前是 `724a67b`。

| 檔案 | 改前 行／字 | 改後 行／字 |
| --- | --- | --- |
| `have-it-all-done/SKILL.md` | 209 / 2370 | 148 / 1572 |
| `have-it-all-done/ASKING.md` | 166 / 1553 | 198 / 1898 |
| `get-to-work/SKILL.md` | 239 / 2570 | 195 / 2068 |
| **主持人自己要遵守的規則** | **614 / 6493** | **541 / 5538**（−12% 行、−15% 字） |
| 轉交給實作 agent 的流程（改前 `implement.md`，改後 `IMPLEMENTER.md`） | 17 / 103 | 86 / 809 |
| **主持人讀進 context 的總量** | **631 / 6596** | **627 / 6347** |

`ASKING.md` 變長，是因為三個 skill 各寫一份的開場讀取、run ledger 與上下文預算都收進它當正本。

實作 agent 這一側：改前收到 `implement.md`（17 行）、三條延伸契約，再以 Skill tool 載入 `tdd`
（`SKILL.md`、`tests.md`、`mocking.md` 合計 174 行），其中有它做不到的「跟使用者確認 seams」。改後只收
`IMPLEMENTER.md`（86 行），自足、沒有要它問人的地方。

開局 agent 這一側：改前讀 `take-this/SKILL.md`、`to-spec.md`、`to-tickets.md`、`ASKING.md`（100＋75＋105
＋166＝446 行）；改後讀 `take-this/SKILL.md`、`TEMPLATES.md`、`ASKING.md`（133＋84＋198＝415 行）。

重新量測：

```bash
wc -lw skills/have-it-all-done/SKILL.md skills/have-it-all-done/ASKING.md skills/get-to-work/SKILL.md skills/get-to-work/IMPLEMENTER.md
```

## 待腳本或 hook 落地的規則

這些規則先留著，以 `<!-- pending #N -->` 標記，由各自的票落地後刪文字（`#8`、`#11`、`#16` 已落地，見文末）。
目前已無待落地項目。

| 標記 | 位置 | 規則 |
| --- | --- | --- |

## 刪掉或搬走的規則

### have-it-all-done

| 規則 | 處置 | 理由 |
| --- | --- | --- |
| 開頭「授權級別依 `ASKING.md` 第 5 節的三層決定，不寫死在本 skill 裡」 | 刪 | 重複 `ASKING.md` 第 5 節。 |
| 開頭「替使用者回答 matt skills 的確認點」 | 改寫 | 不再載入帶確認點的上游原文，這句沒有對象。 |
| 第 0 節「六條規則……隨 spawn 一併交付給本 run 的每個 subagent」 | 改為「交付內容要自足」，實作 agent 收 `IMPLEMENTER.md` | 原寫法讓 subagent 收到它讀不到的規則與檔案（#6）。 |
| 第 0 節規則 1「依 `ASKING.md` 第 2 節，值得問的只有四類，都在裁決點一次問完」 | 刪 | 重複 `ASKING.md` 第 2、4 節。 |
| 第 0 節規則 4 的舉例「上傳、寫檔、更新文件、commit」 | 刪 | 重述同一條規則。 |
| 第 0 節兩段展開「依 `ASKING.md` 第 3 節代答，理由記進接續紀錄」 | 搬到 `IMPLEMENTER.md` 第 1 節 | 做完整展開的是實作 agent，規則要在它的交付內容裡。 |
| 第 0 節上下文預算全文，與壓縮成本的推導 | 搬到 `ASKING.md` 第 7 節；推導刪 | `get-to-work` 也寫了一份，留一個正本；推導是理由不是規則。 |
| 第 1 節開場四份讀取 | 搬到 `ASKING.md` 第 0 節 | 三個 skill 各寫一份。 |
| 第 1 節 run ledger 九欄、恢復規則、無共用目錄的處理 | 搬到 `ASKING.md` 第 7 節 | `get-to-work` 獨立執行也要用，原本它沒有欄位定義。 |
| 第 1 節「ledger 和 `authority.md` 同住，位置理由見 L1」 | 刪 | 理由，不是規則。 |
| 第 1 節「只有命中永久例外或 repo 例外時才推薦縮小，並指名是哪一項」 | 刪 | 重複 `ASKING.md` 第 2 節 (a)。 |
| 第 1 節「這次放行涵蓋後續 matt skills 確認點，但不含永久例外」 | 刪 | 前半沒有對象（不再載入上游確認點）；後半重複 `ASKING.md` 第 5 節護欄 4。 |
| 第 2 節「seam 與切票確認依 `ASKING.md` 第 3 節代答……五欄……分兩層」整段 | 刪；「使用者在 grilling 親自做的決策不列入」搬進 `ASKING.md` 第 3 節 | 重複 `ASKING.md` 第 3 節。 |
| 第 2 節裁決點細節（取最高四項、授權分「這次／以後」、當場寫 `authority.md`） | 刪 | 重複 `ASKING.md` 第 4 節與第 5 節 L2／L1。 |
| 第 2 節完成判準「每個代答都找得到答案與理由」「常設授權都已落檔」 | 刪 | 由 `ASKING.md` 第 3、5 節的完成判準涵蓋。 |
| 第 3 節「完整遵守它的品質閘門：自動檢查通過後才驗收……」 | 刪 | 重述 `get-to-work` 自己的關卡順序。 |
| 第 3 節「六條規則交給 `get-to-work`，它 spawn 的每個實作 subagent 也要收到」 | 刪 | `get-to-work` 是主持人自己照做，不是 subagent；實作 agent 改收 `IMPLEMENTER.md`。 |
| 第 3 節「ledger 路徑交給它，每輪收輪由它寫回」 | 刪 | 同上；寫回時機在 `ASKING.md` 第 7 節。 |
| 第 4 節授權表欄位、複核題目、對帳表欄位、計量細節 | 搬到 `ASKING.md` 第 5 節護欄 2、第 4 節、第 7 節第 8、9 欄 | 交棒報告與 `get-to-work` 的最終輸出各寫一份。 |
| 第 5 節「依 `ASKING.md` 第 4 節」 | 改為本節即正本 | 目視驗收的規則原本兩處各寫一次。 |

### ASKING

| 規則 | 處置 | 理由 |
| --- | --- | --- |
| 開頭「本檔與各 skill 既有的提問措辭衝突時以本檔為準」 | 刪 | 這是「載入上游、再覆寫」的覆寫條款；上游確認點不再載入，沒有可衝突的對象。 |
| 第 3 節「代答只處理判斷，不處理授權……永遠不代答」 | 刪 | 重複第 5 節首句。 |
| 第 4 節目視驗收整段 | 縮成一行豁免，正本在 `have-it-all-done` 第 5 節 | 只有 `have-it-all-done` 會走到。 |
| 第 5 節 L1 的 `git rev-parse` 程式區塊 | 搬到第 0 節 | 共用目錄只定義一次。 |
| 第 6 節「對外文字一律跑 `speak-human` 與 `no-bullshit`」 | 改為只用在總 PR body 與等人處理的 raw issue | spec、tickets、票級 PR、留言的讀者是下一個 agent，潤稿只花 token。 |
| 第 6 節「對第三方的問題單」 | 刪 | 第三方溝通是永久例外，自動流程不會寫。 |
| 第 6 節「每次更新都跑這兩個 skill，等於把省下來的成本再花掉」 | 刪 | 理由，不是規則。 |
| 第 7 節「正本在檔案裡時，壓縮只是失去便利」 | 刪 | 理由，不是規則。 |

### get-to-work

| 規則 | 處置 | 理由 |
| --- | --- | --- |
| 第 0 節開場四份讀取 | 搬到 `ASKING.md` 第 0 節 | 三個 skill 各寫一份。 |
| 第 0 節 run ledger 與上下文預算 | 搬到 `ASKING.md` 第 7 節 | 與 `have-it-all-done` 重複。 |
| 第 0 節「force-push 一律由人；真錢交易……是永久例外」 | 刪；force-push 併入 `ASKING.md` 第 5 節護欄 4 | 重複永久例外清單。 |
| 第 0 節兩種模式的交付物條列 | 縮成一句，交付物只寫在第 2 節 | 重複第 2 節。 |
| 第 1 節「每次喚醒的第一個動作是重讀 ledger」 | 刪 | 重複 `ASKING.md` 第 7 節。 |
| 開輪：完整讀取 pinned `implement`，加三條延伸契約覆寫其中兩行 | 自有流程取代：`IMPLEMENTER.md` | 載入上游再覆寫；實作 agent 還會經 `tdd` 收到「跟使用者確認」（#6）。 |
| 開輪：needs-triage 票的完整展開、回報格式、接續紀錄定義 | 搬到 `IMPLEMENTER.md` 第 1、4、5 節 | 都是實作 agent 要做的事，要在它的交付內容裡。 |
| 開輪完成判準「每個 agent 都收到三條延伸契約」「每張票都已建立接續紀錄」 | 改為「prompt 是填好的 `IMPLEMENTER.md`」；接續紀錄由收輪完成判準涵蓋 | 延伸契約已不存在。 |
| 收輪「要問的事累積到下一次開輪前……由 `have-it-all-done` 組合時一律交給它的唯一裁決點」 | 改為走三條出路，獨立執行時才累積到下一次開輪 | 與 `ASKING.md` 第 4 節矛盾：裁決點在實作開工前，收輪時早已過了。 |
| 收輪 Local Markdown「這是 sorry-matt 的延伸契約；上游沒有定義完成狀態」 | 刪 | 理由，不是規則。 |
| 收輪整併「守住上下文預算」 | 刪 | 重複 `ASKING.md` 第 7 節。 |
| 收官證據失效「不能再當作本輪的驗收證據」 | 刪 | 與「綠燈過期」同義。 |
| 收官「對外文字依 `ASKING.md` 第 6 節」 | 改為在總 PR 與 raw issue 處各指一次 | 潤稿範圍縮小後，只有這兩處需要。 |
| 收官最終輸出的對帳表欄位與計量項目 | 搬到 `ASKING.md` 第 7 節 | 與 `have-it-all-done` 交棒重複。 |

### take-this

| 規則 | 處置 | 理由 |
| --- | --- | --- |
| 「請使用者指定」「請使用者執行 `/setup-matt-pocock-skills`」等問人措辭 | 保留給使用者直接執行；被組合為開局 agent 時改為依證據擇一記進代答、標待裁決或回報主持人（第 1 節「兩種情境」） | 開局 agent 是 subagent，問不到人；與 `have-it-all-done` 第 0 節「交付內容不能有要它問人的地方」矛盾。 |
| 第 1 節開場讀取 | 搬到 `ASKING.md` 第 0 節 | 三個 skill 各寫一份。 |
| 第 1 節「to-spec 與 to-tickets 的每個確認點依第 3 節代答」 | 改寫 | 上游確認點不再載入。 |
| 第 2 節「一般的實作選擇沿用既有授權自行裁定」 | 刪 | 重複 `ASKING.md` 第 3 節。 |
| 第 3、4 節：完整讀取 pinned `to-spec`、`to-tickets` 照做 | 自有流程取代（第 3、4 節與 `TEMPLATES.md`） | 載入上游再覆寫。 |
| 上游 `to-spec`「Check with the user that these seams match」 | 刪，改為代答並寫進 Testing Decisions | 被代答覆寫的那一行。 |
| 上游 `to-tickets` 第 4 步「Quiz the user… Iterate until the user approves」 | 刪，改為代答 | 被代答覆寫的那一行。 |
| 上游「The issue tracker… should have been provided… tell the user to run `/setup-matt-pocock-skills`」 | 刪 | `ASKING.md` 第 0 節已讀 tracker 設定。 |
| 上游 `to-tickets`「Gather context」與「Work the frontier」 | 刪 | 需求脈絡在第 2 步已建立；推進 frontier 是 `get-to-work` 的事。 |
| 第 4 節「這是 sorry-matt 的延伸契約：pinned 流程的模板不變」 | 刪 | 沒有上游可延伸了。 |
| 第 5 節「每張票在新的 session 中執行 `/implement`」 | 改為請使用者執行 `/get-to-work` | sorry-matt 不再依賴 `implement`。 |
| 第 5 節代答清單五欄的重述 | 刪 | 重複 `ASKING.md` 第 3 節。 |

### grill-them

| 規則 | 處置 | 理由 |
| --- | --- | --- |
| 支線「呼叫 Skill tool 帶入 `research` 並照做」＋「findings 寫入 scratchpad，不寫入 repo」 | 自有兩行指示取代 | 上游要存進 repo，這裡要寫 scratchpad —— 載入上游再覆寫。 |
| 「只要求 agent-griller 把模糊詞、一詞多義與難以逆轉的決策列為主要靶點」 | 刪 | 在 `grilling` 上加行為，違反「只傳參數」；`grilling` 的 design tree 本來就逐一走完每個分岔。 |

### ask-miles

| 規則 | 處置 | 理由 |
| --- | --- | --- |
| `take-this` 路由說明「沒有時才執行 grill-them，再完成 to-spec → to-tickets」 | 改寫 | 已過時：`take-this` 預設不開訪談，只有重大分歧才開 `grill-them`，也不再走上游 to-spec／to-tickets。 |

## 新增的規則

- `IMPLEMENTER.md`：實作 agent 的自足交付說明。seams 以票為準，票上沒寫就自定並記入接續紀錄（#6）。
  它和 `ASKING.md` 第 3、5 節、`have-it-all-done` 第 0 節有刻意的重複：實作 agent 讀不到那兩份，
  檔頭標明要一起改。
- `TEMPLATES.md` 的票模板加 Seams 欄，讓「seams 以票為準」有地方寫。
- `ASKING.md` 永久例外清單加 force-push（原本只寫在 `get-to-work`）。
- CI：`.github/workflows/check.yml` 在 PR 上跑 `claude plugin validate`、`scripts/check-structure.mjs`
  （src／dist 結構對帳）、`scripts/check-vendored.mjs`（vendored 檔 SHA-256），以及兩支腳本的測試。

## #8：授權與永久例外改由 permissions 與 hook 強制

| 規則 | 處置 | 理由 |
| --- | --- | --- |
| `ASKING.md` 第 0 節讀共用目錄的 `sorry-matt/authority.md` | 刪 | 授權不再存在 agent 讀的檔案裡。 |
| `ASKING.md` 第 5 節 L2／L1／L0 三層與 `authority.md` 的五欄格式 | 改為「需要授權的動作以正規指令送出，由 Claude Code 權限設定決定」 | 放不放行由權限設定判，模型讀 markdown 判不算數。 |
| `ASKING.md` 第 5 節護欄 1–3（每列附出處、報告印授權表與檔案路徑、新增列只來自當輪原話） | 刪 | 保護的對象是 `authority.md`；它已移除，權限規則由使用者自己寫、`/permissions` 看得到。 |
| `ASKING.md` 第 5 節護欄 4（永久例外清單） | 留清單，加「plugin hook 擋下」 | 清單是規劃依據（第 2 節 (a)、人工作業清單）；強制改由 `hooks/guard.mjs`。 |
| `ASKING.md` 第 7 節 ledger 第 5 欄「本輪授權表」 | 改為「需授權動作的結果」 | 欄號不動，內容改記送出的動作與放行結果。 |
| `have-it-all-done` 步驟 2「需要授權的動作依第 5 節在這裡一併問」 | 刪 | 權限提示本身就是當下的詢問；「不再詢問」就是以後都這樣。 |
| `get-to-work` 第 0 節授權來源、第 2 節「常設授權允許時合併」 | 改為「CI 綠後送出 `gh pr merge`，由權限設定決定」 | 同上。 |

新增：

- `hooks/hooks.json` 與 `hooks/guard.mjs`：PreToolUse 擋下永久例外八類的指令（含繞道寫法）與繞過
  `gh pr merge` 的合併；測試在 `scripts/guard.test.mjs`，CI 一起跑。
- 「以後都這樣」改為輸出 `.claude/settings.local.json` 或 `~/.claude/settings.json` 的權限規則片段，由使用者
  自己加入。
- 永久例外的「安裝套件」明定為安裝新套件，含在 manifest 加相依與 `npx`／`pnpm dlx`／`uvx` 下載執行；照
  lockfile 還原相依不算，一律用凍結寫法。hook 放行 `npm ci`、不帶套件名的 install，以及專案本地 bin 的 `npx`。
- 受保護分支（main、master、remote 預設分支）只能經 `gh pr merge` 進去：直接 push、`gh api` 的 refs／contents／
  merge 端點、MCP 的 merge 與 push 工具都擋。
- `bypassPermissions` 與 `auto` 模式下沒有人確認，hook 連 `gh pr merge` 都擋。
- 使用者可在 Claude Code settings 的 `env` 設 `SORRY_MATT_GUARD=off` 關掉 hook；skill 文字照樣不做。

## #11：可開工的票改由腳本計算

| 規則 | 處置 | 理由 |
| --- | --- | --- |
| `get-to-work` 第 0 節凍結第 2 步「依 tracker 契約讀取 blocker 邊並劃分線……需要排鏈時呼叫 `issue-chain`」 | 改為執行 `get-to-work/scripts/frontier.mjs`，以輸出的 `blockedBy`、`line` 為準 | 每輪靠 LLM 重讀票面推邊，結果不保證每次一樣。`issue-chain` 留給需要給人看的排鏈。 |
| `get-to-work` 開輪「frontier 是尚未完成、blocker 均已解除的票」 | 改為每次開輪重跑腳本，frontier 就是輸出的 `frontier`；GitHub 傳 `--done`／`--stuck`，Local Markdown 每線帶 `--ref` 與 `--line`、取聯集 | 同上。每線只報自己的票：別線已完成的票在本線分支上讀起來仍是 open，會被重派。 |
| `get-to-work` 收輪「Local Markdown 的 blocker 只在同一整合分支可讀到完整 `sorry-matt completion` 且 criteria 全勾後解除」 | 刪 | 由腳本判定，`scripts/frontier.test.mjs` 有測。 |
| `get-to-work` 收輪「卡住票的下游 tickets 保持阻塞」與收輪完成判準的 completion 契約子句 | 刪；改為 `stalled` 不為 null 的票列為待裁決 | 由腳本判定：卡住票以 `--stuck` 傳入或票檔有 `sorry-matt blocker`，下游的 `stalled` 是 `blocked-upstream`。循環與集合外未完成的 blocker 同樣標出，否則這些票永遠不 ready 又不算卡住，loop 收不了尾。 |

新增：

- `get-to-work/scripts/frontier.mjs`（零依賴）：GitHub 用原生 issue dependencies，並與票面 `Blocked by:` 行（tracker
  契約的 fallback）取聯集，兩者不一致時輸出 warning；closed 一律算完成，含 not planned，與 GitHub 自己的 open blocker
  計數及 tracker 契約一致。Local Markdown 解析票檔的 Blocked by 與 `sorry-matt completion`。兩者輸出同格式的 JSON
  （`sorry-matt/frontier@1`，格式寫在檔頭）。測試在 `scripts/frontier.test.mjs`，GitHub 經 `gh` seam 用 fixture，
  不打真的 API；CI 一起跑。
- `get-to-work` 凍結第 3 步排除他線佔用後重跑一次腳本，排除可能讓線分裂。
- `scripts/check-structure.mjs`：skill 內的 `scripts/` 與 metadata 一樣，src 與 dist 要逐位元組相同（LF 正規化）。

## #13：取消票級 PR，關票交給總 PR

| 規則 | 處置 | 理由 |
| --- | --- | --- |
| `get-to-work` 收輪第 4 步「票級 PR（GitHub only）：push ticket 分支，建立以線整合分支為 base 的 PR，body 含 `Closes #N` 與驗收摘要」 | 刪；摘要改寫進該票的 commit message（`IMPLEMENTER.md` 第 2 節） | GitHub 只在 PR 指向預設分支時解析關閉關鍵字，指向整合分支的 `Closes #N` 合併後不關票；每支 PR 還要另外建立、可能觸發 CI，人最後審的仍是總 PR。 |
| `get-to-work` 收輪完成交付「保留已因整併顯示為 merged 的票級 PR 作為審查紀錄」 | 刪 | 票級 PR 不存在了；審查紀錄在接續紀錄與 commit message。 |
| `get-to-work` 收官總 PR「Body 收錄票級 PR」 | 改為每張完成票一節：摘要（主持人從該票整併進線的全部 commit 彙整，含集中修正）與 `Closes #N` | 同上。 |
| `ASKING.md` 第 6 節不潤稿清單的「票級 PR body」 | 改為「commit message」 | 票級 PR 不存在了；摘要改寫在 commit message，讀者是主持人。 |

新增：

- `IMPLEMENTER.md` 第 2 節：每個 commit 的 subject 帶票 ID，body 寫這個 commit 改了什麼與它滿足的驗收，集中修正的 commit
  照同樣寫；不寫關閉關鍵字，關票只走總 PR 一條路。只取單一 commit 的 body 會漏掉審查後的修正。
- `get-to-work` 收官「關票」：總 PR 合併後確認完成票已關閉；基底不是預設分支時關鍵字不生效，由主持人依 tracker 契約
  關票。總 PR 留給人合併時（`gh pr merge` 被權限設定擋下或被拒，見 #8），關票指令進人工作業清單。
- `frontier.mjs` 不變：整併後票仍是 open，GitHub 模式照舊由主持人以 `--done` 傳入。

## #7：驗收項改由實作者以外的 agent 在開工前補齊

| 規則 | 處置 | 理由 |
| --- | --- | --- |
| `IMPLEMENTER.md` 第 1 節「票上沒有驗收項、只標著 needs-triage 時，先完成完整展開……寫進接續紀錄」 | 刪；改為「驗收項只讀不改，需要改回報待裁決」與「做不到就回報卡住，這是合法結果」 | 補驗收的人就是要通過它的人，審查的需求軸對照的正是實作者自己寫的標準。給模型放棄的出口能降低改測試、改規格的作弊（ImpossibleBench）。 |
| `have-it-all-done` 第 0 節兩段展開「完整展開……由實作 agent 依它的交付說明完成」 | 改為由 `get-to-work` 開輪的展開 agent 在實作開工前完成 | 同上；延後展開的理由（上游實作改寫下游事實）不變，只換人做。 |
| `take-this` 第 4 步「驗收項延到它即將進入 frontier 時才補滿」 | 補上「由展開 agent 補，不交給實作 agent」 | 同上。 |
| `prove-it` 第 1 節「驗收項標了出處的，對照時連出處一起保留」 | 改為輸入原票票面、展開區塊、驗收快照與比對輸出；驗收對照以快照為準 | 「標了出處」原本沒有人負責標，審查也無從得知驗收有沒有被改過。 |

新增：

- `get-to-work/scripts/acceptance.mjs`（零依賴）：讀出一張票的驗收項與出處（`original` 或附 `by`、`run`、`round` 的
  `expansion`），輸出 `sorry-matt/acceptance@1`；`--against` 與快照比對，勾選狀態不算改動。測試在
  `scripts/acceptance.test.mjs`，GitHub 經 `gh` seam 用 fixture；CI 一起跑。「只讀不改」用它機械強制：開輪 spawn 前存快照，
  收輪審查前比對，比對結果交給 `prove-it`。
- `get-to-work` 開輪：先跑腳本，`needsExpansion` 的票交給一個展開 agent（`get-to-work/EXPANDER.md`，自足交付說明），
  它在 tracker 寫標明 `by`、`run`、`round` 的展開區塊（GitHub 一則留言；Local Markdown 票檔的 `## sorry-matt expansion`，
  frontier 腳本本來就不把 `## sorry-matt …` 節的勾選框算進完成判定）；之後每張要派的票存驗收快照，才開分支、spawn 實作 agent。
  展開不了的票列待裁決。
- `prove-it`：驗收比對 `changed` 直接記一則 blocking `acceptance` finding，結論不能是 `pass`；輸出區塊加 `acceptance:` 一行，
  標出原票與展開各幾項。複驗時以新的比對輸出裁決這則 finding。
- `IMPLEMENTER.md` 回報加 `acceptance:` 逐項狀態，`awaiting ruling` 改為 `awaiting ruling / stuck`。
- `ASKING.md` 第 3 節：展開時的票級代答記在展開區塊。

機械強制的邊界：腳本證明的是「快照之後驗收沒變」。「不是實作 agent 寫的」靠順序：快照在 spawn 實作 agent 之前存，
快照裡的每一項都早於它。

審查後的修正：

- 快照路徑推得出來，實作 agent 可以同時改 tracker 與快照，讓比對看起來沒變。主持人在 spawn 前把快照的 `sha256` 記進
  ledger 對帳表（`ASKING.md` 第 7 節第 8 欄），比對時以 `--sha` 傳入；腳本從快照的 items 重算 hash，不符就
  `snapshotIntact: false`、`changed: true`、結束代碼 3。ledger 也在共用目錄，但實作 agent 的交付說明不提它，要同時改
  tracker、快照與 ledger 三處才蓋得過去。
- 不做 guard hook 擋 `sorry-matt/runs/*/acceptance/` 的寫入：hook 分不出呼叫者是主持人還是實作 agent，主持人自己存
  快照也會被擋；`--sha` 已經讓改快照被抓到。
- GitHub 的展開區塊是留言，不在票面全文裡：`IMPLEMENTER.md` 加「展開區塊」佔位，由主持人從驗收快照的
  `expansions[].text` 填入（腳本輸出新增這個欄位）。
- 腳本解析：展開區塊裡只有 `by`、`run`、`round`、`acceptance`、`rulings` 是 key，其他 `word: …` 行是一般文字（原本會
  被當成 key，後面的驗收項默默丟掉）；任何層級的 `Comments`／`sorry-matt …` 節都不算原票驗收，放在 `## Acceptance`
  底下的 `### sorry-matt expansion` 不會被重複計成 original。`EXPANDER.md` 規定展開節一律用 `##`。

## #9：壓縮後強制重讀規則檔

| 規則 | 處置 | 理由 |
| --- | --- | --- |
| `ASKING.md` 第 7 節「壓縮發生過、`/loop` 重新喚醒，或任何一次恢復之後，第一個動作都是重讀它，不從上下文的摘要推」 | 改為獨立的「恢復」段：重讀 ledger，再重讀第 10 欄列出的每份規則檔全文，然後才照第 1 欄做 | `have-it-all-done` 以讀檔帶入 `get-to-work/SKILL.md` 與 `ASKING.md`；壓縮只重附每個 skill 最近一次 Skill 呼叫的前 5,000 tokens，讀檔帶入的規則不在其中，這些 skill 又是 `disable-model-invocation: true`，模型無法重新載入。只重讀 ledger 時，主持人憑摘要執行各道關卡。 |
| `ASKING.md` 第 7 節「位置是共用目錄下的」 | 補上共用目錄的定義（`git rev-parse --path-format=absolute --git-common-dir`） | #8 拿掉 `authority.md` 時連帶刪了第 0 節唯一的定義，「共用目錄」變成沒有定義的詞；hook 要找 ledger 也需要明確位置。 |
| `get-to-work` 第 1 節 `/loop` prompt「get-to-work：收輪／開輪」 | 改為帶 ledger 絕對路徑的「重讀 … 與它第 10 欄列出的規則檔，再收輪／開輪」 | 每次喚醒都是這句 prompt；恢復動作寫在 prompt 裡，就不靠壓縮後殘留的記憶。 |

`have-it-all-done` 與 `get-to-work` 本文沒有「喚醒後先讀 ledger」的文字可刪：那段在 #5 已搬進 `ASKING.md` 第 7 節（見上方 get-to-work 表「每次喚醒的第一個動作是重讀 ledger」），本票改的是那個正本。

新增：

- ledger 第一行狀態標記 `<!-- sorry-matt:run active -->`／`<!-- sorry-matt:run ended -->`，與第 10 欄**規則檔**（一行一份
  `rule: <絕對路徑>`，建立 ledger 時填）。欄號往後加，既有九欄不重編。
- `hooks/reread.mjs`＋`hooks/runs.mjs`（零依賴）：SessionStart（matcher `compact`）在共用目錄的 `sorry-matt/runs/*.md`
  找第一行是 active 標記的 ledger，以純文字 stdout 印出 ledger 與它的規則檔路徑（找不到的檔案標 not found）；沒有 git、
  沒有 ledger、只有 ended 的 ledger 時不輸出。測試在 `scripts/reread.test.mjs`，CI 一起跑。
- 同一 repo 有多個進行中的 run 時，hook 全部列出，提示主持人重讀自己那一份；hook 不以 session 篩選。
- 改成 ended 的那一步寫在各收尾步驟與其完成判準：`have-it-all-done` 第 4 節（第 5 節不執行時）、第 5 節，
  獨立執行的 `get-to-work` 收官。只寫在 `ASKING.md` 時沒有步驟負責，ledger 會一直 active，之後每次壓縮都印出已結束的 run。
- 第 10 欄在接手既有 ledger 時補齊；只在某一步讀來填交付內容的檔（`EXPANDER.md`、`IMPLEMENTER.md`、`TEMPLATES.md`）不列。
- hook 只認真正的第一行（BOM 不算）；`rule:` 行收整份 ledger，`ASKING.md` 規定其他欄不以 `rule:` 開頭。

## #14：grill-them 改用檔案交換問答

| 規則 | 處置 | 理由 |
| --- | --- | --- |
| 第 3 節「把 agent-griller 整輪的所有問題逐字轉給 agent-grillee」「把整輪答案逐字傳回 agent-griller」 | 改為雙方寫檔，主持人只傳檔案路徑與輪次 | 每輪問答在主持人的 context 進出兩次，整場拷問堆在主持人身上；被 `take-this`、`have-it-all-done` 組合時還吃掉主持人的上下文預算。 |
| 第 3 節「主持人只傳原文，不摘要、潤飾或加入立場，也不挑題傳話」 | 改為「訊息只含路徑與輪次」，加上對打期間不讀、不改雙方的檔案 | 主持人不經手內容，「不摘要、不挑題、不改寫」由結構保證，不再靠自律。 |
| 第 2 節「兩者全程只讀」 | 改為不改 repo 與外部狀態，只在對打目錄寫自己負責的檔 | 雙方要寫問題檔與答案檔。 |
| 第 3 節支線「實例與執行輸出都寫入 scratchpad」「findings 寫入 scratchpad 的一份 Markdown」 | 改為寫入 `side-<r>-<n>/`，結論在 `result.md`；主持人只把路徑交給 agent-grillee | 支線結果同樣不經主持人轉述。 |
| 第 4 節「先請 agent-griller 提交最終判決」 | 改為 agent-griller 結束時寫 `verdict.md`，含結束理由與逐題裁定；主持人收場時讀檔彙整四個區塊 | 主持人對打期間沒讀過內容，交鋒摘要的裁定要有出處可對。四個區塊不變。 |

新增：

- 第 1 節的**對打目錄**：主持人在 repo 之外建立（有 harness scratchpad 就建在其下，否則 macOS／Linux `mktemp -d`，Windows
  一律 PowerShell `GetTempPath()`；Git Bash 的 `mktemp` 回 MSYS 路徑，不交出），把絕對路徑交給雙方與支線 agent；不假設 subagent 自己的 scratchpad 位置。收場後保留。
- 檔名規則：`topic.md`、`round-<r>-questions.md`、`round-<r>-answers.md`、`side-<r>-<n>/`、`round-<r>-answer-<n>.md`、
  `verdict.md`。輪次與題號編在檔名裡，問答對應不靠主持人記。
- 雙方回給主持人的訊息只含路徑與狀態；agent-grillee 在回報列出待支線題號與支線類型，主持人依此開支線，不必讀答案檔。
- 自動流程的上限改以檔案計數：問題檔三份、`side-*` 目錄兩個。
- 每題最多一條支線：支線回來後證據仍不足、或結束／到上限時支線未回的題目，直接進待裁決。原本這兩種情況沒有出路。

## #10：收官前併入最新基底

| 規則 | 處置 | 理由 |
| --- | --- | --- |
| `get-to-work` 第 2 節「線級的兩道關」（精簡 → 完整驗證） | 改為三道關，中間加**併入基底**：`git fetch origin <基底分支>` 後合併 `origin/<基底分支>`（Local Markdown 沒有 remote 時合併本地基底），基底 SHA 記進 ledger 第 4 欄（`ASKING.md` 第 7 節同步補上） | 整合分支只在第 0 節建一次，run 期間主線前進時，唯一有效的綠燈跑在舊基底上，總 PR 可能衝突或語意衝突。放在精簡之後、完整驗證之前，讓併入與驗證之間沒有其他改動；所以解完 conflict 不另跑針對性檢查，緊接的完整驗證已涵蓋。 |
| 併入時的 conflict | 引用第 1 節收輪步驟 4 的整併 agent 與判準，不另寫；兩邊定為「線（票面與 commit message）」與「基底（`<merge-base>..<基底 ref>` 的 commit message）」，取捨進自答清單 | 同一套判準只留一份正本。 |
| 解不了的基底 conflict | `git merge --abort`，該線標**未併入**：ledger 記嘗試的基底 SHA 與「未併入」，照樣在未併入的樹上跑完整驗證，報告寫明；不送 `gh pr merge`、不進 merge queue，一律留給人合併，關票走「留給人合併」 | 線級 conflict 不屬於任何一張票，不能套票級的「卡住」，所以給一個不阻擋交付的出口；但沒驗過最新基底的線不能由 agent 合併。 |
| 第 2 節完整驗證 | 補「跑在步驟 2 之後的整合分支上，報告寫出基底 SHA」；完成判準與最終輸出同步 | 驗收要求報告可追溯當時的基底。 |
| 證據失效規則的改動來源 | 補「併入基底」 | 併入基底同樣會改到票碰過的檔案。規則的簡化留給 #12。 |
| 第 2 節 `gh pr merge` 送出合併 | 新增 merge queue 段：以 `gh api graphql` 查 `repository.mergeQueue(branch:)`，不是 null 才走 queue；走 queue 仍是同一個 `gh pr merge <PR>`（不帶策略、不帶 `--admin`），沒有啟用時行為不變 | gh 在要求 merge queue 的分支上會自動排隊，指令不變，#8 的權限模型（授權來自 permissions、bypass／auto 一律擋）原樣適用。偵測不用 `gh pr view --json`：gh 2.91 沒有 merge queue 欄位；rulesets 的 `rules/branches/<b>` 也可查，但 GraphQL 一個欄位直接回答。 |
| queue 的檢查會不會跑 | 基底 ref 上有 workflow 含 `merge_group`（`git grep`）就送；沒有、也沒有必要檢查（rulesets 與 branch protection 的聯集）也送；沒有卻有必要檢查就不送，列人工作業清單；任何查詢失敗都不送、列人工作業清單 | queue 只在 `merge_group` 事件上跑檢查，沒有觸發時 PR 會停在 queue 直到逾時。必要檢查可能來自第三方 CI，它回不回應 `merge_group` 從 repo 看不到，所以不猜。 |

guard（`hooks/permanent-exceptions.mjs`）：GraphQL `enqueuePullRequest` 與 MCP 的 `enqueue_?(pull_?request|pr)` 動作（不分大小寫，
涵蓋 camelCase）歸為 `merge-bypass`，一律擋 —— 它們把 PR 排進 queue 卻繞過 `gh pr merge` 的權限檢查；`enqueue_pipeline` 這類
無關動作不擋。`gh pr merge`／`gh pr merge --auto` 仍是 `merge`，交給權限設定；`--admin` 跳過 queue 原本就擋。`gh api` 以
`-F key=@file`、`--field key=@file`、`--input file` 從檔案帶 body 時，guard 讀進該檔（上限 1 MiB）一起比對；`-f`（raw field）
照字面送，不讀檔。`mergeQueue` 查詢與 `rules/branches/<b>` 讀取不受影響。測試在 `scripts/guard.test.mjs`。

已知缺口：`gh api --input -` 的 body 來自另一個指令的管線（不是 heredoc）時看不到；curl 的 `-d @file` 不讀檔。

偵測的實跑證據（2026-11-18，本 repo）：`mergeQueue(branch:"main")` 回 `null`、`rules/branches/main` 回 `[]`、
`branches/main` 的 `protection.required_status_checks.contexts` 回 `[]`、`git grep -l merge_group HEAD -- .github/workflows`
結束代碼 1 —— 未啟用 merge queue（它只開放給組織擁有的公開 repo 或 Enterprise Cloud 的組織私有 repo），本 repo 的收官
行為不變。

## #12：每次整併後 push 整合分支，全套交給 CI

| 規則 | 處置 | 理由 |
| --- | --- | --- |
| `get-to-work` 收輪「完整驗證只在收官做一次」 | 改為每次整併後 push 整合分支（新的步驟 6，兩種模式；GitHub 原本在完成交付裡的 push 移過來），CI 在背景跑全套，主持人不等 | 整合時壞掉的東西原本要到收官才發現，之後疊上去的票都得重做。CI 跑全套不花 agent 的 token。 |
| 收輪「整併」 | 指定 `git merge --no-ff`，一張票一個 merge commit；每次整併各 push 一次，不攢著推 | 紅燈要對得到是哪次整併：最早轉紅的 SHA 指向一張票，撤回時 `git revert -m 1` 有對象。 |
| 開輪（新增） | 派票前以 `gh run list --branch <b> --commit <sha> --json databaseId,workflowName,status,conclusion` 讀 `origin/<整合分支>` 的 CI，分六種：查詢失敗、沒有 run、紅、還在跑、被取消、綠，依序判斷 | 「還在跑」與「查詢失敗」不等不輪詢，照常開輪、下一次開輪再讀 —— 每個 run 跑全套，較新的 SHA 涵蓋較舊的。「被取消」不是失敗，`gh run rerun` 後當還在跑。只讀 GitHub Actions：log（`--log-failed`）與等待（`gh run watch`）都有現成指令；其他 CI 讀不到，退回本機跑，不猜。 |
| 開輪轉紅 | 該線不派新票；找最早轉紅的 SHA 對到票，交回原 agent 走集中修正與 `recheck`，兩輪修不好就 `git revert -m 1` 撤回該次整併、該票標卡住 | 不撤回的話整條線卡在紅燈上，後面的票都疊在壞的基礎上。撤回可逆，不屬永久例外。 |
| 「沒有 run」 | 這條線較早 push 過的 SHA 有過 run 時當還在跑；都沒有才記為「CI 不涵蓋整合分支」 | 剛 push 的 SHA 要幾秒才登記，一次空清單不代表不涵蓋。 |
| 第 2 節完整驗證「在整合分支上跑一次 repo 完整的自動檢查」 | 改為以整合分支最新 SHA 的 CI 為準，`gh run watch <id> --exit-status` 等結束；沒有 `origin`、CI 不涵蓋整合分支、或查詢失敗時才在本機跑一次，報告寫明原因與驗證的 SHA | 有 CI 的 repo 不再於本機重跑全套。收官沒有下一次開輪可等，所以這裡用一次阻塞呼叫，不輪詢。 |
| 證據失效規則「只要它碰到的檔案又被改動……仍然有效的只有線級完整驗證」與「重跑範圍依實際改動的影響面決定：預設只重跑受影響範圍的針對性檢查，只有新的修正、失敗，或未解的風險才再跑一次完整驗證」 | 改為「綠燈只對它跑過的 SHA 有效，有效的只有整合分支最新 SHA 的結果」；重跑範圍一段刪掉 | 每次 push 都在新 SHA 上跑全套，不必再判斷改動碰到哪些檔、該重跑多少。改動來源清單保留（含 #10 補的「併入基底」），加上「CI 紅燈的修正」。 |
| `ASKING.md` 第 7 節 ledger 第 4 欄 | 補「最近一次讀到的 CI 結果與它的 SHA」 | 恢復時要知道哪條線是紅的，不從記憶推。 |
| `IMPLEMENTER.md` 第 2 節「完整套件由主持人在收官跑一次」 | 改為「主持人整併後交給 CI 跑」 | 跟著收輪的新步驟 6。 |

獨立審查後的修正（同票第二個 commit）：

| 規則 | 處置 | 理由 |
| --- | --- | --- |
| 讀 CI 的指令與判法寫在開輪裡 | 搬到第 1 節新的「讀 CI」小節，開輪與收官都引用它 | 收官也要讀同一套判法，一份正本。 |
| `gh run list` 沒有 `--limit` | 單一 SHA 用 `--limit 100`、找最早紅 SHA 用 `--limit 200`，按 `headSha` 彙整 | 預設只回 20 筆，多 workflow 時會截掉。 |
| 「對到那次整併的票」沒有寫怎麼對 | `git log --merges --first-parent <前一個綠 SHA>..<最早的紅 SHA>`，以 ticket 分支名的 merge subject 認票；主持人的非 merge commit 夾在中間不影響；沒有 ticket merge（主持人 commit、精簡、併入基底）就是對不到票 | 完成紀錄、卡住紀錄、期間開票的 commit 會夾在兩次 push 之間。 |
| 撤回只寫 `git revert -m 1` | 一併撤掉完成紀錄：GitHub 開卡住 raw issue、從 `--done` 移到 `--stuck`；Local Markdown revert 完成紀錄 commit 再追加 blocker；`frontier.mjs` 把完成紀錄之後的 blocker 判為卡住（`scripts/frontier.test.mjs` 有測試）；對帳表改卡住、總 PR 列缺口 | 只撤 merge 時完成紀錄還在，frontier 判 done 優先於 blocker，被撤回的票仍算完成、下游照派。 |
| 撤回後的下游 | 依賴它而已整併的票改為缺口：merge 不撤、對帳表標「上游撤回」、移到 `--stuck`（Local 追加 blocker），總 PR 不寫 `Closes`；日後重新整併先 revert 撤回的 commit | 下游的程式建立在被撤回的改動上，不能當完成票關掉；不先 revert-of-revert，git 會把再次合併當成已併入。 |
| 收官紅燈「交回那段改動的原 agent」 | 改套紅燈處置：對到票走修正與撤回，對不到票由主持人或做那一步的 agent 修，兩輪上限；仍紅就整條線**驗證未過**，不送 `gh pr merge`、留給人合併 | 最後一輪之後沒有下一次開輪，原寫法沒有上限也沒有出口。 |
| 「較早 push 的 SHA 有過 run」沒有指令 | `gh run list --branch <b> --limit 1 --json databaseId`；空清單先當還在跑，連續兩次開輪都空且分支從來沒有 run 才定案為 CI 不涵蓋，定案沿用到收官 | 首次 push 讀到空清單不代表不涵蓋。 |
| 收官「對每個未完成的 run 執行 `gh run watch`」與「一次阻塞呼叫」 | 改為每個 run 各一次阻塞呼叫 | 原句自相矛盾。 |
| 改在本機跑的條件寫在多處 | 收官步驟 3 的**本機驗證**是唯一正本，收輪步驟 6 與完成判準引用它 | 條件只留一份。 |
| `ASKING.md` 第 9 欄「完整驗證次數」 | 寫明計法：收官每得出一個結論算一次，CI 或本機都算；收輪 push 觸發的 CI 不算 | 驗證改由 CI 跑後，原本的計數對象不清楚。 |

本 repo 的 CI（不是 skill 規則）：`.github/workflows/check.yml` 的 `push` 從只有 `main` 改為 `['**', '!claude/**']`。整合分支
`<run>/<line-slug>` 的 run 名稱不固定，窄的 pattern 會漏；`claude/**` 是開 PR 的 session 分支，`pull_request` 已涵蓋，排除它們避免
同一個 SHA 跑兩次（matrix 含 Windows，private repo 的 Actions 分鐘數要算）。總 PR 開出後，整合分支的 push 會同時觸發 `push` 與
`pull_request`，這幾次重複接受。

guard（`hooks/permanent-exceptions.mjs`）：受保護分支只有 `main`、`master` 與 remote 預設分支，`git push -u origin <run>/<line-slug>`
不受影響；`gh run list`／`view`／`watch`／`rerun` 與 `git revert -m 1` 也不擋。這幾條寫進 `scripts/guard.test.mjs` 的放行清單。

## #16：run 預算與無進展斷路器

| 規則 | 處置 | 理由 |
| --- | --- | --- |
| `ASKING.md` 第 7 節第 9 欄「計量」（只記錄、不據此停下，`<!-- pending #16 -->`） | 改為「計量與預算」：上限（一行一項 `budget: <名稱> <整數>`，預設 `spawns 200`、`rounds 30`、`hours 12`、`no-progress 3`）、用量、停止原因；標記刪除 | 整個 run 沒有任何上限，計量記了也不會讓 run 停下。 |
| `ASKING.md` 第 4 節裁決點（新增一條） | 上限只有使用者能調：裁決點前依票數估 spawn（每票約 15 個），超過預設就列為一題；中途不代答調高 | 代答調高等於沒有上限。 |
| `get-to-work` 第 1 節（新增「預算與斷路」） | 每次開輪先更新用量、判進展、判四個上限；「一次」是一次開輪，進展是任一線整合分支 tip SHA 或對帳表任一票狀態改變，ticket 分支上的 commit 不算；停下時不派票、未交付票標待裁決、照第 2 節收官 | 以喚醒計數會把等 agents 的喚醒誤判為無進展；沒整併的嘗試沒有改變交付。 |
| `get-to-work` loop 停止條件、收官輸出，`have-it-all-done` 交棒的計量項 | 加上「預算與斷路停下」與停止原因 | 停下要交棒並寫出卡在哪裡。 |

新增：

- `hooks/budget.mjs`（邏輯）與 `hooks/spawns.mjs`（入口）：SubagentStart 依 `agent_id` 去重計數（resume 也會觸發，
  它擋不了 spawn）；PreToolUse 比對 `Agent`，計數達到 `budget: spawns` 就 deny。只在有進行中的 run 時生效。
- 計數檔 `<run>.counters.json`（ledger 旁），只由 hook 寫：O_EXCL lock 檔加暫存檔 rename，不與主持人寫 ledger 競態；
  讀取遇 Windows 暫時鎖檔重試，仍鎖住就放行並警告，內容損壞才 fail closed。
- 使用者 opt-out `SORRY_MATT_BUDGET=off`，與 guard 的 `SORRY_MATT_GUARD` 分開；誤傷範圍寫在 README「Run budget」。
- README 的 headless 硬上限：`claude -p --max-turns --max-budget-usd`。
- 測試 `scripts/budget.test.mjs`，CI 一起跑。PreToolUse deny 對 `Agent` 已在 Claude Code 2.1.325 以
  `scripts/spawn-deny.live.mjs` 實跑驗證：用量達上限後，前景與背景的 Agent 呼叫都被 deny，沒有觸發 SubagentStart。
  這支腳本花 API 額度、不進 CI；Claude Code 升級後手動重跑。

## #17：同一條線上可開工的票平行做（逐票流水線）

| 規則 | 處置 | 理由 |
| --- | --- | --- |
| `get-to-work` 開輪「同線或修改同一批檔案的互斥 tickets 必須分輪」 | 刪掉。互斥只看**預計檔案**是否重疊，由新的 `scripts/overlap.mjs` 判：在途的票佔住預計檔案與它 worktree 已經動到的檔，候選票照 frontier 順序貪婪挑出不重疊的，`start` 全部派出 | 一份 spec 切出來的票通常連成一條線，「同線分輪」等於整份 spec 每輪一張。重疊是可比對的集合運算，交給腳本，不讓主持人推（同 #11 的理由）。 |
| 跨線的檔案重疊 | 照判（主持人在獨立審查時裁定）：`overlap.mjs` 的計畫改為每個 repo 一份、涵蓋所有線，在途的票各帶所屬線的整合分支當 `base`；跨線重疊的候選延後派出 | 原規則「同線或修改同一批檔案的互斥 tickets 必須分輪」本來就涵蓋跨線；兩條線同時改同一個檔，兩支總 PR 之間會衝突。延後只讓同一處的改動不並行：跨線的票整併進自己的整合分支後就不再佔檔，總 PR 之間仍有的衝突照舊由收官的併入基底與人合併處理。 |
| 第 1 節「用 `/loop` 推進輪次」、「開輪」「收輪」 | 改為「推進流水線」、**派票**與**收票**；每次喚醒依序：讀紅線的 CI → 處理回報 → 整併佇列 → 派票點 → 寫 ledger | 收輪要等同輪所有 agent 回報，快的票等慢的。改成一張票回報就收票，整併後馬上補派。 |
| 收輪「同輪所有 agents 回報後」 | 改為「實作 agent 回報後，不等同線或其他票」 | 同上。 |
| 整併（新增**整併佇列**） | 一條線一次整併一張，照進佇列順序；整併後做一個派票點（收票步驟 8 補派） | 整併 agent 解衝突、完成紀錄、push 都對同一個整合 worktree，平行做會互踩；每次整併一次 push 才能讓紅燈對到票（#12）。 |
| **預計檔案**（新增） | 主持人派票前在整合 worktree 預測，存 `sorry-matt/runs/<run>/files/<ticket>.txt`；來源：票面／展開區塊／驗收點名的路徑，點名的模組與識別字以 `git grep -l`、`git ls-files` 找到的檔，repo 規則檔要求連動的檔；推不出就寫 `/` | 不叫實作 agent 開工前回報：subagent 沒有中途回報的管道，要多一次 spawn 與往返，它沒讀 code 前的猜測也不比主持人準。寧寬勿窄：寫寬少一點並行，寫窄才會退回重做。`take-this` 規定票面不寫路徑，所以來源不能只靠票面。 |
| conflict 無法安全解決 → 卡住 | 改為第一次**退回重做**：`git merge --abort`，舊嘗試留在 `refs/sorry-matt/<run>/<NN>-<slug>/sent-back-<k>`，接續紀錄寫退回紀錄（ref、SHA、衝突檔、當時整合分支 SHA、預測沒涵蓋的檔），對帳表退回次數加一，預計檔案加寬，刪 worktree 與分支，下個派票點從最新尖端重派（原 agent 還在就 SendMessage，否則新 spawn 並填 `IMPLEMENTER.md` 新的退回紀錄佔位）；同票第二次仍解不了才卡住 | 預測錯不是票做錯，硬解兩個沒看過彼此的改動風險高；在最新整合分支上重做，衝突在實作 agent 自己的分支裡解。用 ref 而不是保留分支：`clean-it-up` 不會碰到它，收官「ticket 分支都已移除」照樣成立，`git branch -D` 也不丟資料。只退一次，避免來回。 |
| 紅燈處置「在綠燈或撤回之前不派新票」 | 補：整併佇列也暫停；在途的票照常實作、審查、修正，通過的在佇列等；紅燈修正與撤回不排隊；有線在紅燈處置中時每次喚醒都讀那條線的 CI；轉綠觸發派票點；對不到票而驗證未過的線，佇列不再為它暫停 | 流水線下「不派新票」不夠：紅線上再整併別的票，之後的 SHA 都帶著同一個紅，新票的紅被蓋住，修完仍紅時會錯對到原票。在途的工作不浪費，只是晚點整併。佇列暫停時沒有整併可以觸發派票點，所以紅燈期間每次喚醒都讀 CI。 |
| 預算與斷路「一次是一次開輪」 | 改為「一次是一個**派票點**」：第一次喚醒、整併或撤回、有票離開流水線（卡住、待裁決、退回）、紅線轉綠或判為驗證未過、展開 agent 回報時觸發，一次喚醒至多一個；`budget: rounds` 改計派票點次數，名稱沿用 | 以每次喚醒計，平行的票各自回報會在沒有任何問題時連續觸發斷路；以每張票的派出計，開局同時派三張就算兩次無進展。派票點幾乎都跟在整併之後，連續沒有進展的派票點正是「一直重派卻沒交付」的訊號。名稱沿用免得既有 ledger 與 hook 的 `budget:` 行失效。 |
| 進展的判法「對帳表每張票的狀態」 | 改為「已到終局（已交付、卡住、待裁決）的票」；實作中、審查中、修正中、待整併之間移動與退回不算 | 對帳表現在記階段；階段來回不是交付，算進去斷路器永遠不會跳。 |
| 停下「這次不派票，也不讀 CI」 | 改為停下後不再派票與展開；在途的票照常收票到整併、卡住或退回，讀 CI 照常；退回的票與沒派過的標待裁決；在途收完才收官 | 流水線下停下時常有票做到一半，丟掉已實作完的票不划算；它們的 spawn 多半已經發生。 |
| `ASKING.md` 第 7 節第 8 欄 | 對帳表加「階段」（候選、展開中、實作中、審查中、修正中、待整併、整併中、終局）「負責 agent 的 id」「退回次數」 | 沒有輪的邊界，恢復時要從 ledger 知道每張沒到終局的票走到哪、該 SendMessage 給誰（#9）。 |
| 展開 agent（#7）在流水線下 | 背景跑；送去展開的票階段改為展開中，不再是候選；展開 agent 回報觸發派票點，票回到候選重跑 `acceptance.mjs` | 審查發現：展開期間票仍算候選，下一個派票點會重複 spawn 展開；回報也不是派票點觸發，展開完的票可能沒人接。 |
| 線**驗證未過**之後 | 該線不再派票，候選與沒派過的票標待裁決（原因「線驗證未過」）；這件事觸發派票點；停止條件補「剩下的候選都在不可派的線上」 | 審查發現：紅線「綠燈或撤回前不派新票」在驗證未過時永遠成立，又沒有派票點觸發，在途的票收完後 hours／no-progress 不再判、停止條件要求沒有候選 —— loop 空轉。 |
| 撤回時依賴它的在途票 | 退出流水線標待裁決（原因「上游撤回」），分支尖端留在 `refs/sorry-matt/<run>/<NN>-<slug>/upstream-reverted`，agent 回報後不收票 | 審查發現：原本只處理已整併的下游；在途的票建立在被撤回的改動上，整併下去會把撤回的東西又帶回來。 |
| `budget: rounds` 預設 30 | 改 40 | 一次改計派票點後，派票點大致是「每次整併一個」加上退回、卡住、紅轉綠這些事件，不再是一輪涵蓋所有線；多線並行時同樣的票數用掉更多次。預設 `spawns 200` 照每票約 15 個 spawn 估，約可跑 13 張票；每張票至多帶出三個派票點（自己的整併、一次退回、一次卡住／撤回／紅轉綠），13 × 3 ＋ 第一個 ＝ 40。超過這個數時 spawn 上限本來就會先停。 |
| `ASKING.md` 第 9 欄 | 「開輪次數」改「派票點次數」，用量加「退回重做次數」；更新時機改「每個派票點的第一件事，與每張票收票結束」；ledger 的寫入時機改「每次喚醒結束」 | 跟著新的「一次」。 |
| `get-to-work` 收官、`have-it-all-done` 交棒 | 對帳表含退回次數與退回紀錄位置；總 PR 為退回過的票註明退回次數；「本輪計量與預算」改「本 run 的計量與預算」 | 交棒報告欄位跟著新的 ledger 欄位。 |
| `EXPANDER.md` 的「輪次」 | 改為派票點次數，寫進展開區塊既有的 `round` key | `acceptance.mjs` 已解析 `round`，不改格式。 |
| `IMPLEMENTER.md`、`EXPANDER.md`、`take-this`、`have-it-all-done`、`ask-miles`、`prove-it` 的「開輪／收輪」 | 改「派票／收票」；`IMPLEMENTER.md` 加退回紀錄佔位與第 1 節第 4 點（重做建立在現況上，不合併舊 ref） | 一致的用詞。 |
| `hooks/budget.mjs` 的 deny 訊息「Stop opening rounds」 | 改「Dispatch no more tickets」 | 同上；README「Run budget」的「every open-round」改「every dispatch point」。 |

新增：`get-to-work/scripts/overlap.mjs`（零依賴，src/dist 逐位元組相同，輸出 `sorry-matt/overlap@1`）與
`scripts/overlap.test.mjs`（同線不重疊的候選同時開工、在途預測與實際改動佔檔、跨線在途的票各以自己的線為 base 佔檔、候選依序互佔、`/` 與路徑正規化、
壞計畫、在途 worktree 以 merge-base 計實際改動而不算基底之後的改動），CI 一起跑。實際改動以 merge-base 為準：整合
分支在票開工後前進，直接 `git diff <base>` 會把別張票的改動算到這張票頭上。

## #18：總 PR 可以逐票審

| 規則 | 處置 | 理由 |
| --- | --- | --- |
| 收票整併「`git merge --no-ff <ticket 分支>`，一張票一個 merge commit」 | 加 `--no-edit`，message 固定用 git 預設的 `Merge branch '<ticket 分支>'`；寫明票的 commit 就是 `<merge>^1..<merge>^2` | 紅燈對票本來就靠這個 subject；逐票導覽也靠它認票。整併後 ticket 分支已刪，只剩 merge message 記得是哪張票。 |
| 整併的衝突解法（沒規定落在哪） | 只留在該次 merge commit 裡，`git commit --no-edit` 收尾、不改寫 ticket 分支；解完還要改就另做 commit，subject 不帶票 ID | 票的 commit 範圍因此不含別人的改動；`git show --remerge-diff <merge>` 只顯示解法。subject 不帶 `#N`，收官彙整摘要的 `--grep` 才不會把它算成票的 commit。 |
| 整併的 merge 怎麼對回票（審查追加） | 整併後把 merge SHA（`git rev-parse HEAD`，含 `-ci` merge）記進 ledger 對帳表（`ASKING.md` 第 7 節第 8 欄加欄）；逐票導覽與紅燈對票都以 SHA 為準，沒記 SHA 才退回認 subject：先 `Merge branch '<分支>'`，再 `Merge <票 ID>` 與 `(+<票 ID>)` 別名 | 只認 git 預設 message 時，本 run（#4 線）的 13 個 merge 全是主持人手寫的 `Merge #N: ...`、`Merge #5 (+#6): ...`、`Merge #11 fix: ...`，#5–#17 全部對不到票。SHA 不受 message 寫法影響；subject 退路讓沒記 SHA 的舊 ledger 也能用。修正後對本線實跑（不給 SHA）#5–#17 全部對到、沒有線級 commit 被誤收。 |
| 收官精簡「直接套用修法」 | 套用的修法收成一個獨立 commit（不帶票 ID，沒有修法不 commit），不 amend 進任何 merge 或票的 commit | 精簡跨票，混進任何一張票都會讓那張票的範圍看起來改了不屬於它的東西。 |
| 收官併入基底 | 帶 `--no-edit`；衝突解法同樣只留在這個 merge commit | 同上。 |
| 紅燈對不到票時主持人的修正 commit | subject 不帶票 ID | 同上，避免被算進某張票的摘要。 |
| 總 PR body「每張完成票一節：摘要與 `Closes #N`」 | 改為以新的 `scripts/review-guide.mjs` 輸出寫：開頭的審查門檻提醒（`size.over`）→ 逐票導覽（依阻擋邊拓撲序；每節有 compare 連結、commit 數與增刪、摘要、接續紀錄連結、衝突解法的 `remergeDiff` 指令、退回次數、`Closes #N`）→ 線級 commit → 缺口；潤稿後門檻提醒與連結也要在 | 取消票級 PR（#13）之後，總 PR 是唯一的審查單位，一條線很容易超過一千行。哪段 commit 屬於哪張票、依什麼順序讀、diff 多大，都是可以從 git 算出來的，交給腳本，不讓主持人推（同 #11 的理由）。 |
| 審查門檻（新增） | 預設 400 行，算法是 `git diff --shortstat <基底>...<線整合分支>` 的增刪合計（從 merge base 算，等同 GitHub PR 的 diff；二進位檔不計行），超過才提醒 | SmartBear：一次審 200–400 行可找到 70–90% 的缺陷；Google eng-practices：1000 行通常太大。 |

新增：`get-to-work/scripts/review-guide.mjs`（零依賴，需 git 2.38+，src/dist 逐位元組相同，輸出 `sorry-matt/review-guide@1`）與
`scripts/review-guide.test.mjs`（以真的 git repo 照 get-to-work 的方式建一條線：`--no-ff` 整併、`-ci` 紅燈修正分支、在 merge 裡解的衝突、
精簡 commit、併入基底；驗票與 merge 的對應、commit 範圍與連結、線級 commit 的分類、衝突解法的偵測、門檻邊界、閱讀順序與環、
找不到 merge 的結束代碼 3、壞計畫），CI 一起跑。

`--remerge-diff` 只能在本機看（git 2.36 以上），GitHub 網頁看不到，導覽照實寫明。

衝突解法放在 merge commit 而不是另一個一般 commit：要把解法拆成獨立的一般 commit，得先 commit 帶衝突標記的樹或改寫 ticket 分支，
前者讓中間的 SHA 壞掉、後者讓票的範圍混進解法。merge commit 本身不屬於票的範圍，`--remerge-diff` 又能只看解法，腳本也標出哪些
merge 帶解法（`resolved`，比對 merge commit 的樹與 `git merge-tree --write-tree` 的自動合併結果）。

## 移除「安裝新套件」永久例外

| 規則 | 處置 | 理由 |
| --- | --- | --- |
| 永久例外「安裝新套件」（含在 manifest 加相依、用 `npx`、`pnpm dlx`、`uvx` 下載執行套件，以及「照 lockfile 還原一律用凍結寫法」） | 刪除；`have-it-all-done/ASKING.md` 第 5 節與 `get-to-work/IMPLEMENTER.md` 的清單只剩 clone；`prove-it` 仍不加相依，理由改為審查不改這張票的 diff 與 repo 相依 | 使用者 2026-11-19 指示移除。 |
| guard 對套件管理器安裝的攔截（`hooks/permanent-exceptions.mjs`） | 刪除 npm、pnpm、yarn、bun、npx、bunx、uvx、pip、uv、pipx、cargo、gem、go、poetry、pdm、bundle、系統套件管理器、composer、dotnet 與 PowerShell `Install-*` 的安裝規則；各工具的 publish/push → `production` 保留；類別 `install-or-clone` 改名 `clone-or-extension`（clone、編輯器/agent 擴充安裝、fetch-and-run） | 同上。 |

## guard 從「永久例外一律擋下」改為「該問的才問」

使用者 2026-11-19 指示：平常的工作全權交給 agent；發布版本與部署正式環境，使用者看過後也交給 agent 執行。guard
只在該問的地方跳確認，其餘交給 Claude Code 自己的權限設定。

| 規則 | 處置 | 理由 |
| --- | --- | --- |
| `ASKING.md` 第 5 節「永久例外：任何指示都不能授權，一律進人工作業清單」 | 改為「需要確認的動作」：兩段確認類（災難級、對外發訊、金流）與確認一次類（發布與正式部署、寫入 Claude 設定、會立即觸發正式部署的合併）；agent 可以執行，但只在使用者於權限提示確認後；subagent 不執行、回報主持人；主持人當確認呼叫排到最後連續送出 | 使用者要把發布與部署也交給 agent，人只在提示上點頭；擋死的清單逼使用者自己去終端機打指令，與工作流程相反。 |
| 永久例外的 force-push（一般分支）、clone 與擴充安裝、fetch-and-run、憑證與機密、改權限、非災難級刪除（`git reset --hard`、`git clean`、`stash drop`、`filter-repo`、release／issue 刪除） | 刪除，guard 不回 verdict | 可逆或範圍限於本機與專案；放不放行交給 Claude Code 權限設定，guard 不重複判斷。 |
| 災難級刪除（家目錄、根目錄、磁碟根、上層與專案外路徑的遞迴刪除，`format`、`mkfs`、`dd of=/dev/…`、`diskpart`、`dropdb`、SQL `DROP`／`TRUNCATE`、`FLUSHALL`、`dropDatabase()`、刪 repo、force-push 或刪除受保護分支）、對外發訊、金流 | 兩段確認：第一段把指令換成 `hooks/confirm.mjs <token>` 並詢問，允許後記錄核准；原樣重送時第二段再問，允許才執行；核准單次使用、10 分鐘有效，以 session、工具與正規化輸入綁定；狀態檔讀寫失敗不放行；`bypassPermissions` 一律擋下；MCP 第一段擋下並附確認指令 | 一次點錯就無法復原的動作，多一次停頓的成本遠低於後果；提示內文寫出這次的具體對象與後果，讓第二次確認不是反射動作。`bypassPermissions` 沒有保證 ask 會跳提示。 |
| `bypassPermissions`／`auto` 模式下 `gh pr merge` 一律擋下；繞過 `gh pr merge` 的合併一律擋下 | 刪除；改為只在合併會立即觸發正式部署時確認一次（`hooks/deploy-on-merge.mjs`：先看 `SORRY_MATT_MERGE_DEPLOYS` 或 `.claude/sorry-matt.json` 的 `mergeDeploysProduction`，否則讀 `origin/<base>` 的 workflow 判斷；release-please、changesets 或 tag 控制的發布不算；查不到就問） | 合併本身可逆；會讓人在意的是合併立刻上線。auto 模式下 PreToolUse 的 ask 會送到權限提示，classifier 不代決。 |
| `get-to-work` 收官「CI 綠就送 `gh pr merge`」 | 改為有常設授權（`permissions.allow` 涵蓋 `gh pr merge`）或使用者本 run 指示時才送，否則留給人合併 | 刪掉 auto 模式的擋下後，沒有這個條件時 auto 模式的合併會由 classifier 決定。 |
| 寫入 Claude Code 設定（原歸在「改權限」，擋下） | 確認一次 | 使用者可能請 agent 改設定；仍要讓人看過。 |
| 發布與正式部署（原 `production`，擋下） | 確認一次；補 `gh release create` | 使用者看過後交給 agent 執行。 |

程式：`hooks/permanent-exceptions.mjs` 改名 `hooks/classify.mjs`，每個 verdict 帶等級（`double`、`ask`、`merge`）；新增
`hooks/confirm.mjs`、`hooks/confirm-state.mjs`、`hooks/deploy-on-merge.mjs`；`hooks/hooks.json` 的 PreToolUse matcher
拿掉 `Read` 與 `Grep`（不再檢查讀取機密）。測試：`scripts/guard.test.mjs` 改寫，新增 `scripts/deploy-on-merge.test.mjs`，
CI 一起跑。`SORRY_MATT_GUARD=off` 全關開關保留；budget 與 reread hook 不動。

獨立審查後補強：

- 第一段確認只能由 guard 給的那一行完成：其他提到 `confirm.mjs`、`confirm-state` 或 `sorry-matt-guard` 的指令（串接、改寫、
  換路徑、直譯器一行式、重導）與寫入狀態目錄的檔案工具一律擋下；只讀或 git 操作不算。
- 文件不再宣稱「保證先問」：guard 是指令文字比對，不是安全邊界；模式與其他 hook 可能讓提示不出現或變成拒絕。
- 確認一次類補上 `~/.claude.json`、`.claude/hooks/`、`.mcp.json`、`.claude/sorry-matt.json`，以及 `npx`／`bunx`／`pnpm dlx` 包一層的
  部署、`pnpm -r publish` 等、預設就是正式環境的 `fly`／`wrangler`／`firebase deploy`；兩段確認類補上 `terraform`／`pulumi destroy`、
  刪雲端專案與資源群組、刪 prod 的 namespace、bucket、stack、MCP 刪 repo 與 `git send-email`。
- 不再問：`--dry-run`、明確指向非正式環境的部署、`ssh prod <唯讀指令>`、送往訊息服務的純 GET。
- merge 偵測讀合併後的 workflow（PR head，取不到就 base 並註明；push 讀要推的 ref），合併 release-please／changesets 自己的
  release PR 時視為立即發布，認得更多部署訊號，名稱像部署但認不出確切動作時當作無法判斷而詢問。

## #40：subagent 限時，超時由主持人判斷

spawn 上限（#16）只管總數，單一 agent 卡住時它沒有作用：#4 的 run 裡，#11 的 Windows 修正 agent 跑了近一小時，worktree
沒有任何改動，最後由主持人手動 `TaskStop` 再改派。Claude Code 沒有給 subagent 設時限的原生機制，所以由主持人在喚醒時掃描。

| 規則 | 處置 | 理由 |
| --- | --- | --- |
| `get-to-work` 第 1 節「有 agent 在跑時使用較長 fallback 等候通知」 | 改為新節「時限」：派送（spawn，或以 SendMessage 交回原 agent）時在對帳表留**派送紀錄** —— agent id、派送時間、階段時限、到期時間（UTC，`date -u +%Y-%m-%dT%H:%M:%SZ` 格式）與**進度指紋**；每次喚醒在處理回報之後掃描，超時的有進展就延長一次，沒有進展或已延長過就 `TaskStop`，再依情況處置；處置寫進接續紀錄與自答清單 | 「較長 fallback」沒有數字，也沒有醒來之後要做什麼。到期時間記成同格式的 UTC 字串，比大小是字串比較，主持人不用做時間運算；記在 ledger，壓縮或恢復後照樣掃得到。 |
| **在途 agent** 的定義 | 對帳表裡到期時間不是 `—` 的 agent，含展開 agent 與紅燈修正的 agent；掃描與 fallback 喚醒都以它為準 | 審查發現：票的「在途」是實作中到整併中，不含展開中；紅燈修正時票已整併。照票的階段掃會漏掉這兩種 agent。 |
| 喚醒步驟 | 加第 3 步「時限掃描」（處理回報之後、整併佇列之前）與第 7 步「排 fallback 喚醒」；第 2 步只收 agent id 與對帳表一致的回報，已停下或被改派取代的舊 agent 回報不收、記進接續紀錄 | 先收已回報的，才不會把剛好做完的 agent 當成超時停掉。`TaskStop` 與 agent 自己結束有競態，舊 agent 的回報若照收，會跟改派的新 agent 收同一張票兩次。 |
| 有進展的判定 | HEAD 加上工作樹的 tree：在一份暫存 index（`GIT_INDEX_FILE`，從真的 index 複製）裡 `git add -A` 再 `git write-tree`；一律以 Bash 執行；展開 agent 比 `acceptance.mjs` 的 `expansions` 數 | 初版的 `{ git status --porcelain; git diff; } \| git hash-object` 漏掉三種改動（審查發現）：未追蹤檔改內容、新檔放進已經未追蹤的目錄（porcelain 只列目錄）、已暫存的檔再改再 add（`git diff` 只比工作樹與 index）。write-tree 涵蓋整個工作樹的內容，真的 index 不動。PowerShell 的管線會改編碼與換行，同一棵樹在兩種 shell 算出不同的值。 |
| 延長次數 | 一次派送只延長一次，延長後再超時不再判進展 | 一直在改卻一直沒做完，跟沒進展一樣需要人或新的 agent 看；不限次數等於沒有時限。 |
| 停下後的去向 | 先符合的為準：要人裁 → 待裁決；整併中 → 有 `MERGE_HEAD` 就 `merge --abort`，沒有就 `reset --hard <派送紀錄的 HEAD>`，再退回重做；紅燈修正 → 算一輪修正失敗；其餘每個階段改派一次，同一階段第二次超時，實作／修正標卡住、展開標待裁決 | 整併 agent 卡住就是衝突解不安全，退回重做本來就是那條路（它自己只退一次）；它若已 `git commit --no-edit` 才超時，沒有 `MERGE_HEAD`，`merge --abort` 會失敗（審查發現），而整併 agent 不 push，所以 reset 只動本機。改派沿用 worktree：延長過才停的 agent 可能已有 commit，由新 agent 判斷要不要沿用。改派次數按階段分開計：實作時改派過的票，修正時第一次超時不該直接卡住。 |
| 紅燈修正超時 | 算紅燈處置第 4 點的一輪修正失敗，不計改派；第一輪 → 開第二輪（對到票 spawn 新 agent，對不到票先 reset 整合 worktree）；第二輪 → 照第 5、6 點撤回或判驗證未過 | 審查發現：初版照一般階段「第二次超時標卡住」，但紅燈的票已整併，標卡住不撤回，線一直紅、佇列一直暫停，又沒有事件觸發派票點 —— 死結。撤回與驗證未過都會觸發派票點。 |
| 不設時限的階段 | 審查中（`prove-it`）不設；`prove-it` 第 2 節寫明 finder、verifier 與 Fix Verifier 一律前景派送 | 它們在主持人自己的回合裡跑完才回來，主持人等的期間不會被喚醒，掃描做不到。把前景寫成 `prove-it` 的規則，免得哪天改成背景派送時，審查悄悄沒有時限。要給審查設時限，得先把它們改成背景派送，不在本票範圍。 |
| fallback 喚醒 | 每次喚醒結束時還有在途 agent，就以最早到期時間排下一次：`ScheduleWakeup`（`/loop` 動態模式，60–3600 秒，超過 3600 就分段排）；不能用時背景 `sleep <秒>`，task id 記進第 9 欄，排新的前先 `TaskStop` 舊的，醒來第一件事照恢復重讀 ledger；也不能用時以 interval 模式重進 `/loop`，間隔取最短的階段時限，沒有在途 agent 且 run 已停止時結束 | 所有 agent 都不回報時，只靠 agent 通知的主持人永遠不會醒來，時限就沒人判。排在每次喚醒的結尾而不是派送當下：派送過的喚醒結尾一定有在途 agent，而沒有派送、仍有在途 agent 的喚醒也要排，否則延長後就沒有下一次喚醒。背景 `sleep` 不停掉舊的會越疊越多，每個都會把主持人叫醒一次。 |
| `ASKING.md` 第 7 節第 8 欄 | 對帳表加派送紀錄（派送時間、階段時限、到期時間、是否已延長、進度指紋）與各階段的超時改派次數 | 恢復後要能接著掃描；各階段的改派次數決定第二次超時是卡住。 |
| `ASKING.md` 第 7 節第 9 欄 | 加「階段時限」：`budget: timeout-implement 30`、`timeout-fix 20`、`timeout-expand 15`、`timeout-merge 15`（分鐘）；用量加超時延長次數、超時停止次數與背景 `sleep` 的 task id；完成判準改為四行上限加四行時限 | 沿用 `budget: <名稱> <整數>`，hook 的解析不用改（`parseBudget` 已收任意小寫名稱；新增測試釘住）；hook 只依 `spawns` 擋 spawn。預設取自票上的例子；整併 agent 只解衝突，展開 agent 只讀票寫驗收，各 15 分。 |
| `ASKING.md` 第 4 節「裁決點前估算 spawn 數，超過預設時列為一題」 | 改為 `budget: spawns` 與 `budget: rounds` 依票數計，裁決點前（獨立執行時在凍結票集時，`get-to-work` 第 0 節新增步驟 5）改寫；完成判準補「已改寫」；上限與時限預設不列題，有具體理由預期不夠時才列；中途不夠時不代答調高，時限照「時限」延長一次或停下 | 見下方兩段。 |

**spawn 上限的重新評估。** 原本的 `spawns 200` 是固定值，要同時防單一 agent 卡住與整個 run 失控。有了時限，單一 agent
卡住由時限在一個階段時限（加一次延長）內處理；spawn 上限只剩下「整個 run 一直 spawn 卻做不完」這個最後保險。固定值對
兩張票的 run 太寬、對三十張票的 run 太窄，所以改依票數算：每張票典型約 15 個 spawn（實作、展開、`prove-it` 的 finder 與
verifier、整併），取兩倍作為保險，涵蓋退回重做與超時改派；常數 50 涵蓋規劃階段（`grill-them`、開局 agent）與收官。13 張
票得 440，3 張票得 140。規劃若已用掉超過 50 個，改寫時取 max(`30 × 票數 + 50`, 已用 + `30 × 票數`)，每張票的 30 個份額
不被規劃吃掉（審查追加）。建立 ledger 時仍寫 `budget: spawns 200`，涵蓋票數未定前的規劃。格式不變，所以
`hooks/budget.mjs` 不改邏輯，只更新檔頭註解；README「Run budget」改寫預設值的說明。

**rounds 一併改依票數。** `budget: rounds 40` 的理由（#17）是「`spawns 200` 約可跑 13 張票，每張票至多三個派票點，13 × 3 ＋ 1」；
spawns 改依票數後這個前提不成立，超過 13 張票的 run 會先停在 `rounds`（審查發現）。所以改成同一個推導的一般式
`3 × 票數 + 1`，寫定時機與 spawns 相同；建立時仍寫 40。超時處置只會帶出卡住、待裁決或退回重做這幾種本來就算在三個裡的
派票點，不另加。`rounds` 由主持人判，hook 不讀，解析不受影響。

時限判定不做腳本：比大小是字串比較，進展是兩段 git 指令，寫成指令比多一支腳本與測試簡單。

## guard 的無人值守模式

使用者 2026-11-19 回報：agent 半夜停在 guard 的確認框上，一路等到早上。PreToolUse 的 ask 沒有逾時，人不在就一直卡。

| 規則 | 處置 | 理由 |
| --- | --- | --- |
| 需要確認的動作一律跳確認提示 | 新增無人值守模式：`~/.claude/sorry-matt-unattended` 存在，或 `SORRY_MATT_UNATTENDED=on` 時，每個 ask 改成 deny，訊息要 agent 記進人工作業清單後繼續做其他事；兩段確認在記錄任何確認之前就擋下 | 只會讓 guard 更嚴，誰建立開關檔都不放寬任何東西；開關檔每次呼叫都讀，已經在跑的 session 也立即生效。 |
| 同一行先設的變數（`R=o/r; gh pr merge 1 --repo $R`）照字面比對 | 解析時展開：只展開前面設過、只設過一個值、值本身不是展開式的變數 | 字面 `$R` 對不上 origin，判成「無法判斷」而跳框；展開只會讓判斷更準。 |
| PR 不屬於這個 clone 的 origin 就判「無法判斷」 | 改用 `gh api graphql` 從 GitHub 讀 PR head（取不到就 base）的 workflow；這個 clone 的 `.claude/sorry-matt.json` 不再套用到別的 repo | 跨 repo 合併是常態，不該每次都問；本機設定只描述本機 repo。 |

## guard 不為普通指令跳框

使用者 2026-11-19 指示：普通指令不要跳框，否則按 allow 會變成反射動作，真正該看的那次也一起按掉。依近三天的 transcript，
實際跳過的框除了上一節的兩種合併誤判，還有 agent 清自己的 scratchpad worktree（`cmd /c "rd /s /q \?\$p"`）被當成災難級刪除。

| 規則 | 處置 | 理由 |
| --- | --- | --- |
| `cmd /c` 的內容用 bash 規則解析 | 改用 cmd 規則：`^` 跳脫、反斜線照字面、`'` 與 `#` 不是特殊字元；刪除目標去掉 `\?\` 長路徑前綴 | 反斜線被吃掉後，暫存目錄變成 `/?…` 而誤判，`D:\other` 反而變成相對路徑 `D:other` 而漏判。 |
| 引數裡出現 Claude 設定檔路徑、指令不在讀取清單就問 | 讀取清單補上只印、只測、只開啟或只 commit 的指令（`echo`、`Test-Path`、`Get-ChildItem`、雜湊、`code`、`git commit` 等）；`cp`／`Copy-Item` 只看目的地 | 這些都不寫入設定檔；寫入（重導、`sed -i`、`git checkout --`、複製到設定檔）照問。 |

## #59：純文字票的審查成本

run `2026-11-19-backlog-sweep` 的三張純文字票（#16、#49、#50），每張審查約 20 個 agent、10–15 分鐘，擋住整併的 finding
合計只有一則；突變三張都是空的；多數候選到 verifier 才被判成 spec 指定的措辭或 fixed point 就有，而 finder 報告裡常已寫出
這個懷疑。

| 規則 | 處置 | 理由 |
| --- | --- | --- |
| `prove-it` 第 2 節「單一檔案、數十行以內 → 一個 finder」 | 加一種：只動 Markdown 或其他文件、沒有可執行程式碼的 diff 也只派一個 finder | 純文字 diff 沒有呼叫端、被刪除的程式行為可追，五個 lens 分開派只是五次重讀同一份文字。 |
| `prove-it` 第 2 節 finder 回報格式 | 加 `suspected`：`spec`（附被指定的原文）、`pre-existing`（附 fixed point 位置）或 `none` | finder 已經寫在報告裡的懷疑，原本因「省略 finder 的推理」傳不到 verifier。 |
| `prove-it` 第 4 節「每個候選各一個 verifier」 | 依「檔案＋失效機制」分組，同組交給同一個 verifier，仍逐條裁決、各附 `file:line` 證據；標了 `suspected` 的走簡化流程：先查 fixed point 與 spec，成立就直接裁決 pre-existing 或新增的 spec 層級（記成觀察，標 `(spec-level)`），不成立再走一般流程 | 同機制的候選要查的是同幾行，分開派是重複讀；簡化流程不成立就退回一般流程，不會讓真的缺陷少走反駁與三關。 |
| `prove-it` 第 3 節突變 | 沒有可執行的行時跳過，不跑 `mutate.mjs lines`，紀錄寫 `skipped: no executable lines`；第 6 節補 `skipped` 的寫法，實跑紅燈也用它（`skipped: red baseline`） | 三張票都跑完才得到「無可突變行」，各自用自由文字記。 |

## #75：spawn 依 agent 類型分段計量

`ASKING.md` 第 4 節的「每張票典型約 15 個 spawn」沒有數字可依：counters 檔只有總數與 agent id。這張票只加紀錄與彙總，
不改 `budget: spawns` 的公式。

| 規則 | 處置 | 理由 |
| --- | --- | --- |
| `<run>.counters.json` 只有 `spawns`、`agents`、`updated` | 加 `log`（每個計入的 spawn 一筆：`id`、`type`、`description`、`at`）與 `pending`（已放行、還沒配到 SubagentStart 的 Agent 呼叫）；缺席都當空陣列 | 舊檔照樣讀；擋 spawn 仍只看 `spawns` 與 `agents`。 |
| （新增）類型與 description 的來源 | 類型取 SubagentStart 的 `agent_type`；description 取 PreToolUse(Agent) 的 `tool_input.description`，以「同類型、先到先配」配對，待配對超過 10 分鐘丟掉 | 兩個事件沒有共同 id。配錯只影響彙總的角色與票，不影響計數與擋 spawn；PreToolUse 上的記錄失敗只進 warnings，不改放行或擋下。 |
| （新增）`get-to-work`、`prove-it` 每次 spawn 的 `description` | 以角色字開頭（`expand`、`implement`、`fix`、`ci-fix`、`merge`、`finder`、`verifier`、`fix-verifier`）、後接票的識別碼 | 通用 agent 的 `subagent_type` 都是 `general-purpose`，分不出角色；不等每個角色都有 agent 定義檔。 |
| `get-to-work` 派票步驟 1「類型不在可用清單時改用通用 agent」 | 加：在派送紀錄把 agent 類型記為 `general-purpose`；派送紀錄與 `ASKING.md` 第 7 節第 8 欄加「agent 類型」 | 退回通用 agent 的 run 靜默用主持人的模型，對帳表與計量原本看不出差別（從 #74 併入）。 |
| `FINISH.md` 最終輸出的「本 run 的計量與預算」 | 加**分段計量**：執行 `scripts/spawns.mjs <counters 檔>`，附 `byType` 與 `byTicket`；沒有 counters 檔時寫明沒有 | 要砍 `prove-it` 的 fan-out 或調預算公式，先要有每一類的數字。 |

新增：`get-to-work/scripts/spawns.mjs`（零依賴，src/dist 逐位元組相同，輸出 `sorry-matt/spawns@1`），測試在
`scripts/spawns.test.mjs`；hook 的新欄位測試加在 `scripts/budget.test.mjs`。真實事件的欄位以
`scripts/spawn-deny.live.mjs` 在 Claude Code 2.1.328 實跑驗證：log 的 `type` 與 `description` 等於 Agent 呼叫給的值。

## 審查收斂、主持人成本與合線（2026-11-19 的 run 檢討）

來源是 run `2026-11-19-all-issues` 的檢討：107 個 spawn 中約 94 個是審查，兩張票超過兩輪修正上限，七條線互相衝突。
這一批沒有走 `prove-it`，由使用者直接審 diff。

| 規則 | 處置 | 理由 |
| --- | --- | --- |
| `prove-it` 第 2 節「每個 lens 一個 finder；單檔數十行或只動說明文字才派一個」 | 改為第 1 節的**審查分級** `tier`（`light`／`standard`／`full`），依改動行數、是否只動說明文字、是否碰敏感路徑判一次；finder 1／2／3 個，verifier 與突變上限同表 | fan-out 固定是五個 finder 加五到七個 verifier，跟票的大小與風險無關；`commands.md` 的「Sensitive paths」本來就是為判級留的欄。 |
| `prove-it` 第 4 節「成立且 blocking（會改變這張票該不該整併的決定）」 | 改為五條 `rule`（`acceptance`、`regression`、`red`、`safety`、`unpinned`），由 verifier 判並引用依據；沒命中的成立候選是觀察 | 原判準沒有可檢查的邊界，主持人把十多則「成立但不 blocking」升成 blocking。 |
| `prove-it` 第 4 節「依檔案＋失效機制分組，其餘各自一個 verifier」 | 改為依檔案分組，組數照 `tier`；verifier 回報每個候選至多五行，另看到的寫進 `noticed` | 每個候選一個 verifier，回報全文都進主持人的 context。 |
| `prove-it` 第 5 節 | 加：結論以 verifier 的裁決為準；主持人要升級某則觀察，另派一個 verifier 只重判那一則的 `rule` | 給「我覺得這該擋」一條有界的路，取代直接改結論。 |
| `prove-it` 第 7 節 Fix Verifier 四題（含「修正有沒有開出新的窗口」「其他呼叫端會不會壞」），每則 finding 一個 subagent | 改為兩題：`evidence` 的情境現在的結果；修正 diff 的改動行有沒有命中五條 `rule`。`light`／`standard` 一張票一個 Fix Verifier；範圍外的寫進 `noticed` | 開放式的題目讓每輪複驗都找到新東西，範圍只增不減。 |
| `prove-it` 第 7 節「只突變 finding 涉及的行，上限 10」 | 改為只重跑上次存活的 mutant | 對修正新增的行再突變，會在複驗產生與原 finding 無關的新 finding。 |
| `prove-it` 第 7 節「修正輪數由呼叫方控管」 | 改為一張票至多兩次 `recheck`，新 finding 算進同一個輪數 | 上限只寫在呼叫方，審查這邊沒有對應的停止條件。 |
| `get-to-work`「收票」步驟 2、3 | 加：主持人照審查區塊執行；交修的是 `findings` 的原文；輪數記在對帳表；觀察與 pre-existing 一張票合開一張 raw ticket | 主持人加碼（升級、加輪、給 Fix Verifier 額外任務）是這次成本放大的主因。 |
| `get-to-work` 第 0 節 | 加步驟 4**合線**：凍結時為每張票存預計檔案，預計檔案重疊的線併成一條 | 線只照 blocker 邊分，七條線改同一批檔，總 PR 互相衝突，主持人還得手動把一條線併進另一條。 |
| `get-to-work`「派票」步驟 3「寧寬勿窄；什麼都推不出來就寫 `/`；規則檔要求一起改的索引表、CI 設定也列」 | 改為寫到檔案、目錄只在票面點名時寫；**索引檔**（各加一行的表與清單）留在清單外，衝突由整併 agent 兩邊都留 | 詞彙表、CI 測試清單幾乎每張票都碰，列進去等於全部互斥；寫成目錄會擋住無關的票。 |
| `get-to-work`「派票」的候選順序「照 frontier 的順序」 | 改為被越多票當 blocker 的越前，同數照 frontier | 檔案重疊時先做哪一張決定了後面能並行多少。 |
| `EXPANDER.md` 第 2 節 | 加：一張票至多十項驗收；設計還沒定的票回報待裁決 | 即時補出 15–25 項驗收，每一項都是審查面；設計票的驗收由展開 agent 現寫，等於沒人核過設計。 |
| `have-it-all-done` 第 0 節兩段展開 | 加：設計還沒定的票在第一段就列進裁決點，沒排進的連同下游標待裁決 | 同上；讓設計定案在唯一的裁決點由人裁。 |
| `ASKING.md` 第 4 節 `spawns` = `30 × 票數 + 50` | 改 `20 × 票數 + 50`，每票典型 10 個 | 分級後每張票的 spawn 少了；上限太寬，這次沒有擋住失控的審查。 |
| `ASKING.md` 第 7 節上下文預算 | 加：交給 subagent 的任務以交付說明為界，沒寫的檢查開成 raw ticket | 同「主持人加碼」。 |

## #102：審查分級改由腳本計算

上一節把分級寫成 `prove-it` 第 1 節的表，主持人每次照表自己數行數、比對敏感路徑。這張票把表搬進
`prove-it/scripts/tier.mjs`（零依賴，src/dist 逐位元組相同，輸出 `sorry-matt/tier@1` 與 `sorry-matt/tier-batch@1`，
格式寫在檔頭），測試在 `scripts/tier.test.mjs`。

| 規則 | 處置 | 理由 |
| --- | --- | --- |
| `prove-it` 第 1 節的審查分級表與「改動行」「敏感路徑」的算法 | 刪；改為執行 `tier.mjs judge`，照輸出的 `tier`、`finders`、`verifiers`、`fixVerifiers`、`mutationCap` 走；腳本失敗時當成 `full` | 確定性的計算不交給 LLM。表的門檻原樣搬進腳本當預設值。 |
| 敏感路徑「取審查用 worktree 裡的 `commands.md`」 | 改為 fixed point 與 ticket 分支兩邊「Sensitive paths」的聯集；兩邊都沒有清單時用腳本內建的預設樣式 | 只讀 ticket 分支，一張票改掉契約就能降低自己的級別。 |
| `prove-it` 第 2 節 lens 依 `tier` 固定分組 | 分組不變，`light` 與 `standard` 加**機械裁剪**：沒有刪除行不派被刪除的行為、沒有規則檔涵蓋改動檔不派 repo 慣例、沒有簽章變動時跨檔案契約併入逐行；`full` 不裁剪 | #80 提案 2。`full` 是敏感或大型改動，保留三個 finder 當保守上限。 |
| `prove-it` 第 4 節 verifier 依檔案分組 | 改由 `tier.mjs batch` **合批**：標了 `suspected` 的候選整批一個 verifier（走簡化流程，不成立的由同一個 verifier 接著走一般流程），其餘依檔案分組，總批數不超過 `verifiers.max` | #80 提案 3。 |
| `prove-it` 第 7 節 `full` 一則 finding 一個 Fix Verifier | 改為一個檔案一個（`tier.mjs batch --stage fix`），同檔的 finding 合批、各自裁決 | #80 提案 3。 |

門檻初值與來源：`lightMaxLines` 50、`fullOverLines` 400、`standardMaxVerifiers` 3、突變上限 3／5／10，全部取自
28aa17b 寫進 `prove-it` 的表（該表依 run `2026-11-19-all-issues` 的檢討訂定），以 `judge` 的旗標覆寫。校正留給
#97 第 4 組：依據是 `get-to-work` 的 `spawns.mjs` 輸出的 `byTicket`（每票的 `finder`、`verifier`、`fix-verifier`
數）對照各票審查區塊的 `tier`。#80 提案 4（只升不降、升級重審）與 5（驗收對照補缺的情境）不在這張票重新展開後的範圍。
