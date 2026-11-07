
require("dotenv").config();

const TelegramBot = require("node-telegram-bot-api");
const express = require("express");
const session = require("express-session");
const multer = require("multer");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { db } = require("./firebase");

const app = express();

const {
    BOT_TOKEN,
    ADMIN_ID,
    ADMIN_PASSWORD,
    SESSION_SECRET,
    WEB_APP_URL,
    PORT = 3000
} = process.env;

if (
    !BOT_TOKEN ||
    !ADMIN_ID ||
    !ADMIN_PASSWORD ||
    !SESSION_SECRET ||
    !WEB_APP_URL
) {
    throw new Error(".env faylidagi sozlamalarni tekshiring!");
}

if (!db) {
    throw new Error("Firebase Firestore ulanmagan!");
}

// ==========================================
// BOT
// ==========================================

const bot = new TelegramBot(BOT_TOKEN, {
    polling: true
});

// ==========================================
// PAPKALAR
// ==========================================

const ROOT = __dirname;
const WEB = path.join(ROOT, "webapp");
const UPLOADS = path.join(ROOT, "uploads");

fs.mkdirSync(UPLOADS, { recursive: true });

// ==========================================
// FIRESTORE COLLECTIONS
// ==========================================

const productsCollection = db.collection("products");
const ordersCollection = db.collection("orders");
const warehouseCollection = db.collection("warehouse");
const countersCollection = db.collection("system");

// ==========================================
// YORDAMCHI FUNKSIYALAR
// ==========================================

function money(value) {
    return Number(value).toLocaleString("uz-UZ") + " so'm";
}

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[char]);
}

function safeEqual(a, b) {
    const x = Buffer.from(String(a));
    const y = Buffer.from(String(b));

    return x.length === y.length &&
        crypto.timingSafeEqual(x, y);
}

function createId() {
    return crypto.randomUUID();
}

function validInteger(value, min = 0, max = 1000000000) {
    const number = Number(value);

    return Number.isSafeInteger(number) &&
        number >= min &&
        number <= max;
}

function deleteUploadedImage(image) {
    if (!image || !image.startsWith("/uploads/")) {
        return;
    }

    const filename = path.basename(image);
    const file = path.join(UPLOADS, filename);

    if (fs.existsSync(file)) {
        fs.unlinkSync(file);
    }
}

// ==========================================
// FIRESTORE MA'LUMOTLARINI OLISH
// ==========================================

async function getProducts() {
    const snapshot = await productsCollection.get();

    return snapshot.docs.map(doc => ({
        ...doc.data(),
        id: Number(doc.data().id)
    }));
}

async function getOrders() {
    const snapshot = await ordersCollection.get();

    return snapshot.docs
        .map(doc => doc.data())
        .sort((a, b) =>
            String(b.createdAt).localeCompare(String(a.createdAt))
        );
}

async function getWarehouseHistory() {
    const snapshot = await warehouseCollection.get();

    return snapshot.docs
        .map(doc => doc.data())
        .sort((a, b) =>
            String(b.createdAt).localeCompare(String(a.createdAt))
        );
}

// ==========================================
// MAHSULOT ID RAQAMINI YARATISH
// ==========================================

async function generateProductId() {
    const counterRef = countersCollection.doc("counters");

    return db.runTransaction(async transaction => {
        const snapshot = await transaction.get(counterRef);

        const nextId = snapshot.exists
            ? Number(snapshot.data().productId || 0) + 1
            : 1;

        transaction.set(
            counterRef,
            { productId: nextId },
            { merge: true }
        );

        return nextId;
    });
}

// ==========================================
// OMBOR TARIXIGA YOZISH
// ==========================================

function createWarehouseMovement({
    product,
    type,
    quantity,
    before,
    after,
    note = "",
    source = "manual",
    orderId = null
}) {
    return {
        id: createId(),
        productId: product.id,
        productName: product.name,
        type,
        quantity,
        before,
        after,
        note: String(note).slice(0, 300),
        source,
        orderId,
        createdAt: new Date().toISOString()
    };
}

// ==========================================
// TELEGRAM WEB APP TEKSHIRUVI
// ==========================================

