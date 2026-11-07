
require("dotenv").config();

const TelegramBot = require("node-telegram-bot-api");
const express = require("express");
const session = require("express-session");
const multer = require("multer");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

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
const DATA = path.join(ROOT, "data");
const UPLOADS = path.join(ROOT, "uploads");

const PRODUCTS_FILE = path.join(DATA, "products.json");
const ORDERS_FILE = path.join(DATA, "orders.json");
const WAREHOUSE_FILE = path.join(DATA, "warehouse.json");

fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(UPLOADS, { recursive: true });

// ==========================================
// JSON FUNKSIYALARI
// ==========================================

function readJSON(file, fallback = []) {
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
        return fallback;
    }
}

function writeJSON(file, data) {
    const temp = file + ".tmp";

    fs.writeFileSync(
        temp,
        JSON.stringify(data, null, 2),
        "utf8"
    );

    fs.renameSync(temp, file);
}

// Eski mahsulotlarni ko'chirish
if (!fs.existsSync(PRODUCTS_FILE)) {
    const oldFile = path.join(WEB, "products.json");
    const oldProducts = readJSON(oldFile, []);

    writeJSON(PRODUCTS_FILE, oldProducts);
}

if (!fs.existsSync(ORDERS_FILE)) {
    writeJSON(ORDERS_FILE, []);
}

if (!fs.existsSync(WAREHOUSE_FILE)) {
    writeJSON(WAREHOUSE_FILE, []);
}

// ==========================================
// MA'LUMOTLAR
// ==========================================

function getProducts() {
    return readJSON(PRODUCTS_FILE, []);
}

function saveProducts(products) {
    writeJSON(PRODUCTS_FILE, products);
}

function getOrders() {
    return readJSON(ORDERS_FILE, []);
}

function saveOrders(orders) {
    writeJSON(ORDERS_FILE, orders);
}

function getWarehouseHistory() {
    return readJSON(WAREHOUSE_FILE, []);
}

function saveWarehouseHistory(history) {
    writeJSON(WAREHOUSE_FILE, history);
}

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

// ==========================================
// OMBOR TARIXIGA YOZISH
// ==========================================

