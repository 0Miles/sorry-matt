# sorry-matt

sorry-matt 是一組 skills 與腳本，讓 agent 把 tracker 上的票做完：開局、展開、實作、審查、整併、收官。本檔只收這個流水線特有的詞；詞的英文對照見 `AGENTS.md` 的詞彙對照表。

## 審查

**審查分級**：
依一張票的改動風險判出的等級，分 light、standard、full 三級。
_Avoid_：審查層級、審查等級、tier（在中文散文裡）

**敏感路徑**：
改動一碰到，審查分級就判為 full 的路徑。範圍是權限邊界、CI、plugin manifest 與 state 格式。
_Avoid_：重要路徑、高風險檔案

**審查方式**：
一張票實際接受的審查，是 minimal 審查或 prove-it 審查之一。由流程設定的 `review` 與審查分級一起決定。
_Avoid_：審查模式

**minimal 審查**：
由單一審查 agent 讀 diff、把結果寫進報告檔的審查。不派 finder，也不做突變。
_Avoid_：輕量審查、light 審查

**prove-it 審查**：
走 Finder → Verifier → Fix Verifier 證據鏈的審查，含實跑與突變。
_Avoid_：完整審查、full 審查（full 是審查分級的值，不是審查方式）

## 收官

**精簡**：
收官時對一條線累積的改動做的一次品質收斂：復用、簡化、拿掉多餘的間接層。
_Avoid_：simplify 階段、重構

**跳過精簡**：
精簡 agent 看過改動後判斷不需要精簡、沒有呼叫 `simplify`。和「看過但沒有修法」是兩回事。
_Avoid_：精簡無修法