function verifyTelegram(initData) {
    if (!initData) return null;

    try {
        const params = new URLSearchParams(initData);
        const hash = params.get("hash");

        if (!hash) return null;

        params.delete("hash");

        const dataCheckString = [...params.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, value]) => `${key}=${value}`)
            .join("\n");

        const secretKey = crypto
            .createHmac("sha256", "WebAppData")
            .update(BOT_TOKEN)
            .digest();

        const calculatedHash = crypto
            .createHmac("sha256", secretKey)
            .update(dataCheckString)
            .digest("hex");

        if (!safeEqual(hash, calculatedHash)) {
            return null;
        }

        const authDate = Number(params.get("auth_date"));
        const now = Math.floor(Date.now() / 1000);

        if (
            !authDate ||
            now - authDate > 86400 ||
            authDate > now + 60
        ) {
            return null;
        }

        const user = JSON.parse(params.get("user") || "{}");

        return user.id ? user : null;

    } catch {
        return null;
    }
}

// ==========================================
// EXPRESS
// ==========================================

app.set("trust proxy", 1);

app.use(express.json({
    limit: "100kb"
}));

app.use(express.urlencoded({
    extended: true,
    limit: "100kb"
}));

app.use(session({
    name: "ekran_admin",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,

    cookie: {
        httpOnly: true,
        secure: "auto",
        sameSite: "strict",
        maxAge: 1000 * 60 * 60 * 8
    }
}));

app.use("/uploads", express.static(UPLOADS));
app.use(express.static(WEB));

// ==========================================
// RASM YUKLASH
// ==========================================

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOADS);
    },

    filename: (req, file, cb) => {
        const ext = {
            "image/jpeg": ".jpg",
            "image/png": ".png",
            "image/webp": ".webp"
        }[file.mimetype];

        cb(null, createId() + ext);
    }
});

const upload = multer({
    storage,

    limits: {
        fileSize: 5 * 1024 * 1024,
        files: 1
    },

    fileFilter: (req, file, cb) => {
        const allowed = [
            "image/jpeg",
            "image/png",
            "image/webp"
        ];

        if (!allowed.includes(file.mimetype)) {
            return cb(
                new Error("Faqat JPG, PNG yoki WEBP rasm yuklang!")
            );
        }

        cb(null, true);
    }
});

// ==========================================
// ADMIN HIMOYASI
// ==========================================

function adminOnly(req, res, next) {
    if (req.session?.isAdmin === true) {
        return next();
    }

    return res.status(401).json({
        success: false,
        message: "Admin tizimiga kiring."
    });
}

// ==========================================
// ADMIN LOGIN
// ==========================================

app.post("/api/admin/login", (req, res) => {
    const password = req.body?.password;

    if (
        typeof password !== "string" ||
        !safeEqual(password, ADMIN_PASSWORD)
    ) {
        return res.status(401).json({
            success: false,
            message: "Parol noto'g'ri!"
        });
    }

    req.session.regenerate(error => {
        if (error) {
            console.error("SESSION ERROR:", error);

            return res.status(500).json({
                success: false,
                message: "Sessiya yaratilmadi."
            });
        }

        req.session.isAdmin = true;

        req.session.save(error => {
            if (error) {
                console.error("SESSION SAVE ERROR:", error);

                return res.status(500).json({
                    success: false,
                    message: "Sessiya saqlanmadi."
                });
            }

            res.json({
                success: true,
                message: "Xush kelibsiz!"
            });
        });
    });
});

app.get("/api/admin/me", (req, res) => {
    res.json({
        isAdmin: req.session?.isAdmin === true
    });
});

app.post("/api/admin/logout", adminOnly, (req, res) => {
    req.session.destroy(() => {
        res.clearCookie("ekran_admin");

        res.json({
            success: true
        });
    });
});

// ==========================================
// OCHIQ MAHSULOTLAR API
// ==========================================

app.get("/api/products", async (req, res) => {
    try {
        const products = await getProducts();

        res.json(products.map(product => ({
            ...product,
            stock: Number(product.stock) || 0
        })));

    } catch (error) {
        console.error("PUBLIC PRODUCTS ERROR:", error);

        res.status(500).json({
            success: false,
            message: "Mahsulotlarni yuklashda xatolik."
        });
    }
});

// ==========================================
// ADMIN MAHSULOTLARI
// ==========================================

app.get("/api/admin/products", adminOnly, async (req, res) => {
    try {
        res.json(await getProducts());

    } catch (error) {
        console.error("ADMIN PRODUCTS ERROR:", error);

        res.status(500).json({
            success: false,
            message: "Mahsulotlarni yuklashda xatolik."
        });
    }
});

