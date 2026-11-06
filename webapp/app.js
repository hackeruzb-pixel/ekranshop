
const tg = window.Telegram?.WebApp || null;

// ===============================
// TELEGRAM SOZLAMALARI
// ===============================

if (tg) {
    tg.ready();
    tg.expand();

    try {
        if (tg.isVersionAtLeast("6.1")) {
            tg.setHeaderColor("#ffffff");
            tg.setBackgroundColor("#f6f8fc");
        }
    } catch (error) {
        console.warn("Telegram sozlamasi:", error);
    }
}

// ===============================
// SOZLAMALAR
// ===============================

const ADMIN_USERNAME = "@code4jannah";
const API_URL = "";

let products = [];
let cart = [];

let selectedCategory = "all";
let selectedType = "all";
let searchQuery = "";

let isOrdering = false;
let isAdmin = false;
let adminCheckComplete = false;

const $ = id => document.getElementById(id);

// ===============================
// ADMIN TEKSHIRISH
// ===============================

async function checkAdminAccess() {
    try {
        const response = await fetch(
            `${API_URL}/api/admin/me`,
            {
                credentials: "same-origin",
                cache: "no-store"
            }
        );

        const data = await response.json();

        isAdmin = response.ok && data.isAdmin === true;

    } catch (error) {
        console.error("Admin tekshirish xatosi:", error);
        isAdmin = false;
    }

    adminCheckComplete = true;

    document.body.classList.toggle("is-admin", isAdmin);

    // Oddiy foydalanuvchida savatcha bo'lmaydi
    if (!isAdmin) {
        cart = [];
    }

    updateCart();
}

// ===============================
// PUL FORMATI
// ===============================

function money(value) {
    return Number(value || 0).toLocaleString("uz-UZ") + " so‘m";
}

// ===============================
// HTML XAVFSIZLIGI
// ===============================

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[char]);
}

// ===============================
// ID TAQQOSLASH
// ===============================

function sameId(a, b) {
    return String(a) === String(b);
}

// ===============================
// XABAR CHIQARISH
// ===============================

function notify(message, type = "info") {
    let toast = $("shopToast");

    if (!toast) {
        toast = document.createElement("div");
        toast.id = "shopToast";

        Object.assign(toast.style, {
            position: "fixed",
            left: "50%",
            bottom: "105px",
            transform: "translate(-50%, 20px)",
            padding: "14px 22px",
            borderRadius: "14px",
            background: "#202020",
            color: "#ffffff",
            fontSize: "14px",
            fontWeight: "600",
            zIndex: "999999",
            opacity: "0",
            transition: "all .3s ease",
            textAlign: "center",
            maxWidth: "85%",
            boxShadow: "0 8px 30px rgba(0,0,0,.3)"
        });

        document.body.appendChild(toast);
    }

    const icons = {
        success: "✓ ",
        error: "✕ ",
        info: "● "
    };

    toast.textContent = (icons[type] || "") + message;

    toast.style.background =
        type === "success" ? "#087f5b" :
        type === "error" ? "#b42318" :
        "#202020";

    toast.style.opacity = "1";
    toast.style.transform = "translate(-50%, 0)";

    clearTimeout(toast.hideTimer);

    toast.hideTimer = setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translate(-50%, 20px)";
    }, 3000);
}

// ===============================
// TELEGRAM VIBRATION
// ===============================

function haptic(type = "light") {
    try {
        tg?.HapticFeedback?.impactOccurred(type);
    } catch (error) {
        console.warn(error);
    }
}

function successHaptic() {
    try {
        tg?.HapticFeedback?.notificationOccurred("success");
    } catch (error) {
        console.warn(error);
    }
}

// ===============================
// MAHSULOTLARNI YUKLASH
// ===============================

