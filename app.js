
const supabaseClient = window.supabase.createClient(
  window.SUPABASE_URL,
  window.SUPABASE_KEY
);

/* =========================================
   GLOBAL STATE
========================================= */

let products = [];
let category = "All";
let cart = JSON.parse(localStorage.getItem("bratCart") || "{}");
let currentSession = null;
let isAdmin = false;
let requests = [];
let currentRequestFilter = "all";
let editingProductId = null;
let catalogCache = [];

const MINECRAFT_CATALOG_VERSION = "26.2";

/* =========================================
   HELPERS
========================================= */

const $ = (id) => document.getElementById(id);

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function roundMoney(value) {
  return Math.ceil((Number(value) + Number.EPSILON) * 100) / 100;
}

function money(value) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(Number(value) || 0) + " KB$";
}

function checkoutMoney(value) {
  return money(value);
}

function setText(id, value) {
  const element = $(id);
  if (element) element.textContent = value;
}

function formatDate(value) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function safeExternalUrl(value) {
  try {
    const url = new URL(value);

    if (!["http:", "https:"].includes(url.protocol)) {
      return "";
    }

    return url.href;
  } catch {
    return "";
  }
}

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

function getTextureName(product) {
  if (product?.minecraft_id) {
    return String(product.minecraft_id)
      .replace(/^minecraft:/, "");
  }

  const name = String(product?.name || "").trim();

  if (textureAliases[name]) return textureAliases[name];

  return name
    .toLowerCase()
    .replace(/minecraft:/g, "")
    .replace(/[^a-z0-9_ ]/g, "")
    .trim()
    .replace(/\s+/g, "_");
}

function productImage(product) {
  const texture = getTextureName(product);
  const categoryName = String(product?.category || "").toLowerCase();

  const folder = categoryName === "blocks" ? "block" : "item";

  return `https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.21.4/assets/minecraft/textures/${folder}/${texture}.png`;
}

function imageMarkup(product, className = "product-image") {
  const image = productImage(product);

  return `
    <img
      class="${escapeHTML(className)}"
      src="${escapeHTML(image)}"
      alt="${escapeHTML(product?.name || "Minecraft item")}"
      loading="lazy"
      onerror="this.onerror=null;this.src='https://placehold.co/96x96/222222/eeeeee?text=MC';"
    >
  `;
}

/* =========================================
   PRICE AND DISCOUNTS
========================================= */

function getManualDiscount(product, quantity) {
  const discounts = Array.isArray(product?.discounts)
    ? product.discounts
    : [];

  let selectedDiscount = 0;

  for (const discount of discounts) {
    const minimum = Number(
      discount.minimum_quantity ??
      discount.min_quantity ??
      discount.quantity ??
      0
    );

    const percentage = Number(
      discount.discount_percent ??
      discount.percent ??
      0
    );

    if (quantity >= minimum && minimum > 0) {
      selectedDiscount = Math.max(selectedDiscount, percentage);
    }
  }

  return selectedDiscount;
}

function getSalePrice(product, quantity = 1) {
  const basePrice = Number(product?.price) || 0;
  const productDiscount = Number(product?.discount_percent) || 0;
  const manualDiscount = getManualDiscount(product, quantity);

  const automaticDiscount =
    quantity >= 16 ? 15 :
    quantity >= 10 ? 10 :
    quantity >= 6 ? 5 : 0;

  const discount = Math.max(
    productDiscount,
    manualDiscount,
    automaticDiscount
  );

  return roundMoney(
    basePrice * (1 - Math.min(discount, 100) / 100)
  );
}

function getDiscountPercent(product, quantity = 1) {
  const basePrice = Number(product?.price) || 0;

  if (basePrice <= 0) return 0;

  const salePrice = getSalePrice(product, quantity);

  return Math.max(
    0,
    Math.round((1 - salePrice / basePrice) * 100)
  );
}

function stackText(size) {
  const amount = Number(size) || 64;

  if (amount === 1) return "1 per purchase";
  if (amount === 16) return "16 per stack";
  if (amount === 64) return "64 per stack";

  return `${amount} per stack`;
}

/* =========================================
   CART TOTALS
========================================= */

function getCartTotals() {
  let subtotal = 0;
  let totalItems = 0;
  let discountTotal = 0;

  for (const [productId, item] of Object.entries(cart)) {
    const product = products.find(
      entry => String(entry.id) === String(productId)
    );

    if (!product) continue;

    const quantity = Math.max(1, Number(item.quantity) || 1);
    const price = Number(product.price) || 0;
    const salePrice = getSalePrice(product, quantity);

    const lineSubtotal = price * quantity;
    const lineTotal = salePrice * quantity;

    subtotal += lineSubtotal;
    discountTotal += lineSubtotal - lineTotal;
    totalItems += quantity;
  }

  subtotal = roundMoney(subtotal);
  discountTotal = roundMoney(discountTotal);

  return {
    subtotal,
    discountTotal,
    total: roundMoney(subtotal - discountTotal),
    totalItems
  };
}

/* =========================================
   PRODUCT LOADING
========================================= */

async function loadProducts() {
  try {
    const { data, error } = await supabaseClient
      .from("products")
      .select("*")
      .eq("is_active", true)
      .order("name", { ascending: true });

    if (error) throw error;

    products = data || [];

    renderOffers();
    renderProducts();
    renderCart();
  } catch (error) {
    console.error("Could not load products:", error);

    const container = $("products-grid");

    if (container) {
      container.innerHTML = `
        <div class="empty-state">
          <h3>Products could not be loaded</h3>
          <p>Please try again later.</p>
        </div>
      `;
    }
  }
}

/* =========================================
   NAVIGATION
========================================= */

function showCategory(selectedCategory) {
  category = selectedCategory;

  document.querySelectorAll(".nav-link").forEach(link => {
    link.classList.toggle(
      "active",
      link.dataset.category === selectedCategory
    );
  });

  const offersSection = $("offers-section");
  const shopSection = $("shop-section");
  const adminSection = $("admin-section");

  if (adminSection) adminSection.style.display = "none";

  if (selectedCategory === "All") {
    if (offersSection) offersSection.style.display = "";
    if (shopSection) shopSection.style.display = "none";
  } else {
    if (offersSection) offersSection.style.display = "none";
    if (shopSection) shopSection.style.display = "";
  }

  renderProducts();
}

document.querySelectorAll(".nav-link").forEach(link => {
  link.addEventListener("click", event => {
    event.preventDefault();

    const selectedCategory = link.dataset.category;

    if (selectedCategory) showCategory(selectedCategory);
  });
});

/* =========================================
   CATEGORY DESCRIPTIONS
========================================= */

const categoryDescriptions = {
  "All": "Discover the latest offers from Brat Ltd.",
  "Blocks": "Building blocks and materials for your next project.",
  "Items": "Useful items and resources for your Minecraft adventure.",
  "Armor & Weapons": "Equipment to protect yourself and defeat your enemies.",
  "Enchantments": "Enchantments and upgrades for your equipment.",
  "Services": "Request custom services from Brat Ltd."
};

/* =========================================
   OFFERS
========================================= */

