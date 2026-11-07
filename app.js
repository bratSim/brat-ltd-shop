
const supabaseClient = window.supabase.createClient(
  window.SUPABASE_URL,
  window.SUPABASE_KEY
);

let products = [];
let category = "All";
let cart = JSON.parse(localStorage.getItem("bratCart") || "{}");
let currentSession = null;
let isAdmin = false;
let requests = [];
let currentRequestFilter = "all";
let editingProductId = null;
let serviceImages = [];

/* =========================================
   HELPERS
========================================= */

const $ = id => document.getElementById(id);

const escapeHTML = value =>
  String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);

const roundMoney = value =>
  Math.ceil((Number(value) + Number.EPSILON) * 100) / 100;

const money = value =>
  `${Number(value || 0).toFixed(2)} KB$`;

const checkoutMoney = value =>
  money(roundMoney(value));

const setText = (id, value) => {
  const element = $(id);
  if (element) element.textContent = value;
};

const formatDate = value => {
  if (!value) return "Not specified";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GB");
};

const formatDateOnly = value => {
  if (!value) return "Not specified";
  const parts = String(value).split("-");
  if (parts.length !== 3) return escapeHTML(value);
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
};

const safeExternalUrl = value => {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
};

/* =========================================
   MINECRAFT TEXTURES
========================================= */

const textureAliases = {
  "Stone": "stone",
  "Oak Wood": "oak_planks",
  "Oak Planks": "oak_planks",
  "Diamond": "diamond",
  "Obsidian": "obsidian",
  "Gold Ingot": "gold_ingot",
  "Iron Ingot": "iron_ingot",
  "Golden Apple": "golden_apple",
  "Emerald": "emerald",
  "Coal": "coal",
  "Netherite Ingot": "netherite_ingot",
  "Iron Block": "iron_block",
  "Gold Block": "gold_block",
  "Diamond Block": "diamond_block",
  "Dirt": "dirt",
  "Cobblestone": "cobblestone",
  "Glass": "glass",
  "Sand": "sand",
  "Oak Log": "oak_log",
  "Ender Pearl": "ender_pearl"
};

function getTextureName(name) {
  const alias = textureAliases[name];
  if (alias) return alias;

  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .trim()
    .replace(/\s+/g, "_");
}

function productImage(product) {
  const texture = getTextureName(product.name);
  return `https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.21.4/assets/minecraft/textures/item/${texture}.png`;
}

function imageMarkup(product, className = "product-image") {
  return `
    <img
      class="${className}"
      src="${productImage(product)}"
      alt="${escapeHTML(product.name)}"
      onerror="this.style.display='none';this.nextElementSibling.style.display='flex';"
    >
    <div class="fallback-icon" style="display:none;">▦</div>
  `;
}

/* =========================================
   PRICES AND DISCOUNTS
========================================= */

function getManualDiscount(product) {
  return Math.max(0, Math.min(90, Number(product.discount_percent || 0)));
}

function getSalePrice(product) {
  return Number(product.price) * (1 - getManualDiscount(product) / 100);
}

function getDiscountPercent(quantity) {
  if (quantity >= 16) return 15;
  if (quantity >= 10) return 10;
  if (quantity >= 6) return 5;
  return 0;
}

function unitPrice(product) {
  return Number(product.price) / 64;
}

function stackText(product) {
  const size = Number(product.stack_size || 64);
  return `${size} items per stack`;
}

function getCartTotals() {
  let original = 0;
  let afterManual = 0;
  let afterQuantity = 0;

  for (const [id, quantity] of Object.entries(cart)) {
    const product = products.find(item => String(item.id) === String(id));
    if (!product) continue;

    const stacks = Number(quantity);
    const stackPrice = Number(product.price);
    const salePrice = getSalePrice(product);

    original += stackPrice * stacks;
    afterManual += salePrice * stacks;

    const quantityDiscount = getDiscountPercent(stacks);
    afterQuantity += salePrice * stacks * (1 - quantityDiscount / 100);
  }

  const manualSavings = original - afterManual;
  const quantitySavings = afterManual - afterQuantity;
  const savings = manualSavings + quantitySavings;

  return {
    original,
    afterManual,
    afterQuantity,
    manualSavings,
    quantitySavings,
    savings,
    total: afterQuantity,
    checkoutTotal: roundMoney(afterQuantity)
  };
}

/* =========================================
   PRODUCT LOADING
========================================= */

