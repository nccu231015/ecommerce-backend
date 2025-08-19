require('dotenv').config();

const port = process.env.PORT || 4000;
const express = require('express');
const app = express();
const { MongoClient, ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const cors = require('cors');
const cloudinary = require('cloudinary').v2;
const SearchService = require('./services/searchService');
const searchService = new SearchService();

app.use(express.json());
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

// Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// MongoDB connection using native driver
const mongoUri = process.env.MONGODB_URI || "mongodb+srv://ecommercedev:estmarche0212@cluster0.wj9jly9.mongodb.net/e-commerce";
console.log("Setting up MongoDB client...");

let db;
let client;

const connectToDatabase = async () => {
    try {
        if (!client) {
            console.log("Creating new MongoDB client...");
            client = new MongoClient(mongoUri, {
                serverSelectionTimeoutMS: 5000,
                socketTimeoutMS: 5000,
                connectTimeoutMS: 5000,
                maxPoolSize: 5,
                minPoolSize: 1,
                maxIdleTimeMS: 30000,
            });
        }
        
        if (!db) {
            console.log("Connecting to database...");
            await client.connect();
            db = client.db('e-commerce');
            console.log("✅ Connected to MongoDB successfully");
        }
        
        return db;
    } catch (error) {
        console.error("❌ MongoDB connection error:", error.message);
        throw error;
    }
};

// Root API endpoint
app.get("/", async (req, res) => {
    try {
        const database = await connectToDatabase();
        res.json({
            success: true,
            message: "Express app is running",
            timestamp: new Date().toISOString(),
            mongodb: "connected"
        });
    } catch (error) {
    res.json({
        success: true,
            message: "Express app is running",
            timestamp: new Date().toISOString(),
            mongodb: "disconnected",
            error: error.message
        });
    }
});

// Health check endpoint
app.get("/health", async (req, res) => {
    try {
        const database = await connectToDatabase();
        const productsCollection = database.collection('products');
        const productCount = await productsCollection.countDocuments();
        
        res.json({
            success: true,
            message: "Health check passed",
            database: {
                status: "connected",
                productCount: productCount
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Health check failed",
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Image storage engine - using memory storage for Vercel serverless
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    }
});

// API for uploading images to Cloudinary
app.post("/upload", upload.single("product"), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: "No file uploaded"
            });
        }
        
        // Upload to Cloudinary using buffer
        const uploadResponse = await new Promise((resolve, reject) => {
            cloudinary.uploader.upload_stream(
                {
                    folder: "ecommerce-products",
                    resource_type: "image",
                    transformation: [
                        { width: 800, height: 800, crop: "fill", gravity: "center" }, // 統一尺寸，智能裁切
                        { quality: "auto", format: "auto", fetch_format: "auto" },
                        { dpr: "auto" } // 自動設備像素比
                    ]
                },
                (error, result) => {
                    if (error) reject(error);
                    else resolve(result);
                }
            ).end(req.file.buffer);
        });
        
        res.json({
            success: true,
            imageUrl: uploadResponse.secure_url,
            public_id: uploadResponse.public_id
        });
        
    } catch (error) {
        console.error("Upload error:", error);
        res.status(500).json({
            success: false,
            message: "Upload failed",
            error: error.message
        });
    }
});

// Helper function to get next product ID
const getNextProductId = async (database) => {
    const productsCollection = database.collection('products');
    const lastProduct = await productsCollection.findOne({}, { sort: { id: -1 } });
    return lastProduct ? lastProduct.id + 1 : 1;
};

