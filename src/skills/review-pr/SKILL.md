---
name: review-pr
description: 審查 GitHub PR，並把有證據、可直接套用的意見發布到 PR。當使用者要求 review PR、將審查結果寫回 PR，或在修正後複審時使用。
disable-model-invocation: true
---

# Review PR：發布有證據、可直接套用的審查意見

沿著一條**證據鏈**完成審查：Finder 找候選，Verifier 獨立裁決，嚴重度決定發布位置，
最後才把存活的發現寫回 PR。候選本身不是留言。

除了只能重產的機器產物，每則行內留言都包含**錨定的新檔行數範圍**、**簡短說明**與可直接
套用的 `suggestion` 區塊；所有行內留言集結成一筆 review。審查文字沿用 repo 既有的語言與
locale 慣例。

## 1. 取得 PR 與可定位的原始碼

```bash
gh pr view <n> --repo <owner>/<repo> --json number,title,body,baseRefName,headRefName,files,url
gh pr diff <n> --repo <owner>/<repo> > <scratchpad>/pr<n>.diff
git -C <repo> fetch origin pull/<n>/head:pr-<n> --force
```

以 `gh pr diff` 判斷「改了什麼」及「變更是否屬於本 PR」。變更歸屬不採用
`git diff <本地-base>...pr-<n>`，因為過期的 base 或 rebase 可能混入其他人的變更。

新檔行號與 suggestion 內容一律取自 `git show pr-<n>:<path>`；從 diff 複製可能夾帶
行號位移或行首標記。

完成判準：所有變更檔都能透過 `git show pr-<n>:<path> | cat -n` 讀取，且每個 hunk 都已
對應到新檔行號。

## 2. Finder：平行尋找候選

每個 lens 交給一個獨立的 general-purpose finder subagent，並在同一則訊息中一次派出。
若 diff 只有一個檔案且不超過數十行，可由一個 finder 套用全部 lens。

- **逐行**：對每個 hunk 的每一行追問，哪些輸入、狀態、時序或平台會讓它失效？特別檢查
  條件反轉、off-by-one、falsy zero、遺漏 `await`、copy-paste 錯變數與 catch 吞錯。
- **被刪除的行為**：辨識每段被刪除或改寫的程式碼原本維持的不變量，再於新程式碼中定位
  重建位置；找不到就列為候選。
- **跨檔案契約**：追蹤被改函式的呼叫端與被呼叫端，檢查新的前置條件、回傳形狀、例外或
  時序是否破壞任一端。
- **宣稱與實作**：把 PR 描述宣稱的每項變更定位到 diff，也列出 diff 中未被描述的變更。
  PR body 引用的 issue 或 repo 內 spec，只要能透過 `gh` 或 `git show` 取得，也算宣稱來源。
- **Repo 慣例**：套用所有涵蓋變更檔案的 `CLAUDE.md` 或通用 `AGENTS.md` 規則；只有能引用
  規則原文的項目才列為違規候選。

Finder 看不到目前對話，因此每份 prompt 都必須自足，並包含：

- Repo 絕對路徑、`pr-<n>` ref、diff 檔路徑，以及 PR 標題與描述。變更後原始碼固定以
  `git show pr-<n>:<path>` 讀取。
- 該 finder 的 lens 全文，以及必須向外追查的範圍：完整的新檔內容、被呼叫函式的實作、
  所有呼叫端與相關 locale、design tokens、型別定義。
- Finder 只找候選，不作裁決；尚未完全確定的項目仍可回報，交由獨立 verifier 判定。
- 回報格式：`file`、`line`（新檔行號）、一句 `summary`，以及描述使用者可見後果的
  `failure_scenario`，例如錯誤輸出、crash 或資料遺失，而非中間狀態。每個 finder 最多
  回報六則；沒有候選時回傳空清單。

完成判準：所有 finder 都已回報；同一行、同一失效機制的候選已去重，並保留
`failure_scenario` 最具體的一則；每個 hunk 都至少經過一次逐行 lens。

## 3. Verifier：逐項獨立裁決

每個去重後的候選各交給一個獨立的 general-purpose verifier subagent，並行派出。

Verifier 的 prompt 必須自足，而且只包含 repo 絕對路徑、`pr-<n>` ref、base branch、候選的
四個欄位與以下裁決規則。省略 finder 的推理，避免錨定偏誤。

先嘗試**反駁**候選：找出能推翻它的程式碼並引用。遇到不確定的技術事實，例如 API 相容性、
正則行為、CSS 串接或套件語法，使用一次性的 Node／Python 程式實跑，或查閱 caniuse 與
原始碼。反駁失敗後，再逐關檢查：

1. **Traced**：引用 verifier 實際開啟過的 `file:line` 作為證據。
2. **由本 PR 引入**：在 base branch 執行同一項檢查；只有 base 正常、PR 失效才通過。
3. **具體失效情境**：失效路徑真實可達，而且後果對使用者可見。

裁決只有三種，且都要附 `file:line` 證據：**成立**（三關全過）、**pre-existing**
（只在第二關失敗），或**不成立**。

完成判準：每個候選都有且只有一項裁決；每項裁決附有證據，並明確記錄三關各自的結果。

## 4. 依 Blocking 程度分流

**Blocking** 指問題會改變作者是否應合併或採用目前實作的決定。只有「成立且 blocking」的
候選能成為行內留言。

