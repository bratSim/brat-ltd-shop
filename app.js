/* =====================================================
   BRAT LTD. — KANTOBAY MARKETPLACE
   Supabase application
===================================================== */

const supabaseClient = window.supabase.createClient(
  window.SUPABASE_URL,
  window.SUPABASE_KEY
);

/* =====================================================
   GLOBAL STATE
===================================================== */

let products = [];
let catalogCache = [];
let category = "All";
let cart = JSON.parse(localStorage.getItem("bratCart") || "{}");

let currentSession = null;
let isAdmin = false;
let requests = [];
let currentRequestFilter = "all";
let editingProductId = null;

const $ = (id) => document.getElementById(id);

const CATEGORIES = [
  "Blocks",
  "Items",
  "Armor & Weapons",
  "Enchantments",
  "Services"
];

/* =====================================================
   HELPERS
===================================================== */

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function money(value) {
  return `${Number(value || 0).toFixed(2)} KB$`;
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function showToast(message, type = "success") {
  let container = $("toast-container");

  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;

  container.appendChild(toast);

  setTimeout(() => toast.remove(), 3500);
}

function setText(id, value) {
  const element = $(id);
  if (element) element.textContent = value;
}

function safeImageUrl(value) {
  if (!value) return "";

  try {
    const url = new URL(value, window.location.origin);

    if (!["http:", "https:"].includes(url.protocol)) {
      return "";
    }

    return url.href;
  } catch {
    return "";
  }
}

function getTextureName(name) {
  const map = {
    "Stone": "stone",
    "Cobblestone": "cobblestone",
    "Dirt": "dirt",
    "Oak Log": "oak_log",
    "Oak Planks": "oak_planks",
    "Oak Wood": "oak_wood",
    "Diamond": "diamond",
    "Emerald": "emerald",
    "Gold Ingot": "gold_ingot",
    "Iron Ingot": "iron_ingot",
    "Coal": "coal",
    "Obsidian": "obsidian",
    "Netherite Ingot": "netherite_ingot",
    "Golden Apple": "golden_apple",
    "Apple": "apple",
    "Bread": "bread",
    "Cooked Beef": "cooked_beef",
    "Ender Pearl": "ender_pearl",
    "Totem of Undying": "totem_of_undying",
    "Diamond Sword": "diamond_sword",
    "Diamond Pickaxe": "diamond_pickaxe",
    "Iron Sword": "iron_sword",
    "Netherite Sword": "netherite_sword",
    "Bow": "bow",
    "Crossbow": "crossbow",
    "Shield": "shield",
    "Diamond Helmet": "diamond_helmet",
    "Diamond Chestplate": "diamond_chestplate",
    "Diamond Leggings": "diamond_leggings",
    "Diamond Boots": "diamond_boots",
    "Netherite Helmet": "netherite_helmet",
    "Netherite Chestplate": "netherite_chestplate",
    "Netherite Leggings": "netherite_leggings",
    "Netherite Boots": "netherite_boots",
    "Enchanted Book": "enchanted_book"
  };

  return map[name] || name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .trim()
    .replace(/\s+/g, "_");
}

function productImage(product) {
  if (product.image_url) {
    return safeImageUrl(product.image_url);
  }

  const texture = getTextureName(product.name);

  return `https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.21.4/assets/minecraft/textures/item/${texture}.png`;
}

function imageMarkup(product) {
  const image = productImage(product);

  if (!image) {
    return `<div class="product-image-placeholder">▦</div>`;
  }

  return `
    <img
      class="product-image"
      src="${escapeHTML(image)}"
      alt="${escapeHTML(product.name)}"
      loading="lazy"
      onerror="this.style.display='none'"
    >
  `;
}

function getDiscountPercent(product) {
  return Math.max(0, Number(product.discount_percent || 0));
}

function getSalePrice(product) {
  const price = Number(product.price || 0);
  const discount = getDiscountPercent(product);

  return roundMoney(price * (1 - discount / 100));
}

function getStackSize(product) {
  return Math.max(1, Number(product.stack_size || 64));
}

function isService(product) {
  return product.category === "Services";
}

function getProductById(id) {
  return products.find((product) => String(product.id) === String(id))
    || catalogCache.find((product) => String(product.id) === String(id));
}

/* =====================================================
   LOAD PRODUCTS
===================================================== */

async function loadProducts() {
  const { data, error } = await supabaseClient
    .from("products")
    .select("*")
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (error) {
    console.error("Product loading error:", error);
    showToast("Could not load products. Check the Supabase connection.", "error");
    products = [];
  } else {
    products = data || [];
  }

  renderOffers();
  renderProducts();
  renderCart();
}

async function loadCatalogProducts() {
  if (!isAdmin) return;

  const container = $("catalog-products");

  if (container) {
    container.innerHTML = `<div class="loading-state">Loading catalogue...</div>`;
  }

  const { data, error } = await supabaseClient
    .from("products")
    .select("*")
    .order("name", { ascending: true });

  if (error) {
    console.error("Catalogue loading error:", error);

    if (container) {
      container.innerHTML = `<p class="error-message">Could not load catalogue.</p>`;
    }

    return;
  }

  catalogCache = data || [];
  renderCatalogProducts();
}

/* =====================================================
   CATEGORY NAVIGATION
===================================================== */

function showCategory(nextCategory = "All") {
  category = nextCategory;

  const offers = $("offers");
  const shop = $("shop");
  const admin = $("admin-section");

  if (offers) offers.style.display = nextCategory === "All" ? "" : "none";
  if (shop) shop.style.display = nextCategory === "All" ? "none" : "";
  if (admin) admin.style.display = "none";

  document.querySelectorAll(".nav-link").forEach((link) => {
    link.classList.toggle(
      "active",
      link.dataset.category === nextCategory
    );
  });

  const titles = {
    "All": "All Products",
    "Blocks": "Blocks",
    "Items": "Items",
    "Armor & Weapons": "Armor & Weapons",
    "Enchantments": "Enchantments",
    "Services": "Services"
  };

  const descriptions = {
    "All": "Browse available products.",
    "Blocks": "Building blocks and materials for your projects.",
    "Items": "Useful items and resources.",
    "Armor & Weapons": "Equipment for your adventures.",
    "Enchantments": "Enchantments and enchanted equipment.",
    "Services": "Services offered by Brat Ltd."
  };

  setText("category-title", titles[nextCategory] || nextCategory);
  setText("category-description", descriptions[nextCategory] || "");

  renderProducts();
}

document.querySelectorAll(".nav-link").forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    showCategory(link.dataset.category || "All");
  });
});

