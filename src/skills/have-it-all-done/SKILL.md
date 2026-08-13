---
name: have-it-all-done
description: 接手一個完整任務：只過一次風險閘門，承接既有 grilling，依序完成 take-this 與 get-to-work；沒有任務脈絡時才用 issue-chain
disable-model-invocation: true
---

# have-it-all-done：整件事交給我，完成後再通知你

引數（可選）＝任務描述，或明確指向既有 grilling 成果／文件。

一次取得實作授權，接著替使用者回答 matt skills 的確認點，
並把每個代答決定留下紀錄。授權範圍止於 GitHub PR 或 Local Markdown 整合分支。以下統稱
**人工作業**：部署、資料遷移、對外發布與最終合併。

## 1. 接棒並通過風險閘門

先讀 `docs/agents/issue-tracker.md`。檔案不存在時，請使用者執行
`/setup-matt-pocock-skills`，取得設定後再繼續。

依以下優先序界定唯一任務：

1. 有引數：採用引數描述的任務，以及引數明確帶入的 grilling 成果或文件。
2. 無引數，但目前 session 有一份明確對應同一任務的完整 `grill-me`、`grill-with-docs` 或
   `grill-them` 成果：直接接棒該任務、決策與文件。
3. 以上皆無：執行不帶引數的 `/issue-chain`；只納入鏈上可執行的環，將**待裁決**項目留待
   最終報告。

任務界定後，只開一次風險閘門。逐項判定：

- **變更範圍過大**：跨多個模組、大規模重構、資料遷移、部署或安全邊界。
- **需求過於模糊**：仍有會改變實作方向的分岔、缺少可驗證的完成判準，或無法確認該承接
  哪份 grilling 成果。
- **驗收依據薄弱**：任務又大又模糊且缺少測試防護網，或成果主要仰賴 UI／文案等主觀判斷。

已有 grilling 成果時，以其中的決策與證據判定。出現紅燈時，說明具體理由並詢問是否仍授權
自主跑完；同時提出最合適的替代方案：縮小範圍、改走 `/take-this` 讓使用者參與、先用
`/grill-me`／`/grill-with-docs`／`/grill-them` 釐清，或對大型未決任務使用 `/wayfinder`。
取得明確放行後繼續；全綠則直接前進。這次放行涵蓋後續 matt skills 確認點，但不包含
**人工作業**。

完成判準：已記錄 tracker 設定、唯一任務與 grilling 來源；三項風險各有紅綠結論；若有紅燈，
已有使用者明確放行紀錄。

## 2. 完成開局（已有 tickets 時跳過）

以本 skill 載入時標示的 base directory 為起點，讀同層的 `../take-this/SKILL.md` 並照做其
完整步驟：取得需求脈絡、完成 to-spec、再完成 to-tickets。步驟 1 若已接棒
`grill-me`、`grill-with-docs` 或 `grill-them`，將其決策、證據與文件明確交給 `take-this`，沿用
同一份需求脈絡。

以保守、可逆且符合 repository 慣例的答案處理 seam 與切票確認。從風險閘門通過後開始，
agent 替使用者回答的每個確認點，都把答案與理由逐項記入**自答清單**；使用者在既有 grilling
中親自做出的決策屬於需求依據，不列入自答清單。

完成判準：tickets 已發布到已設定的 tracker，且每個阻塞邊都已明載；`take-this` 的需求
脈絡指向步驟 1 選定的同一份 grilling 成果；風險閘門後每個 agent 代答確認點，都能在自答
清單找到答案與理由。

## 3. 清票

讀同層的 `../get-to-work/SKILL.md` 並照做，把步驟 2 建立的 tickets，或步驟 1 找到的
可執行環，以 tracker 原生識別（GitHub issue 編號／URL，或 Local Markdown 路徑）作為它的
明確引數。完整遵守它的品質閘門：
自動檢查通過後才驗收，驗收通過後才建立 GitHub PR 或更新 Local Markdown 整合分支。

完成判準：`get-to-work` 已停止；交付給它的每張票都出現在對帳表中，且明列已交付、卡住
或待裁決結果及其證據。

## 4. 交棒

最終報告逐項列出：

- 任務範圍、採用的 grilling 來源，以及三項風險判定。
- 完整的**自答清單**；若沒有自答，明記「無」。
- 每條線的交付：GitHub 總 PR，或 Local Markdown 整合分支與 tip SHA；另附完整對帳表。
- 期間開票產生的 raw tickets、`/triage` 建議，以及所有待裁決項目。

完成判準：四類資訊齊備；每條線都有可追溯的交付物與驗收證據，足以讓未參與過程的人決定
是否合併總 PR 或本地整合分支；所有**人工作業**均仍待人執行。
