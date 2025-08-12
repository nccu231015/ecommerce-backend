const OpenAI = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

class SearchService {
  // 生成查詢向量
  async generateQueryVector(query) {
    try {
      console.log(`生成查詢向量: "${query}"`);
      
      const response = await openai.embeddings.create({
        model: "text-embedding-ada-002",
        input: query,
        encoding_format: "float"
      });
      
      const vector = response.data[0].embedding;
      console.log(`✅ 查詢向量生成成功 - 維度: ${vector.length}`);
      
      return vector;
    } catch (error) {
      console.error('❌ 查詢向量生成失敗:', error.message);
      return null;
    }
  }
  
  // 智能權重分配
  getSearchWeights(query) {
    const queryLower = query.toLowerCase();
    
    // 品牌關鍵字
    const brands = ['nike', 'puma', 'adidas', 'urban street'];
    const hasBrand = brands.some(brand => queryLower.includes(brand));
    
    // 價格相關關鍵字
    const priceKeywords = ['便宜', '貴', '元', '價格', '划算', '特價', '折扣'];
    const hasPrice = priceKeywords.some(keyword => queryLower.includes(keyword));
    
    // 顏色關鍵字
    const colors = ['黑色', '白色', '紅色', '藍色', '綠色', '黃色', '粉色', '紫色'];
    const hasColor = colors.some(color => queryLower.includes(color));
    
    // 情境關鍵字
    const contextKeywords = ['約會', '上班', '休閒', '運動', '派對', '聚會', '通勤'];
    const hasContext = contextKeywords.some(keyword => queryLower.includes(keyword));
    
    // 動態權重分配
    if (hasBrand || hasPrice || hasColor) {
      return { vector: 0.4, keyword: 0.6 }; // 精確匹配優先
    } else if (hasContext) {
      return { vector: 0.8, keyword: 0.2 }; // 語義理解優先
    } else {
      return { vector: 0.7, keyword: 0.3 }; // 默認平衡
    }
  }
  
  // 向量搜索 - 按照 MongoDB Atlas 官方規範實現
  async vectorSearch(database, queryVector, limit, filters = {}) {
    try {
      const filterConditions = {
        available: { $eq: true },
        ...filters
      };
      
      // 使用官方推薦的 $vectorSearch 聚合管道
      const results = await database.collection('products').aggregate([
        {
          $vectorSearch: {
            index: "product_search_index",           // 索引名稱
            path: "product_embedding",               // 向量字段路徑
            queryVector: queryVector,                // 查詢向量
            numCandidates: Math.max(limit * 10, 150), // 增加候選數量以提高準確性
            limit: limit,
            filter: filterConditions,
            exact: false                             // 使用 ANN (近似最近鄰) 搜索
          }
        },
        {
          $addFields: {
            search_type: "semantic",
            similarity_score: { $meta: "vectorSearchScore" },
            // RAG 增強：添加上下文信息
            search_context: {
              query_type: "semantic_vector",
              retrieval_method: "atlas_vector_search"
            }
          }
        },
        {
          $project: {
            id: 1,
            name: 1,
            image: 1,
            category: 1,
            new_price: 1,
            old_price: 1,
            description: 1,                          // 返回完整描述用於 RAG
            categories: 1,
            tags: 1,
            search_type: 1,
            similarity_score: 1,
            search_context: 1
          }
        },
        {
          $match: {
            similarity_score: { $gte: 0.1 }         // 過濾低相似度結果
          }
        }
      ]).toArray();
      
      console.log(`🔍 語義向量搜索找到 ${results.length} 個結果`);
      return results;
      
    } catch (error) {
      console.error('❌ 向量搜索失敗:', error.message);
      console.error('可能原因：向量索引未創建或配置錯誤');
      return [];
    }
  }
  
  // 關鍵字搜索
  async keywordSearch(database, query, limit, filters = {}) {
    try {
      const searchConditions = {
        $and: [
          { available: true },
          {
            $or: [
              { name: { $regex: query, $options: 'i' } },
              { description: { $regex: query, $options: 'i' } },
              { category: { $regex: query, $options: 'i' } },
              { categories: { $elemMatch: { $regex: query, $options: 'i' } } },
              { tags: { $elemMatch: { $regex: query, $options: 'i' } } }
            ]
          },
          ...Object.entries(filters).map(([key, value]) => ({ [key]: value }))
        ]
      };
      
      const results = await database.collection('products')
        .find(searchConditions)
        .limit(limit)
        .project({
          id: 1,
          name: 1,
          image: 1,
          category: 1,
          new_price: 1,
          old_price: 1,
          description: { $substr: ["$description", 0, 100] },
          categories: 1,
          tags: 1
        })
        .toArray();
      
      const resultsWithScore = results.map(item => ({
        ...item,
        search_type: "keyword",
        similarity_score: 0.5 // 固定分數
      }));
      
      console.log(`🔎 關鍵字搜索找到 ${results.length} 個結果`);
      return resultsWithScore;
      
    } catch (error) {
      console.error('❌ 關鍵字搜索失敗:', error.message);
      return [];
    }
  }
  
