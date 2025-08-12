# 🧠 AI 智能搜索系統

## 概述

這個電商網站實現了基於 AI 的智能搜索系統，結合了自然語言處理、向量搜索和智能篩選技術，為用戶提供精準的商品搜索體驗。

## 🔧 技術架構

### 核心技術棧
- **LLM 模型**: OpenAI GPT-4o (查詢優化)
- **向量化**: OpenAI text-embedding-ada-002 (1536維)
- **向量搜索**: MongoDB Atlas Vector Search
- **資料庫**: MongoDB Atlas
- **後端**: Node.js + Express
- **前端**: React

## 🔄 搜索流程

### 智能搜索分支 🧠

系統會自動判斷查詢類型，採用不同的搜索策略：

#### **分支 A: 純類別搜索** 🏷️
**觸發條件**: 查詢為純類別詞（女裝、男裝、童裝、兒童、小孩、女生、男生、女性、男性）

```javascript
// 用戶輸入: "女裝"
// 直接類別搜索，跳過向量搜索
{
  "search_method": "pure_category_search",
  "results": [所有女裝商品],
  "similarity_score": 1.0
}
```

**流程**:
1. **LLM 分析** → 識別類別
2. **直接篩選** → `category = "women" AND available = true`
3. **返回結果** → 該類別所有商品

#### **分支 B: 智能語義搜索** 🤖
**觸發條件**: 描述性查詢或帶條件的查詢

```javascript
// 用戶輸入: "我要找童裝，價格1000以下"
// GPT-4o 分析結果:
{
  "keywords": "童裝 兒童",
  "filters": {
    "maxPrice": 1000,
    "category": "kid"
  }
}
```

**流程**:
1. **LLM 查詢分析** 🤖
   - 使用 GPT-4o 提取關鍵詞和篩選條件
   
2. **預篩選階段** 🔍
   - 基於 LLM 提取的條件先篩選商品集合
   - 價格篩選: `new_price ≤ 1000`
   - 類別篩選: `category = "kid"`
   - 可用性: `available = true`

3. **向量搜索** 🧠
   - 將優化後的關鍵詞轉換為 1536 維向量
   - 在 MongoDB Atlas 中執行語義搜索
   - 相似度閾值: `≥ 0.9`

4. **結果交集** 🎯
   - 取預篩選結果與向量搜索結果的交集
   - 按相似度分數排序
   - 返回最終結果

## 📊 搜索方法對比

| 搜索類型 | 優勢 | 使用場景 | 示例 |
|---------|------|----------|------|
| **純類別搜索** | 快速完整，返回所有該類別商品 | 純類別詞查詢 | "女裝"、"童裝"、"男裝" |
| **智能語義搜索** | 理解語義，支援自然語言 | 描述性查詢 | "適合約會的黑色外套" |
| **智能篩選搜索** | 自動提取條件，精準篩選 | 帶條件查詢 | "童裝，價格1000以下" |
| **精確匹配** | 快速準確 | 點擊搜索建議 | 點擊 "三色拼接連帽上衣" |

## 🛠️ 核心組件

### SearchService 類
位置: `backend/services/searchService.js`

#### 主要方法：

1. **`optimizeSearchQuery(query)`**
   - 使用 GPT-4o 分析自然語言查詢
   - 提取關鍵詞和篩選條件
   - 處理 markdown 格式的 JSON 回應

2. **`generateQueryVector(query)`**
   - 使用 OpenAI Embedding API
   - 將文字轉換為 1536 維向量

3. **`isPureCategoryQuery(originalQuery, llmFilters)`** ⭐ **新增**
   - 判斷是否為純類別查詢
   - 支援類別詞：女裝、男裝、童裝、兒童、小孩、女生、男生、女性、男性

4. **`handlePureCategorySearch(database, filters, limit)`** ⭐ **新增**
   - 處理純類別搜索邏輯
   - 跳過向量搜索，直接返回該類別所有商品

5. **`preFilterProducts(database, filters)`**
   - 基於價格、類別等條件預篩選
   - 使用 MongoDB Aggregation Pipeline

6. **`vectorSearch(database, queryVector, limit, filters)`**
   - MongoDB Atlas Vector Search
   - 支援複雜篩選條件

7. **`vectorOnlySearch(database, query, limit, filters)`**
   - 主要搜索入口
   - 智能分支：純類別 vs 語義搜索
   - 整合 LLM 分析 + 預篩選 + 向量搜索

## 🎯 API 端點

### 主要搜索 API
```http
POST /ai-search
Content-Type: application/json

{
  "query": "我要找童裝，價格1000以下",
  "limit": 10,
  "filters": {}
}
```

**回應格式:**

**純類別搜索回應:**
```json
{
  "success": true,
  "results": [
    {
      "id": "...",
      "name": "黑色格紋短版仿皮草外套",
      "price": "2480",
      "category": "women",
      "similarity_score": 1.0,
      "search_type": "category"
    }
  ],
  "breakdown": {
    "pre_filtered": 4,
    "vector_results": 0,
    "total_results": 4,
    "search_method": "pure_category_search"
  }
}
```

**語義搜索回應:**
```json
{
  "success": true,
  "results": [
    {
      "id": "...",
      "name": "三色拼接連帽上衣－深藍/白/黃",
      "price": "880",
      "category": "kid",
      "similarity_score": 0.925,
      "search_type": "semantic"
    }
  ],
  "breakdown": {
    "pre_filtered": 5,
    "vector_results": 3,
    "total_results": 2,
    "search_method": "llm_pre_filter + vector_search"
  }
}
```

