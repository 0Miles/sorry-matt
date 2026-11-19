# Agent 模型分級：改前改後對照

`get-to-work` 的 agents 預設繼承主持人的模型。降級的 agent 由 plugin 的 `agents/*.md` 定義檔指定模型與工具；
每降一個，就在同一組票上跑一次改前與改後，結果記在這裡（#67）。

| agent | 定義檔 | 模型 | 工具 |
| --- | --- | --- | --- |
| 展開 agent | `agents/expander.md`（`sorry-matt:expander`） | `sonnet` | Read, Glob, Grep, Bash, Write, Edit |

實作 agent、紅燈修正的 agent、`prove-it` 的 agents 與整併 agent 沒有定義檔，仍繼承主持人的模型。

## 展開 agent（2026-11-19）

### 做法

- 票集：一個拋棄式 git repo（`slugger`：`src/slug.mjs`、`src/cli.mjs`、一個測試），分支 `cmp/line-slug`，兩張
  Local Markdown 票，都沒有驗收項：`.scratch/slug/issues/01-clean-separators.md`（標點、連續空白與前後空白要
  得到乾淨的 slug）與 `.scratch/slug/issues/02-max-length.md`（CLI 加 `--max-length <n>`，在單字邊界截斷）。
  兩次各從同一份 fixture 重建，不寫任何真實 tracker。
- prompt：`skills/get-to-work/EXPANDER.md` 分隔線以下的全文，佔位填成 run `cmp`、派票點 1、Local Markdown、
  spec none 與兩張票的全文。兩次的 prompt 除了 repo 的絕對路徑（`…/before/repo`、`…/after/repo`）以外逐字相同。
- 每次是一個 headless 主持人 session，只做一件事：讀 prompt 檔，以 Agent tool 原文 spawn 一個 agent，不帶
  `model` 參數。改前 `subagent_type` 是 `general-purpose`，改後是 `sorry-matt:expander`。兩次都核對過 Agent
  呼叫的 `prompt` 與 prompt 檔全文相同。
- Claude Code 2.1.325，主持人模型是使用者的預設（兩次都是 `claude-opus-5-5`）。

指令（`<plugin>` 是本 repo 的 checkout，cwd 是 fixture repo 的上層目錄）：

```bash
claude -p "Read the file <prompt.md> with the Read tool. Then call the Agent tool exactly once, in the foreground, with subagent_type \"<general-purpose | sorry-matt:expander>\", description \"expand tickets\", and as prompt the file's full contents verbatim, character for character, adding and removing nothing. Pass no model parameter. When it returns, print its report verbatim and stop. Use no other tool and do not retry a failed call." \
  --plugin-dir <plugin> --max-turns 6 --max-budget-usd 6 \
  --allowedTools Read Glob Grep Bash Write Edit Agent \
  --output-format stream-json --verbose > session.jsonl

# token 數：最後一個 type 為 result 的事件（與 --output-format json 的輸出是同一個物件）
node -e "const r=require('fs').readFileSync('session.jsonl','utf8').split('\n').filter(Boolean).map(JSON.parse).find(e=>e.type==='result');console.log(JSON.stringify({usage:r.usage,modelUsage:r.modelUsage,cost:r.total_cost_usd},null,1))"

# 每張票的結果
node <plugin>/skills/get-to-work/scripts/acceptance.mjs local --ref cmp/line-slug .scratch/slug/issues/01-clean-separators.md
node <plugin>/skills/get-to-work/scripts/acceptance.mjs local --ref cmp/line-slug .scratch/slug/issues/02-max-length.md
```

### Token 用量

`result.usage` 只算主持人自己的回合，`result.modelUsage` 依模型加總整個 session（含 subagent）。改後 subagent
獨佔 `claude-sonnet-5-5` 那一列；改前 subagent 與主持人同模型，subagent 的數字是 `modelUsage` 減 `usage`。

展開 agent（subagent）：

| | 模型 | 輸入 | 輸出 | cache 讀取 | cache 寫入 |
| --- | --- | ---: | ---: | ---: | ---: |
| 改前（`general-purpose`） | `claude-opus-5-5` | 12 | 5,198 | 211,634 | 46,793 |
| 改後（`sorry-matt:expander`） | `claude-sonnet-5-5` | 8 | 3,122 | 28,288 | 12,785 |

主持人（兩次都是 `claude-opus-5-5`）：

| | 輸入 | 輸出 | cache 讀取 | cache 寫入 |
| --- | ---: | ---: | ---: | ---: |
| 改前 | 6 | 2,414 | 121,553 | 20,693 |
| 改後 | 6 | 2,222 | 121,549 | 20,492 |

整個 session 的 `total_cost_usd`：改前 0.6185，改後 0.2987（其中 sonnet 那一列 0.0660，opus 那一列 0.2327）。

### 每張票的結果

