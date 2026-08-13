---
name: ask-miles
description: 在 sorry-matt skills 之間做路由，依目前情境指出最合適的下一個 skill
disable-model-invocation: true
---

# ask-miles：現在該用哪個？

依目前階段選一條路徑：

- **想釐清需求計畫或決策，但懶得親自回答問題** → `/grill-them`。讓兩個 subagent 對打，
  只接收結論與待裁決事項；不進入實作。
- **要開始新任務，或剛完成 grill-me／grill-with-docs，還沒有 spec 或 tickets** →
  `/take-this`。承接既有 grilling；沒有時才執行 grill-them，再完成 to-spec → to-tickets。
- **Tickets 已備妥，現在要完成它們** → `/get-to-work`。依 tracker 設定逐輪實作與驗收，
  交付 GitHub PR 或 Local Markdown 整合分支，直到初始票集完成或明確卡住。
- **想把既有 grilling、規劃到實作整段交出去** → `/have-it-all-done`。通過評估閘門後自主跑完
  take-this → get-to-work；不建議在大範圍改、需求模糊或缺乏可靠驗收時使用，會浪費一堆 token 生出垃圾的。
- **Tracker tickets 與本地工作散在各處，想先理出順序** → `/issue-chain`。依 configured
  tracker 整理成線性工作鏈並指出唯一下一步；全程只讀。
- **有人送來 GitHub PR 要審查** → `/review-pr <PR>`，自動審查 PR 包含的改動，並在 Github 留言建議與要求修改。

若情境是 triage、bug 診斷、wayfinder 或 prototype，改用 `/ask-matt`；它是 matt skills
的 router。
