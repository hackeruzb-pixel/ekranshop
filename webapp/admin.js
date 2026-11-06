
let adminProducts = [];
let adminOrders = [];

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

// API
async function api(url, options = {}) {
    const response = await fetch(url, {
        credentials: "same-origin",
        ...options
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        if (response.status === 401) showLogin();
        throw new Error(data.message || "Server xatosi");
    }

    return data;
}

// TOAST
function toast(message) {
    const element = $("toast");
    if (!element) return;

    element.textContent = message;
    element.classList.add("show");

    setTimeout(() => element.classList.remove("show"), 2500);
}

// LOGIN
function showLogin() {
    $("loginScreen").classList.remove("hidden");
    $("adminApp").classList.add("hidden");
}

function showAdmin() {
    $("loginScreen").classList.add("hidden");
    $("adminApp").classList.remove("hidden");
}

// ADMIN TEKSHIRISH
async function checkAdmin() {
    try {
        await api("/api/admin/me");
        showAdmin();
        await loadAll();
    } catch {
        showLogin();
    }
}

// LOGIN
$("loginForm").addEventListener("submit", async event => {
    event.preventDefault();

    const password = $("adminPassword").value;
    const button = event.submitter;

    button.disabled = true;
    button.textContent = "Tekshirilmoqda...";

    $("loginError").textContent = "";

    try {
        await api("/api/admin/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password })
        });

        $("adminPassword").value = "";

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

// LOGOUT
$("logoutBtn").addEventListener("click", async () => {
    try {
        await api("/api/admin/logout", { method: "POST" });
        showLogin();
        toast("Tizimdan chiqildi");
    } catch (error) {
        toast(error.message);
    }
});

// MA'LUMOTLARNI YUKLASH
async function loadAll() {
    try {
        const [products, orders] = await Promise.all([
            api("/api/admin/products"),
            api("/api/admin/orders")
        ]);

        adminProducts = products;
        adminOrders = orders;

        renderDashboard();
        renderAdminProducts();
        renderOrders();

    } catch (error) {
        toast(error.message);
    }
}

// SAHIFALAR
function showPage(page) {
    const pages = ["dashboard", "products", "orders"];

    if (!pages.includes(page)) return;

    pages.forEach(name => {
        $(name + "Page").classList.toggle("hidden", name !== page);
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

    $("pageTitle").textContent = titles[page];

    if (page === "orders") loadOrders();
}

document.querySelectorAll(".side-link").forEach(button => {
    button.addEventListener("click", () => {
        showPage(button.dataset.page);
    });
});

// DASHBOARD
function renderDashboard() {
    $("statProducts").textContent = adminProducts.length;

    const stock = adminProducts.reduce(
        (sum, product) => sum + Number(product.stock || 0), 0
    );

    $("statStock").textContent = stock;
    $("statOrders").textContent = adminOrders.length;

    const revenue = adminOrders
        .filter(order => order.status !== "Bekor qilindi")
        .reduce((sum, order) => sum + Number(order.total || 0), 0);

    $("statRevenue").textContent = money(revenue);

    const latest = adminProducts.slice(-5).reverse();

    $("dashboardProducts").innerHTML = latest.length
        ? latest.map(productHTML).join("")
        : '<div class="empty">Hozircha displey yo‘q</div>';
}

// MAHSULOT HTML
function productHTML(product) {
    return `
        <div class="admin-product">

            <img
                src="${escapeHTML(product.image)}"
                alt="${escapeHTML(product.name)}"
                onerror="this.style.visibility='hidden'"
            >

            <div class="admin-product-info">
                <h3>${escapeHTML(product.name)}</h3>

                <p>
                    ${escapeHTML(product.model)}
                    · ${escapeHTML(product.typeName)}
                    · ${Number(product.stock)} dona
                </p>

                <strong>${money(product.price)}</strong>
            </div>

            <div class="product-actions">
                <button class="edit-btn"
                    onclick="editProduct(${product.id})">
                    ✎ Tahrirlash
                </button>

                <button class="delete-btn"
                    onclick="deleteProduct(${product.id})">
                    🗑 O‘chirish
                </button>
            </div>

        </div>
    `;
}

// MAHSULOTLAR
function renderAdminProducts() {
    const search = $("adminSearch").value.toLowerCase();

    const filtered = adminProducts.filter(product => {
        const text = `
            ${product.name}
            ${product.brand}
            ${product.model}
        `.toLowerCase();

        return text.includes(search);
    });

    $("adminProducts").innerHTML = filtered.length
        ? filtered.map(productHTML).join("")
        : '<div class="empty">Displey topilmadi</div>';
}

$("adminSearch").addEventListener("input", renderAdminProducts);

// FORM OCHISH
function openProductForm() {
    $("productForm").reset();

    $("editId").value = "";
    $("pOldPrice").value = 0;
    $("pStock").value = 1;

    $("formTitle").textContent = "Yangi displey qo‘shish";
    $("saveProductBtn").textContent = "Mahsulotni saqlash";

    $("imagePreview").classList.add("hidden");
    $("imagePreview").removeAttribute("src");

    $("formError").textContent = "";
    $("productModal").classList.add("show");
}

// FORM YOPISH
function closeProductForm() {
    $("productModal").classList.remove("show");
}

// RASM PREVIEW
$("pImage").addEventListener("change", () => {
    const file = $("pImage").files[0];

    if (!file) return;

    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        $("formError").textContent = "JPG, PNG yoki WEBP rasm tanlang.";
        $("pImage").value = "";
        return;
    }

    if (file.size > 5 * 1024 * 1024) {
        $("formError").textContent = "Rasm 5 MB dan oshmasin.";
        $("pImage").value = "";
        return;
    }

    $("formError").textContent = "";

    $("imagePreview").src = URL.createObjectURL(file);
    $("imagePreview").classList.remove("hidden");
});

// TAHRIRLASH
function editProduct(id) {
    const product = adminProducts.find(p => String(p.id) === String(id));

    if (!product) return;

    $("editId").value = product.id;
    $("pName").value = product.name;
    $("pBrand").value = product.brand;
    $("pModel").value = product.model;
    $("pType").value = product.type;
    $("pPrice").value = product.price;
    $("pOldPrice").value = product.oldPrice || 0;
    $("pStock").value = product.stock;
    $("pDescription").value = product.description || "";

    $("pImage").value = "";

    $("imagePreview").src = product.image;
    $("imagePreview").classList.remove("hidden");

    $("formTitle").textContent = "Displeyni tahrirlash";
    $("saveProductBtn").textContent = "O‘zgarishlarni saqlash";

    $("formError").textContent = "";
    $("productModal").classList.add("show");
}

// SAQLASH
$("productForm").addEventListener("submit", async event => {
    event.preventDefault();

    const id = $("editId").value;
    const image = $("pImage").files[0];

    if (!id && !image) {
        $("formError").textContent = "Yangi mahsulot uchun rasm yuklang.";
        return;
    }

    const formData = new FormData();

    formData.append("name", $("pName").value.trim());
    formData.append("brand", $("pBrand").value.trim());
    formData.append("model", $("pModel").value.trim());
    formData.append("type", $("pType").value);
    formData.append("price", $("pPrice").value);
    formData.append("oldPrice", $("pOldPrice").value || "0");
    formData.append("stock", $("pStock").value);
    formData.append("description", $("pDescription").value);

    if (image) formData.append("image", image);

    const button = $("saveProductBtn");

    button.disabled = true;
    button.textContent = "Saqlanmoqda...";

    $("formError").textContent = "";

    try {
        await api(
            id
                ? `/api/admin/products/${id}`
                : "/api/admin/products",
            {
                method: id ? "PUT" : "POST",
                body: formData
            }
        );

        closeProductForm();
        await loadAll();

        toast(id ? "Displey yangilandi!" : "Yangi displey qo‘shildi!");

    } catch (error) {
        $("formError").textContent = error.message;
    } finally {
        button.disabled = false;
        button.textContent = id
            ? "O‘zgarishlarni saqlash"
            : "Mahsulotni saqlash";
    }
});

// O‘CHIRISH
async function deleteProduct(id) {
    const product = adminProducts.find(p => String(p.id) === String(id));

    if (!product) return;

    if (!confirm(`"${product.name}" displeyini o‘chirmoqchimisiz?`)) {
        return;
    }

    try {
        await api(`/api/admin/products/${id}`, {
            method: "DELETE"
        });

        await loadAll();
        toast("Displey o‘chirildi!");

    } catch (error) {
        toast(error.message);
    }
}

// BUYURTMALAR
async function loadOrders() {
    try {
        adminOrders = await api("/api/admin/orders");
        renderOrders();
        renderDashboard();
    } catch (error) {
        toast(error.message);
    }
}

function renderOrders() {
    const container = $("adminOrders");

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

    container.innerHTML = adminOrders.map(order => `
        <div class="order-card">

            <div class="order-top">
                <h3>Buyurtma #${escapeHTML(order.id)}</h3>
                <strong>${money(order.total)}</strong>
            </div>

            <p>👤 ${escapeHTML(order.customerName)}</p>
            <p>📞 ${escapeHTML(order.phone)}</p>
            <p>🆔 Telegram ID: ${escapeHTML(order.userId)}</p>

            <p>📅 ${escapeHTML(
                new Date(order.createdAt).toLocaleString("uz-UZ")
            )}</p>

            <p><b>Mahsulotlar:</b></p>

            ${order.items.map(item => `
                <p>
                    ${escapeHTML(item.name)}
                    (${escapeHTML(item.type)})
                    — ${item.qty} dona
                </p>
            `).join("")}

            <p>📝 ${escapeHTML(order.note || "Izoh yo‘q")}</p>

            <label>Buyurtma holati:</label>

            <select
                onchange="changeOrderStatus('${escapeHTML(order.id)}', this.value)"
            >
                ${statuses.map(status => `
                    <option
                        value="${status}"
                        ${order.status === status ? "selected" : ""}
                    >
                        ${status}
                    </option>
                `).join("")}
            </select>

        </div>
    `).join("");
}

// BUYURTMA HOLATINI O‘ZGARTIRISH
async function changeOrderStatus(id, status) {
    try {
        await api(`/api/admin/orders/${encodeURIComponent(id)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status })
        });

        await loadOrders();
        toast("Buyurtma holati yangilandi!");

    } catch (error) {
        toast(error.message);
        await loadOrders();
    }
}

// BOSHLASH
checkAdmin();