// API for adding products
app.post("/addproduct", async (req, res) => {
    try {
        const database = await connectToDatabase();
        const productsCollection = database.collection('products');
        
        const id = await getNextProductId(database);

        const product = {
        id: id,
        name: req.body.name,
        image: req.body.image,
        category: req.body.category,
        new_price: req.body.new_price,
        old_price: req.body.old_price,
            description: req.body.description || "",
            categories: req.body.categories || [],
            tags: req.body.tags || [],
            date: new Date(),
            available: true
        };

        // 🤖 自動生成向量嵌入
        console.log("🤖 正在生成商品向量嵌入...");
        const productEmbedding = await generateProductEmbedding(product);
        
        if (productEmbedding) {
            product.product_embedding = productEmbedding;
            product.vector_generated_at = new Date();
            product.embedding_model = "text-embedding-ada-002";
            console.log("✅ 商品向量嵌入生成成功");
        } else {
            console.log("⚠️ 商品向量嵌入生成失敗，但商品仍會被保存");
        }

        await productsCollection.insertOne(product);
        console.log("Product saved:", product.name);
        
    res.json({
        success: true,
        name: req.body.name,
            hasVector: !!productEmbedding,
            message: productEmbedding ? "商品添加成功，AI搜索已啟用" : "商品添加成功，但AI搜索功能暫時不可用"
        });
    } catch (error) {
        console.error("Add product error:", error);
        res.status(500).json({
            success: false,
            message: "Failed to add product"
        });
    }
});

// API for removing products
app.post("/removeproduct", async (req, res) => {
    try {
        const database = await connectToDatabase();
        const productsCollection = database.collection('products');
        
        await productsCollection.deleteOne({ id: req.body.id });
        console.log("Product removed with ID:", req.body.id);
        
    res.json({
        success: true,
            name: req.body.name
        });
    } catch (error) {
        console.error("Remove product error:", error);
        res.status(500).json({
            success: false,
            message: "Failed to remove product"
        });
    }
});

// API for getting all products
app.get("/allproduct", async (req, res) => {
    try {
        console.log("Attempting to fetch all products...");
        
        const database = await connectToDatabase();
        const productsCollection = database.collection('products');
        
        console.log("Executing query...");
        const products = await productsCollection.find({}).toArray();
        
        console.log("Query completed, products count:", products.length);
        
        return res.json(products);
        
    } catch (error) {
        console.error("Get all products error:", error.message);
        res.status(500).json({
            success: false,
            message: "Failed to fetch products",
            error: error.message
        });
    }
});

// Helper function for user operations
const getUsersCollection = async () => {
    const database = await connectToDatabase();
    return database.collection('users');
};

// API for user signup
app.post('/signup', async (req, res) => {
    try {
        const usersCollection = await getUsersCollection();
    
        const check = await usersCollection.findOne({ email: req.body.email });
    if (check) {
            return res.status(400).json({
                success: false,
                errors: "Existing user found with same email address"
            });
    }
        
    let cart = {};
    for (let i = 0; i < 300; i++) {
        cart[i] = 0;
    }
        
        const user = {
            name: req.body.username,
        email: req.body.email,
        password: req.body.password,
            cartData: cart,
            date: new Date()
        };

        const result = await usersCollection.insertOne(user);

    const data = {
        user: {
                id: result.insertedId
        }
        };

    const token = jwt.sign(data, 'secret_ecom');
        res.json({ success: true, token });
    } catch (error) {
        console.error("Signup error:", error);
        res.status(500).json({
            success: false,
            message: "Signup failed"
        });
    }
});

// API for user login
app.post('/login', async (req, res) => {
    try {
        const usersCollection = await getUsersCollection();
        
        const user = await usersCollection.findOne({ email: req.body.email });
    if (user) {
        const passCompare = req.body.password === user.password;
        if (passCompare) {
            const data = {
                user: {
                        id: user._id
                    }
                };
                const token = jwt.sign(data, 'secret_ecom');
                res.json({ success: true, token });
            } else {
                res.json({ success: false, errors: "Wrong Password" });
            }
        } else {
            res.json({ success: false, errors: "Wrong Email Id" });
        }
    } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({
            success: false,
            message: "Login failed"
        });
    }
});

// API for getting new collections
app.get('/newcollection', async (req, res) => {
    try {
        const database = await connectToDatabase();
        const productsCollection = database.collection('products');
        
        const products = await productsCollection.find({}).toArray();
        const newcollection = products.slice(1).slice(-8);
        console.log("NewCollection Fetched");
        res.send(newcollection);
    } catch (error) {
        console.error("New collection error:", error);
        res.status(500).json({
            success: false,
            message: "Failed to fetch new collection"
        });
    }
});

