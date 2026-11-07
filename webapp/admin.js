
"use strict";

/* =========================================
   EKRAN SHOP — ADMIN PANEL
   PRODUCTS + ORDERS + WAREHOUSE
========================================= */

let adminProducts = [];
let adminOrders = [];
let warehouseHistory = [];

let warehouseStats = {
    incoming: 0,
    outgoing: 0,
    stock: 0
};

let isLoading = false;
let isWarehouseLoading = false;
let previewObjectURL = null;

const $ = id => document.getElementById(id);

const money = value =>
    Number(value || 0).toLocaleString("uz-UZ") + " so'm";

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[char]);
}

function safeNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function formatDate(value) {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return "Sana mavjud emas";
    }

    return date.toLocaleString("uz-UZ");
}

/* =========================================
   TOAST
========================================= */

function toast(message) {
    let element = $("toast");

    if (!element) {
        element = document.createElement("div");
        element.id = "toast";
        element.className = "toast";
        document.body.appendChild(element);
    }

    element.textContent = message;
    element.classList.add("show");

    clearTimeout(element._timer);

    element._timer = setTimeout(() => {
        element.classList.remove("show");
    }, 2800);
}

/* =========================================
   API
========================================= */

async function api(url, options = {}) {
    let response;

    try {
        response = await fetch(url, {
            credentials: "same-origin",
            cache: "no-store",
            ...options
        });
    } catch (error) {
        console.error("FETCH ERROR:", error);
        throw new Error("Server bilan aloqa yo‘q.");
    }

    const contentType = response.headers.get("content-type") || "";

    let data;

    if (contentType.includes("application/json")) {
        data = await response.json().catch(() => ({}));
    } else {
        data = {
            message: await response.text().catch(() => "")
        };
    }

    if (!response.ok) {
        throw new Error(
            data.message ||
            data.error ||
            `Server xatosi: ${response.status}`
        );
    }

    return data;
}

/* =========================================
   RESPONSE ARRAY
========================================= */

function getArray(data, key) {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.[key])) return data[key];
    return [];
}

/* =========================================
   LOGIN / ADMIN
========================================= */

function showLogin() {
    $("loginScreen")?.classList.remove("hidden");
    $("adminApp")?.classList.add("hidden");
}

function showAdmin() {
    $("loginScreen")?.classList.add("hidden");
    $("adminApp")?.classList.remove("hidden");
}

async function checkAdmin() {
    try {
        const data = await api("/api/admin/me");

        if (data.isAdmin !== true) {
            showLogin();
            return;
        }

        showAdmin();
        await loadAll();

    } catch (error) {
        console.error("ADMIN CHECK:", error);
        showLogin();
    }
}

/* =========================================
   LOGIN FORM
========================================= */

$("loginForm")?.addEventListener("submit", async event => {
    event.preventDefault();

    const passwordInput = $("adminPassword");
    const button = event.submitter ||
        $("loginForm").querySelector('[type="submit"]');

    if (!passwordInput || !button) return;

    const password = passwordInput.value.trim();

    if (!password) {
        $("loginError").textContent = "Parolni kiriting.";
        return;
    }

    button.disabled = true;
    button.textContent = "Tekshirilmoqda...";
    $("loginError").textContent = "";

    try {
        await api("/api/admin/login", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ password })
        });

        passwordInput.value = "";

        showAdmin();
        await loadAll();

        toast("Admin panelga xush kelibsiz!");

    } catch (error) {
        $("loginError").textContent = error.message;

    } finally {
        button.disabled = false;
        button.textContent = "Tizimga kirish →";
    }
});

/* =========================================
   LOGOUT
========================================= */

$("logoutBtn")?.addEventListener("click", async () => {
    const button = $("logoutBtn");

    if (button) button.disabled = true;

    try {
        await api("/api/admin/logout", {
            method: "POST"
        });

        adminProducts = [];
        adminOrders = [];
        warehouseHistory = [];

        showLogin();
        toast("Tizimdan chiqildi.");

    } catch (error) {
        toast(error.message);

    } finally {
        if (button) button.disabled = false;
    }
});

/* =========================================
   LOAD ALL
========================================= */

async function loadAll() {
    if (isLoading) return;

    isLoading = true;

    try {
        const [productsData, ordersData] = await Promise.all([
            api("/api/admin/products"),
            api("/api/admin/orders")
        ]);

        adminProducts = getArray(productsData, "products");
        adminOrders = getArray(ordersData, "orders");

        renderDashboard();
        renderAdminProducts();
        renderOrders();

        await loadWarehouse();

    } catch (error) {
        toast(error.message);

    } finally {
        isLoading = false;
    }
}

