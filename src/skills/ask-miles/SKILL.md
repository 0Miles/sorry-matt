---
name: ask-miles
description: 路由 sorry-matt skills，依目前情境指出唯一、可直接執行的下一個 skill
disable-model-invocation: true
---

# ask-miles：現在該用哪個？

輸出一條路由建議：把目前情境對應到下列一個分支；分支中的 invocation 是請使用者執行的下一步。

- **想釐清需求計畫或決策，但懶得親自回答問題** → `/grill-them`。讓兩個 subagent 對打，
  輸出限於結論與待裁決事項，停在規劃階段。
- **要開始新任務，或剛完成 grill-me／grill-with-docs，還沒有 spec 或 tickets** →
  `/take-this`。承接既有 grilling；沒有時才執行 grill-them，再完成 to-spec → to-tickets。
- **Tickets 已備妥，現在要完成它們** → `/get-to-work`。依 tracker 設定逐輪實作與驗收，
  交付 GitHub PR 或 Local Markdown 整合分支，直到初始票集完成或明確卡住。
- **想把既有 grilling、規劃到實作整段交出去，且範圍可控、需求足以收斂並有可靠驗收** →
  `/have-it-all-done`。通過評估閘門後自主跑完 take-this → get-to-work。
- **Tracker tickets 與本地工作散在各處，想先理出順序** → `/issue-chain`。依 configured
  tracker 整理成線性工作鏈並指出唯一下一步；全程只讀。
- **有人送來 GitHub PR 要審查** → `/review-pr <PR>`。審查 PR 包含的改動，並在 GitHub 發布
  建議與修改要求。
- **當 Agent 不講人話時** → `/speak-human`。保留事實、條件、責任與不確定程度，
  改成目標語言與地區中自然、常用的說法。
- **當 Agent 講太多廢話、抓不到重點時** → `/no-bullshit`。
- **工作已合併，想安全收掉本地分支與多餘 worktrees** → `/clean-it-up`。只刪除有合併證據且
  狀態乾淨的項目；遠端分支必須另外明確授權。
- **情境是 triage、bug 診斷、wayfinder 或 prototype** → `/ask-matt`；它是 matt skills 的 router。

完成判準：只推薦一個最符合情境的 skill，說明命中的分支，並提供可直接複製的 invocation。
資訊不足以唯一判定時，先指出並請使用者補齊唯一的最小缺口；取得裁決後再輸出單一路由。
