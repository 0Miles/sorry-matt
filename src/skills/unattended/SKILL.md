---
name: unattended
description: 手動切換 sorry-matt guard 的無人值守模式：on 開、off 關、status 顯示狀態，不帶參數時切換
disable-model-invocation: true
---

# unattended：手動切換無人值守

切換不是你做的。使用者輸入 `/sorry-matt:unattended [on|off|status]` 時，plugin 的 `UserPromptExpansion` hook 已經在
展開這個指令前執行完，結果以附加的 context 交給你。你只轉述它。

1. 在 context 裡找以 `[sorry-matt unattended]` 開頭的 hook 結果。找到就照實轉述給使用者：做了什麼、沒做什麼與原因、
   哪些來源仍開著、要使用者自己做的事（例如從 settings 的 `env` 拿掉 `SORRY_MATT_UNATTENDED`，或在終端機執行
   `rm ~/.claude/sorry-matt-unattended`）。結果附了擋下清單時，逐筆完整列出（session、時間、原指令、理由），由使用者
   決定要不要執行；不要自己重跑清單上的動作。
2. 結果說這一輪的紀錄還沒寫入、要等這一輪結束再判定時，照實說。這一輪結束時 hook 會把判定結果交回來，再照第 1 步轉述。
3. context 裡沒有 `[sorry-matt unattended]` 開頭的 hook 結果時，告訴使用者切換沒有執行：plugin 的 hook 沒有載入，或
   guard 被 `SORRY_MATT_GUARD=off` 關掉了。再給出開關檔的指令，請使用者自己在終端機執行：

   ```bash
   touch ~/.claude/sorry-matt-unattended   # 開啟
   rm ~/.claude/sorry-matt-unattended      # 關閉
   ```

不論哪種情況，都不要自己建立、刪除、改寫或搬移開關檔 `~/.claude/sorry-matt-unattended` 與自動進入的狀態檔
`~/.claude/sorry-matt-guard/unattended.json`，也不要改 settings：無人值守只由使用者切換。

完成判準：使用者知道這次切換的結果 —— 有 hook 結果時是它的照實轉述（含完整的擋下清單），沒有時是「切換沒有執行」、
原因與 `touch`／`rm` 指令；你沒有建立、刪除或改寫任何檔。