async function loadProducts() {
    const container = $("products");

    try {
        if (container) {
            container.innerHTML =
                '<div class="empty">Mahsulotlar yuklanmoqda...</div>';
        }

        const response = await fetch(
            `${API_URL}/api/products`,
            {
                method: "GET",
                cache: "no-store"
            }
        );

        if (!response.ok) {
            throw new Error("Mahsulotlarni yuklab bo‘lmadi");
        }

        const data = await response.json();

        if (!Array.isArray(data)) {
            throw new Error("Serverdan noto‘g‘ri ma'lumot keldi");
        }

        products = data.map(product => ({
            ...product,
            price: Number(product.price || 0),
            oldPrice: Number(product.oldPrice || 0),
            stock: Number(product.stock || 0)
        }));

        if (isAdmin) {
            cart = cart.filter(item => {
                const product = products.find(p =>
                    sameId(p.id, item.id)
                );

                return product && product.stock > 0;
            });

            cart.forEach(item => {
                const product = products.find(p =>
                    sameId(p.id, item.id)
                );

                if (product && item.qty > product.stock) {
                    item.qty = product.stock;
                }
            });

            cart = cart.filter(item => item.qty > 0);
        }

        renderProducts();
        updateCart();

    } catch (error) {
        console.error("Mahsulot yuklash xatosi:", error);

        if (container) {
            container.innerHTML =
                '<div class="empty">Mahsulotlarni yuklashda xatolik. Sahifani yangilang.</div>';
        }
    }
}

// ===============================
// MAHSULOTLARNI CHIQARISH
// ===============================

function renderProducts() {
    const container = $("products");

    if (!container) return;

    const filtered = products.filter(product => {
        const categoryMatch =
            selectedCategory === "all" ||
            product.category === selectedCategory;

        const typeMatch =
            selectedType === "all" ||
            product.type === selectedType;

        const searchText = [
            product.name,
            product.brand,
            product.model,
            product.typeName,
            product.description
        ].join(" ").toLowerCase();

        const searchMatch = searchText.includes(
            searchQuery.toLowerCase()
        );

        return categoryMatch && typeMatch && searchMatch;
    });

    if ($("productCount")) {
        $("productCount").textContent =
            `${filtered.length} ta mahsulot topildi`;
    }

    if (!filtered.length) {
        container.innerHTML =
            '<div class="empty">😕 Mahsulot topilmadi</div>';
        return;
    }

    container.innerHTML = filtered.map(product => {
        const image = product.image || "";
        const available = product.stock > 0;

        return `
            <article class="product-card">

                <div class="product-image">
                    <img
                        src="${escapeHTML(image)}"
                        alt="${escapeHTML(product.name)}"
                        loading="lazy"
                        onerror="this.style.display='none'"
                    >

                    <span class="product-badge">
                        ${escapeHTML(
                            product.typeName ||
                            product.type ||
                            "Displey"
                        )}
                    </span>
                </div>

                <div class="product-info">

                    <h4>${escapeHTML(product.name)}</h4>

                    <p class="product-model">
                        ${escapeHTML(product.model || "")}
                    </p>

                    <span class="product-type">
                        ${escapeHTML(product.brand || "")}
                    </span>

                    <div class="product-price">
                        ${money(product.price)}
                    </div>

                    ${
                        product.oldPrice > product.price
                        ? `
                            <div class="old-price">
                                ${money(product.oldPrice)}
                            </div>
                        `
                        : ""
                    }

                    <p class="stock">
                        ${
                            available
                            ? `✓ Mavjud: ${product.stock} dona`
                            : "Mavjud emas"
                        }
                    </p>

                    ${
                        isAdmin
                        ? `
                            <button
                                class="add-btn"
                                onclick="addToCart('${escapeHTML(product.id)}')"
                                ${available ? "" : "disabled"}
                            >
                                ${available ? "+ Savatchaga" : "Tugagan"}
                            </button>
                        `
                        : ""
                    }

                </div>
            </article>
        `;
    }).join("");
}

// ===============================
// QIDIRUV
// ===============================

if ($("searchInput")) {
    $("searchInput").addEventListener("input", event => {
        searchQuery = event.target.value;
        renderProducts();
    });
}

function clearSearch() {
    if (!$("searchInput")) return;

    $("searchInput").value = "";
    searchQuery = "";

    renderProducts();
}

// ===============================
// KATEGORIYA FILTRI
// ===============================

document.querySelectorAll(".category").forEach(button => {
    button.addEventListener("click", () => {
        document.querySelectorAll(".category").forEach(item => {
            item.classList.remove("active");
        });

        button.classList.add("active");

        selectedCategory =
            button.dataset.category || "all";

        renderProducts();
    });
});

// ===============================
// DISPLEY TURI FILTRI
// ===============================

