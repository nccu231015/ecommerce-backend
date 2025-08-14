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

  // MongoDB Atlas 混合搜索 - 語義增強 (Semantic Boosting) 實現
  async hybridSearch(database, query, limit = 10, filters = {}) {
    try {
      console.log(`🔄 開始混合搜索 (語義增強): "${query}"`);
      
      // 1. LLM 預處理：將自然語言轉換成精確關鍵詞
      const processedQuery = await this.preprocessQuery(query);
      
      // 2. 生成查詢向量（使用預處理後的查詢）
      const queryVector = await this.generateQueryVector(processedQuery);
      if (!queryVector) {
        console.log('❌ 向量生成失敗，降級到全文搜索');
        const fallbackResults = await this.textOnlySearch(database, query, limit, filters);
        return {
          results: fallbackResults,
          breakdown: {
            search_method: "text_only_search",
            total_results: fallbackResults.length
          }
        };
      }

      // 2. 構建篩選條件
      const filterConditions = {
        available: { $eq: true }
      };
      
      if (filters.category) {
        filterConditions.category = { $eq: filters.category };
      }

      // 3. 動態權重調整
      const weights = this.getOptimalWeights(query, filters);
      console.log(`⚖️ 搜索權重 - 向量: ${weights.vectorPipeline}, 全文: ${weights.fullTextPipeline}`);

      // 4. 步驟一：執行向量搜索獲取語義相似的文檔
      const vectorCutoff = 0.75; // 相似度閾值
      const vectorWeight = weights.vectorPipeline;
      const numCandidates = Math.max(limit * 10, 100);

      const vectorResults = await database.collection('products').aggregate([
        {
          $vectorSearch: {
            index: "vector_index",
            path: "product_embedding",
            queryVector: queryVector,
            numCandidates: numCandidates,
            limit: Math.max(limit * 2, 20),
            filter: filterConditions
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
            available: 1,
            vectorScore: { $meta: "searchScore" }
          }
        },
        {
          $match: {
            vectorScore: { $gte: vectorCutoff }
          }
        }
      ]).toArray();

      console.log(`🔍 向量搜索找到 ${vectorResults.length} 個語義相似結果 (閾值: ${vectorCutoff})`);

      // 5. 創建向量搜索結果的 ID 映射和加權分數
      const vectorScoresMap = {};
      vectorResults.forEach(result => {
        vectorScoresMap[result._id.toString()] = result.vectorScore * vectorWeight;
      });

      // 6. 步驟二：執行語義增強的全文搜索
      const boostConditions = Object.keys(vectorScoresMap).map(id => ({
        equals: {
          path: "_id",
          value: { $oid: id },
          score: { boost: { value: vectorScoresMap[id] } }
        }
      }));

      const hybridResults = await database.collection('products').aggregate([
        {
          $search: {
            index: "product_text_search",
            compound: {
              must: processedQuery.split(' ').map(keyword => ({
                // 每個關鍵詞都必須在商品名稱中出現
                text: {
                  query: keyword,
                  path: "name"
                }
              })),
              should: [
                // 語義增強：提升向量搜索匹配的文檔分數
                ...boostConditions
              ],
              minimumShouldMatch: 0,
              filter: Object.keys(filterConditions).map(key => ({
                equals: {
                  path: key,
                  value: filterConditions[key].$eq
                }
              })),
              minimumShouldMatch: 0 // should 條件是可選的增強
            }
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
            available: 1,
            combinedScore: { $meta: "searchScore" },
            searchSources: ["vector", "text"] // 標記為混合搜索結果
          }
        },
        { $limit: limit }
      ]).toArray();

      console.log(`✅ 語義增強混合搜索完成 - 找到 ${hybridResults.length} 個結果`);
      
      if (hybridResults.length === 0) {
        console.log('🔄 混合搜索無結果，嘗試向量搜索...');
        const fallbackResults = await this.vectorOnlySearch(database, queryVector, limit, filters);
        return {
          results: fallbackResults,
          breakdown: {
            search_method: "vector_only_search",
            total_results: fallbackResults.length,
            vector_matches: vectorResults.length
          }
        };
      }

      return {
        results: hybridResults,
        breakdown: {
          search_method: "hybrid_search_llm_preprocessed",
          original_query: query,
          processed_query: processedQuery,
          total_results: hybridResults.length,
          vector_matches: vectorResults.length,
          boost_applied: boostConditions.length
        }
      };

    } catch (error) {
      console.error('❌ 語義增強混合搜索失敗:', error.message);
      console.error('❌ 錯誤堆疊:', error.stack);
      
      // 智能降級策略
      console.log('🔄 降級到向量搜索...');
      const queryVector = await this.generateQueryVector(query);
      if (queryVector) {
        const fallbackResults = await this.vectorOnlySearch(database, queryVector, limit, filters);
        return {
          results: fallbackResults,
          breakdown: {
            search_method: "vector_only_search",
            total_results: fallbackResults.length
          }
        };
      } else {
        console.log('🔄 向量生成失敗，最終降級到全文搜索...');
        const fallbackResults = await this.textOnlySearch(database, query, limit, filters);
        return {
          results: fallbackResults,
          breakdown: {
            search_method: "text_only_search",
            total_results: fallbackResults.length
          }
        };
      }
    }
  }

  // 向量搜索 (降級選項)
  async vectorOnlySearch(database, queryVector, limit = 10, filters = {}) {
    try {
      console.log('🔍 執行向量搜索...');
      
      const filterConditions = {
        available: { $eq: true }
      };
      
      if (filters.category) {
        filterConditions.category = { $eq: filters.category };
      }

      const results = await database.collection('products').aggregate([
        {
          $vectorSearch: {
            index: "vector_index",
            path: "product_embedding", 
            queryVector: queryVector,
            numCandidates: Math.max(limit * 10, 100),
            limit: limit,
            filter: filterConditions
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
            available: 1,
            combinedScore: { $meta: "searchScore" },
            searchSources: ["vector"]
          }
        },
        { $limit: limit }
      ]).toArray();

      console.log(`✅ 向量搜索完成 - 找到 ${results.length} 個結果`);
      return results;

    } catch (error) {
      console.error('❌ 向量搜索失敗:', error.message);
      throw error;
    }
  }

  // 全文搜索 (最終降級選項)
  async textOnlySearch(database, query, limit = 10, filters = {}) {
    try {
      console.log(`🔍 執行全文搜索: "${query}"`);
      
      const filterConditions = {
        available: { $eq: true }
      };
      
      if (filters.category) {
        filterConditions.category = { $eq: filters.category };
      }

      const results = await database.collection('products').aggregate([
        {
          $search: {
            index: "product_text_search",
            compound: {
              must: [
                {
                  phrase: {
                    query: query,
                    path: "name"
                  }
                }
              ],
              filter: Object.keys(filterConditions).map(key => ({
                equals: {
                  path: key,
                  value: filterConditions[key].$eq
                }
              }))
            }
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
            available: 1,
            combinedScore: { $meta: "searchScore" },
            searchSources: ["text"]
          }
        },
        { $limit: limit }
      ]).toArray();

      console.log(`✅ 全文搜索完成 - 找到 ${results.length} 個結果`);
      return results;

    } catch (error) {
      console.error('❌ 全文搜索失敗:', error.message);
      throw error;
    }
  }

  // 動態權重調整 - 根據查詢類型優化搜索權重
  getOptimalWeights(query, filters = {}) {
    // 品牌查詢 - 偏向全文搜索
    if (this.isPureBrandQuery(query)) {
      return {
        vectorPipeline: 0.3,
        fullTextPipeline: 0.7
      };
    }
    
    // 描述性查詢 - 偏向向量搜索
    if (this.isDescriptiveQuery(query)) {
      return {
        vectorPipeline: 0.7,
        fullTextPipeline: 0.3
      };
    }
    
    // 類別篩選 - 平衡權重
    if (filters.category) {
      return {
        vectorPipeline: 0.5,
        fullTextPipeline: 0.5
      };
    }
    
    // 默認平衡權重
    return {
      vectorPipeline: 0.6,
      fullTextPipeline: 0.4
    };
  }

  // 判斷是否為純品牌查詢
  isPureBrandQuery(query) {
    const brandKeywords = ['nike', 'adidas', 'uniqlo', 'zara', 'h&m'];
    const lowerQuery = query.toLowerCase();
    return brandKeywords.some(brand => lowerQuery.includes(brand));
  }

  // 判斷是否為描述性查詢
  isDescriptiveQuery(query) {
    const descriptiveKeywords = ['舒適', '時尚', '休閒', '正式', '運動', '保暖', '透氣', '防水'];
    return descriptiveKeywords.some(keyword => query.includes(keyword));
  }

  // LLM 查詢預處理：將自然語言轉換成精確關鍵詞
  async preprocessQuery(originalQuery) {
    try {
      console.log(`🧠 LLM 預處理查詢: "${originalQuery}"`);

      const prompt = `
你是一個專業的電商搜索關鍵詞提取助理。你的任務是將用戶的自然語言查詢轉換成適合精確匹配的關鍵詞。

**重要：無論輸入什麼內容，你都必須按照指定格式輸出「關鍵詞：[關鍵詞]」**

用戶查詢：「${originalQuery}」

**關鍵詞提取規則：**
1. **商品類型轉換**：
   - 運動服 → 運動
   - 連帽衫 → 連帽
   - 牛仔褲 → 牛仔
   - T恤衫 → T恤
   - 運動鞋 → 運動

2. **品牌名稱**：保持原樣（PUMA、NIKE、URBAN STREET）

3. **顏色描述**：保持原樣（黑色、白色、綠色、藍色等）

4. **款式特徵**：
   - 短袖 → 短袖
   - 長袖 → 長袖
   - 短版 → 短版
   - 立領 → 立領

5. **自然語言處理**：
   - 「給我...」「想要...」「找...」等前綴詞 → 忽略
   - 「全部的」「所有的」等量詞 → 忽略
   - 「好看的」「時尚的」等形容詞 → 忽略

**特殊情況處理：**
- 如果查詢只是品牌名，直接返回品牌名
- 如果查詢包含多個關鍵詞，用空格分隔
- 如果查詢很模糊，提取最核心的商品類型
- 如果查詢是英文，保持英文
- 如果查詢包含特殊符號，忽略符號

**輸出格式要求：**
必須嚴格按照「關鍵詞：[關鍵詞]」的格式，不能有其他文字。

**範例：**
- 「給我全部的外套」→ 關鍵詞：外套
- 「黑色的運動外套」→ 關鍵詞：黑色 運動 外套
- 「PUMA的綠色連帽衫」→ 關鍵詞：PUMA 綠色 連帽
- 「運動服」→ 關鍵詞：運動
- 「連帽衫」→ 關鍵詞：連帽
- 「我想要PUMA」→ 關鍵詞：PUMA
- 「好看的黑色衣服」→ 關鍵詞：黑色
- 「便宜的T恤」→ 關鍵詞：T恤
- 「有沒有短袖」→ 關鍵詞：短袖
- 「nike的鞋子」→ 關鍵詞：NIKE
- 「」→ 關鍵詞：
- 「asdfgh」→ 關鍵詞：
`;

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 100,
        temperature: 0.3 // 較低溫度確保一致性
      });

      const aiResponse = response.choices[0].message.content.trim();
      console.log('🤖 LLM 預處理結果:', aiResponse);

      // 解析關鍵詞
      const keywordMatch = aiResponse.match(/關鍵詞：(.+)/);
      if (keywordMatch) {
        const processedQuery = keywordMatch[1].trim();
        console.log(`✅ 查詢轉換: "${originalQuery}" → "${processedQuery}"`);
        return processedQuery;
      }

      // 如果解析失敗，返回原始查詢
      console.log(`⚠️ LLM 預處理解析失敗，使用原始查詢`);
      return originalQuery;

    } catch (error) {
      console.error('❌ LLM 預處理失敗:', error.message);
      // 如果 LLM 失敗，返回原始查詢
      return originalQuery;
    }
  }

  // LLM 推薦功能
  async addLLMRecommendation(products, query) {
    try {
      if (!products || products.length === 0) {
        return products;
      }

      console.log(`🧠 LLM 分析產品推薦: "${query}"`);
      
      // 構建產品資訊
      const productSummary = products.slice(0, 5).map((product, index) => 
        `${index + 1}. ${product.name} - $${product.new_price} (${product.category})`
      ).join('\n');

      const prompt = `
作為一個專業的電商購物助理，請分析以下搜索結果並提供推薦：

用戶搜索：「${query}」

搜索結果：
${productSummary}

請提供：
1. 最推薦的商品 (只選1個，用商品編號)
2. 推薦理由 (50字以內，重點說明為什麼適合)

回應格式：
推薦商品：[商品編號]
推薦理由：[理由]
`;

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 200,
        temperature: 0.7
      });

      const aiResponse = response.choices[0].message.content.trim();
      console.log('🤖 LLM 推薦結果:', aiResponse);

      // 解析 AI 推薦
      const recommendedMatch = aiResponse.match(/推薦商品：(\d+)/);
      const reasonMatch = aiResponse.match(/推薦理由：(.+)/);

      if (recommendedMatch && reasonMatch) {
        const recommendedIndex = parseInt(recommendedMatch[1]) - 1;
        const reason = reasonMatch[1].trim();

        if (recommendedIndex >= 0 && recommendedIndex < products.length) {
          // 為推薦的產品添加 LLM 推薦標記
          products[recommendedIndex].llm_recommended = true;
          products[recommendedIndex].recommendation_reason = reason;
          
          console.log(`✅ 產品 "${products[recommendedIndex].name}" 被 AI 推薦`);
        }
      }

      return products;

    } catch (error) {
      console.error('❌ LLM 推薦失敗:', error.message);
      // 如果 LLM 失敗，返回原始產品列表
      return products;
    }
  }
}

module.exports = SearchService;