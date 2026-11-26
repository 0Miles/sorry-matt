# get-to-work：紅燈處置

本檔是一條線轉紅時的處置：tick 發下 `red-light` 的 `judge` 時全文讀取，一次做一輪。轉紅的線不派新票、整併佇列
暫停，到綠燈或撤回為止，這部分由 tick 守；在途的票照常實作、審查與修正。下面的紅燈修正與撤回不排隊。

1. **最早的紅 SHA**：由 `scripts/ci.mjs earliest-red` 算，不自己沿 log 推。計畫檔
   `sorry-matt/runs/<run>/ci/<line-slug>.plan.json` 的欄位在腳本檔頭：`local` 照抄 `state.mjs resume` 輸出裡這條線的
   `local` 行，`tickets` 的 `merges` 取 state 記的 merge SHA；本機驗證的線 `ci` 填 `false`。本機驗證的線只在收官
   驗證，所以紅只出現在收官：tick 發下 `red-light` 之前，已從線上最舊的整併 SHA 起逐一本機驗證到第一個紅的，
   `judge` 寫出這個最早的紅 SHA；照抄的 `local` 含這些紀錄，`earliestRed` 就是它。`earliestRed` 是
   `null` 時這次不對票：流水線中下一次喚醒再讀；收官（[`FINISH.md`](FINISH.md) 步驟 3）當場再跑一次，仍是
   `null` 就當作**對不到票**，照第 3–6 點走。`truncated` 是 `true` 時腳本已把範圍延伸到 `lowerBound`，不自己補判、
   不手動重查。
2. **對到票**：輸出的 `tickets` 由舊到新，從最早的開始，就是第一張（對票規則在 `scripts/review-guide.mjs` 檔頭）。
   `unmatched` 是 `true` —— 紅燈來自主持人 commit、精簡或併入基底，或線上沒有綠而基底在 merge-base 本來就紅
   （`baseCi.verdict` 是 `red`）—— 就**對不到票**。
3. **失敗輸出**：有 CI 的線以 `gh run view <id> --log-failed` 存檔，`<id>` 是同一份輸出裡 `earliestRed` 那筆
   `failed` 的每個 id，`baseCi` 是紅時另存它 `failed` 的每個 id；本機驗證的紅取 `verify.mjs` 輸出的 `log`。
   主持人只取失敗那幾行。
4. **修，最多兩輪**：
   - 對到票：`integrate.mjs ci-init` 從整合分支切 `<ticket 分支>-ci` 與 worktree，交回那張票的原 agent；不在了就照
     `IMPLEMENTER.md` 以 `brief.mjs` 的角色字 `ci-fix` 新 spawn（agent 類型與退回通用 agent 照 `SKILL.md` 第 1 節的
     spawn），票面附上失敗摘要。`brief.mjs implement` 的值檔每個鍵都要填，來源如下：
     - `out`：派工檔的路徑，放在 run 目錄裡（例如 `sorry-matt/runs/<run>/tick/brief/<ticket key>-ci-<輪次>.md`）
     - `role`：`ci-fix`
     - `snapshot`：該票的驗收快照 `sorry-matt/runs/<run>/acceptance/<ticket key>.json`
     - `worktree`、`branch`：`ci-init` 切出的 `<ticket 分支>-ci` worktree 的絕對路徑與該分支
     - `integration`：該票所在線的整合分支（`integrate: direct` 時是基底分支）
     - `bodyFile`：票面全文接上失敗摘要的檔
     - `sendBackFile`：`null`
     - `acceptance`：快照的 `items` 有驗收項就是 `criteria`；`expand: skip` 而快照沒有驗收項才是 `ticket-text`（與 tick
       給實作 agent 的取法相同）

     CI 失敗就是 finding，走集中修正（`recheck` 附上該票上一次的審查區塊），修完 `integrate.mjs merge --ci --push`，
     不排隊。
   - 對不到票：主持人不自己修，也不自己派。把第 3 點取的失敗行寫進這個 judge 的 `meta.failure` 指的檔，record
     `unmatched`（那個檔不在或是空的，record 會被拒）。tick 接著發這條線的 ci-fix：在整合 worktree 跑
     `deadline.mjs record`（時限 `timeout-fix`）、以 `state.mjs assign --line` 把派送紀錄記在線上
     （`lines[<line>].assignment`），再發一個背景的通用 agent spawn，description 是角色字 `ci-fix` 接整合分支，交付說明
     由 tick 寫好（整合 worktree、紅的 SHA、失敗的行、輪次；commit 的 subject 不帶票 ID、不 push）。照 spawn 發出，
     以 `--agent` record。它在途期間這條線沒有紅燈處置、push 與讀 CI，收官也等它；它回報時 tick 發 `collect`
     （`fixed`／`blocked`）。有新 commit 就由 tick push 並讀 CI；沒有新 commit，tick 在同一個 SHA 再發一次
     `red-light` judge 開下一輪。兩輪用完時 judge 不再有 `unmatched`，照第 6 點。
   - 修正 agent 的派送照常有派送紀錄與時限；超時被停下也算一輪（[`TIMEOUTS.md`](TIMEOUTS.md)）。偶發紅燈的硬護欄
     照用。對到票時每輪修完都 push（沒有 `origin` 時略過），record `handled`；對不到票由 tick push。結果由下一次驗證判：
     流水線中是 tick 下一次的讀 CI（CI 沒有判定時是本機驗證），收官是 `FINISH.md` 步驟 3 當場再驗。
