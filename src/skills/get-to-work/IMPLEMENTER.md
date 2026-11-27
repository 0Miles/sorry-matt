# IMPLEMENTER：實作 agent 的派工內容

`scripts/brief.mjs` 填好 `{…}` 佔位，把分隔線以下的值寫成派工檔；主持人以 `sorry-matt:implementer` 派實作 agent，
prompt 只叫它讀這份檔。實作 agent 的固定規則在 plugin 的 agent 定義檔本文：本 skill base directory 往上兩層的
`../../agents/implementer.md`（原稿 `src/agents/implementer.md`）。定義檔本文加上本檔的值涵蓋全部規則；本檔只放值，
不寫規則。這個 agent 類型不在可用清單時，`brief.mjs` 另寫的通用 agent 派工檔是定義檔 frontmatter 以下的本文接上
本檔的值。

本檔的佔位與 `brief.mjs` 的填值要一起改。驗收來源是二選一的佔位：`brief.mjs` 依值檔的 `acceptance`
（`criteria` 或 `ticket-text`）取 `=` 後的文字，profile 為 `expand: skip` 而驗收快照沒有驗收項時 tick 給 `ticket-text`（快照有驗收項就給 `criteria`）；它的兩段文字與
定義檔第 1 節第 3 條要一起改。定義檔的規則與 `ASKING.md` 第 3、5 節、第 7 節的回報上限、
`have-it-all-done` 第 0 節重疊處要一起改；定義檔第 2 節的 commit message 格式與 [`FINISH.md`](FINISH.md) 收官的
總 PR body、`integrate.mjs pr-open` 寫的票級 PR body 要一起改；定義檔第 1 節的驗收只讀與 `SKILL.md` 派票的驗收快照、展開 agent 定義檔的展開區塊格式、
`prove-it` 第 1 節的驗收比對要一起改；定義檔第 1 節待裁決回報要寫的建議與 `ASKING.md` 第 4 節的代答裁定、
`tick.mjs` 的 `ruled` 要一起改；本檔的退回紀錄佔位、定義檔第 1 節的重做規則和
[`SEND-BACK.md`](SEND-BACK.md) 的退回重做要一起改。定義檔第 1、2 節改寫自 `mattpocock/skills` 的 `implement` 與
`tdd`（MIT，出處與授權見 [`../take-this/references/upstream/NOTICE.md`](../take-this/references/upstream/NOTICE.md)）。

---

派工內容：這張票的值。你要遵守的規則在實作 agent 定義檔的本文。

- 票：{tracker 原生識別碼}（tracker：{GitHub 或 Local Markdown}）
- ticket worktree：{絕對路徑}（分支 {ticket 分支}）
- 整合分支：{整合分支}
- 票面全文：{票面全文}
- 展開區塊：{驗收快照 `expansions[].text` 的全文，沒有寫 none}
- 驗收來源：{criteria=驗收項與展開區塊 | ticket-text=票面文字就是驗收}
- 專案指令契約：{ticket worktree 裡 `docs/agents/commands.md` 的絕對路徑，沒有寫 none}
- 退回紀錄：{上次嘗試的 ref 與 SHA、衝突的檔案、當時的整合分支 SHA、舊嘗試動到而預計檔案沒涵蓋的檔，
  沒有寫 none}