| 票 | 改前 | 改後 |
| --- | --- | --- |
| `01-clean-separators.md` | 寫出展開區塊，驗收 10 項，`needsExpansion` false | 寫出展開區塊，驗收 9 項，`needsExpansion` false |
| `02-max-length.md` | 寫出展開區塊，驗收 9 項，`needsExpansion` false | 寫出展開區塊，驗收 9 項，`needsExpansion` false |

兩次都沒有票回報待裁決，成果都 commit 在 `cmp/line-slug`：改前是兩個 commit，各動一個票檔；改後是一個 commit，
動兩個票檔。每張票的結果類別相同。

### 判讀與限制

- 「結果相同」指結果類別（展開或待裁決）相同且 `needsExpansion` 為 false；驗收項的內容是否等價要人看，全文在
  下一節。
- 各只跑一次，票集只有兩張小票：數字是一次量測，不是平均。
- cache 讀取的差距不全來自模型：`general-purpose` 帶全部工具，system prompt 比限六個工具的 `expander` 大，回合數
  也不同。這正是定義檔 `tools:` 的效果，但不能只歸給 `model:`。
- 兩次都載入了使用者的全域指示檔（要求以繁體中文回應）。改後的區塊以繁體中文寫成，改前是英文；key 都是英文，
  腳本讀取不受影響。
- 改後 01 的第 2 項原文在兩個單字之間有連續空白；`acceptance.mjs` 讀出時會把空白收成一個，所以下面看起來與
  第 5 項相同。

### 驗收項全文

以下是 `acceptance.mjs` 讀出的 `items[].text` 與展開區塊的 `rulings`，未經修改。

#### 改前：`01-clean-separators.md`

- `slugify('Hello, World!')` returns `'hello-world'`.
- `slugify(' Hello World ')` returns `'hello-world'` (leading, trailing and repeated spaces leave no empty segment).
- `slugify('Hello -- World')` returns `'hello-world'` (no doubled dashes, including dashes already in the title).
- `slugify('Rock & Roll: 2024 Edition')` returns `'rock-roll-2024-edition'`.
- `slugify('Hello\tWorld\n')` returns `'hello-world'` (tabs and newlines are separators too).
- `slugify('Café Noir')` returns `'cafe-noir'` and `slugify('日本 Tokyo')` returns `'tokyo'` (see ruling 1).
- `slugify('!!!')` and `slugify('')` both return `''`.
- For every input above, the output matches `/^([a-z0-9]+(-[a-z0-9]+)*)?$/`; a test asserts this pattern over that input list.
- `node src/cli.mjs " Hello, World! "` prints `hello-world` and exits 0.
- The existing test `joins words with a dash` still passes unchanged, and `npm test` exits 0 with the new cases above covered by tests in `test/`.

rulings:

| # | decision | reason | cost to reverse | evidence |
| --- | --- | --- | --- | --- |
| 1 | After lower-casing, apply Unicode NFKD and drop combining marks (so accented Latin letters keep their base letter); any remaining character outside `[a-z0-9]` is a separator. No transliteration of other scripts. | The ticket allows only lower-case letters, digits and dashes; stripping accents keeps `Café` readable as `cafe` at the cost of one `normalize` call, while full transliteration would need a dependency the repo does not have. | `src/slug.mjs` and the `Café`/`日本` cases in `test/`; re-run `npm test`; nothing delivered yet. | `src/slug.mjs` (current `slugify` only splits on `' '`); `package.json` has no dependencies. |
| 2 | A title with no `[a-z0-9]` character yields the empty string; `slugify` does not throw. | Keeps `slugify` a total function; what the CLI should do with an empty slug is outside this ticket. | `src/slug.mjs` and one test; nothing delivered yet. | Ticket text: "no empty segments" (an empty slug has no segments). |

#### 改前：`02-max-length.md`

- `node src/cli.mjs --max-length 11 "Hello World Again"` prints `hello-world` and exits 0.
- `node src/cli.mjs --max-length 14 "Hello World Again"` prints `hello-world` (cut at the last word boundary that fits, never `hello-world-ag` and never a trailing dash).
- `node src/cli.mjs --max-length 17 "Hello World Again"` and `--max-length 100` both print `hello-world-again` (a slug that already fits is unchanged).
- `node src/cli.mjs "Hello World Again" --max-length 11` prints `hello-world` (the option may come before or after the title).
- `node src/cli.mjs --max-length 3 "Hello World"` prints `hel` (see ruling 1).
- `node src/cli.mjs "Hello World"` with no option still prints `hello-world`.
- Each of `--max-length 0`, `--max-length -1`, `--max-length abc`, `--max-length 2.5`, and `--max-length` with no value prints a usage message on stderr, prints nothing on stdout, and exits 2.
- The usage message printed for a missing title mentions `--max-length <n>`.
- `npm test` exits 0 and includes tests covering the boundary cut (`11`/`14`), the fits-already case, and the hard-cut case.

rulings:

