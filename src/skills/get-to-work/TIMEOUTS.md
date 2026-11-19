# get-to-work：超時 agent 的處置

本檔是時限掃描的後半：tick 發下 `timeout` 的 `judge` 時全文讀取。掃描（`deadline.mjs scan`）與延長由 tick 做；
來到這裡的 agent 都是要停下的 —— 沒有進展、已延長過，或進度指紋算不出來（`judge` 寫了 `error`）。

1. **停下**：`TaskStop` 這個 agent。它若剛好已經結束，record `collected`，它的回報照常收。
2. **依情況了結**，先符合的為準，record 括號裡的 outcome：
   - **進度指紋算不出來**（`error`）：worktree 的狀態要人處理，不改派，也不在同一個 worktree 再派送 —— 那裡算不出
     派送紀錄，沒有派送紀錄的派送不成立。實作中、修正中 → `awaiting-ruling`，原因寫那個 `error`；整併中 → 先照下面
     「整併中」還原整合 worktree，再 `awaiting-ruling`；紅燈修正 → 算一輪修正失敗，不開下一輪：對到票就照
     [`RED-LIGHT.md`](RED-LIGHT.md) 第 5 點撤回，對不到票就先 `git -C <整合 worktree> reset --hard <派送紀錄的 HEAD>`，
     再照第 6 點判驗證未過。
   - **原因要人裁** —— 該票接續紀錄的「阻擋」寫了要人做的決定、缺的權限或查不到的事實 → `awaiting-ruling`，寫出
     原因。
   - **整併中**：`git -C <整合 worktree> rev-parse -q --verify MERGE_HEAD` 有輸出就 `merge --abort`，沒有（整併 agent
     已 commit）就 `reset --hard <派送紀錄的 HEAD>`。整併 agent 不 push，還原只動本機。該票照
     [`SEND-BACK.md`](SEND-BACK.md) 退回重做（`send-back`）。
   - **紅燈修正**（`RED-LIGHT.md` 第 4 點）：算一輪修正失敗，不計改派。還在第一輪就開第二輪 —— 對到票時照
     `IMPLEMENTER.md` 新 spawn 一個 `ci-fix` agent 接手同一個 worktree，票面附上失敗摘要與超時說明；對不到票時先
     `reset --hard <派送紀錄的 HEAD>` 再修。已是第二輪就照第 5、6 點撤回或判驗證未過；不標卡住。
   - **這個階段還沒因超時改派過**（`judge` 會寫明）→ `reassign`：tick 發下新的派送紀錄與 spawn，接手同一個
     worktree 與分支，交付說明附上一個 agent 超時被停下、它留下的 commit 與改動由新 agent 判斷要不要沿用。
   - **這個階段已改派過** → 實作中、修正中標卡住（`stuck`，照 `SEND-BACK.md`，原因寫兩次超時）；展開中
     `awaiting-ruling`。
3. **留紀錄**：在該票接續紀錄寫一段時限處置 —— agent id、階段、派送與到期時間、派送時與現在的進度指紋、處置 ——
   並在 run 層自答清單記一列（`ASKING.md` 第 3 節的五欄）。

完成判準：每個超時的 agent 都已 `TaskStop` 並照上面了結；整併 agent 停下後整合 worktree 已還原到派送時的 HEAD；
每個處置都寫進該票接續紀錄與自答清單。