if ($("admin-close")) {
  $("admin-close").addEventListener("click", () => showCategory("All"));
}

/* =====================================================
   OFFERS
===================================================== */

function renderOffers() {
  const container = $("offers-grid");
  const empty = $("empty-offers");

  if (!container) return;

  const offers = products.filter((product) =>
    Number(product.discount_percent || 0) > 0
  );

  if (!offers.length) {
    container.innerHTML = "";
    if (empty) empty.style.display = "";
    return;
  }

  if (empty) empty.style.display = "none";

  container.innerHTML = offers.slice(0, 8).map((product) => `
    <article class="product-card offer-card">
      <div class="product-card-image">
        ${imageMarkup(product)}
      </div>

      <div class="product-card-content">
        <span class="product-category">${escapeHTML(product.category)}</span>
        <h3>${escapeHTML(product.name)}</h3>
        <p class="product-description">${escapeHTML(product.description || "")}</p>

        <div class="product-price">
          <strong>${money(getSalePrice(product))}</strong>
          <del>${money(product.price)}</del>
        </div>

        <button
          class="primary-button full-width"
          data-add-cart="${escapeHTML(product.id)}"
          type="button"
        >
          Add to cart
        </button>
      </div>
    </article>
  `).join("");
}

/* =====================================================
   PRODUCT LIST
===================================================== */

