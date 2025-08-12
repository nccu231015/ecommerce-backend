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
      
      // 處理類別篩選（Vector Search 支援精確匹配）
      if (filters.category) {
        filterConditions.category = { $eq: filters.category };
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
            similarity_score: { $gte: 0.9 }         // 保持高相似度閾值，確保精準性
          }
        }
      ];

      // 處理價格篩選（在 aggregation pipeline 中進行，因為 Vector Search filter 不支援 $expr）
      if (filters.minPrice || filters.maxPrice) {
        const priceConditions = [];
        
        if (filters.minPrice) {
          priceConditions.push({
            $gte: [{ $toInt: "$new_price" }, parseInt(filters.minPrice)]
          });
        }
        
        if (filters.maxPrice) {
          priceConditions.push({
            $lte: [{ $toInt: "$new_price" }, parseInt(filters.maxPrice)]
          });
        }
        
        pipeline.push({
          $match: {
            $expr: priceConditions.length === 1 ? priceConditions[0] : { $and: priceConditions }
          }
        });
        
        console.log(`💰 添加價格篩選: minPrice=${filters.minPrice}, maxPrice=${filters.maxPrice}`);
      }

      // 排序和限制結果
      pipeline.push(
        {
          $sort: {
            similarity_score: -1                     // 按相似度排序
          }
        },
        {
          $limit: limit                             // 最終限制結果數量
        }
      );
      
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
        console.log(`⚠️ LLM 優化失敗，狀態碼: ${response.status}, 使用原始查詢`);
        const errorText = await response.text();
        console.log(`❌ 錯誤詳情: ${errorText}`);
        return { keywords: originalQuery, filters: {} };
      }

      const data = await response.json();
      const responseText = data.choices[0]?.message?.content?.trim() || '';
      
      // 清理 markdown 代碼塊格式
      const cleanedText = responseText
        .replace(/```json\s*/g, '')  // 移除 ```json
        .replace(/```\s*/g, '')      // 移除 ```
        .trim();
      
      console.log(`📝 GPT-4o 原始內容: "${responseText}"`);
      console.log(`🧹 清理後內容: "${cleanedText}"`);
      
      try {
        const parsed = JSON.parse(cleanedText);
        console.log(`✅ LLM 優化結果: "${originalQuery}" → 關鍵詞: "${parsed.keywords}", 篩選: ${JSON.stringify(parsed.filters)}`);
        return {
          keywords: parsed.keywords || originalQuery,
          filters: parsed.filters || {}
        };
      } catch (parseError) {
        console.log(`⚠️ JSON 解析失敗，使用原始查詢`);
        console.log(`📝 GPT-4o 原始回應: "${responseText}"`);
        console.log(`🧹 清理後內容: "${cleanedText}"`);
        console.log(`❌ 解析錯誤: ${parseError.message}`);
        return { keywords: originalQuery, filters: {} };
      }
      
    } catch (error) {
      console.error('❌ LLM 查詢優化失敗:', error.message);
      return { keywords: originalQuery, filters: {} }; // 失敗時回退到原始查詢
    }
  }

  // 預篩選商品 - 基於 LLM 提取的條件先篩選商品集合
  async preFilterProducts(database, filters = {}) {
    try {
      const productsCollection = database.collection('products');
      
      // 構建基礎篩選條件
      const filterConditions = {
        available: { $eq: true }
      };
      
      // 處理類別篩選
      if (filters.category) {
        filterConditions.category = { $eq: filters.category };
      }
      
      // 處理標籤篩選
      if (filters.categories && Array.isArray(filters.categories)) {
        filterConditions.categories = { $in: filters.categories };
      }
      
      // 處理價格篩選
      if (filters.minPrice || filters.maxPrice) {
        const priceConditions = [];
        
        if (filters.minPrice) {
          priceConditions.push({
            $gte: [{ $toInt: "$new_price" }, parseInt(filters.minPrice)]
          });
        }
        
        if (filters.maxPrice) {
          priceConditions.push({
            $lte: [{ $toInt: "$new_price" }, parseInt(filters.maxPrice)]
          });
        }
        
        // 使用 aggregation pipeline 處理價格篩選
        const pipeline = [
          { $match: filterConditions },
          {
            $match: {
              $expr: priceConditions.length === 1 ? priceConditions[0] : { $and: priceConditions }
            }
          },
          {
            $project: {
              _id: 1,
              id: 1,
              name: 1,
              image: 1,
              category: 1,
              new_price: 1,
              old_price: 1,
              description: 1,
              categories: 1,
              tags: 1,
              product_embedding: 1
            }
          }
        ];
        
        console.log(`🔍 預篩選管道:`, JSON.stringify(pipeline, null, 2));
        return await productsCollection.aggregate(pipeline).toArray();
      } else {
        // 沒有價格篩選，直接查詢
        return await productsCollection.find(filterConditions).toArray();
      }
      
    } catch (error) {
      console.error('❌ 預篩選失敗:', error.message);
      return [];
    }
  }

  // 判斷是否為純類別查詢或純篩選查詢
  isPureCategoryQuery(originalQuery, llmFilters) {
    const queryLower = originalQuery.toLowerCase().trim();
    const pureCategoryTerms = ['女裝', '男裝', '童裝', '兒童', '小孩', '女生', '男生', '女性', '男性'];
    
    // 檢查是否只包含類別詞且沒有其他描述
    const isPureCategory = pureCategoryTerms.some(term => queryLower === term) ||
                          (queryLower.length <= 4 && llmFilters.category && !llmFilters.minPrice && !llmFilters.maxPrice);
    
    // 檢查是否為純篩選查詢（只有價格條件，沒有具體商品描述）
    const isPureFilter = this.isPureFilterQuery(originalQuery, llmFilters);
    
    return isPureCategory || isPureFilter;
  }

  // 判斷是否為純篩選查詢
  isPureFilterQuery(originalQuery, llmFilters) {
    const queryLower = originalQuery.toLowerCase().trim();
    
    // 檢查是否包含價格相關詞彙但沒有具體商品描述
    const hasPriceTerms = /價格|以下|以上|便宜|貴/.test(queryLower);
    const hasGenericTerms = /商品|東西|產品|物品/.test(queryLower);
    const hasSpecificItems = /外套|上衣|褲子|鞋子|包包|帽子|裙子|襯衫/.test(queryLower);
    
    // 如果有價格條件，且只有泛泛的詞彙，沒有具體商品描述
    const isPureFilter = (llmFilters.minPrice || llmFilters.maxPrice) && 
                        (hasGenericTerms || hasPriceTerms) && 
                        !hasSpecificItems &&
                        !llmFilters.category;
    
    console.log(`🔍 純篩選查詢檢查: hasPriceTerms=${hasPriceTerms}, hasGenericTerms=${hasGenericTerms}, hasSpecificItems=${hasSpecificItems}, isPureFilter=${isPureFilter}`);
    
    return isPureFilter;
  }

  // 處理直接搜索（純類別或純篩選）
  async handleDirectSearch(database, filters, limit) {
    try {
      const productsCollection = database.collection('products');
      
      // 基礎篩選條件
      const filterConditions = {
        available: { $eq: true }
      };
      
      // 處理類別篩選
      if (filters.category) {
        filterConditions.category = { $eq: filters.category };
      }
      
      console.log(`🏷️ 直接搜索條件:`, filterConditions);
      
      let results;
      
      // 如果有價格篩選，使用 aggregation pipeline
      if (filters.minPrice || filters.maxPrice) {
        const pipeline = [
          { $match: filterConditions }
        ];
        
        // 添加價格篩選
        const priceConditions = [];
        if (filters.minPrice) {
          priceConditions.push({
            $gte: [{ $toInt: "$new_price" }, parseInt(filters.minPrice)]
          });
        }
        if (filters.maxPrice) {
          priceConditions.push({
            $lte: [{ $toInt: "$new_price" }, parseInt(filters.maxPrice)]
          });
        }
        
        pipeline.push({
          $match: {
            $expr: priceConditions.length === 1 ? priceConditions[0] : { $and: priceConditions }
          }
        });
        
        pipeline.push({ $limit: limit });
        
        console.log(`💰 使用價格篩選 pipeline`);
        results = await productsCollection.aggregate(pipeline).toArray();
      } else {
        // 沒有價格篩選，直接查詢
        results = await productsCollection
          .find(filterConditions)
          .limit(limit)
          .toArray();
      }
      
      // 為結果添加搜索元數據
      const searchType = filters.category ? 'category' : 'filter';
      const searchMethod = filters.category ? 'pure_category_search' : 'pure_filter_search';
      
      const formattedResults = results.map(item => ({
        ...item,
        search_type: searchType,
        similarity_score: 1.0  // 直接匹配給予滿分
      }));
      
      console.log(`✅ 直接搜索完成: ${formattedResults.length} 個結果`);
      
      return {
        results: formattedResults,
        breakdown: {
          pre_filtered: formattedResults.length,
          vector_results: 0,
          total_results: formattedResults.length,
          search_method: searchMethod
        }
      };
      
    } catch (error) {
      console.error('❌ 直接搜索失敗:', error.message);
      return {
        results: [],
        breakdown: {
          pre_filtered: 0,
          vector_results: 0,
          total_results: 0,
          search_method: "direct_search",
          error: error.message
        }
      };
    }
  }



  // 純語意向量搜索 - LLM 先篩選，再做語意搜索
  async vectorOnlySearch(database, query, limit, filters = {}) {
    console.log(`🧠 開始智能搜索流程: "${query}"`);
    
    try {
      // 🤖 第一步：LLM 分析和預篩選
      console.log(`🔍 步驟1: LLM 分析查詢意圖`);
      const optimization = await this.optimizeSearchQuery(query);
      const optimizedQuery = optimization.keywords;
      const llmFilters = optimization.filters;
      
      // 🎯 特殊處理：純類別查詢或純篩選查詢
      const isPureCategoryQuery = this.isPureCategoryQuery(query, llmFilters);
      if (isPureCategoryQuery) {
        console.log(`🏷️ 檢測到純類別/篩選查詢，跳過向量搜索`);
        return await this.handleDirectSearch(database, llmFilters, limit);
      }
      
      // 合併 LLM 篩選條件和用戶篩選條件
      const combinedFilters = { ...filters, ...llmFilters };
      console.log(`📋 LLM 解析結果: 關鍵詞="${optimizedQuery}", 篩選條件=`, combinedFilters);
      
      // 🔍 第二步：基於 LLM 篩選條件預篩選商品集合
      console.log(`🔍 步驟2: 基於條件預篩選商品`);
      const preFilteredProducts = await this.preFilterProducts(database, combinedFilters);
      
      if (preFilteredProducts.length === 0) {
        console.log(`⚠️ 預篩選後沒有符合條件的商品`);
        return {
          results: [],
          breakdown: {
            pre_filtered: 0,
            vector_results: 0,
            total_results: 0,
            search_method: "llm_pre_filter + vector_search"
          }
        };
      }
      
      console.log(`✅ 預篩選完成: ${preFilteredProducts.length} 個候選商品`);
      
      // 🧠 第三步：直接使用完整的向量搜索（官方推薦方法）
      console.log(`🔍 步驟3: 執行完整向量搜索，然後與預篩選結果取交集`);
      const queryVector = await this.generateQueryVector(optimizedQuery);
      if (!queryVector) {
        console.log(`❌ 向量生成失敗`);
        return {
          results: [],
          breakdown: {
            pre_filtered: preFilteredProducts.length,
            vector_results: 0,
            total_results: 0,
            search_method: "llm_pre_filter + vector_search"
          }
        };
      }
      
      console.log(`🔍 執行語意向量搜索，向量維度: ${queryVector.length}`);
      
      // 執行完整的向量搜索，然後與預篩選結果取交集
      const allVectorResults = await this.vectorSearch(database, queryVector, Math.max(limit * 5, 50), {});
      
      // 取預篩選商品和向量搜索結果的交集
      const preFilteredIds = new Set(preFilteredProducts.map(p => p._id ? p._id.toString() : p.id));
      const vectorResults = allVectorResults.filter(item => {
        const itemId = item._id ? item._id.toString() : item.id;
        return preFilteredIds.has(itemId);
      });
      
      console.log(`✅ 智能搜索完成，找到 ${vectorResults.length} 個結果`);
      
      // 按相似度排序，保留原始相似度分數
      const finalResults = vectorResults
        .map(item => ({
          ...item,
          search_type: 'semantic'
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
          pre_filtered: preFilteredProducts.length,
          vector_results: vectorResults.length,
          total_results: finalResults.length,
          search_method: "llm_pre_filter + vector_search"
        }
      };
      
    } catch (error) {
      console.error(`❌ 智能搜索失敗:`, error);
      return {
        results: [],
        breakdown: {
          pre_filtered: 0,
          vector_results: 0,
          total_results: 0,
          search_method: "llm_pre_filter + vector_search",
          error: error.message
        }
      };
    }
  }
  

  

  

  

}

module.exports = new SearchService();
