---
name: set-up-ui-skills
description: 為前端專案建立 docs/agents/ui.md（元件庫、tokens、共用元件、慣例、機械檢查），並在指示檔的 Agent skills 區塊加 UI 小節；前端 skills 開工前先跑一次
disable-model-invocation: true
---

# Set up UI skills：建立前端 skills 讀的元件地圖

為前端 skills 建立專案參數 `docs/agents/ui.md`：專案採用的**元件庫**（可以是「無」）、tokens、
**共用元件**、慣例與機械檢查；並在專案**指示檔**（`CLAUDE.md` 或 `AGENTS.md`）的
`## Agent skills` 區塊加一個 `### UI` 小節指向它。

`ui.md` 是地圖不是 API，照 [`UI-TEMPLATE.md`](UI-TEMPLATE.md) 的**只記地圖，不抄 props**規則寫。

流程五步：探查 → 一次提出發現與問題 → 確認草稿 → 寫入 → 回報。只有第 2、3 步等使用者。

## 1. 探查

不預設任何事：每一項都從 repo 讀出來，讀不到就記「沒有」。monorepo 時對每個前端 package 各查一次。

- **依賴與版本**：`package.json` 的 dependencies 與 devDependencies，以及 lockfile 實際解析的版本。
  從中找出**元件庫**，即提供現成元件的套件（含 headless 元件，如 MUI、Ant Design、Radix、
  Headless UI、Vuetify、Master UI）；只提供 utility class 或 icon 的套件不算，記進 tokens 或慣例的發現。
- **元件庫設定檔**：如 `components.json`、theme provider、元件庫自己的設定檔；從中讀出載入方式
  （import 路線、樣式與 provider 的載入點）。
- **元件庫自帶的 agent skill**：對每個偵測到的元件庫，查目前的可用 skill 清單裡有沒有屬於它的
  skill（名稱或描述指向該庫，如 Master UI 的 `master-ui`）。只以可用 skill 清單判定。
- **共用元件目錄**：常見位置如 `src/components/`、`components/ui/`、`src/shared/`、`app/components/`、
  `packages/ui/`；以 repo 實際存在的為準。
- **barrel 匯出**：共用目錄的 `index.ts`、`index.js` 重新匯出了哪些元件。
- **import 次數**：整個 repo 的 import 只掃一次，留下一份「檔案 → 它 import 的模組與名稱」的結果；
  每個候選元件被多少個不同檔案 import、分佈在幾個頁面或功能，都從這同一份結果算，不為個別候選再掃
  一次。掃描涵蓋四種寫法：靜態 `import`（含只有副作用的與只 import type 的）、`export … from`、
  `require()`、動態 `import()`。經 barrel 重新匯出的 import 算到被匯出的候選元件上；barrel 檔本身
  不計入使用它的檔案數。
- **重複實作**：同名或同用途的元件出現在兩處以上（如兩個 `Button`）。
- **Storybook**：`.storybook/` 是否存在，哪些元件有 `*.stories.*`。
- **tokens／theme 檔**：design tokens、theme 物件、CSS 自訂屬性的定義檔、utility 框架的 theme 設定；
  記位置與命名規則。
- **wrapper 慣例**：共用元件是否包住元件庫元件，以及包裝層的命名與位置。
- **限制 import 的 lint 規則**：如 `no-restricted-imports`、`no-restricted-syntax`，或禁止深層 import
  與直接 import 元件庫的 boundaries 類規則。
- **機械檢查**：`package.json` scripts 裡的 lint、typecheck、test、storybook 指令。
- **既有輸出**：`docs/agents/ui.md` 是否存在；repo 根目錄的 `CLAUDE.md` 與 `AGENTS.md` 各自是否存在、
  哪一份有 `## Agent skills` 區塊、區塊裡是否已有 `### UI` 小節。

完成判準：上列每一項都有發現或明記「沒有」；每個共用元件候選都有 import 次數；每則發現都附來源
檔案路徑。

## 2. 一次提出發現與問題

把發現與題目放進同一則訊息，一次交給使用者裁決：先列發現，再列題目。每題附**建議答案**與一行
依據，讓使用者能只回「照建議」。題目只來自下列規則；規則說不問的就不問。

**A 元件庫。** 逐 package 判定：monorepo 時每個前端 package 各看自己的依賴與 import。

- 每個前端 package 都偵測不到 → 記單行「無」，不寫「適用範圍」，不問。
- 偵測到一套 → 照證據記，不問。這一條只適用於單一 package 的專案，或每個前端 package 都用同一套的
  monorepo；這兩種情況都不寫「適用範圍」。
- 前端 package 的元件庫不全相同（含有的 package 沒有元件庫）→ 不問；每套現役元件庫各記一條並附
  「適用範圍」（package 路徑），沒有元件庫的 package 記一條「無」並附「適用範圍」。現役元件庫相同
  （或同樣沒有）、且「既有、不再新用」的標記也相同的 package 才合成一條，「適用範圍」列出這些 package
  的路徑；標記不同的各自一條。
- 同一個 package 裡偵測到兩套以上 → 問該 package 的新程式碼用哪套。建議答案：有限制 import 的 lint
  規則或遷移註記時取它指向的那套，否則取 import 次數多的那套。其餘記為「既有、不再新用」——這個標記
  只用於這種情況。
- 既有 `ui.md` 已記下該題的裁決、且與證據一致時不再問。

