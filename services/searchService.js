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
  
  // 向量搜索
  async vectorSearch(database, queryVector, limit, filters = {}) {
    try {
      const filterConditions = {
        available: { $eq: true },
        ...filters
      };
      
      const results = await database.collection('products').aggregate([
        {
          $vectorSearch: {
            index: "product_search_index",
            path: "product_embedding",
            queryVector: queryVector,
            numCandidates: Math.min(limit * 5, 100),
            limit: limit,
            filter: filterConditions
          }
        },
        {
          $addFields: {
            search_type: "vector",
            similarity_score: { $meta: "vectorSearchScore" }
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
            description: { $substr: ["$description", 0, 100] },
            categories: 1,
            tags: 1,
            search_type: 1,
            similarity_score: 1
          }
        }
      ]).toArray();
      
      console.log(`🔍 向量搜索找到 ${results.length} 個結果`);
      return results;
      
    } catch (error) {
      console.error('❌ 向量搜索失敗:', error.message);
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
  
  // 混合式搜索
  async hybridSearch(database, query, options = {}) {
    const {
      limit = 10,
      filters = {},
      enableVector = true,
      enableKeyword = true
    } = options;
    
    console.log(`🚀 開始混合搜索: "${query}"`);
    
    const weights = this.getSearchWeights(query);
    console.log(`⚖️ 搜索權重 - 向量: ${weights.vector}, 關鍵字: ${weights.keyword}`);
    
    const vectorLimit = Math.ceil(limit * weights.vector);
    const keywordLimit = Math.ceil(limit * weights.keyword);
    
    const promises = [];
    
    // 向量搜索
    if (enableVector) {
      const queryVector = await this.generateQueryVector(query);
      if (queryVector) {
        promises.push(this.vectorSearch(database, queryVector, vectorLimit, filters));
      } else {
        promises.push(Promise.resolve([]));
      }
    } else {
      promises.push(Promise.resolve([]));
    }
    
    // 關鍵字搜索
    if (enableKeyword) {
      promises.push(this.keywordSearch(database, query, keywordLimit, filters));
    } else {
      promises.push(Promise.resolve([]));
    }
    
    const [vectorResults, keywordResults] = await Promise.all(promises);
    
    // 合併結果並去重
    const allResults = [
      ...vectorResults.map(item => ({
        ...item,
        final_score: item.similarity_score * weights.vector
      })),
      ...keywordResults
        .filter(item => !vectorResults.some(vr => vr.id === item.id))
        .map(item => ({
          ...item,
          final_score: item.similarity_score * weights.keyword
        }))
    ];
    
    // 按相關性排序
    const sortedResults = allResults
      .sort((a, b) => (b.final_score || 0) - (a.final_score || 0))
      .slice(0, limit);
    
    console.log(`✅ 混合搜索完成 - 向量: ${vectorResults.length}, 關鍵字: ${keywordResults.length}, 總計: ${sortedResults.length}`);
    
    return {
      results: sortedResults,
      breakdown: {
        vector_results: vectorResults.length,
        keyword_results: keywordResults.length,
        total_unique: sortedResults.length,
        weights: weights
      }
    };
  }
}

module.exports = new SearchService();
