# 主持人端的成本：七個方案的比較

#87 的交付物。數字來源只有兩個：`docs/agent-models.md` 的 #67 對照量測，以及 run `2026-11-19-open-issues` 的觀察
（記在 #87 票面）。**這次沒有跑新的對照量測**：使用者 2026-11-19 裁決基準 run 延後到 #97（第 2 組「主持人成本基準」）。
下表的預期節省除了直接量檔案大小的以外都是推導，逐格標明；#97 跑完後回來把推導換成量測。

## 引用的數字

#67 對照量測的「改後」那一次（`docs/agent-models.md`「Token 用量」），主持人是 `claude-opus-5-5`：

| | 輸入 | 輸出 | cache 讀取 | cache 寫入 | 合計 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 主持人 | 6 | 2,222 | 121,549 | 20,492 | 144,269 |

- 整個 session 0.2987 USD，其中 opus 那一列（主持人）0.2327 USD：0.2327 ÷ 0.2987 = 77.9%。
- 主持人的 token 裡 cache 讀取占 121,549 ÷ 144,269 = 84.3%，cache 寫入占 20,492 ÷ 144,269 = 14.2%，輸出占
  2,222 ÷ 144,269 = 1.5%。
- **每回合的固定成本（推導）：** 那個主持人只做三件事（讀 prompt 檔、spawn 一個 agent、印出回報），回合數沒有記下，
  下限是 3，上限是指令的 `--max-turns 6`。121,549 ÷ 6 = 20,258，121,549 ÷ 3 = 40,516，所以每回合讀取的
  context 約 20,258–40,516 token。下表稱它「每回合固定成本 F」。
- run `2026-11-19-open-issues`（8 張票，沒有 token 數）：約 60 次 spawn，其中 46 次是 `prove-it` 的 finder、verifier
  與 Fix Verifier；這些回報多在 20–60 行，交付說明的上限是 15 行；`prove-it` 全文在第一次審查載入後，之後 11 輪審查
  都帶著；沒有發生壓縮。

bytes 換算 token 時一律假設英文 dist 檔 4 bytes ≈ 1 token。這是假設，不是量測，用到的格子都標「推導」。

## 比較表

