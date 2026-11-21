# Commands

這個 repo 的專案指令契約。欄位定義在 `src/skills/have-it-all-done/ASKING.md` 第 0 節；五個 `##` 標題是固定的鍵，
不改名、不換順序。所有指令都在 repo 根目錄執行，需要 Node 22 以上。

## Full checks

與 CI 相同的四條，依序跑，每條結束代碼 0 才算綠：

```bash
node --test scripts/checks.test.mjs scripts/guard.test.mjs scripts/deploy-on-merge.test.mjs scripts/frontier.test.mjs scripts/mutate.test.mjs scripts/acceptance.test.mjs scripts/overlap.test.mjs scripts/review-guide.test.mjs scripts/ci.test.mjs scripts/reread.test.mjs scripts/budget.test.mjs scripts/spawns.test.mjs scripts/deadline.test.mjs scripts/brief.test.mjs scripts/freeze.test.mjs scripts/end-run.test.mjs scripts/tier.test.mjs scripts/state.test.mjs scripts/verify.test.mjs scripts/worktree.test.mjs scripts/scope.test.mjs scripts/integrate.test.mjs scripts/gates.test.mjs scripts/tick.test.mjs scripts/merge-gate.test.mjs
node scripts/check-structure.mjs
node scripts/check-vendored.mjs
claude plugin validate .
```

這個 repo 沒有 typecheck 與 lint。`claude plugin validate .` 需要 `claude` 在 PATH 上；CI 先以
`npm install -g @anthropic-ai/claude-code@2.1.325` 安裝。

來源：`.github/workflows/check.yml`。

## Targeted checks

