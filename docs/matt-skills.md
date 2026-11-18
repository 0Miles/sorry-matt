# sorry-matt 與 matt skills 的對照表

sorry-matt 用到的每個 mattpocock skill，以及它在這裡的用法。三種決定：

- **原樣使用**：照上游原文執行，不加任何覆寫規則。
- **自有流程取代**：寫 sorry-matt 自己的版本，runtime 不再載入上游原文。
- **只傳參數**：只填上游本來就留的參數位置，行為不改。

原則：不出現「載入上游全文，再用延伸契約覆寫其中幾行」。原文與覆寫同時進 context 時，兩邊打架的
行為無法預期，token 也花兩次（#5）。subagent 拿不到 AskUserQuestion，任何要它「跟使用者確認」的
上游文字都不能交給它（#6）。

上游版本：`mattpocock-skills@1.3.2`（`main` @ `4ae2317`）。

| matt skill | 用在哪 | 決定 | 理由 |
| --- | --- | --- | --- |
| `implement` | `get-to-work` 派票，交給實作 agent | 自有流程取代：`get-to-work/IMPLEMENTER.md` | 上游六行裡有三行被覆寫：「at pre-agreed seams」用 `tdd`、結尾跑完整套件、自己呼叫 `code-review`。剩下的「讀票先寫票名」「commit 到目前分支」併進交付說明。實作 agent 問不到人，交付內容要自足（#6）。 |
| `tdd` | 經 `implement` 由實作 agent 呼叫 | 自有流程取代：`IMPLEMENTER.md` 第 2 節 | 上游要求「confirm them with the user. No test is written at an unconfirmed seam」，實作 agent 做不到。改為 seams 以票為準、沒寫就自定並記入接續紀錄；保留測試原則（測公開介面、期望值來自獨立來源、一次一個切片）。 |
| `to-spec` | `take-this` 第 3 步 | 自有流程取代：`take-this` 第 3 步與 `TEMPLATES.md` | 上游第 2 步「Check with the user that these seams match」被代答覆寫。seams 改為代答後寫進 Testing Decisions，供票與實作 agent 沿用。模板保留。 |
| `to-tickets` | `take-this` 第 4 步 | 自有流程取代：`take-this` 第 4 步與 `TEMPLATES.md` | 上游第 4 步「Quiz the user… Iterate until the user approves」被代答覆寫；「深度只到 frontier」又覆寫了模板的寫法。切片規則、expand–contract、發布方式改寫進 skill；票模板加 Seams 欄。 |
| `handoff` | `take-this` 第 1 步，壓縮前 | 原樣使用（vendored） | 沒有任何覆寫。上游是 user-invoked，Skill tool 叫不到，所以 pin 在 `take-this/references/upstream/`。 |
| `code-review` | `get-to-work` 收票的獨立審查 | 自有流程取代：`prove-it` | 兩軸改成 `prove-it` Finder 的兩個 lens：Spec 軸 → 驗收對照（保留驗收項出處），Standards 軸 → repo 慣例（只列能引用規則原文的）。原樣呼叫做不到 #15 要的流程：上游規定兩軸報告原樣並列、不合併不重排，接不上 Verifier 逐項裁決與 pass／fix／stuck 結論；兩軸之外再跑 `prove-it` 的 Finder 等於第二位 reviewer 重讀整份 diff，違反「每張票只有一次獨立審查」。Fowler smell baseline 不帶過來：上游自己定為 judgement call，說不出可觀察差異，過不了 `prove-it` 的修法方向檢查；品質收斂由線級 `simplify` 負責。 |
| `grilling` | `grill-them` 的 agent-griller | 只傳參數 | 只指定角色對應（上游的「使用者」＝ agent-grillee），上游行為原樣保留。問答經對打目錄的檔案往返（#14），換的是傳遞管道，不改提問方式。原本另外指定「主要靶點」等於加行為，已刪。 |
| `domain-modeling` | `grill-them` 第 4 步沉澱 | 原樣使用 | 沉澱的是雙方已有共識的術語與決策，沒有改寫上游任何一行。 |
| `research` | `grill-them` 支線的外部事實查證 | 自有流程取代：`grill-them` 第 3 步兩行指示 | 上游要把 findings 存進 repo 的慣例位置，`grill-them` 要寫 scratchpad、不寫 repo —— 原本是覆寫。改為直接要求查一手來源、附出處、寫進 scratchpad。 |
| `wizard` | `have-it-all-done` 交棒的人工作業清單 | 原樣使用 | 交棒時使用者已經回來，wizard 自己向使用者確認步驟不違反「裁決點之後不提問」。 |

## 只建議使用者執行、runtime 不呼叫的

`/setup-matt-pocock-skills`、`/triage`、`/wayfinder`、`/grill-me`、`/grill-with-docs`。skill 裡只以
「請使用者執行」出現，不需要對照。

不是 matt skill、不在本表範圍：`simplify`（Claude Code 內建）、`speak-human`、`no-bullshit`、
`issue-chain`、`clean-it-up`、`grill-them`、`prove-it`（sorry-matt 自家）。

## 取代後的上游對帳

自有流程取代的上游檔案已從 `references/upstream/` 移除，runtime 不讀。上游升級時，抓新的 tag，
對下列檔案 diff，把語義變更帶進對應的自有檔：

| 上游檔案 | 被取代時的 SHA-256（LF 正規化） | 對應的自有檔 |
| --- | --- | --- |
| `skills/engineering/implement/SKILL.md` | `483BDC4CCF4AC31D86AC7BEEAA0D0DB80313E71E120BB8C59B3196AE5DECD53D` | `get-to-work/IMPLEMENTER.md` |
| `skills/engineering/tdd/SKILL.md` | 未 vendored，以 `1.3.2` 為準 | `get-to-work/IMPLEMENTER.md` 第 2 節 |
| `skills/engineering/to-spec/SKILL.md` | `43AD9CF318E5E7D3D1FA360253A37021796DC87A0C2E595AD262661A10F85088` | `take-this/SKILL.md` 第 3 步、`take-this/TEMPLATES.md` |
| `skills/engineering/to-tickets/SKILL.md` | `56EC23C5B2782785D4E65BFF9E315B6D3AEB4EF977C174A219E99489FADA1995` | `take-this/SKILL.md` 第 4 步、`take-this/TEMPLATES.md` |
| `skills/engineering/research/SKILL.md` | 未 vendored，以 `1.3.2` 為準 | `grill-them/SKILL.md` 第 3 步 |
| `skills/engineering/code-review/SKILL.md` | `9C921A8D88138A41401D8897CA1BB852088AB1B7B605CDD04EDC13E3E8AAB6DD`（取自 `1.3.2` 安裝副本） | `prove-it/SKILL.md` 第 2 節 |

`take-this/TEMPLATES.md` 與 `get-to-work/IMPLEMENTER.md` 第 1、2 節改寫自 MIT 授權的上游原文，授權聲明在
`take-this/references/upstream/NOTICE.md`。

仍以 Skill tool 呼叫的第三方 skill：`grilling`、`domain-modeling`、`wizard`（皆為
model-invoked，於 `1.3.2` 確認）。更新 pin 時逐一確認它們仍存在且仍是 model-invoked。
