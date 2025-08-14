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

### 🧠 LLM 預處理混合搜索 (核心特色)

#### **🤖 智能查詢預處理系統**
- **自然語言理解**: GPT-4o 分析用戶意圖，提取核心關鍵詞
- **同義詞處理**: 智能處理「衣服」→「上衣/外套」等同義詞
- **查詢優化**: 移除無意義詞彙（給我、全部的、好看的）
- **多語言支持**: 中英文查詢處理

**預處理範例**：
```
「給我全部的外套」      → 「外套」
「黑色的運動外套」      → 「黑色 運動 外套」  
「PUMA的綠色連帽衫」    → 「PUMA 綠色 連帽」
「運動服」            → 「運動」
「綠色衣服」          → 「綠色」
```

#### **🔍 混合搜索架構**
- **向量搜索**: OpenAI Embeddings + MongoDB Atlas Vector Search
- **全文搜索**: MongoDB Atlas Search + 多關鍵詞 must 條件
- **語義增強**: Semantic Boosting 技術提升相關商品分數
- **智能降級**: 三層容錯機制確保搜索穩定性

#### **🎯 搜索精度優化**
- **雙重查詢策略**: phrase 查詢（2.0x 加權）+ text 查詢（1.0x 加權）
- **精確匹配優先**: phrase 查詢處理精確關鍵詞匹配，獲得更高分數
- **靈活備用匹配**: text 查詢處理複合查詢和自然語言
- **智能分數加權**: 精確匹配獲得雙倍分數，靈活匹配獲得基礎分數
- **相似度閾值**: 0.75 高品質語義匹配過濾
- **分數融合**: 向量相似度 + 全文搜索分數智能結合
- **結果排序**: 精確匹配 > 靈活匹配 > 語義相關性

#### **⭐ AI 智能推薦系統**
- **深度分析**: GPT-4o 分析搜索結果和用戶查詢意圖
- **價格考量**: 推薦時考慮商品價格和性價比
- **個性化**: 根據查詢類型提供針對性推薦理由
- **透明化**: 提供詳細的推薦分析和理由

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

### 🤖 AI & 機器學習
- **LLM 服務**: OpenAI GPT-4o (查詢預處理 + 智能推薦)
- **向量化模型**: OpenAI text-embedding-ada-002 (1536 維向量)
- **自然語言處理**: 查詢意圖分析、關鍵詞提取、同義詞處理

### 🗄️ 資料庫 & 搜索
- **資料庫**: MongoDB Atlas 
- **向量搜索**: MongoDB Atlas Vector Search (cosine similarity)
- **全文搜索**: MongoDB Atlas Search (多關鍵詞匹配)
- **混合搜索**: Semantic Boosting 語義增強技術
- **索引**: vector_index (向量) + product_text_search (全文)

### 🚀 後端架構
- **運行環境**: Node.js 18+
- **Web 框架**: Express.js
- **搜索服務**: SearchService 類封裝搜索邏輯
- **API 設計**: RESTful API + JSON 回應格式
- **錯誤處理**: 智能降級機制 + 異常捕獲

### ☁️ 部署 & 儲存
- **後端部署**: Vercel Serverless Functions
- **圖片儲存**: Cloudinary CDN
- **環境管理**: dotenv 配置管理
- **CORS**: 跨域請求支持

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

### 🔄 AI 搜索流程圖

```mermaid
graph TD
    A["用戶輸入查詢<br/>例：「給我全部的外套」"] --> B["🧠 LLM 預處理<br/>GPT-4o 關鍵詞提取"]
    
    B --> C["提取結果<br/>「外套」"]
    C --> D["🔍 向量化處理<br/>OpenAI Embeddings"]
    
    D --> E["📊 向量搜索<br/>MongoDB $vectorSearch<br/>相似度閾值: 0.75"]
    E --> F["獲得語義相似商品<br/>用於分數增強"]
    
    F --> G["🔎 混合搜索<br/>MongoDB $search"]
    G --> H["多關鍵詞 must 條件<br/>每個詞都必須匹配"]
    H --> I["語義增強<br/>向量結果提升分數"]
    
    I --> J{"搜索成功？"}
    J -->|成功| K["📋 搜索結果"]
    J -->|失敗| L["🔄 智能降級<br/>向量搜索"]
    L --> M{"向量搜索成功？"}
    M -->|成功| K
    M -->|失敗| N["📝 全文搜索<br/>最終降級"]
    N --> K
    
    K --> O["🤖 LLM 智能推薦<br/>GPT-4o 分析前5個結果"]
    O --> P["標記推薦商品<br/>llm_recommended: true"]
    P --> Q["📱 前端顯示<br/>⭐ AI 推薦標記"]
    
    style A fill:#e1f5fe
    style B fill:#f3e5f5
    style C fill:#f3e5f5
    style G fill:#e8f5e8
    style O fill:#fff3e0
    style Q fill:#fce4ec
```

### 🧠 詳細搜索流程說明
1. **用戶輸入**: 自然語言查詢 (如: "給我全部的外套", "黑色運動服")
2. **🤖 LLM 預處理**: GPT-4o 智能分析，提取核心關鍵詞
   - 「給我全部的外套」→ 「外套」
   - 「黑色運動服」→ 「黑色 運動」
   - 「綠色衣服」→ 「綠色」
