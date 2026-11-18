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
- 測試 `scripts/budget.test.mjs`，CI 一起跑。PreToolUse deny 對 `Agent` 的實跑驗證尚未做（依 hooks 文件佐證）。

## #17：同一條線上可開工的票平行做（逐票流水線）

| 規則 | 處置 | 理由 |
| --- | --- | --- |
| `get-to-work` 開輪「同線或修改同一批檔案的互斥 tickets 必須分輪」 | 刪掉。互斥只看**預計檔案**是否重疊，由新的 `scripts/overlap.mjs` 判：在途的票佔住預計檔案與它 worktree 已經動到的檔，候選票照 frontier 順序貪婪挑出不重疊的，`start` 全部派出 | 一份 spec 切出來的票通常連成一條線，「同線分輪」等於整份 spec 每輪一張。重疊是可比對的集合運算，交給腳本，不讓主持人推（同 #11 的理由）。 |
| 跨線的檔案重疊 | 不判 | 每條線有自己的整合分支，跨線重疊不會在 run 內衝突；分開派也擋不住兩支總 PR 之間的衝突，那要到收官併入基底或人合併時才處理。 |
| 第 1 節「用 `/loop` 推進輪次」、「開輪」「收輪」 | 改為「推進流水線」、**派票**與**收票**；每次喚醒依序：讀紅線的 CI → 處理回報 → 整併佇列 → 派票點 → 寫 ledger | 收輪要等同輪所有 agent 回報，快的票等慢的。改成一張票回報就收票，整併後馬上補派。 |
| 收輪「同輪所有 agents 回報後」 | 改為「實作 agent 回報後，不等同線或其他票」 | 同上。 |
| 整併（新增**整併佇列**） | 一條線一次整併一張，照進佇列順序；整併後做一個派票點（收票步驟 8 補派） | 整併 agent 解衝突、完成紀錄、push 都對同一個整合 worktree，平行做會互踩；每次整併一次 push 才能讓紅燈對到票（#12）。 |
| **預計檔案**（新增） | 主持人派票前在整合 worktree 預測，存 `sorry-matt/runs/<run>/files/<ticket>.txt`；來源：票面／展開區塊／驗收點名的路徑，點名的模組與識別字以 `git grep -l`、`git ls-files` 找到的檔，repo 規則檔要求連動的檔；推不出就寫 `/` | 不叫實作 agent 開工前回報：subagent 沒有中途回報的管道，要多一次 spawn 與往返，它沒讀 code 前的猜測也不比主持人準。寧寬勿窄：寫寬少一點並行，寫窄才會退回重做。`take-this` 規定票面不寫路徑，所以來源不能只靠票面。 |
| conflict 無法安全解決 → 卡住 | 改為第一次**退回重做**：`git merge --abort`，舊嘗試留在 `refs/sorry-matt/<run>/<NN>-<slug>/sent-back-<k>`，接續紀錄寫退回紀錄（ref、SHA、衝突檔、當時整合分支 SHA、預測沒涵蓋的檔），對帳表退回次數加一，預計檔案加寬，刪 worktree 與分支，下個派票點從最新尖端重派（原 agent 還在就 SendMessage，否則新 spawn 並填 `IMPLEMENTER.md` 新的退回紀錄佔位）；同票第二次仍解不了才卡住 | 預測錯不是票做錯，硬解兩個沒看過彼此的改動風險高；在最新整合分支上重做，衝突在實作 agent 自己的分支裡解。用 ref 而不是保留分支：`clean-it-up` 不會碰到它，收官「ticket 分支都已移除」照樣成立，`git branch -D` 也不丟資料。只退一次，避免來回。 |
| 紅燈處置「在綠燈或撤回之前不派新票」 | 補：整併佇列也暫停；在途的票照常實作、審查、修正，通過的在佇列等；紅燈修正與撤回不排隊；有線在紅燈處置中時每次喚醒都讀那條線的 CI；轉綠觸發派票點；對不到票而驗證未過的線，佇列不再為它暫停 | 流水線下「不派新票」不夠：紅線上再整併別的票，之後的 SHA 都帶著同一個紅，新票的紅被蓋住，修完仍紅時會錯對到原票。在途的工作不浪費，只是晚點整併。佇列暫停時沒有整併可以觸發派票點，所以紅燈期間每次喚醒都讀 CI。 |
| 預算與斷路「一次是一次開輪」 | 改為「一次是一個**派票點**」：第一次喚醒、整併或撤回、有票離開流水線（卡住、待裁決、退回）、紅線轉綠時觸發，一次喚醒至多一個；`budget: rounds` 改計派票點次數，名稱沿用 | 以每次喚醒計，平行的票各自回報會在沒有任何問題時連續觸發斷路；以每張票的派出計，開局同時派三張就算兩次無進展。派票點幾乎都跟在整併之後，連續沒有進展的派票點正是「一直重派卻沒交付」的訊號。名稱沿用免得既有 ledger 與 hook 的 `budget:` 行失效。 |
| 進展的判法「對帳表每張票的狀態」 | 改為「已到終局（已交付、卡住、待裁決）的票」；實作中、審查中、修正中、待整併之間移動與退回不算 | 對帳表現在記階段；階段來回不是交付，算進去斷路器永遠不會跳。 |
| 停下「這次不派票，也不讀 CI」 | 改為停下後不再派票與展開；在途的票照常收票到整併、卡住或退回，讀 CI 照常；退回的票與沒派過的標待裁決；在途收完才收官 | 流水線下停下時常有票做到一半，丟掉已實作完的票不划算；它們的 spawn 多半已經發生。 |
| `ASKING.md` 第 7 節第 8 欄 | 對帳表加「階段」「負責 agent 的 id」「退回次數」 | 沒有輪的邊界，恢復時要從 ledger 知道每張在途的票走到哪、該 SendMessage 給誰（#9）。 |
| `ASKING.md` 第 9 欄 | 「開輪次數」改「派票點次數」，用量加「退回重做次數」；更新時機改「每個派票點的第一件事，與每張票收票結束」；ledger 的寫入時機改「每次喚醒結束」 | 跟著新的「一次」。 |
| `get-to-work` 收官、`have-it-all-done` 交棒 | 對帳表含退回次數與退回紀錄位置；總 PR 為退回過的票註明退回次數；「本輪計量與預算」改「本 run 的計量與預算」 | 交棒報告欄位跟著新的 ledger 欄位。 |
| `EXPANDER.md` 的「輪次」 | 改為派票點次數，寫進展開區塊既有的 `round` key | `acceptance.mjs` 已解析 `round`，不改格式。 |
| `IMPLEMENTER.md`、`EXPANDER.md`、`take-this`、`have-it-all-done`、`ask-miles`、`prove-it` 的「開輪／收輪」 | 改「派票／收票」；`IMPLEMENTER.md` 加退回紀錄佔位與第 1 節第 4 點（重做建立在現況上，不合併舊 ref） | 一致的用詞。 |
| `hooks/budget.mjs` 的 deny 訊息「Stop opening rounds」 | 改「Dispatch no more tickets」 | 同上；README「Run budget」的「every open-round」改「every dispatch point」。 |

新增：`get-to-work/scripts/overlap.mjs`（零依賴，src/dist 逐位元組相同，輸出 `sorry-matt/overlap@1`）與
`scripts/overlap.test.mjs`（同線不重疊的候選同時開工、在途預測與實際改動佔檔、候選依序互佔、`/` 與路徑正規化、
壞計畫、在途 worktree 以 merge-base 計實際改動而不算基底之後的改動），CI 一起跑。實際改動以 merge-base 為準：整合
分支在票開工後前進，直接 `git diff <base>` 會把別張票的改動算到這張票頭上。