- 單一測試檔：

  ```bash
  node --test scripts/<name>.test.mjs
  ```

  改到的檔對應哪個測試檔：

  | 改到的檔 | 測試檔 |
  | --- | --- |
  | `src/skills/get-to-work/scripts/acceptance.mjs` | `scripts/acceptance.test.mjs`、`scripts/tick.test.mjs`（`tick.mjs` import 它的 `MARKER`） |
  | `src/skills/get-to-work/scripts/frontier.mjs` | `scripts/frontier.test.mjs` |
  | `src/skills/get-to-work/scripts/freeze.mjs` | `scripts/freeze.test.mjs`、`scripts/tick.test.mjs`（`tick.mjs` import 它） |
  | `src/skills/get-to-work/scripts/merges.mjs`（沒有自己的測試檔） | `scripts/ci.test.mjs`、`scripts/review-guide.test.mjs`、`scripts/integrate.test.mjs`、`scripts/freeze.test.mjs`、`scripts/tick.test.mjs`（`ci.mjs`、`review-guide.mjs`、`integrate.mjs`、`tick.mjs` import 它，`freeze.mjs` import `ci.mjs`） |
  | `src/skills/get-to-work/scripts/ci.mjs` | `scripts/ci.test.mjs`、`scripts/freeze.test.mjs`、`scripts/tick.test.mjs`（`freeze.mjs` import 它，`tick.mjs` import `freeze.mjs`） |
  | `src/skills/get-to-work/scripts/overlap.mjs` | `scripts/overlap.test.mjs`、`scripts/freeze.test.mjs`、`scripts/tier.test.mjs`、`scripts/tick.test.mjs`（`freeze.mjs` import 它；`tier.test.mjs` 比對 prove-it 的 `tier.mjs` 自帶的 `splitEntry` 與它切法相同；`tick.test.mjs` 實跑它） |
  | `src/skills/get-to-work/scripts/review-guide.mjs` | `scripts/review-guide.test.mjs` |
  | `src/skills/get-to-work/scripts/spawns.mjs` | `scripts/spawns.test.mjs`、`scripts/brief.test.mjs` |
  | `src/skills/get-to-work/scripts/brief.mjs` | `scripts/brief.test.mjs`、`scripts/tick.test.mjs`（`tick.mjs` import 它） |
  | `src/skills/get-to-work/IMPLEMENTER.md`、`src/skills/get-to-work/EXPANDER.md` 與 dist 的同名檔（`brief.mjs` 填它們的佔位） | `scripts/brief.test.mjs` |
  | `src/skills/get-to-work/REVIEWER.md` 與 dist 的同名檔（`brief.mjs review` 在 runtime 讀它的固定規則，檔裡有佔位就以 1 結束） | `scripts/brief.test.mjs`、`scripts/tick.test.mjs`（`tick.mjs` 以 `brief.mjs review` 產出審查主持 agent 的派工檔） |
  | `src/agents/implementer.md`、`src/agents/expander.md` 與 `agents/` 的同名檔（`brief.mjs` 把本文寫進通用 agent 的退回檔） | `scripts/brief.test.mjs`、`node scripts/check-structure.mjs` |
  | `src/skills/get-to-work/scripts/ticket.mjs`（沒有自己的測試檔） | `scripts/frontier.test.mjs`、`scripts/acceptance.test.mjs`、`scripts/integrate.test.mjs` |
  | `src/skills/get-to-work/scripts/cli.mjs`（沒有自己的測試檔） | `scripts/acceptance.test.mjs`、`scripts/frontier.test.mjs`、`scripts/overlap.test.mjs`、`scripts/review-guide.test.mjs`、`scripts/brief.test.mjs`、`scripts/freeze.test.mjs`、`scripts/deadline.test.mjs`、`scripts/state.test.mjs`、`scripts/verify.test.mjs`、`scripts/integrate.test.mjs`、`scripts/gates.test.mjs`、`scripts/tick.test.mjs`、`scripts/merge-gate.test.mjs`、`scripts/tier.test.mjs`（`tier.test.mjs` import `overlap.mjs`） |
  | `src/skills/prove-it/scripts/mutate.mjs` | `scripts/mutate.test.mjs`、`scripts/tier.test.mjs`、`scripts/scope.test.mjs`、`scripts/tick.test.mjs`（`tier.mjs` import 它，`scope.mjs` import `tier.mjs`，`tick.test.mjs` 實跑 `tier.mjs`） |
  | `hooks/` | `scripts/guard.test.mjs`、`scripts/deploy-on-merge.test.mjs`、`scripts/budget.test.mjs`、`scripts/end-run.test.mjs`、`scripts/reread.test.mjs`、`scripts/tick.test.mjs`（`tick.mjs run` 以 `hooks/classify.mjs` 判斷哪些 exec 留給主持人） |
  | `src/skills/prove-it/scripts/tier.mjs` | `scripts/tier.test.mjs`、`scripts/scope.test.mjs`（`scope.mjs` import 它）、`scripts/tick.test.mjs`（它的重播實跑 `tick.mjs` 發下的判級指令） |
  | `src/skills/get-to-work/scripts/deadline.mjs` | `scripts/deadline.test.mjs`、`scripts/tick.test.mjs`、`scripts/integrate.test.mjs`（`tick.mjs` import 它） |
  | `src/skills/get-to-work/scripts/state.mjs` | `scripts/state.test.mjs`、`scripts/verify.test.mjs`、`scripts/integrate.test.mjs`、`scripts/gates.test.mjs`、`scripts/tick.test.mjs`（`verify.mjs` import 它） |
  | `src/skills/get-to-work/scripts/verify.mjs` | `scripts/verify.test.mjs`、`scripts/tick.test.mjs`（它的重播實跑 `tick.mjs` 發下的指令） |
  | `src/skills/prove-it/scripts/scope.mjs` | `scripts/scope.test.mjs` |
  | `src/skills/prove-it/scripts/worktree.mjs` | `scripts/worktree.test.mjs` |
  | `src/skills/get-to-work/scripts/integrate.mjs` | `scripts/integrate.test.mjs`、`scripts/tick.test.mjs`（同上） |
  | `src/skills/get-to-work/scripts/gates.mjs` | `scripts/gates.test.mjs`、`scripts/tick.test.mjs`（同上） |
  | `src/skills/get-to-work/scripts/tick.mjs` | `scripts/tick.test.mjs` |
  | `src/skills/get-to-work/scripts/merge-gate.mjs` | `scripts/merge-gate.test.mjs` |
  | `scripts/check-*.mjs`、`scripts/lib.mjs` | `scripts/checks.test.mjs` |
  | `agents/*.md`、`src/agents/*.md`（沒有測試檔；`check-structure.mjs` 對帳兩版。改了 `tools:` 另以 `node scripts/agent-tools.live.mjs` 手動實測，會花少量額度、不進 CI） | `node scripts/check-structure.mjs` |

  新增的 skill 腳本沒有列在表裡時，跑 import 它的測試檔（`scripts/*.test.mjs` 的 import，或 import 它的腳本
  的測試檔）。`skills/<skill>/scripts/` 是 src 逐位元組的副本，沒有自己的測試：改到它就跑
  `node scripts/check-structure.mjs`，它比對兩邊是否相同。