async function loadProducts() {
  const { data, error } = await supabaseClient
    .from("products")
    .select("*")
    .eq("is_active", true)
    .order("name");

  if (error) {
    console.error("Product loading error:", error);
    if ($("products")) $("products").innerHTML =
      `<p class="error-message">Could not load products: ${escapeHTML(error.message)}</p>`;
    if ($("offers-grid")) $("offers-grid").innerHTML =
      `<p class="error-message">Could not load offers.</p>`;
    return;
  }

  products = data || [];
  renderOffers();
  renderProducts();
  renderCart();
}

/* =========================================
   NAVIGATION
========================================= */

function showCategory(nextCategory) {
  category = nextCategory;

  document.querySelectorAll(".nav-link").forEach(link => {
    link.classList.toggle(
      "active",
      link.dataset.category === nextCategory
    );
  });

  if ($("offers")) $("offers").style.display =
    nextCategory === "All" ? "" : "none";

  if ($("shop")) $("shop").style.display =
    nextCategory === "All" ? "none" : "";

  if ($("admin-section")) $("admin-section").style.display = "none";

  const descriptions = {
    "Blocks": "Building materials and decorative blocks.",
    "Items": "Useful items and resources.",
    "Armor & Weapons": "Equipment for your adventures.",
    "Enchantments": "Enchantments and upgrades.",
    "Services": "Services and custom requests."
  };

  setText("category-title", nextCategory);
  setText("category-description", descriptions[nextCategory] || "Browse available products.");

  renderProducts();
}

document.querySelectorAll(".nav-link").forEach(link => {
  link.addEventListener("click", event => {
    event.preventDefault();
    showCategory(link.dataset.category);
  });
});

/* =========================================
   OFFERS
========================================= */

function renderOffers() {
  const container = $("offers-grid");
  if (!container) return;

  const offers = products.filter(product =>
    Number(product.discount_percent || 0) > 0
  );

  if (!offers.length) {
    container.innerHTML = "";
    if ($("empty-offers")) $("empty-offers").style.display = "";
    return;
  }

  if ($("empty-offers")) $("empty-offers").style.display = "none";

  container.innerHTML = offers.map(product => {
    const oldPrice = Number(product.price);
    const newPrice = getSalePrice(product);

    return `
      <article class="offer-card">
        <div class="offer-image">
          <span class="offer-badge">-${getManualDiscount(product)}%</span>
          ${imageMarkup(product, "offer-product-image")}
        </div>

        <div class="offer-copy">
          <div class="offer-kicker">${escapeHTML(product.category)}</div>
          <h3>${escapeHTML(product.name)}</h3>
          <p>${escapeHTML(product.description || "Available now at Brat Ltd.")}</p>

          <div class="offer-prices">
            <span class="old-price">${money(oldPrice)}</span>
            <span class="offer-price">${money(newPrice)}</span>
          </div>

          <button class="primary-button offer-add-button" data-add="${escapeHTML(product.id)}" type="button">
            Add to cart →
          </button>
        </div>
      </article>
    `;
  }).join("");

  container.querySelectorAll("[data-add]").forEach(button => {
    button.addEventListener("click", () => addToCart(button.dataset.add));
  });
}

/* =========================================
   PRODUCT DISPLAY
========================================= */

function productPriceMarkup(product) {
  const price = Number(product.price);
  const discount = getManualDiscount(product);

  if (discount > 0) {
    return `
      <span class="old-price">${money(price)}</span>
      <span class="price">${money(getSalePrice(product))}</span>
      <span class="product-discount-badge">-${discount}%</span>
    `;
  }

  return `<span class="price">${money(price)}</span>`;
}

function adminProductButton(product) {
  if (!isAdmin) return "";

  return `
    <button class="product-admin-menu" data-edit-product="${escapeHTML(product.id)}" type="button">
      ✎ Edit
    </button>
  `;
}

function renderProducts() {
  const container = $("products");
  if (!container) return;

  const search = ($("search")?.value || "").toLowerCase();

  const filtered = products.filter(product => {
    const matchesCategory = product.category === category;
    const matchesSearch =
      product.name.toLowerCase().includes(search) ||
      String(product.description || "").toLowerCase().includes(search);

    return matchesCategory && matchesSearch;
  });

  if (!filtered.length) {
    container.innerHTML = "";
    if ($("empty-products")) $("empty-products").style.display = "";
    return;
  }

  if ($("empty-products")) $("empty-products").style.display = "none";

  container.innerHTML = filtered.map(product => `
    <article class="product-card">
      <div class="product-visual">
        ${imageMarkup(product)}
        ${adminProductButton(product)}
      </div>

      <div class="product-info">
        <div class="product-tag">${escapeHTML(product.category)}</div>
        <h3>${escapeHTML(product.name)}</h3>
        <p class="product-description">${escapeHTML(product.description || "")}</p>

        <div class="price-row">
          ${productPriceMarkup(product)}
        </div>

        <div class="stack-info">${stackText(product)}</div>

        <button class="primary-button add-button" data-add="${escapeHTML(product.id)}" type="button">
          Add to cart
        </button>
      </div>
    </article>
  `).join("");

  container.querySelectorAll("[data-add]").forEach(button => {
    button.addEventListener("click", () => addToCart(button.dataset.add));
  });

  attachProductEditorButtons(container);
}

