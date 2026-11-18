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
| 轉交給實作 agent 的流程（改前 `implement.md`，改後 `IMPLEMENTER.md`） | 17 / 103 | 84 / 779 |
| **主持人讀進 context 的總量** | **631 / 6596** | **625 / 6317** |

`ASKING.md` 變長，是因為三個 skill 各寫一份的開場讀取、run ledger 與上下文預算都收進它當正本。

實作 agent 這一側：改前收到 `implement.md`（17 行）、三條延伸契約，再以 Skill tool 載入 `tdd`
（`SKILL.md`、`tests.md`、`mocking.md` 合計 174 行），其中有它做不到的「跟使用者確認 seams」。改後只收
`IMPLEMENTER.md`（84 行），自足、沒有要它問人的地方。

開局 agent 這一側：改前讀 `take-this/SKILL.md`、`to-spec.md`、`to-tickets.md`、`ASKING.md`（100＋75＋105
＋166＝446 行）；改後讀 `take-this/SKILL.md`、`TEMPLATES.md`、`ASKING.md`（126＋84＋198＝408 行）。

重新量測：

```bash
wc -lw skills/have-it-all-done/SKILL.md skills/have-it-all-done/ASKING.md skills/get-to-work/SKILL.md skills/get-to-work/IMPLEMENTER.md
```

## 待腳本或 hook 落地的規則

這些規則先留著，以 `<!-- pending #N -->` 標記，由各自的票落地後刪文字：

| 標記 | 位置 | 規則 |
| --- | --- | --- |
| `#8` | `ASKING.md` 第 5 節 | 授權三層與永久例外 |
| `#8` | `get-to-work` 第 0 節 | 授權來源 |
| `#8` | `get-to-work` 第 2 節 | 常設授權允許時自動合併總 PR |
| `#11` | `get-to-work` 第 0 節凍結第 2 步 | 讀 blocker 邊、劃分線 |
| `#11` | `get-to-work` 開輪 | frontier 的定義 |
| `#16` | `ASKING.md` 第 7 節 ledger 第 9 欄 | 計量（只記錄、不據此停下） |

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

## 新增的規則

- `IMPLEMENTER.md`：實作 agent 的自足交付說明。seams 以票為準，票上沒寫就自定並記入接續紀錄（#6）。
  它和 `ASKING.md` 第 3、5 節、`have-it-all-done` 第 0 節有刻意的重複：實作 agent 讀不到那兩份，
  檔頭標明要一起改。
- `TEMPLATES.md` 的票模板加 Seams 欄，讓「seams 以票為準」有地方寫。
- `ASKING.md` 永久例外清單加 force-push（原本只寫在 `get-to-work`）。
- CI：`.github/workflows/check.yml` 在 PR 上跑 `claude plugin validate`、`scripts/check-structure.mjs`
  （src／dist 結構對帳）、`scripts/check-vendored.mjs`（vendored 檔 SHA-256），以及兩支腳本的測試。