function renderProducts() {
  const container = $("products");
  const empty = $("empty-products");

  if (!container) return;

  const search = ($("search")?.value || "").toLowerCase().trim();

  let visible = products.filter((product) => {
    const categoryMatch =
      category === "All" || product.category === category;

    const searchMatch =
      !search ||
      product.name?.toLowerCase().includes(search) ||
      product.description?.toLowerCase().includes(search);

    return categoryMatch && searchMatch;
  });

  if (!visible.length) {
    container.innerHTML = "";
    if (empty) empty.style.display = "";
    return;
  }

  if (empty) empty.style.display = "none";

  container.innerHTML = visible.map((product) => `
    <article class="product-card">
      <div class="product-card-image">
        ${imageMarkup(product)}
      </div>

      <div class="product-card-content">
        <span class="product-category">${escapeHTML(product.category)}</span>
        <h3>${escapeHTML(product.name)}</h3>
        <p class="product-description">${escapeHTML(product.description || "")}</p>

        <div class="product-price">
          <strong>${money(getSalePrice(product))}</strong>
          ${
            Number(product.discount_percent || 0) > 0
              ? `<del>${money(product.price)}</del>`
              : ""
          }
        </div>

        <p class="product-stack">
          Stack size: ${getStackSize(product)}
        </p>

        <button
          class="primary-button full-width"
          data-add-cart="${escapeHTML(product.id)}"
          type="button"
        >
          Add to cart
        </button>
      </div>
    </article>
  `).join("");
}

if ($("search")) {
  $("search").addEventListener("input", () => {
    renderProducts();
    renderOffers();
  });
}

/* =====================================================
   PRODUCT BUTTON EVENTS
===================================================== */

document.addEventListener("click", (event) => {
  const addButton = event.target.closest("[data-add-cart]");

  if (addButton) {
    addToCart(addButton.dataset.addCart);
  }

  const editButton = event.target.closest("[data-edit-product]");

  if (editButton && isAdmin) {
    openProductEditor(editButton.dataset.editProduct);
  }

  const deleteButton = event.target.closest("[data-delete-product]");

  if (deleteButton && isAdmin) {
    deleteProduct(deleteButton.dataset.deleteProduct);
  }

  const quantityButton = event.target.closest("[data-cart-quantity]");

  if (quantityButton) {
    changeQuantity(
      quantityButton.dataset.cartQuantity,
      Number(quantityButton.dataset.change)
    );
  }

  const removeButton = event.target.closest("[data-remove-cart]");

  if (removeButton) {
    removeFromCart(removeButton.dataset.removeCart);
  }
});

/* =====================================================
   CART
===================================================== */

function saveCart() {
  localStorage.setItem("bratCart", JSON.stringify(cart));
  renderCart();
}

function addToCart(id) {
  const product = getProductById(id);

  if (!product || !product.is_active) {
    showToast("This product is currently unavailable.", "error");
    return;
  }

  if (!cart[id]) {
    cart[id] = {
      id: product.id,
      name: product.name,
      price: getSalePrice(product),
      quantity: 0,
      stack_size: getStackSize(product),
      category: product.category
    };
  }

  cart[id].quantity += 1;
  cart[id].price = getSalePrice(product);

  saveCart();
  showToast(`${product.name} added to cart.`);
}

function changeQuantity(id, amount) {
  if (!cart[id]) return;

  cart[id].quantity += amount;

  if (cart[id].quantity <= 0) {
    delete cart[id];
  }

  saveCart();
}

function removeFromCart(id) {
  delete cart[id];
  saveCart();
}

function getCartTotal() {
  return roundMoney(
    Object.values(cart).reduce(
      (sum, item) => sum + Number(item.price) * Number(item.quantity),
      0
    )
  );
}