function attachProductEditorButtons(container = document) {
  container.querySelectorAll("[data-edit-product]").forEach(button => {
    button.addEventListener("click", () => {
      const product = products.find(item =>
        String(item.id) === String(button.dataset.editProduct)
      );

      if (product) openProductEditor(product);
    });
  });
}

/* =========================================
   PRODUCT EDITOR
========================================= */

function openProductEditor(product) {
  editingProductId = product.id;

  const existing = $("product-editor-modal");
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.id = "product-editor-modal";
  modal.className = "modal-backdrop show";

  modal.innerHTML = `
    <div class="modal product-editor-modal">
      <button class="modal-close" id="close-product-editor" type="button">×</button>
      <div class="modal-eyebrow">PRODUCT MANAGEMENT</div>
      <h2>Edit <span class="orange">product.</span></h2>

      <form id="product-editor-form">
        <label>Product name</label>
        <input value="${escapeHTML(product.name)}" disabled>

        <label>Price per stack (64 items)</label>
        <input id="edit-product-price" type="number" min="0" step="0.01" value="${Number(product.price)}" required>

        <label>Manual discount (%)</label>
        <input id="edit-product-discount" type="number" min="0" max="90" step="1" value="${getManualDiscount(product)}" required>

        <button class="primary-button full-width" type="submit">Save changes</button>
        <p id="product-editor-message" class="form-message"></p>
      </form>
    </div>
  `;

  document.body.appendChild(modal);

  $("close-product-editor").addEventListener("click", () => modal.remove());

  $("product-editor-form").addEventListener("submit", async event => {
    event.preventDefault();

    const price = Number($("edit-product-price").value);
    const discount = Number($("edit-product-discount").value);

    if (price < 0 || discount < 0 || discount > 90) {
      setText("product-editor-message", "Please enter valid values.");
      return;
    }

    const { error } = await supabaseClient
      .from("products")
      .update({
        price,
        discount_percent: discount
      })
      .eq("id", editingProductId);

    if (error) {
      setText("product-editor-message", error.message);
      return;
    }

    modal.remove();
    await loadProducts();
  });
}

/* =========================================
   CART
========================================= */

function saveCart() {
  localStorage.setItem("bratCart", JSON.stringify(cart));
}

function addToCart(id) {
  const product = products.find(item => String(item.id) === String(id));
  if (!product) return;

  cart[id] = Number(cart[id] || 0) + 1;

  saveCart();
  renderCart();
  openCart();
}

function changeQuantity(id, change) {
  const next = Number(cart[id] || 0) + change;

  if (next <= 0) {
    delete cart[id];
  } else {
    cart[id] = next;
  }

  saveCart();
  renderCart();
}

function renderCart() {
  const container = $("cart-items");
  if (!container) return;

  const entries = Object.entries(cart).filter(([id, quantity]) =>
    Number(quantity) > 0 && products.some(item => String(item.id) === String(id))
  );

  const count = entries.reduce((sum, [, quantity]) => sum + Number(quantity), 0);
  setText("cart-count", count);

  if (!entries.length) {
    container.innerHTML = `
      <div class="empty-cart">
        <div class="empty-icon">🛒</div>
        <p>Your cart is empty.</p>
      </div>
    `;
    if ($("cart-total")) $("cart-total").innerHTML = "";
    return;
  }

  container.innerHTML = entries.map(([id, quantity]) => {
    const product = products.find(item => String(item.id) === String(id));
    const stacks = Number(quantity);
    const discount = getDiscountPercent(stacks);
    const manualDiscount = getManualDiscount(product);
    const finalPrice = getSalePrice(product) * stacks * (1 - discount / 100);

    return `
      <div class="cart-item">
        <div class="cart-item-image">
          ${imageMarkup(product, "cart-product-image")}
        </div>

        <div class="cart-item-details">
          <h3>${escapeHTML(product.name)}</h3>
          <div class="cart-item-price">${money(finalPrice)}</div>

          ${manualDiscount > 0 ? `<div class="discount-note">Product discount: ${manualDiscount}%</div>` : ""}
          ${discount > 0 ? `<div class="discount-note">Quantity discount: ${discount}%</div>` : ""}

          <div class="quantity-controls">
            <button data-quantity="${escapeHTML(id)}" data-change="-1" type="button">−</button>
            <span>${stacks}</span>
            <button data-quantity="${escapeHTML(id)}" data-change="1" type="button">+</button>
          </div>
        </div>
      </div>
    `;
  }).join("");

  container.querySelectorAll("[data-quantity]").forEach(button => {
    button.addEventListener("click", () => {
      changeQuantity(button.dataset.quantity, Number(button.dataset.change));
    });
  });

  const totals = getCartTotals();

  $("cart-total").innerHTML = `
    <div class="total-line">
      <span>Subtotal</span>
      <span>${money(totals.original)}</span>
    </div>

    ${totals.manualSavings > 0 ? `
      <div class="total-line discount-line">
        <span>Product discounts</span>
        <span>-${money(totals.manualSavings)}</span>
      </div>
    ` : ""}

    ${totals.quantitySavings > 0 ? `
      <div class="total-line discount-line">
        <span>Quantity discounts</span>
        <span>-${money(totals.quantitySavings)}</span>
      </div>
    ` : ""}

    <div class="total-line grand-total">
      <span>Total</span>
      <strong>${checkoutMoney(totals.total)}</strong>
    </div>
  `;
}

