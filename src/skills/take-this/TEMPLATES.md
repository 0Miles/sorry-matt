# TEMPLATES：spec 與 tickets 的模板

`take-this` 第 3、4 步發布時使用。模板的標題保持英文，`issue-chain`、`get-to-work` 與 tracker
慣例都依這些標題讀取。內容改寫自 `mattpocock/skills` 的 `to-spec` 與 `to-tickets`（MIT，
出處與授權見 [`references/upstream/NOTICE.md`](references/upstream/NOTICE.md)）。

## Spec

```markdown
## Problem Statement

使用者面對的問題，從使用者的角度寫。

## Solution

解法，從使用者的角度寫。

## User Stories

一份很長的編號清單，涵蓋功能的每個面向，每項格式為：

1. As an <actor>, I want a <feature>, so that <benefit>

## Implementation Decisions

已做出的實作決策：要新建或修改的模組、模組介面的變更、架構決策、schema 變更、API 契約、
特定互動。不寫具體檔案路徑或程式片段。

## Testing Decisions

- 怎樣算好的測試：只測外部行為，不測實作細節
- seams：要在哪幾個 seam 測（`take-this` 第 3 步代答的結果）
- 要測的模組，以及 codebase 裡可參照的同類測試

## Out of Scope

不在本 spec 範圍內的事。

## Further Notes

其他補充。
```

## GitHub issue

```markdown
## Parent

母票的參照（來源不是既有 issue 時省略本節）。

## What to build

這張票讓哪個端到端行為能運作，從使用者的角度寫，不逐層列實作。

## Seams

這張票要測的 seam，取自 spec 的 Testing Decisions。沒有時省略本節，由實作 agent 自行決定並記錄。

## Acceptance criteria

- [ ] Criterion 1
- [ ] Criterion 2

## Blocked by

- 每張 blocker 的參照，或 "None (can start immediately)"。阻塞邊已用原生關係設定時省略本節。
```

## Local Markdown ticket

```markdown
# <NN>: <Ticket title>

**What to build:** 這張票讓哪個端到端行為能運作，從使用者的角度寫。

**Seams:** 要測的 seam，取自 spec 的 Testing Decisions；沒有時寫 "decided by the implementer"。

**Blocked by:** blocker 的編號／標題，或 "None (can start immediately)"。

**Status:** ready-for-agent

- [ ] Acceptance criterion 1
- [ ] Acceptance criterion 2
```