document.querySelectorAll(".filter").forEach(button => {
    button.addEventListener("click", () => {
        document.querySelectorAll(".filter").forEach(item => {
            item.classList.remove("active");
        });

        button.classList.add("active");

        selectedType = button.dataset.type || "all";

        renderProducts();
    });
});

// ===============================
// SAVATCHAGA QO‘SHISH
// ===============================

function addToCart(id) {
    if (!adminCheckComplete || !isAdmin) {
        notify("Savatchadan faqat admin foydalanishi mumkin", "error");
        return;
    }

    const product = products.find(p =>
        sameId(p.id, id)
    );

    if (!product || product.stock <= 0) {
        notify("Mahsulot hozir mavjud emas", "error");
        return;
    }

    const existing = cart.find(item =>
        sameId(item.id, id)
    );

    if (existing) {
        if (
            existing.qty >= product.stock ||
            existing.qty >= 20
        ) {
            notify("Mavjud mahsulot miqdoridan oshib ketdi", "error");
            return;
        }

        existing.qty++;

    } else {
        cart.push({
            id: product.id,
            qty: 1
        });
    }

    updateCart();

    notify("Savatchaga qo‘shildi", "success");
    haptic("light");
}

// ===============================
// JAMI HISOB
// ===============================

function getTotal() {
    if (!isAdmin) return 0;

    return cart.reduce((sum, item) => {
        const product = products.find(p =>
            sameId(p.id, item.id)
        );

        return sum + (
            product ? product.price * item.qty : 0
        );
    }, 0);
}

// ===============================
// MAHSULOTLAR SONI
// ===============================

function getCount() {
    if (!isAdmin) return 0;

    return cart.reduce(
        (sum, item) => sum + item.qty,
        0
    );
}

// ===============================
// SAVATCHANI YANGILASH
// ===============================

function updateCart() {
    const count = getCount();
    const total = getTotal();

    if ($("cartCount")) {
        $("cartCount").textContent = count;
    }

    if ($("barCount")) {
        $("barCount").textContent = count + " ta mahsulot";
    }

    if ($("barTotal")) {
        $("barTotal").textContent = money(total);
    }

    if ($("cartTotal")) {
        $("cartTotal").textContent = money(total);
    }

    if ($("cartBar")) {
        $("cartBar").classList.toggle(
            "hidden",
            !isAdmin || count === 0
        );
    }

    document.body.classList.toggle("is-admin", isAdmin);

    renderCart();
}

// ===============================
// SAVATCHA ICHIDAGI MAHSULOTLAR
// ===============================

function renderCart() {
    const container = $("cartItems");

    if (!container) return;

    if (!isAdmin) {
        container.innerHTML =
            '<div class="empty">Savatchadan faqat admin foydalanadi</div>';
        return;
    }

    if (cart.length === 0) {
        container.innerHTML =
            '<div class="empty">🛒 Savatchangiz hozircha bo‘sh</div>';
        return;
    }

    container.innerHTML = cart.map(item => {
        const product = products.find(p =>
            sameId(p.id, item.id)
        );

        if (!product) return "";

        return `
            <div class="cart-item">

                <div>
                    <h4>
                        ${escapeHTML(product.name)}
                        — ${escapeHTML(product.typeName || "")}
                    </h4>

                    <p>
                        ${money(product.price * item.qty)}
                    </p>
                </div>

                <div class="quantity">

                    <button
                        onclick="changeQty('${escapeHTML(item.id)}', -1)"
                    >
                        −
                    </button>

                    <span>${item.qty}</span>

                    <button
                        onclick="changeQty('${escapeHTML(item.id)}', 1)"
                    >
                        +
                    </button>

                </div>

            </div>
        `;
    }).join("");
}

// ===============================
// MIQDORNI O‘ZGARTIRISH
// ===============================

function changeQty(id, change) {
    if (!isAdmin) return;

    const item = cart.find(p =>
        sameId(p.id, id)
    );

    const product = products.find(p =>
        sameId(p.id, id)
    );

    if (!item || !product) return;

    const nextQty = item.qty + change;

    if (
        nextQty > product.stock ||
        nextQty > 20
    ) {
        notify("Mavjud miqdordan oshib ketdi", "error");
        return;
    }

    item.qty = nextQty;

    if (item.qty <= 0) {
        cart = cart.filter(p =>
            !sameId(p.id, id)
        );
    }

    updateCart();
}

