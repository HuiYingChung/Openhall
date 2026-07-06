# Week 2（Prompt 03）驗收報告 — 2026-07-05

測試方法：vitest / eslint / tsc / vite build（從 git HEAD 抽出乾淨原始碼跑）、AI pipeline 程式碼審查、金鑰安全檢查。瀏覽器 E2E 尚未做（見下方「E2E 還缺什麼」）。

## 總結

**品質很好，可以有條件驗收。** 38 個測試全過、tsc / build 乾淨、step 0 連線探測有確實執行且據此做了正確的架構決策（CORS 擋掉瀏覽器直連 → 需要 token worker；Granite Vision 不在方案內 → 改用 watsonx 上的 Llama 3.2 Vision）。金鑰處理乾淨：`.env` 沒進 git、key 只存 localStorage、worker 不記錄金鑰。

**但 E2E（上傳→生成→行走）還沒人實測過**，需要先解決 token worker 部署才能測。另外發現 1 個中等 bug 和幾件雜項。

## 發現的問題

### 1.（中）placement-sanity 的 inbound doorway 沒有換算 offset
`getAllDoorwaysOnWall()` 把鄰房指過來的門直接用 `{...d, wall}` 加入，但 `offsetFromCenter` 沒有像 room-builder 那樣重新換算到目標房間的牆中心（兩房 depth 不同時會差到數米）。後果：接收方牆上的畫作可能被推進門口的實際位置、或被錯誤地推離其實沒門的位置。room-builder 有正確換算，這裡漏了。修法：抽出 room-builder 的換算邏輯共用，並補一個兩房 depth 不同的測試案例。

### 2.（低）ESLint 沒有 ignore `dist/`
build 過之後再跑 `npx eslint .` 會冒出 194 個來自 dist 產物的錯誤。config 加 `{ ignores: ['dist/'] }` 即可。

### 3.（低）settings 表單把 API key 寫進 innerHTML 字串
`app.ts` 用模板字串 `value="${wx?.apiKey}"` 組 HTML。本地單機 app 風險低，但 key 含特殊字元會弄壞 DOM；改用 `input.value = ...` 賦值較妥。

### 4.（風險）git repo 放在 Dropbox 內，index 已出現損壞跡象
沙盒端看到 `error: cache entry has null sha1` 和幻影 rename/delete。Dropbox 同步 `.git` 目錄是知名的 repo 損壞來源。**強烈建議盡快推上 GitHub（本來就是比賽必要條件）**，之後可考慮把工作 repo 移出 Dropbox、或至少確保有遠端備份。請在 Windows 端（GitHub Desktop 或 git bash）跑一次 `git status` 確認 repo 本體是否正常。

## E2E 還缺什麼

CORS 探測已確認瀏覽器不能直連 IBM IAM，所以 watsonx 流程需要 token-exchange worker。兩個選項：

1. **本地測（最快）**：`npx wrangler dev worker/token-exchange.ts` 起本地 worker（如 localhost:8787），`npm run dev` 起 app，settings 裡 worker URL 填 localhost。不用任何帳號。
2. **正式部署**：Cloudflare 免費帳號 + `wrangler deploy`，Week 3 hosted demo 反正需要。記得設 `ALLOWED_ORIGINS`。

不碰 key 也能先測的：demo mode（settings 畫面的 demo 連結）可直接驗上傳後的 UI 流程和 viewer。

## Prompt 03 DoD 對照

| 項目 | 狀態 |
|---|---|
| 測試（retry 邏輯、placement clamp、curation schema） | ✅ 38 全過（新增 21） |
| eslint / tsc 乾淨 | ✅（dist ignore 缺口除外） |
| step 0 連線腳本 + 據結果決策 | ✅ 執行過，session log 有完整記錄 |
| upload + resize + 真實長寬比 | ✅ 程式碼確認（Canvas API，1024/2048 雙版本） |
| BYOK + provider 抽象（watsonx + OpenAI-compat） | ✅ |
| token worker | ✅ 程式碼完成，**未部署未實測** |
| 三段 pipeline + zod 驗證重試 | ✅ 程式碼確認 |
| label 可編輯 | ✅（textarea 編輯畫面） |
| viewer 真材質 + 長寬比（0.75 硬編碼已除） | ✅ 含 `group as Mesh` 型別欺騙修復 |
| **live E2E（上傳 6–10 張 → 可行走畫廊）** | ❌ **未測 — 驗收保留項** |
| session log + conventional commits | ✅ |

## 下一步建議順序

1. Windows 端確認 git repo 健康 → 推上 GitHub（public）
2. 起本地 wrangler + dev server → 用真 key 跑一次完整 E2E
3. 叫 Bob 修問題 1–3（很小，可併入 Prompt 04 開頭）
4. E2E 過了才算 Week 2 完結，進 Week 3