// ==========================================
// MAHSULOT QO'SHISH
// ==========================================
// ==========================================
// MAHSULOT QO'SHISH
// ==========================================

app.post(
    "/api/admin/products",
    adminOnly,
    upload.single("image"),
    async (req, res) => {
        try {
            const {
                name,
                brand,
                model,
                price,
                oldPrice,
                stock,
                description
            } = req.body;

            const valid =
                typeof name === "string" &&
                name.trim().length >= 2 &&
                name.length <= 100 &&
                typeof brand === "string" &&
                brand.trim().length >= 2 &&
                typeof model === "string" &&
                model.trim().length >= 2 &&
                /^\d{1,12}$/.test(String(price)) &&
                /^\d{1,12}$/.test(String(stock)) &&
                /^\d{1,12}$/.test(String(oldPrice || 0));

            if (!valid) {
                return res.status(400).json({
                    success: false,
                    message: "Mahsulot ma'lumotlarini tekshiring."
                });
            }

            if (!req.file) {
                return res.status(400).json({
                    success: false,
                    message: "Mahsulot rasmi kerak."
                });
            }

            const priceValue = Number(price);
            const stockValue = Number(stock);
            const oldPriceValue = Number(oldPrice || 0);

            if (
                !Number.isSafeInteger(priceValue) ||
                priceValue <= 0 ||
                !Number.isSafeInteger(stockValue) ||
                stockValue < 0 ||
                !Number.isSafeInteger(oldPriceValue) ||
                oldPriceValue < 0 ||
                (description && description.length > 1000)
            ) {
                return res.status(400).json({
                    success: false,
                    message: "Narx, qoldiq yoki izoh noto'g'ri."
                });
            }

            const id = await generateProductId();

            const product = {
                id,
                name: name.trim(),
                brand: brand.trim(),
                model: model.trim(),
                price: priceValue,
                oldPrice: oldPriceValue,
                stock: stockValue,
                image: "/uploads/" + req.file.filename,
                description: String(description || "").trim()
            };

            const productRef = productsCollection.doc(String(id));
            const movementRef = warehouseCollection.doc(createId());

            await db.runTransaction(async transaction => {
                transaction.create(productRef, product);

                if (stockValue > 0) {
                    const movement = createWarehouseMovement({
                        product,
                        type: "in",
                        quantity: stockValue,
                        before: 0,
                        after: stockValue,
                        note: "Yangi mahsulotning boshlang'ich qoldig'i",
                        source: "initial"
                    });

                    transaction.create(movementRef, movement);
                }
            });

            res.json({
                success: true,
                product
            });

        } catch (error) {
            console.error("PRODUCT ADD ERROR:", error);

            if (req.file && fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path);
            }

            res.status(500).json({
                success: false,
                message: "Mahsulot saqlanmadi."
            });
        }
    }
);

// ==========================================
// MAHSULOTNI TAHRIRLASH
// ==========================================
// ==========================================
// MAHSULOTNI TAHRIRLASH
// ==========================================

app.put(
    "/api/admin/products/:id",
    adminOnly,
    upload.single("image"),
    async (req, res) => {
        try {
            const id = Number(req.params.id);

            if (!Number.isSafeInteger(id) || id < 1) {
                return res.status(400).json({
                    success: false,
                    message: "Mahsulot ID noto'g'ri."
                });
            }

            const productRef = productsCollection.doc(String(id));
            const snapshot = await productRef.get();

            if (!snapshot.exists) {
                return res.status(404).json({
                    success: false,
                    message: "Mahsulot topilmadi."
                });
            }

            const old = snapshot.data();

            const {
                name,
                brand,
                model,
                price,
                oldPrice,
                description
            } = req.body;

            const valid =
                typeof name === "string" &&
                name.trim().length >= 2 &&
                name.length <= 100 &&
                typeof brand === "string" &&
                brand.trim().length >= 2 &&
                typeof model === "string" &&
                model.trim().length >= 2 &&
                /^\d{1,12}$/.test(String(price)) &&
                /^\d{1,12}$/.test(String(oldPrice || 0));

            if (!valid) {
                return res.status(400).json({
                    success: false,
                    message: "Mahsulot ma'lumotlari noto'g'ri."
                });
            }

            const priceValue = Number(price);
            const oldPriceValue = Number(oldPrice || 0);

            if (
                !Number.isSafeInteger(priceValue) ||
                priceValue <= 0 ||
                !Number.isSafeInteger(oldPriceValue) ||
                oldPriceValue < 0 ||
                (description && description.length > 1000)
            ) {
                return res.status(400).json({
                    success: false,
                    message: "Narx yoki izohni tekshiring."
                });
            }

            const updated = {
                ...old,
                name: name.trim(),
                brand: brand.trim(),
                model: model.trim(),
                price: priceValue,
                oldPrice: oldPriceValue,
                stock: Number(old.stock) || 0,
                description: String(description || "").trim()
            };

            // Eski mahsulotlardagi type va category
            // maydonlarini yangilashda olib tashlaymiz.
            delete updated.type;
            delete updated.typeName;
            delete updated.category;

            if (req.file) {
                updated.image = "/uploads/" + req.file.filename;
            }

            await productRef.set(updated);

            if (req.file) {
                deleteUploadedImage(old.image);
            }

            res.json({
                success: true,
                product: updated
            });

        } catch (error) {
            console.error("PRODUCT EDIT ERROR:", error);

            if (req.file && fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path);
            }

            res.status(500).json({
                success: false,
                message: "Tahrirlashda xatolik."
            });
        }
    }
);