function addWarehouseMovement({
    product,
    type,
    quantity,
    before,
    after,
    note = "",
    source = "manual",
    orderId = null
}) {
    const history = getWarehouseHistory();

    history.unshift({
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
    });

    saveWarehouseHistory(history);
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

// Admin holati
app.get("/api/admin/me", (req, res) => {
    res.json({
        isAdmin: req.session?.isAdmin === true
    });
});

// Admin chiqishi
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

app.get("/api/products", (req, res) => {
    const products = getProducts();

    res.json(products.map(product => ({
        ...product,
        stock: Number(product.stock) || 0
    })));
});

// ==========================================
// ADMIN MAHSULOTLARI
// ==========================================

app.get("/api/admin/products", adminOnly, (req, res) => {
    res.json(getProducts());
});

// ==========================================
// MAHSULOT QO'SHISH
// ==========================================

app.post(
    "/api/admin/products",
    adminOnly,
    upload.single("image"),
    (req, res) => {
        try {
            const {
                name,
                brand,
                model,
                type,
                price,
                oldPrice,
                stock,
                category,
                description
            } = req.body;

            if (
                typeof name !== "string" ||
                name.trim().length < 2 ||
                name.length > 100 ||
                typeof brand !== "string" ||
                brand.trim().length < 2 ||
                typeof model !== "string" ||
                model.trim().length < 2 ||
                !["original", "copy"].includes(type) ||
                !["iphone", "samsung", "xiaomi"].includes(category) ||
                !/^\d{1,12}$/.test(String(price)) ||
                !/^\d{1,12}$/.test(String(stock)) ||
                !/^\d{1,12}$/.test(String(oldPrice || 0))
            ) {
                if (req.file) fs.unlinkSync(req.file.path);

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
                priceValue <= 0 ||
                !Number.isSafeInteger(priceValue) ||
                !Number.isSafeInteger(stockValue) ||
                stockValue < 0 ||
                !Number.isSafeInteger(oldPriceValue)
            ) {
                fs.unlinkSync(req.file.path);

                return res.status(400).json({
                    success: false,
                    message: "Narx yoki mahsulot soni noto'g'ri."
                });
            }

            if (
                description &&
                description.length > 1000
            ) {
                fs.unlinkSync(req.file.path);

                return res.status(400).json({
                    success: false,
                    message: "Izoh juda uzun."
                });
            }

            const products = getProducts();

            const id = products.length
                ? Math.max(
                    ...products.map(p => Number(p.id) || 0)
                ) + 1
                : 1;

            const product = {
                id,
                name: name.trim(),
                brand: brand.trim(),
                model: model.trim(),
                type,
                typeName: type === "original"
                    ? "Original"
                    : "Kopiya",
                price: priceValue,
                oldPrice: oldPriceValue,
                stock: stockValue,
                category,
                image: "/uploads/" + req.file.filename,
                description: String(description || "").trim()
            };

            products.push(product);
            saveProducts(products);

            // Boshlang'ich qoldiqni kirim sifatida yozish
            if (stockValue > 0) {
                addWarehouseMovement({
                    product,
                    type: "in",
                    quantity: stockValue,
                    before: 0,
                    after: stockValue,
                    note: "Yangi mahsulotning boshlang'ich qoldig'i",
                    source: "initial"
                });
            }

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

app.put(
    "/api/admin/products/:id",
    adminOnly,
    upload.single("image"),
    (req, res) => {
        try {
            const products = getProducts();
            const id = Number(req.params.id);

            const index = products.findIndex(
                p => Number(p.id) === id
            );

            if (index === -1) {
                if (req.file) fs.unlinkSync(req.file.path);

                return res.status(404).json({
                    success: false,
                    message: "Mahsulot topilmadi."
                });
            }

            const old = products[index];

            const {
                name,
                brand,
                model,
                type,
                price,
                oldPrice,
                category,
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
                ["original", "copy"].includes(type) &&
                ["iphone", "samsung", "xiaomi"].includes(category) &&
                /^\d{1,12}$/.test(String(price)) &&
                /^\d{1,12}$/.test(String(oldPrice || 0));

            if (!valid) {
                if (req.file) fs.unlinkSync(req.file.path);

                return res.status(400).json({
                    success: false,
                    message: "Ma'lumotlar noto'g'ri."
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
                if (req.file) fs.unlinkSync(req.file.path);

                return res.status(400).json({
                    success: false,
                    message: "Narx yoki izohni tekshiring."
                });
            }

            products[index] = {
                ...old,
                name: name.trim(),
                brand: brand.trim(),
                model: model.trim(),
                type,
                typeName: type === "original"
                    ? "Original"
                    : "Kopiya",
                price: priceValue,
                oldPrice: oldPriceValue,

                // Qoldiq faqat ombor orqali o'zgaradi
                stock: Number(old.stock) || 0,

                category,
                description: String(description || "").trim()
            };

            if (req.file) {
                products[index].image =
                    "/uploads/" + req.file.filename;

                deleteUploadedImage(old.image);
            }

            saveProducts(products);

            res.json({
                success: true,
                product: products[index]
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
// RASMNI O'CHIRISH
// ==========================================

function deleteUploadedImage(image) {
    if (
        !image ||
        !image.startsWith("/uploads/")
    ) {
        return;
    }

    const filename = path.basename(image);
    const file = path.join(UPLOADS, filename);

    if (fs.existsSync(file)) {
        fs.unlinkSync(file);
    }
}

// ==========================================
// MAHSULOTNI O'CHIRISH
// ==========================================

app.delete(
    "/api/admin/products/:id",
    adminOnly,
    (req, res) => {
        const products = getProducts();
        const id = Number(req.params.id);

        const product = products.find(
            p => Number(p.id) === id
        );

        if (!product) {
            return res.status(404).json({
                success: false,
                message: "Mahsulot topilmadi."
            });
        }

        const updated = products.filter(
            p => Number(p.id) !== id
        );

        saveProducts(updated);
        deleteUploadedImage(product.image);

        res.json({
            success: true
        });
    }
);

// ==========================================
// OMBOR: STATISTIKA VA TARIX
// ==========================================

app.get(
    "/api/admin/warehouse",
    adminOnly,
    (req, res) => {
        const products = getProducts();
        const history = getWarehouseHistory();

        const incoming = history
            .filter(item => item.type === "in")
            .reduce(
                (sum, item) => sum + Number(item.quantity || 0),
                0
            );

        const outgoing = history
            .filter(item => item.type === "out")
            .reduce(
                (sum, item) => sum + Number(item.quantity || 0),
                0
            );

        const currentStock = products.reduce(
            (sum, product) =>
                sum + (Number(product.stock) || 0),
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
    }
);

// ==========================================
// OMBOR: KIRIM
// ==========================================

app.post(
    "/api/admin/warehouse/in",
    adminOnly,
    (req, res) => {
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

            const products = getProducts();

            const product = products.find(
                p => Number(p.id) === productId
            );

            if (!product) {
                return res.status(404).json({
                    success: false,
                    message: "Mahsulot topilmadi."
                });
            }

            const before = Number(product.stock) || 0;
            const after = before + quantity;

            if (!Number.isSafeInteger(after)) {
                return res.status(400).json({
                    success: false,
                    message: "Qoldiq qiymati juda katta."
                });
            }

            product.stock = after;

            saveProducts(products);

            addWarehouseMovement({
                product,
                type: "in",
                quantity,
                before,
                after,
                note: note || "Admin tomonidan kirim",
                source: "manual"
            });

            res.json({
                success: true,
                message: "Kirim muvaffaqiyatli saqlandi.",
                product
            });

        } catch (error) {
            console.error("WAREHOUSE IN ERROR:", error);

            res.status(500).json({
                success: false,
                message: "Kirimni saqlashda xatolik."
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
    (req, res) => {
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

            const products = getProducts();

            const product = products.find(
                p => Number(p.id) === productId
            );

            if (!product) {
                return res.status(404).json({
                    success: false,
                    message: "Mahsulot topilmadi."
                });
            }

            const before = Number(product.stock) || 0;

            if (quantity > before) {
                return res.status(400).json({
                    success: false,
                    message: `Omborda faqat ${before} dona mavjud!`
                });
            }

            const after = before - quantity;

            product.stock = after;

            saveProducts(products);

            addWarehouseMovement({
                product,
                type: "out",
                quantity,
                before,
                after,
                note: note || "Admin tomonidan chiqim",
                source: "manual"
            });

            res.json({
                success: true,
                message: "Chiqim muvaffaqiyatli saqlandi.",
                product
            });

        } catch (error) {
            console.error("WAREHOUSE OUT ERROR:", error);

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
    (req, res) => {
        res.json(getOrders());
    }
);

// ==========================================
// BUYURTMA HOLATINI O'ZGARTIRISH
// ==========================================

app.patch(
    "/api/admin/orders/:id",
    adminOnly,
    (req, res) => {
        const allowed = [
            "Yangi",
            "Jarayonda",
            "Tayyor",
            "Yetkazildi",
            "Bekor qilindi"
        ];

        const orders = getOrders();

        const order = orders.find(
            o => o.id === req.params.id
        );

        if (
            !order ||
            !allowed.includes(req.body.status)
        ) {
            return res.status(400).json({
                success: false,
                message: "Buyurtma yoki holat noto'g'ri."
            });
        }

        order.status = req.body.status;

        saveOrders(orders);

        res.json({
            success: true
        });
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

        const products = getProducts();
        const orderItems = [];
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

        let total = 0;

        for (const [id, qty] of quantities) {
            const product = products.find(
                p => Number(p.id) === id
            );

            if (
                !product ||
                qty > (Number(product.stock) || 0)
            ) {
                return res.status(400).json({
                    success: false,
                    message: "Mahsulot qoldig'i yetarli emas."
                });
            }

            orderItems.push({
                id,
                name: product.name,
                type: product.typeName,
                price: product.price,
                qty
            });

            total += product.price * qty;
        }

        const orderId = Date.now()
            .toString()
            .slice(-8);

        const order = {
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

        let message = `
🛒 <b>YANGI BUYURTMA!</b>

🆔 Buyurtma: #${orderId}
👤 Ism: ${escapeHTML(name.trim())}
📞 Telefon: ${escapeHTML(phone)}
👤 Telegram: ${escapeHTML(user.first_name || "")}
🆔 Telegram ID: <code>${user.id}</code>

━━━━━━━━━━━━━━
`;

        for (const item of orderItems) {
            message += `
📱 ${escapeHTML(item.name)}
Turi: ${escapeHTML(item.type)}
Soni: ${item.qty} dona
Narxi: ${money(item.price * item.qty)}
`;
        }

        message += `
━━━━━━━━━━━━━━
💰 <b>JAMI: ${money(total)}</b>
📝 Izoh: ${escapeHTML(note || "Yo'q")}
`;

        // Admin xabari yuboriladi
        await bot.sendMessage(ADMIN_ID, message, {
            parse_mode: "HTML"
        });

        // Ombor qoldig'ini kamaytirish
        for (const [id, qty] of quantities) {
            const product = products.find(
                p => Number(p.id) === id
            );

            const before = Number(product.stock) || 0;
            const after = before - qty;

            product.stock = after;

            // Buyurtma chiqimini tarixga yozish
            addWarehouseMovement({
                product,
                type: "out",
                quantity: qty,
                before,
                after,
                note: `Telegram buyurtmasi #${orderId}`,
                source: "order",
                orderId
            });
        }

        saveProducts(products);

        const orders = getOrders();

        orders.unshift(order);

        saveOrders(orders);

        // Mijozga xabar
        await bot.sendMessage(
            user.id,
            `✅ Buyurtmangiz qabul qilindi!\n🆔 #${orderId}\n💰 ${money(total)}`
        ).catch(() => {});

        res.json({
            success: true,
            orderId,
            total
        });

    } catch (error) {
        console.error("BUYURTMA XATOSI:", error);

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

// Admin bilan bog'lanish
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
    console.clear();

    console.log("");
    console.log("======================================");
    console.log("          EKRAN SHOP SERVER");
    console.log("======================================");

    console.log("");
    console.log("🟢 BOT: ISHGA TUSHDI");
    console.log("🟢 SERVER: ISHLAMOQDA");

    console.log("");
    console.log("🌐 DO'KON:");
    console.log(`http://localhost:${PORT}`);

    console.log("");
    console.log("🔐 ADMIN PANEL:");
    console.log(`http://localhost:${PORT}/admin.html`);

    console.log("");
    console.log("📦 MAHSULOTLAR:");
    console.log(PRODUCTS_FILE);

    console.log("");
    console.log("📋 BUYURTMALAR:");
    console.log(ORDERS_FILE);

    console.log("");
    console.log("🏬 OMBOR TARIXI:");
    console.log(WAREHOUSE_FILE);

    console.log("");
    console.log("🖼 RASMLAR:");
    console.log(UPLOADS);

    console.log("");
    console.log("======================================");
    console.log("         EKRAN SHOP TAYYOR!");
    console.log("======================================");
    console.log("");
});

server.on("error", error => {
    console.error("🔴 SERVER XATOSI:", error.message);
});

bot.on("polling_error", error => {
    console.error("🔴 TELEGRAM BOT XATOSI:", error.message);
});
