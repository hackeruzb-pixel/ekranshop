
"use strict";

/* =========================================
   EKRAN SHOP — ADMIN PANEL
========================================= */

let adminProducts = [];
let adminOrders = [];

let isLoading = false;
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

    console.log("API:", url);
    console.log("STATUS:", response.status);
    console.log("RESPONSE:", data);

    if (!response.ok) {
        if (response.status === 401) {
            console.error("ADMIN SESSION YO‘Q!");
        }

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
        await api("/api/admin/me");

        showAdmin();
        await loadAll();

    } catch {
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
        "orders"
    ];

    if (!pages.includes(page)) return;

    pages.forEach(name => {
        const element = $(name + "Page");

        element?.classList.toggle(
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
        orders: "Buyurtmalar"
    };

    if ($("pageTitle")) {
        $("pageTitle").textContent = titles[page];
    }

    if (page === "orders") {
        loadOrders();
    }

    if (page === "products") {
        renderAdminProducts();
    }
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
    const model = escapeHTML(product.model || "");
    const type = escapeHTML(
        product.typeName || product.type || ""
    );

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
                    ${model}
                    · ${type}
                    · ${stock} dona
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
   PRODUCT LIST
========================================= */

function renderAdminProducts() {
    const container = $("adminProducts");

    if (!container) return;

    const search = ($("adminSearch")?.value || "")
        .trim()
        .toLowerCase();

    const filtered = adminProducts.filter(product => {
        const text = [
            product.name,
            product.brand,
            product.model,
            product.type,
            product.typeName
        ].join(" ").toLowerCase();

        return text.includes(search);
    });

    container.innerHTML = filtered.length
        ? filtered.map(productHTML).join("")
        : '<div class="empty">Displey topilmadi</div>';
}

$("adminSearch")?.addEventListener("input", renderAdminProducts);

/* =========================================
   PRODUCT ACTIONS
========================================= */

$("adminProducts")?.addEventListener("click", event => {
    const button = event.target.closest("[data-action]");

    if (!button) return;

    const id = button.dataset.id;
    const action = button.dataset.action;

    if (action === "edit") {
        editProduct(id);
    }

    if (action === "delete") {
        deleteProduct(id);
    }
});

$("dashboardProducts")?.addEventListener("click", event => {
    const button = event.target.closest("[data-action]");

    if (!button) return;

    if (button.dataset.action === "edit") {
        editProduct(button.dataset.id);
    }

    if (button.dataset.action === "delete") {
        deleteProduct(button.dataset.id);
    }
});

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
    if ($("pStock")) $("pStock").value = 1;

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
        pType: product.type,
        pCategory: product.category || "iphone",
        pPrice: product.price,
        pOldPrice: product.oldPrice || 0,
        pStock: product.stock ?? 0,
        pDescription: product.description || ""
    };

    Object.entries(fields).forEach(([id, value]) => {
        const element = $(id);
        if (element) element.value = value ?? "";
    });

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

    if (!Number.isFinite(price) || price <= 0) {
        $("formError").textContent =
            "Mahsulot narxini to‘g‘ri kiriting.";
        return;
    }

    if (!Number.isFinite(oldPrice) || oldPrice < 0) {
        $("formError").textContent =
            "Eski narxni to‘g‘ri kiriting.";
        return;
    }

    if (!Number.isInteger(stock) || stock < 0) {
        $("formError").textContent =
            "Ombordagi son 0 yoki undan katta butun son bo‘lishi kerak.";
        return;
    }

    if (!id && !image) {
        $("formError").textContent =
            "Yangi mahsulot uchun rasm yuklang.";
        return;
    }

    const formData = new FormData();
formData.append("category", $("pCategory")?.value || "iphone");
    formData.append("name", name);
    formData.append("brand", brand);
    formData.append("model", model);
    formData.append("type", $("pType")?.value || "");
    formData.append("price", String(price));
    formData.append("oldPrice", String(oldPrice));
    formData.append("stock", String(stock));
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
                    <h3>
                        Buyurtma #${escapeHTML(id)}
                    </h3>

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
                        (${escapeHTML(item.type || "")})
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
    if (!document.hidden && !$("adminApp")?.classList.contains("hidden")) {
        loadAll();
    }
});

/* =========================================
   GLOBAL FUNCTIONS
   HTML onclick ishlatadigan funksiyalar
========================================= */

window.showPage = showPage;
window.openProductForm = openProductForm;
window.closeProductForm = closeProductForm;
window.editProduct = editProduct;
window.deleteProduct = deleteProduct;
window.loadAll = loadAll;
window.loadOrders = loadOrders;
window.refreshAdmin = refreshAdmin;

/* =========================================
   START
========================================= */

document.addEventListener("DOMContentLoaded", checkAdmin);