// ==========================================
// MAHSULOTNI O'CHIRISH
// ==========================================

app.delete(
    "/api/admin/products/:id",
    adminOnly,
    async (req, res) => {
        try {
            const id = Number(req.params.id);
            const productRef = productsCollection.doc(String(id));

            const snapshot = await productRef.get();

            if (!snapshot.exists) {
                return res.status(404).json({
                    success: false,
                    message: "Mahsulot topilmadi."
                });
            }

            const product = snapshot.data();

            await productRef.delete();

            deleteUploadedImage(product.image);

            res.json({
                success: true
            });

        } catch (error) {
            console.error("PRODUCT DELETE ERROR:", error);

            res.status(500).json({
                success: false,
                message: "Mahsulotni o'chirishda xatolik."
            });
        }
    }
);

// ==========================================
// OMBOR: STATISTIKA VA TARIX
// ==========================================

app.get(
    "/api/admin/warehouse",
    adminOnly,
    async (req, res) => {
        try {
            const products = await getProducts();
            const history = await getWarehouseHistory();

            const incoming = history
                .filter(item => item.type === "in")
                .reduce((sum, item) => sum + Number(item.quantity || 0), 0);

            const outgoing = history
                .filter(item => item.type === "out")
                .reduce((sum, item) => sum + Number(item.quantity || 0), 0);

            const currentStock = products.reduce(
                (sum, product) => sum + (Number(product.stock) || 0),
                0
            );

            res.json({
                success: true,
                stats: {
                    incoming,
                    outgoing,
                    currentStock
                },
                history
            });

        } catch (error) {
            console.error("WAREHOUSE GET ERROR:", error);

            res.status(500).json({
                success: false,
                message: "Ombor ma'lumotlarini yuklashda xatolik."
            });
        }
    }
);

// ==========================================
// OMBOR: KIRIM
// ==========================================

app.post(
    "/api/admin/warehouse/in",
    adminOnly,
    async (req, res) => {
        try {
            const productId = Number(req.body.productId);
            const quantity = Number(req.body.quantity);
            const note = String(req.body.note || "").trim();

            if (
                !Number.isSafeInteger(productId) ||
                !validInteger(quantity, 1, 100000) ||
                note.length > 300
            ) {
                return res.status(400).json({
                    success: false,
                    message: "Kirim ma'lumotlari noto'g'ri."
                });
            }

            const productRef = productsCollection.doc(String(productId));
            const movementRef = warehouseCollection.doc(createId());

            let updatedProduct;

            await db.runTransaction(async transaction => {
                const snapshot = await transaction.get(productRef);

                if (!snapshot.exists) {
                    throw new Error("PRODUCT_NOT_FOUND");
                }

                const product = snapshot.data();
                const before = Number(product.stock) || 0;
                const after = before + quantity;

                if (!Number.isSafeInteger(after)) {
                    throw new Error("STOCK_TOO_LARGE");
                }

                updatedProduct = {
                    ...product,
                    stock: after
                };

                const movement = createWarehouseMovement({
                    product: updatedProduct,
                    type: "in",
                    quantity,
                    before,
                    after,
                    note: note || "Admin tomonidan kirim",
                    source: "manual"
                });

                transaction.update(productRef, {
                    stock: after
                });

                transaction.create(movementRef, movement);
            });

            res.json({
                success: true,
                message: "Kirim muvaffaqiyatli saqlandi.",
                product: updatedProduct
            });

        } catch (error) {
            console.error("WAREHOUSE IN ERROR:", error);

            const notFound = error.message === "PRODUCT_NOT_FOUND";

            res.status(notFound ? 404 : 500).json({
                success: false,
                message: notFound
                    ? "Mahsulot topilmadi."
                    : "Kirimni saqlashda xatolik."
            });
        }
    }
);