/* =========================================
   PAGE NAVIGATION
========================================= */

function showPage(page) {
    const pages = [
        "dashboard",
        "products",
        "orders",
        "warehouse"
    ];

    if (!pages.includes(page)) return;

    pages.forEach(name => {
        $(name + "Page")?.classList.toggle(
            "hidden",
            name !== page
        );
    });

    document.querySelectorAll(".side-link").forEach(button => {
        button.classList.toggle(
            "active",
            button.dataset.page === page
        );
    });

    const titles = {
        dashboard: "Bosh sahifa",
        products: "Displeylar",
        orders: "Buyurtmalar",
        warehouse: "Ombor"
    };

    if ($("pageTitle")) {
        $("pageTitle").textContent = titles[page];
    }

    if (page === "orders") loadOrders();
    if (page === "products") renderAdminProducts();
    if (page === "warehouse") loadWarehouse();
}

document.querySelectorAll(".side-link").forEach(button => {
    button.addEventListener("click", () => {
        showPage(button.dataset.page);
    });
});

/* =========================================
   DASHBOARD
========================================= */

function renderDashboard() {
    if ($("statProducts")) {
        $("statProducts").textContent = adminProducts.length;
    }

    const stock = adminProducts.reduce((sum, product) => {
        return sum + Math.max(0, safeNumber(product.stock));
    }, 0);

    if ($("statStock")) {
        $("statStock").textContent = stock;
    }

    if ($("statOrders")) {
        $("statOrders").textContent = adminOrders.length;
    }

    const revenue = adminOrders
        .filter(order => order.status !== "Bekor qilindi")
        .reduce((sum, order) => {
            return sum + safeNumber(order.total);
        }, 0);

    if ($("statRevenue")) {
        $("statRevenue").textContent = money(revenue);
    }

    const latest = adminProducts.slice(-5).reverse();

    if ($("dashboardProducts")) {
        $("dashboardProducts").innerHTML = latest.length
            ? latest.map(productHTML).join("")
            : '<div class="empty">Hozircha displey yo‘q</div>';
    }
}

/* =========================================
   PRODUCT HTML
========================================= */

function productHTML(product) {
    const id = escapeHTML(product.id);
    const image = escapeHTML(product.image || "");
    const name = escapeHTML(product.name || "Nomsiz mahsulot");
    const brand = escapeHTML(product.brand || "");
    const model = escapeHTML(product.model || "");

    const stock = Math.max(0, safeNumber(product.stock));
    const price = money(product.price);

    return `
        <div class="admin-product">

            <img
                src="${image}"
                alt="${name}"
                loading="lazy"
                onerror="this.style.visibility='hidden'"
            >

            <div class="admin-product-info">
                <h3>${name}</h3>

                <p>
                    ${brand} · ${model} · ${stock} dona
                </p>

                <strong>${price}</strong>
            </div>

            <div class="product-actions">

                <button
                    class="edit-btn"
                    type="button"
                    data-action="edit"
                    data-id="${id}">
                    ✎ Tahrirlash
                </button>

                <button
                    class="delete-btn"
                    type="button"
                    data-action="delete"
                    data-id="${id}">
                    🗑 O‘chirish
                </button>

            </div>

        </div>
    `;
}

/* =========================================
   PRODUCT LIST + BRAND FILTER
========================================= */

function renderAdminProducts() {
    const container = $("adminProducts");

    if (!container) return;

    const search = ($("adminSearch")?.value || "")
        .trim()
        .toLowerCase();

    const filter = $("adminFilter")?.value || "all";

    const filtered = adminProducts.filter(product => {
        const text = [
            product.name,
            product.brand,
            product.model
        ].join(" ").toLowerCase();

        const matchesSearch = text.includes(search);

        const matchesFilter =
            filter === "all" || product.brand === filter;

        return matchesSearch && matchesFilter;
    });

    container.innerHTML = filtered.length
        ? filtered.map(productHTML).join("")
        : '<div class="empty">Displey topilmadi</div>';
}

$("adminSearch")?.addEventListener("input", renderAdminProducts);
$("adminFilter")?.addEventListener("change", renderAdminProducts);

/* =========================================
   PRODUCT ACTIONS
========================================= */