function renderOffers() {
  const container = $("offers-grid");

  if (!container) return;

  const offers = products.filter(product =>
    Number(product.discount_percent) > 0
  );

  if (!offers.length) {
    container.innerHTML = `
      <div class="empty-state">
        <h3>No special offers right now</h3>
        <p>Check back later for new deals.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = offers.map(product => {
    const oldPrice = Number(product.price) || 0;
    const newPrice = getSalePrice(product, 1);
    const discount = getDiscountPercent(product, 1);

    return `
      <article class="product-card offer-card">
        <div class="product-card-image">
          ${imageMarkup(product)}
          <span class="discount-badge">-${discount}%</span>
        </div>

        <div class="product-card-content">
          <span class="product-category">
            ${escapeHTML(product.category || "Items")}
          </span>

          <h3>${escapeHTML(product.name)}</h3>

          <p class="product-description">
            ${escapeHTML(product.description || "")}
          </p>

          <div class="product-price">
            <span class="old-price">${money(oldPrice)}</span>
            <strong>${money(newPrice)}</strong>
          </div>

          <button
            class="primary-button"
            onclick="addToCart('${escapeHTML(product.id)}')"
          >
            Add to cart
          </button>
        </div>
      </article>
    `;
  }).join("");
}

/* =========================================
   PRODUCT DISPLAY
========================================= */

function productPriceMarkup(product) {
  const price = Number(product.price) || 0;
  const discountedPrice = getSalePrice(product, 1);
  const discount = getDiscountPercent(product, 1);

  if (discount > 0) {
    return `
      <div class="product-price">
        <span class="old-price">${money(price)}</span>
        <strong>${money(discountedPrice)}</strong>
        <span class="discount-label">-${discount}%</span>
      </div>
    `;
  }

  return `
    <div class="product-price">
      <strong>${money(price)}</strong>
    </div>
  `;
}

function adminProductButton(product) {
  if (!isAdmin) return "";

  return `
    <button
      class="secondary-button"
      onclick="openProductEditor('${escapeHTML(product.id)}')"
    >
      Edit product
    </button>
  `;
}

function renderProducts() {
  const container = $("products-grid");

  if (!container) return;

  const description = $("category-description");

  if (description) {
    description.textContent = categoryDescriptions[category] || "";
  }

  if (category === "Services") {
    container.innerHTML = `
      <div class="service-placeholder">
        <h3>Custom Services</h3>
        <p>Choose a service and send us your request.</p>
      </div>
    `;

    renderServiceForm();
    return;
  }

  let filteredProducts = products;

  if (category !== "All") {
    filteredProducts = products.filter(
      product => product.category === category
    );
  }

  const searchInput = $("product-search");
  const searchTerm = searchInput
    ? searchInput.value.trim().toLowerCase()
    : "";

  if (searchTerm) {
    filteredProducts = filteredProducts.filter(product =>
      String(product.name || "").toLowerCase().includes(searchTerm) ||
      String(product.description || "").toLowerCase().includes(searchTerm)
    );
  }

  if (!filteredProducts.length) {
    container.innerHTML = `
      <div class="empty-state">
        <h3>No products found</h3>
        <p>Try another category or search term.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = filteredProducts.map(product => `
    <article class="product-card">
      <div class="product-card-image">
        ${imageMarkup(product)}
      </div>

      <div class="product-card-content">
        <span class="product-category">
          ${escapeHTML(product.category || "Items")}
        </span>

        <h3>${escapeHTML(product.name)}</h3>

        <p class="product-description">
          ${escapeHTML(product.description || "")}
        </p>

        ${productPriceMarkup(product)}

        <p class="stack-info">
          ${stackText(product.stack_size)}
        </p>

        <div class="product-card-actions">
          <button
            class="primary-button"
            onclick="addToCart('${escapeHTML(product.id)}')"
          >
            Add to cart
          </button>

          ${adminProductButton(product)}
        </div>
      </div>
    </article>
  `).join("");
}

/* =========================================
   PRODUCT SEARCH
========================================= */

const productSearchInput = $("product-search");

if (productSearchInput) {
  productSearchInput.addEventListener("input", renderProducts);
}

/* =========================================
   PRODUCT EDITOR
========================================= */

function openProductEditor(productId) {
  if (!isAdmin) return;

  const product = [
    ...products,
    ...catalogCache
  ].find(entry => String(entry.id) === String(productId));

  if (!product) return;

  editingProductId = product.id;

  const modal = $("product-editor-modal");
  if (!modal) return;

  if ($("edit-product-name")) {
    $("edit-product-name").value = product.name || "";
  }

  if ($("edit-product-category")) {
    $("edit-product-category").value = product.category || "Items";
  }

  if ($("edit-product-price")) {
    $("edit-product-price").value = Number(product.price) || 0;
  }

  if ($("edit-product-stack")) {
    $("edit-product-stack").value = Number(product.stack_size) || 64;
  }

  if ($("edit-product-discount")) {
    $("edit-product-discount").value =
      Number(product.discount_percent) || 0;
  }

  if ($("edit-product-active")) {
    $("edit-product-active").checked = Boolean(product.is_active);
  }

  modal.classList.add("active");
}

function closeProductEditor() {
  $("product-editor-modal")?.classList.remove("active");
  editingProductId = null;
}

async function saveProductEditor() {
  if (!isAdmin || !editingProductId) return;

  const name = $("edit-product-name")?.value.trim();
  const categoryValue = $("edit-product-category")?.value;
  const price = Number($("edit-product-price")?.value);
  const stackSize = Number($("edit-product-stack")?.value);
  const discount = Number($("edit-product-discount")?.value);
  const isActive = $("edit-product-active")?.checked ?? false;

  if (!name) {
    showToast("Product name is required.", "error");
    return;
  }

  if (
    !Number.isFinite(price) ||
    price < 0 ||
    !Number.isInteger(stackSize) ||
    stackSize < 1 ||
    stackSize > 64 ||
    !Number.isFinite(discount) ||
    discount < 0 ||
    discount > 100
  ) {
    showToast("Please enter valid product values.", "error");
    return;
  }

  const allowedCategories = [
    "Blocks",
    "Items",
    "Armor & Weapons",
    "Enchantments"
  ];

  if (!allowedCategories.includes(categoryValue)) {
    showToast("Please select a valid category.", "error");
    return;
  }

  // Products without a price cannot be published.
  if (isActive && price <= 0) {
    showToast("Set a price before publishing this product.", "error");
    return;
  }

  const { error } = await supabaseClient
    .from("products")
    .update({
      name,
      category: categoryValue,
      price: roundMoney(price),
      stack_size: stackSize,
      discount_percent: discount,
      is_active: isActive
    })
    .eq("id", editingProductId);

  if (error) {
    console.error(error);
    showToast("Could not save product.", "error");
    return;
  }

  closeProductEditor();
  await loadProducts();
  await loadCatalogProducts();

  showToast("Product updated successfully.", "success");
}

/* =========================================
   CART STORAGE
========================================= */

function saveCart() {
  localStorage.setItem("bratCart", JSON.stringify(cart));
}

function addToCart(productId) {
  const product = products.find(
    entry => String(entry.id) === String(productId)
  );

  if (!product) {
    showToast("Product not found.", "error");
    return;
  }

  if (Number(product.price) <= 0) {
    showToast("This product is currently unavailable.", "error");
    return;
  }

  if (!cart[productId]) {
    cart[productId] = { quantity: 1 };
  } else {
    cart[productId].quantity += 1;
  }

  saveCart();
  renderCart();

  showToast(`${product.name} added to cart.`, "success");
}

function changeCartQuantity(productId, change) {
  if (!cart[productId]) return;

  const product = products.find(
    entry => String(entry.id) === String(productId)
  );

  if (!product) {
    delete cart[productId];
    saveCart();
    renderCart();
    return;
  }

  const currentQuantity = Number(cart[productId].quantity) || 1;
  const nextQuantity = currentQuantity + Number(change);

  if (nextQuantity <= 0) {
    delete cart[productId];
  } else if (nextQuantity > 9999) {
    showToast("Maximum quantity reached.", "error");
    return;
  } else {
    cart[productId].quantity = nextQuantity;
  }

  saveCart();
  renderCart();
}

function removeFromCart(productId) {
  if (!cart[productId]) return;

  delete cart[productId];

  saveCart();
  renderCart();

  showToast("Item removed from cart.", "success");
}

function clearCart() {
  cart = {};
  saveCart();
  renderCart();
}

/* =========================================
   CART DISPLAY
========================================= */

function renderCart() {
  const container = $("cart-items");
  const countElement = $("cart-count");
  const subtotalElement = $("cart-subtotal");
  const discountElement = $("cart-discount");
  const totalElement = $("cart-total");

  const totals = getCartTotals();

  if (countElement) countElement.textContent = totals.totalItems;
  if (subtotalElement) subtotalElement.textContent = money(totals.subtotal);
  if (discountElement) discountElement.textContent = "-" + money(totals.discountTotal);
  if (totalElement) totalElement.textContent = money(totals.total);

  if (!container) return;

  const entries = Object.entries(cart).filter(([productId]) =>
    products.some(product => String(product.id) === String(productId))
  );

  if (!entries.length) {
    container.innerHTML = `
      <div class="empty-cart">
        <p>Your cart is empty.</p>
        <span>Browse our products and find something you need.</span>
      </div>
    `;
    return;
  }

  container.innerHTML = entries.map(([productId, item]) => {
    const product = products.find(
      entry => String(entry.id) === String(productId)
    );

    if (!product) return "";

    const quantity = Math.max(1, Number(item.quantity) || 1);
    const unitPrice = getSalePrice(product, quantity);
    const lineTotal = roundMoney(unitPrice * quantity);

    return `
      <div class="cart-item">
        <div class="cart-item-image">
          ${imageMarkup(product, "cart-product-image")}
        </div>

        <div class="cart-item-info">
          <strong>${escapeHTML(product.name)}</strong>
          <span>${money(unitPrice)} each</span>
          <span class="cart-item-total">${money(lineTotal)}</span>
        </div>

        <div class="cart-item-controls">
          <button
            type="button"
            onclick="changeCartQuantity('${escapeHTML(productId)}', -1)"
            aria-label="Decrease quantity"
          >−</button>

          <span>${quantity}</span>

          <button
            type="button"
            onclick="changeCartQuantity('${escapeHTML(productId)}', 1)"
            aria-label="Increase quantity"
          >+</button>
        </div>

        <button
          type="button"
          class="remove-cart-item"
          onclick="removeFromCart('${escapeHTML(productId)}')"
          aria-label="Remove item"
        >×</button>
      </div>
    `;
  }).join("");
}

/* =========================================
   CART OPEN / CLOSE
========================================= */

function openCart() {
  $("cart-drawer")?.classList.add("active");
  $("cart-overlay")?.classList.add("active");
  renderCart();
}

function closeCart() {
  $("cart-drawer")?.classList.remove("active");
  $("cart-overlay")?.classList.remove("active");
}

$("cart-button")?.addEventListener("click", openCart);
$("cart-close")?.addEventListener("click", closeCart);
$("cart-overlay")?.addEventListener("click", closeCart);

/* =========================================
   CHECKOUT MODAL
========================================= */

function openCheckout() {
  if (!currentSession) {
    showToast("Please sign in before checking out.", "error");
    openLoginModal();
    return;
  }

  const totals = getCartTotals();

  if (!totals.totalItems) {
    showToast("Your cart is empty.", "error");
    return;
  }

  setText("checkout-total", checkoutMoney(totals.total));
  $("checkout-modal")?.classList.add("active");

  closeCart();
}

function closeCheckout() {
  $("checkout-modal")?.classList.remove("active");
}

$("checkout-button")?.addEventListener("click", openCheckout);
$("checkout-close")?.addEventListener("click", closeCheckout);

/* =========================================
   ORDER PREPARATION
========================================= */

function prepareOrderItems() {
  const orderItems = [];

  for (const [productId, item] of Object.entries(cart)) {
    const product = products.find(
      entry => String(entry.id) === String(productId)
    );

    if (!product) continue;

    const quantity = Math.max(1, Number(item.quantity) || 1);
    const unitPrice = getSalePrice(product, quantity);

    orderItems.push({
      product_id: product.id,
      name: product.name,
      category: product.category,
      quantity,
      unit_price: unitPrice,
      total_price: roundMoney(unitPrice * quantity)
    });
  }

  return orderItems;
}

/* =========================================
   TOAST NOTIFICATIONS
========================================= */

function showToast(message, type = "info") {
  let toast = $("toast");

  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast";
    toast.className = "toast";
    document.body.appendChild(toast);
  }

  toast.textContent = message;
  toast.className = `toast ${type} show`;

  if (toast._hideTimeout) clearTimeout(toast._hideTimeout);

  toast._hideTimeout = setTimeout(() => {
    toast.classList.remove("show");
  }, 3000);
}