| 方案 | 動到哪些檔 | 預期省哪一類 token | 預期節省與依據 | 怎麼量 | 實作成本 | 對票結果的風險 | 建議 | 對應的票 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1. 減少主持人的回合數 | `src/skills/get-to-work/SKILL.md` 的喚醒步驟與 dist | 主持人的 cache 讀取 | **推導。** 每少一個回合省一次 F：121,549 ÷ 6 到 121,549 ÷ 3 = 20,258–40,516 token。cache 讀取占主持人 token 的 84.3%（121,549 ÷ 144,269），所以回合數是最大的槓桿。能少幾個回合沒有數字。「只等 agent 的喚醒」已有一部分不發生：`prove-it` 的 agents 是前景派送，主持人不被喚醒。 | #97 第 2 組的基準 run 對改後的 run：主持人的回合數、主持人的 cache 讀取 token | 低：只改送出方式的措辭，不改判定 | 低：判定規則不動 | 做 | #107（排在 #101 之後） |
| 2. 縮小每回合的固定 context | dist 各 skill 的 frontmatter `description`、`agents/expander.md` 的 `description` | 主持人與每個 subagent 的 cache 讀取、cache 寫入 | **實測（bytes）。** plugin 管得到、每回合都在 context 裡的只有：9 支 model-invoked skill 的 `description` 合計 1,804 bytes，`agents/expander.md` 的 `description` 227 bytes，共 2,031 bytes。7 支 user-invoked skill 的 `description`（1,040 bytes）不在 model 的 skill 清單裡。`hooks/` 沒有每回合印出的文字，只在事件發生時印：壓縮後的重讀提醒 244 bytes 加路徑，超過 spawn 上限的 deny 理由 535 bytes 加路徑與數字。量法指令見表下「方案 2 的量測」。**推導：** 全部刪光也只有每次喚醒重讀的規則檔 87,922 bytes 的 2,031 ÷ 87,922 = 2.3%。系統提示、工具定義、其他 plugin 的 skill 清單、使用者的指示檔屬於 runtime 或使用者，plugin 改不了。 | #97 第 2 組：主持人第一個回合的 cache 寫入 token（裝與不裝本 plugin 各一次），差額就是 plugin 貢獻的固定 context | 低，但每個 `description` 都要重寫並重驗觸發 | 中：`description` 決定 skill 會不會被觸發，縮短可能讓 skill 不載入 | 不做 | #97（只量，不開實作票） |
| 3. 縮小主持人讀進來的規則 | `src/skills/get-to-work/SKILL.md` 拆出 reference 檔與 dist | 主持人的 cache 寫入（每次重讀）與之後每回合的 cache 讀取 | **實測（bytes）：** 每次喚醒重讀 `skills/get-to-work/SKILL.md` 65,895 bytes 與 `skills/have-it-all-done/ASKING.md` 22,027 bytes，共 87,922 bytes。**推導：** 87,922 ÷ 4 = 21,980 token；占每回合固定成本 F 的 21,980 ÷ 40,516 = 54% 到 21,980 ÷ 20,258 = 108%，也就是與 runtime 的固定 context 同一個量級。#76 估收官等段落約佔 `SKILL.md` 三成：0.3 × 65,895 = 19,769 bytes ≈ 4,942 token，每次喚醒少讀這麼多。 | #97 第 2 組的基準 run 對 #76 之後的 run：主持人的 cache 寫入與 cache 讀取 token、喚醒次數；並記下核心 `SKILL.md` 的 bytes | 中：拆檔並逐條對照規則 | 低到中：走到某個 branch 卻沒讀對應 reference 時，規則會漏 | 做 | #76 |
| 4. 機械狀態交給腳本 | `skills/get-to-work/scripts/` 新增 `ci.mjs`、`deadline.mjs`、`tick.mjs` 與 `<run>.state.json`；`src/skills/get-to-work/SKILL.md`、`src/skills/have-it-all-done/ASKING.md` 第 7 節與 dist | 主持人的輸出（不再逐步推導）與 cache 讀取（回合變少） | **推導。** 節省 = 少掉的回合數 × F（20,258–40,516 token，算式同方案 1）＋少寫的輸出 token。少幾個回合沒有數字。輸出只占主持人 token 的 1.5%（2,222 ÷ 144,269），所以主要的節省來自回合數，不是輸出。 | #97 第 3 組（`state.json` 與 `tick.mjs` 的改前改後）：兩次 run 的喚醒次數、主持人的回合數、cache 讀取與輸出 token；對帳表的終局要相同 | 高：四支腳本加測試，四張票 | 中：判定從規則搬進腳本，腳本錯了每張票都受影響；有測試與對帳表終局的對照 | 做 | #98、#99、#100、#101（總票 #79） |
| 5. subagent 回報設硬上限 | `src/skills/get-to-work/IMPLEMENTER.md`、`EXPANDER.md`、`src/skills/prove-it/SKILL.md` 與 dist | 主持人的 cache 寫入（回報進 context 那一次）與之後每回合的 cache 讀取 | **推導。** 46 份 `prove-it` 回報各超過上限 20 − 15 = 5 到 60 − 15 = 45 行：46 × 5 = 230 到 46 × 45 = 2,070 行多留在主持人的 context，直到壓縮為止。其餘約 60 − 46 = 14 次 spawn 的回報有沒有超過沒有紀錄。方案 6 做了之後，那 46 份不再進主持人的 context，這一項剩下的範圍是 14 份。 | #97 第 2 組：主持人的 cache 寫入 token，以及每份回報的行數（依 #75 的 agent 類型分段） | 低：改交付說明的措辭，回報全文寫進檔案 | 低到中：摘要漏掉主持人裁決要用的資訊時，要多一個回合去讀檔 | 不做 | #108（方案 6 涵蓋 46 ÷ 60 = 77% 的回報） |
| 6. 審查交給一個 subagent 主持 | `src/skills/get-to-work/SKILL.md` 收票的審查步驟、`src/skills/prove-it/SKILL.md`、需要時新增一份審查主持 agent 的交付說明，與 dist；`hooks/budget.mjs` 的計數要確認 | 主持人的 cache 寫入與 cache 讀取；審查類 subagent 的 token 會增加 | **subagent 能再 spawn subagent：能（見表下的證據）。** **實測（bytes）：** `skills/prove-it/SKILL.md` 23,684 bytes 不再進主持人的 context。**推導：** 23,684 ÷ 4 = 5,921 token；46 份回報 × 20–60 行 = 920–2,760 行換成每輪審查一份 15 行以內的回報，11 輪 × 15 = 165 行。代價是每輪多一個審查主持 agent，它自己要付一份固定 context；`docs/agent-models.md` 的對照量測裡，一個帶全部工具的通用 subagent cache 讀取 211,634 token，所以淨效果是正是負要量。 | #97 的基準 run 對改後的 run：主持人的 cache 讀取與 cache 寫入 token、審查類 subagent 的總 token 與成本（依 #75 分段）、每張票的裁決與 blocking finding 是否相同 | 中到高：改兩支 skill 的審查流程，確認 spawn 計數涵蓋第二層 | 中：裁決改由 subagent 寫；finder、verifier 的獨立性與裁決格式不變，票面要求改前改後的裁決相同 | 做 | #108 |
| 7. 主持人模型分級 | `src/skills/get-to-work/SKILL.md` 與 `src/skills/have-it-all-done/ASKING.md`（哪些步驟留在原模型）、可能新增 `agents/*.md` | 主持人的全部四類 token 的單價，不是數量 | **推導。** 上限 = 主持人占比 × 調度回合占主持人成本的比例 s × (1 − 便宜模型與原模型的單價比 p) = 77.9% × s × (1 − p)，77.9% 來自 0.2327 ÷ 0.2987。s 與 p 都沒有量過：`docs/agent-models.md` 沒有記單價，也沒有把主持人的回合分成調度與裁決。`docs/agent-models.md` 記下的目視驗收顯示降模型會改變產出。 | #97 第 2 組：主持人的成本依回合類型（調度、裁決點、代答）分段，得出 s；兩個模型各跑一次，比 `total_cost_usd` 與每張票的結果類別、裁決是否等價 | 高：主持人換模型要靠 subagent 或另開 session，等於重排主持人的職責 | 高：調度也含判斷（檔案重疊、紅燈對票），降模型可能改變票的結果 | 等 #97 | #97 |