**B 共用元件。** 依 import 次數列出候選，這是發現、不是題目；候選門檻照 `UI-TEMPLATE.md` 的
**只收真正共用的**規則。唯一的題目是重複實作：每組問一題「哪份是正本、哪份勝出」；既有 `ui.md` 已記下該組裁決、且與
證據一致時不再問。
建議答案取 import 次數多的那份；次數相近時取位在共用目錄、有 story 或有 barrel 匯出的那份。

**C 慣例。** wrapper 慣例、新共用元件放哪、要附什麼（barrel 匯出、型別、story）、機械檢查指令：
有證據就照證據寫，不問。只有證據分歧時才問（如兩個共用目錄都在新增元件、一半元件有 story 一半沒有），
建議答案取近期 commit 採用的做法；既有 `ui.md` 已記下該題的裁決、且與證據一致時不再問。

「與證據一致」指裁決選的那一方仍在 repo 裡（套件仍在依賴中、檔案或目錄仍存在、做法仍有實例），
且沒有證據與它矛盾；矛盾時照下面「既有 `ui.md`」列成一題。

**既有 `ui.md`。** 重跑時以它為基底比對：與證據一致的、或證據沒提到的內容（多半是手動修改）原樣保留，
不列題目；與證據矛盾的內容（如記載的元件檔案已不存在）每處列一題，建議答案附證據。
例外：既有 `ui.md` 的「元件庫」段只有一條、沒有「適用範圍」，而證據顯示前端 package 的元件庫不全相同
時，不列題目；列為發現，草稿照規則 A 補上「適用範圍」與「無」那一條，並照第 3 步附與既有版本的差異。

**指示檔。** `CLAUDE.md` 與 `AGENTS.md` 都不存在時，問要建立哪一份；建議答案是目前執行環境原生讀取
的那一份。任一份存在時不問。

沒有任何題目時，明說「沒有要裁決的題目」，並在同一則訊息接著出示第 3 步的草稿。

完成判準：發現與全部題目在同一則訊息裡交出；每題都有建議答案與依據；題目清單裡沒有規則說不問的題
（偵測不到或只有一套元件庫、前端 package 的元件庫不全相同（含有的 package 沒有元件庫）、既有 `ui.md`
已裁決的元件庫題、既有 `ui.md` 缺「適用範圍」的元件庫段、沒有重複實作或既有 `ui.md` 已裁決的元件、
沒有分歧或既有 `ui.md` 已裁決的慣例、已存在的指示檔）。

## 3. 確認草稿

依 [`UI-TEMPLATE.md`](UI-TEMPLATE.md) 與使用者的裁決，出示兩份草稿：

- `docs/agents/ui.md` 全文；重跑時另附與既有版本的差異。
- 要寫進指示檔的 `### UI` 小節，註明寫進哪一份、是新增還是就地更新：

```markdown
### UI

<一行摘要：元件庫（或「無」；不同 package 的元件庫不同（含「無」）時各附適用範圍）與共用元件位置>。詳見 `docs/agents/ui.md`。
```

使用者可以直接改草稿；改了就以改過的版本為準，重新出示，直到使用者認可。

完成判準：使用者已明確認可兩份草稿的最終版本。

## 4. 寫入

**`ui.md`**：寫到 `docs/agents/ui.md`，目錄不存在就建立。已存在時就地更新：只改草稿裡有變更的
段落與表格列，其餘原文（含手動修改）逐字不動，不在檔尾附加第二份。

**指示檔**：

- `CLAUDE.md` 存在就改它。
- 否則 `AGENTS.md` 存在就改它。
- 兩者都不存在時，建立使用者在第 2 步選的那一份。

已有一份時，絕不建立另一份。在選定檔案的 `## Agent skills` 區塊裡：已有 `### UI` 小節就就地更新它；
沒有就加在區塊最後。沒有 `## Agent skills` 區塊時，在檔尾新增區塊與小節。區塊外的內容與區塊內其他
小節都不動。

不 commit；何時 commit 由使用者決定。

完成判準：`docs/agents/ui.md` 五段齊全且與認可的草稿一致；指示檔裡恰有一個 `## Agent skills` 區塊、
其中恰有一個 `### UI` 小節；草稿以外的原有內容逐字未變。

## 5. 回報

- 寫入或更新了哪些檔案，改的是哪一份指示檔。
- 會讀 `ui.md` 的前端 skills：`figure-out-the-ui`、`build-the-ui-right`、`actually-look-at-the-ui`、
  `make-the-ui-fast`、`make-this-shit-pretty`。
- 之後可以直接編輯 `ui.md`。證據有變（元件庫、共用元件、tokens 或慣例變了）或要補回 `### UI` 時
  重跑本 skill；重跑會沿用既有 `ui.md`。要從頭來時，請使用者先刪掉 `docs/agents/ui.md` 再重跑。
- 兩支 setup 寫同一個 `## Agent skills` 區塊：重跑 `/setup-matt-pocock-skills` 後若 `### UI` 不見了，
  請使用者重跑 `/set-up-ui-skills` 補回。前端 skills 直接讀 `docs/agents/ui.md`，`### UI` 不見時照常運作。

完成判準：回報列出寫入的檔案路徑與那五支前端 skill，說明可直接編輯 `ui.md`、證據有變或要補回
`### UI` 時重跑且重跑會沿用既有 `ui.md`、要從頭來先刪掉 `docs/agents/ui.md` 再重跑，並告訴使用者重跑 `/setup-matt-pocock-skills` 後若 `### UI` 不見了，要重跑
`/set-up-ui-skills` 補回。
