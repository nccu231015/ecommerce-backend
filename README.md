# 電商網站專案

這是一個完整的電子商務網站解決方案，包含前端客戶界面、後端 API 服務和管理員後台三個主要部分。

## 專案架構

```
Ecommerce Website/
├── frontend/       # 客戶端網站 (React)
├── backend/        # API 服務 (Express + MongoDB)
└── admin/          # 管理員後台 (React + Vite)
```

## 功能概述

### 🧠 AI 智能搜索 (核心特色)
- **純語意向量搜索**: 理解自然語言查詢意圖
- **智能查詢分析**: 使用 GPT-4o 提取關鍵詞和篩選條件
- **智能搜索分支**: 
  - 純類別搜索 (女裝、男裝、童裝)
  - 語意搜索 (黑色外套、約會穿的)
  - 智能篩選 (價格1000以下的商品)
- **⭐ LLM 智能推薦**: GPT-4o 分析搜索結果，標記最符合需求的商品
- **精確匹配**: 點擊搜索建議進行精確匹配

### 前端功能
- 商品瀏覽和搜尋
- **🎯 AI 語意搜索頁面** (新增)
- 商品類別頁面 (男裝、女裝、兒童裝)
- 商品詳情頁面
- 購物車功能
- 用戶註冊和登入
- 訂單管理

### 後端功能
- RESTful API
- **🤖 AI 搜索 API** (新增)
- **向量化服務** (OpenAI Embeddings)
- 使用者認證 (JWT)
- 產品管理 API
- 購物車數據存儲
- 圖片上傳服務 (Cloudinary)

### 管理員後台
- 產品新增和管理
- **自動向量化**: 新產品上傳時自動生成向量
- 產品圖片上傳 (Cloudinary)
- 產品描述、類別、標籤管理
- 產品下架功能

## 技術棧

### 🧠 AI 搜索技術
- **OpenAI GPT-4o**: 自然語言查詢分析
- **OpenAI Embeddings**: text-embedding-ada-002 (1536維)
- **MongoDB Atlas Vector Search**: 語意向量搜索
- **Cloudinary**: 雲端圖片存儲和優化

### 前端
- React 19
- React Router 7
- Context API (狀態管理)
- **AISearch 組件**: 智能搜索界面

### 後端
- Express.js
- **MongoDB Atlas**: 雲端資料庫 + 向量搜索
- **SearchService**: AI 搜索邏輯封裝
- JWT (認證)
- Multer (檔案上傳)

### 管理員後台
- React 19
- Vite 6 (構建工具)
- React Router 7

## 快速開始

### 環境設定

#### 1. 設定環境變數
在 `backend/` 目錄下創建 `.env` 檔案：

```bash
# OpenAI API (AI 搜索必需)
OPENAI_API_KEY=sk-your-openai-key

# MongoDB Atlas (向量搜索必需)
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/database

# Cloudinary (圖片存儲)
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=your-api-key
CLOUDINARY_API_SECRET=your-api-secret
```

#### 2. MongoDB Atlas 向量索引設定
在 MongoDB Atlas 中創建向量搜索索引：
- 索引名稱: `vector_index`
- 詳細設定請參考: [AI_SEARCH_README.md](AI_SEARCH_README.md)

### 本地開發

#### 1. 啟動後端服務

```bash
cd backend
npm install
node index.js
```

後端服務將在 http://localhost:4000 運行

#### 2. 啟動前端網站

```bash
cd frontend
npm install
npm start
```

前端將在 http://localhost:3000 運行

#### 3. 啟動管理員後台

```bash
cd admin
npm install
npm run dev
```

管理員後台將在 http://localhost:5173 運行

## 🔄 資料流程

### AI 搜索流程
1. **用戶** 輸入自然語言查詢 (如: "我要找童裝，價格1000以下")
2. **GPT-4o** 分析查詢，提取關鍵詞和篩選條件
3. **系統** 智能判斷搜索類型：
   - 純類別查詢 → 直接返回該類別所有商品
   - 描述性查詢 → 語意向量搜索
4. **MongoDB Atlas** 執行向量搜索，返回相似商品
5. **⭐ LLM 智能推薦** 分析搜索結果，標記最符合用戶需求的商品
6. **前端** 顯示搜索結果，推薦商品帶有金色 "⭐ AI 最推薦" 徽章

### 商品管理流程
1. **管理員** 通過後台添加產品 (名稱、描述、圖片、價格等)
2. **系統** 自動生成產品向量 (OpenAI Embeddings)
3. **用戶** 瀏覽商品、使用 AI 搜索、添加到購物車
4. 購物車數據同步到後端資料庫

## 🚀 線上部署

### Vercel 部署連結
- **前端**: https://ecommerce-frontend-theta-mauve.vercel.app
- **後端**: https://ecommerce-backend-indol-xi.vercel.app
- **管理後台**: https://ecommerce-admin-amber.vercel.app

### 部署設定
詳細部署步驟請參考各子目錄的部署說明。

## 📋 環境需求

- Node.js 18+
- **MongoDB Atlas** (向量搜索支援)
- **OpenAI API Key** (AI 搜索功能)
- **Cloudinary 帳戶** (圖片存儲)
- 網路連線 (API 通訊)

## 📚 詳細文檔

- **AI 搜索系統**: [AI_SEARCH_README.md](AI_SEARCH_README.md)
- **部署指南**: 各子目錄 README
- **API 文檔**: 後端 API 端點說明

## 🎯 最新更新

### v2.1.0 - LLM 智能推薦 (2024年1月)
- ✨ **新增 LLM 智能推薦標記**：GPT-4o 分析搜索結果，自動標記最符合用戶需求的商品
- 🎨 **推薦徽章設計**：金色 "⭐ AI 最推薦" 標記，頂部中央顯示不遮擋內容
- 💡 **推薦理由提示**：懸停顯示 AI 推薦原因，提升用戶體驗
- 🔧 **視覺優化**：金邊框突出、閃爍動畫、響應式設計

### v2.0.0 - AI 智能搜索 (2024年1月)
- 🧠 **純語意向量搜索**：理解自然語言查詢意圖
- 🤖 **智能搜索分支**：純類別、語意搜索、智能篩選
- 🎯 **精確匹配**：點擊搜索建議功能

---

**最新版本**: v2.1.0  
**最後更新**: 2024年1月