- 單一 skill（改了 `src/skills/<skill>/` 或 `skills/<skill>/` 的任何檔，含 Markdown、metadata、腳本與 vendored
  檔）：結構與 hash 檢查沒有單一 skill 的參數，整個 repo 跑一次。結束代碼不是 0 時，讀輸出裡**含有**該 skill
  名稱的行（不只是以它開頭的：`check-vendored.mjs` 的行以 `src/skills/<skill>/` 或 `skills/<skill>/` 開頭），
  加上不屬於任何單一 skill 的 repo 層行 —— 以 `skill `、`plugin.json skills ` 或 `README.md skills table `
  開頭的：

  ```bash
  node scripts/check-structure.mjs
  node scripts/check-vendored.mjs
  ```

來源：`.github/workflows/check.yml`、`scripts/*.test.mjs` 的 import、`scripts/check-structure.mjs`。

## Coverage

Node 內建的覆蓋率，產出 lcov 到指定的檔；測試檔清單可以縮到涵蓋改動行的那幾個：

```bash
node --test --experimental-test-coverage --test-reporter=lcov --test-reporter-destination=<lcov 檔> scripts/checks.test.mjs scripts/guard.test.mjs scripts/deploy-on-merge.test.mjs scripts/frontier.test.mjs scripts/mutate.test.mjs scripts/acceptance.test.mjs scripts/overlap.test.mjs scripts/review-guide.test.mjs scripts/ci.test.mjs scripts/reread.test.mjs scripts/budget.test.mjs scripts/spawns.test.mjs scripts/deadline.test.mjs scripts/brief.test.mjs scripts/freeze.test.mjs scripts/end-run.test.mjs scripts/tier.test.mjs scripts/state.test.mjs scripts/verify.test.mjs scripts/worktree.test.mjs scripts/scope.test.mjs scripts/integrate.test.mjs scripts/gates.test.mjs scripts/tick.test.mjs scripts/merge-gate.test.mjs
```

`<lcov 檔>` 放在 repo 之外。repo 沒有另裝覆蓋工具。

來源：`.github/workflows/check.yml`（Node 22 與測試檔清單）。

## Failures only

bash（Windows 上是 Git Bash）。完整輸出導到 repo 之外的 `<log 檔>`，只印失敗的行與結尾的三行摘要；通過與否取
`node --test` 本身的結束代碼，在過濾之前存進 `status`，不取 `grep` 的：

```bash
node --test --test-reporter=tap <測試檔…> > <log 檔> 2>&1; status=$?; grep -E '^ *not ok|^# (tests|pass|fail) ' <log 檔>; echo "exit $status"
```

全綠時只印 `# tests`、`# pass`、`# fail` 與 `exit 0`。`node scripts/check-structure.mjs` 與
`node scripts/check-vendored.mjs` 全綠時本來就只印一行，不必過濾。

來源：`.github/workflows/check.yml`（測試以 `node --test` 執行）。

## Sensitive paths