function openCart() {
  $("cart-panel")?.classList.add("open");
  $("overlay")?.classList.add("show");
}

function closeCart() {
  $("cart-panel")?.classList.remove("open");
  $("overlay")?.classList.remove("show");
}

$("open-cart")?.addEventListener("click", openCart);
$("close-cart")?.addEventListener("click", closeCart);
$("overlay")?.addEventListener("click", closeCart);

/* =========================================
   CHECKOUT
========================================= */

function showCheckoutTotal() {
  if (!Object.keys(cart).length) return;

  const totals = getCartTotals();

  $("checkout-total-preview").innerHTML = `
    <div class="total-line">
      <span>Subtotal</span>
      <span>${money(totals.original)}</span>
    </div>

    ${totals.manualSavings > 0 ? `
      <div class="total-line discount-line">
        <span>Product discounts</span>
        <span>-${money(totals.manualSavings)}</span>
      </div>
    ` : ""}

    ${totals.quantitySavings > 0 ? `
      <div class="total-line discount-line">
        <span>Quantity discounts</span>
        <span>-${money(totals.quantitySavings)}</span>
      </div>
    ` : ""}

    <div class="total-line grand-total">
      <span>Final total</span>
      <strong>${checkoutMoney(totals.total)}</strong>
    </div>
  `;

  const dateInput = $("due-date");
  if (dateInput) {
    const today = new Date();
    const localDate = new Date(today.getTime() - today.getTimezoneOffset() * 60000)
      .toISOString().slice(0, 10);
    dateInput.min = localDate;
  }

  closeCart();
  $("order-modal")?.classList.add("show");
}

$("checkout")?.addEventListener("click", showCheckoutTotal);

document.querySelectorAll("[data-close]").forEach(button => {
  button.addEventListener("click", () => {
    $(button.dataset.close)?.classList.remove("show");
  });
});

$("send-order")?.addEventListener("click", event => {
  event.preventDefault();
  submitOrder();
});

async function submitOrder() {
  const name = $("player-name").value.trim();
  const note = $("order-note").value.trim();
  const dueDate = $("due-date").value;
  const district = $("delivery-district").value;
  const address = $("delivery-address").value.trim();

  if (!name || !dueDate || !district || !address) {
    setText("checkout-message", "Please complete all required fields.");
    return;
  }

  const today = new Date();
  const todayString = new Date(today.getTime() - today.getTimezoneOffset() * 60000)
    .toISOString().slice(0, 10);

  if (dueDate < todayString) {
    setText("checkout-message", "Please select a future date.");
    return;
  }

  if (address.length < 2) {
    setText("checkout-message", "Please enter a valid delivery address.");
    return;
  }

  const totals = getCartTotals();

  const items = Object.entries(cart).map(([id, quantity]) => {
    const product = products.find(item => String(item.id) === String(id));

    return {
      id: product.id,
      name: product.name,
      category: product.category,
      quantity: Number(quantity),
      price: Number(product.price),
      discount_percent: getManualDiscount(product),
      quantity_discount_percent: getDiscountPercent(Number(quantity)),
      final_price: roundMoney(
        getSalePrice(product) *
        Number(quantity) *
        (1 - getDiscountPercent(Number(quantity)) / 100)
      )
    };
  });

  const payload = {
    user_id: currentSession?.user?.id || null,
    minecraft_name: name,
    note: note || null,
    status: "pending",
    request_type: "order",
    items,
    description: null,
    links: [],
    image_urls: [],
    desired_price: null,
    subtotal: totals.original,
    discount_amount: totals.savings,
    total: totals.checkoutTotal,
    due_date: dueDate,
    delivery_district: district,
    delivery_address: address
  };

  const submitButton = $("send-order");
  submitButton.disabled = true;
  submitButton.textContent = "Submitting...";

  const { error } = await supabaseClient
    .from("orders")
    .insert(payload);

  submitButton.disabled = false;
  submitButton.textContent = "Place order →";

  if (error) {
    console.error(error);
    setText("checkout-message", `Could not place order: ${error.message}`);
    return;
  }

  cart = {};
  saveCart();
  renderCart();

  $("checkout-form").reset();
  $("order-modal").classList.remove("show");

  alert("Your order has been submitted successfully!");
}

