const { Configuration, OpenAIApi } = require('openai');
const OpenAI = require('openai');

class SearchService {
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  // 生成向量嵌入的方法
  async generateQueryVector(query) {
    try {
      if (!query || query.trim() === '') {
        return null;
      }

      console.log(`🤖 生成查詢向量: "${query}"`);

      const embedding = await this.openai.embeddings.create({
        model: "text-embedding-ada-002",
        input: query.trim(),
        dimensions: 1536
      });

      console.log(`✅ 向量生成成功，維度: ${embedding.data[0].embedding.length}`);
      return embedding.data[0].embedding;

    } catch (error) {
      console.error('❌ 向量生成失敗:', error.message);
      return null;
    }
  }

  // 純向量搜索功能
  async vectorOnlySearch(database, query, limit = 10, filters = {}) {
    try {
      console.log(`🔍 執行向量搜索: "${query}"`);

      // 1. 生成查詢向量
      const queryVector = await this.generateQueryVector(query);
      if (!queryVector) {
        console.log(`❌ 向量生成失敗，無法執行向量搜索`);
        return { results: [], breakdown: { search_method: "vector_failed", error: "vector_generation_failed" } };
      }

      // 2. 構建過濾條件
      const filterConditions = {};
      
      // 添加可用性過濾
      filterConditions.available = { $eq: true };
      
      // 添加用戶自定義過濾條件
      Object.keys(filters).forEach(key => {
        if (filters[key] !== undefined && filters[key] !== null) {
          filterConditions[key] = filters[key];
        }
      });

      // 3. 執行向量搜索
      const vectorResults = await database.collection('products').aggregate([
        {
          $vectorSearch: {
            index: "vector_index",
            path: "product_embedding",
            queryVector: queryVector,
            numCandidates: 100, // 增加候選項以提高精確度
            limit: limit,
            filter: filterConditions
          }
        },
        {
          $addFields: {
            vectorScore: { $meta: "searchScore" },
            search_type: "vector_only"
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
            vectorScore: 1,
            search_type: 1
          }
        }
      ]).toArray();

      console.log(`✅ 向量搜索完成: 找到 ${vectorResults.length} 個結果`);

      return {
        results: vectorResults,
        breakdown: {
          search_method: "vector_only",
          total_results: vectorResults.length
        }
      };

    } catch (error) {
      console.error(`❌ 向量搜索失敗: ${error.message}`);
      
      // 如果向量搜索失敗，返回空結果
      return { results: [], breakdown: { search_method: "vector_error", error: error.message } };
    }
  }

