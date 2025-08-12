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
const searchService = require('./services/searchService');

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

// API for AI search
app.post("/ai-search", async (req, res) => {
    try {
        console.log(`🚨 收到 AI 搜索請求！`);
        console.log(`📨 請求體:`, req.body);
        
        const { query, limit = 10, filters = {}, searchType = 'hybrid' } = req.body;
        
        if (!query || !query.trim()) {
            console.log(`❌ 搜索查詢為空`);
            return res.status(400).json({
                success: false,
                message: "搜索查詢不能為空"
            });
        }

        console.log(`🔍 AI搜索請求: "${query}", limit: ${limit}`);
        
        const database = await connectToDatabase();
        let searchResults;
        
        // 只使用純語意向量搜索
        console.log(`🎯 執行純語意向量搜索: "${query}"`);
        searchResults = await searchService.vectorOnlySearch(database, query, limit, filters);
        
        console.log(`✅ AI搜索完成: 找到 ${searchResults.results.length} 個結果`);
        
        res.json({
            success: true,
            query: query,
            searchType: searchType,
            totalResults: searchResults.results.length,
            breakdown: searchResults.breakdown,
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

// Export for Vercel
module.exports = app;