/* =========================================
   PLACE ORDER
========================================= */

async function placeOrder(event) {
  if (event) event.preventDefault();

  if (!currentSession) {
    showToast("Please sign in first.", "error");
    return;
  }

  const totals = getCartTotals();

  if (!totals.totalItems) {
    showToast("Your cart is empty.", "error");
    return;
  }

  const orderItems = prepareOrderItems();

  if (!orderItems.length) {
    showToast("No valid products in your cart.", "error");
    return;
  }

  const submitButton = $("place-order-button");

  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = "Processing...";
  }

  try {
    const { data: order, error: orderError } = await supabaseClient
      .from("orders")
      .insert({
        user_id: currentSession.user.id,
        request_type: "product",
        status: "pending",
        total: totals.total,
        details: {
          items: orderItems,
          subtotal: totals.subtotal,
          discount: totals.discountTotal
        }
      })
      .select()
      .single();

    if (orderError) throw orderError;

    clearCart();
    closeCheckout();

    showToast("Order submitted successfully!", "success");

    if (isAdmin) await loadRequests();

    return order;
  } catch (error) {
    console.error("Order submission failed:", error);
    showToast(error.message || "Could not submit your order.", "error");
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = "Place order";
    }
  }
}

$("checkout-form")?.addEventListener("submit", placeOrder);
const supabaseClient = window.supabase.createClient(
  window.SUPABASE_URL,
  window.SUPABASE_KEY
);

/* =========================================
   GLOBAL STATE
========================================= */

let products = [];
let catalogCache = [];
let category = "All";
let cart = JSON.parse(localStorage.getItem("bratCart") || "{}");
let currentSession = null;
let isAdmin = false;
let requests = [];
let currentRequestFilter = "all";
let editingProductId = null;
let catalogFilter = "all";

/* =========================================
   HELPERS
========================================= */

const $ = (id) => document.getElementById(id);

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function roundMoney(value) {
  return Math.ceil((Number(value) + Number.EPSILON) * 100) / 100;
}

function money(value) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(Number(value) || 0) + " KB$";
}

function setText(id, value) {
  const element = $(id);
  if (element) element.textContent = value;
}

function formatDate(value) {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function safeExternalUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function showToast(message, type = "info") {
  let toast = $("toast");

  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast";
    toast.className = "toast";
    document.body.appendChild(toast);
  }

  toast.textContent = message;
  toast.className = `toast ${type} show`;

  clearTimeout(toast._hideTimeout);

  toast._hideTimeout = setTimeout(() => {
    toast.classList.remove("show");
  }, 3000);
}

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

function getTextureName(product) {
  if (product?.minecraft_id) {
    return String(product.minecraft_id)
      .replace(/^minecraft:/, "")
      .split(":")
      .pop();
  }

  const name = String(product?.name || "").trim();

  if (textureAliases[name]) return textureAliases[name];

  return name
    .toLowerCase()
    .replace(/minecraft:/g, "")
    .replace(/[^a-z0-9_ ]/g, "")
    .trim()
    .replace(/\s+/g, "_");
}

function productImage(product) {
  const texture = getTextureName(product);
  const categoryName = String(product?.category || "").toLowerCase();
  const folder = categoryName === "blocks" ? "block" : "item";

  return `https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.21.4/assets/minecraft/textures/${folder}/${texture}.png`;
}

function imageMarkup(product, className = "product-image") {
  return `
    <img
      class="${escapeHTML(className)}"
      src="${escapeHTML(productImage(product))}"
      alt="${escapeHTML(product?.name || "Minecraft item")}"
      loading="lazy"
      onerror="this.onerror=null;this.src='https://placehold.co/96x96/222222/eeeeee?text=MC';"
    >
  `;
}

/* =========================================
   PRICE AND DISCOUNTS
========================================= */

function getManualDiscount(product, quantity) {
  const discounts = Array.isArray(product?.discounts)
    ? product.discounts
    : [];

  let selectedDiscount = 0;

  for (const discount of discounts) {
    const minimum = Number(
      discount.minimum_quantity ??
      discount.min_quantity ??
      discount.quantity ??
      0
    );

    const percentage = Number(
      discount.discount_percent ??
      discount.percent ??
      0
    );

    if (quantity >= minimum && minimum > 0) {
      selectedDiscount = Math.max(selectedDiscount, percentage);
    }
  }

  return selectedDiscount;
}

function getSalePrice(product, quantity = 1) {
  const basePrice = Number(product?.price) || 0;
  const productDiscount = Number(product?.discount_percent) || 0;
  const manualDiscount = getManualDiscount(product, quantity);

  const automaticDiscount =
    quantity >= 16 ? 15 :
    quantity >= 10 ? 10 :
    quantity >= 6 ? 5 : 0;

  const discount = Math.max(
    productDiscount,
    manualDiscount,
    automaticDiscount
  );

  return roundMoney(
    basePrice * (1 - Math.min(discount, 100) / 100)
  );
}

function getDiscountPercent(product, quantity = 1) {
  const basePrice = Number(product?.price) || 0;
  if (basePrice <= 0) return 0;

  return Math.max(
    0,
    Math.round((1 - getSalePrice(product, quantity) / basePrice) * 100)
  );
}

function stackText(size) {
  const amount = Number(size) || 64;

  if (amount === 1) return "1 per purchase";
  return `${amount} per stack`;
}

/* =========================================
   PRODUCT LOADING
========================================= */

async function loadProducts() {
  try {
    const { data, error } = await supabaseClient
      .from("products")
      .select("*")
      .eq("is_active", true)
      .order("name", { ascending: true });

    if (error) throw error;

    products = data || [];

    renderOffers();
    renderProducts();
    renderCart();
  } catch (error) {
    console.error("Could not load products:", error);

    const container = $("products-grid");
    if (container) {
      container.innerHTML = `
        <div class="empty-state">
          <h3>Products could not be loaded</h3>
          <p>Please try again later.</p>
        </div>
      `;
    }
  }
}

/* =========================================
   NAVIGATION
========================================= */

const categoryDescriptions = {
  All: "Discover the latest offers from Brat Ltd.",
  Blocks: "Building blocks and materials for your next project.",
  Items: "Useful items and resources for your Minecraft adventure.",
  "Armor & Weapons": "Equipment to protect yourself and defeat your enemies.",
  Enchantments: "Enchantments and upgrades for your equipment.",
  Services: "Request custom services from Brat Ltd."
};

function showCategory(selectedCategory) {
  category = selectedCategory;

  document.querySelectorAll(".nav-link").forEach((link) => {
    link.classList.toggle(
      "active",
      link.dataset.category === selectedCategory
    );
  });

  const offersSection = $("offers-section");
  const shopSection = $("shop-section");
  const adminSection = $("admin-section");

  if (adminSection) adminSection.style.display = "none";

  if (selectedCategory === "All") {
    if (offersSection) offersSection.style.display = "";
    if (shopSection) shopSection.style.display = "none";
  } else {
    if (offersSection) offersSection.style.display = "none";
    if (shopSection) shopSection.style.display = "";
  }

  renderProducts();
}

document.querySelectorAll(".nav-link").forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    if (link.dataset.category) showCategory(link.dataset.category);
  });
});
/* =========================================
   OFFERS
========================================= */

