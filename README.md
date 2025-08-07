# 電商網站後端 API

這是電商網站的後端服務，提供完整的 RESTful API 支持產品管理、用戶認證、購物車功能等。

## 技術棧

- **Node.js** - 運行環境
- **Express.js** - Web 框架
- **MongoDB** - 資料庫
- **Mongoose** - MongoDB ODM
- **JWT** - 用戶認證
- **Multer** - 檔案上傳處理
- **CORS** - 跨域請求支持

## 主要功能

### 產品管理
- 獲取所有產品 (`GET /allproduct`)
- 新增產品 (`POST /addproduct`)
- 刪除產品 (`POST /removeproduct`)
- 獲取新品推薦 (`GET /newcollection`)
- 獲取熱門女裝 (`GET /popularinwomen`)

### 用戶認證
- 用戶註冊 (`POST /signup`)
- 用戶登入 (`POST /login`)
- JWT Token 驗證

### 購物車功能
- 添加商品到購物車 (`POST /addtocart`)
- 從購物車移除商品 (`POST /removefromcart`)
- 獲取購物車內容 (`POST /getcart`)

### 檔案上傳
- 產品圖片上傳 (`POST /upload`)
- 靜態檔案服務 (`/images`)

## 環境變數

```env
PORT=4000
MONGODB_URI=your_mongodb_connection_string
BASE_URL=your_base_url
```

## 本地開發

1. 安裝依賴：
```bash
npm install
```

2. 啟動開發服務器：
```bash
npm start
```

3. API 將在 `http://localhost:4000` 運行

## 部署

### Vercel 部署
1. 連接 GitHub repository
2. 設置環境變數
3. 自動部署

### 資料庫結構

#### Products Collection
```javascript
{
  id: Number,
  name: String,
  image: String,
  category: String,
  new_price: Number,
  old_price: Number,
  description: String,
  categories: [String],
  tags: [String],
  date: Date,
  available: Boolean
}
```

#### Users Collection
```javascript
{
  name: String,
  email: String,
  password: String,
  cartData: Object,
  date: Date
}
```

## API 端點

| 方法 | 端點 | 描述 | 認證 |
|------|------|------|------|
| GET | `/` | 健康檢查 | 否 |
| GET | `/allproduct` | 獲取所有產品 | 否 |
| POST | `/addproduct` | 新增產品 | 否 |
| POST | `/removeproduct` | 刪除產品 | 否 |
| GET | `/newcollection` | 獲取新品推薦 | 否 |
| GET | `/popularinwomen` | 獲取熱門女裝 | 否 |
| POST | `/signup` | 用戶註冊 | 否 |
| POST | `/login` | 用戶登入 | 否 |
| POST | `/addtocart` | 添加到購物車 | 是 |
| POST | `/removefromcart` | 從購物車移除 | 是 |
| POST | `/getcart` | 獲取購物車 | 是 |
| POST | `/upload` | 上傳圖片 | 否 |

## 注意事項

- 所有需要認證的端點都需要在 Header 中包含 `auth-token`
- 圖片上傳目前存儲在本地 `upload/images` 目錄
- 生產環境建議使用雲端存儲服務（如 Cloudinary）
- 確保 MongoDB 連接字串的安全性

## 開發者

適用於電商網站的完整後端解決方案。