## 建議不做的方案

- **方案 2：** 「預期節省與依據」那一格——plugin 管得到的固定 context 只有 2,031 bytes，是每次喚醒重讀的規則檔的
  2.3%；而「對票結果的風險」那一格是中，縮短 `description` 會動到 skill 的觸發。#97 量出 plugin 貢獻的固定
  context 之後數字若不同，再回來改這一列。
- **方案 5：** 「預期節省與依據」那一格——超出上限的回報裡，46 份（60 次 spawn 的 77%）由方案 6 整批移出主持人的
  context，剩下 14 份有沒有超過上限沒有紀錄。#108 沒做或被撤回時，這一列要重新評估。

## 方案 2 的量測

量的是 LF 正規化後的 dist 內容（`git show HEAD:<path>`），不量 working tree。在 repo 根目錄執行：

```bash
# 各 skill 的 description bytes；第二欄 1 表示 disable-model-invocation: true（不在 model 的 skill 清單裡）
for f in skills/*/SKILL.md; do
  d=$(git show "HEAD:$f" | sed -n '2,/^---$/p' | grep '^description:' | sed 's/^description: *//' | tr -d '\n' | wc -c)
  m=$(git show "HEAD:$f" | sed -n '2,/^---$/p' | grep -c '^disable-model-invocation: true')
  echo "$d $m $f"
done

# agents/*.md 的 description
git show HEAD:agents/expander.md | grep '^description:' | sed 's/^description: *//' | tr -d '\n' | wc -c

# 規則檔與 prove-it（方案 3、6）
for f in skills/get-to-work/SKILL.md skills/have-it-all-done/ASKING.md skills/prove-it/SKILL.md; do
  echo "$(git show "HEAD:$f" | wc -c) $f"
done

# hooks 印進 context 的文字（路徑各填 1 個字元、數字填 0，所以要各扣掉 2 與 3 bytes）
node -e "import('./hooks/runs.mjs').then(async r=>{const b=await import('./hooks/budget.mjs');console.log(Buffer.byteLength(r.reminder([{ledger:'L',rules:[{path:'P',exists:true}]}])),Buffer.byteLength(b.denyReason('',0,0)))})"
```

結果（commit `18621c1`）：