function renderOffers() {
  const container = $("offers-grid");
  if (!container) return;

  const offers = products.filter(
    (product) => Number(product.discount_percent) > 0
  );

  if (!offers.length) {
    container.innerHTML = `
      <div class="empty-state">
        <h3>No special offers right now</h3>
        <p>Check back later for new deals.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = offers.map((product) => {
    const oldPrice = Number(product.price) || 0;
    const newPrice = getSalePrice(product, 1);
    const discount = getDiscountPercent(product, 1);

    return `
      <article class="product-card offer-card">
        <div class="product-card-image">
          ${imageMarkup(product)}
          <span class="discount-badge">-${discount}%</span>
        </div>

        <div class="product-card-content">
          <span class="product-category">
            ${escapeHTML(product.category || "Items")}
          </span>

          <h3>${escapeHTML(product.name)}</h3>

          <p class="product-description">
            ${escapeHTML(product.description || "")}
          </p>

          <div class="product-price">
            <span class="old-price">${money(oldPrice)}</span>
            <strong>${money(newPrice)}</strong>
          </div>

          <button class="primary-button"
            onclick="addToCart('${escapeHTML(product.id)}')">
            Add to cart
          </button>
        </div>
      </article>
    `;
  }).join("");
}

/* =========================================
   PRODUCT DISPLAY
========================================= */

function productPriceMarkup(product) {
  const price = Number(product.price) || 0;
  const discountedPrice = getSalePrice(product, 1);
  const discount = getDiscountPercent(product, 1);

  if (discount > 0) {
    return `
      <div class="product-price">
        <span class="old-price">${money(price)}</span>
        <strong>${money(discountedPrice)}</strong>
        <span class="discount-label">-${discount}%</span>
      </div>
    `;
  }

  return `<div class="product-price"><strong>${money(price)}</strong></div>`;
}

function renderProducts() {
  const container = $("products-grid");
  if (!container) return;

  const description = $("category-description");
  if (description) {
    description.textContent = categoryDescriptions[category] || "";
  }

  if (category === "Services") {
    container.innerHTML = `
      <div class="service-placeholder">
        <h3>Custom Services</h3>
        <p>Choose a service and send us your request.</p>
      </div>
    `;

    renderServiceForm();
    return;
  }

  let filteredProducts = [...products];

  if (category !== "All") {
    filteredProducts = filteredProducts.filter(
      (product) => product.category === category
    );
  }

  const searchTerm = $("product-search")?.value.trim().toLowerCase() || "";

  if (searchTerm) {
    filteredProducts = filteredProducts.filter((product) =>
      [
        product.name,
        product.description,
        product.minecraft_id
      ].some((value) => String(value || "").toLowerCase().includes(searchTerm))
    );
  }

  if (!filteredProducts.length) {
    container.innerHTML = `
      <div class="empty-state">
        <h3>No products found</h3>
        <p>Try another category or search term.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = filteredProducts.map((product) => `
    <article class="product-card">
      <div class="product-card-image">
        ${imageMarkup(product)}
      </div>

      <div class="product-card-content">
        <span class="product-category">
          ${escapeHTML(product.category || "Items")}
        </span>

        <h3>${escapeHTML(product.name)}</h3>

        <p class="product-description">
          ${escapeHTML(product.description || "")}
        </p>

        ${productPriceMarkup(product)}

        <p class="stack-info">${stackText(product.stack_size)}</p>

        <div class="product-card-actions">
          <button class="primary-button"
            onclick="addToCart('${escapeHTML(product.id)}')">
            Add to cart
          </button>
        </div>
      </div>
    </article>
  `).join("");
}

$("product-search")?.addEventListener("input", renderProducts);

/* =========================================
   CART STORAGE AND TOTALS
========================================= */

function saveCart() {
  localStorage.setItem("bratCart", JSON.stringify(cart));
}

function getCartTotals() {
  let subtotal = 0;
  let discountTotal = 0;
  let totalItems = 0;

  for (const [productId, item] of Object.entries(cart)) {
    const product = products.find(
      (entry) => String(entry.id) === String(productId)
    );

    if (!product) continue;

    const quantity = Math.max(1, Number(item.quantity) || 1);
    const basePrice = Number(product.price) || 0;
    const salePrice = getSalePrice(product, quantity);

    subtotal += basePrice * quantity;
    discountTotal += (basePrice - salePrice) * quantity;
    totalItems += quantity;
  }

  subtotal = roundMoney(subtotal);
  discountTotal = roundMoney(discountTotal);

  return {
    subtotal,
    discountTotal,
    total: roundMoney(subtotal - discountTotal),
    totalItems
  };
}

/* =========================================
   CART ACTIONS
========================================= */

function addToCart(productId) {
  const product = products.find(
    (entry) => String(entry.id) === String(productId)
  );

  if (!product) {
    showToast("Product not found.", "error");
    return;
  }

  if (Number(product.price) <= 0) {
    showToast("This product is currently unavailable.", "error");
    return;
  }

  if (!cart[productId]) {
    cart[productId] = { quantity: 1 };
  } else {
    cart[productId].quantity += 1;
  }

  saveCart();
  renderCart();
  showToast(`${product.name} added to cart.`, "success");
}

function changeCartQuantity(productId, change) {
  if (!cart[productId]) return;

  const product = products.find(
    (entry) => String(entry.id) === String(productId)
  );

  if (!product) {
    delete cart[productId];
    saveCart();
    renderCart();
    return;
  }

  const nextQuantity =
    (Number(cart[productId].quantity) || 1) + Number(change);

  if (nextQuantity <= 0) {
    delete cart[productId];
  } else if (nextQuantity > 9999) {
    showToast("Maximum quantity reached.", "error");
    return;
  } else {
    cart[productId].quantity = nextQuantity;
  }

  saveCart();
  renderCart();
}

function removeFromCart(productId) {
  delete cart[productId];
  saveCart();
  renderCart();
  showToast("Item removed from cart.", "success");
}

function clearCart() {
  cart = {};
  saveCart();
  renderCart();
}

/* =========================================
   CART DISPLAY
========================================= */

function renderCart() {
  const container = $("cart-items");
  const totals = getCartTotals();

  setText("cart-count", totals.totalItems);
  setText("cart-subtotal", money(totals.subtotal));
  setText("cart-discount", "-" + money(totals.discountTotal));
  setText("cart-total", money(totals.total));

  if (!container) return;

  const entries = Object.entries(cart).filter(([productId]) =>
    products.some((product) => String(product.id) === String(productId))
  );

  if (!entries.length) {
    container.innerHTML = `
      <div class="empty-cart">
        <p>Your cart is empty.</p>
        <span>Browse our products and find something you need.</span>
      </div>
    `;
    return;
  }

  container.innerHTML = entries.map(([productId, item]) => {
    const product = products.find(
      (entry) => String(entry.id) === String(productId)
    );

    if (!product) return "";

    const quantity = Math.max(1, Number(item.quantity) || 1);
    const unitPrice = getSalePrice(product, quantity);

    return `
      <div class="cart-item">
        <div class="cart-item-image">
          ${imageMarkup(product, "cart-product-image")}
        </div>

        <div class="cart-item-info">
          <strong>${escapeHTML(product.name)}</strong>
          <span>${money(unitPrice)} each</span>
          <span class="cart-item-total">
            ${money(unitPrice * quantity)}
          </span>
        </div>

        <div class="cart-item-controls">
          <button onclick="changeCartQuantity('${escapeHTML(productId)}', -1)">−</button>
          <span>${quantity}</span>
          <button onclick="changeCartQuantity('${escapeHTML(productId)}', 1)">+</button>
        </div>

        <button class="remove-cart-item"
          onclick="removeFromCart('${escapeHTML(productId)}')">
          ×
        </button>
      </div>
    `;
  }).join("");
}

/* =========================================
   CART OPEN / CLOSE
========================================= */

function openCart() {
  $("cart-drawer")?.classList.add("active");
  $("cart-overlay")?.classList.add("active");
  renderCart();
}

function closeCart() {
  $("cart-drawer")?.classList.remove("active");
  $("cart-overlay")?.classList.remove("active");
}

$("cart-button")?.addEventListener("click", openCart);
$("cart-close")?.addEventListener("click", closeCart);
$("cart-overlay")?.addEventListener("click", closeCart);

/* =========================================
   CHECKOUT
========================================= */

function openCheckout() {
  if (!currentSession) {
    showToast("Please sign in before checking out.", "error");
    openLoginModal();
    return;
  }

  const totals = getCartTotals();

  if (!totals.totalItems) {
    showToast("Your cart is empty.", "error");
    return;
  }

  setText("checkout-total", money(totals.total));
  $("checkout-modal")?.classList.add("active");
  closeCart();
}

function closeCheckout() {
  $("checkout-modal")?.classList.remove("active");
}

$("checkout-button")?.addEventListener("click", openCheckout);
$("checkout-close")?.addEventListener("click", closeCheckout);

function prepareOrderItems() {
  const orderItems = [];

  for (const [productId, item] of Object.entries(cart)) {
    const product = products.find(
      (entry) => String(entry.id) === String(productId)
    );

    if (!product) continue;

    const quantity = Math.max(1, Number(item.quantity) || 1);
    const unitPrice = getSalePrice(product, quantity);

    orderItems.push({
      product_id: product.id,
      minecraft_id: product.minecraft_id || null,
      name: product.name,
      category: product.category,
      quantity,
      unit_price: unitPrice,
      total_price: roundMoney(unitPrice * quantity)
    });
  }

  return orderItems;
}

/* =========================================
   PLACE ORDER
========================================= */

async function placeOrder(event) {
  event?.preventDefault();

  if (!currentSession) {
    showToast("Please sign in first.", "error");
    return;
  }

  const totals = getCartTotals();
  const orderItems = prepareOrderItems();

  if (!totals.totalItems || !orderItems.length) {
    showToast("Your cart is empty.", "error");
    return;
  }

  const submitButton = $("place-order-button");

  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = "Processing...";
  }

  try {
    const { error } = await supabaseClient
      .from("orders")
      .insert({
        user_id: currentSession.user.id,
        request_type: "product",
        status: "pending",
        total: totals.total,
        details: {
          items: orderItems,
          subtotal: totals.subtotal,
          discount: totals.discountTotal
        }
      });

    if (error) throw error;

    clearCart();
    closeCheckout();
    showToast("Order submitted successfully!", "success");

    if (isAdmin) await loadRequests();
  } catch (error) {
    console.error("Order submission failed:", error);
    showToast(error.message || "Could not submit your order.", "error");
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = "Place order";
    }
  }
}

