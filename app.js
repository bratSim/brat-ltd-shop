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

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

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
  const name = String(product?.name || "").trim();

  if (textureAliases[name]) {
    return textureAliases[name];
  }

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

  let folder = "item";

  if (categoryName === "blocks") {
    folder = "block";
  }

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

  const entries = Object.entries(cart);

  for (const [productId, item] of entries) {
    const product = products.find(
      (entry) => String(entry.id) === String(productId)
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

  document.querySelectorAll(".nav-link").forEach((link) => {
    link.classList.toggle(
      "active",
      link.dataset.category === selectedCategory
    );
  });

  const offersSection = $("offers-section");
  const shopSection = $("shop-section");
  const adminSection = $("admin-section");

  if (adminSection) {
    adminSection.style.display = "none";
  }

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

    const selectedCategory = link.dataset.category;

    if (selectedCategory) {
      showCategory(selectedCategory);
    }
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

  const offers = products.filter((product) => {
    return Number(product.discount_percent) > 0;
  });

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
    description.textContent =
      categoryDescriptions[category] || "";
  }

  if (category === "Services") {
    container.innerHTML = `
      <div class="service-placeholder">
        <h3>Custom Services</h3>
        <p>Choose a service and send us your request.</p>
      </div>
    `;

    if (typeof renderServiceForm === "function") {
      renderServiceForm();
    }

    return;
  }

  let filteredProducts = products;

  if (category !== "All") {
    filteredProducts = products.filter((product) => {
      return product.category === category;
    });
  }

  const searchInput = $("product-search");
  const searchTerm = searchInput
    ? searchInput.value.trim().toLowerCase()
    : "";

  if (searchTerm) {
    filteredProducts = filteredProducts.filter((product) => {
      return (
        String(product.name || "").toLowerCase().includes(searchTerm) ||
        String(product.description || "").toLowerCase().includes(searchTerm)
      );
    });
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

  container.innerHTML = filteredProducts.map((product) => {
    return `
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
    `;
  }).join("");
}

/* =========================================
   PRODUCT SEARCH
========================================= */

const productSearchInput = $("product-search");

if (productSearchInput) {
  productSearchInput.addEventListener("input", () => {
    renderProducts();
  });
}

/* =========================================
   PRODUCT EDITOR
========================================= */

function openProductEditor(productId) {
  if (!isAdmin) return;

  const product = products.find(
    (entry) => String(entry.id) === String(productId)
  );

  if (!product) return;

  editingProductId = product.id;

  const modal = $("product-editor-modal");

  if (!modal) return;

  const nameInput = $("edit-product-name");
  const categoryInput = $("edit-product-category");
  const priceInput = $("edit-product-price");
  const stackInput = $("edit-product-stack");
  const discountInput = $("edit-product-discount");
  const activeInput = $("edit-product-active");

  if (nameInput) nameInput.value = product.name || "";

  if (categoryInput) {
    categoryInput.value = product.category || "Items";
  }

  if (priceInput) {
    priceInput.value = Number(product.price) || 0;
  }

  if (stackInput) {
    stackInput.value = Number(product.stack_size) || 64;
  }

  if (discountInput) {
    discountInput.value = Number(product.discount_percent) || 0;
  }

  if (activeInput) {
    activeInput.checked = Boolean(product.is_active);
  }

  modal.classList.add("active");
}

function closeProductEditor() {
  const modal = $("product-editor-modal");

  if (modal) {
    modal.classList.remove("active");
  }

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
    !Number.isFinite(stackSize) ||
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

  const { error } = await supabaseClient
    .from("products")
    .update({
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
   AUTHENTICATION
========================================= */

async function loadSession() {
  try {
    const { data, error } = await supabaseClient.auth.getSession();

    if (error) throw error;

    currentSession = data.session || null;

    await updateAuthUI();

    if (currentSession) {
      await checkAdminRole();
    } else {
      isAdmin = false;
    }
  } catch (error) {
    console.error("Session loading failed:", error);
    currentSession = null;
    isAdmin = false;
    updateAuthUI();
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

    if (accountButton) {
      accountButton.style.display = "none";
    }

    if (adminButton) {
      adminButton.style.display = "none";
    }
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
  const modal = $("login-modal");

  if (modal) {
    modal.classList.add("active");
  }
}

function closeLoginModal() {
  const modal = $("login-modal");

  if (modal) {
    modal.classList.remove("active");
  }
}

const loginButton = $("login-button");

if (loginButton) {
  loginButton.addEventListener("click", openLoginModal);
}

const loginCloseButton = $("login-close");

if (loginCloseButton) {
  loginCloseButton.addEventListener("click", closeLoginModal);
}

/* =========================================
   SIGN IN
========================================= */

async function signIn(event) {
  if (event) event.preventDefault();

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
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email,
      password
    });

    if (error) throw error;

    currentSession = data.session;

    await checkAdminRole();
    await updateAuthUI();

    closeLoginModal();

    showToast("Welcome back!", "success");

    if (isAdmin) {
      await loadRequests();
    }
  } catch (error) {
    console.error("Login failed:", error);

    showToast(
      error.message || "Login failed.",
      "error"
    );
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = "Sign in";
    }
  }
}

const loginForm = $("login-form");

if (loginForm) {
  loginForm.addEventListener("submit", signIn);
}

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

const signOutButton = $("sign-out-button");

if (signOutButton) {
  signOutButton.addEventListener("click", signOut);
}

/* =========================================
   ACCOUNT BUTTON
========================================= */

const accountButton = $("account-button");

if (accountButton) {
  accountButton.addEventListener("click", () => {
    if (!currentSession) return;

    const accountModal = $("account-modal");

    if (accountModal) {
      accountModal.classList.add("active");
    } else {
      showToast(
        currentSession.user.email || "Signed in",
        "info"
      );
    }
  });
}

const accountCloseButton = $("account-close");

if (accountCloseButton) {
  accountCloseButton.addEventListener("click", () => {
    $("account-modal")?.classList.remove("active");
  });
}

/* =========================================
   AUTH STATE CHANGES
========================================= */

supabaseClient.auth.onAuthStateChange((_event, session) => {
  currentSession = session || null;

  setTimeout(async () => {
    await checkAdminRole();

    if (isAdmin) {
      await loadRequests();
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

  const offersSection = $("offers-section");
  const shopSection = $("shop-section");
  const adminSection = $("admin-section");

  if (offersSection) offersSection.style.display = "none";
  if (shopSection) shopSection.style.display = "none";

  if (adminSection) {
    adminSection.style.display = "";
  }

  document.querySelectorAll(".nav-link").forEach((link) => {
    link.classList.remove("active");
  });

  await loadRequests();
  await loadCatalogProducts();
}

function closeAdmin() {
  const adminSection = $("admin-section");

  if (adminSection) {
    adminSection.style.display = "none";
  }

  showCategory("All");
}

const adminButton = $("admin-button");

if (adminButton) {
  adminButton.addEventListener("click", openAdmin);
}

const adminCloseButton = $("admin-close");

if (adminCloseButton) {
  adminCloseButton.addEventListener("click", closeAdmin);
}

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
  const totalOrders = requests.length;

  const pendingOrders = requests.filter(
    (request) => request.status === "pending"
  ).length;

  const completedOrders = requests.filter(
    (request) => request.status === "completed"
  ).length;

  const revenue = requests
    .filter((request) => request.status === "completed")
    .reduce((sum, request) => {
      return sum + (Number(request.total) || 0);
    }, 0);

  setText("admin-total-orders", totalOrders);
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
    filteredRequests = filteredRequests.filter((request) => {
      return request.status === currentRequestFilter;
    });
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
            ${details.budget === null || details.budget === undefined
              ? "Not specified"
              : money(details.budget)}
          </p>

          ${
            Array.isArray(details.attachments) &&
            details.attachments.length
              ? `
                <div class="order-attachments">
                  ${details.attachments.map((url) => {
                    const safeUrl = safeExternalUrl(url);

                    return safeUrl
                      ? `<a href="${escapeHTML(safeUrl)}" target="_blank" rel="noopener noreferrer">View attachment</a>`
                      : "";
                  }).join("")}
                </div>
              `
              : ""
          }
        </div>
      `;
    } else {
      const items = Array.isArray(details.items)
        ? details.items
        : [];

      content = `
        <div class="order-details">
          ${
            items.length
              ? items.map((item) => `
                  <div class="order-line">
                    <span>
                      ${escapeHTML(item.name || "Product")}
                      × ${Number(item.quantity) || 1}
                    </span>

                    <strong>
                      ${money(item.total_price || 0)}
                    </strong>
                  </div>
                `).join("")
              : "<p>No item details available.</p>"
          }
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
          <span>
            ${isService ? "Service request" : "Product order"}
          </span>

          <strong>${money(request.total || 0)}</strong>
        </div>

        ${content}

        <div class="admin-order-actions">
          <label for="status-${escapeHTML(request.id)}">
            Update status
          </label>

          <select
            id="status-${escapeHTML(request.id)}"
            onchange="updateRequestStatus('${escapeHTML(request.id)}', this.value)"
          >
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
      .update({
        status
      })
      .eq("id", requestId);

    if (error) throw error;

    const request = requests.find(
      (entry) => String(entry.id) === String(requestId)
    );

    if (request) {
      request.status = status;
    }

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
   ADMIN PRODUCT CATALOGUE
========================================= */

async function loadCatalogProducts() {
  if (!isAdmin) return;

  const container = $("admin-products");

  if (container) {
    container.innerHTML = `
      <div class="loading-state">Loading product catalogue...</div>
    `;
  }

  try {
    const { data, error } = await supabaseClient
      .from("products")
      .select("*")
      .order("name", { ascending: true });

    if (error) throw error;

    catalogCache = data || [];

    renderCatalogProducts();
  } catch (error) {
    console.error("Could not load product catalogue:", error);

    if (container) {
      container.innerHTML = `
        <div class="empty-state">
          <h3>Catalogue could not be loaded</h3>
          <p>Please check your Supabase permissions.</p>
        </div>
      `;
    }
  }
}

/* =========================================
   RENDER ADMIN CATALOGUE
========================================= */

function renderCatalogProducts() {
  const container = $("admin-products");

  if (!container) return;

  const searchInput = $("admin-product-search");
  const searchTerm = searchInput
    ? searchInput.value.trim().toLowerCase()
    : "";

  let filteredProducts = [...catalogCache];

  if (searchTerm) {
    filteredProducts = filteredProducts.filter((product) => {
      return (
        String(product.name || "").toLowerCase().includes(searchTerm) ||
        String(product.category || "").toLowerCase().includes(searchTerm)
      );
    });
  }

  if (!filteredProducts.length) {
    container.innerHTML = `
      <div class="empty-state">
        <h3>No products found</h3>
        <p>Try another search term or import new products.</p>
      </div>
    `;

    return;
  }

  container.innerHTML = filteredProducts.map((product) => {
    return `
      <article class="admin-product-row">
        <div class="admin-product-image">
          ${imageMarkup(product, "catalog-product-image")}
        </div>

        <div class="admin-product-info">
          <strong>${escapeHTML(product.name)}</strong>

          <span>${escapeHTML(product.category || "Items")}</span>

          <span>${money(product.price || 0)}</span>

          <span>
            ${product.is_active ? "Active" : "Inactive"}
          </span>
        </div>

        <button
          type="button"
          class="secondary-button"
          onclick="openCatalogProductEditor('${escapeHTML(product.id)}')"
        >
          Edit
        </button>

        <button
          type="button"
          class="secondary-button"
          onclick="toggleCatalogProduct('${escapeHTML(product.id)}', ${!product.is_active})"
        >
          ${product.is_active ? "Deactivate" : "Activate"}
        </button>
      </article>
    `;
  }).join("");
}

/* =========================================
   ADMIN PRODUCT SEARCH
========================================= */

const adminProductSearch = $("admin-product-search");

if (adminProductSearch) {
  adminProductSearch.addEventListener("input", renderCatalogProducts);
}

/* =========================================
   CATALOGUE PRODUCT EDITOR
========================================= */

function openCatalogProductEditor(productId) {
  if (!isAdmin) return;

  const product = catalogCache.find(
    (entry) => String(entry.id) === String(productId)
  );

  if (!product) return;

  editingProductId = product.id;

  const modal = $("product-editor-modal");

  if (!modal) return;

  const nameInput = $("edit-product-name");
  const categoryInput = $("edit-product-category");
  const priceInput = $("edit-product-price");
  const stackInput = $("edit-product-stack");
  const discountInput = $("edit-product-discount");
  const activeInput = $("edit-product-active");

  if (nameInput) {
    nameInput.value = product.name || "";
  }

  if (categoryInput) {
    categoryInput.value = product.category || "Items";
  }

  if (priceInput) {
    priceInput.value = Number(product.price) || 0;
  }

  if (stackInput) {
    stackInput.value = Number(product.stack_size) || 64;
  }

  if (discountInput) {
    discountInput.value = Number(product.discount_percent) || 0;
  }

  if (activeInput) {
    activeInput.checked = Boolean(product.is_active);
  }

  modal.classList.add("active");
}

/* =========================================
   TOGGLE PRODUCT ACTIVE STATUS
========================================= */

async function toggleCatalogProduct(productId, active) {
  if (!isAdmin) return;

  try {
    const { error } = await supabaseClient
      .from("products")
      .update({
        is_active: Boolean(active)
      })
      .eq("id", productId);

    if (error) throw error;

    await loadCatalogProducts();
    await loadProducts();

    showToast(
      active ? "Product activated." : "Product deactivated.",
      "success"
    );
  } catch (error) {
    console.error("Could not update product:", error);
    showToast("Could not update product.", "error");
  }
}

/* =========================================
   CREATE PRODUCT
========================================= */

async function createCatalogProduct(event) {
  if (event) event.preventDefault();

  if (!isAdmin) {
    showToast("Admin permissions required.", "error");
    return;
  }

  const name = $("new-product-name")?.value.trim();
  const categoryValue = $("new-product-category")?.value;
  const price = Number($("new-product-price")?.value);
  const description = $("new-product-description")?.value.trim();
  const stackSize = Number($("new-product-stack")?.value || 64);

  const allowedCategories = [
    "Blocks",
    "Items",
    "Armor & Weapons",
    "Enchantments"
  ];

  if (!name) {
    showToast("Please enter a product name.", "error");
    return;
  }

  if (!allowedCategories.includes(categoryValue)) {
    showToast("Please select a valid category.", "error");
    return;
  }

  if (
    !Number.isFinite(price) ||
    price < 0 ||
    !Number.isInteger(stackSize) ||
    stackSize < 1 ||
    stackSize > 64
  ) {
    showToast("Please enter valid product values.", "error");
    return;
  }

  try {
    const { error } = await supabaseClient
      .from("products")
      .insert({
        name,
        category: categoryValue,
        description,
        price: roundMoney(price),
        stack_size: stackSize,
        discount_percent: 0,
        is_active: false
      });

    if (error) throw error;

    const form = $("new-product-form");

    if (form) form.reset();

    await loadCatalogProducts();
    await loadProducts();

    showToast("Product created as inactive.", "success");
  } catch (error) {
    console.error("Product creation failed:", error);
    showToast("Could not create product.", "error");
  }
}

const newProductForm = $("new-product-form");

if (newProductForm) {
  newProductForm.addEventListener("submit", createCatalogProduct);
}

/* =========================================
   CATALOG IMPORT: CSV PARSER
========================================= */

function parseCatalogCSV(text) {
  const rows = [];
  let row = [];
  let value = "";
  let insideQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"' && insideQuotes && nextChar === '"') {
      value += '"';
      i++;
    } else if (char === '"') {
      insideQuotes = !insideQuotes;
    } else if (char === "," && !insideQuotes) {
      row.push(value.trim());
      value = "";
    } else if (
      (char === "\n" || char === "\r") &&
      !insideQuotes
    ) {
      if (char === "\r" && nextChar === "\n") {
        i++;
      }

      row.push(value.trim());

      if (row.some((cell) => cell !== "")) {
        rows.push(row);
      }

      row = [];
      value = "";
    } else {
      value += char;
    }
  }

  row.push(value.trim());

  if (row.some((cell) => cell !== "")) {
    rows.push(row);
  }

  if (rows.length < 2) {
    return [];
  }

  const headers = rows[0].map((header) =>
    header.trim().toLowerCase().replace(/^\uFEFF/, "")
  );

  return rows.slice(1).map((cells) => {
    const object = {};

    headers.forEach((header, index) => {
      object[header] = cells[index] ?? "";
    });

    return object;
  });
}

/* =========================================
   CATALOG IMPORT: CATEGORY DETECTION
========================================= */

function detectImportedCategory(raw) {
  const explicitCategory = String(
    raw.category ||
    raw.categories ||
    raw.type ||
    ""
  ).toLowerCase();

  if (
    explicitCategory.includes("armor") ||
    explicitCategory.includes("weapon") ||
    explicitCategory.includes("sword") ||
    explicitCategory.includes("helmet") ||
    explicitCategory.includes("chestplate") ||
    explicitCategory.includes("leggings") ||
    explicitCategory.includes("boots") ||
    explicitCategory.includes("bow") ||
    explicitCategory.includes("crossbow") ||
    explicitCategory.includes("shield") ||
    explicitCategory.includes("trident")
  ) {
    return "Armor & Weapons";
  }

  if (
    explicitCategory.includes("enchant")
  ) {
    return "Enchantments";
  }

  if (
    explicitCategory.includes("block") ||
    explicitCategory.includes("building")
  ) {
    return "Blocks";
  }

  if (
    explicitCategory.includes("item") ||
    explicitCategory.includes("equipment") ||
    explicitCategory.includes("food") ||
    explicitCategory.includes("tool") ||
    explicitCategory.includes("material")
  ) {
    return "Items";
  }

  const name = String(
    raw.name ||
    raw.title ||
    raw.displayName ||
    raw.translation_key ||
    raw.id ||
    ""
  ).toLowerCase();

  const blockWords = [
    "stone", "dirt", "grass", "planks", "log", "wood",
    "ore", "block", "glass", "sand", "gravel", "concrete",
    "terracotta", "wool", "slab", "stairs", "fence",
    "wall", "door", "trapdoor", "leaves", "sapling",
    "bricks", "cobblestone", "obsidian", "netherrack"
  ];

  const armorWeaponWords = [
    "sword", "axe", "pickaxe", "shovel", "hoe",
    "helmet", "chestplate", "leggings", "boots",
    "bow", "crossbow", "shield", "trident",
    "mace", "spear"
  ];

  const enchantmentWords = [
    "enchanted_book", "enchanting_table"
  ];

  if (enchantmentWords.some((word) => name.includes(word))) {
    return "Enchantments";
  }

  if (armorWeaponWords.some((word) => name.includes(word))) {
    return "Armor & Weapons";
  }

  if (blockWords.some((word) => name.includes(word))) {
    return "Blocks";
  }

  return "Items";
}

/* =========================================
   CATALOG IMPORT: STACK SIZE
========================================= */

function detectImportedStackSize(raw) {
  const possibleValues = [
    raw.stack_size,
    raw.stackSize,
    raw.max_stack_size,
    raw.maxStackSize,
    raw.max_stack,
    raw.maxStack
  ];

  for (const value of possibleValues) {
    const number = Number(value);

    if (
      Number.isInteger(number) &&
      number >= 1 &&
      number <= 64
    ) {
      return number;
    }
  }

  const name = String(
    raw.name ||
    raw.title ||
    raw.id ||
    raw.translation_key ||
    ""
  ).toLowerCase();

  const unstackableWords = [
    "sword", "pickaxe", "shovel", "axe", "hoe",
    "helmet", "chestplate", "leggings", "boots",
    "bow", "crossbow", "shield", "trident",
    "mace", "fishing_rod", "fishing rod",
    "shears", "flint_and_steel", "elytra",
    "carrot_on_a_stick", "warped_fungus_on_a_stick"
  ];

  const sixteenStackWords = [
    "snowball", "egg", "ender_pearl", "sign",
    "hanging_sign", "banner", "bucket",
    "boat", "chest_boat", "minecart",
    "armor_stand", "honey_bottle"
  ];

  if (unstackableWords.some((word) => name.includes(word))) {
    return 1;
  }

  if (sixteenStackWords.some((word) => name.includes(word))) {
    return 16;
  }

  return 64;
}

/* =========================================
   CATALOG IMPORT: NORMALIZE PRODUCT
========================================= */

function normalizeImportedProduct(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const name = String(
    raw.name ||
    raw.title ||
    raw.displayName ||
    raw.display_name ||
    raw.translation_key ||
    raw.id ||
    raw.item ||
    ""
  ).trim();

  if (!name) return null;

  const normalizedName = name
    .replace(/^minecraft:/i, "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalizedName) return null;

  if (normalizedName.toLowerCase() === "air") {
    return null;
  }

  return {
    name: normalizedName,
    category: detectImportedCategory(raw),
    description: "Minecraft item",
    price: 0,
    stack_size: detectImportedStackSize(raw),
    discount_percent: 0,
    is_active: false
  };
}

/* =========================================
   CATALOG IMPORT: REGISTRY JSON
========================================= */

function extractRegistryProducts(data) {
  if (Array.isArray(data)) {
    return data;
  }

  if (!data || typeof data !== "object") {
    return [];
  }

  if (Array.isArray(data.items)) {
    return data.items;
  }

  if (Array.isArray(data.entries)) {
    return data.entries;
  }

  if (Array.isArray(data.item_components)) {
    const components = data.item_components;

    const survivalEntries =
      data.item_lists?.filtered_by_survival_obtained?.entries;

    if (Array.isArray(survivalEntries)) {
      const survivalIds = new Set(
        survivalEntries.map((entry) => {
          if (typeof entry === "string") return entry;

          return entry.id || entry.item || entry.name || "";
        })
      );

      return components.filter((item) => {
        const id = item.id || item.name || item.translation_key;

        return survivalIds.has(id);
      });
    }

    return components.filter((item) => {
      const obtained = item.obtained_via?.gamemode_survival;

      return obtained === true || obtained === 1;
    });
  }

  if (data.items && typeof data.items === "object") {
    return Object.entries(data.items).map(([id, item]) => ({
      id,
      ...item
    }));
  }

  return [];
}

/* =========================================
   CATALOG IMPORT: DUPLICATE CHECK
========================================= */

function normalizeProductKey(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/^minecraft:/, "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function importProducts(productsToImport) {
  if (!isAdmin) {
    throw new Error("Admin permissions required.");
  }

  const normalizedProducts = productsToImport
    .map(normalizeImportedProduct)
    .filter(Boolean);

  if (!normalizedProducts.length) {
    return {
      imported: 0,
      skipped: 0,
      total: 0
    };
  }

  const uniqueProducts = [];
  const seenNames = new Set();

  for (const product of normalizedProducts) {
    const key = normalizeProductKey(product.name);

    if (seenNames.has(key)) continue;

    seenNames.add(key);
    uniqueProducts.push(product);
  }

  const existingNames = new Set(
    catalogCache.map((product) =>
      normalizeProductKey(product.name)
    )
  );

  const candidates = uniqueProducts.filter((product) => {
    return !existingNames.has(normalizeProductKey(product.name));
  });

  if (!candidates.length) {
    return {
      imported: 0,
      skipped: uniqueProducts.length,
      total: uniqueProducts.length
    };
  }

  let importedCount = 0;

  const batchSize = 100;

  for (let index = 0; index < candidates.length; index += batchSize) {
    const batch = candidates.slice(index, index + batchSize);

    const { data, error } = await supabaseClient
      .from("products")
      .insert(batch)
      .select("id");

    if (error) {
      throw error;
    }

    importedCount += data?.length || batch.length;
  }

  return {
    imported: importedCount,
    skipped: uniqueProducts.length - importedCount,
    total: uniqueProducts.length
  };
}

/* =========================================
   CATALOG IMPORT: FILE HANDLER
========================================= */

async function importCatalogFile(file) {
  if (!isAdmin) {
    showToast("Admin permissions required.", "error");
    return;
  }

  if (!file) return;

  const fileName = file.name.toLowerCase();

  if (!fileName.endsWith(".json") && !fileName.endsWith(".csv")) {
    showToast("Please select a JSON or CSV file.", "error");
    return;
  }

  try {
    showToast("Reading import file...", "info");

    const text = await file.text();

    let rawProducts = [];

    if (fileName.endsWith(".json")) {
      const json = JSON.parse(text);
      rawProducts = extractRegistryProducts(json);
    } else {
      rawProducts = parseCatalogCSV(text);
    }

    if (!rawProducts.length) {
      showToast("No valid products found in this file.", "error");
      return;
    }

    showToast(
      `Importing ${rawProducts.length} entries...`,
      "info"
    );

    const result = await importProducts(rawProducts);

    await loadCatalogProducts();
    await loadProducts();

    showToast(
      `Import complete: ${result.imported} added, ${result.skipped} skipped.`,
      "success"
    );

    console.log("Catalog import result:", result);
  } catch (error) {
    console.error("Catalog import failed:", error);

    showToast(
      error.message || "Could not import catalogue.",
      "error"
    );
  } finally {
    const input = $("catalog-import-file");

    if (input) {
      input.value = "";
    }
  }
}

/* =========================================
   CATALOG IMPORT INPUT
========================================= */

const catalogImportInput = $("catalog-import-file");

if (catalogImportInput) {
  catalogImportInput.addEventListener("change", (event) => {
    const file = event.target.files?.[0];

    if (file) {
      importCatalogFile(file);
    }
  });
}

/* =========================================
   INITIALIZE SHOP
========================================= */

async function initializeShop() {
  try {
    await loadSession();
    await loadProducts();

    if (currentSession && isAdmin) {
      await loadRequests();
      await loadCatalogProducts();
    }

    renderCart();

    showCategory("All");
  } catch (error) {
    console.error("Shop initialization failed:", error);
  }
}

/* =========================================
   START APPLICATION
========================================= */

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeShop);
} else {
  initializeShop();
}