| 項目 | bytes |
| --- | ---: |
| 16 支 dist skill 的 `description` 合計 | 2,844 |
| 其中 9 支 model-invoked（進 skill 清單） | 1,804 |
| 其中 7 支 user-invoked（不進 skill 清單） | 1,040 |
| `agents/expander.md` 的 `description` | 227 |
| `skills/get-to-work/SKILL.md` | 65,895 |
| `skills/have-it-all-done/ASKING.md` | 22,027 |
| `skills/prove-it/SKILL.md` | 23,684 |
| 壓縮後的重讀提醒（不含路徑） | 244 |
| spawn 上限的 deny 理由（不含路徑與數字） | 535 |

「user-invoked 的 `description` 不進 skill 清單」是一次觀察：#87 的實作 agent 自己的 skill 清單裡，`sorry-matt:` 開頭的
只有那 9 支 model-invoked skill（Claude Code 2.1.328）。

`hooks/` 會印進 context 的文字都只在事件發生時出現，沒有每回合的固定輸出：

- `hooks/reread.mjs`（SessionStart，matcher `compact`）：壓縮之後印一次重讀提醒，文字在 `hooks/runs.mjs` 的
  `reminder()`，固定兩行加每個 ledger 與規則檔各一行；一個 ledger、一個規則檔時是 244 bytes 加兩個路徑的長度。
- `hooks/spawns.mjs`（PreToolUse `Agent` 與 SubagentStart）：只有超過 spawn 上限時印 deny 的理由
  （`hooks/budget.mjs` 的 `denyReason()`），535 bytes 加 ledger 路徑與三個數字的長度。
- `hooks/guard.mjs`（PreToolUse）：只有擋下的災難級操作才印理由（`hooks/decision.mjs`）。
- `hooks/hooks.json` 的 `description` 是給人看的，不進 context。

屬於 runtime 或使用者、plugin 改不了的：Claude Code 的系統提示、內建工具與 MCP 工具的定義、其他 plugin 與內建 skill
的清單、agent 類型清單、使用者與專案的指示檔（`CLAUDE.md`、`AGENTS.md`）、memory。這些各占多少這次沒有量，留給 #97。

## 方案 6 的證據：subagent 能不能再 spawn subagent

能。

- **官方文件：** <https://code.claude.com/docs/en/sub-agents> 的「Let subagents spawn their own subagents」一節：預設
  subagent 可以再 spawn，最深到主對話以下三層；到深度上限的 subagent 拿不到 `Agent` tool；上限由環境變數
  `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` 設定，設成 `1` 就關掉巢狀。同一節舉的例子就是 reviewer subagent 為每個
  finding 派一個 verifier。（2026-11-19 讀取。）
- **一次實測：** #87 的實作 agent 本身是 `get-to-work` 主持人 spawn 的 subagent。它以 Agent tool
  （`subagent_type: Explore`，prompt 要求只回報自己的工具清單）spawn 了一個下層 agent，呼叫成功並收到回報
  （Claude Code 2.1.328，Windows）。那個下層 agent 回報自己沒有 `Agent` tool；`Explore` 的定義本來就排除它，所以
  這一點不能用來判斷第三層。

審查主持 agent 在第一層，finder、verifier 與 Fix Verifier 在第二層，在預設的三層以內。使用者把
`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` 設成 `1` 時這個方案不能用，#108 要處理這個情況。沒有驗證的：
`hooks/budget.mjs` 的 SubagentStart 計數有沒有算進第二層的 agent。

## 限制

- #67 的數字是單次量測，不是平均；那個主持人只讀 prompt 檔、spawn 一個 agent、印出回報，不是真實 `get-to-work`
  run 的主持人。真實 run 的主持人還要重讀規則檔、收回報、維護 ledger，每回合的 context 比 F 大。
- run `2026-11-19-open-issues` 的觀察沒有 token 數，只有 spawn 數與回報的行數。
- 那次 run 沒有發生壓縮，所以重讀規則檔的成本沒有被量到。
- F 的範圍來自沒有記下的回合數（3 到 6）；4 bytes ≈ 1 token 是假設。用到這兩個數的比例只能看量級。
- `docs/agent-models.md` 沒有記各類 token 的單價，所以表裡沒有把 token 換成 USD；成本的比例只引用
  `total_cost_usd` 的 0.2327 與 0.2987。
- 分段計量（每一類 subagent 各花多少）要等 #75；方案 5、6 的效果在那之前量不出來。
