const port = process.env.PORT || 4000;
const express = require('express');
const app = express();
const { MongoClient, ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const cors = require('cors');

app.use(express.json());
app.use(cors());

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

// API for uploading images - simplified for now
app.post("/upload", upload.single("product"), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: "No file uploaded"
            });
        }
        
        // For now, return a placeholder URL
        // In production, you'd upload to a cloud service like Cloudinary
        const imageUrl = `${process.env.BASE_URL || `https://ecommerce-backend-indol-xi.vercel.app`}/images/placeholder.jpg`;
        
        res.json({
            success: true,
            imageUrl: imageUrl
        });
    } catch (error) {
        console.error("Upload error:", error);
        res.status(500).json({
            success: false,
            message: "Upload failed"
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

        await productsCollection.insertOne(product);
        console.log("Product saved:", product.name);
        
        res.json({
            success: true,
            name: req.body.name,
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