| # | decision | reason | cost to reverse | evidence |
| --- | --- | --- | --- | --- |
| 1 | When the first word alone is longer than `n`, cut that word at `n` characters (hard cut) rather than returning an empty slug. | The ticket's hard guarantee is "no longer than n"; an empty slug would be useless output, so a mid-word cut is allowed only when no boundary exists. | `src/slug.mjs` or `src/cli.mjs` plus one test; nothing delivered yet. | Ticket text: "no longer than `n` characters, cut at a word boundary rather than mid-word". |
| 2 | `n` must be a positive integer written in decimal digits; anything else is a usage error with exit code 2. | Matches the CLI's existing usage-error exit code. | `src/cli.mjs` and its tests; nothing delivered yet. | `src/cli.mjs` (`process.exit(2)` on usage error). |
| 3 | Only the `--max-length <n>` (space-separated) form is required; `--max-length=<n>` is not required. | The ticket names only the space form. | `src/cli.mjs`; nothing delivered yet. | Ticket text. |

#### 改後：`01-clean-separators.md`

- `slugify('Hello, World!')` 回傳 `hello-world`(標點不留在結果中)
- `slugify('Hello World')` 回傳 `hello-world`(連續空白只產生一個 `-`)
- `slugify(' Hello World ')` 回傳 `hello-world`(前後空白不產生開頭或結尾的 `-`)
- `slugify('a - b -- c')` 回傳 `a-b-c`(不出現 `--`,也沒有空 segment)
- `slugify('Hello World')` 仍回傳 `hello-world`(既有測試不變且通過)
- 對上述每個輸入,結果皆符合 `/^[a-z0-9]+(-[a-z0-9]+)*$/`
- `slugify('!!! ???')` 與 `slugify('')` 回傳空字串 `''`,且不丟出例外
- 上述案例都有對應的測試放在 `test/slug.test.mjs`,`npm test` 全數通過
- `node src/cli.mjs " Hello, World! "` 輸出 `hello-world`

rulings:

| # | decision | reason | cost to reverse | evidence |
| --- | --- | --- | --- | --- |
| 1 | 任何非 `[a-z0-9]` 的字元(含重音字母、非 ASCII)一律視為分隔符,不音譯 | ticket 要求結果只含小寫字母、數字與單一 dash;音譯超出範圍 | 只改 `src/slug.mjs` 與其測試,尚未交付任何東西 | `src/slug.mjs`(目前只做 split(' ')) |
| 2 | 清理後無任何內容時,`slugify` 回傳 `''`,不報錯;CLI 行為維持現狀(僅在沒給 title 時 exit 2) | 範圍內最小改動,保留 CLI 既有契約 | 只改 `src/slug.mjs`/`src/cli.mjs` 與測試 | `src/cli.mjs` 的 usage 檢查 |

#### 改後：`02-max-length.md`

- `node src/cli.mjs "the quick brown fox" --max-length 12` 輸出 `the-quick`(在單字邊界截斷,長度 <= 12,不以 `-` 結尾)
- `node src/cli.mjs --max-length 12 "the quick brown fox"`(選項在 title 前)輸出同樣結果
- 完整 slug 長度 <= n 時原樣輸出:`node src/cli.mjs "hello world" --max-length 11` 輸出 `hello-world`
- 截斷點剛好落在單字結尾時保留該單字:`"the quick brown fox" --max-length 9` 輸出 `the-quick`
- 第一個單字就比 n 長時,硬切成前 n 個字元(輸出非空):`"extraordinary" --max-length 5` 輸出 `extra`
- 不給 `--max-length` 時輸出與現狀完全相同
- `--max-length` 的值缺少、非整數、或小於 1(例如 `abc`、`0`、`-3`、`2.5`)時,stderr 印出 usage 訊息、stdout 為空、exit code 為 2
- 截斷邏輯由可單獨測試的函式提供(例如 `slugify(title, { maxLength })`),測試放在 `test/slug.test.mjs`,CLI 行為至少有一個以 `node src/cli.mjs` 實際執行的測試;`npm test` 全數通過
- README 補上 `--max-length <n>` 的用法一行

rulings:

| # | decision | reason | cost to reverse | evidence |
| --- | --- | --- | --- | --- |
| 1 | 單字比 n 長時硬切為 n 個字元,而不是輸出空字串 | ticket 要求長度不超過 n,空 slug 沒有用處 | 只改 `src/slug.mjs` 與測試 | ticket 02 What to build |
| 2 | 無效的 n 以 exit 2 加 usage 處理,與現有缺 title 的做法一致 | 沿用既有 CLI 慣例 | 只改 `src/cli.mjs` 與測試 | `src/cli.mjs` |
| 3 | 截斷作用於 slugify 產生的 slug(以 `-` 為單字邊界);與 ticket 01 的清理無順序依賴,各自驗收 | 兩張 ticket 都動 `src/slug.mjs`,但判準彼此獨立 | 若合併衝突,僅限 `src/slug.mjs` 與其測試 | `src/slug.mjs` |
