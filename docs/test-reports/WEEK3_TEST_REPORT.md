# Week 3（Prompt 04）驗收報告 — 2026-07-05

測試方法：從 git HEAD（6dced63）抽乾淨原始碼跑 vitest / eslint / tsc / 兩個 build target、逐檔審查 Week 3 新程式碼（interactions / tour / bundler / viewer-entry / demo / deploy configs）、金鑰安全與匯出純淨度檢查。瀏覽器手測未做。

## 總結

**互動、tour、polish、carry-over 修復品質好；但 export 功能鏈有 3 個致命問題，目前「沒有任何一條路徑能產出可用的匯出 zip」，不能驗收。** 79 個測試全過（+41）、eslint / tsc / `build` / `build:viewer` 全綠 — 但 export 的問題全在 fetch 與跨檔整合層，單元測試全部 mock 掉了，測不到。Export 是 ROADMAP 明定「never cut」的三大賣點之一，必須修。

## 致命問題（export 三連環）

### 1. 匯出的 gallery 只會顯示色塊，不是真圖
bundler 把 `imagePath` 改寫成相對路徑（`images/aw-01.jpg`），但 `room-builder.ts:475` 只在 `blob:` / `data:` / `http` 開頭時才載入 texture，**其他一律走 demo placeholder 色塊分支**。匯出的 zip 解壓後每件作品都是純色矩形。另外 schema 沒有存 aspectRatio，`viewer-entry` 呼叫 `buildScene(gallery)` 沒帶 aspect map → 全部退回 0.75，真實長寬比在匯出版全丟失。

修法方向：room-builder 也接受相對路徑（或 viewer-entry 載入前把 imagePath 轉成絕對 URL）；`Artwork` schema 加 `aspectRatio`，bundler 寫入、viewer-entry 讀出來組 aspect map。

### 2. 正式 build 沒有 `./assets/viewer.js` 這個檔
`npm run build` 產出的 `dist/assets/` 只有 hashed app chunks，沒有 viewer bundle；沒有任何 copy 步驟把 `dist-viewer/viewer.js` 放進去，deploy.yml 也只跑 `npm run build`。更糟：Vercel 的 SPA rewrite 會把這個 404 改寫成 `index.html`（HTTP 200）→ bundler 開心地把 **HTML 當成 viewer.js 打進 zip**，靜默產出壞包。

修法方向：build script 改為 `build:viewer` → 把 `dist-viewer/viewer.js` 複製到 `public/assets/viewer.js`（或 build 後 copy 進 dist）→ 再 `vite build`；bundler 對 fetch 回應加 content-type / magic 檢查，拿到 HTML 就 fail loudly。

### 3. dev 模式匯出的 viewer.js 是 Vite dev 模組，離線即斷
dev 下 `viewerScriptUrl = '/src/viewer/viewer-entry.ts'`，Vite dev server 回傳的是轉譯後模組，import 指向 `/node_modules/.vite/deps/...` 等 dev-server 專屬路徑 — 打進靜態 zip 後全部 404。程式碼註解還寫著 `/dist-viewer/viewer.es.js`（跟實際檔名、實際路徑都不符），明顯此路徑沒被真正測過。

修法方向：dev 也 fetch 預先 build 好的 `public/assets/viewer.js`（跟修法 2 合併），刪掉 dev 專屬分支。

## 中等問題

### 4. 行動裝置進不了 gallery（touch fallback 實際上到不了）
主 app 要靠 pointer lock 的 `lock` 事件才會 `setState('viewer')`，而 iOS Safari 根本沒有 pointer lock → 卡死在「Click to Enter」overlay。Tour 按鈕又只在 viewer state 才掛上 → DoD 的 mobile tour fallback 在主 app 是死路。（匯出版 viewer-entry 的 Tour 按鈕開機就掛、z-index 200 剛好蓋過 overlay 的 100，湊巧可用 — 但這是巧合不是設計。）修法：偵測不支援 pointer lock 時，入口 overlay 直接改為「Start Tour」。

### 5. Raycast 可以隔牆選中畫作
`interactions.ts` 的 raycast 只對 artwork meshes 做 `intersectObjects`，牆不在遮擋集合裡、距離也沒上限 → 可以 highlight 並點擊隔壁房間的畫，dolly 直接把相機拉穿牆。修法：把牆 mesh 加入 raycast 集合（取最近 hit 若不是 artwork 則忽略），或限制距離。