/* =========================================
   SEARCH
========================================= */

$("search")?.addEventListener("input", () => {
  if (category === "All") {
    renderOffers();
  } else {
    renderProducts();
  }
});

/* =========================================
   ADMIN AUTHENTICATION
========================================= */

$("admin-login-open")?.addEventListener("click", () => {
  if (isAdmin) {
    showAdminDashboard();
  } else {
    $("admin-login-modal")?.classList.add("show");
  }
});

$("admin-login-form")?.addEventListener("submit", async event => {
  event.preventDefault();

  const email = $("admin-email").value.trim();
  const password = $("admin-password").value;

  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    setText("admin-login-message", error.message);
    return;
  }

  currentSession = data.session;
  await checkAdmin();
});

async function initializeAuth() {
  const { data } = await supabaseClient.auth.getSession();
  currentSession = data.session;
  await checkAdmin();

  supabaseClient.auth.onAuthStateChange((_event, session) => {
    currentSession = session;
    setTimeout(() => checkAdmin(), 0);
  });
}

async function checkAdmin() {
  isAdmin = false;

  if (currentSession?.user) {
    const { data, error } = await supabaseClient
      .from("profiles")
      .select("role")
      .eq("id", currentSession.user.id)
      .maybeSingle();

    if (!error && data && ["admin", "editor"].includes(data.role)) {
      isAdmin = true;
    }
  }

  $("admin-login-modal")?.classList.remove("show");

  if (isAdmin) {
    $("admin-login-open").classList.add("is-admin");
    renderProducts();
    renderOffers();
  } else {
    $("admin-login-open")?.classList.remove("is-admin");
  }
}

$("admin-logout")?.addEventListener("click", async () => {
  await supabaseClient.auth.signOut();
  isAdmin = false;
  currentSession = null;
  $("admin-section").style.display = "none";
  showCategory("All");
});

/* =========================================
   ADMIN DASHBOARD
========================================= */

async function showAdminDashboard() {
  if (!isAdmin) return;

  $("offers").style.display = "none";
  $("shop").style.display = "none";
  $("admin-section").style.display = "";

  await loadRequests();
}

$("refresh-requests")?.addEventListener("click", loadRequests);

document.querySelectorAll("[data-filter]").forEach(button => {
  button.addEventListener("click", () => {
    currentRequestFilter = button.dataset.filter;

    document.querySelectorAll("[data-filter]").forEach(item =>
      item.classList.toggle("active", item === button)
    );

    renderRequests();
  });
});

async function loadRequests() {
  if (!isAdmin) return;

  const container = $("admin-requests");
  if (container) container.innerHTML = `<div class="loading-state">Loading requests...</div>`;

  const { data, error } = await supabaseClient
    .from("orders")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    if (container) container.innerHTML =
      `<p class="error-message">Could not load requests: ${escapeHTML(error.message)}</p>`;
    return;
  }

  requests = data || [];
  renderRequests();
}