// ==========================================
// OMBOR: CHIQIM
// ==========================================

app.post(
    "/api/admin/warehouse/out",
    adminOnly,
    async (req, res) => {
        try {
            const productId = Number(req.body.productId);
            const quantity = Number(req.body.quantity);
            const note = String(req.body.note || "").trim();

            if (
                !Number.isSafeInteger(productId) ||
                !validInteger(quantity, 1, 100000) ||
                note.length > 300
            ) {
                return res.status(400).json({
                    success: false,
                    message: "Chiqim ma'lumotlari noto'g'ri."
                });
            }

            const productRef = productsCollection.doc(String(productId));
            const movementRef = warehouseCollection.doc(createId());

            let updatedProduct;

            await db.runTransaction(async transaction => {
                const snapshot = await transaction.get(productRef);

                if (!snapshot.exists) {
                    throw new Error("PRODUCT_NOT_FOUND");
                }

                const product = snapshot.data();
                const before = Number(product.stock) || 0;

                if (quantity > before) {
                    throw new Error("NOT_ENOUGH_STOCK:" + before);
                }

                const after = before - quantity;

                updatedProduct = {
                    ...product,
                    stock: after
                };

                const movement = createWarehouseMovement({
                    product: updatedProduct,
                    type: "out",
                    quantity,
                    before,
                    after,
                    note: note || "Admin tomonidan chiqim",
                    source: "manual"
                });

                transaction.update(productRef, {
                    stock: after
                });

                transaction.create(movementRef, movement);
            });

            res.json({
                success: true,
                message: "Chiqim muvaffaqiyatli saqlandi.",
                product: updatedProduct
            });

        } catch (error) {
            console.error("WAREHOUSE OUT ERROR:", error);

            if (error.message === "PRODUCT_NOT_FOUND") {
                return res.status(404).json({
                    success: false,
                    message: "Mahsulot topilmadi."
                });
            }

            if (error.message.startsWith("NOT_ENOUGH_STOCK:")) {
                const available = error.message.split(":")[1];

                return res.status(400).json({
                    success: false,
                    message: `Omborda faqat ${available} dona mavjud!`
                });
            }

            res.status(500).json({
                success: false,
                message: "Chiqimni saqlashda xatolik."
            });
        }
    }
);

// ==========================================
// BUYURTMALAR RO'YXATI
// ==========================================

app.get(
    "/api/admin/orders",
    adminOnly,
    async (req, res) => {
        try {
            res.json(await getOrders());

        } catch (error) {
            console.error("ORDERS GET ERROR:", error);

            res.status(500).json({
                success: false,
                message: "Buyurtmalarni yuklashda xatolik."
            });
        }
    }
);

// ==========================================
// BUYURTMA HOLATINI O'ZGARTIRISH
// ==========================================

app.patch(
    "/api/admin/orders/:id",
    adminOnly,
    async (req, res) => {
        try {
            const allowed = [
                "Yangi",
                "Jarayonda",
                "Tayyor",
                "Yetkazildi",
                "Bekor qilindi"
            ];

            const status = req.body.status;

            if (!allowed.includes(status)) {
                return res.status(400).json({
                    success: false,
                    message: "Buyurtma holati noto'g'ri."
                });
            }

            const orderRef = ordersCollection.doc(req.params.id);
            const snapshot = await orderRef.get();

            if (!snapshot.exists) {
                return res.status(404).json({
                    success: false,
                    message: "Buyurtma topilmadi."
                });
            }

            await orderRef.update({ status });

            res.json({
                success: true
            });

        } catch (error) {
            console.error("ORDER STATUS ERROR:", error);

            res.status(500).json({
                success: false,
                message: "Buyurtma holatini o'zgartirib bo'lmadi."
            });
        }
    }
);

// ==========================================
// TELEGRAM BUYURTMA
// ==========================================