function handleProductAction(event) {
    const button = event.target.closest("[data-action]");

    if (!button) return;

    const id = button.dataset.id;
    const action = button.dataset.action;

    if (action === "edit") editProduct(id);
    if (action === "delete") deleteProduct(id);
}

$("adminProducts")?.addEventListener("click", handleProductAction);
$("dashboardProducts")?.addEventListener("click", handleProductAction);

/* =========================================
   IMAGE PREVIEW
========================================= */

function clearImagePreview() {
    if (previewObjectURL) {
        URL.revokeObjectURL(previewObjectURL);
        previewObjectURL = null;
    }

    const preview = $("imagePreview");

    if (preview) {
        preview.classList.add("hidden");
        preview.removeAttribute("src");
    }
}

$("pImage")?.addEventListener("change", () => {
    const file = $("pImage").files?.[0];

    if (!file) return;

    const allowedTypes = [
        "image/jpeg",
        "image/png",
        "image/webp"
    ];

    if (!allowedTypes.includes(file.type)) {
        $("formError").textContent =
            "JPG, PNG yoki WEBP rasm tanlang.";

        $("pImage").value = "";
        return;
    }

    if (file.size > 5 * 1024 * 1024) {
        $("formError").textContent =
            "Rasm hajmi 5 MB dan oshmasin.";

        $("pImage").value = "";
        return;
    }

    $("formError").textContent = "";

    clearImagePreview();

    previewObjectURL = URL.createObjectURL(file);

    $("imagePreview").src = previewObjectURL;
    $("imagePreview").classList.remove("hidden");
});

/* =========================================
   OPEN PRODUCT FORM
========================================= */

function openProductForm() {
    $("productForm")?.reset();

    if ($("editId")) $("editId").value = "";
    if ($("pOldPrice")) $("pOldPrice").value = 0;

    if ($("pStock")) {
        $("pStock").value = 1;
        $("pStock").readOnly = false;
        $("pStock").title = "";
    }

    if ($("formTitle")) {
        $("formTitle").textContent = "Yangi displey qo‘shish";
    }

    if ($("saveProductBtn")) {
        $("saveProductBtn").textContent = "Mahsulotni saqlash";
    }

    clearImagePreview();

    if ($("formError")) {
        $("formError").textContent = "";
    }

    $("productModal")?.classList.add("show");
}

function closeProductForm() {
    $("productModal")?.classList.remove("show");
    clearImagePreview();
}

/* =========================================
   EDIT PRODUCT
========================================= */

function editProduct(id) {
    const product = adminProducts.find(
        p => String(p.id) === String(id)
    );

    if (!product) {
        alert("Mahsulot topilmadi!");
        return;
    }

    const fields = {
        editId: product.id,
        pName: product.name,
        pBrand: product.brand,
        pModel: product.model,
        pPrice: product.price,
        pOldPrice: product.oldPrice || 0,
        pStock: product.stock ?? 0,
        pDescription: product.description || ""
    };

    Object.entries(fields).forEach(([fieldId, value]) => {
        const element = $(fieldId);
        if (element) element.value = value ?? "";
    });

    if ($("pStock")) {
        $("pStock").readOnly = true;
        $("pStock").title =
            "Qoldiqni o‘zgartirish uchun Ombor bo‘limidan foydalaning.";
    }

    if ($("pImage")) {
        $("pImage").value = "";
    }

    clearImagePreview();

    if (product.image && $("imagePreview")) {
        $("imagePreview").src = product.image;
        $("imagePreview").classList.remove("hidden");
    }

    if ($("formTitle")) {
        $("formTitle").textContent = "Displeyni tahrirlash";
    }

    if ($("saveProductBtn")) {
        $("saveProductBtn").textContent = "O‘zgarishlarni saqlash";
    }

    if ($("formError")) {
        $("formError").textContent = "";
    }

    $("productModal")?.classList.add("show");
}

/* =========================================
   SAVE PRODUCT
========================================= */

