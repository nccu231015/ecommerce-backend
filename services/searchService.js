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

  // MongoDB Atlas 混合搜索 - 結合向量搜索和全文搜索
  async hybridSearch(database, query, limit = 10, filters = {}) {
    try {
      console.log(`🔄 開始混合搜索: "${query}"`);
      
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
      console.log(`⚖️ 搜索權重 - 向量: ${weights.vectorPipeline}, 全文: ${weights.textPipeline}`);

      // 4. 執行混合搜索
      const results = await database.collection('products').aggregate([
        {
          $rankFusion: {
            input: {
              pipelines: {
                // 向量搜索管道
                vectorPipeline: [
                  {
                    $vectorSearch: {
                      index: "vector_index",
                      path: "product_embedding",
                      queryVector: queryVector,
                      numCandidates: Math.max(limit * 10, 100),
                      limit: Math.max(limit * 2, 20),
                      filter: filterConditions
                    }
                  }
                ],
                // 全文搜索管道
                textPipeline: [
                  {
                    $search: {
                      index: "product_text_search",
                      compound: {
                        should: [
                          {
                            text: {
                              query: query,
                              path: ["name", "description"],
                              score: { boost: { value: 2.0 } }
                            }
                          },
                          {
                            text: {
                              query: query,
                              path: "tags",
                              score: { boost: { value: 1.5 } }
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
                  { $limit: Math.max(limit * 2, 20) }
                ]
              }
            },
            combination: {
              weights: weights
            }
          }
        },
        {
          $addFields: {
            search_type: "hybrid",
            similarity_score: { $meta: "searchScore" }
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
            search_type: 1,
            similarity_score: 1
          }
        },
        { $limit: limit }
      ]).toArray();

      console.log(`✅ 混合搜索完成 - 找到 ${results.length} 個結果`);
      
      return {
        results: results,
        breakdown: {
          total_results: results.length,
          search_method: "hybrid_search_rankfusion",
          weights_used: weights
        }
      };

    } catch (error) {
      console.error('❌ 混合搜索失敗:', error.message);
      
      // 降級到純全文搜索
      console.log('🔄 降級到純全文搜索');
      return await this.textOnlySearch(database, query, limit, filters);
    }
  }

  // 純全文搜索 - 作為備用方案
  async textOnlySearch(database, query, limit = 10, filters = {}) {
    try {
      console.log(`📝 純全文搜索: "${query}"`);
      
      const filterConditions = [];
      
      // 基本篩選
      filterConditions.push({
        equals: { path: "available", value: true }
      });
      
      if (filters.category) {
        filterConditions.push({
          equals: { path: "category", value: filters.category }
        });
      }

      const results = await database.collection('products').aggregate([
        {
          $search: {
            index: "product_text_search",
            compound: {
              should: [
                {
                  text: {
                    query: query,
                    path: ["name", "description"],
                    score: { boost: { value: 2.0 } }
                  }
                },
                {
                  text: {
                    query: query,
                    path: "tags",
                    score: { boost: { value: 1.5 } }
                  }
                }
              ],
              filter: filterConditions
            }
          }
        },
        {
          $addFields: {
            search_type: "text_only",
            similarity_score: { $meta: "searchScore" }
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
            search_type: 1,
            similarity_score: 1
          }
        },
        { $limit: limit }
      ]).toArray();

      console.log(`✅ 全文搜索完成 - 找到 ${results.length} 個結果`);
      
      return {
        results: results,
        breakdown: {
          total_results: results.length,
          search_method: "text_only_search"
        }
      };

    } catch (error) {
      console.error('❌ 全文搜索失敗:', error.message);
      return {
        results: [],
        breakdown: {
          total_results: 0,
          search_method: "text_only_search",
          error: error.message
        }
      };
    }
  }

  // 動態權重調整 - 根據查詢類型優化搜索權重
  getOptimalWeights(query, filters = {}) {
    // 純品牌/型號查詢：提高全文搜索權重
    if (this.isPureBrandQuery(query)) {
      return { vectorPipeline: 0.3, textPipeline: 0.7 };
    }
    
    // 純類別查詢：平衡權重
    if (this.isPureCategoryQuery(query, filters)) {
      return { vectorPipeline: 0.5, textPipeline: 0.5 };
    }
    
    // 描述性查詢：提高語義搜索權重
    if (this.isDescriptiveQuery(query)) {
      return { vectorPipeline: 0.8, textPipeline: 0.2 };
    }
    
    // 預設平衡權重
    return { vectorPipeline: 0.6, textPipeline: 0.4 };
  }

  // 判斷是否為品牌/型號查詢
  isPureBrandQuery(query) {
    const brandKeywords = ['nike', 'adidas', 'uniqlo', 'zara', 'h&m', 'gucci', 'prada'];
    const queryLower = query.toLowerCase();
    return brandKeywords.some(brand => queryLower.includes(brand));
  }

  // 判斷是否為純類別查詢
  isPureCategoryQuery(query, filters = {}) {
    const queryLower = query.toLowerCase().trim();
    const pureCategoryTerms = ['女裝', '男裝', '童裝', '兒童', '小孩', '女生', '男生', '女性', '男性'];
    return pureCategoryTerms.some(term => queryLower === term) || filters.category;
  }

  // 判斷是否為描述性查詢
  isDescriptiveQuery(query) {
    const descriptiveWords = ['適合', '好看', '舒適', '時尚', '優雅', '休閒', '正式', '約會', '工作', '運動'];
    return descriptiveWords.some(word => query.includes(word)) || query.length > 10;
  }

  // LLM 智能推薦標記 - 分析搜索結果中最符合用戶需求的商品
  async addLLMRecommendation(originalQuery, searchResults) {
    try {
      console.log(`🤖 LLM 推薦分析: "${originalQuery}"`);
      
      // 準備商品資訊給 LLM 分析
      const productsForAnalysis = searchResults.map((product, index) => ({
        index: index,
        name: product.name,
        price: product.new_price,
        category: product.category,
        description: product.description?.substring(0, 200) || '', // 限制描述長度
        similarity_score: product.similarity_score
      }));

      if (productsForAnalysis.length === 0) {
        console.log('❌ 沒有商品可供 LLM 分析');
        return searchResults;
      }

      // 構建 LLM 分析請求
      const analysisPrompt = `
作為電商搜索專家，請分析以下搜索結果，選出最符合用戶需求的商品。

用戶搜索: "${originalQuery}"

商品列表:
${productsForAnalysis.map(p => `
${p.index}. ${p.name}
   價格: $${p.price}
   類別: ${p.category}
   描述: ${p.description}
   相似度: ${p.similarity_score?.toFixed(3) || 'N/A'}
`).join('')}

請選擇最推薦的商品並說明理由。回應格式：
{
  "recommended_index": 數字,
  "reason": "推薦理由（50字內）"
}`;

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: "你是專業的電商推薦專家，能夠理解用戶需求並推薦最合適的商品。"
          },
          {
            role: "user", 
            content: analysisPrompt
          }
        ],
        max_tokens: 200,
        temperature: 0.3
      });

      const responseText = response.choices[0]?.message?.content?.trim() || '';
      console.log(`🤖 LLM 推薦回應: ${responseText}`);

      // 解析 LLM 回應
      try {
        // 清理 markdown 格式
        const cleanedResponse = responseText
          .replace(/```json\s*/g, '')
          .replace(/```\s*/g, '')
          .trim();

        const recommendation = JSON.parse(cleanedResponse);
        const recommendedIndex = recommendation.recommended_index;
        const reason = recommendation.reason;

        if (typeof recommendedIndex === 'number' && 
            recommendedIndex >= 0 && 
            recommendedIndex < searchResults.length) {
          
          // 標記推薦商品
          const updatedResults = searchResults.map((product, index) => ({
            ...product,
            llm_recommended: index === recommendedIndex,
            recommendation_reason: index === recommendedIndex ? reason : undefined
          }));

          console.log(`⭐ LLM 推薦: ${updatedResults[recommendedIndex].name} - ${reason}`);
          return updatedResults;
        } else {
          console.log('❌ LLM 推薦索引無效，跳過推薦標記');
          return searchResults;
        }

      } catch (parseError) {
        console.log('❌ LLM 推薦回應解析失敗:', parseError.message);
        return searchResults;
      }

    } catch (error) {
      console.error('❌ LLM 推薦分析失敗:', error.message);
      return searchResults; // 失敗時返回原始結果
    }
  }
}

module.exports = SearchService;