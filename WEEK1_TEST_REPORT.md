# Week 1 測試報告 — 2026-07-05

測試方法：vitest 全套、ESLint、tsc、vite build、碰撞邏輯程式模擬、瀏覽器實機測試（Hui 手動驗證 + 截圖確認）。

## 總結

Week 1 核心目標「可行走的硬編碼展間」**大致達成**，但有 **1 個必修的重大 bug**（兩房之間無法通行）和 2 個會在 demo 時出糗的中等 bug。品質整體不錯：schema 設計乾淨、17 個單元測試全過、tsc 與 build 無錯。

## 自動化測試結果

| 項目 | 結果 |
|---|---|
| vitest（17 tests, 2 files） | ✅ 全過 |
| tsc --noEmit | ✅ 無錯 |
| vite build | ✅ 成功（單 chunk 530KB，先不管） |
| ESLint | ⚠️ 1 error：`overlay.ts:67` `HTMLButtonElement` no-undef（eslint.config 缺 browser globals，非程式錯誤） |
| 瀏覽器實測 | ✅ 渲染正常、WASD 行走正常；❌ 門口被擋（見 Bug 1） |

## Bug 清單（依嚴重度）

### 1.（高）兩房之間的門口無法通行 — 已實測確認
room-a 東牆有開門，但 room-b 的西牆（同一位置）沒有任何開口 — 碰撞 AABB 和視覺牆板都是整面封死。程式模擬：玩家往東走在 x≈11.4 被 room-b 的牆擋住（門口在 x=12）。schema 註明「each room lists doorways it owns」，但 builder 沒有把 doorway 鏡射到目標房間。
**修法**：`buildScene` 建每個房間前，收集所有指向它的 doorway，轉換成對面牆的 cut 一併傳入 `buildWallAABBs` 和 `buildWallPanels`。另外兩面牆在同一位置重疊，可能 z-fighting。

### 2.（中）WASD 用 `e.key` 判斷，大小寫敏感
`controls.ts` 的 keys 表是小寫 `w/a/s/d`。CapsLock 開著、按住 Shift、或中文輸入法未切換時，`e.key` 不是小寫字母，人物完全不會動 — demo 時很容易踩到。
**修法**：改用 `e.code`（`KeyW` 等），與鍵盤佈局和輸入法無關。

### 3.（中）按 Esc 解鎖後永久卡死
overlay 被 dismiss 移除後，`unlock` 事件的 handler 是空的，畫面上也沒有任何 click listener 可以重新 lock。使用者按一次 Esc 就只能重新整理頁面。
**修法**：unlock 時顯示「點擊繼續」提示，click 重新 `controls.lock()`。

### 4.（中）燈光每房重複加，多房會過亮
`buildRoom` 每房都 `scene.add` 一個 AmbientLight + HemisphereLight，但這兩種光是全域的 — 兩房場景整體亮度直接翻倍，房間數不同亮度就不同。
**修法**：ambient/hemisphere 移到 `buildScene` 加一次（強度可取各房平均），房內只留 point/spot light。

### 5.（低）`artworkSpotlights: true` 沒有實作
註解說 spotlight 會在 `buildArtworkPlane` 加，實際上沒有 — 只加了房間中央一盞 point light。schema 選項目前是裝飾。

### 6.（低）`main.ts` 起始位置的三元運算子優先權錯誤
`firstLayout.originX + firstLayout.wallAABBs.length > 0 ? ... : 0` 實際是 `(originX + length) > 0`，恆真所以剛好沒事，但這行是壞的，該重寫。

### 7.（低）其他
- `buildArtworkPlane` 回傳 `group as unknown as THREE.Mesh` — 型別欺騙，Week 3 做 raycast 時會咬人。
- 畫作長寬比硬編碼 0.75（Week 1 placeholder 可接受，Week 2 記得從貼圖讀）。
- overlay 的 localStorage 記憶被註解掉但 `dismiss()` 仍會寫入 — 行為不一致。

## Roadmap 對照

| Week 1 項目 | 狀態 |
|---|---|
| Vite + TS + Three.js + ESLint/Prettier | ✅（ESLint config 有 1 個小洞） |
| GitHub repo public | ❌ 只有本地 commit，**沒有 remote** — 記得推上 GitHub 設 public |
| Bob session log | ✅ `docs/bob-sessions/01-scaffold.md` |
| gallery.json schema 凍結 | ✅ 設計乾淨，有測試 |
| 房間生成（牆/地板/天花板/畫作平面） | ✅ 但見 Bug 1、4、5 |
| PointerLock + WASD + AABB 碰撞 | ⚠️ 可用，但見 Bug 1、2、3 |
| 控制提示 overlay | ✅ 渲染正常 |
| watsonx.ai trial + API 驗證 | ❓ 程式碼裡看不出來（worker/ 目前是空殼）— 請確認是否已做 |

## 給 Bob 的下一步建議

修 Bug 1–4 再進 Week 2（都是小改動，估半天內）。Bug 1 建議補一個整合測試：模擬玩家從 room-a 走到 room-b。

---
*測試用的 `smoke-test.html` 留在 repo 根目錄（未 commit），之後可刪或加進 .gitignore。*