function renderCart() {
  const container = $("cart-items");
  const total = $("cart-total");
  const count = $("cart-count");

  const items = Object.values(cart);
  const quantity = items.reduce((sum, item) => sum + item.quantity, 0);

  if (count) count.textContent = quantity;

  if (total) total.textContent = money(getCartTotal());

  if (!container) return;

  if (!items.length) {
    container.innerHTML = `
      <div class="empty-cart">
        <div class="empty-icon">🛒</div>
        <p>Your cart is empty.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = items.map((item) => `
    <div class="cart-item">
      <div class="cart-item-info">
        <strong>${escapeHTML(item.name)}</strong>
        <span>${money(item.price)} each</span>
      </div>

      <div class="cart-item-controls">
        <button
          type="button"
          data-cart-quantity="${escapeHTML(item.id)}"
          data-change="-1"
        >−</button>

        <span>${item.quantity}</span>

        <button
          type="button"
          data-cart-quantity="${escapeHTML(item.id)}"
          data-change="1"
        >+</button>

        <button
          type="button"
          data-remove-cart="${escapeHTML(item.id)}"
        >×</button>
      </div>
    </div>
  `).join("");
}

/* =====================================================
   CART PANEL
===================================================== */

function openCart() {
  $("cart-panel")?.classList.add("open");
  $("cart-overlay")?.classList.add("open");
}

function closeCart() {
  $("cart-panel")?.classList.remove("open");
  $("cart-overlay")?.classList.remove("open");
}

$("cart-button")?.addEventListener("click", openCart);
$("cart-close")?.addEventListener("click", closeCart);
$("cart-overlay")?.addEventListener("click", closeCart);

/* =====================================================
   CHECKOUT
===================================================== */

function openCheckout() {
  if (!Object.keys(cart).length) {
    showToast("Your cart is empty.", "error");
    return;
  }

  if (!currentSession) {
    showToast("Please sign in before placing an order.", "error");
    closeCart();
    openLogin();
    return;
  }

  const summary = $("checkout-summary");

  if (summary) {
    summary.innerHTML = `
      ${Object.values(cart).map((item) => `
        <div class="checkout-summary-row">
          <span>${escapeHTML(item.name)} × ${item.quantity}</span>
          <strong>${money(item.price * item.quantity)}</strong>
        </div>
      `).join("")}
      <div class="checkout-summary-row checkout-total-row">
        <span>Total</span>
        <strong>${money(getCartTotal())}</strong>
      </div>
    `;
  }

  closeCart();
  $("checkout-modal")?.classList.add("show");
}

function closeCheckout() {
  $("checkout-modal")?.classList.remove("show");
}

$("checkout-button")?.addEventListener("click", openCheckout);
$("checkout-close")?.addEventListener("click", closeCheckout);

$("checkout-modal")?.addEventListener("click", (event) => {
  if (event.target === $("checkout-modal")) closeCheckout();
});

$("checkout-form")?.addEventListener("submit", placeOrder);

async function placeOrder(event) {
  event.preventDefault();

  if (!currentSession) {
    showToast("Please sign in first.", "error");
    return;
  }

  const minecraftName = $("checkout-minecraft-name")?.value.trim();
  const district = $("checkout-district")?.value;
  const address = $("checkout-address")?.value.trim();
  const note = $("checkout-note")?.value.trim();

  if (!minecraftName || !district || !address) {
    showToast("Please complete all required fields.", "error");
    return;
  }

  const items = Object.values(cart).map((item) => ({
    id: item.id,
    name: item.name,
    quantity: item.quantity,
    unit_price: item.price,
    total: roundMoney(item.price * item.quantity)
  }));

  const total = getCartTotal();
  const button = $("place-order-button");

  if (button) {
    button.disabled = true;
    button.textContent = "Processing...";
  }

  const { error } = await supabaseClient
    .from("orders")
    .insert({
      request_type: "product",
      items,
      description: "Marketplace order",
      links: [],
      image_urls: [],
      desired_price: total,
      subtotal: total,
      discount_amount: 0,
      total,
      status: "pending",
      minecraft_name: minecraftName,
      note,
      user_id: currentSession.user.id,
      delivery_district: district,
      delivery_address: address
    });

  if (button) {
    button.disabled = false;
    button.textContent = "Place order →";
  }

  if (error) {
    console.error("Order error:", error);
    showToast("Order could not be submitted. Please try again.", "error");
    return;
  }

  cart = {};
  saveCart();
  closeCheckout();

  $("checkout-form")?.reset();

  showToast("Your order has been submitted successfully.");
}

/* =====================================================
   LOGIN / LOGOUT
===================================================== */

function openLogin() {
  $("login-modal")?.classList.add("show");
}

function closeLogin() {
  $("login-modal")?.classList.remove("show");
}

$("login-button")?.addEventListener("click", openLogin);
$("login-close")?.addEventListener("click", closeLogin);

$("login-modal")?.addEventListener("click", (event) => {
  if (event.target === $("login-modal")) closeLogin();
});

$("login-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = $("login-email")?.value.trim();
  const password = $("login-password")?.value;
  const message = $("login-message");

  if (message) message.textContent = "Signing in...";

  const { error } = await supabaseClient.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    if (message) message.textContent = error.message;
    return;
  }

  if (message) message.textContent = "";

  closeLogin();
  $("login-form")?.reset();

  showToast("You are now signed in.");
});

$("logout-button")?.addEventListener("click", async () => {
  await supabaseClient.auth.signOut();
  showToast("You have been signed out.");
});

async function updateAuthUI(session) {
  currentSession = session;

  const loggedIn = Boolean(session);

  if ($("login-button")) $("login-button").hidden = loggedIn;
  if ($("account-button")) $("account-button").hidden = !loggedIn;
  if ($("logout-button")) $("logout-button").hidden = !loggedIn;

  setText(
    "user-label",
    loggedIn ? (session.user.email || "Account") : ""
  );

  isAdmin = false;

  if (loggedIn) {
    await checkAdminRole();
  } else {
    $("admin-button") && ($("admin-button").hidden = true);
    $("admin-section") && ($("admin-section").style.display = "none");
  }
}

async function checkAdminRole() {
  if (!currentSession) return;

  const { data, error } = await supabaseClient
    .from("profiles")
    .select("role")
    .eq("id", currentSession.user.id)
    .maybeSingle();

  if (error) {
    console.error("Role check error:", error);
    return;
  }

  isAdmin = ["admin", "editor"].includes(data?.role);

  if ($("admin-button")) {
    $("admin-button").hidden = !isAdmin;
  }

  if (isAdmin) {
    await loadRequests();
    await loadCatalogProducts();
  }
}

supabaseClient.auth.onAuthStateChange((_event, session) => {
  setTimeout(() => updateAuthUI(session), 0);
});

/* =====================================================
   ADMIN DASHBOARD
===================================================== */

function openAdmin() {
  if (!isAdmin) {
    showToast("You do not have permission to access this area.", "error");
    return;
  }

  if ($("offers")) $("offers").style.display = "none";
  if ($("shop")) $("shop").style.display = "none";
  if ($("admin-section")) $("admin-section").style.display = "";

  loadRequests();
  loadCatalogProducts();
}

$("admin-button")?.addEventListener("click", openAdmin);

$("refresh-requests")?.addEventListener("click", async () => {
  await loadRequests();
  await loadCatalogProducts();
  showToast("Dashboard refreshed.");
});

async function loadRequests() {
  if (!isAdmin) return;

  const container = $("admin-requests");

  if (container) {
    container.innerHTML = `<div class="loading-state">Loading orders...</div>`;
  }

  const { data, error } = await supabaseClient
    .from("orders")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Orders loading error:", error);

    if (container) {
      container.innerHTML = `<p class="error-message">Could not load orders.</p>`;
    }

    return;
  }

  requests = data || [];

  renderAdminStats();
  renderRequests();
}

function renderAdminStats() {
  const total = requests.length;
  const pending = requests.filter((r) => r.status === "pending").length;
  const completed = requests.filter((r) => r.status === "completed").length;

  const revenue = requests
    .filter((r) => r.status === "completed")
    .reduce((sum, r) => sum + Number(r.total || 0), 0);

  setText("admin-total-orders", total);
  setText("admin-pending-orders", pending);
  setText("admin-completed-orders", completed);
  setText("admin-revenue", money(revenue));
}

document.querySelectorAll("[data-request-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    currentRequestFilter = button.dataset.requestFilter;

    document.querySelectorAll("[data-request-filter]").forEach((item) => {
      item.classList.toggle("active", item === button);
    });

    renderRequests();
  });
});

function renderRequests() {
  const container = $("admin-requests");
  if (!container) return;

  let visible = requests;

  if (currentRequestFilter !== "all") {
    visible = requests.filter(
      (request) => request.status === currentRequestFilter
    );
  }

  if (!visible.length) {
    container.innerHTML = `<div class="empty-state"><h3>No orders found</h3></div>`;
    return;
  }

  container.innerHTML = visible.map((request) => {
    const items = Array.isArray(request.items) ? request.items : [];

    return `
      <article class="admin-request-card">
        <div class="admin-request-header">
          <div>
            <strong>Order #${escapeHTML(String(request.id).slice(0, 8))}</strong>
            <p>${escapeHTML(request.minecraft_name || "Unknown player")}</p>
          </div>

          <select
            class="request-status-select"
            data-order-status="${escapeHTML(request.id)}"
          >
            ${["pending", "processing", "completed", "cancelled"].map((status) => `
              <option value="${status}" ${request.status === status ? "selected" : ""}>
                ${status}
              </option>
            `).join("")}
          </select>
        </div>

        <div class="admin-request-details">
          <p><strong>Type:</strong> ${escapeHTML(request.request_type || "Order")}</p>
          <p><strong>Total:</strong> ${money(request.total)}</p>
          <p><strong>District:</strong> ${escapeHTML(request.delivery_district || "—")}</p>
          <p><strong>Address:</strong> ${escapeHTML(request.delivery_address || "—")}</p>
          <p><strong>Note:</strong> ${escapeHTML(request.note || "—")}</p>
        </div>

        <div class="admin-order-items">
          ${items.map((item) => `
            <div>${escapeHTML(item.name || "Item")} × ${Number(item.quantity || 1)}</div>
          `).join("")}
        </div>
      </article>
    `;
  }).join("");
}

document.addEventListener("change", async (event) => {
  const select = event.target.closest("[data-order-status]");

  if (select && isAdmin) {
    await updateRequestStatus(select.dataset.orderStatus, select.value);
  }
});

async function updateRequestStatus(id, status) {
  const allowed = ["pending", "processing", "completed", "cancelled"];

  if (!isAdmin || !allowed.includes(status)) return;

  const { error } = await supabaseClient
    .from("orders")
    .update({ status })
    .eq("id", id);

  if (error) {
    console.error("Status update error:", error);
    showToast("Could not update order status.", "error");
    return;
  }

  showToast("Order status updated.");
  await loadRequests();
}

/* =====================================================
   PRODUCT CATALOGUE ADMIN
===================================================== */

function renderCatalogProducts() {
  const container = $("catalog-products");
  if (!container) return;

  const search = ($("catalog-search")?.value || "").toLowerCase().trim();

  const visible = catalogCache.filter((product) =>
    !search ||
    product.name?.toLowerCase().includes(search) ||
    product.category?.toLowerCase().includes(search)
  );

  if (!visible.length) {
    container.innerHTML = `<div class="empty-state"><p>No products found.</p></div>`;
    return;
  }

  container.innerHTML = `
    <div class="catalog-table-wrap">
      <table class="catalog-table">
        <thead>
          <tr>
            <th>Product</th>
            <th>Category</th>
            <th>Price</th>
            <th>Stack</th>
            <th>Discount</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>

        <tbody>
          ${visible.map((product) => `
            <tr>
              <td>${escapeHTML(product.name)}</td>
              <td>${escapeHTML(product.category)}</td>
              <td>${money(product.price)}</td>
              <td>${getStackSize(product)}</td>
              <td>${Number(product.discount_percent || 0)}%</td>
              <td>${product.is_active ? "Active" : "Inactive"}</td>
              <td>
                <div class="product-admin-actions">
                  <button
                    type="button"
                    class="secondary-button"
                    data-edit-product="${escapeHTML(product.id)}"
                  >Edit</button>

                  <button
                    type="button"
                    class="product-delete-button"
                    data-delete-product="${escapeHTML(product.id)}"
                  >Delete</button>
                </div>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

$("catalog-search")?.addEventListener("input", renderCatalogProducts);

/* =====================================================
   ADD PRODUCT
===================================================== */

$("catalog-add-button")?.addEventListener("click", () => {
  if (!isAdmin) return;

  editingProductId = null;
  openProductEditor(null);
});

/* =====================================================
   PRODUCT EDITOR
===================================================== */

function openProductEditor(productOrId) {
  if (!isAdmin) return;

  const product = typeof productOrId === "object"
    ? productOrId
    : getProductById(productOrId);

  editingProductId = product?.id || null;

  $("product-editor-modal")?.remove();

  const modal = document.createElement("div");
  modal.id = "product-editor-modal";
  modal.className = "modal-backdrop show";

  modal.innerHTML = `
    <div class="modal product-editor-modal">
      <button class="modal-close" type="button" id="product-editor-close">×</button>

      <div class="modal-eyebrow">PRODUCT MANAGEMENT</div>
      <h2>${product ? "Edit product" : "Add product"}</h2>

      <form id="product-editor-form">
        <label for="edit-product-name">Product name</label>
        <input id="edit-product-name" required maxlength="100"
          value="${escapeHTML(product?.name || "")}">

        <label for="edit-product-category">Category</label>
        <select id="edit-product-category" required>
          ${CATEGORIES.map((name) => `
            <option value="${escapeHTML(name)}"
              ${product?.category === name ? "selected" : ""}>
              ${escapeHTML(name)}
            </option>
          `).join("")}
        </select>

        <label for="edit-product-description">Description</label>
        <textarea id="edit-product-description" rows="3">${escapeHTML(product?.description || "")}</textarea>

        <label for="edit-product-price">Price (KB$)</label>
        <input id="edit-product-price" type="number" min="0" step="0.01"
          value="${Number(product?.price || 0)}" required>

        <label for="edit-product-stack">Stack size</label>
        <input id="edit-product-stack" type="number" min="1" max="999"
          value="${getStackSize(product || {})}" required>

        <label for="edit-product-discount">Discount (%)</label>
        <input id="edit-product-discount" type="number" min="0" max="100"
          value="${Number(product?.discount_percent || 0)}">

        <label for="edit-product-image">Image URL (optional)</label>
        <input id="edit-product-image" type="url"
          value="${escapeHTML(product?.image_url || "")}"
          placeholder="https://...">

        <label class="checkbox-label">
          <input id="edit-product-active" type="checkbox"
            ${product?.is_active ? "checked" : ""}>
          Product is active and visible in the shop
        </label>

        <p id="product-editor-message" class="form-message"></p>

        <button class="primary-button full-width" type="submit">
          Save product
        </button>
      </form>
    </div>
  `;

  document.body.appendChild(modal);

  $("product-editor-close").addEventListener("click", () => modal.remove());

  modal.addEventListener("click", (event) => {
    if (event.target === modal) modal.remove();
  });

  $("product-editor-form").addEventListener("submit", saveProduct);
}

async function saveProduct(event) {
  event.preventDefault();

  if (!isAdmin) return;

  const name = $("edit-product-name").value.trim();
  const category = $("edit-product-category").value;
  const description = $("edit-product-description").value.trim();
  const price = Number($("edit-product-price").value);
  const stackSize = Number($("edit-product-stack").value);
  const discount = Number($("edit-product-discount").value);
  const imageUrl = $("edit-product-image").value.trim();
  const active = $("edit-product-active").checked;

  const message = $("product-editor-message");

  if (!name || !CATEGORIES.includes(category)) {
    if (message) message.textContent = "Please enter a valid name and category.";
    return;
  }

  if (
    !Number.isFinite(price) || price < 0 ||
    !Number.isInteger(stackSize) || stackSize < 1 ||
    !Number.isFinite(discount) || discount < 0 || discount > 100
  ) {
    if (message) message.textContent = "Please check price, stack size and discount.";
    return;
  }

  const payload = {
    name,
    category,
    description,
    price,
    stack_size: stackSize,
    discount_percent: discount,
    image_url: imageUrl || null,
    is_active: active
  };

  let result;

  if (editingProductId) {
    result = await supabaseClient
      .from("products")
      .update(payload)
      .eq("id", editingProductId);
  } else {
    result = await supabaseClient
      .from("products")
      .insert(payload);
  }

  if (result.error) {
    console.error("Product save error:", result.error);

    if (message) {
      message.textContent = result.error.message;
    }

    return;
  }

  $("product-editor-modal")?.remove();

  showToast(editingProductId ? "Product updated." : "Product created.");

  editingProductId = null;

  await loadProducts();
  await loadCatalogProducts();
}

/* =====================================================
   DELETE PRODUCT
===================================================== */

async function deleteProduct(id) {
  if (!isAdmin) {
    showToast("You do not have permission to delete products.", "error");
    return;
  }

  const product = catalogCache.find(
    (item) => String(item.id) === String(id)
  );

  if (!product) {
    showToast("Product not found.", "error");
    return;
  }

  const confirmed = window.confirm(
    `Are you sure you want to permanently delete "${product.name}"?\n\nThis action cannot be undone.`
  );

  if (!confirmed) return;

  const { error } = await supabaseClient
    .from("products")
    .delete()
    .eq("id", id);

  if (error) {
    console.error("Product deletion error:", error);
    showToast(`Could not delete product: ${error.message}`, "error");
    return;
  }

  delete cart[id];
  saveCart();

  showToast(`"${product.name}" was deleted.`);

  await loadProducts();
  await loadCatalogProducts();
}

/* =====================================================
   CATALOGUE IMPORT
===================================================== */

$("catalog-import-file")?.addEventListener("change", importCatalogFile);

async function importCatalogFile(event) {
  if (!isAdmin) return;

  const file = event.target.files?.[0];
  if (!file) return;

  try {
    const content = await file.text();
    let rows = [];

    if (file.name.toLowerCase().endsWith(".json")) {
      rows = JSON.parse(content);

      if (!Array.isArray(rows)) {
        throw new Error("JSON file must contain an array of products.");
      }
    } else {
      const lines = content.split(/\r?\n/).filter(Boolean);
      const headers = lines.shift().split(",").map((v) => v.trim());

      rows = lines.map((line) => {
        const values = line.split(",");
        return Object.fromEntries(
          headers.map((header, index) => [
            header,
            (values[index] || "").trim()
          ])
        );
      });
    }

    const existingNames = new Set(
      catalogCache.map((p) => p.name.toLowerCase())
    );

    const newProducts = rows
      .filter((p) => p.name && !existingNames.has(String(p.name).toLowerCase()))
      .map((p) => ({
        name: String(p.name),
        category: CATEGORIES.includes(p.category) ? p.category : "Items",
        description: String(p.description || ""),
        price: Number(p.price || 0),
        stack_size: Number(p.stack_size || 64),
        discount_percent: Number(p.discount_percent || 0),
        is_active: p.is_active === true || p.is_active === "true"
      }));

    if (!newProducts.length) {
      showToast("No new products to import.");
      return;
    }

    const { error } = await supabaseClient
      .from("products")
      .insert(newProducts);

    if (error) throw error;

    showToast(`${newProducts.length} products imported.`);
    await loadProducts();
    await loadCatalogProducts();

  } catch (error) {
    console.error("Import error:", error);
    showToast(`Import failed: ${error.message}`, "error");
  } finally {
    event.target.value = "";
  }
}

/* =====================================================
   INITIALIZATION
===================================================== */

async function initializeShop() {
  const { data, error } = await supabaseClient.auth.getSession();

  if (error) {
    console.error("Session error:", error);
  }

  await updateAuthUI(data?.session || null);

  await loadProducts();
  renderCart();
  showCategory("All");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeShop);
} else {
  initializeShop();
}