$("checkout-form")?.addEventListener("submit", placeOrder);
/* =========================================
   SERVICE REQUEST FORM
========================================= */

function renderServiceForm() {
  const container = $("service-form-container");
  if (!container) return;

  container.innerHTML = `
    <form id="service-request-form" class="service-form">
      <div class="form-group">
        <label for="service-type">Service</label>
        <select id="service-type" required>
          <option value="">Choose a service</option>
          <option value="Building">Building</option>
          <option value="Terraforming">Terraforming</option>
          <option value="Redstone">Redstone</option>
          <option value="Custom Item">Custom Item</option>
          <option value="Other">Other</option>
        </select>
      </div>

      <div class="form-group">
        <label for="service-title">Project title</label>
        <input type="text" id="service-title"
          maxlength="100" placeholder="What do you need?" required>
      </div>

      <div class="form-group">
        <label for="service-description">Description</label>
        <textarea id="service-description" rows="5"
          maxlength="3000" placeholder="Describe your request..."
          required></textarea>
      </div>

      <div class="form-group">
        <label for="service-budget">Your budget (KB$)</label>
        <input type="number" id="service-budget"
          min="0" step="0.01" placeholder="Optional">
      </div>

      <div class="form-group">
        <label for="service-attachment">Attachments (optional)</label>
        <input type="file" id="service-attachment"
          accept="image/*" multiple>
        <small>You can upload images to explain your project.</small>
      </div>

      <button type="submit" class="primary-button">
        Submit service request
      </button>
    </form>
  `;

  $("service-request-form")?.addEventListener(
    "submit",
    submitServiceRequest
  );
}

/* =========================================
   SERVICE IMAGE UPLOAD
========================================= */

async function uploadServiceAttachments(files) {
  const uploadedUrls = [];

  if (!files || !files.length) return uploadedUrls;

  for (const file of files) {
    if (!file.type.startsWith("image/")) {
      throw new Error("Only image files are allowed.");
    }

    if (file.size > 5 * 1024 * 1024) {
      throw new Error("Each image must be smaller than 5 MB.");
    }

    const extension = file.name.split(".").pop() || "png";
    const safeExtension = extension.toLowerCase()
      .replace(/[^a-z0-9]/g, "");

    const filePath =
      `${currentSession.user.id}/${Date.now()}-${crypto.randomUUID()}.${safeExtension}`;

    const { error } = await supabaseClient.storage
      .from("service-attachments")
      .upload(filePath, file, {
        cacheControl: "3600",
        upsert: false
      });

    if (error) throw error;

    const { data } = supabaseClient.storage
      .from("service-attachments")
      .getPublicUrl(filePath);

    if (data?.publicUrl) {
      uploadedUrls.push(data.publicUrl);
    }
  }

  return uploadedUrls;
}

/* =========================================
   SUBMIT SERVICE REQUEST
========================================= */

async function submitServiceRequest(event) {
  event.preventDefault();

  if (!currentSession) {
    showToast("Please sign in first.", "error");
    openLoginModal();
    return;
  }

  const serviceType = $("service-type")?.value;
  const title = $("service-title")?.value.trim();
  const description = $("service-description")?.value.trim();
  const budgetInput = $("service-budget")?.value;
  const files = $("service-attachment")?.files;

  if (!serviceType || !title || !description) {
    showToast("Please complete all required fields.", "error");
    return;
  }

  const budget = budgetInput === "" ? null : Number(budgetInput);

  if (budget !== null && (!Number.isFinite(budget) || budget < 0)) {
    showToast("Please enter a valid budget.", "error");
    return;
  }

  const submitButton = event.submitter;

  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = "Submitting...";
  }

  try {
    const attachmentUrls = await uploadServiceAttachments(files);

    const { error } = await supabaseClient
      .from("orders")
      .insert({
        user_id: currentSession.user.id,
        request_type: "service",
        status: "pending",
        total: budget ?? 0,
        details: {
          service_type: serviceType,
          title,
          description,
          budget,
          attachments: attachmentUrls
        }
      });

    if (error) throw error;

    event.target.reset();
    showToast("Service request submitted!", "success");

    if (isAdmin) await loadRequests();
  } catch (error) {
    console.error("Service request failed:", error);
    showToast(error.message || "Could not submit service request.", "error");
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = "Submit service request";
    }
  }
}

/* =========================================
   AUTHENTICATION
========================================= */

async function loadSession() {
  try {
    const { data, error } = await supabaseClient.auth.getSession();
    if (error) throw error;

    currentSession = data.session || null;

    if (currentSession) {
      await checkAdminRole();
    } else {
      isAdmin = false;
    }

    await updateAuthUI();
  } catch (error) {
    console.error("Session loading failed:", error);
    currentSession = null;
    isAdmin = false;
    await updateAuthUI();
  }
}

/* =========================================
   AUTH UI
========================================= */

async function updateAuthUI() {
  const loginButton = $("login-button");
  const accountButton = $("account-button");
  const adminButton = $("admin-button");

  if (currentSession) {
    const email = currentSession.user.email || "Account";

    if (loginButton) loginButton.style.display = "none";

    if (accountButton) {
      accountButton.style.display = "";
      accountButton.textContent = email;
    }

    if (adminButton) {
      adminButton.style.display = isAdmin ? "" : "none";
    }
  } else {
    if (loginButton) loginButton.style.display = "";

    if (accountButton) accountButton.style.display = "none";
    if (adminButton) adminButton.style.display = "none";
  }
}

/* =========================================
   ADMIN ROLE CHECK
========================================= */

async function checkAdminRole() {
  if (!currentSession) {
    isAdmin = false;
    await updateAuthUI();
    return false;
  }

  try {
    const { data, error } = await supabaseClient
      .from("profiles")
      .select("role")
      .eq("id", currentSession.user.id)
      .maybeSingle();

    if (error) throw error;

    isAdmin = ["admin", "editor"].includes(data?.role);

    await updateAuthUI();
    return isAdmin;
  } catch (error) {
    console.error("Admin role check failed:", error);
    isAdmin = false;
    await updateAuthUI();
    return false;
  }
}

/* =========================================
   LOGIN MODAL
========================================= */

function openLoginModal() {
  $("login-modal")?.classList.add("active");
}

function closeLoginModal() {
  $("login-modal")?.classList.remove("active");
}

$("login-button")?.addEventListener("click", openLoginModal);
$("login-close")?.addEventListener("click", closeLoginModal);

/* =========================================
   SIGN IN
========================================= */

async function signIn(event) {
  event?.preventDefault();

  const email = $("login-email")?.value.trim();
  const password = $("login-password")?.value;

  if (!email || !password) {
    showToast("Enter your email and password.", "error");
    return;
  }

  const submitButton = $("login-submit");

  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = "Signing in...";
  }

  try {
    const { data, error } = await supabaseClient.auth
      .signInWithPassword({ email, password });

    if (error) throw error;

    currentSession = data.session;

    await checkAdminRole();
    await updateAuthUI();

    closeLoginModal();
    showToast("Welcome back!", "success");

    if (isAdmin) {
      await loadRequests();
      await loadCatalogProducts();
    }
  } catch (error) {
    console.error("Login failed:", error);
    showToast(error.message || "Login failed.", "error");
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = "Sign in";
    }
  }
}

$("login-form")?.addEventListener("submit", signIn);

/* =========================================
   SIGN OUT
========================================= */

