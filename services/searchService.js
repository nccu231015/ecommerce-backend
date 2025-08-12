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
    
    // 動態權重分配 - 提高向量搜索比重
    if (hasBrand || hasPrice || hasColor) {
      return { vector: 0.6, keyword: 0.4 }; // 精確匹配時仍優先語義理解
    } else if (hasContext) {
      return { vector: 0.85, keyword: 0.15 }; // 情境查詢強化語義理解
    } else {
      return { vector: 0.8, keyword: 0.2 }; // 默認以語義為主
    }
  }
  
  // 向量搜索 - 按照 MongoDB Atlas 官方規範實現
  async vectorSearch(database, queryVector, limit, filters = {}) {
    try {
      console.log(`🧠 開始向量搜索，查詢向量維度: ${queryVector?.length || 'undefined'}`);
      
      if (!queryVector || !Array.isArray(queryVector)) {
        console.error('❌ 查詢向量無效');
        return [];
      }
      
      // 構建篩選條件
      const filterConditions = {
        available: { $eq: true }
      };
      
      // 處理價格篩選（資料庫中價格是字符串，需要轉換比較）
      if (filters.minPrice || filters.maxPrice) {
        const priceConditions = [];
        
        if (filters.minPrice) {
          priceConditions.push({
            $expr: { $gte: [{ $toInt: "$new_price" }, parseInt(filters.minPrice)] }
          });
        }
        
        if (filters.maxPrice) {
          priceConditions.push({
            $expr: { $lte: [{ $toInt: "$new_price" }, parseInt(filters.maxPrice)] }
          });
        }
        
        if (priceConditions.length > 0) {
          filterConditions.$and = filterConditions.$and || [];
          filterConditions.$and.push(...priceConditions);
        }
      }
      
      // 處理類別篩選
      if (filters.category) {
        filterConditions.category = { $regex: filters.category, $options: 'i' };
      }
      
      // 處理標籤篩選
      if (filters.categories && Array.isArray(filters.categories)) {
        filterConditions.categories = { $in: filters.categories };
      }
      
      // 添加其他篩選條件（排除已處理的）
      Object.keys(filters).forEach(key => {
        if (!['minPrice', 'maxPrice', 'category', 'categories'].includes(key)) {
          filterConditions[key] = filters[key];
        }
      });
      
      console.log(`🔍 向量搜索過濾條件:`, filterConditions);
      
      // 使用官方推薦的 $vectorSearch 聚合管道
      const pipeline = [
        {
          $vectorSearch: {
            index: "vector_index",                   // 索引名稱
            path: "product_embedding",               // 向量字段路徑
            queryVector: queryVector,                // 查詢向量
            numCandidates: Math.max(limit * 20, 200), // 增加候選數量以提高召回率
            limit: Math.max(limit * 2, 10),         // 增加初始限制
            filter: filterConditions
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
            similarity_score: { $gte: 0.9 }         // 保持高相似度閾值，結合類別篩選確保精準性
          }
        },
        {
          $sort: {
            similarity_score: -1                     // 按相似度排序
          }
        },
        {
          $limit: limit                             // 最終限制結果數量
        }
      ];
      
      console.log(`🔍 執行向量搜索管道:`, JSON.stringify(pipeline[0], null, 2));
      
      const results = await database.collection('products').aggregate(pipeline).toArray();
      
      console.log(`🔍 語義向量搜索找到 ${results.length} 個結果`);
      if (results.length > 0) {
        console.log(`📊 相似度分數範圍: ${Math.min(...results.map(r => r.similarity_score)).toFixed(3)} - ${Math.max(...results.map(r => r.similarity_score)).toFixed(3)}`);
        console.log(`📝 結果樣本:`, results.slice(0, 2).map(r => ({ 
          name: r.name, 
          score: r.similarity_score?.toFixed(3) 
        })));
      }
      
      return results;
      
    } catch (error) {
      console.error('❌ 向量搜索失敗:', error.message);
      console.error('❌ 錯誤詳情:', error);
      return [];
    }
  }
  
  // 關鍵字搜索 - 支持多關鍵字搜索
  async keywordSearch(database, query, limit, filters = {}) {
    try {
      // 將查詢分割成多個關鍵字（支持空格和中文標點分隔）
      const keywords = query.trim().split(/[\s,，、]+/).filter(k => k.length > 0);
      console.log(`🔍 關鍵字分割結果: [${keywords.join(', ')}]`);
      
      // 如果沒有有效關鍵字，返回空結果
      if (keywords.length === 0) {
        console.log(`⚠️ 沒有有效關鍵字，返回空結果`);
        return [];
      }
      
      let searchConditions;
      
      if (keywords.length === 1) {
        // 單個關鍵字：使用原來的邏輯
        searchConditions = {
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
      } else {
        // 多個關鍵字：每個關鍵字都必須在任意字段中匹配（AND 邏輯，但允許跨字段）
        const keywordConditions = keywords.map(keyword => ({
          $or: [
            { name: { $regex: keyword, $options: 'i' } },
            { description: { $regex: keyword, $options: 'i' } },
            { category: { $regex: keyword, $options: 'i' } },
            { categories: { $elemMatch: { $regex: keyword, $options: 'i' } } },
            { tags: { $elemMatch: { $regex: keyword, $options: 'i' } } }
          ]
        }));
        
        console.log(`🔍 多關鍵字搜索條件: ${keywords.length} 個關鍵字`);
        
        searchConditions = {
          $and: [
            { available: true },
            ...keywordConditions,  // 所有關鍵字都必須匹配（但可以在不同字段）
            ...Object.entries(filters).map(([key, value]) => ({ [key]: value }))
          ]
        };
      }
      
      console.log(`🔍 執行查詢條件:`, JSON.stringify(searchConditions, null, 2));
      
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
          description: 1,  // 移除不支持的 $substr，返回完整描述
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
      if (results.length > 0) {
        console.log(`📝 結果樣本:`, results.map(r => ({ id: r.id, name: r.name })));
      } else {
        console.log(`⚠️ 關鍵字搜索無結果，檢查查詢條件`);
      }
      return resultsWithScore;
      
    } catch (error) {
      console.error('❌ 關鍵字搜索失敗:', error.message);
      return [];
    }
  }
  
  // LLM 查詢優化 - 將自然語言轉換為適合向量搜索的關鍵詞和篩選條件
  async optimizeSearchQuery(originalQuery) {
    try {
      console.log(`🤖 LLM 查詢優化: "${originalQuery}"`);
      
      const optimizationPrompt = `你是一個電商搜索查詢優化助手。請分析用戶的自然語言查詢，提取搜索關鍵詞和篩選條件。

請以JSON格式回應，包含：
1. keywords: 適合向量搜索的關鍵詞
2. filters: 篩選條件對象，可包含：
   - minPrice/maxPrice: 價格範圍
   - category: 商品類別（如 "men", "women", "kids"）
   - categories: 商品標籤數組

商品類別對應：
- 童裝/兒童/小孩 → "kid"
- 男裝/男性 → "men"  
- 女裝/女性 → "women"

範例：
輸入："我想找一件適合約會穿的黑色外套"
輸出：{"keywords": "黑色外套 約會", "filters": {}}

輸入："有沒有便宜一點的運動服？"
輸出：{"keywords": "運動服", "filters": {"maxPrice": 800}}

輸入："我想要找童裝，價格1000以下的"
輸出：{"keywords": "童裝 兒童", "filters": {"maxPrice": 1000, "category": "kid"}}

輸入："我想要看童裝，價格1000~2000"
輸出：{"keywords": "童裝 兒童", "filters": {"minPrice": 1000, "maxPrice": 2000, "category": "kid"}}

輸入："給我推薦女生冬天保暖的衣服，預算500-800"
輸出：{"keywords": "冬季保暖衣服", "filters": {"minPrice": 500, "maxPrice": 800, "category": "women"}}

用戶查詢："${originalQuery}"
請回應JSON：`;

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            { role: 'user', content: optimizationPrompt }
          ],
          max_tokens: 150,
          temperature: 0.3
        })
      });

      if (!response.ok) {
        console.log(`⚠️ LLM 優化失敗，使用原始查詢`);
        return { keywords: originalQuery, filters: {} };
      }

      const data = await response.json();
      const responseText = data.choices[0]?.message?.content?.trim() || '';
      
      try {
        const parsed = JSON.parse(responseText);
        console.log(`✅ LLM 優化結果: "${originalQuery}" → 關鍵詞: "${parsed.keywords}", 篩選: ${JSON.stringify(parsed.filters)}`);
        return {
          keywords: parsed.keywords || originalQuery,
          filters: parsed.filters || {}
        };
      } catch (parseError) {
        console.log(`⚠️ JSON 解析失敗，使用原始查詢: ${responseText}`);
        return { keywords: originalQuery, filters: {} };
      }
      
    } catch (error) {
      console.error('❌ LLM 查詢優化失敗:', error.message);
      return { keywords: originalQuery, filters: {} }; // 失敗時回退到原始查詢
    }
  }

  // 純語意向量搜索 - 按照 MongoDB Atlas 官方標準實現
  async vectorOnlySearch(database, query, limit, filters = {}) {
    console.log(`🧠 開始純語意向量搜索: "${query}"`);
    
    try {
      // 🤖 第一步：LLM 優化查詢
      const optimization = await this.optimizeSearchQuery(query);
      const optimizedQuery = optimization.keywords;
      const llmFilters = optimization.filters;
      
      // 合併 LLM 篩選條件和用戶篩選條件
      const combinedFilters = { ...filters, ...llmFilters };
      console.log(`🔍 合併篩選條件:`, combinedFilters);
      
      // 生成查詢向量（使用優化後的查詢）
      const queryVector = await this.generateQueryVector(optimizedQuery);
      if (!queryVector) {
        console.log(`❌ 向量生成失敗`);
        return {
          results: [],
          breakdown: {
            vector_results: 0,
            total_results: 0,
            search_method: "pure_vector_search"
          }
        };
      }
      
      console.log(`🔍 執行語意向量搜索，向量維度: ${queryVector.length}`);
      
      // 執行向量搜索（使用合併後的篩選條件）
      const vectorResults = await this.vectorSearch(database, queryVector, limit, combinedFilters);
      
      console.log(`✅ 向量搜索完成，找到 ${vectorResults.length} 個結果`);
      
      // 按相似度排序，保留原始相似度分數
      const finalResults = vectorResults
        .map(item => ({
          ...item,
          search_type: 'semantic'
          // 保留原始 similarity_score，不進行調整
        }))
        .sort((a, b) => (b.similarity_score || 0) - (a.similarity_score || 0))
        .slice(0, limit);
      
      console.log(`🎯 最終返回 ${finalResults.length} 個高相關性商品`);
      if (finalResults.length > 0) {
        console.log(`📝 結果樣本:`, finalResults.slice(0, 3).map(r => ({ 
          name: r.name, 
          score: r.similarity_score 
        })));
      }
      
      return {
        results: finalResults,
        breakdown: {
          vector_results: vectorResults.length,
          total_results: finalResults.length,
          search_method: "pure_vector_search"
        }
      };
      
    } catch (error) {
      console.error(`❌ 向量搜索失敗:`, error);
      return {
        results: [],
        breakdown: {
          vector_results: 0,
          total_results: 0,
          search_method: "pure_vector_search",
          error: error.message
        }
      };
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
    
    console.log(`📊 原始檢索結果 - 語義: ${vectorResults.length}, 關鍵字: ${keywordResults.length}`);
    
    // 🔧 修復：確保至少有關鍵字搜索結果時混合搜索不會失敗
    if (vectorResults.length === 0 && keywordResults.length === 0) {
      console.log(`⚠️ 兩種搜索都沒有結果`);
      return {
        results: [],
        breakdown: {
          vector_results: 0,
          keyword_results: 0,
          total_unique: 0,
          weights: weights,
          rag_method: "hybrid_retrieval_augmented_generation"
        }
      };
    }
    
    // RAG 第二步：增強 (Augmentation) - 合併和評分
    const enhancedResults = this.enhanceSearchResults(vectorResults, keywordResults, weights, query);
    console.log(`🔧 增強後結果數量: ${enhancedResults.length}`);
    
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
  
  // RAG 增強：結果合併和評分 - 調整信心度計算
  enhanceSearchResults(vectorResults, keywordResults, weights, originalQuery) {
    const allResults = [];
    
    // 處理語義搜索結果
    vectorResults.forEach(item => {
      const adjustedScore = this.adjustConfidenceScore(item.similarity_score || 0.4, 'semantic');
      const finalScore = adjustedScore * weights.vector;
      allResults.push({
        ...item,
        final_score: finalScore,
        search_type: 'semantic',
        relevance_reason: '語義相似性匹配',
        raw_similarity: item.similarity_score
      });
    });
    
    // 處理關鍵字搜索結果（去重）
    keywordResults.forEach(item => {
      const existingIndex = allResults.findIndex(existing => existing.id === item.id);
      if (existingIndex >= 0) {
        // 如果已存在，增強分數（混合信號）
        const keywordScore = this.adjustConfidenceScore(item.similarity_score || 0.3, 'keyword');
        const additionalScore = keywordScore * weights.keyword;
        allResults[existingIndex].final_score += additionalScore;
        allResults[existingIndex].search_type = 'hybrid';
        allResults[existingIndex].relevance_reason = '語義+關鍵字雙重匹配';
      } else {
        // 新結果
        const adjustedScore = this.adjustConfidenceScore(item.similarity_score || 0.3, 'keyword');
        const finalScore = adjustedScore * weights.keyword;
        allResults.push({
          ...item,
          final_score: finalScore,
          search_type: 'keyword',
          relevance_reason: '關鍵字精確匹配',
          raw_similarity: item.similarity_score
        });
      }
    });
    
    console.log(`🔧 結果合併完成: 語義 ${vectorResults.length} + 關鍵字 ${keywordResults.length} = 總計 ${allResults.length}`);
    return allResults;
  }
  
  // 調整信心度分數，讓它更符合實際情況
  adjustConfidenceScore(rawScore, searchType) {
    if (!rawScore) return 0.2;
    
    if (searchType === 'semantic') {
      // 語義搜索：向量相似度通常較高，需要降低
      if (rawScore > 0.9) return 0.75;      // 非常相似 -> 75%
      if (rawScore > 0.8) return 0.65;      // 很相似 -> 65%
      if (rawScore > 0.7) return 0.55;      // 相似 -> 55%
      if (rawScore > 0.6) return 0.45;      // 有些相似 -> 45%
      if (rawScore > 0.5) return 0.35;      // 略微相似 -> 35%
      return 0.25;                          // 低相似度 -> 25%
    } else {
      // 關鍵字搜索：基於匹配程度
      if (rawScore > 0.8) return 0.70;      // 多重關鍵字匹配 -> 70%
      if (rawScore > 0.6) return 0.55;      // 部分匹配 -> 55%
      if (rawScore > 0.4) return 0.40;      // 基本匹配 -> 40%
      return 0.25;                          // 弱匹配 -> 25%
    }
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