function renderRequests() {
  const container = $("admin-requests");
  if (!container) return;

  const filtered = requests.filter(request =>
    currentRequestFilter === "all" ||
    request.status === currentRequestFilter
  );

  if (!filtered.length) {
    container.innerHTML = `<div class="empty-state"><h3>No requests found</h3></div>`;
    return;
  }

  container.innerHTML = filtered.map(request => {
    const items = Array.isArray(request.items) ? request.items : [];
    const links = Array.isArray(request.links) ? request.links : [];
    const images = Array.isArray(request.image_urls) ? request.image_urls : [];

    return `
      <article class="request-card">
        <div class="request-card-header">
          <div>
            <div class="eyebrow">REQUEST #${escapeHTML(String(request.id).slice(0, 8))}</div>
            <h3>${escapeHTML(request.minecraft_name || "Unknown player")}</h3>
            <p class="muted">Submitted ${formatDate(request.created_at)}</p>
          </div>

          <span class="request-status status-${escapeHTML(request.status)}">
            ${escapeHTML(request.status)}
          </span>
        </div>

        <div class="request-delivery">
          <div class="delivery-heading">DELIVERY DETAILS</div>
          <div><strong>Desired date:</strong> ${formatDateOnly(request.due_date)}</div>
          <div><strong>District:</strong> ${escapeHTML(request.delivery_district || "Not specified")}</div>
          <div><strong>Address:</strong> ${escapeHTML(request.delivery_address || "Not specified")}</div>
        </div>

        <div class="request-content">
          <h4>${request.request_type === "service" ? "Service request" : "Order items"}</h4>

          ${items.map(item => `
            <div class="request-item">
              <span>${escapeHTML(item.name)} × ${Number(item.quantity || 1)}</span>
              <span>${money(item.final_price ?? item.price ?? 0)}</span>
            </div>
          `).join("")}

          ${request.description ? `
            <div class="request-description">
              <strong>Description:</strong>
              <p>${escapeHTML(request.description)}</p>
            </div>
          ` : ""}

          ${request.note ? `
            <div class="request-description">
              <strong>Customer note:</strong>
              <p>${escapeHTML(request.note)}</p>
            </div>
          ` : ""}

          ${request.desired_price != null ? `
            <p><strong>Desired budget:</strong> ${money(request.desired_price)}</p>
          ` : ""}

          ${links.length ? `
            <div class="request-links">
              <strong>Links:</strong>
              ${links.map(link => {
                const url = safeExternalUrl(link);
                return url ? `<a href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(url)}</a>` : "";
              }).join("")}
            </div>
          ` : ""}

          ${images.length ? `
            <div class="request-images">
              ${images.map(url => {
                const safeUrl = safeExternalUrl(url);
                return safeUrl ? `<a href="${escapeHTML(safeUrl)}" target="_blank" rel="noopener noreferrer"><img src="${escapeHTML(safeUrl)}" alt="Customer attachment"></a>` : "";
              }).join("")}
            </div>
          ` : ""}
        </div>

        <div class="request-financials">
          <div><span>Subtotal</span><strong>${money(request.subtotal)}</strong></div>
          <div><span>Discount</span><strong>-${money(request.discount_amount)}</strong></div>
          <div class="request-final-total"><span>Total</span><strong>${money(request.total)}</strong></div>
        </div>

        <div class="request-actions">
          <button class="status-action" data-status-id="${escapeHTML(request.id)}" data-status="pending" type="button">Pending</button>
          <button class="status-action" data-status-id="${escapeHTML(request.id)}" data-status="accepted" type="button">Accept</button>
          <button class="status-action" data-status-id="${escapeHTML(request.id)}" data-status="completed" type="button">Complete</button>
          <button class="status-action danger" data-status-id="${escapeHTML(request.id)}" data-status="rejected" type="button">Reject</button>
        </div>
      </article>
    `;
  }).join("");

  container.querySelectorAll("[data-status-id]").forEach(button => {
    button.addEventListener("click", () => {
      updateRequestStatus(button.dataset.statusId, button.dataset.status);
    });
  });
}

async function updateRequestStatus(id, status) {
  const { error } = await supabaseClient
    .from("orders")
    .update({ status })
    .eq("id", id);

  if (error) {
    alert(`Could not update request: ${error.message}`);
    return;
  }

  await loadRequests();
}

/* =========================================
   SERVICE REQUEST FORM
========================================= */

function renderServiceForm() {
  const container = $("products");
  if (!container) return;

  container.innerHTML = `
    <div class="service-request-card">
      <div class="eyebrow">CUSTOM PROJECTS</div>
      <h2>Request a <span class="orange">service.</span></h2>
      <p class="muted">Tell us what you need and our team will review your request.</p>

      <form id="service-request-form">
        <label for="service-title">Request title *</label>
        <input id="service-title" type="text" maxlength="100" required placeholder="What do you need?">

        <label for="service-description">Description *</label>
        <textarea id="service-description" rows="5" maxlength="3000" required placeholder="Describe your project..."></textarea>

        <label for="service-links">Reference links (optional)</label>
        <textarea id="service-links" rows="2" placeholder="One URL per line"></textarea>

        <label for="service-images">Reference images (optional, max. 5 images)</label>
        <input id="service-images" type="file" accept="image/*" multiple>

        <label for="service-budget">Desired budget in KB$ (optional)</label>
        <input id="service-budget" type="number" min="0" step="0.01" placeholder="Your budget">

        <button class="primary-button full-width" type="submit">Add service request to cart →</button>
        <p id="service-message" class="form-message"></p>
      </form>
    </div>
  `;

  $("service-request-form").addEventListener("submit", addServiceRequestToCart);
}

