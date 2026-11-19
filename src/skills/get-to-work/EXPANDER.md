# EXPANDER：展開 agent 的派工內容

`scripts/brief.mjs` 在派票點填好 `{…}` 佔位，把分隔線以下的值寫成派工檔；主持人以 `sorry-matt:expander` 派展開
agent，prompt 只叫它讀這份檔。展開 agent 的固定規則、模型與可用工具在 plugin 的 agent 定義檔：本 skill base
directory 往上兩層的 `../../agents/expander.md`（原稿 `src/agents/expander.md`）。定義檔本文加上本檔的值涵蓋全部
規則；本檔只放值，不寫規則。這個 agent 類型不在可用清單時，`brief.mjs` 另寫的通用 agent 派工檔是定義檔
frontmatter 以下的本文接上本檔的值。

本檔的佔位與 `brief.mjs` 的填值要一起改。定義檔的規則用到的工具變了，它的 `tools:` 跟著改。定義檔的代答規則與
實作 agent 定義檔第 3 節、`ASKING.md` 第 3 節重疊處要一起改；展開區塊的格式與 `scripts/acceptance.mjs` 檔頭、
實作 agent 定義檔第 1 節、`prove-it` 第 1 節要一起改；驗收項的寫法與
[`../take-this/TEMPLATES.md`](../take-this/TEMPLATES.md) 的票模板要一起改。

---

派工內容：這次展開的值。你要遵守的規則在展開 agent 定義檔的本文。

- run：{run 名稱}；派票點：{第幾個派票點，寫進區塊的 `round`}
- tracker：{GitHub（owner/repo）或 Local Markdown}
- 整合 worktree：{每條線的整合分支與絕對路徑}
- spec：{識別碼或路徑，沒有寫 none}
- 待展開的票：{每張票的識別碼、所屬線與票面全文}