### 精確匹配 API
```http
POST /exact-search
Content-Type: application/json

{
  "query": "三色拼接連帽上衣－深藍/白/黃"
}
```

### 調試 API
```http
POST /test-llm-optimization
Content-Type: application/json

{
  "query": "童裝，價格1000以下"
}
```

## 🗃️ 資料庫結構

### 商品文檔結構
```javascript
{
  "_id": ObjectId,
  "id": Number,
  "name": String,
  "image": String,  // Cloudinary URL
  "category": String,  // "men", "women", "kid"
  "new_price": String,
  "old_price": String,
  "description": String,
  "categories": Array,
  "tags": Array,
  "available": Boolean,
  "product_embedding": Array,  // 1536維向量
  "vector_generated_at": Date,
  "embedding_model": String
}
```

### MongoDB Atlas 向量索引
```json
{
  "fields": [
    {
      "type": "vector",
      "path": "product_embedding",
      "numDimensions": 1536,
      "similarity": "cosine"
    },
    {
      "type": "filter",
      "path": "available"
    },
    {
      "type": "filter",
      "path": "category"
    }
  ]
}
```

## 🔧 配置設定

### 環境變數
```bash
# OpenAI API
OPENAI_API_KEY=sk-...

# MongoDB
MONGODB_URI=mongodb+srv://...

# Cloudinary
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
```

### 搜索參數
```javascript
// 相似度閾值
const SIMILARITY_THRESHOLD = 0.9;

// 向量搜索參數
const VECTOR_SEARCH_CONFIG = {
  numCandidates: Math.max(limit * 20, 200),
  limit: Math.max(limit * 2, 10)
};
```

## 🎨 前端整合

### AISearch 組件
位置: `frontend/src/Components/AISearch/AISearch.jsx`

**功能特點:**
- 即時搜索建議
- 載入狀態顯示
- 響應式網格佈局 (4列)
- 精確匹配點擊

### 路由配置
```javascript
// App.js
<Route path="/search" element={<Search />} />
```

### 導航整合
```javascript
// Navbar.jsx
<Link to="/search">🧠 AI 語意搜索</Link>
```

## 🚀 部署配置

### Vercel 設定
```json
{
  "version": 2,
  "builds": [
    {
      "src": "index.js",
      "use": "@vercel/node"
    }
  ],
  "routes": [
    {
      "src": "/(.*)",
      "dest": "index.js"
    }
  ]
}
```

### CORS 設定
```javascript
app.use(cors({
  origin: [
    'http://localhost:3000',
    'https://ecommerce-frontend-theta-mauve.vercel.app',
    'https://ecommerce-admin-amber.vercel.app'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'auth-token'],
  credentials: true
}));
```

## 📈 性能優化

### 搜索優化策略
1. **智能搜索分支**: 純類別查詢跳過向量搜索，直接返回結果
2. **LLM 預篩選**: 減少向量搜索範圍
3. **向量索引**: MongoDB Atlas 優化
4. **結果快取**: 避免重複計算
5. **批次處理**: 提高響應速度

### 監控指標
- 搜索響應時間
- LLM 優化成功率
- 向量搜索準確度
- 用戶搜索滿意度

## 🐛 故障排除

### 常見問題

1. **LLM 優化失敗**
   ```
   ⚠️ JSON 解析失敗，使用原始查詢
   ```
   **解決**: 檢查 OpenAI API Key 和網路連接

2. **向量搜索無結果**
   ```
   vector_results: 0
   ```
   **解決**: 檢查 MongoDB Atlas 向量索引設定

3. **價格篩選失效**
   ```
   pre_filtered: 0
   ```
   **解決**: 確認價格欄位格式 (字串 vs 數字)

### 調試方法
```bash
# 測試 LLM 優化
curl -X POST "/test-llm-optimization" -d '{"query": "童裝"}'

# 檢查搜索結果
curl -X POST "/ai-search" -d '{"query": "童裝", "limit": 5}'
```

## 🔮 未來改進

### 計劃功能
- [x] **智能搜索分支** - 純類別查詢優化 ✅ **已完成**
- [x] **⭐ LLM 智能推薦** - GPT-4o 分析搜索結果推薦 ✅ **已完成**
- [ ] 搜索結果個人化
- [ ] 多語言支援
- [ ] 圖像搜索整合
- [ ] 即時搜索分析
- [ ] A/B 測試框架

### 技術升級
- [x] **純類別搜索邏輯** - 提高類別查詢效率 ✅ **已完成**
- [x] **LLM 推薦標記系統** - 智能推薦最符合需求商品 ✅ **已完成**
- [ ] 更新到最新的 Embedding 模型
- [ ] 實現混合搜索 (Hybrid Search)
- [ ] 增加搜索結果解釋性
- [ ] 優化向量索引配置

---

## 📋 更新日誌

### v2.1.0 - LLM 智能推薦 (2024年1月)
- ✨ **新增 `addLLMRecommendation()` 函數**：GPT-4o 分析搜索結果
- 🎯 **推薦標記邏輯**：自動標記最符合用戶需求的商品
- 🎨 **前端推薦徽章**：金色 "⭐ AI 最推薦" 標記
- 💡 **推薦理由提示**：懸停顯示 AI 推薦原因
- 🔧 **視覺優化**：頂部中央顯示，不遮擋商品內容

### v2.0.0 - 純語意向量搜索 (2024年1月)
- 🧠 **純語意向量搜索**：移除混合搜索邏輯
- 🤖 **智能搜索分支**：純類別、語意搜索、智能篩選
- 🎯 **精確匹配**：點擊搜索建議功能

---

**最新版本**: v2.1.0  
**最後更新**: 2024年1月  
**維護者**: AI Assistant