$("productForm")?.addEventListener("submit", async event => {
    event.preventDefault();

    const id = $("editId")?.value || "";
    const image = $("pImage")?.files?.[0];

    const name = $("pName")?.value.trim();
    const brand = $("pBrand")?.value.trim();
    const model = $("pModel")?.value.trim();

    const price = Number($("pPrice")?.value);
    const oldPrice = Number($("pOldPrice")?.value || 0);
    const stock = Number($("pStock")?.value);

    if (!name || !brand || !model) {
        $("formError").textContent =
            "Mahsulot nomi, brendi va modelini kiriting.";
        return;
    }

    if (!Number.isSafeInteger(price) || price <= 0) {
        $("formError").textContent =
            "Mahsulot narxini to‘g‘ri kiriting.";
        return;
    }

    if (!Number.isSafeInteger(oldPrice) || oldPrice < 0) {
        $("formError").textContent =
            "Eski narxni to‘g‘ri kiriting.";
        return;
    }

    if (!Number.isSafeInteger(stock) || stock < 0) {
        $("formError").textContent =
            "Ombordagi sonni to‘g‘ri kiriting.";
        return;
    }

    if (!id && !image) {
        $("formError").textContent =
            "Yangi mahsulot uchun rasm yuklang.";
        return;
    }

    const formData = new FormData();

    formData.append("name", name);
    formData.append("brand", brand);
    formData.append("model", model);
    formData.append("price", String(price));
    formData.append("oldPrice", String(oldPrice));

    // Yangi mahsulotda boshlang‘ich qoldiq yuboriladi.
    // Tahrirlashda ombor qoldig‘i o‘zgartirilmaydi.
    if (!id) {
        formData.append("stock", String(stock));
    }

    formData.append(
        "description",
        $("pDescription")?.value.trim() || ""
    );

    if (image) {
        formData.append("image", image);
    }

    const button = $("saveProductBtn");

    if (button) {
        button.disabled = true;
        button.textContent = "Saqlanmoqda...";
    }

    $("formError").textContent = "";

    try {
        await api(
            id
                ? `/api/admin/products/${encodeURIComponent(id)}`
                : "/api/admin/products",
            {
                method: id ? "PUT" : "POST",
                body: formData
            }
        );

        closeProductForm();

        await loadAll();

        toast(
            id
                ? "Displey yangilandi!"
                : "Yangi displey qo‘shildi!"
        );

    } catch (error) {
        $("formError").textContent = error.message;

    } finally {
        if (button) {
            button.disabled = false;
            button.textContent = id
                ? "O‘zgarishlarni saqlash"
                : "Mahsulotni saqlash";
        }
    }
});

/* =========================================
   DELETE PRODUCT
========================================= */

async function deleteProduct(id) {
    const product = adminProducts.find(
        p => String(p.id) === String(id)
    );

    if (!product) {
        toast("Mahsulot topilmadi.");
        return;
    }

    const confirmed = confirm(
        `"${product.name}" displeyini o‘chirmoqchimisiz?`
    );

    if (!confirmed) return;

    try {
        await api(
            `/api/admin/products/${encodeURIComponent(id)}`,
            { method: "DELETE" }
        );

        await loadAll();

        toast("Displey o‘chirildi!");

    } catch (error) {
        toast(error.message);
    }
}

/* =========================================
   ORDERS
========================================= */

async function loadOrders() {
    try {
        const data = await api("/api/admin/orders");

        adminOrders = getArray(data, "orders");

        renderOrders();
        renderDashboard();

    } catch (error) {
        toast(error.message);
    }
}

function renderOrders() {
    const container = $("adminOrders");

    if (!container) return;

    if (!adminOrders.length) {
        container.innerHTML =
            '<div class="empty">Hozircha buyurtmalar yo‘q.</div>';
        return;
    }

    const statuses = [
        "Yangi",
        "Jarayonda",
        "Tayyor",
        "Yetkazildi",
        "Bekor qilindi"
    ];

    container.innerHTML = adminOrders.map(order => {
        const id = String(order.id ?? "");
        const items = Array.isArray(order.items)
            ? order.items
            : [];

        return `
            <div class="order-card">

                <div class="order-top">
                    <h3>Buyurtma #${escapeHTML(id)}</h3>
                    <strong>${money(order.total)}</strong>
                </div>

                <p>👤 ${escapeHTML(order.customerName || "Noma'lum")}</p>

                <p>📞 ${escapeHTML(order.phone || "Kiritilmagan")}</p>

                <p>🆔 Telegram ID:
                    ${escapeHTML(order.userId || "Mavjud emas")}
                </p>

                <p>📅 ${escapeHTML(formatDate(order.createdAt))}</p>

                <p><b>Mahsulotlar:</b></p>

                ${items.map(item => `
                    <p>
                        ${escapeHTML(item.name || "Mahsulot")}
                        — ${Math.max(0, safeNumber(item.qty))} dona
                    </p>
                `).join("")}

                <p>📝 ${escapeHTML(order.note || "Izoh yo‘q")}</p>

                <label>Buyurtma holati:</label>

                <select
                    data-order-status
                    data-id="${escapeHTML(id)}"
                >
                    ${statuses.map(status => `
                        <option
                            value="${escapeHTML(status)}"
                            ${order.status === status ? "selected" : ""}
                        >
                            ${escapeHTML(status)}
                        </option>
                    `).join("")}
                </select>

            </div>
        `;
    }).join("");
}