// ===============================
// SAVATCHA MODALI
// ===============================

function openCart() {
    if (!adminCheckComplete || !isAdmin) return;

    if (!$("cartModal")) return;

    $("cartModal").classList.add("show");
    renderCart();
}

function closeCart() {
    $("cartModal")?.classList.remove("show");
}

// ===============================
// BUYURTMA BERISH
// ===============================

async function openCheckout() {
    if (!adminCheckComplete || !isAdmin) {
        notify("Buyurtma berish faqat admin uchun", "error");
        return;
    }

    if (!cart.length) {
        notify("Savatchangiz bo‘sh", "error");
        return;
    }

    if (isOrdering) return;

    if (!tg || !tg.initData) {
        notify(
            "Telegram sessiyasi topilmadi. Mini App havolasini tekshiring.",
            "error"
        );
        return;
    }

    isOrdering = true;

    const orderButton = document.querySelector(".checkout-btn");

    const originalText =
        orderButton?.textContent || "Buyurtma berish";

    if (orderButton) {
        orderButton.disabled = true;
        orderButton.textContent = "⏳ Buyurtma yuborilmoqda...";
    }

    const user = tg.initDataUnsafe?.user;

    const name = user
        ? [user.first_name, user.last_name].filter(Boolean).join(" ")
        : "Telegram foydalanuvchisi";

    const orderItems = cart.map(item => ({
        id: item.id,
        qty: item.qty
    }));

    const controller = new AbortController();

    const timeout = setTimeout(
        () => controller.abort(),
        15000
    );

    try {
        const response = await fetch(
            `${API_URL}/api/orders`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                signal: controller.signal,
                body: JSON.stringify({
                    initData: tg.initData,
                    name,
                    phone: "",
                    note: "",
                    items: orderItems
                })
            }
        );

        const result = await response.json();

        if (!response.ok || !result.success) {
            throw new Error(
                result.message ||
                "Buyurtmani qabul qilishda xatolik"
            );
        }

        cart = [];

        updateCart();
        closeCart();

        if ($("successText")) {
            $("successText").textContent =
                `Buyurtma #${result.orderId} muvaffaqiyatli qabul qilindi. Jami: ${money(result.total)}`;
        }

        $("successModal")?.classList.add("show");

        notify("Buyurtmangiz muvaffaqiyatli berildi!", "success");
        successHaptic();

        await loadProducts();

    } catch (error) {
        console.error("Buyurtma xatosi:", error);

        notify(
            error.name === "AbortError"
                ? "Server javob bermadi. Buyurtma holatini tekshiring."
                : error.message || "Buyurtma yuborilmadi.",
            "error"
        );

    } finally {
        clearTimeout(timeout);

        isOrdering = false;

        if (orderButton) {
            orderButton.disabled = false;
            orderButton.textContent = originalText;
        }
    }
}

// ===============================
// MUVAFFAQIYAT MODALI
// ===============================

function closeSuccess() {
    $("successModal")?.classList.remove("show");
}

// ===============================
// ADMIN BILAN ALOQA
// ===============================

function contactAdmin() {
    const username = ADMIN_USERNAME.replace("@", "");
    const url = `https://t.me/${username}`;

    if (tg?.openTelegramLink) {
        tg.openTelegramLink(url);
    } else {
        window.open(url, "_blank");
    }
}

// ===============================
// KATALOGGA O‘TISH
// ===============================

function scrollCatalog() {
    $("catalog")?.scrollIntoView({
        behavior: "smooth"
    });
}

// ===============================
// BOSH SAHIFA
// ===============================

function goHome() {
    window.scrollTo({
        top: 0,
        behavior: "smooth"
    });
}

// ===============================
// MODALNI TASHQARISIDAN YOPISH
// ===============================

[
    "cartModal",
    "checkoutModal",
    "successModal"
].forEach(id => {
    const modal = $(id);

    if (!modal) return;

    modal.addEventListener("click", event => {
        if (event.target === modal) {
            modal.classList.remove("show");
        }
    });
});

// ===============================
// SAHIFA QAYTA OCHILGANDA YANGILASH
// ===============================

document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
        loadProducts();
        checkAdminAccess();
    }
});

// ===============================
// ISHGA TUSHIRISH
// ===============================

async function initShop() {
    await checkAdminAccess();
    await loadProducts();
    updateCart();
}

initShop();