async function signOut() {
  try {
    const { error } = await supabaseClient.auth.signOut();
    if (error) throw error;

    currentSession = null;
    isAdmin = false;

    await updateAuthUI();

    closeAdmin();
    closeCart();

    showToast("You have been signed out.", "success");
  } catch (error) {
    console.error("Sign out failed:", error);
    showToast("Could not sign out.", "error");
  }
}

$("sign-out-button")?.addEventListener("click", signOut);

/* =========================================
   ACCOUNT BUTTON
========================================= */

$("account-button")?.addEventListener("click", () => {
  if (!currentSession) return;

  const accountModal = $("account-modal");

  if (accountModal) {
    accountModal.classList.add("active");
  } else {
    showToast(currentSession.user.email || "Signed in", "info");
  }
});

$("account-close")?.addEventListener("click", () => {
  $("account-modal")?.classList.remove("active");
});

/* =========================================
   AUTH STATE CHANGES
========================================= */

supabaseClient.auth.onAuthStateChange((_event, session) => {
  currentSession = session || null;

  setTimeout(async () => {
    await checkAdminRole();

    if (isAdmin) {
      await loadRequests();
      await loadCatalogProducts();
    }
  }, 0);
});

/* =========================================
   ADMIN DASHBOARD
========================================= */

async function openAdmin() {
  if (!currentSession) {
    showToast("Please sign in first.", "error");
    openLoginModal();
    return;
  }

  const allowed = await checkAdminRole();

  if (!allowed) {
    showToast("You do not have admin permissions.", "error");
    return;
  }

  if ($("offers-section")) $("offers-section").style.display = "none";
  if ($("shop-section")) $("shop-section").style.display = "none";
  if ($("admin-section")) $("admin-section").style.display = "";

  document.querySelectorAll(".nav-link").forEach((link) => {
    link.classList.remove("active");
  });

  await loadRequests();
  await loadCatalogProducts();
}

function closeAdmin() {
  if ($("admin-section")) {
    $("admin-section").style.display = "none";
  }

  showCategory("All");
}

$("admin-button")?.addEventListener("click", openAdmin);
$("admin-close")?.addEventListener("click", closeAdmin);

/* =========================================
   ADMIN ORDERS
========================================= */

async function loadRequests() {
  if (!isAdmin || !currentSession) return;

  try {
    const { data, error } = await supabaseClient
      .from("orders")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    requests = data || [];

    renderRequests();
    updateAdminStats();
  } catch (error) {
    console.error("Could not load orders:", error);

    const container = $("admin-orders");

    if (container) {
      container.innerHTML = `
        <div class="empty-state">
          <h3>Orders could not be loaded</h3>
          <p>Please check your Supabase permissions.</p>
        </div>
      `;
    }
  }
}

/* =========================================
   ADMIN STATISTICS
========================================= */

function updateAdminStats() {
  const pendingOrders = requests.filter(
    (request) => request.status === "pending"
  ).length;

  const completedOrders = requests.filter(
    (request) => request.status === "completed"
  ).length;

  const revenue = requests
    .filter((request) => request.status === "completed")
    .reduce((sum, request) => sum + (Number(request.total) || 0), 0);

  setText("admin-total-orders", requests.length);
  setText("admin-pending-orders", pendingOrders);
  setText("admin-completed-orders", completedOrders);
  setText("admin-revenue", money(revenue));
}

/* =========================================
   ADMIN ORDER FILTER
========================================= */

function filterRequests(filter) {
  currentRequestFilter = filter;

  document.querySelectorAll(".order-filter").forEach((button) => {
    button.classList.toggle(
      "active",
      button.dataset.filter === filter
    );
  });

  renderRequests();
}

document.querySelectorAll(".order-filter").forEach((button) => {
  button.addEventListener("click", () => {
    filterRequests(button.dataset.filter || "all");
  });
});

/* =========================================
   ADMIN ORDER DISPLAY
========================================= */

