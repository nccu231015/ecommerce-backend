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

  // MongoDB Atlas 混合搜索 - 官方 $rankFusion 實現
  async hybridSearch(database, query, limit = 10, filters = {}) {
    try {
      console.log(`🔄 開始混合搜索 (官方 $rankFusion): "${query}"`);
      
      // 1. 生成查詢向量
      const queryVector = await this.generateQueryVector(query);
      if (!queryVector) {
        console.log('❌ 向量生成失敗，降級到全文搜索');
        return await this.textOnlySearch(database, query, limit, filters);
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

      // 4. 使用官方 $rankFusion 聚合階段執行混合搜索
      const results = await database.collection('products').aggregate([
        {
          $rankFusion: {
            input: {
              pipelines: {
                vectorPipeline: [
                  {
                    $vectorSearch: {
                      index: "vector_index",
                      path: "product_embedding",
                      queryVector: queryVector,
                      numCandidates: Math.max(limit * 10, 100),
                      limit: limit,
                      filter: filterConditions
                    }
                  }
                ],
                fullTextPipeline: [
                  {
                    $search: {
                      index: "product_text_search",
                      compound: {
                        must: [
                          {
                            text: {
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
                  { $limit: limit }
                ]
              }
            },
            combination: {
              weights: {
                vectorPipeline: weights.vectorPipeline,
                fullTextPipeline: weights.fullTextPipeline
              }
            },
            scoreDetails: true
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

      console.log(`✅ 官方 RRF 混合搜索完成 - 找到 ${results.length} 個結果`);
      
      if (results.length === 0) {
        console.log('🔄 混合搜索無結果，嘗試向量搜索...');
        const fallbackResults = await this.vectorOnlySearch(database, queryVector, limit, filters);
        return {
          results: fallbackResults,
          breakdown: {
            search_method: "vector_only_search",
            total_results: fallbackResults.length
          }
        };
      }

      return {
        results: results,
        breakdown: {
          search_method: "hybrid_search_rankfusion",
          total_results: results.length
        }
      };

    } catch (error) {
      console.error('❌ 官方 RRF 混合搜索失敗:', error.message);
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
                  text: {
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
          // 為推薦的產品添加 AI 推薦標記
          products[recommendedIndex].ai_recommended = true;
          products[recommendedIndex].ai_reason = reason;
          
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