/* =========================================
   CHANGE ORDER STATUS
========================================= */

$("adminOrders")?.addEventListener("change", async event => {
    const select = event.target.closest("[data-order-status]");

    if (!select) return;

    const id = select.dataset.id;
    const status = select.value;

    select.disabled = true;

    try {
        await api(
            `/api/admin/orders/${encodeURIComponent(id)}`,
            {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ status })
            }
        );

        await loadOrders();

        toast("Buyurtma holati yangilandi!");

    } catch (error) {
        toast(error.message);
        await loadOrders();

    } finally {
        select.disabled = false;
    }
});

/* =========================================
   WAREHOUSE — LOAD DATA
========================================= */

async function loadWarehouse() {
    if (isWarehouseLoading) return;

    isWarehouseLoading = true;

    const historyContainer = $("warehouseHistory");

    if (historyContainer) {
        historyContainer.innerHTML =
            '<div class="empty">Ombor ma’lumotlari yuklanmoqda...</div>';
    }

    try {
        const data = await api("/api/admin/warehouse");

        warehouseStats = {
            incoming: safeNumber(data.stats?.incoming),
            outgoing: safeNumber(data.stats?.outgoing),
            stock: safeNumber(data.stats?.stock)
        };

        warehouseHistory = getArray(data, "history");

        renderWarehouseStats();
        renderWarehouseProducts();
        renderWarehouseHistory();

    } catch (error) {
        if (historyContainer) {
            historyContainer.innerHTML = `
                <div class="empty">
                    Ombor ma’lumotlarini yuklab bo‘lmadi:
                    ${escapeHTML(error.message)}
                </div>
            `;
        }

        console.error("WAREHOUSE LOAD:", error);

    } finally {
        isWarehouseLoading = false;
    }
}

/* =========================================
   WAREHOUSE — STATISTICS
========================================= */

function renderWarehouseStats() {
    const totalStock = adminProducts.reduce((sum, product) => {
        return sum + Math.max(0, safeNumber(product.stock));
    }, 0);

    if ($("warehouseIncoming")) {
        $("warehouseIncoming").textContent =
            warehouseStats.incoming.toLocaleString("uz-UZ");
    }

    if ($("warehouseOutgoing")) {
        $("warehouseOutgoing").textContent =
            warehouseStats.outgoing.toLocaleString("uz-UZ");
    }

    if ($("warehouseStock")) {
        $("warehouseStock").textContent =
            totalStock.toLocaleString("uz-UZ");
    }
}

/* =========================================
   WAREHOUSE — PRODUCT SELECT
========================================= */

function renderWarehouseProducts() {
    const select = $("warehouseProduct");

    if (!select) return;

    const selectedValue = select.value;

    select.innerHTML = `
        <option value="">Mahsulotni tanlang</option>

        ${adminProducts.map(product => {
            const id = escapeHTML(product.id);
            const name = escapeHTML(product.name || "Nomsiz");
            const model = escapeHTML(product.model || "");
            const brand = escapeHTML(product.brand || "");

            const stock = Math.max(0, safeNumber(product.stock));

            return `
                <option value="${id}">
                    ${brand} ${name} — ${model} | Qoldiq: ${stock}
                </option>
            `;
        }).join("")}
    `;

    if (
        selectedValue &&
        adminProducts.some(p => String(p.id) === selectedValue)
    ) {
        select.value = selectedValue;
    }
}

/* =========================================
   WAREHOUSE — HISTORY
========================================= */