  // 混合搜索功能（向量搜索 + 全文搜索）
  async hybridSearch(database, query, limit = 10, filters = {}) {
    try {
      console.log(`🔍 執行混合搜索 (向量 + 全文): "${query}"`);
      
      // 0. 預處理查詢
      const processedQuery = await this.preprocessQuery(query);
      console.log(`🧠 預處理後的查詢: "${processedQuery}"`);
      
      // 1. 向量搜索閾值和權重
      const vectorCutoff = 0.5;  // 向量分數閾值
      const vectorWeight = 0.7;  // 向量搜索權重
      
      // 2. 構建過濾條件
      const filterConditions = {};
      
      // 添加可用性過濾
      filterConditions.available = { $eq: true };
      
      // 添加用戶自定義過濾條件
      Object.keys(filters).forEach(key => {
        if (filters[key] !== undefined && filters[key] !== null) {
          filterConditions[key] = filters[key];
        }
      });
      
      // 3. 步驟一：執行向量搜索獲取語義相似結果
      // 生成查詢向量
      const queryVector = await this.generateQueryVector(processedQuery);
      if (!queryVector) {
        console.log(`❌ 向量生成失敗，降級為純全文搜索`);
        return await this.textOnlySearch(database, processedQuery, limit, filters);
      }
      
      // 4. 執行向量搜索
      const vectorResults = await database.collection('products').aggregate([
        {
          $vectorSearch: {
            index: "vector_index",
            path: "product_embedding",
            queryVector: queryVector,
            numCandidates: 100,
            limit: 50, // 獲取更多候選項用於語義增強
            filter: filterConditions
          }
        },
        {
          $addFields: {
            vectorScore: { $meta: "searchScore" }
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
                // 每個關鍵詞都必須匹配 - v5.1.0 多關鍵詞智能搜索
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

      console.log(`✅ 混合搜索完成: 找到 ${hybridResults.length} 個結果`);

      // 7. 如果混合搜索沒有結果，降級為純向量搜索
      if (hybridResults.length === 0) {
        console.log(`⚠️ 混合搜索沒有結果，降級為純向量搜索`);
        return await this.vectorOnlySearch(database, query, limit, filters);
      }

      return {
        results: hybridResults,
        breakdown: {
          search_method: "hybrid_semantic_boosting",
          vector_results: vectorResults.length,
          hybrid_results: hybridResults.length,
          processed_query: processedQuery
        }
      };

    } catch (error) {
      console.error(`❌ 混合搜索失敗: ${error.message}`);
      
      // 如果混合搜索失敗，嘗試降級為純向量搜索
      try {
        console.log(`⚠️ 降級為純向量搜索`);
        return await this.vectorOnlySearch(database, query, limit, filters);
      } catch (vectorError) {
        console.error(`❌ 降級搜索也失敗: ${vectorError.message}`);
        
        // 如果向量搜索也失敗，嘗試降級為純全文搜索
        try {
          console.log(`⚠️ 降級為純全文搜索`);
          return await this.textOnlySearch(database, query, limit, filters);
        } catch (textError) {
          console.error(`❌ 所有搜索方法都失敗`);
          return { results: [], breakdown: { search_method: "all_methods_failed", error: error.message } };
        }
      }
    }
  }

  // 純全文搜索功能（作為後備）
  async textOnlySearch(database, query, limit = 10, filters = {}) {
    try {
      console.log(`🔍 執行全文搜索: "${query}"`);

      // 構建過濾條件
      const filterConditions = {};
      
      // 添加可用性過濾
      filterConditions.available = { $eq: true };
      
      // 添加用戶自定義過濾條件
      Object.keys(filters).forEach(key => {
        if (filters[key] !== undefined && filters[key] !== null) {
          filterConditions[key] = filters[key];
        }
      });

      // 執行全文搜索
      const textResults = await database.collection('products').aggregate([
        {
          $search: {
            index: "product_text_search",
            compound: {
              must: [
                {
                  text: {
                    query: query,
                    path: ["name", "description", "category", "tags"]
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
          $addFields: {
            textScore: { $meta: "searchScore" },
            search_type: "text_only"
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
            textScore: 1,
            search_type: 1
          }
        },
        { $limit: limit }
      ]).toArray();

      console.log(`✅ 全文搜索完成: 找到 ${textResults.length} 個結果`);

      return {
        results: textResults,
        breakdown: {
          search_method: "text_only",
          total_results: textResults.length
        }
      };

    } catch (error) {
      console.error(`❌ 全文搜索失敗: ${error.message}`);
      return { results: [], breakdown: { search_method: "text_error", error: error.message } };
    }
  }

  // 查詢預處理 - 使用 LLM 優化搜索關鍵詞
  async preprocessQuery(originalQuery) {
    try {
      if (!originalQuery || originalQuery.trim() === '') {
        return '';
      }

      console.log(`🧠 LLM 預處理查詢: "${originalQuery}"`);

      const prompt = `請分析以下用戶搜索查詢，提取關鍵詞以優化電商搜索：

用戶原始查詢：「${originalQuery}」

請按照以下規則處理：

1. **商品類型**：
   - 衣服 → 上衣、外套、T恤等具體類型
   - 鞋子 → 運動鞋、靴子等具體類型
   - 褲子 → 牛仔褲、短褲等具體類型

2. **品牌名稱**：保持原樣（NIKE、PUMA、Adidas等）

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

**同義詞處理：**
- 衣服 → 可以匹配：上衣、外套、T恤、背心等
- 鞋子 → 可以匹配：運動鞋、靴子等
- 褲子 → 可以匹配：牛仔褲、短褲等

**特殊情況處理：**
- 如果查詢只是品牌名，直接返回品牌名
- 如果查詢包含「衣服」，替換為更具體的商品類型
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
- 「綠色衣服」→ 關鍵詞：綠色
- 「黑色衣服」→ 關鍵詞：黑色
- 「白色衣服」→ 關鍵詞：白色
- 「」→ 關鍵詞：
- 「asdfgh」→ 關鍵詞：
`;

      const response = await this.openai.chat.completions.create({
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

      const response = await this.openai.chat.completions.create({
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

  // 獲取相關商品推薦
  async getRelatedProducts(database, productId, limit = 4) {
    try {
      console.log(`🔍 獲取商品 ID: ${productId} 的相關推薦`);
      
      // 1. 獲取目標商品資訊
      const productsCollection = database.collection('products');
      const targetProduct = await productsCollection.findOne({ id: parseInt(productId) });
      
      if (!targetProduct) {
        console.log(`❌ 找不到 ID 為 ${productId} 的商品`);
        return { results: [], breakdown: { search_method: "related_products_fallback", error: "product_not_found" } };
      }
      
      console.log(`✅ 找到目標商品: ${targetProduct.name}`);
      
      // 2. 構建查詢條件 - 優先使用向量搜索
      if (targetProduct.product_embedding) {
        try {
          console.log(`🧠 使用向量相似性查找相關商品`);
          
          // 使用向量搜索查找相似商品
          const relatedProducts = await productsCollection.aggregate([
            {
              $vectorSearch: {
                index: "vector_index",
                path: "product_embedding",
                queryVector: targetProduct.product_embedding,
                numCandidates: 20, // 增加候選項以確保有足夠的不同商品
                limit: limit + 1 // 多取一個，因為會包含商品自身
              }
            },
            {
              $match: {
                id: { $ne: targetProduct.id } // 排除目標商品自身
              }
            },
            { $limit: limit },
            {
              $addFields: {
                similarity_score: { $meta: "searchScore" },
                recommendation_type: "vector_similarity"
              }
            }
          ]).toArray();
          
          console.log(`✅ 找到 ${relatedProducts.length} 個相關商品 (向量相似度)`);          
          return { 
            results: relatedProducts, 
            breakdown: { 
              search_method: "vector_similarity", 
              total_results: relatedProducts.length 
            } 
          };
        } catch (vectorError) {
          console.error(`❌ 向量相似度搜索失敗: ${vectorError.message}`);
          // 繼續執行類別匹配作為後備
        }
      }
      
      // 3. 後備方案：基於類別和標籤的相關性
      console.log(`🔍 使用類別和標籤匹配查找相關商品`);
      
      // 構建查詢條件
      const matchConditions = [];
      
      // 相同類別
      if (targetProduct.category) {
        matchConditions.push({ category: targetProduct.category });
      }
      
      // 相同標籤 (如果有)
      if (targetProduct.tags && targetProduct.tags.length > 0) {
        matchConditions.push({ tags: { $in: targetProduct.tags } });
      }
      
      // 如果沒有有效的匹配條件，返回空結果
      if (matchConditions.length === 0) {
        console.log(`⚠️ 沒有足夠的匹配條件，返回隨機推薦`);
        // 返回隨機商品作為最後的後備
        const randomProducts = await productsCollection.aggregate([
          { $match: { id: { $ne: targetProduct.id } } },
          { $sample: { size: limit } },
          { $addFields: { recommendation_type: "random" } }
        ]).toArray();
        
        return { 
          results: randomProducts, 
          breakdown: { 
            search_method: "random_recommendation", 
            total_results: randomProducts.length 
          } 
        };
      }
      
      // 執行類別/標籤匹配查詢
      const relatedProducts = await productsCollection.aggregate([
        {
          $match: {
            $and: [
              { id: { $ne: targetProduct.id } }, // 排除目標商品
              { $or: matchConditions }
            ]
          }
        },
        // 計算匹配分數 (類別匹配 +1，每個標籤匹配 +0.5)
        {
          $addFields: {
            categoryScore: {
              $cond: [
                { $eq: ["$category", targetProduct.category] },
                1,
                0
              ]
            },
            tagScore: {
              $reduce: {
                input: { $ifNull: ["$tags", []] },
                initialValue: 0,
                in: {
                  $add: [
                    "$$value",
                    {
                      $cond: [
                        { $in: ["$$this", { $ifNull: [targetProduct.tags, []] }] },
                        0.5,
                        0
                      ]
                    }
                  ]
                }
              }
            }
          }
        },
        // 計算總分
        {
          $addFields: {
            matchScore: { $add: ["$categoryScore", "$tagScore"] },
            recommendation_type: "category_tag_match"
          }
        },
        // 按匹配分數排序
        { $sort: { matchScore: -1, id: 1 } },
        { $limit: limit }
      ]).toArray();
      
      console.log(`✅ 找到 ${relatedProducts.length} 個相關商品 (類別/標籤匹配)`);
      
      return { 
        results: relatedProducts, 
        breakdown: { 
          search_method: "category_tag_match", 
          total_results: relatedProducts.length 
        } 
      };
      
    } catch (error) {
      console.error(`❌ 獲取相關商品失敗: ${error.message}`);
      return { results: [], breakdown: { search_method: "related_products_error", error: error.message } };
    }
  }
}

module.exports = SearchService;