// API for getting popular products in women category
app.get('/popularinwomen', async (req, res) => {
    try {
        const database = await connectToDatabase();
        const productsCollection = database.collection('products');
        
        const products = await productsCollection.find({ category: "women" }).toArray();
        const popular_in_women = products.slice(0, 4);
        console.log("Popular in women fetched");
        res.send(popular_in_women);
    } catch (error) {
        console.error("Popular in women error:", error);
        res.status(500).json({
            success: false,
            message: "Failed to fetch popular products"
        });
    }
});

// Middleware to fetch user
    const fetchUser = async (req, res, next) => {
        const token = req.header('auth-token');
        if (!token) {
        res.status(401).send({ errors: "Please authenticate using valid token" });
    } else {
            try {
                const data = jwt.verify(token, 'secret_ecom');
                req.user = data.user;
                next();
            } catch (error) {
            res.status(401).send({ errors: "Please authenticate using a valid token" });
        }
    }
};

// API for adding products to cart
app.post('/addtocart', fetchUser, async (req, res) => {
    try {
        console.log("Added", req.body.itemId);
        const usersCollection = await getUsersCollection();
        
        const userData = await usersCollection.findOne({ _id: new ObjectId(req.user.id) });
        userData.cartData[req.body.itemId] += 1;
        await usersCollection.updateOne(
            { _id: new ObjectId(req.user.id) }, 
            { $set: { cartData: userData.cartData } }
        );
        res.send("Added");
    } catch (error) {
        console.error("Add to cart error:", error);
        res.status(500).json({
            success: false,
            message: "Failed to add to cart"
        });
    }
});

// API for removing products from cart
app.post('/removefromcart', fetchUser, async (req, res) => {
    try {
        console.log("removed", req.body.itemId);
        const usersCollection = await getUsersCollection();
        
        const userData = await usersCollection.findOne({ _id: new ObjectId(req.user.id) });
        if (userData.cartData[req.body.itemId] > 0)
            userData.cartData[req.body.itemId] -= 1;
        await usersCollection.updateOne(
            { _id: new ObjectId(req.user.id) }, 
            { $set: { cartData: userData.cartData } }
        );
        res.send("Removed");
    } catch (error) {
        console.error("Remove from cart error:", error);
        res.status(500).json({
            success: false,
            message: "Failed to remove from cart"
        });
    }
});

// API for getting cart data
app.post('/getcart', fetchUser, async (req, res) => {
    try {
        console.log("GetCart");
        const usersCollection = await getUsersCollection();
        
        const userData = await usersCollection.findOne({ _id: new ObjectId(req.user.id) });
    res.json(userData.cartData);
    } catch (error) {
        console.error("Get cart error:", error);
        res.status(500).json({
            success: false,
            message: "Failed to get cart data"
        });
    }
});

// 生成商品向量嵌入的函數 - 使用 searchService 中的功能
async function generateProductEmbedding(product) {
    try {
        const searchableText = [
            product.name || '',
            product.description || '',
            product.category || '',
            (product.categories || []).join(' '),
            (product.tags || []).join(' ')
        ].filter(text => text.trim().length > 0).join(' ');
        
        // 重用 searchService 的向量生成功能
        return await searchService.generateQueryVector(searchableText);
    } catch (error) {
        console.error(`❌ 商品向量生成失敗:`, error.message);
        return null;
    }
}

