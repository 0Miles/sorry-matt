---
name: issue-chain
description: 排鏈：依 tracker 與本地證據建立阻塞邊、線性工作鏈，並選出唯一可立即執行的下一步
---

# issue-chain：把散落的工作排成一條鏈

## 1. 定界

第一件事先讀 `docs/agents/issue-tracker.md`，據此選擇 tracker provider。檔案不存在時，請使用者
先執行 `/setup-matt-pocock-skills`，然後停止。GitHub 與 Local Markdown 是替代模式；一次只查
設定指定的 provider。

引數可為 milestone、lane、一組 ticket 識別或本地路徑；未提供時，範圍為整個 repo。設定指出
工作區含多個 repo 時，範圍是全部 repo，且輸出逐 repo 分段 —— 鏈可以跨 repo 排序，分支與
交付物不跨。另讀適用的 `CLAUDE.md` 或通用 `AGENTS.md`，取得排序、triage 與交付規則。

完成判準：已明確寫出 provider、範圍、涵蓋的 repo 與適用的 repo 規則來源。

## 2. 建立快照

按**證據優先序**對帳：指令輸出 > repo 文件 > ticket 敘述。來源衝突時採較高順位，並在快照中
標出過時來源。

- **Git**：查 `git status`、目前分支、未推送 commits、`git worktree list`，以及各 worktree
  與未合併整合分支上的 commits；有 remote 才 fetch 並比對差異。乾淨的 worktree 仍可能屬於
  active session。
- **GitHub tracker**：查範圍內的 open issues、labels、sub-issues、open PRs、CI 與近期留言。
  sub-issue 記的是「這張票出自哪份 spec」這層歸屬；阻塞邊另在步驟 3 判。
- **Local Markdown tracker**：依設定掃描一票一檔的 issues，讀取 `Status`、`Blocked by`、
  acceptance criteria 與 `Comments`。同一 ticket 若也存在於未合併整合分支，還要讀該分支上的
  `sorry-matt completion`／`sorry-matt blocker`，並標明快照採用哪個 branch 版本。Spec 只提供
  脈絡，不列為 ticket。
- **並行佔用**：其他線或其他 session 正在動哪些檔案。把 worktree 的 `HEAD` 與 base 的差異、
  未合併整合分支上的 commits、open PR 的 head diff 攤成檔案清單，再對照本 session 已知的
  其他 session。這份清單是步驟 3 判**他線佔用**的唯一依據，不靠猜。

每個快照項目至少記錄 provider 原生識別、tracker 狀態、branch／worktree／PR 狀態與證據來源。

完成判準：範圍內每張 active ticket、GitHub 模式的每個 open PR、每個 worktree 與每條未合併
整合分支都已入快照；Local Markdown 的每張票都已標明採用的 branch 版本；每個被佔用的檔案
都有佔用來源。

## 3. 判邊

每條**邊**都要附可查證出處：ticket 欄位、label、檔案重疊或 repo 規則。

- `blocked-by`：前置工作完成前無法開工。Local Markdown 只有在前置票的 criteria 全勾，且與
  下游票相同的整合分支上有完整 `sorry-matt completion`，才算解除。
- `待裁決`：必須先取得人的決定。
- `重複/取代`：多張票描述同一工作；指出保留哪張、結束哪張。
- `互斥`：工作本身可獨立完成，但會修改同一批檔案，因此不可平行。
- `他線佔用`：互斥的一種 —— 工作本身可做，但那批檔案正被另一條線或另一個 session 動。
  出處是步驟 2 的並行佔用清單；解除條件是那條線交付或釋出該批檔案。

`ready-for-human` 只表示需要人接手。Local Markdown 的完成或阻塞一律以 branch 上的
`sorry-matt completion`／`sorry-matt blocker` 判定，不能只看 `Status`。

完成判準：每條邊都有出處；快照中的每個項目都已有邊，或已明確標為孤立。

## 4. 排鏈

先依 blocker 拓撲排序，再排成一條線性的**鏈**；待裁決項目另列，不占鏈上位置。同層依序選擇：

1. 能解鎖最多後續工作的票；
2. 使用者可見的缺陷；
3. 在大票之間穿插的小票；
4. 仍同順位時，沿 provider 原生順序。

鏈保持線性；平行性只是每一環相對前一環的標記，不另開支鏈。以 blocker、互斥與他線佔用邊
判定「可平行／不可平行」，並附理由。被他線佔用的環一律標為不可平行，並寫出解除條件。

完成判準：鏈上的票全數有唯一位置與平行性判定；未進鏈的每個 active 項目都已標為待裁決、
資訊不足或範圍外。

## 5. 指出唯一下一步

依序輸出：

1. **現況快照**；
2. 附出處與解除狀態的**邊清單**；
3. 逐環標示平行性的**鏈**；
4. 一個**下一步**。

識別 ticket 時保留 provider 原生格式：GitHub URL／編號，或 Local Markdown 路徑／`NN`。
下一步取鏈上第一個可執行動作。**被他線佔用的票不算可執行** —— 跳過它並寫出佔用來源；
若沒有可動的票，改為取得最高順位待裁決項目所需的一個最小決定。

完成判準：只提出一個能立刻執行的下一步，且它沒有被他線佔用；輸出中的每個項目都能追溯到
快照證據。
