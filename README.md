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

### 🔄 AI 混合搜索 (核心特色)
- **混合搜索引擎**: 結合向量語義搜索和全文搜索，使用 MongoDB $rankFusion
- **動態權重調整**: 根據查詢類型自動優化搜索策略
  - 品牌查詢: 全文搜索權重 70%
  - 描述性查詢: 向量搜索權重 80%
  - 預設平衡: 向量 60% + 全文 40%
- **智能降級機制**: 向量搜索失敗時自動降級到全文搜索
- **⭐ LLM 智能推薦**: GPT-4o 分析搜索結果，標記最符合需求的商品
- **精確匹配**: 點擊搜索建議進行精確匹配

### 前端功能
- 商品瀏覽和搜尋
- **🔄 AI 混合搜索頁面** (新增)
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

### 🔄 AI 混合搜索技術
- **MongoDB $rankFusion**: 混合搜索結果合併算法
- **OpenAI GPT-4o**: LLM 智能推薦分析
- **OpenAI Embeddings**: text-embedding-ada-002 (1536維)
- **MongoDB Atlas Vector Search**: 語意向量搜索
- **MongoDB Atlas Search**: 全文搜索引擎
- **Cloudinary**: 雲端圖片存儲和優化

### 前端
- React 19
- React Router 7
- Context API (狀態管理)
- **AISearch 組件**: 混合搜索界面

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

#### 2. MongoDB Atlas 索引設定
在 MongoDB Atlas 中創建兩個搜索索引：
- **向量搜索索引**: `vector_index`
- **全文搜索索引**: `product_text_search`
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

### AI 混合搜索流程
1. **用戶** 輸入自然語言查詢 (如: "黑色外套")
2. **系統** 動態權重調整，根據查詢類型選擇最佳搜索策略
3. **MongoDB $rankFusion** 同時執行：
   - **向量搜索**: 理解語義相似性
   - **全文搜索**: 精確關鍵詞匹配
4. **RRF 算法** 合併兩種搜索結果，計算綜合排名
5. **⭐ LLM 智能推薦** 分析搜索結果，標記最符合用戶需求的商品
6. **前端** 顯示混合搜索結果，推薦商品帶有金色 "⭐ AI 推薦" 徽章

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

### v3.0.0 - MongoDB 混合搜索 (2024年1月)
- 🔄 **混合搜索引擎**：結合向量搜索和全文搜索，使用 MongoDB $rankFusion
- ⚖️ **動態權重調整**：根據查詢類型自動優化搜索策略
- 🛡️ **智能降級機制**：向量搜索失敗時自動降級到全文搜索
- 🎯 **RRF 算法**：科學化的搜索結果排序和合併
- ⭐ **保留 LLM 推薦**：GPT-4o 智能推薦功能完整保留

### v2.1.0 - LLM 智能推薦 (2024年1月)
- ✨ **LLM 智能推薦標記**：GPT-4o 分析搜索結果，標記最符合需求的商品
- 🎨 **推薦徽章設計**：金色 "⭐ AI 推薦" 標記，右上角外側顯示
- 🔍 **推薦分析彈窗**：點擊徽章查看完整 AI 分析理由

### v2.0.0 - AI 智能搜索 (2024年1月)
- 🧠 **純語意向量搜索**：理解自然語言查詢意圖
- 🤖 **智能搜索分支**：純類別、語意搜索、智能篩選

---

**最新版本**: v3.0.0  
**最後更新**: 2024年1月