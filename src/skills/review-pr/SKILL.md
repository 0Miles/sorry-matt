---
name: review-pr
description: 審查 GitHub PR，並把有證據、可直接套用的意見發布到 PR。使用者要求 review 一個 PR，或在作者修正後要求複審時使用。
disable-model-invocation: true
---

# Review PR：發布有證據、可直接套用的審查意見

沿著一條**證據鏈**完成審查：Finder 找候選，Verifier 獨立裁決 finding 是否成立，Fix Verifier
獨立裁決修法是否正確，最後才把存活的發現寫回 PR。候選不是留言，未經反駁的修法也不是。

除了只能重產的機器產物，每則行內留言都包含**錨定的新檔行數範圍**、**簡短說明**與可直接
套用的 `suggestion` 區塊；所有行內留言集結成一筆 review。審查文字沿用 repo 既有的語言與
locale 慣例。

作者已依前一輪 review 修正、要求再看一次時，這是**複審**：證據鏈相同，但候選來源、body
結構與收尾條件都不同。開工前完整讀取 [FOLLOW-UP.md](FOLLOW-UP.md) 並照做，它逐項標明要
覆寫哪幾個步驟。

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

每個 lens 交給一個獨立的 finder subagent，並在同一則訊息中一次派出。
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

每個去重後的候選各交給一個獨立的 verifier subagent，並行派出。

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

單一 verifier 讀錯 ref 或讀錯分支就會給出整則錯誤的裁決。裁決引用的 `file:line` 與
`pr-<n>` 對不上時，換一個 verifier 重驗該候選。

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

完成 review body 與每則行內留言說明的事實稿後，呼叫 Skill tool 帶入 `no-bullshit`，把稿子砍到
只剩重點；語言仍沿用本 skill 開頭訂的 repo 慣例。改寫範圍只包含給人看的散文；`suggestion`
區塊、程式碼、指令與其他必須逐字保留的內容不在範圍內。

砍完逐項核對這六項**不可流失**：技術事實、`file:line` 證據、不確定程度、blocking 程度、
義務強度、責任歸屬。少了就補回去，補完再砍一次。

- Suggestion 必須包含套用後該範圍的完整內容；未修改的行與縮排逐字保留。
- 範圍切在能自成一體的邊界，例如完整函式、整條 CSS 規則或完整 HTML 元素。
- 行內留言的說明控制在三到五句，依序交代**症狀 → 根因（附 `file:line`）→
  修改必要性**。這是資訊順序，不是要輸出的標題或固定句型；修正程式碼只放在 suggestion 區塊。
- 跨檔案修正拆成可各自套用的留言並互相指涉；某則 suggestion 會讓其他行失效時，在文字中
  點名該行。
- Lockfile 與建置產出等機器產物以重產指令取代 suggestion。

完成判準：review body 與每則行內留言說明都已經過 `no-bullshit`，且上述六項不可流失零遺失、
零新增；每個 suggestion 都已與
`git show pr-<n>:<path> | sed -n '<start>,<end>p'` 並排比對；除預定修改的行外，其餘內容
逐字相同；套用後檔案語法有效；每項跨檔案修正都有對應並互相指涉的留言。

## 6. Fix Verifier：對修法反駁

Finding 經過反駁才成為留言，修法也一樣。這一步把同一套反駁優先用在 suggestion 上。

每則 suggestion 各交給一個獨立的 subagent，並行派出。prompt 自足，包含 repo 絕對路徑、
`pr-<n>` ref、finding 的 `failure_scenario`、suggestion 的完整內容與行數範圍。省略撰寫者
的理由，避免錨定偏誤。

先嘗試反駁這個修法，四題逐一作答並附 `file:line`：

1. finding 列舉的每一個失效窗口，這個修法都關上了嗎？
2. 它有沒有開出新的窗口？
3. 這則修法可證偽嗎？說出套用前後可觀察的差異：輸出、錯誤、時序或型別。說不出來的是風格
   偏好，撤掉——正是這種修法會在下一輪被反向再提一次。
4. 套用後其他呼叫端會不會壞？

裁決兩種：**通過**，或**修法不成立**——撤掉 suggestion，存在正確修法時一併指出，否則
finding 降級進 body 當觀察。