```text
hooks/
agents/
src/agents/
.github/workflows/
.claude-plugin/
scripts/check-structure.mjs
scripts/check-vendored.mjs
src/skills/get-to-work/scripts/state.mjs#FORMAT
src/skills/get-to-work/scripts/state.mjs#TIERS
src/skills/get-to-work/scripts/state.mjs#STAGES
src/skills/get-to-work/scripts/state.mjs#TERMINAL
src/skills/get-to-work/scripts/state.mjs#EDGES
src/skills/get-to-work/scripts/state.mjs#TIMEOUT_STAGES
src/skills/get-to-work/scripts/state.mjs#PROFILE_DEFAULTS
src/skills/get-to-work/scripts/state.mjs#PROFILE_VALUES
src/skills/get-to-work/scripts/state.mjs#profileOf
src/skills/get-to-work/scripts/state.mjs#VERDICTS
src/skills/get-to-work/scripts/state.mjs#LOCAL_REASONS
src/skills/get-to-work/scripts/state.mjs#COUNTERS
src/skills/get-to-work/scripts/state.mjs#newUsage
src/skills/get-to-work/scripts/state.mjs#newLine
src/skills/get-to-work/scripts/state.mjs#newTicket
src/skills/get-to-work/scripts/state.mjs#newState
src/skills/get-to-work/scripts/state.mjs#checkAssignment
src/skills/get-to-work/scripts/state.mjs#check
src/skills/get-to-work/scripts/state.mjs#profileProblem
src/skills/get-to-work/scripts/state.mjs#lastEntry
src/skills/get-to-work/scripts/state.mjs#currentReview
src/skills/get-to-work/scripts/state.mjs#currentReport
src/skills/get-to-work/scripts/state.mjs#unfixedGate
src/skills/get-to-work/scripts/state.mjs#queueFromReview
src/skills/get-to-work/scripts/state.mjs#queueFromFix
src/skills/get-to-work/scripts/state.mjs#stageGuard
src/skills/get-to-work/scripts/state.mjs#transition
skills/get-to-work/scripts/state.mjs#FORMAT
skills/get-to-work/scripts/state.mjs#TIERS
skills/get-to-work/scripts/state.mjs#STAGES
skills/get-to-work/scripts/state.mjs#TERMINAL
skills/get-to-work/scripts/state.mjs#EDGES
skills/get-to-work/scripts/state.mjs#TIMEOUT_STAGES
skills/get-to-work/scripts/state.mjs#PROFILE_DEFAULTS
skills/get-to-work/scripts/state.mjs#PROFILE_VALUES
skills/get-to-work/scripts/state.mjs#profileOf
skills/get-to-work/scripts/state.mjs#VERDICTS
skills/get-to-work/scripts/state.mjs#LOCAL_REASONS
skills/get-to-work/scripts/state.mjs#COUNTERS
skills/get-to-work/scripts/state.mjs#newUsage
skills/get-to-work/scripts/state.mjs#newLine
skills/get-to-work/scripts/state.mjs#newTicket
skills/get-to-work/scripts/state.mjs#newState
skills/get-to-work/scripts/state.mjs#checkAssignment
skills/get-to-work/scripts/state.mjs#check
skills/get-to-work/scripts/state.mjs#profileProblem
skills/get-to-work/scripts/state.mjs#lastEntry
skills/get-to-work/scripts/state.mjs#currentReview
skills/get-to-work/scripts/state.mjs#currentReport
skills/get-to-work/scripts/state.mjs#unfixedGate
skills/get-to-work/scripts/state.mjs#queueFromReview
skills/get-to-work/scripts/state.mjs#queueFromFix
skills/get-to-work/scripts/state.mjs#stageGuard
skills/get-to-work/scripts/state.mjs#transition
```

範圍是權限邊界、CI、plugin manifest 與 state 格式：`hooks/` 是需要確認的動作的 PreToolUse guard；`agents/` 與它的原稿
`src/agents/` 的 `tools:` 決定 subagent 拿得到哪些工具（審查類沒有 Edit 與 Write）；`.github/workflows/` 是 CI，兩支
`check-*.mjs` 是 CI 的檢查本身；`.claude-plugin/` 是 plugin 的 manifest；`state.mjs` 定義 run 的 state 格式與它的守門規則。
一行也可以寫成 `path#symbol`（寫法同預計檔案，symbol 是函式、區塊或 markdown 標題，巢狀寫 `path#outer#inner`）：
改動碰到該 symbol 才算敏感，同檔其他地方的改動依行數判（#152）。`state.mjs` 列的是它的「the shape」與「the stage
rules」兩段：格式常數（`FORMAT` 到 `COUNTERS`，允許值的集合，含合併 profile 預設值的 `profileOf`）、建出與驗證 state 形狀的
函式（`newUsage` 到 `check`），以及守門規則（`profileProblem` 到 `transition`，決定一張票沒過審查能不能進整合）。它的命令實作、檔案 IO 與參數解析
依行數判。在這兩段新增常數或函式時，同時補進這裡。兩支 skill 其餘的腳本不在這裡：它們的改動依行數判審查分級。

來源：`AGENTS.md`「結構」、`hooks/hooks.json`、`agents/*.md`、`.github/workflows/check.yml`、`.claude-plugin/plugin.json`。