function renderWarehouseHistory() {
    const container = $("warehouseHistory");

    if (!container) return;

    if (!warehouseHistory.length) {
        container.innerHTML = `
            <div class="empty">
                Hozircha ombor operatsiyalari mavjud emas.
            </div>
        `;
        return;
    }

    container.innerHTML = warehouseHistory.map(item => {
        const isIncoming =
            item.type === "in" ||
            item.type === "incoming";

        const quantity = Math.max(
            0,
            safeNumber(item.quantity)
        );

        const productName = escapeHTML(
            item.productName || item.name || "Mahsulot"
        );

        const note = escapeHTML(item.note || "Izoh yo‘q");

        const sourceLabel =
            item.source === "order"
                ? "Buyurtma"
                : "Qo‘lda";

        return `
            <div class="warehouse-history-item">

                <div class="warehouse-history-info">
                    <strong>${productName}</strong>

                    <p>${escapeHTML(formatDate(item.createdAt))}</p>

                    <small>${note}</small>

                    <small>Manba: ${sourceLabel}</small>
                </div>

                <div class="warehouse-history-quantity"
                     style="color:${isIncoming ? '#16a34a' : '#dc2626'}">

                    ${isIncoming ? "+" : "−"}${quantity} dona

                    <small>
                        ${isIncoming ? "Kirim" : "Chiqim"}
                    </small>
                </div>

            </div>
        `;
    }).join("");
}

/* =========================================
   WAREHOUSE — IN / OUT
========================================= */

async function warehouseMove(type) {
    const productId = $("warehouseProduct")?.value;
    const quantity = Number($("warehouseQuantity")?.value);
    const note = $("warehouseNote")?.value.trim() || "";

    const errorElement = $("warehouseError");

    if (errorElement) errorElement.textContent = "";

    if (!["in", "out"].includes(type)) {
        if (errorElement) {
            errorElement.textContent = "Operatsiya turi noto‘g‘ri.";
        }
        return;
    }

    if (!productId) {
        if (errorElement) {
            errorElement.textContent = "Mahsulotni tanlang.";
        }
        return;
    }

    if (!Number.isSafeInteger(quantity) || quantity < 1) {
        if (errorElement) {
            errorElement.textContent =
                "Miqdor kamida 1 dona bo‘lishi kerak.";
        }
        return;
    }

    const product = adminProducts.find(
        p => String(p.id) === String(productId)
    );

    if (!product) {
        if (errorElement) {
            errorElement.textContent = "Mahsulot topilmadi.";
        }
        return;
    }

    const currentStock = Math.max(
        0,
        safeNumber(product.stock)
    );

    if (type === "out" && quantity > currentStock) {
        if (errorElement) {
            errorElement.textContent =
                `Omborda faqat ${currentStock} dona mavjud.`;
        }
        return;
    }

    const operationName =
        type === "in" ? "KIRIM" : "CHIQIM";

    const confirmed = confirm(
        `${product.name}\n\n` +
        `Operatsiya: ${operationName}\n` +
        `Miqdor: ${quantity} dona\n` +
        `Hozirgi qoldiq: ${currentStock} dona\n\n` +
        `Davom etasizmi?`
    );

    if (!confirmed) return;

    const buttons = document.querySelectorAll(
        '[onclick*="warehouseMove"]'
    );

    buttons.forEach(button => {
        button.disabled = true;
    });

    try {
        const endpoint = type === "in"
            ? "/api/admin/warehouse/in"
            : "/api/admin/warehouse/out";

        await api(endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                productId,
                quantity,
                note
            })
        });

        if ($("warehouseQuantity")) {
            $("warehouseQuantity").value = "";
        }

        if ($("warehouseNote")) {
            $("warehouseNote").value = "";
        }

        await loadAll();

        toast(
            type === "in"
                ? "Mahsulot omborga qabul qilindi!"
                : "Mahsulot ombordan chiqarildi!"
        );

    } catch (error) {
        if (errorElement) {
            errorElement.textContent = error.message;
        }

        toast(error.message);

    } finally {
        buttons.forEach(button => {
            button.disabled = false;
        });
    }
}

/* =========================================
   MODAL CLOSE
========================================= */

$("productModal")?.addEventListener("click", event => {
    if (event.target.id === "productModal") {
        closeProductForm();
    }
});

/* =========================================
   REFRESH
========================================= */

async function refreshAdmin() {
    await loadAll();
}

document.addEventListener("visibilitychange", () => {
    if (
        !document.hidden &&
        !$("adminApp")?.classList.contains("hidden")
    ) {
        loadAll();
    }
});

/* =========================================
   GLOBAL FUNCTIONS
========================================= */

window.showPage = showPage;
window.openProductForm = openProductForm;
window.closeProductForm = closeProductForm;
window.editProduct = editProduct;
window.deleteProduct = deleteProduct;
window.loadAll = loadAll;
window.loadOrders = loadOrders;
window.loadWarehouse = loadWarehouse;
window.warehouseMove = warehouseMove;
window.refreshAdmin = refreshAdmin;

/* =========================================
   START
========================================= */

document.addEventListener("DOMContentLoaded", checkAdmin);