### 同輪衝突

每個 fix verifier 只看得到自己那一則，看不到彼此。裁決全數回來後，主持人在實跑前把本輪
存活的 suggestion 兩兩比對，三種衝突各有處置：

- **範圍相交**：同一檔案的 `start_line..line` 有重疊。GitHub 逐則獨立套用，相交的兩則不論
  作者按哪個順序都會產生錯的內容——合併成一則，或只留一則、另一則改為純文字說明。
- **修法相斥**：兩則對同一個 symbol、契約或不變式給出不相容的結論。只留證據較強的一則，
  另一則撤掉或降級進 body。
- **有依存**：A 套用後，B 的錨定行、前提或必要性才失效，例如 A 移除了 B 那行的最後一個
  使用者。B 的範圍改以套用 A 後的內容為準，並在 B 的留言中點名 A；無法解耦時合併成一則。

存活的 suggestion 必須能一起套用，實跑才成立。

### 實跑

專案定義了 test、typecheck、lint 或 format script 時，全部都要跑，而且跑兩次：套用本輪
全部 suggestion 之前一次，之後一次。前一次界定既有的紅燈，後一次才能歸因。

在 detached worktree 裡跑，依賴沿用既有安裝，使用者的檢出保持原狀：

```bash
git -C <repo> worktree add --detach <scratchpad>/verify pr-<n>
```

套用後轉紅的 suggestion 撤掉或改到全綠為止。

### 突變

專案有測試時，對每則 finding 指涉的那幾行做刪除或條件反轉，跑測試：

- 仍然全綠 → 作者的測試沒有**釘住**這則 finding。這是 finding 的補強證據，留言一併要求
  補測試。新增的測試行數不是覆蓋率的證據，突變才是。
- 轉紅 → 已被釘住，據實寫進 body。

套用 suggestion 後再突變一次，回答「這輪修的東西鎖上了沒有」。

完成判準：每則 suggestion 都有一項 fix verifier 裁決與 `file:line` 證據；本輪存活的
suggestion 兩兩比對過，沒有範圍相交，相斥者只留一則，有依存者已點名並以套用後內容為準；
所有存在的 script 都在套用前後各跑過一次，且套用後全綠；每則 finding 都有突變結果；判為
不成立或套用後轉紅的 suggestion 都已撤掉或改正。

## 7. 送出前對帳

兩道機械檢查，在產生 payload 之前完成。

**自我一致性。** 把本輪每則 suggestion 與前幾輪已送出的全部 suggestion 及其推翻紀錄比對
（同輪之間的衝突在步驟 6 已處理），凡碰到同一個 symbol 或同一段區塊，三選一：

- **延伸** → 照常送出。
- **推翻**（移動、反轉或取代前輪的修法）→ 只有在本輪 incoming diff 動過該處，或握有前輪
  不存在的新證據時才成立。留言中明說前輪那則給錯了並附上那份新證據，body 統計本輪推翻
  自己的則數。拿不出新證據就不是推翻，是**來回**。
- **來回**（回到更早輪已經放棄過的修法）→ 一律撤掉，不得再送。同一處在多輪之間來回，
  證明的是每一輪的證據都撐不起任何一種寫法；把這個不確定性寫進 body 交給作者判斷，
  不再附 suggestion。

判定吃 fix verifier 的裁決與前幾輪的送出紀錄，不是自評。

**誠實性。** 逐項核對：

- body 宣稱的 finding 則數與 `comments` 陣列長度一致。
- body 非 blocking 段落的每一句描述都有 verifier 或 fix verifier 的具名證據背書；只有
  finder 原話支撐的敘述刪掉，或降級為待查。

完成判準：每則與歷史重疊的 suggestion 都已標為延伸、推翻或來回；每則推翻都附有前輪不存在
的新證據，並在留言與 body 中明說；每則來回都已撤掉，且其不確定性已寫進 body；body 的數字
與 `comments` 陣列一致；非 blocking 段落每句都有具名證據。

## 8. 送出 review 並驗證錨定

建立一個 Python 檔來產生 payload JSON，讓 Python 編碼 suggestion 中的反引號、反斜線與
引號，避免 shell heredoc 損壞內容。

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