Review body 收錄成立但不 blocking 的結構性建議與後續工作、pre-existing 觀察，以及值得讓
作者知道的正面驗證結果。若 verifier 以充分證據反駁候選，可在 body 整理成「無需修改」的
結論；其餘不成立且沒有資訊價值的候選丟棄。

完成判準：每項裁決都恰好分派到行內留言、review body 或丟棄三者之一；每則行內留言均為
成立且 blocking。

## 5. 撰寫給人的評語與可直接套用的 suggestion

GitHub 的 `suggestion` 區塊會完整取代 `start_line..line` 範圍；作者按下 Commit suggestion
後，區塊內容就是該範圍的新狀態。

完成 review body 與每則行內留言說明的事實稿後，呼叫 Skill tool 帶入 `speak-human`。將 PR 作者設為受眾，
並傳入上述語言與 locale；語義帳本必須保留技術事實、`file:line` 證據、不確定程度、
blocking 程度、義務強度與責任歸屬。改寫範圍只包含給人看的散文；`suggestion` 區塊、
程式碼、指令與其他必須逐字保留的內容不在範圍內。

- Suggestion 必須包含套用後該範圍的完整內容；未修改的行與縮排逐字保留。
- 範圍切在能自成一體的邊界，例如完整函式、整條 CSS 規則或完整 HTML 元素。
- 行內留言的說明控制在三到五句，依序交代**症狀 → 根因（附 `file:line`）→
  修改必要性**。這是資訊順序，不是要輸出的標題或固定句型；修正程式碼只放在 suggestion 區塊。
- 跨檔案修正拆成可各自套用的留言並互相指涉。若某則 suggestion 會讓其他行失效，例如移除
  最後一個 import 使用者，也在文字中點名該行。
- Lockfile 與建置產出等機器產物以重產指令取代 suggestion。

完成判準：review body 與每則行內留言說明都已透過 `speak-human` 回帳，且上述帳目零遺失、
零新增；每個 suggestion 都已與
`git show pr-<n>:<path> | sed -n '<start>,<end>p'` 並排比對；除預定修改的行外，其餘內容
逐字相同；套用後檔案語法有效；每項跨檔案修正都有對應並互相指涉的留言。

## 6. 送出 review 並驗證錨定

使用 Write 工具建立 Python 檔來產生 payload JSON，讓 Python 編碼 suggestion 中的反引號、
反斜線與引號，避免 shell heredoc 損壞內容。

```python
payload = {
    "body": "<review body：整體評價 + 非 blocking 事項>",
    "event": "REQUEST_CHANGES",
    "comments": [
        {
            "path": "apps/foo/bar.vue",  # repo 相對路徑
            "start_line": 127,            # 新檔行號
            "line": 138,
            "side": "RIGHT",
            "start_side": "RIGHT",
            "body": "說明 + ```suggestion 區塊",
        },
    ],
}
```

單行留言省略 `start_line` 與 `start_side`。行數範圍必須落在 diff hunk 的 RIGHT 側，否則
整筆 API 請求會回傳 422。

依存活的發現選擇 `event`：有 blocking 發現時用 `REQUEST_CHANGES`；只有觀察與建議時用
`COMMENT`；完全沒有問題時用 `APPROVE`。若使用者要求 request changes，但證據不足以支持
任何 blocking 發現，改用 `COMMENT`，並在 body 說明原因。

```bash
gh api --method POST /repos/<owner>/<repo>/pulls/<n>/reviews \
  --input <scratchpad>/review.json --jq '{id, state, html_url}'
```

送出後逐則驗證錨定：

```bash
gh api /repos/<owner>/<repo>/pulls/<n>/comments \
  --jq '.[] | "\(.path):\(.start_line)-\(.line)"'
```

若 `line` 為 `null`，代表留言已 outdated，無法在 PR 頁面正常顯示；修正行號後重新送出。

最後向使用者提供 review 連結、每則發現的一句摘要，以及未在瀏覽器或執行環境中驗證的範圍。

完成判準：review 已以正確 event 送出；所有預定留言都出現在 PR 上且 `line` 非 `null`；
使用者回報涵蓋 review 連結、全部發現與所有未驗證範圍。

## 複審

複審沿用完整證據鏈，只調整候選來源與收尾：

- 步驟 1 另取回前一輪的 reviews 與 comments：
  `gh api /repos/<owner>/<repo>/pulls/<n>/reviews` 及
  `gh api /repos/<owner>/<repo>/pulls/<n>/comments`。前輪每則 blocking 留言都是必須裁決的
  候選：原問題是否已修復？修法是否引入新問題？
- 步驟 2 的 finder 聚焦增量 commits 與修法周邊；「宣稱與實作」lens 仍檢查完整的
  `gh pr diff`，以捕捉修正 commits 夾帶的未宣稱變更，例如 lockfile 或順手修改的檔案。
- 步驟 4 與步驟 6 的 body 逐項銷帳：前輪每項發現標為已修復、未修復或部分修復，並附
  驗證證據；新發現依原規則分流。
- 前輪問題全數修復且沒有新的 blocking 發現時使用 `APPROVE`；其餘情況依步驟 6 選擇 event。
  `APPROVE` 的 body 仍保留逐項驗證證據。

完成判準：前輪每項發現都有最新裁決與證據；新增變更已完整檢查；送出的 event 與現存的
blocking 狀態一致。