3. **🔍 向量化處理**: OpenAI text-embedding-ada-002 生成 1536 維向量
4. **📊 向量搜索**: MongoDB Atlas Vector Search 找到語義相似商品
5. **🔎 混合搜索**: 雙重查詢策略（phrase + text）+ 語義增強分數提升
6. **🛡️ 智能降級**: 三層降級保護確保始終有結果
7. **🤖 LLM 智能推薦**: GPT-4o 分析結果，選擇最佳推薦
8. **📱 前端展示**: 顯示搜索結果和 AI 推薦標記

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

### v5.3.0 - 雙重查詢策略穩定版 (2025年1月) 🚀 [最新穩定版]
- 🔧 **緊急修復**：解決 wildcard 查詢導致的搜索失敗問題
- 🎯 **雙重查詢策略**：phrase 查詢（精確匹配）+ text 查詢（靈活匹配）
- ⚖️ **智能分數加權**：精確匹配 2.0x 分數，靈活匹配 1.0x 分數
- ⚡ **修復搜索穩定性**：解決「運動服」等查詢完全失敗的問題
- 🧠 **保持智能預處理**：GPT-4o 同義詞處理和查詢優化
- 📊 **技術改進**：
  - `phrase` 查詢優先處理精確關鍵詞
  - `text` 查詢備用處理複合查詢
  - `minimumShouldMatch: 1` 確保至少匹配一個條件
- 🔄 **完整流程圖**：Mermaid 搜索流程圖展示完整 AI 搜索過程
- ⭐ **LLM 推薦系統**：智能推薦功能完整保留

### v5.2.0 - Wildcard 精確搜索優化 (2025年1月) ❌ [已廢棄]
- ❌ **兼容性問題**：wildcard 查詢在某些情況下導致搜索完全失敗
- 📝 **建議**：使用 v5.3.0 的雙重查詢策略

### v5.1.0 - 多關鍵詞智能搜索 (2025年1月) [已升級]
- 🔍 **多關鍵詞匹配**：從單一 phrase 改為多個查詢，每個關鍵詞都必須匹配
- 🎯 **同義詞處理**：智能處理「衣服」→「上衣/外套」等同義詞關係
- ⚡ **修復搜索問題**：解決「黑色外套」「綠色衣服」等多詞查詢失敗問題

### v5.0.0 - LLM 預處理精確搜索 (2025年1月) [已升級]
- 🧠 **智能查詢預處理**：GPT-4o 將自然語言轉換成精確關鍵詞
- 🎯 **精確匹配優先**：移除模糊 `text` 搜索，只保留 `phrase` 精確匹配
- ⚡ **高精度結果**：確保搜索結果高度相關，避免無關商品干擾

### v4.1.0 - MongoDB 語義增強混合搜索 (2025年1月) [已升級]
- 🎯 **語義增強實現**：採用 MongoDB 官方 Semantic Boosting 技術
- 📚 **符合官方最佳實踐**：遵循 MongoDB 混合搜索官方文檔的語義增強方法
- 🚀 **更廣泛的相容性**：適用於所有 MongoDB Atlas 版本，解決 `$rankFusion` 相容性問題
- ⚖️ **智能分數增強**：向量搜索結果動態提升全文搜索排名
- 🎯 **相似度閾值優化**：0.75 高品質閾值確保精準匹配
- 🛡️ **保留智能降級機制**：混合→向量→全文 三層降級保護
- ⭐ **保留 LLM 推薦**：GPT-4o 智能推薦功能完整保留

### v4.0.0 - MongoDB 官方 `$rankFusion` 實現 (2025年1月) [相容性問題]
- 🎯 **官方 RRF 實現**：採用 MongoDB 官方 `$rankFusion` 聚合階段
- 📚 **符合官方最佳實踐**：遵循 MongoDB 混合搜索官方文檔
- 🚀 **簡化管道結構**：更高的性能和穩定性
- ⚖️ **保留動態權重調整**：根據查詢類型自動優化搜索策略
- 🛡️ **保留智能降級機制**：混合→向量→全文 三層降級保護
- ⭐ **保留 LLM 推薦**：GPT-4o 智能推薦功能完整保留

### v3.1.0 - 手動融合混合搜索 (2025年1月) [已棄用]
- 🔧 **相容性升級**：支援 MongoDB 8.0.12+ 版本，移除 `$rankFusion` 依賴
- 🔄 **手動融合算法**：使用 `$unionWith` + `$group` 實現混合搜索
- ⚖️ **動態權重調整**：根據查詢類型自動優化搜索策略
- 🛡️ **智能降級機制**：混合→向量→全文 三層降級保護
- 📊 **融合分數計算**：`combinedScore = vectorWeight × vectorRank + textWeight × textRank`
- ⭐ **保留 LLM 推薦**：GPT-4o 智能推薦功能完整保留

### v2.1.0 - LLM 智能推薦 (2024年1月)
- ✨ **LLM 智能推薦標記**：GPT-4o 分析搜索結果，標記最符合需求的商品
- 🎨 **推薦徽章設計**：金色 "⭐ AI 推薦" 標記，右上角外側顯示
- 🔍 **推薦分析彈窗**：點擊徽章查看完整 AI 分析理由

### v2.0.0 - AI 智能搜索 (2024年1月)
- 🧠 **純語意向量搜索**：理解自然語言查詢意圖
- 🤖 **智能搜索分支**：純類別、語意搜索、智能篩選

---

**最新版本**: v4.1.0  
**最後更新**: 2025年1月