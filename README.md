# 叫蛋記帳

阿寶與草莓共用的叫蛋、付款與賣蛋紀錄網頁，主要在 iPhone 上使用。

- 前端：React + Vite，部署在 **GitHub Pages**
- 登入與資料庫：**Supabase**（Postgres + Auth + Realtime），兩支手機共用同一份資料、即時同步
- 不串接任何 AI API；記帳、計算、對帳文字都是一般程式

## 服務與費用

| 服務 | 用途 | 免費額度 | 超過額度 |
| --- | --- | --- | --- |
| GitHub Pages | 放網頁 | 公開 repo 免費 | 私人 repo 要 GitHub Pro（每月 4 美元）才能用 Pages |
| Supabase Free | 登入、資料庫、即時同步 | 資料庫 500 MB、每月 5 GB 流量、5 萬月活躍使用者、2 個專案 | 免費方案**不會自動收費**，超過只會被限制；要自己升級 Pro（每月 25 美元）才會付費 |

Supabase 免費方案的限制：連續 7 天沒有人使用會暫停專案（到 Supabase 後台按 Restore 即可恢復，資料不會消失）；沒有自動備份，請在「統計」頁定期按「下載 JSON」備份。

## 機密資料

- 前端只有 Supabase 的 **publishable key**（`.env` 裡的 `VITE_SUPABASE_PUBLISHABLE_KEY`），它本來就設計成公開，資料靠資料庫的權限規則（RLS）保護。
- 資料庫密碼、`secret` / `service_role` 金鑰**不放進 repo、也不放進前端**。`npm run check:secrets` 會在部署前檢查，發現就讓部署失敗。
- 密碼由阿寶、草莓自己在 Supabase 後台設定，不經過這個 repo。

## 部署步驟

### 1. 資料庫（已完成）

Supabase 專案 `egg-ledger`（東京）已建立，`supabase/migrations/` 的兩個檔案都已套用。重新建立專案時，依檔名順序在 SQL Editor 執行即可。

### 2. 建立兩人的帳號

1. Supabase 後台 → **Authentication → Users → Add user → Create new user**
2. 分別建立阿寶、草莓的 email 與密碼，勾選 **Auto Confirm User**
3. 打開 `supabase/setup-members.sql`，把兩個 email 換掉，貼到 **SQL Editor** 執行，應回傳兩列
4. **Authentication → Sign In / Providers**，關閉 **Allow new users to sign up**（只讓你們兩個登入；就算有人註冊，也看不到帳本）

### 3. 開啟 GitHub Pages

1. repo → **Settings → Pages → Build and deployment → Source** 選 **GitHub Actions**
2. 推到 `main` 會自動部署，網址是 `https://<GitHub 帳號>.github.io/<repo 名稱>/`
3. iPhone 用 Safari 打開網址 → 分享 → **加入主畫面**，之後像 App 一樣開啟

## 開發

```bash
npm install
npm run dev          # 本機開發（連正式資料庫，小心操作）
npm run typecheck
npm test             # 計算邏輯 + 資料庫規則（PGlite 跑真的 Postgres 與 migration）
npm run test:e2e     # iPhone 尺寸驗收：兩人同時操作，連本機的資料庫替身
npm run build
npm run check:secrets
```

沒有 Playwright 自帶瀏覽器的環境：`PW_CHROMIUM_PATH=<chromium 路徑> npm run test:e2e`

## 規則重點

- 金額一律整數（元）。**未知價格不是 0**：不算進已知未付、不算結清，對帳寫「價格待確認」。
- 帳務不刪除：記錯用「作廢」、付款錯用「復原」或「更正」，都會留下修改紀錄。
- 修改人取自登入帳號（資料庫觸發器寫入），叫蛋人、付款人、登記人是可更正的欄位。
- 每筆資料有版本號，對方先改過時會提示衝突、不覆蓋，並保留你的輸入。
- 付款只能透過資料庫函式：同一個請求編號只記一次（防連按），且會鎖住該筆叫蛋避免兩人同時超付。
- 改價或箱數不會改寫已付金額，多付會明確顯示。
- 進貨依送蛋日期歸月份，收入依販售日期，付款依付款日期；未來送蛋為「預訂」，到期才計入進貨。
- 進銷差額＝已登記收入－已知進貨成本，價格沒補齊時不顯示；不是淨利（沒有扣庫存、滷料、瓦斯、包裝）。

## 結構

- `supabase/migrations/`：資料表、權限（RLS、欄位權限）、觸發器、付款函式
- `src/lib/`：純計算（金額、分配、對帳文字、統計、日期），不碰畫面或資料庫
- `src/features/`：各頁功能（叫蛋、賣蛋、統計、登入、資料存取）
- `tests/db/`：資料庫規則測試；`e2e/`：驗收測試與本機資料庫替身