async function addServiceRequestToCart(event) {
  event.preventDefault();

  const title = $("service-title").value.trim();
  const description = $("service-description").value.trim();
  const links = $("service-links").value
    .split("\n")
    .map(item => item.trim())
    .filter(Boolean);

  const files = Array.from($("service-images").files || []);
  const desiredPrice = $("service-budget").value;

  if (files.length > 5) {
    setText("service-message", "You can upload a maximum of 5 images.");
    return;
  }

  if (files.some(file => file.size > 5 * 1024 * 1024)) {
    setText("service-message", "Each image must be smaller than 5 MB.");
    return;
  }

  if (links.some(link => !safeExternalUrl(link))) {
    setText("service-message", "Please enter valid http/https links.");
    return;
  }

  const imageUrls = [];

  for (const file of files) {
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;

    const { data, error } = await supabaseClient.storage
      .from("service-attachments")
      .upload(fileName, file);

    if (error) {
      setText("service-message", `Image upload failed: ${error.message}`);
      return;
    }

    const { data: publicData } = supabaseClient.storage
      .from("service-attachments")
      .getPublicUrl(data.path);

    imageUrls.push(publicData.publicUrl);
  }

  const serviceProduct = {
    id: `service-${Date.now()}`,
    name: title,
    category: "Services",
    description,
    price: Number(desiredPrice || 0),
    stack_size: 1,
    discount_percent: 0,
    isService: true,
    links,
    imageUrls,
    desiredPrice: desiredPrice ? Number(desiredPrice) : null
  };

  cart[serviceProduct.id] = 1;
  products.push(serviceProduct);

  saveCart();
  renderCart();

  setText("service-message", "Service request added to cart. Continue to checkout to submit it.");
  event.target.reset();
}

/* =========================================
   SERVICE CART SUPPORT
========================================= */

const originalGetCartTotals = getCartTotals;

getCartTotals = function() {
  let original = 0;
  let afterManual = 0;
  let afterQuantity = 0;

  for (const [id, quantity] of Object.entries(cart)) {
    const product = products.find(item => String(item.id) === String(id));
    if (!product) continue;

    if (product.isService) continue;

    const stacks = Number(quantity);
    const salePrice = getSalePrice(product);
    original += Number(product.price) * stacks;
    afterManual += salePrice * stacks;

    const discount = getDiscountPercent(stacks);
    afterQuantity += salePrice * stacks * (1 - discount / 100);
  }

  const manualSavings = original - afterManual;
  const quantitySavings = afterManual - afterQuantity;
  const savings = manualSavings + quantitySavings;

  return {
    original,
    afterManual,
    afterQuantity,
    manualSavings,
    quantitySavings,
    savings,
    total: afterQuantity,
    checkoutTotal: roundMoney(afterQuantity)
  };
};

const originalRenderCart = renderCart;