  // RAG 混合搜索 - 結合語義理解和關鍵字匹配
  async hybridSearch(database, query, options = {}) {
    const {
      limit = 10,
      filters = {},
      enableVector = true,
      enableKeyword = true
    } = options;
    
    console.log(`🚀 開始 RAG 混合搜索: "${query}"`);
    
    const weights = this.getSearchWeights(query);
    console.log(`⚖️ 動態權重分配 - 語義: ${weights.vector}, 關鍵字: ${weights.keyword}`);
    
    // 增加搜索範圍以提高召回率
    const vectorLimit = Math.ceil(limit * weights.vector * 1.5);
    const keywordLimit = Math.ceil(limit * weights.keyword * 1.5);
    
    const searchPromises = [];
    
    // RAG 第一步：檢索 (Retrieval) - 語義向量搜索
    if (enableVector) {
      const queryVector = await this.generateQueryVector(query);
      if (queryVector) {
        console.log(`🧠 執行語義檢索，目標: ${vectorLimit} 個候選`);
        searchPromises.push(this.vectorSearch(database, queryVector, vectorLimit, filters));
      } else {
        console.log(`⚠️ 向量生成失敗，跳過語義搜索`);
        searchPromises.push(Promise.resolve([]));
      }
    } else {
      searchPromises.push(Promise.resolve([]));
    }
    
    // RAG 第一步：檢索 (Retrieval) - 關鍵字搜索
    if (enableKeyword) {
      console.log(`🔍 執行關鍵字檢索，目標: ${keywordLimit} 個候選`);
      searchPromises.push(this.keywordSearch(database, query, keywordLimit, filters));
    } else {
      searchPromises.push(Promise.resolve([]));
    }
    
    const [vectorResults, keywordResults] = await Promise.all(searchPromises);
    
    // RAG 第二步：增強 (Augmentation) - 合併和評分
    const enhancedResults = this.enhanceSearchResults(vectorResults, keywordResults, weights, query);
    
    // RAG 第三步：生成 (Generation) - 排序和過濾最相關結果
    const finalResults = enhancedResults
      .sort((a, b) => (b.final_score || 0) - (a.final_score || 0))
      .slice(0, limit)
      .map(item => ({
        ...item,
        // 添加 RAG 上下文信息
        rag_context: {
          retrieval_confidence: item.final_score,
          search_strategy: item.search_type === 'semantic' ? 'vector_embedding' : 'keyword_matching',
          query_intent: this.analyzeQueryIntent(query)
        }
      }));
    
    console.log(`✅ RAG 混合搜索完成`);
    console.log(`📊 檢索統計 - 語義: ${vectorResults.length}, 關鍵字: ${keywordResults.length}`);
    console.log(`🎯 最終結果: ${finalResults.length} 個高相關性商品`);
    
    return {
      results: finalResults,
      breakdown: {
        vector_results: vectorResults.length,
        keyword_results: keywordResults.length,
        total_unique: finalResults.length,
        weights: weights,
        rag_method: "hybrid_retrieval_augmented_generation"
      }
    };
  }
  
  // RAG 增強：結果合併和評分
  enhanceSearchResults(vectorResults, keywordResults, weights, originalQuery) {
    const allResults = [];
    
    // 處理語義搜索結果
    vectorResults.forEach(item => {
      allResults.push({
        ...item,
        final_score: (item.similarity_score || 0.5) * weights.vector,
        search_type: 'semantic',
        relevance_reason: '語義相似性匹配'
      });
    });
    
    // 處理關鍵字搜索結果（去重）
    keywordResults.forEach(item => {
      const existingIndex = allResults.findIndex(existing => existing.id === item.id);
      if (existingIndex >= 0) {
        // 如果已存在，增強分數（混合信號）
        allResults[existingIndex].final_score += (item.similarity_score || 0.5) * weights.keyword;
        allResults[existingIndex].search_type = 'hybrid';
        allResults[existingIndex].relevance_reason = '語義+關鍵字雙重匹配';
      } else {
        // 新結果
        allResults.push({
          ...item,
          final_score: (item.similarity_score || 0.5) * weights.keyword,
          search_type: 'keyword',
          relevance_reason: '關鍵字精確匹配'
        });
      }
    });
    
    return allResults;
  }
  
  // 分析查詢意圖（用於 RAG 上下文）
  analyzeQueryIntent(query) {
    const queryLower = query.toLowerCase();
    
    if (/品牌|牌子|brand/.test(queryLower)) return 'brand_focused';
    if (/顏色|色|color/.test(queryLower)) return 'color_focused';
    if (/價格|便宜|貴|元|price/.test(queryLower)) return 'price_focused';
    if (/約會|聚會|派對|上班|運動/.test(queryLower)) return 'occasion_focused';
    if (/風格|款式|style/.test(queryLower)) return 'style_focused';
    
    return 'general_product_search';
  }
}

module.exports = new SearchService();