app.post("/api/orders", async (req, res) => {
    try {
        const user = verifyTelegram(req.body.initData);

        if (!user) {
            return res.status(401).json({
                success: false,
                message: "Telegram tekshiruvidan o'tmadi."
            });
        }

        const {
            items,
            name,
            phone,
            note
        } = req.body;

        if (
            !Array.isArray(items) ||
            items.length === 0 ||
            items.length > 30 ||
            typeof name !== "string" ||
            name.trim().length < 2 ||
            name.length > 100 ||
            typeof phone !== "string" ||
            (
                phone.trim() !== "" &&
                !/^[+0-9()\-\s]{7,20}$/.test(phone)
            ) ||
            (
                note &&
                (
                    typeof note !== "string" ||
                    note.length > 500
                )
            )
        ) {
            return res.status(400).json({
                success: false,
                message: "Buyurtma ma'lumotlari noto'g'ri."
            });
        }

        const quantities = new Map();

        for (const item of items) {
            const id = Number(item.id);
            const qty = Number(item.qty);

            if (
                !Number.isSafeInteger(id) ||
                !Number.isSafeInteger(qty) ||
                qty < 1 ||
                qty > 20
            ) {
                return res.status(400).json({
                    success: false,
                    message: "Mahsulot miqdori noto'g'ri."
                });
            }

            quantities.set(
                id,
                (quantities.get(id) || 0) + qty
            );
        }

        const orderId = createId().replace(/-/g, "").slice(0, 10).toUpperCase();
        const orderRef = ordersCollection.doc(orderId);
        const productRefs = [...quantities.keys()].map(
            id => productsCollection.doc(String(id))
        );

        const warehouseRefs = [...quantities.keys()].map(
            () => warehouseCollection.doc(createId())
        );

        let order;
        let message;

        // Barcha mahsulotlar, buyurtma va ombor tarixi
        // bitta Firestore transaction ichida saqlanadi.
        await db.runTransaction(async transaction => {
            const snapshots = [];

            // Avval barcha mahsulotlarni o'qiymiz.
            for (const ref of productRefs) {
                snapshots.push(await transaction.get(ref));
            }

            const orderItems = [];
            const movements = [];
            let total = 0;

            for (let index = 0; index < snapshots.length; index++) {
                const snapshot = snapshots[index];
                const id = [...quantities.keys()][index];
                const qty = quantities.get(id);

                if (!snapshot.exists) {
                    throw new Error("PRODUCT_NOT_FOUND");
                }

                const product = snapshot.data();
                const before = Number(product.stock) || 0;

                if (qty > before) {
                    throw new Error(
                        `NOT_ENOUGH_STOCK:${product.name}:${before}`
                    );
                }

                const price = Number(product.price);

                if (!Number.isSafeInteger(price) || price < 0) {
                    throw new Error("INVALID_PRODUCT_PRICE");
                }

                const lineTotal = price * qty;

                if (!Number.isSafeInteger(lineTotal)) {
                    throw new Error("INVALID_ORDER_TOTAL");
                }

                total += lineTotal;

                const after = before - qty;

               orderItems.push({
    id,
    name: product.name,
    brand: product.brand || "",
    model: product.model || "",
    price,
    qty
});

                const updatedProduct = {
                    ...product,
                    stock: after
                };

                movements.push(
                    createWarehouseMovement({
                        product: updatedProduct,
                        type: "out",
                        quantity: qty,
                        before,
                        after,
                        note: `Telegram buyurtmasi #${orderId}`,
                        source: "order",
                        orderId
                    })
                );

                transaction.update(productRefs[index], {
                    stock: after
                });
            }

            if (!Number.isSafeInteger(total)) {
                throw new Error("INVALID_ORDER_TOTAL");
            }

            order = {
                id: orderId,
                userId: user.id,
                customerName: name.trim(),
                phone: phone.trim(),
                note: note || "",
                items: orderItems,
                total,
                status: "Yangi",
                createdAt: new Date().toISOString()
            };

            transaction.create(orderRef, order);

            movements.forEach((movement, index) => {
                transaction.create(warehouseRefs[index], movement);
            });
        });

        // Transaction muvaffaqiyatli tugagach xabar yuboriladi.
        message = `
🛒 <b>YANGI BUYURTMA!</b>

🆔 Buyurtma: #${orderId}
👤 Ism: ${escapeHTML(name.trim())}
📞 Telefon: ${escapeHTML(phone)}
👤 Telegram: ${escapeHTML(user.first_name || "")}
🆔 Telegram ID: <code>${user.id}</code>

━━━━━━━━━━━━━━
`;

        for (const item of order.items) {
            message += `
📱 ${escapeHTML(item.name)}
Brend: ${escapeHTML(item.brand)}
Model: ${escapeHTML(item.model)}
Soni: ${item.qty} dona
Narxi: ${money(item.price * item.qty)}
`;
        }

        message += `
━━━━━━━━━━━━━━
💰 <b>JAMI: ${money(order.total)}</b>
📝 Izoh: ${escapeHTML(note || "Yo'q")}
`;

        // Admin xabari yuborilmasa ham buyurtma bazada saqlanadi.
        await bot.sendMessage(ADMIN_ID, message, {
            parse_mode: "HTML"
        }).catch(error => {
            console.error("ADMIN NOTIFICATION ERROR:", error.message);
        });

        await bot.sendMessage(
            user.id,
            `✅ Buyurtmangiz qabul qilindi!\n🆔 #${orderId}\n💰 ${money(order.total)}`
        ).catch(() => {});

        res.json({
            success: true,
            orderId,
            total: order.total
        });

    } catch (error) {
        console.error("BUYURTMA XATOSI:", error);

        if (error.message === "PRODUCT_NOT_FOUND") {
            return res.status(404).json({
                success: false,
                message: "Mahsulot topilmadi."
            });
        }

        if (error.message.startsWith("NOT_ENOUGH_STOCK:")) {
            const parts = error.message.split(":");

            return res.status(400).json({
                success: false,
                message: `${parts[1]} mahsulotidan faqat ${parts[2]} dona mavjud.`
            });
        }

        res.status(500).json({
            success: false,
            message: "Buyurtmani yuborishda xatolik."
        });
    }
});

