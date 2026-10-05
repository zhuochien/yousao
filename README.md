# 酌有韶

原生 JavaScript PWA，沿用 `yousao.v1` 與六個集合。畫面透過 `app-store.js` 的 Store 讀寫；Google Drive 是手動同步介面，沒有自動雙向合併。

## 新增功能

- **角色工作室**：角色／企劃名稱、製作階段、優先度、待辦估時與七天創作時間預算。創作項目仍放在 `projects` / `tasks`，領域代號仍是 `night`。
- **私人雲端備份**：六個集合完整上傳到 `appDataFolder`。下載會先預覽、保存改動前的 JSON，再明確確認是否取代本機資料。
- **經紀人工作檔**：只匯出 `night` 的專案與待辦到私有、可見的 Drive JSON。GPT／Claude 必須各自連線同一 Google 帳號；不會取得網站的 Google 權杖。
- **排程提案**：查看前後差異、勾選採用、檢查讀取後與預覽後的衝突、保護已完成待辦。可直接匯入 JSON，無須先完成網站 OAuth 設定。
- **復原點**：批次匯入前保存 `yousao.recovery.v1`。儲存失敗不套用半份資料。此復原點保留最近一次匯入前的資料，不取代另存的 JSON 備份。

## 第一次連線 Google

ChatGPT／Claude 的 Google Drive 連線，與 GitHub Pages 網站的 Google 授權是分開的。首次設定在 App「雲端與經紀人 → 連線設定」完成。

1. 在 [Google Cloud](https://console.cloud.google.com/) 建立個人專案，啟用 **Google Drive API**。
2. Google Auth Platform 設定同意畫面。個人使用可先採測試模式，把自己的 Google 帳號加入測試用戶。
3. 建立 **網頁應用程式** OAuth 用戶端。
4. 授權 JavaScript 來源填 `https://zhuochien.github.io`，不要加 `/yousao/` 路徑。OAuth dialog token model 不需要伺服器回呼網址。
5. 在 App 貼上 OAuth **Client ID**。不要貼 Client Secret。這個 ID 保存在自己的瀏覽器設定，不需要提交到 repo。
6. 分別按「創作工作檔」或「私人備份」的「連線 Google」，授權所需功能。

授權範圍：私人備份 `drive.appdata`；可見創作工作檔 `drive.file`。不申請整個 Drive 的讀寫權限。權杖只存在記憶體；頁面重開或權杖到期後需再次按連線。

### 已有 GPT 建立的工作檔

`drive.file` 不能只憑一個 ID 取得其他應用程式建立的檔案。可選以下任一方法：

- 先下載 JSON，在「匯入經紀人提案」選檔預覽。完成後由網站「建立新檔」上傳新進度，之後把新工作檔連結交給經紀人。
- 同一 Google Cloud 專案啟用 **Google Picker API**，建立限制為 Picker API 和網站來源的 API 金鑰。在連線設定填入這個金鑰與數字格式的專案編號，使用「選取雲端工作檔」將既有 JSON 授權給網站。

Picker 金鑰是瀏覽器識別用的限制型金鑰；不要填任何服務帳戶私鑰、Client Secret 或 bearer token。JSON 工作檔維持私有，不建立公開分享。

## 日常協作

1. 在 App 更新角色進度與已完成待辦。
2. 保存 JSON 備份，再手動「上傳創作進度」。
3. 把工作檔連結與「複製經紀人交接」文字交給 GPT／晏。
4. 經紀人讀取最新工作檔，提出 `proposal`；有寫入工具就更新同一私有檔案，僅能讀取則回傳完整 JSON。
5. App「下載／預覽提案」，逐項確認並採用。
6. 上傳已採用的實際進度，供下一次排程使用。

未採用提案存在時，上傳同一工作檔會被阻止，避免抹去建議。全部提案已與本機一致時可上傳進度並清除提案。部分採用／有衝突時，可請經紀人依最新資料修訂剩餘提案，或建立新檔保留舊檔。

更新既有雲端檔案前檢查修改時間，並以 HTTP ETag / `If-Match` 條件寫入；若 Google 回應未提供可讀的 ETag，會拒絕覆寫並提示建立新檔。重新讀取可處理雲端版本變更。這不代表 Google 網站授權已在開發環境完成；必須用自己的 OAuth Client ID 做一次真實登入驗證。

## 經紀人資料契約

檔案名稱：`酌有韶-角色創作排程.json`。只有 `projects`、`tasks`；不包含 `habits`、`checks`、`moods`、`inbox`。

```json
{
  "app": "yousao.manager",
  "v": 1,
  "exportedAt": "2026-10-05T12:00:00Z",
  "projects": {},
  "tasks": {},
  "proposal": {
    "id": "example-plan",
    "author": "GPT 或晏",
    "summary": "本週安排的理由與預估時間",
    "projects": [
      {
        "id": "example-character",
        "expected": null,
        "record": {
          "title": "示範角色創作",
          "characterName": "待選定",
          "realm": "night",
          "status": "new",
          "stage": "concept",
          "priority": "normal"
        }
      }
    ],
    "tasks": [
      {
        "id": "example-task",
        "expected": null,
        "record": {
          "title": "盤點現有角色進度",
          "realm": "night",
          "projectId": "example-character",
          "date": "2026-10-06",
          "minutes": 30,
          "done": false
        }
      }
    ]
  }
}
```

- 頂層 `projects` / `tasks` 是使用者已上傳的現況，不要任意修改；新建草案可以是空物件。
- 更新項目的 `expected` 必須是剛讀取的完整紀錄（不含 `id`；包含未知欄位），以便偵測衝突。新增項目 `expected: null`。
- `record` 是補丁，必須包含 `title` 與 `realm: "night"`。未提供的欄位會保留；日期可用空字串清除。此版本不支援提案刪除紀錄。
- 階段：`concept`、`profile`、`opening`、`visual`、`test`、`release`。
- 專案狀態：`doing`、`todo`、`paused`、`chore`、`new`。優先度：`high`、`normal`、`low`。
- 日期：`YYYY-MM-DD`；估時 `minutes`：非負整數（分鐘）。每個集合最多 500 筆提案。
- 保留 stable ID，不改 `day` / `night` / `both`。不得修改朝的資料、取消已完成工作或夾帶私人資料到公開 repo。
- 經紀人寫入雲端前須重讀版本；另一方已修改時先停下、保留兩份版本，不自動合併。
- JSON 是存放的原始檔，不是 Google 文件。Drive 連線若未返回可讀文字，下載原始檔再解析，勿把空文字結果當作空白工作檔。

## 開發與測試

```sh
node --test tests/store.test.cjs
python -m http.server 8765 --bind 127.0.0.1
```

另一個終端機，在安裝 Playwright 和 Chromium 後執行 `node tests/browser.test.cjs`。介面測試使用合成資料及模擬 Google 回應，不使用實際帳號權杖。GitHub Actions 執行單元測試、桌面／手機介面與離線重開測試，並保存合成資料的 QA 截圖。

Service worker 快取已升為 `yousao-v5`；新增四個 JS 模組均納入離線 app shell。改動前的版本可由 git 還原；既有瀏覽器資料不會因升版清除。

Google 官方參考：[appDataFolder](https://developers.google.com/workspace/drive/api/guides/appdata)、[授權範圍](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)、[GIS token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model)。
