# Commands

這個 repo 的專案指令契約。欄位定義在 `src/skills/have-it-all-done/ASKING.md` 第 0 節；五個 `##` 標題是固定的鍵，
不改名、不換順序。所有指令都在 repo 根目錄執行，需要 Node 22 以上。

## Full checks

與 CI 相同的四條，依序跑，每條結束代碼 0 才算綠：

```bash
node --test scripts/checks.test.mjs scripts/guard.test.mjs scripts/deploy-on-merge.test.mjs scripts/frontier.test.mjs scripts/mutate.test.mjs scripts/acceptance.test.mjs scripts/overlap.test.mjs scripts/review-guide.test.mjs scripts/ci.test.mjs scripts/reread.test.mjs scripts/budget.test.mjs scripts/spawns.test.mjs scripts/deadline.test.mjs scripts/brief.test.mjs scripts/freeze.test.mjs scripts/end-run.test.mjs scripts/tier.test.mjs
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
  | `src/skills/get-to-work/scripts/acceptance.mjs` | `scripts/acceptance.test.mjs` |
  | `src/skills/get-to-work/scripts/frontier.mjs` | `scripts/frontier.test.mjs` |
  | `src/skills/get-to-work/scripts/freeze.mjs` | `scripts/freeze.test.mjs` |
  | `src/skills/get-to-work/scripts/overlap.mjs` | `scripts/overlap.test.mjs`、`scripts/freeze.test.mjs` |
  | `src/skills/get-to-work/scripts/review-guide.mjs` | `scripts/review-guide.test.mjs` |
  | `src/skills/get-to-work/scripts/spawns.mjs` | `scripts/spawns.test.mjs`、`scripts/brief.test.mjs` |
  | `src/skills/get-to-work/scripts/brief.mjs` | `scripts/brief.test.mjs` |
  | `src/skills/get-to-work/IMPLEMENTER.md`、`src/skills/get-to-work/EXPANDER.md` 與 dist 的同名檔（`brief.mjs` 填它們的佔位） | `scripts/brief.test.mjs` |
  | `src/skills/get-to-work/scripts/ticket.mjs`（沒有自己的測試檔） | `scripts/frontier.test.mjs`、`scripts/acceptance.test.mjs` |
  | `src/skills/get-to-work/scripts/cli.mjs`（沒有自己的測試檔） | `scripts/acceptance.test.mjs`、`scripts/frontier.test.mjs`、`scripts/overlap.test.mjs`、`scripts/review-guide.test.mjs`、`scripts/brief.test.mjs`、`scripts/freeze.test.mjs` |
  | `src/skills/prove-it/scripts/mutate.mjs` | `scripts/mutate.test.mjs`、`scripts/tier.test.mjs`（`tier.mjs` import 它） |
  | `hooks/` | `scripts/guard.test.mjs`、`scripts/deploy-on-merge.test.mjs`、`scripts/budget.test.mjs`、`scripts/end-run.test.mjs`、`scripts/reread.test.mjs` |
  | `src/skills/prove-it/scripts/tier.mjs` | `scripts/tier.test.mjs` |
  | `scripts/check-*.mjs`、`scripts/lib.mjs` | `scripts/checks.test.mjs` |

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
node --test --experimental-test-coverage --test-reporter=lcov --test-reporter-destination=<lcov 檔> scripts/checks.test.mjs scripts/guard.test.mjs scripts/deploy-on-merge.test.mjs scripts/frontier.test.mjs scripts/mutate.test.mjs scripts/acceptance.test.mjs scripts/overlap.test.mjs scripts/review-guide.test.mjs scripts/ci.test.mjs scripts/reread.test.mjs scripts/budget.test.mjs scripts/spawns.test.mjs scripts/deadline.test.mjs scripts/brief.test.mjs scripts/freeze.test.mjs scripts/end-run.test.mjs scripts/tier.test.mjs
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
.github/workflows/
.claude-plugin/
src/skills/get-to-work/scripts/
src/skills/prove-it/scripts/
skills/get-to-work/scripts/
skills/prove-it/scripts/
scripts/check-structure.mjs
scripts/check-vendored.mjs
```

`hooks/` 是需要確認的動作的 PreToolUse guard；`.github/workflows/` 是 CI；`.claude-plugin/` 是 plugin 的 manifest；
兩支 skill 的 `scripts/` 是 skill 在使用者 repo 裡執行的腳本；兩支 `check-*.mjs` 是 CI 的檢查本身。

來源：`AGENTS.md`「結構」、`hooks/hooks.json`、`.github/workflows/check.yml`、`.claude-plugin/plugin.json`。