### 6. Inspect 關閉流程需手測（可能很卡）
Pointer locked 時游標不可見 → panel 的「✕ Close」點不到；按 Esc 會先觸發 relock overlay（疊在 panel 底下）。理論上可脫身（Esc 後游標出現、panel z-index 較高可點 Close），但流程繞。建議：dolly 開始時主動 `unlock()`，panel 關閉時再 `lock()`。

### 7. Demo mode 沒有真的樣本作品
Prompt 04 §4 要求 commit 6–8 張 public-domain 樣本圖；實作只有 `sample-gallery.json` + 色塊 placeholder。零網路呼叫沒錯，但評審打開 demo 看到的是彩色矩形，不是畫廊。對比賽第一印象傷害大，建議補真圖（CC0，各 ≤200KB）。

## 低嚴重度

8. **GitHub Pages 子路徑**：vite `base` 未設（預設 `/`），部署到 `user.github.io/repo/` 時資產全 404。加 `base: './'`。
9. **bundler 吞錯**：圖片 fetch 失敗時 catch 後寫入一個 zip 裡不存在的路徑（違反 AGENTS.md fail-loudly）；`estimateImageBytes` 恆回 0 使 `coreBytes` 變成整包大小，且沒有呼叫端在用 — 要嘛做對要嘛刪掉。
10. **LLM 文字直接進 innerHTML**：info panel、tour label、upload 卡片的 title 都是模板字串拼 HTML — 跟 Week 2 issue 3 同類（那個修了，這些是新增的）。建議統一走 textContent 或 escape helper（bundler 的 `buildIndexHtml` 就有 escape，標準不一致）。
11. **vercel.json 的 COEP `require-corp`** 沒有需要它的功能（無 SharedArrayBuffer），只會增加跨源資源被擋的風險，建議拿掉。

## 通過項

- 79 tests 全過（新增 41：bundler 7、tour 6、gallery-assembler、placement depth-diff 等）；eslint / tsc / 兩個 build 乾淨
- Carry-over 3 修全數完成且有測試（doorway offset 換算含 depth 10↔14 案例；eslint ignores；settings 改 `input.value`）
- `disposeScene()` 在重建前呼叫、per-artwork SpotLight、frame、hover highlight / dolly 數學、tour 狀態機 — 審查無誤
- 金鑰安全：viewer-entry / bundler / interactions / tour 零 key 相關程式碼，匯出物不含 AI code；worker proxy 架構未被動過
- wrangler.toml / deploy.yml 本身合理（但受問題 2、8 影響）

## Prompt 04 DoD 對照

| 項目 | 狀態 |
|---|---|
| Carry-over 修復 ×3 | ✅ |
| Hover highlight + crosshair + click dolly + info panel | ✅ 程式碼確認（隔牆 raycast、關閉流程見 5、6） |
| Tour mode + Next/Prev/Exit | ✅ 程式碼確認 |
| Touch/mobile fallback「不困住使用者」 | ❌ 主 app 行動裝置卡死在 Click to Enter（問題 4） |
| Export zip 零修改可跑 Netlify Drop | ❌ **三連環（問題 1–3），目前產不出可用 zip** |
| Bundle < 5MB（不含圖） | ✅ viewer.js 686KB / gzip 152KB |
| Demo mode 零 key 零網路 | ⚠️ 可用但全是色塊，無樣本真圖（問題 7） |
| 部署 config 備妥 | ⚠️ 備妥但 GitHub Pages 缺 base 設定（問題 8） |
| 測試/lint/tsc 綠 | ✅ |
| Session log + conventional commits | ✅ |
| 手動 E2E / Netlify Drop / 跨瀏覽器 | ❌ 未做（session log 無任何手測記錄） |

## 下一步建議

1. 出 **BOB_PROMPT_05**：修問題 1–4（export 三連環 + mobile entry），這次驗證必須包含「真的解壓 zip、`npx serve` 起來看得到圖」的腳本化檢查，不准只靠 mock 測試
2. 問題 5–7 併入同一個 prompt 或其後（7 需要 Hui 挑 CC0 圖，也可以由 Bob 找 met museum open access 之類來源）
3. 修完後才做手動 E2E：dev 全流程 + export → Netlify Drop + 手機 tour
4. 老話：repo 還在 Dropbox 裡且 git index 又出現損壞（`unknown index entry format 0x31340000`）— **請盡快推上 GitHub**