function renderRequests() {
  const container = $("admin-orders");
  if (!container) return;

  let filteredRequests = [...requests];

  if (currentRequestFilter !== "all") {
    filteredRequests = filteredRequests.filter(
      (request) => request.status === currentRequestFilter
    );
  }

  if (!filteredRequests.length) {
    container.innerHTML = `
      <div class="empty-state">
        <h3>No orders found</h3>
        <p>There are currently no orders in this category.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = filteredRequests.map((request) => {
    const details = request.details || {};
    const isService = request.request_type === "service";

    let content = "";

    if (isService) {
      const attachments = Array.isArray(details.attachments)
        ? details.attachments
        : [];

      content = `
        <div class="order-details">
          <p><strong>Service:</strong>
            ${escapeHTML(details.service_type || "Other")}
          </p>

          <p><strong>Project:</strong>
            ${escapeHTML(details.title || "Untitled")}
          </p>

          <p><strong>Description:</strong>
            ${escapeHTML(details.description || "")}
          </p>

          <p><strong>Budget:</strong>
            ${details.budget == null ? "Not specified" : money(details.budget)}
          </p>

          <div class="order-attachments">
            ${attachments.map((url) => {
              const safeUrl = safeExternalUrl(url);

              return safeUrl
                ? `<a href="${escapeHTML(safeUrl)}" target="_blank" rel="noopener noreferrer">View attachment</a>`
                : "";
            }).join("")}
          </div>
        </div>
      `;
    } else {
      const items = Array.isArray(details.items) ? details.items : [];

      content = `
        <div class="order-details">
          ${items.length ? items.map((item) => `
            <div class="order-line">
              <span>
                ${escapeHTML(item.name || "Product")}
                × ${Number(item.quantity) || 1}
              </span>
              <strong>${money(item.total_price || 0)}</strong>
            </div>
          `).join("") : "<p>No item details available.</p>"}
        </div>
      `;
    }

    return `
      <article class="admin-order-card">
        <div class="admin-order-header">
          <div>
            <strong>Order #${escapeHTML(request.id)}</strong>
            <span>${formatDate(request.created_at)}</span>
          </div>

          <span class="status-badge status-${escapeHTML(request.status)}">
            ${escapeHTML(request.status || "pending")}
          </span>
        </div>

        <div class="admin-order-meta">
          <span>${isService ? "Service request" : "Product order"}</span>
          <strong>${money(request.total || 0)}</strong>
        </div>

        ${content}

        <div class="admin-order-actions">
          <label for="status-${escapeHTML(request.id)}">Update status</label>

          <select id="status-${escapeHTML(request.id)}"
            onchange="updateRequestStatus('${escapeHTML(request.id)}', this.value)">
            <option value="pending" ${request.status === "pending" ? "selected" : ""}>Pending</option>
            <option value="processing" ${request.status === "processing" ? "selected" : ""}>Processing</option>
            <option value="completed" ${request.status === "completed" ? "selected" : ""}>Completed</option>
            <option value="cancelled" ${request.status === "cancelled" ? "selected" : ""}>Cancelled</option>
          </select>
        </div>
      </article>
    `;
  }).join("");
}

/* =========================================
   UPDATE ORDER STATUS
========================================= */

async function updateRequestStatus(requestId, status) {
  if (!isAdmin) {
    showToast("Admin permissions required.", "error");
    return;
  }

  const allowedStatuses = [
    "pending",
    "processing",
    "completed",
    "cancelled"
  ];

  if (!allowedStatuses.includes(status)) {
    showToast("Invalid order status.", "error");
    return;
  }

  try {
    const { error } = await supabaseClient
      .from("orders")
      .update({ status })
      .eq("id", requestId);

    if (error) throw error;

    const request = requests.find(
      (entry) => String(entry.id) === String(requestId)
    );

    if (request) request.status = status;

    renderRequests();
    updateAdminStats();

    showToast("Order status updated.", "success");
  } catch (error) {
    console.error("Status update failed:", error);
    showToast("Could not update order status.", "error");
    await loadRequests();
  }
}
/* =========================================
   SURVIVAL CATALOGUE
========================================= */

const MINECRAFT_VERSION = "26.2";
const CATALOG_IMPORT_BATCH_SIZE = 100;

/*
  Unterstützte Importdateien:
  - JSON
  - CSV

  Die JSON-Datei kann ein Array oder ein Objekt
  mit items, entries oder item_components enthalten.
*/

function normalizeMinecraftId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^minecraft:/, "")
    .replace(/\s+/g, "_");
}

function normalizeMinecraftName(value) {
  return String(value || "")
    .replace(/^minecraft:/i, "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getMinecraftCategory(id, name) {
  const value = `${id} ${name}`.toLowerCase();

  if (
    /sword|axe|pickaxe|shovel|hoe|bow|crossbow|trident|shield|helmet|chestplate|leggings|boots|mace|spear|armor|armour/.test(value)
  ) {
    return "Armor & Weapons";
  }

  if (
    /enchanted_book|enchanting|experience_bottle|anvil|grindstone|enchantment/.test(value)
  ) {
    return "Enchantments";
  }

  if (
    /stone|dirt|grass_block|sand|gravel|ore|block|planks|log|wood|wool|glass|concrete|terracotta|brick|slab|stairs|fence|wall|door|trapdoor|leaves|sapling|obsidian|deepslate|netherrack|basalt|ore|cobblestone/.test(value)
  ) {
    return "Blocks";
  }

  if (
    /service|command|teleport|repair|build/.test(value)
  ) {
    return "Services";
  }

  return "Items";
}

function getImportedStackSize(item) {
  const candidates = [
    item.max_stack_size,
    item.maxStackSize,
    item.stack_size,
    item.stackSize,
    item.max_count,
    item.maxCount
  ];

  for (const candidate of candidates) {
    const number = Number(candidate);

    if (Number.isFinite(number) && number > 0) {
      return Math.min(number, 999);
    }
  }

  return 64;
}

function normalizeImportedProduct(item) {
  if (typeof item === "string") {
    item = { id: item };
  }

  if (!item || typeof item !== "object") return null;

  const rawId =
    item.id ||
    item.name ||
    item.item_id ||
    item.identifier ||
    item.translation_key ||
    item.translationKey;

  if (!rawId) return null;

  const id = normalizeMinecraftId(rawId);

  if (!id || id.includes(" ")) return null;

  const rawName =
    item.english_name ||
    item.englishName ||
    item.display_name ||
    item.displayName ||
    item.translation ||
    item.name ||
    id;

  const name = normalizeMinecraftName(rawName);

  if (!name) return null;

  const category = getMinecraftCategory(id, name);

  return {
    name,
    category,
    description: `Minecraft ${MINECRAFT_VERSION} survival item. ID: minecraft:${id}`,
    price: 0,
    stack_size: getImportedStackSize(item),
    discount_percent: 0,
    is_active: false,

    // These two values are retained in the import object.
    // They are only saved if the database columns exist.
    minecraft_id: id,
    minecraft_version: MINECRAFT_VERSION
  };
}

/* =========================================
   REGISTRY JSON EXTRACTION
========================================= */

function extractRegistryProducts(data) {
  if (Array.isArray(data)) return data;

  if (!data || typeof data !== "object") {
    throw new Error("The imported file does not contain valid JSON data.");
  }

  const candidates = [
    data.items,
    data.entries,
    data.products,
    data.item_components,
    data.item_lists?.filtered_by_survival_obtained?.entries,
    data.item_lists?.survival?.entries,
    data.survival_items
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length) {
      return candidate;
    }
  }

  /*
    Some registry exports use an object where
    the item ID is the key.
  */
  if (data.item_components && typeof data.item_components === "object") {
    return Object.entries(data.item_components).map(([id, value]) => ({
      id,
      ...(typeof value === "object" ? value : {})
    }));
  }

  throw new Error(
    "No item list found. Please use a JSON file containing items, entries or item_components."
  );
}

/* =========================================
   CSV PARSER
========================================= */

function parseCatalogCSV(text) {
  const rows = [];
  let row = [];
  let value = "";
  let insideQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const character = text[i];
    const next = text[i + 1];

    if (character === '"' && insideQuotes && next === '"') {
      value += '"';
      i++;
    } else if (character === '"') {
      insideQuotes = !insideQuotes;
    } else if (character === "," && !insideQuotes) {
      row.push(value);
      value = "";
    } else if (
      (character === "\n" || character === "\r") &&
      !insideQuotes
    ) {
      if (character === "\r" && next === "\n") i++;

      row.push(value);

      if (row.some((cell) => cell.trim() !== "")) {
        rows.push(row);
      }

      row = [];
      value = "";
    } else {
      value += character;
    }
  }

  row.push(value);

  if (row.some((cell) => cell.trim() !== "")) {
    rows.push(row);
  }

  if (rows.length < 2) return [];

  const headers = rows[0].map((header) =>
    header.trim().toLowerCase()
  );

  return rows.slice(1).map((cells) => {
    const item = {};

    headers.forEach((header, index) => {
      item[header] = cells[index] ?? "";
    });

    return item;
  });
}

/* =========================================
   DATABASE COLUMN DETECTION
========================================= */

let catalogHasMinecraftId = false;
let catalogHasMinecraftVersion = false;

async function detectCatalogColumns() {
  /*
    Probe the columns individually. If they do not exist,
    the normal catalogue still works without them.
  */

  const idProbe = await supabaseClient
    .from("products")
    .select("minecraft_id")
    .limit(1);

  catalogHasMinecraftId = !idProbe.error;

  const versionProbe = await supabaseClient
    .from("products")
    .select("minecraft_version")
    .limit(1);

  catalogHasMinecraftVersion = !versionProbe.error;
}

/* =========================================
   EXISTING PRODUCT LOOKUP
========================================= */

async function getExistingCatalogIds() {
  const existingIds = new Set();
  const existingNames = new Set();

  const { data, error } = await supabaseClient
    .from("products")
    .select("id,name");

  if (error) throw error;

  (data || []).forEach((product) => {
    if (product.name) {
      existingNames.add(
        product.name.trim().toLowerCase()
      );
    }
  });

  if (catalogHasMinecraftId) {
    const { data: idData, error: idError } = await supabaseClient
      .from("products")
      .select("minecraft_id");

    if (!idError) {
      (idData || []).forEach((product) => {
        if (product.minecraft_id) {
          existingIds.add(
            normalizeMinecraftId(product.minecraft_id)
          );
        }
      });
    }
  }

  return { existingIds, existingNames };
}

/* =========================================
   IMPORT SURVIVAL CATALOGUE
========================================= */

async function importSurvivalCatalog(file) {
  if (!isAdmin) {
    showToast("Admin permissions required.", "error");
    return;
  }

  if (!file) {
    showToast("Please select a file first.", "error");
    return;
  }

  const extension = file.name.split(".").pop().toLowerCase();

  if (!["json", "csv"].includes(extension)) {
    showToast("Please select a JSON or CSV file.", "error");
    return;
  }

  const importButton = $("catalog-import-button");

  if (importButton) {
    importButton.disabled = true;
    importButton.textContent = "Importing...";
  }

  try {
    let rawItems = [];

    if (extension === "json") {
      const content = await file.text();
      const parsed = JSON.parse(content);
      rawItems = extractRegistryProducts(parsed);
    } else {
      rawItems = parseCatalogCSV(await file.text());
    }

    const normalized = rawItems
      .map(normalizeImportedProduct)
      .filter(Boolean);

    if (!normalized.length) {
      throw new Error("No usable Minecraft items were found.");
    }

    await detectCatalogColumns();

    const {
      existingIds,
      existingNames
    } = await getExistingCatalogIds();

    const newProducts = normalized.filter((product) => {
      const idExists = existingIds.has(product.minecraft_id);

      const nameExists = existingNames.has(
        product.name.toLowerCase()
      );

      return !idExists && !nameExists;
    });

    if (!newProducts.length) {
      showToast("All imported items already exist.", "info");
      return;
    }

    const insertRows = newProducts.map((product) => {
      const row = {
        name: product.name,
        category: product.category,
        description: product.description,
        price: 0,
        stack_size: product.stack_size,
        discount_percent: 0,
        is_active: false
      };

      if (catalogHasMinecraftId) {
        row.minecraft_id = product.minecraft_id;
      }

      if (catalogHasMinecraftVersion) {
        row.minecraft_version = product.minecraft_version;
      }

      return row;
    });

    let insertedCount = 0;

    for (
      let index = 0;
      index < insertRows.length;
      index += CATALOG_IMPORT_BATCH_SIZE
    ) {
      const batch = insertRows.slice(
        index,
        index + CATALOG_IMPORT_BATCH_SIZE
      );

      const { error } = await supabaseClient
        .from("products")
        .insert(batch);

      if (error) throw error;

      insertedCount += batch.length;
    }

    await loadCatalogProducts();
    await loadProducts();

    showToast(
      `${insertedCount} new items imported. Set prices and publish them in the admin area.`,
      "success"
    );
  } catch (error) {
    console.error("Catalogue import failed:", error);
    showToast(error.message || "Catalogue import failed.", "error");
  } finally {
    if (importButton) {
      importButton.disabled = false;
      importButton.textContent = "Import catalogue";
    }
  }
}

/* =========================================
   IMPORT FILE LISTENER
========================================= */

$("catalog-import-file")?.addEventListener("change", (event) => {
  const file = event.target.files?.[0];

  if (!file) return;

  importSurvivalCatalog(file);

  event.target.value = "";
});

/* =========================================
   CATALOGUE ADMIN
========================================= */

async function loadCatalogProducts() {
  if (!isAdmin || !currentSession) return;

  const container =
    $("catalog-products") ||
    $("admin-products");

  if (!container) return;

  container.innerHTML = `
    <div class="loading-state">Loading catalogue...</div>
  `;

  try {
    const { data, error } = await supabaseClient
      .from("products")
      .select("*")
      .order("name", { ascending: true });

    if (error) throw error;

    catalogCache = data || [];

    renderCatalogProducts();
  } catch (error) {
    console.error("Catalogue loading failed:", error);

    container.innerHTML = `
      <div class="empty-state">
        <h3>Catalogue could not be loaded</h3>
        <p>${escapeHTML(error.message)}</p>
      </div>
    `;
  }
}

/* =========================================
   CATALOGUE SEARCH
========================================= */

function renderCatalogProducts() {
  const container =
    $("catalog-products") ||
    $("admin-products");

  if (!container) return;

  const search =
    $("catalog-search")?.value.trim().toLowerCase() ||
    $("admin-product-search")?.value.trim().toLowerCase() ||
    "";

  const filtered = catalogCache.filter((product) => {
    const text = [
      product.name,
      product.category,
      product.description,
      product.minecraft_id
    ].join(" ").toLowerCase();

    return text.includes(search);
  });

  if (!filtered.length) {
    container.innerHTML = `
      <div class="empty-state">
        <h3>No products found</h3>
        <p>Try another search or import more items.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map((product) => {
    const active = Boolean(product.is_active);

    return `
      <article class="catalog-admin-card">
        <div class="catalog-admin-image">
          ${imageMarkup(product)}
        </div>

        <div class="catalog-admin-info">
          <h3>${escapeHTML(product.name)}</h3>

          <p>${escapeHTML(product.category || "Items")}</p>

          <small>
            ${escapeHTML(product.minecraft_id || "Manual product")}
          </small>

          <div class="catalog-admin-meta">
            <span>${Number(product.stack_size) || 64} per stack</span>
            <strong>${money(product.price || 0)}</strong>
          </div>

          <span class="catalog-status ${active ? "published" : "draft"}">
            ${active ? "Published" : "Unpublished"}
          </span>
        </div>

        <div class="catalog-admin-actions">
          <button class="secondary-button"
            onclick="editCatalogProduct('${escapeHTML(product.id)}')">
            Edit
          </button>

          <button class="${active ? "danger-button" : "primary-button"}"
            onclick="toggleCatalogProduct('${escapeHTML(product.id)}', ${!active})">
            ${active ? "Unpublish" : "Publish"}
          </button>
        </div>
      </article>
    `;
  }).join("");
}

$("catalog-search")?.addEventListener("input", renderCatalogProducts);
$("admin-product-search")?.addEventListener("input", renderCatalogProducts);

/* =========================================
   EDIT CATALOGUE PRODUCT
========================================= */

function editCatalogProduct(productId) {
  const product = catalogCache.find(
    (entry) => String(entry.id) === String(productId)
  );

  if (!product) {
    showToast("Product not found.", "error");
    return;
  }

  editingProductId = product.id;

  const modal = $("product-editor-modal");

  if (!modal) {
    showToast("Product editor is missing from the page.", "error");
    return;
  }

  modal.innerHTML = `
    <div class="modal-backdrop" onclick="closeCatalogEditor()"></div>

    <div class="modal-content">
      <button class="modal-close" onclick="closeCatalogEditor()">×</button>

      <h2>Edit product</h2>

      <form id="catalog-product-form">
        <label>Product name</label>
        <input id="catalog-edit-name" maxlength="100"
          value="${escapeHTML(product.name)}" required>

        <label>Category</label>
        <select id="catalog-edit-category">
          ${[
            "Blocks",
            "Items",
            "Armor & Weapons",
            "Enchantments",
            "Services"
          ].map((categoryName) => `
            <option value="${escapeHTML(categoryName)}"
              ${product.category === categoryName ? "selected" : ""}>
              ${escapeHTML(categoryName)}
            </option>
          `).join("")}
        </select>

        <label>Description</label>
        <textarea id="catalog-edit-description" rows="3">${escapeHTML(product.description || "")}</textarea>

        <label>Price (KB$)</label>
        <input id="catalog-edit-price" type="number"
          min="0" step="0.01"
          value="${Number(product.price) || 0}" required>

        <label>Stack size</label>
        <input id="catalog-edit-stack" type="number"
          min="1" max="999"
          value="${Number(product.stack_size) || 64}" required>

        <label>Discount (%)</label>
        <input id="catalog-edit-discount" type="number"
          min="0" max="99"
          value="${Number(product.discount_percent) || 0}">

        <label class="checkbox-label">
          <input id="catalog-edit-active" type="checkbox"
            ${product.is_active ? "checked" : ""}>
          Publish product in shop
        </label>

        <button type="submit" class="primary-button">
          Save product
        </button>
      </form>
    </div>
  `;

  modal.classList.add("active");

  $("catalog-product-form")?.addEventListener(
    "submit",
    saveCatalogProduct
  );
}

function closeCatalogEditor() {
  $("product-editor-modal")?.classList.remove("active");
  editingProductId = null;
}

/* =========================================
   SAVE CATALOGUE PRODUCT
========================================= */

async function saveCatalogProduct(event) {
  event.preventDefault();

  if (!isAdmin || !editingProductId) return;

  const name = $("catalog-edit-name")?.value.trim();
  const categoryValue = $("catalog-edit-category")?.value;
  const description = $("catalog-edit-description")?.value.trim();
  const price = Number($("catalog-edit-price")?.value);
  const stackSize = Number($("catalog-edit-stack")?.value);
  const discount = Number($("catalog-edit-discount")?.value);
  const isActive = $("catalog-edit-active")?.checked || false;

  if (!name || !Number.isFinite(price) || price < 0) {
    showToast("Enter a valid product name and price.", "error");
    return;
  }

  if (
    !Number.isInteger(stackSize) ||
    stackSize < 1 ||
    stackSize > 999
  ) {
    showToast("Stack size must be between 1 and 999.", "error");
    return;
  }

  if (
    !Number.isFinite(discount) ||
    discount < 0 ||
    discount > 99
  ) {
    showToast("Discount must be between 0 and 99.", "error");
    return;
  }

  try {
    const { error } = await supabaseClient
      .from("products")
      .update({
        name,
        category: categoryValue,
        description,
        price,
        stack_size: stackSize,
        discount_percent: discount,
        is_active: isActive
      })
      .eq("id", editingProductId);

    if (error) throw error;

    closeCatalogEditor();

    await loadCatalogProducts();
    await loadProducts();

    showToast("Product saved successfully.", "success");
  } catch (error) {
    console.error("Product save failed:", error);
    showToast(error.message || "Could not save product.", "error");
  }
}

/* =========================================
   PUBLISH / UNPUBLISH PRODUCT
========================================= */

async function toggleCatalogProduct(productId, publish) {
  if (!isAdmin) return;

  const product = catalogCache.find(
    (entry) => String(entry.id) === String(productId)
  );

  if (!product) return;

  if (publish && Number(product.price) <= 0) {
    showToast("Set a price above 0 KB$ before publishing.", "error");
    editCatalogProduct(productId);
    return;
  }

  try {
    const { error } = await supabaseClient
      .from("products")
      .update({ is_active: Boolean(publish) })
      .eq("id", productId);

    if (error) throw error;

    await loadCatalogProducts();
    await loadProducts();

    showToast(
      publish ? "Product published." : "Product unpublished.",
      "success"
    );
  } catch (error) {
    console.error("Publishing failed:", error);
    showToast(error.message || "Could not update product.", "error");
  }
}

/* =========================================
   CREATE MANUAL PRODUCT
========================================= */

async function createManualCatalogProduct() {
  if (!isAdmin) return;

  const name = prompt("Product name:");

  if (!name?.trim()) return;

  const categoryValue = prompt(
    "Category: Blocks, Items, Armor & Weapons, Enchantments or Services",
    "Items"
  );

  const validCategories = [
    "Blocks",
    "Items",
    "Armor & Weapons",
    "Enchantments",
    "Services"
  ];

  if (!validCategories.includes(categoryValue)) {
    showToast("Invalid category.", "error");
    return;
  }

  try {
    const { error } = await supabaseClient
      .from("products")
      .insert({
        name: name.trim(),
        category: categoryValue,
        description: "",
        price: 0,
        stack_size: 64,
        discount_percent: 0,
        is_active: false
      });

    if (error) throw error;

    await loadCatalogProducts();

    showToast("Draft product created.", "success");
  } catch (error) {
    console.error("Product creation failed:", error);
    showToast(error.message || "Could not create product.", "error");
  }
}

$("catalog-add-button")?.addEventListener(
  "click",
  createManualCatalogProduct
);

/* =========================================
   CATALOGUE IMPORT BUTTON
========================================= */

$("catalog-import-button")?.addEventListener("click", () => {
  $("catalog-import-file")?.click();
});

/* =========================================
   REFRESH ADMIN DATA
========================================= */

$("refresh-requests")?.addEventListener("click", async () => {
  await loadRequests();
  showToast("Orders refreshed.", "success");
});

/* =========================================
   INITIALIZE SHOP
========================================= */

async function initializeShop() {
  try {
    await loadSession();

    await loadProducts();

    renderCart();

    renderServiceForm();

    if (isAdmin) {
      await loadRequests();
      await loadCatalogProducts();
    }

    showCategory("All");

    console.log(
      `Brat Ltd. Marketplace initialized — Minecraft ${MINECRAFT_VERSION}`
    );
  } catch (error) {
    console.error("Shop initialization failed:", error);
    showToast("The shop could not be initialized.", "error");
  }
}

/* =========================================
   START APPLICATION
========================================= */

document.addEventListener("DOMContentLoaded", () => {
  initializeShop();
});