5. **兩輪仍紅，對到票：撤回。** 依 frontier 的 `blockedBy` 列出依賴它的同線票，跑
   `integrate.mjs revert <state> <票> --worktree <整合 worktree> --reason <CI 紅燈與失敗的 job> --push`，每張依賴票加一個
   `--dependent`（Local Markdown 附票檔）。它撤回每個 merge 與完成紀錄、標卡住、處置依賴票（已整併的標卡住並寫明
   上游撤回；在途的標待裁決並留住分支尖端），檔頭寫了每一步。GitHub 另照 [`SEND-BACK.md`](SEND-BACK.md) 的
   「標卡住」開 raw issue。總 PR 把它們列為缺口，不寫 `Closes`。日後要重新整併被撤回的票，先
   `git revert <撤回的 commit>` 還原撤回。record `reverted`。
6. **兩輪仍紅，對不到票**（judge 已沒有 `unmatched`）：這條線**驗證未過**，record `failed`：tick 把它的候選與沒派過的票標待裁決、佇列不再
   為紅燈暫停。不送 `gh pr merge`、不進 merge queue，總 PR 寫明並留給人合併，人工作業清單列出失敗的 job。

## `integrate: ticket-pr` 的處置

`integrate: ticket-pr`（#197）下沒有整合分支，紅燈分兩種，上面的逐點流程不適用：

- **PR 的 CI 紅**（`awaiting-ci` 讀到 `red`）：這個紅只屬於這張票，不跑 `ci.mjs earliest-red`、不找最早的紅
  SHA。tick 先以 `gh run view <id> --log-failed` 存下失敗輸出（`<id>` 取 verdict 輸出的 `failed`），再發
  `pr-red` judge。record `fix`：CI 失敗就是 finding，走集中修正——交回那張票的原 agent（在了就 SendMessage，
  不在就照常重 spawn），指著存下的失敗輸出而不是審查 findings，受票的修正輪上限與 `timeout-fix` 時限約束。
  修完的 commit 由 tick 以 `integrate.mjs pr-push` 推回同一支 PR，票回到 `awaiting-ci`，在新推出的 head 重讀
  verdict。修正輪用完仍紅就 record stuck 或 awaiting-ruling。
- **合併後基底紅**（任一張票的 merge 已記錄後，tick 每次喚醒以 `ci.mjs base` 讀基底，讀到 `red`）：對票照
  裁決 1——`earliest-red` 掃基底本身（計畫檔的 `line` 是基底分支，下界是最舊已記錄 merge 的 parent），在
  第一個綠到最早的紅之間，以合併順序與合併 SHA 對出造成紅的票，從最早的開始。tick 發 `integrate.mjs revert`：
  在 `<ticket 分支>-revert` 分支上逐一 revert（最新的先）、push 該分支並開一支指向基底的 revert PR，**不直接
  推基底**；票標卡住，依賴它的票（`stackParent` 與 `waitingOn`，遞移）以 `--dependent` 交給同一個指令，照
  既有「上游撤回」規則處理。revert PR 照裁決 2 不審查——內容是機械 revert——但要等它自己的 CI 綠，合併同樣
  是確認呼叫：有合併授權就送 `gh pr merge <PR>`（不 `--admin`、不 auto-merge），沒有就 record left-for-human
  進人工作業清單。之後 tick 每次喚醒重讀基底，綠了這輪紅燈才結束；期間不開新的 push phase，收官也等它。
  對不到票時（範圍內沒有本 run 的 merge）由主持人裁決，record settled。

完成判準：撤回都經 `integrate.mjs revert`，依賴票都列為 `--dependent`；驗證未過的線在人工作業清單列出失敗的
job；每輪的結果都已 record。
