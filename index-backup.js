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

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI || "mongodb+srv://ecommercedev:estmarche0212@cluster0.wj9jly9.mongodb.net/e-commerce")

// Stem root API creation
app.get("/", (req, res) => {
    res.send("Express app is running");
})

// Image storage engine
const storage = multer.diskStorage({
    destination: "upload/images",
    filename: (req, file, cb) => {
        cb(null, `${file.fieldname}_${Date.now()}${path.extname(file.originalname)}`);
    }
})
const upload = multer({ storage: storage });

// API for uploading images
app.use("/images", express.static("upload/images"));
app.post("/upload", upload.single("product"), (req, res) => {
    res.json({
        success: true,
        imageUrl: `${process.env.BASE_URL || `http://localhost:${port}`}/images/${req.file.filename}`
    });
})

// Schema for creating products
const Product = mongoose.model("Product", {
    id:{
        type: Number,
        required: true
    },
    name:{
        type: String,
        required: true
    },
    image:{
        type: String,
        required: true
    },
    category:{
        type: String,
        required: true
    },
    new_price:{
        type: Number,
        required: true
    },
    old_price:{
        type: Number,
        required: true
    },
    description:{
        type: String,
        default: ""
    },
    date:{
        type: Date,
        default: Date.now
    },
    available:{
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
})

// API for adding products
app.post("/addproduct", async (req, res)=> {
    let products = await Product.find({});
    let id;
    if (products.length > 0)
    {
        let last_product_array = products.slice(-1);
        let last_product = last_product_array[0];
        id = last_product.id + 1;
    }
    else {
        id = 1;
    }
    
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
    console.log(product);
    await product.save();
    console.log("Product added successfully");
    res.json({
        success: true,
        name: req.body.name,
    });
})

// API for deleting products
app.post("/removeproduct", async (req, res) => {
    await Product.findOneAndDelete({ id: req.body.id });
    console.log("Product removed successfully");
    res.json({
        success: true,
        name: req.body.name,
    });    
})

// API for getting all products
app.get("/allproduct", async (req, res) => {
    let products = await Product.find({});
    console.log("Products fetched successfully");
    console.log("產品數據範例:", products.length > 0 ? products[0] : "無產品");
    res.send(products);
})

// Schema for user model creating
const Users = mongoose.model("Users", {
    name:{
        type: String,
    },
    email:{
        type: String,
        unique: true
    },
    password:{
        type: String,
    },
    cartData:{
        type: Object,
    },
    date:{
        type: Date,
        default: Date.now,
    }
})

// API for user registration
app.post('/signup', async (req, res) => {
    
    let check = await Users.findOne({ email: req.body.email });
    if (check) {
        return res.status(400).json({success: false, errors: "User already exists"});
    }
    let cart = {};
    for (let i = 0; i < 300; i++) {
        cart[i] = 0;
    }
    const user = new Users({
        name: req.body.name,
        email: req.body.email,
        password: req.body.password,
        cartData: cart
    })

    await user.save();

    const data = {
        user: {
            id: user.id
        }
    }

    const token = jwt.sign(data, 'secret_ecom');
    res.json({success: true, token})
})

// API for user login
app.post('/login', async (req, res) => {
    let user = await Users.findOne({ email: req.body.email});
    if (user) {
        const passCompare = req.body.password === user.password;
        if (passCompare) {
            const data = {
                user: {
                    id: user.id
                }
            }
            const token = jwt.sign(data, 'secret_ecom');
            res.json({success: true, token});
        }
        else {
            res.json({success: false, errors: "Wrong Password"});
        }
    }
    else {
        res.json({success: false, errors: "Wrong Email ID"});      
    }
})

// API for getting new collection data
app.get('/newcollection', async (req, res) => {
    let products = await Product.find({});
    let newCollection = products.slice(1).slice(-8);
    console.log("New collection fetched successfully");
    res.send(newCollection);
})

// API for getting popular women section data
app.get('/popularinwomen', async (req, res) => {
    let products = await Product.find({category: 'women'});
    let popularinWomen = products.slice(0,4);
    console.log("Popular in women fetched successfully");
    res.send(popularinWomen);
})

// Middleware for fetching user token
    const fetchUser = async (req, res, next) => {
        const token = req.header('auth-token');
        if (!token) {
            return res.status(401).send({ errors: "Please authenticate using a valid token" });
        }
        else{
            try {
                const data = jwt.verify(token, 'secret_ecom');
                req.user = data.user;
                next();
            } catch (error) {
                return res.status(401).send({ errors: "Please authenticate using a valid token" });
            }
        }
    }

// API for saving cart data
app.post('/addtocart', fetchUser, async (req, res) => {
    console.log("added", req.body.itmeId);
    let userData = await Users.findOne({ _id: req.user.id });
    userData.cartData[req.body.itmeId] += 1;
    await Users.findOneAndUpdate({ _id: req.user.id }, { cartData: userData.cartData });
    res.send("Added to cart successfully");
})

// API for removing cart data
app.post('/removefromcart', fetchUser, async (req, res) => {
    console.log("removed", req.body.itmeId);
    let userData = await Users.findOne({ _id: req.user.id });
    if (userData.cartData[req.body.itmeId] > 0) 
    userData.cartData[req.body.itmeId] -= 1;
    await Users.findOneAndUpdate({ _id: req.user.id }, { cartData: userData.cartData });
    res.send("Removed to cart successfully");
})

// API for getting cart data
app.post('/getcart', fetchUser, async (req, res) => {
    console.log("getCart");
    let userData = await Users.findOne({ _id: req.user.id });
    res.json(userData.cartData);
})

app.listen(port, (error) => {
    if (!error){
        console.log("Server is running on port " + port);
    }
    else {
        console.log("Error occurred: " + error);
    }
})