// ==========================================
// UPLOAD VA SERVER XATOLARI
// ==========================================

app.use((error, req, res, next) => {
    if (
        error instanceof multer.MulterError ||
        error.message?.includes("rasm")
    ) {
        return res.status(400).json({
            success: false,
            message: error.message
        });
    }

    console.error("SERVER ERROR:", error);

    res.status(500).json({
        success: false,
        message: "Server xatosi."
    });
});

// ==========================================
// TELEGRAM BOT
// ==========================================

bot.onText(/\/start/, msg => {
    const isAdmin =
        String(msg.from.id) === String(ADMIN_ID);

    const keyboard = [
        [{
            text: "🛍 Do'konni ochish",
            web_app: {
                url: WEB_APP_URL
            }
        }],
        [{
            text: "📞 Admin bilan bog'lanish"
        }]
    ];

    if (isAdmin) {
        keyboard.unshift([{
            text: "🔐 Admin boshqaruv",
            web_app: {
                url: "https://ekranshop.onrender.com/admin.html"
            }
        }]);
    }

    bot.sendMessage(
        msg.chat.id,
        `Assalomu alaykum, ${msg.from.first_name}!

📱 EKRAN SHOP do'koniga xush kelibsiz!

Original va kopiya displeylarni tanlang va buyurtma bering.`,
        {
            reply_markup: {
                keyboard,
                resize_keyboard: true
            }
        }
    );
});

bot.on("message", msg => {
    if (
        msg.text === "📞 Admin bilan bog'lanish" &&
        !msg.text.startsWith("/")
    ) {
        bot.sendMessage(
            msg.chat.id,
            `Admin bilan bog'lanish:

@premium_ekran
@premium_ekran1`
        );
    }
});

// ==========================================
// SERVERNI ISHGA TUSHIRISH
// ==========================================

const server = app.listen(PORT, () => {
    console.log("");
    console.log("======================================");
    console.log("          EKRAN SHOP SERVER");
    console.log("======================================");
    console.log("🟢 BOT: ISHGA TUSHDI");
    console.log("🟢 SERVER: ISHLAMOQDA");
    console.log("🌐 DO'KON: " + WEB_APP_URL);
    console.log(`🔐 ADMIN: http://localhost:${PORT}/admin.html`);
    console.log("🔥 FIRESTORE: ULANDI");
    console.log("======================================");
});

server.on("error", error => {
    console.error("🔴 SERVER XATOSI:", error.message);
});

bot.on("polling_error", error => {
    console.error("🔴 TELEGRAM BOT XATOSI:", error.message);
});