// Debug Search endpoint - 臨時調試用
app.post("/debug-search-detailed", async (req, res) => {
    try {
        const { query, searchType = "hybrid", limit = 10 } = req.body;
        
        console.log(`🐛 詳細調試搜索: "${query}", 類型: ${searchType}`);
        
        // 直接測試關鍵字搜索
        const keywordResults = await searchService.keywordSearch(db, query, limit);
        console.log(`🐛 關鍵字搜索結果:`, keywordResults.length);
        
        // 直接測試向量搜索
        let vectorResults = [];
        try {
            vectorResults = await searchService.vectorSearch(db, query, limit);
            console.log(`🐛 向量搜索結果:`, vectorResults.length);
        } catch (error) {
            console.log(`🐛 向量搜索失敗:`, error.message);
        }
        
        res.json({
            success: true,
            debug: {
                query,
                keyword_results_count: keywordResults.length,
                vector_results_count: vectorResults.length,
                keyword_sample: keywordResults.slice(0, 2).map(r => ({ id: r.id, name: r.name })),
                vector_sample: vectorResults.slice(0, 2).map(r => ({ id: r.id, name: r.name }))
            }
        });
        
    } catch (error) {
        console.error("調試搜索錯誤:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// API for testing LLM query optimization (debug only)
app.post("/test-llm-optimization", async (req, res) => {
    try {
        const { query } = req.body;
        if (!query) {
            return res.status(400).json({
                success: false,
                message: "查詢不能為空"
            });
        }

        console.log(`🧪 測試 LLM 優化: "${query}"`);
        
        const database = await connectToDatabase();
        const optimization = await searchService.optimizeSearchQuery(query);
        
        res.json({
            success: true,
            original_query: query,
            optimization: optimization,
            debug: {
                has_keywords: !!optimization.keywords,
                has_filters: Object.keys(optimization.filters || {}).length > 0,
                filters_count: Object.keys(optimization.filters || {}).length
            }
        });

    } catch (error) {
        console.error("LLM 優化測試錯誤:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// API for AI search - 混合搜索（向量搜索 + 全文搜索）+ LLM 推薦
app.post("/ai-search", async (req, res) => {
    try {
        console.log(`🚨 收到 AI 搜索請求！`);
        console.log(`📨 請求體:`, req.body);
        
        const { query, limit = 10, filters = {} } = req.body;
        
        if (!query || !query.trim()) {
            console.log(`❌ 搜索查詢為空`);
            return res.status(400).json({
                success: false,
                message: "搜索查詢不能為空"
            });
        }

        console.log(`🔍 AI混合搜索請求: "${query}", limit: ${limit}`);
        
        const database = await connectToDatabase();
        
        // 執行混合搜索
        console.log(`🔄 執行混合搜索 (向量 + 全文): "${query}"`);
        let searchResults = await searchService.hybridSearch(database, query, limit, filters);
        
        // 添加 LLM 推薦標記（如果有搜索結果）
        if (searchResults.results && searchResults.results.length > 0) {
            console.log(`🤖 添加 LLM 推薦分析...`);
            searchResults.results = await searchService.addLLMRecommendation(searchResults.results, query);
        }
        
        console.log(`✅ AI搜索完成: 找到 ${searchResults.results.length} 個結果`);
        
        // 提取 LLM 推薦資訊
        const aiRecommended = searchResults.results.find(product => product.llm_recommended);
        const llmRecommendation = aiRecommended ? {
            product_name: aiRecommended.name,
            reason: aiRecommended.recommendation_reason,
            confidence: "高"
        } : null;
        
        res.json({
            success: true,
            query: query,
            searchType: "hybrid",
            totalResults: searchResults.results.length,
            breakdown: searchResults.breakdown,
            llm_recommendation: llmRecommendation,
            results: searchResults.results
        });
        
    } catch (error) {
        console.error("❌ AI搜索失敗:", error.message);
        res.status(500).json({
            success: false,
            message: "搜索服務暫時不可用",
            error: error.message
        });
    }
});

// API for getting a single product by ID - 獲取單個商品詳情
app.get("/product/:productId", async (req, res) => {
    try {
        const { productId } = req.params;
        
        if (!productId) {
            return res.status(400).json({
                success: false,
                message: "商品ID不能為空"
            });
        }
        
        console.log(`🔍 獲取商品 ID: ${productId} 的詳細信息`);
        
        const database = await connectToDatabase();
        const productsCollection = database.collection('products');
        
        const product = await productsCollection.findOne({ 
            id: parseInt(productId),
            available: true 
        });
        
        if (!product) {
            return res.status(404).json({
                success: false,
                message: "商品不存在或已下架"
            });
        }
        
        console.log(`✅ 成功獲取商品: ${product.name}`);
        
        res.json({
            success: true,
            product: product
        });
        
    } catch (error) {
        console.error("❌ 獲取商品詳情失敗:", error.message);
        res.status(500).json({
            success: false,
            message: "獲取商品詳情服務暫時不可用",
            error: error.message
        });
    }
});

// API for related products - 獲取相關商品推薦
app.get("/related-products/:productId", async (req, res) => {
    try {
        const { productId } = req.params;
        const { limit = 4 } = req.query;
        
        if (!productId) {
            return res.status(400).json({
                success: false,
                message: "商品ID不能為空"
            });
        }
        
        console.log(`🔍 獲取商品 ID: ${productId} 的相關推薦`);
        
        const database = await connectToDatabase();
        const relatedResults = await searchService.getRelatedProducts(database, productId, parseInt(limit));
        
        console.log(`✅ 相關商品推薦完成: 找到 ${relatedResults.results.length} 個結果`);
        
        res.json({
            success: true,
            productId: productId,
            totalResults: relatedResults.results.length,
            breakdown: relatedResults.breakdown,
            results: relatedResults.results
        });
        
    } catch (error) {
        console.error("❌ 獲取相關商品失敗:", error.message);
        res.status(500).json({
            success: false,
            message: "相關商品推薦服務暫時不可用",
            error: error.message
        });
    }
});

// API for comparing materials between two products using LLM - 使用LLM比較兩個商品的材質
app.post("/compare-materials", async (req, res) => {
    try {
        const { originalProductId, recommendedProductId } = req.body;
        
        if (!originalProductId || !recommendedProductId) {
            return res.status(400).json({
                success: false,
                message: "需要提供兩個商品ID進行比較"
            });
        }
        
        console.log(`🔍 材質比較請求: ${originalProductId} vs ${recommendedProductId}`);
        
        const database = await connectToDatabase();
        const productsCollection = database.collection('products');
        
        // 獲取兩個商品的詳細信息
        const [originalProduct, recommendedProduct] = await Promise.all([
            productsCollection.findOne({ id: parseInt(originalProductId), available: true }),
            productsCollection.findOne({ id: parseInt(recommendedProductId), available: true })
        ]);
        
        if (!originalProduct || !recommendedProduct) {
            return res.status(404).json({
                success: false,
                message: "找不到指定的商品"
            });
        }
        
        // 使用 LLM 進行材質比較
        const materialComparison = await searchService.compareProductMaterials(originalProduct, recommendedProduct);
        
        console.log(`✅ 材質比較完成: ${materialComparison.comparison.substring(0, 50)}...`);
        
        res.json({
            success: true,
            originalProduct: {
                id: originalProduct.id,
                name: originalProduct.name,
                description: originalProduct.description
            },
            recommendedProduct: {
                id: recommendedProduct.id,
                name: recommendedProduct.name,
                description: recommendedProduct.description
            },
            materialComparison: materialComparison
        });
        
    } catch (error) {
        console.error("❌ 材質比較失敗:", error.message);
        res.status(500).json({
            success: false,
            message: "材質比較服務暫時不可用",
            error: error.message
        });
    }
});


// API for exact product name match
app.post("/exact-search", async (req, res) => {
    try {
        const { query } = req.body;
        
        if (!query || !query.trim()) {
            return res.json({
                success: true,
                results: []
            });
        }

        console.log(`🎯 精確匹配搜索: "${query}"`);
        
        const database = await connectToDatabase();
        const productsCollection = database.collection('products');
        
        // 精確匹配商品名稱
        const exactMatch = await productsCollection.findOne({
            name: query,
            available: true
        });
        
        const results = exactMatch ? [exactMatch] : [];
        
        console.log(`✅ 精確匹配結果: ${results.length} 個`);
        
        res.json({
            success: true,
            results: results,
            breakdown: {
                search_method: "exact_name_match",
                total_results: results.length
            }
        });
        
    } catch (error) {
        console.error("精確搜索錯誤:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// API for search suggestions
app.post("/search-suggestions", async (req, res) => {
    try {
        const { query, limit = 5 } = req.body;
        
        if (!query || query.trim().length < 2) {
            return res.json({
                success: true,
                suggestions: []
            });
        }
        
        const database = await connectToDatabase();
        const productsCollection = database.collection('products');
        
        // 基於現有商品名稱和標籤生成建議
        const suggestions = await productsCollection.aggregate([
            {
                $match: {
                    $or: [
                        { name: { $regex: query, $options: 'i' } },
                        { categories: { $elemMatch: { $regex: query, $options: 'i' } } },
                        { tags: { $elemMatch: { $regex: query, $options: 'i' } } }
                    ]
                }
            },
            {
                $project: {
                    suggestion: "$name"
                }
            },
            {
                $limit: limit
            }
        ]).toArray();
        
        const suggestionTexts = suggestions.map(s => s.suggestion);
        
        res.json({
            success: true,
            suggestions: suggestionTexts
        });
        
    } catch (error) {
        console.error("❌ 搜索建議失敗:", error.message);
        res.json({
            success: true,
            suggestions: []
        });
    }
});

// API for trending searches
app.get("/trending-searches", async (req, res) => {
    try {
        // 模擬熱門搜索詞
        const trendingTerms = [
            "黑色上衣",
            "運動服",
            "約會穿搭",
            "休閒外套",
            "夏季洋裝",
            "牛仔褲",
            "正式服裝",
            "舒適鞋子"
        ];
        
        res.json({
            success: true,
            trending: trendingTerms
        });
        
    } catch (error) {
        console.error("❌ 熱門搜索失敗:", error.message);
        res.json({
            success: true,
            trending: []
        });
    }
});

// Start server
app.listen(port, (error) => {
    if (!error) {
        console.log("Server is running on port " + port);
    } else {
        console.log("Error occurred: " + error);
    }
});

// 診斷向量搜索端點
app.post('/debug-vector', async (req, res) => {
    try {
        const { query } = req.body;
        const database = await connectToDatabase();
        
        console.log(`🔍 診斷向量搜索: "${query}"`);
        
        // 測試向量生成
        const queryVector = await searchService.generateQueryVector(query);
        if (!queryVector) {
            return res.json({
                success: false,
                step: "vector_generation",
                error: "向量生成失敗"
            });
        }
        
        console.log(`✅ 向量生成成功，維度: ${queryVector.length}`);
        
        // 測試向量搜索
        try {
            const vectorResults = await database.collection('products').aggregate([
                {
                    $vectorSearch: {
                        index: "vector_index",
                        path: "product_embedding", 
                        queryVector: queryVector,
                        numCandidates: 100,
                        limit: 5,
                        filter: { available: { $eq: true } }
                    }
                },
                {
                    $addFields: {
                        search_type: "vector_only",
                        similarity_score: { $meta: "searchScore" }
                    }
                },
                {
                    $project: {
                        _id: 1, id: 1, name: 1, search_type: 1, similarity_score: 1
                    }
                }
            ]).toArray();
            
            console.log(`✅ 向量搜索成功，結果: ${vectorResults.length}`);
            
            res.json({
                success: true,
                vectorGeneration: "成功",
                vectorDimension: queryVector.length,
                vectorSearchResults: vectorResults.length,
                results: vectorResults
            });
            
        } catch (vectorError) {
            console.error(`❌ 向量搜索失敗:`, vectorError.message);
            res.json({
                success: false,
                step: "vector_search",
                error: vectorError.message,
                vectorGeneration: "成功",
                vectorDimension: queryVector.length
            });
        }
        
    } catch (error) {
        console.error('❌ 診斷失敗:', error.message);
        res.json({
            success: false,
            step: "general",
            error: error.message
        });
    }
});

// 測試 MongoDB Atlas Window Functions 支援
app.post('/debug-hybrid', async (req, res) => {
    try {
        const { query } = req.body;
        const database = await connectToDatabase();
        
        console.log(`🔍 測試 MongoDB Atlas Window Functions: "${query}"`);
        
        // 測試基本的 $setWindowFields 支援
        try {
            const testResults = await database.collection('products').aggregate([
                { $match: { available: true } },
                { $limit: 3 },
                {
                    $setWindowFields: {
                        sortBy: { id: 1 },
                        output: {
                            testRank: { $rank: {} }
                        }
                    }
                },
                { $project: { id: 1, name: 1, testRank: 1 } }
            ]).toArray();
            
            console.log('✅ Window Functions 支援測試成功');
            
            // 測試具體的 RRF 混合搜索步驟
            console.log('🔍 開始逐步測試 RRF 混合搜索...');
            
            // 步驟1：測試向量搜索
            const queryVector = await searchService.generateQueryVector(query);
            if (!queryVector) {
                throw new Error('向量生成失敗');
            }
            console.log(`✅ 向量生成成功，維度: ${queryVector.length}`);
            
            // 步驟2：測試向量搜索管道
            const vectorResults = await database.collection('products').aggregate([
                {
                    $vectorSearch: {
                        index: "vector_index",
                        path: "product_embedding",
                        queryVector: queryVector,
                        numCandidates: 100,
                        limit: 10,
                        filter: { available: { $eq: true } }
                    }
                },
                {
                    $addFields: {
                        vectorRank: { $meta: "searchScore" },
                        searchSource: "vector"
                    }
                },
                { $limit: 5 }
            ]).toArray();
            console.log(`✅ 向量搜索成功，結果: ${vectorResults.length}`);
            
            // 步驟3：測試全文搜索管道
            const textResults = await database.collection('products').aggregate([
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
                            filter: [
                                { equals: { path: "available", value: true } }
                            ]
                        }
                    }
                },
                {
                    $addFields: {
                        textRank: { $meta: "searchScore" },
                        searchSource: "text"
                    }
                },
                { $limit: 5 }
            ]).toArray();
            console.log(`✅ 全文搜索成功，結果: ${textResults.length}`);
            
            // 步驟4：測試完整的 RRF 混合搜索
            try {
                const searchResults = await searchService.hybridSearch(database, query, 5, {});
                
                res.json({
                    success: true,
                    windowFunctionsSupported: true,
                    testResults: testResults,
                    vectorResults: vectorResults.length,
                    textResults: textResults.length,
                    finalSearchMethod: searchResults.breakdown.search_method,
                    totalResults: searchResults.results.length,
                    rrfSuccess: searchResults.breakdown.search_method.includes('rrf'),
                    results: searchResults.results.map(r => ({
                        id: r.id,
                        name: r.name,
                        search_type: r.search_type,
                        similarity_score: r.similarity_score
                    }))
                });
                
            } catch (rrfError) {
                console.error('❌ RRF 混合搜索失敗:', rrfError.message);
                
                res.json({
                    success: false,
                    windowFunctionsSupported: true,
                    testResults: testResults,
                    vectorResults: vectorResults.length,
                    textResults: textResults.length,
                    rrfError: rrfError.message,
                    rrfErrorStack: rrfError.stack
                });
            }
            
        } catch (windowError) {
            console.error('❌ Window Functions 不支援:', windowError.message);
            
            // 降級測試：直接測試向量搜索
            const vectorResults = await searchService.vectorOnlySearch(database, query, 5, {});
            
            res.json({
                success: false,
                windowFunctionsSupported: false,
                windowError: windowError.message,
                fallbackMethod: vectorResults.breakdown.search_method,
                totalResults: vectorResults.results.length,
                results: vectorResults.results.map(r => ({
                    id: r.id,
                    name: r.name,
                    search_type: r.search_type
                }))
            });
        }
        
    } catch (error) {
        console.error('❌ 診斷測試失敗:', error.message);
        res.json({
            success: false,
            step: "general_error",
            error: error.message
        });
    }
});

// Export for Vercel
module.exports = app;