renderCart = function() {
  const container = $("cart-items");
  if (!container) return;

  const entries = Object.entries(cart).filter(([id, quantity]) =>
    Number(quantity) > 0 && products.some(item => String(item.id) === String(id))
  );

  const count = entries.reduce((sum, [, quantity]) => sum + Number(quantity), 0);
  setText("cart-count", count);

  if (!entries.length) {
    container.innerHTML = `
      <div class="empty-cart">
        <div class="empty-icon">🛒</div>
        <p>Your cart is empty.</p>
      </div>
    `;
    $("cart-total").innerHTML = "";
    return;
  }

  container.innerHTML = entries.map(([id, quantity]) => {
    const product = products.find(item => String(item.id) === String(id));

    if (product.isService) {
      return `
        <div class="cart-item">
          <div class="cart-item-image">◈</div>
          <div class="cart-item-details">
            <h3>${escapeHTML(product.name)}</h3>
            <div class="cart-item-price">Service request</div>
            <div class="discount-note">Price to be agreed</div>
            <button class="remove-service" data-remove-service="${escapeHTML(id)}" type="button">Remove</button>
          </div>
        </div>
      `;
    }

    const stacks = Number(quantity);
    const discount = getDiscountPercent(stacks);
    const manualDiscount = getManualDiscount(product);
    const finalPrice = getSalePrice(product) * stacks * (1 - discount / 100);

    return `
      <div class="cart-item">
        <div class="cart-item-image">${imageMarkup(product, "cart-product-image")}</div>
        <div class="cart-item-details">
          <h3>${escapeHTML(product.name)}</h3>
          <div class="cart-item-price">${money(finalPrice)}</div>
          ${manualDiscount > 0 ? `<div class="discount-note">Product discount: ${manualDiscount}%</div>` : ""}
          ${discount > 0 ? `<div class="discount-note">Quantity discount: ${discount}%</div>` : ""}
          <div class="quantity-controls">
            <button data-quantity="${escapeHTML(id)}" data-change="-1" type="button">−</button>
            <span>${stacks}</span>
            <button data-quantity="${escapeHTML(id)}" data-change="1" type="button">+</button>
          </div>
        </div>
      </div>
    `;
  }).join("");

  container.querySelectorAll("[data-quantity]").forEach(button => {
    button.addEventListener("click", () =>
      changeQuantity(button.dataset.quantity, Number(button.dataset.change))
    );
  });

  container.querySelectorAll("[data-remove-service]").forEach(button => {
    button.addEventListener("click", () => {
      delete cart[button.dataset.removeService];
      products = products.filter(item => item.id !== button.dataset.removeService);
      saveCart();
      renderCart();
    });
  });

  const totals = getCartTotals();

  $("cart-total").innerHTML = `
    <div class="total-line"><span>Subtotal</span><span>${money(totals.original)}</span></div>
    ${totals.manualSavings > 0 ? `<div class="total-line discount-line"><span>Product discounts</span><span>-${money(totals.manualSavings)}</span></div>` : ""}
    ${totals.quantitySavings > 0 ? `<div class="total-line discount-line"><span>Quantity discounts</span><span>-${money(totals.quantitySavings)}</span></div>` : ""}
    <div class="total-line grand-total"><span>Total</span><strong>${checkoutMoney(totals.total)}</strong></div>
  `;
};

/* =========================================
   SERVICE ORDER SUBMISSION
========================================= */

const originalSubmitOrder = submitOrder;

submitOrder = async function() {
  const serviceEntry = Object.entries(cart).find(([id]) => {
    const product = products.find(item => String(item.id) === String(id));
    return product?.isService;
  });

  if (!serviceEntry) {
    await originalSubmitOrder();
    return;
  }

  const name = $("player-name").value.trim();
  const note = $("order-note").value.trim();
  const dueDate = $("due-date").value;
  const district = $("delivery-district").value;
  const address = $("delivery-address").value.trim();

  if (!name || !dueDate || !district || !address) {
    setText("checkout-message", "Please complete all required fields.");
    return;
  }

  const today = new Date();
  const todayString = new Date(today.getTime() - today.getTimezoneOffset() * 60000)
    .toISOString().slice(0, 10);

  if (dueDate < todayString) {
    setText("checkout-message", "Please select a future date.");
    return;
  }

  const [serviceId] = serviceEntry;
  const service = products.find(item => String(item.id) === String(serviceId));

  const otherItems = Object.entries(cart).filter(([id]) => String(id) !== String(serviceId));

  if (otherItems.length) {
    setText("checkout-message", "Please submit service requests separately from regular products.");
    return;
  }

  const payload = {
    user_id: currentSession?.user?.id || null,
    minecraft_name: name,
    note: note || null,
    status: "pending",
    request_type: "service",
    items: [{
      id: service.id,
      name: service.name,
      quantity: 1,
      price: 0,
      final_price: 0
    }],
    description: service.description,
    links: service.links || [],
    image_urls: service.imageUrls || [],
    desired_price: service.desiredPrice,
    subtotal: 0,
    discount_amount: 0,
    total: 0,
    due_date: dueDate,
    delivery_district: district,
    delivery_address: address
  };

  const submitButton = $("send-order");
  submitButton.disabled = true;
  submitButton.textContent = "Submitting...";

  const { error } = await supabaseClient.from("orders").insert(payload);

  submitButton.disabled = false;
  submitButton.textContent = "Place order →";

  if (error) {
    setText("checkout-message", `Could not submit request: ${error.message}`);
    return;
  }

  cart = {};
  products = products.filter(item => !item.isService);
  saveCart();
  renderCart();

  $("checkout-form").reset();
  $("order-modal").classList.remove("show");

  alert("Your service request has been submitted successfully!");
};

/* =========================================
   STARTUP
========================================= */

if (category === "Services") {
  renderServiceForm();
}

const originalShowCategory = showCategory;

showCategory = function(nextCategory) {
  originalShowCategory(nextCategory);

  if (nextCategory === "Services") {
    renderServiceForm();
  }
};

renderCart();
loadProducts();
initializeAuth();
