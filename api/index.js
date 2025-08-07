const port = process.env.PORT || 4000;
const express = require('express');
const app = express();
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const cors = require('cors');

app.use(express.json());
app.use(cors());

// MongoDB connection with options
const mongoUri = process.env.MONGODB_URI || "mongodb+srv://ecommercedev:estmarche0212@cluster0.wj9jly9.mongodb.net/e-commerce";
console.log("Attempting to connect to MongoDB...");

const mongoOptions = {
    serverSelectionTimeoutMS: 30000, // 30 seconds
    socketTimeoutMS: 45000, // 45 seconds
    bufferMaxEntries: 0, // Disable mongoose buffering
    maxPoolSize: 10, // Maintain up to 10 socket connections
    serverSelectionTimeoutMS: 30000, // Keep trying to send operations for 30 seconds
    heartbeatFrequencyMS: 10000, // Every 10 seconds
};

mongoose.connect(mongoUri, mongoOptions)
.then(() => {
    console.log("✅ MongoDB connected successfully");
    console.log("Database:", mongoose.connection.db.databaseName);
})
.catch((error) => {
    console.error("❌ MongoDB connection error:", error.message);
    console.error("Connection string (masked):", mongoUri.replace(/\/\/.*:.*@/, "//***:***@"));
});

// Root API endpoint
app.get("/", (req, res) => {
    res.json({
        success: true,
        message: "Express app is running",
        timestamp: new Date().toISOString(),
        mongodb: mongoose.connection.readyState === 1 ? "connected" : "disconnected"
    });
});

// Health check endpoint
app.get("/health", async (req, res) => {
    try {
        // Test MongoDB connection
        const dbState = mongoose.connection.readyState;
        const dbStatus = {
            0: "disconnected",
            1: "connected", 
            2: "connecting",
            3: "disconnecting"
        };
        
        // Try to count products
        const productCount = await Product.countDocuments();
        
        res.json({
            success: true,
            message: "Health check passed",
            database: {
                status: dbStatus[dbState],
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

// Schema for creating products
const Product = mongoose.model("Product", {
    id: {
        type: Number,
        required: true
    },
    name: {
        type: String,
        required: true
    },
    image: {
        type: String,
        required: true
    },
    category: {
        type: String,
        required: true
    },
    new_price: {
        type: Number,
        required: true
    },
    old_price: {
        type: Number,
        required: true
    },
    description: {
        type: String,
        default: ""
    },
    date: {
        type: Date,
        default: Date.now
    },
    available: {
        type: Boolean,
        default: true
    },
    categories: {
        type: [String],
        default: []
    },
    tags: {
        type: [String],
        default: []
    }
});

// API for adding products
app.post("/addproduct", async (req, res) => {
    try {
        let products = await Product.find({});
        let id = products.length > 0 ? products.slice(-1)[0].id + 1 : 1;

        const product = new Product({
            id: id,
            name: req.body.name,
            image: req.body.image,
            category: req.body.category,
            new_price: req.body.new_price,
            old_price: req.body.old_price,
            description: req.body.description || "",
            categories: req.body.categories || [],
            tags: req.body.tags || [],
        });

        await product.save();
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
        await Product.findOneAndDelete({ id: req.body.id });
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
        let products = await Product.find({});
        console.log("All products fetched, count:", products.length);
        
        // If no products found, return empty array instead of error
        if (products.length === 0) {
            console.log("No products found in database");
            return res.json([]);
        }
        
        res.json(products);
    } catch (error) {
        console.error("Get all products error:", error);
        res.status(500).json({
            success: false,
            message: "Failed to fetch products",
            error: error.message
        });
    }
});

// Schema for users
const Users = mongoose.model('Users', {
    name: {
        type: String,
    },
    email: {
        type: String,
        unique: true,
    },
    password: {
        type: String,
    },
    cartData: {
        type: Object,
    },
    date: {
        type: Date,
        default: Date.now,
    }
});

// API for user signup
app.post('/signup', async (req, res) => {
    try {
        let check = await Users.findOne({ email: req.body.email });
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
        
        const user = new Users({
            name: req.body.username,
            email: req.body.email,
            password: req.body.password,
            cartData: cart,
        });
        
        await user.save();
        
        const data = {
            user: {
                id: user.id
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
        let user = await Users.findOne({ email: req.body.email });
        if (user) {
            const passCompare = req.body.password === user.password;
            if (passCompare) {
                const data = {
                    user: {
                        id: user.id
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
        let products = await Product.find({});
        let newcollection = products.slice(1).slice(-8);
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
        let products = await Product.find({ category: "women" });
        let popular_in_women = products.slice(0, 4);
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
        let userData = await Users.findOne({ _id: req.user.id });
        userData.cartData[req.body.itemId] += 1;
        await Users.findOneAndUpdate({ _id: req.user.id }, { cartData: userData.cartData });
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
        let userData = await Users.findOne({ _id: req.user.id });
        if (userData.cartData[req.body.itemId] > 0)
            userData.cartData[req.body.itemId] -= 1;
        await Users.findOneAndUpdate({ _id: req.user.id }, { cartData: userData.cartData });
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
        let userData = await Users.findOne({ _id: req.user.id });
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
