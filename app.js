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

const roundMoney = value => Math.ceil(Number(value || 0));

const money = value =>
  `${Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  })} KB$`;

const checkoutMoney = value =>
  `${roundMoney(value).toLocaleString("en-US")} KB$`;

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
  const isBlock = product.category === "Blocks";
  const textureType = isBlock ? "block" : "item";

  return `https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.21.4/assets/minecraft/textures/${textureType}/${texture}.png`;
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
  return Number(product.price || 0) *
    (1 - getManualDiscount(product) / 100);
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

/*
  IMPORTANT:
  Service budgets are now included in the cart total.
  Quantity and product discounts only apply to normal products.
*/

function getCartTotals() {
  let original = 0;
  let afterManual = 0;
  let afterQuantity = 0;
  let serviceTotal = 0;

  for (const [id, quantity] of Object.entries(cart)) {
    const product = products.find(
      item => String(item.id) === String(id)
    );

    if (!product) continue;

    if (product.isService) {
      const budget = Number(product.desiredPrice || 0);

      original += budget;
      afterManual += budget;
      afterQuantity += budget;
      serviceTotal += budget;

      continue;
    }

    const stacks = Number(quantity);
    const stackPrice = Number(product.price);
    const salePrice = getSalePrice(product);

    original += stackPrice * stacks;
    afterManual += salePrice * stacks;

    const quantityDiscount = getDiscountPercent(stacks);

    afterQuantity +=
      salePrice * stacks * (1 - quantityDiscount / 100);
  }

  const manualSavings = original - afterManual;

  let normalProductManualSavings = 0;
  let normalProductQuantitySavings = 0;

  for (const [id, quantity] of Object.entries(cart)) {
    const product = products.find(
      item => String(item.id) === String(id)
    );

    if (!product || product.isService) continue;

    const stacks = Number(quantity);
    const salePrice = getSalePrice(product);

    normalProductManualSavings +=
      (Number(product.price) - salePrice) * stacks;

    normalProductQuantitySavings +=
      salePrice * stacks *
      getDiscountPercent(stacks) / 100;
  }

  const quantitySavings = normalProductQuantitySavings;
  const savings = normalProductManualSavings + quantitySavings;

  return {
    original,
    afterManual,
    afterQuantity,
    manualSavings: normalProductManualSavings,
    quantitySavings,
    savings,
    serviceTotal,
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

    if ($("products")) {
      $("products").innerHTML =
        `<p class="error-message">Could not load products: ${escapeHTML(error.message)}</p>`;
    }

    if ($("offers-grid")) {
      $("offers-grid").innerHTML =
        `<p class="error-message">Could not load offers.</p>`;
    }

    return;
  }

  const serviceProducts = products.filter(
    product => product.isService
  );

  products = [...(data || []), ...serviceProducts];

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

  const requestsTab = document.querySelector("[data-requests-tab]");
  if (requestsTab) requestsTab.classList.remove("active");

  if ($("offers")) {
    $("offers").style.display =
      nextCategory === "All" ? "" : "none";
  }

  if ($("shop")) {
    $("shop").style.display =
      nextCategory === "All" ? "none" : "";
  }

  if ($("admin-section")) {
    $("admin-section").style.display = "none";
  }

  const descriptions = {
    "Blocks": "Building materials and decorative blocks.",
    "Items": "Useful items and resources.",
    "Armor & Weapons": "Equipment for your adventures.",
    "Enchantments": "Enchantments and upgrades.",
    "Services": "Services and custom requests."
  };

  setText("category-title", nextCategory);
  setText(
    "category-description",
    descriptions[nextCategory] || "Browse available products."
  );

  renderProducts();

  if (nextCategory === "Services") {
    renderServiceForm();
  }
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

  const search = ($("search")?.value || "").toLowerCase();

  const offers = products.filter(product =>
    !product.isService &&
    Number(product.discount_percent || 0) > 0 &&
    (
      product.name.toLowerCase().includes(search) ||
      String(product.description || "").toLowerCase().includes(search)
    )
  );

  if (!offers.length) {
    container.innerHTML = "";

    if ($("empty-offers")) {
      $("empty-offers").style.display = "";
    }

    return;
  }

  if ($("empty-offers")) {
    $("empty-offers").style.display = "none";
  }

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

          <button
            class="primary-button offer-add-button"
            data-add="${escapeHTML(product.id)}"
            type="button"
          >
            Add to cart →
          </button>
        </div>
      </article>
    `;
  }).join("");

  container.querySelectorAll("[data-add]").forEach(button => {
    button.addEventListener("click", () =>
      addToCart(button.dataset.add)
    );
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
    <button
      class="product-admin-menu"
      data-edit-product="${escapeHTML(product.id)}"
      type="button"
    >
      ✎ Edit
    </button>
  `;
}

function renderProducts() {
  const container = $("products");
  if (!container) return;

  const search = ($("search")?.value || "").toLowerCase();

  const filtered = products.filter(product => {
    const matchesCategory =
      !product.isService && product.category === category;

    const matchesSearch =
      product.name.toLowerCase().includes(search) ||
      String(product.description || "").toLowerCase().includes(search);

    return matchesCategory && matchesSearch;
  });

  if (!filtered.length) {
    container.innerHTML = "";

    if ($("empty-products")) {
      $("empty-products").style.display = "";
    }

    return;
  }

  if ($("empty-products")) {
    $("empty-products").style.display = "none";
  }

  container.innerHTML = filtered.map(product => `
    <article class="product-card">
      <div class="product-visual">
        ${imageMarkup(product)}
        ${adminProductButton(product)}
      </div>

      <div class="product-info">
        <div class="product-tag">${escapeHTML(product.category)}</div>
        <h3>${escapeHTML(product.name)}</h3>

        <p class="product-description">
          ${escapeHTML(product.description || "")}
        </p>

        <div class="price-row">
          ${productPriceMarkup(product)}
        </div>

        <div class="stack-info">
          ${stackText(product)}
        </div>

        <button
          class="primary-button add-button"
          data-add="${escapeHTML(product.id)}"
          type="button"
        >
          Add to cart
        </button>
      </div>
    </article>
  `).join("");

  container.querySelectorAll("[data-add]").forEach(button => {
    button.addEventListener("click", () =>
      addToCart(button.dataset.add)
    );
  });

  container.querySelectorAll("[data-edit-product]").forEach(button => {
    button.addEventListener("click", () =>
      openProductEditor(button.dataset.editProduct)
    );
  });
}

/* =========================================
   SEARCH
========================================= */

if ($("search")) {
  $("search").addEventListener("input", () => {
    renderOffers();
    renderProducts();
  });
}
/* =========================================
   PRODUCT EDITOR BUTTONS
========================================= */

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

        <label>Category</label>
        <select id="edit-product-category">
          ${["Blocks", "Items", "Armor & Weapons", "Enchantments", "Services"].map(c =>
            `<option value="${c}" ${product.category === c ? "selected" : ""}>${c}</option>`
          ).join("")}
        </select>

        <label>Price per stack (${Number(product.stack_size || 64)} items)</label>
        <input
          id="edit-product-price"
          type="number"
          min="0"
          step="0.01"
          value="${Number(product.price || 0)}"
          required
        >

        <label>Stack size (1–64)</label>
        <input
          id="edit-product-stack"
          type="number"
          min="1"
          max="64"
          step="1"
          value="${Number(product.stack_size || 64)}"
          required
        >

        <label>Manual discount (%)</label>
        <input
          id="edit-product-discount"
          type="number"
          min="0"
          max="90"
          step="1"
          value="${getManualDiscount(product)}"
          required
        >

        <label class="catalog-active-toggle">
          <input
            id="edit-product-active"
            type="checkbox"
            ${product.is_active ? "checked" : ""}
          >
          Active in public shop
        </label>

        <button class="primary-button full-width" type="submit">
          Save changes
        </button>

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
    const stackSize = Number($("edit-product-stack").value);

    if (
      !Number.isFinite(price) ||
      price < 0 ||
      discount < 0 ||
      discount > 90 ||
      !Number.isInteger(stackSize) ||
      stackSize < 1 ||
      stackSize > 64
    ) {
      setText("product-editor-message", "Please enter valid values.");
      return;
    }

    const { error } = await supabaseClient
      .from("products")
      .update({
        price,
        discount_percent: discount,
        stack_size: stackSize,
        category: $("edit-product-category").value,
        is_active: $("edit-product-active").checked
      })
      .eq("id", editingProductId);

    if (error) {
      setText("product-editor-message", error.message);
      return;
    }

    modal.remove();
    await loadProducts();
    await loadCatalogProducts();
  });
}

/* =========================================
   CART
========================================= */

function saveCart() {
  localStorage.setItem("bratCart", JSON.stringify(cart));
}

function addToCart(id) {
  const product = products.find(
    item => String(item.id) === String(id)
  );

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
    Number(quantity) > 0 &&
    products.some(item => String(item.id) === String(id))
  );

  const count = entries.reduce(
    (sum, [, quantity]) => sum + Number(quantity),
    0
  );

  setText("cart-count", count);

  if (!entries.length) {
    container.innerHTML = `
      <div class="empty-cart">
        <div class="empty-icon">🛒</div>
        <p>Your cart is empty.</p>
      </div>
    `;

    if ($("cart-total")) {
      $("cart-total").innerHTML = "";
    }

    return;
  }

  container.innerHTML = entries.map(([id, quantity]) => {
    const product = products.find(
      item => String(item.id) === String(id)
    );

    if (product.isService) {
      const hasBudget =
        product.desiredPrice !== null &&
        product.desiredPrice !== undefined &&
        Number(product.desiredPrice) > 0;

      return `
        <div class="cart-item">
          <div class="cart-item-image">◈</div>

          <div class="cart-item-details">
            <h3>${escapeHTML(product.name)}</h3>

            <div class="cart-item-price">
              ${hasBudget
                ? `Service budget: ${money(product.desiredPrice)}`
                : "No budget specified"}
            </div>

            <div class="discount-note">
              ${hasBudget
                ? "Proposed service price – included in your order total"
                : "The service can still be ordered without a budget"}
            </div>

            <button
              class="remove-service"
              data-remove-service="${escapeHTML(id)}"
              type="button"
            >
              Remove
            </button>
          </div>
        </div>
      `;
    }

    const stacks = Number(quantity);
    const discount = getDiscountPercent(stacks);
    const manualDiscount = getManualDiscount(product);

    const finalPrice =
      getSalePrice(product) * stacks * (1 - discount / 100);

    return `
      <div class="cart-item">
        <div class="cart-item-image">
          ${imageMarkup(product, "cart-product-image")}
        </div>

        <div class="cart-item-details">
          <h3>${escapeHTML(product.name)}</h3>
          <div class="cart-item-price">${money(finalPrice)}</div>

          ${manualDiscount > 0
            ? `<div class="discount-note">Product discount: ${manualDiscount}%</div>`
            : ""}

          ${discount > 0
            ? `<div class="discount-note">Quantity discount: ${discount}%</div>`
            : ""}

          <div class="quantity-controls">
            <button
              data-quantity="${escapeHTML(id)}"
              data-change="-1"
              type="button"
            >−</button>

            <span>${stacks}</span>

            <button
              data-quantity="${escapeHTML(id)}"
              data-change="1"
              type="button"
            >+</button>
          </div>
        </div>
      </div>
    `;
  }).join("");

  container.querySelectorAll("[data-quantity]").forEach(button => {
    button.addEventListener("click", () => {
      changeQuantity(
        button.dataset.quantity,
        Number(button.dataset.change)
      );
    });
  });

  container.querySelectorAll("[data-remove-service]").forEach(button => {
    button.addEventListener("click", () => {
      const id = button.dataset.removeService;

      delete cart[id];

      products = products.filter(item =>
        String(item.id) !== String(id)
      );

      saveCart();
      renderCart();
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
/* =========================================
   CART OPEN / CLOSE
========================================= */

function openCart() {
  const panel = $("cart-panel");
  const overlay = $("cart-overlay");

  if (panel) panel.classList.add("active");
  if (overlay) overlay.classList.add("active");

  document.body.style.overflow = "hidden";
}

function closeCart() {
  const panel = $("cart-panel");
  const overlay = $("cart-overlay");

  if (panel) panel.classList.remove("active");
  if (overlay) overlay.classList.remove("active");

  document.body.style.overflow = "";
}

if ($("cart-button")) {
  $("cart-button").addEventListener("click", openCart);
}

if ($("cart-close")) {
  $("cart-close").addEventListener("click", closeCart);
}

if ($("cart-overlay")) {
  $("cart-overlay").addEventListener("click", closeCart);
}

/* =========================================
   CHECKOUT MODAL
========================================= */

function openCheckout() {
  const entries = Object.entries(cart).filter(([id, quantity]) =>
    Number(quantity) > 0 &&
    products.some(product => String(product.id) === String(id))
  );

  if (!entries.length) {
    showToast("Your cart is empty.", "error");
    return;
  }

  const modal = $("checkout-modal");

  if (!modal) {
    showToast("Checkout is currently unavailable.", "error");
    return;
  }

  const totals = getCartTotals();

  if ($("checkout-summary")) {
    $("checkout-summary").innerHTML = `
      <div class="checkout-summary-row">
        <span>Items in cart</span>
        <strong>${entries.length}</strong>
      </div>

      <div class="checkout-summary-row">
        <span>Subtotal</span>
        <strong>${money(totals.original)}</strong>
      </div>

      <div class="checkout-summary-row">
        <span>Discounts</span>
        <strong>-${money(totals.savings)}</strong>
      </div>

      <div class="checkout-summary-row checkout-summary-total">
        <span>Total</span>
        <strong>${checkoutMoney(totals.total)}</strong>
      </div>
    `;
  }

  closeCart();
  modal.classList.add("active");
  document.body.style.overflow = "hidden";
}

function closeCheckout() {
  const modal = $("checkout-modal");

  if (modal) modal.classList.remove("active");

  document.body.style.overflow = "";
}

if ($("checkout-button")) {
  $("checkout-button").addEventListener("click", openCheckout);
}

if ($("checkout-close")) {
  $("checkout-close").addEventListener("click", closeCheckout);
}

/* =========================================
   CHECKOUT FORM
========================================= */

function getCheckoutValues() {
  return {
    minecraftName: $("checkout-minecraft-name")?.value.trim() || "",
    district: $("checkout-district")?.value.trim() || "",
    address: $("checkout-address")?.value.trim() || "",
    note: $("checkout-note")?.value.trim() || ""
  };
}

function validateCheckout(values) {
  if (!values.minecraftName) {
    return "Please enter your Minecraft username.";
  }

  if (!values.district) {
    return "Please select your delivery district.";
  }

  if (!values.address) {
    return "Please enter your delivery address.";
  }

  return null;
}

/* =========================================
   ORDER ITEM PREPARATION
========================================= */

function buildOrderItems() {
  return Object.entries(cart)
    .filter(([id, quantity]) => Number(quantity) > 0)
    .map(([id, quantity]) => {
      const product = products.find(
        item => String(item.id) === String(id)
      );

      if (!product) return null;

      if (product.isService) {
        return {
          id: product.id,
          name: product.name,
          type: "service",
          quantity: 1,
          desired_price: Number(product.desiredPrice || 0),
          description: product.description || ""
        };
      }

      const stacks = Number(quantity);
      const stackPrice = Number(product.price);
      const manualDiscount = getManualDiscount(product);
      const quantityDiscount = getDiscountPercent(stacks);

      const priceAfterManual =
        stackPrice * (1 - manualDiscount / 100);

      const finalPrice =
        priceAfterManual * stacks *
        (1 - quantityDiscount / 100);

      return {
        id: product.id,
        name: product.name,
        type: "product",
        category: product.category,
        quantity: stacks,
        stack_size: Number(product.stack_size || 64),
        price_per_stack: stackPrice,
        manual_discount: manualDiscount,
        quantity_discount: quantityDiscount,
        total: Number(finalPrice.toFixed(2))
      };
    })
    .filter(Boolean);
}

/* =========================================
   TOAST NOTIFICATIONS
========================================= */

function showToast(message, type = "success") {
  let container = $("toast-container");

  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    container.className = "toast-container";
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;

  container.appendChild(toast);

  window.setTimeout(() => {
    toast.remove();

    if (!container.children.length) {
      container.remove();
    }
  }, 3500);
}
/* =========================================
   PLACE ORDER
========================================= */

async function placeOrder(event) {
  if (event) event.preventDefault();

  if (!currentSession) {
    showToast("Please log in before placing an order.", "error");
    return;
  }

  const values = getCheckoutValues();
  const validationError = validateCheckout(values);

  if (validationError) {
    showToast(validationError, "error");
    return;
  }

  const orderItems = buildOrderItems();

  if (!orderItems.length) {
    showToast("Your cart is empty.", "error");
    return;
  }

  const totals = getCartTotals();

  const button = $("place-order-button");

  if (button) {
    button.disabled = true;
    button.textContent = "Processing...";
  }

  const orderData = {
    request_type: orderItems.some(item => item.type === "service")
      ? "mixed"
      : "product",
    items: orderItems,
    description: orderItems
      .filter(item => item.type === "service")
      .map(item => item.description)
      .join("\n"),
    links: [],
    image_urls: [],
    desired_price: totals.serviceTotal,
    subtotal: totals.original,
    discount_amount: totals.savings,
    total: totals.checkoutTotal,
    status: "pending",
    minecraft_name: values.minecraftName,
    note: values.note,
    user_id: currentSession.user.id,
    delivery_district: values.district,
    delivery_address: values.address
  };

  const { error } = await supabaseClient
    .from("orders")
    .insert(orderData);

  if (button) {
    button.disabled = false;
    button.textContent = "Place order";
  }

  if (error) {
    console.error("Order error:", error);
    showToast(`Could not place order: ${error.message}`, "error");
    return;
  }

  cart = {};
  saveCart();
  renderCart();

  closeCheckout();

  if ($("checkout-form")) {
    $("checkout-form").reset();
  }

  showToast("Your order has been submitted successfully.");

  await loadRequests();
}

if ($("checkout-form")) {
  $("checkout-form").addEventListener("submit", placeOrder);
}

/* =========================================
   SERVICE REQUEST FORM
========================================= */

function renderServiceForm() {
  const container = $("products");

  if (!container) return;

  if ($("service-request-form")) return;

  container.innerHTML = `
    <div class="service-request-card" id="service-request-form">
      <div class="eyebrow">BRAT LTD. SERVICES</div>
      <h2>Request a <span class="orange">custom service.</span></h2>

      <p>
        Tell us what you need. Our team will review your request
        and get back to you.
      </p>

      <form id="service-form">
        <label for="service-title">Service title</label>
        <input
          id="service-title"
          type="text"
          maxlength="100"
          placeholder="e.g. Custom building project"
          required
        >

        <label for="service-description">Description</label>
        <textarea
          id="service-description"
          maxlength="3000"
          placeholder="Describe your project and requirements..."
          required
        ></textarea>

        <div class="form-row">
          <div>
            <label for="service-budget">Budget (KB$)</label>
            <input
              id="service-budget"
              type="number"
              min="0"
              step="1"
              placeholder="Optional"
            >
          </div>

          <div>
            <label for="service-deadline">Desired deadline</label>
            <input
              id="service-deadline"
              type="date"
            >
          </div>
        </div>

        <label for="service-links">Reference links</label>
        <textarea
          id="service-links"
          maxlength="1500"
          placeholder="Add links to images or examples..."
        ></textarea>

        <label for="service-images">Reference images</label>
        <input
          id="service-images"
          type="file"
          accept="image/*"
          multiple
        >

        <p class="form-hint">
          You can upload up to 5 images.
        </p>

        <button class="primary-button full-width" type="submit">
          Submit service request
        </button>

        <p id="service-message" class="form-message"></p>
      </form>
    </div>
  `;

  $("service-form").addEventListener("submit", submitServiceRequest);
}

/* =========================================
   SERVICE IMAGE UPLOAD
========================================= */

async function uploadServiceImages(files) {
  const uploadedUrls = [];
  const selectedFiles = Array.from(files || []).slice(0, 5);

  for (const file of selectedFiles) {
    if (!file.type.startsWith("image/")) {
      throw new Error("Only image files are allowed.");
    }

    if (file.size > 5 * 1024 * 1024) {
      throw new Error("Each image must be smaller than 5 MB.");
    }

    const extension = file.name.split(".").pop() || "png";

    const fileName =
      `${currentSession.user.id}/${Date.now()}-${crypto.randomUUID()}.${extension}`;

    const { error } = await supabaseClient.storage
      .from("service-attachments")
      .upload(fileName, file, {
        cacheControl: "3600",
        upsert: false
      });

    if (error) throw error;

    const { data } = supabaseClient.storage
      .from("service-attachments")
      .getPublicUrl(fileName);

    uploadedUrls.push(data.publicUrl);
  }

  return uploadedUrls;
}

/* =========================================
   SUBMIT SERVICE REQUEST
========================================= */

async function submitServiceRequest(event) {
  event.preventDefault();

  if (!currentSession) {
    showToast("Please log in before submitting a request.", "error");
    return;
  }

  const title = $("service-title").value.trim();
  const description = $("service-description").value.trim();
  const budgetValue = $("service-budget").value;
  const deadline = $("service-deadline").value || null;

  const links = $("service-links").value
    .split("\n")
    .map(value => value.trim())
    .filter(Boolean)
    .filter(value => safeExternalUrl(value));

  const files = $("service-images").files;

  if (!title || !description) {
    showToast("Please complete all required fields.", "error");
    return;
  }

  if (budgetValue && Number(budgetValue) < 0) {
    showToast("Please enter a valid budget.", "error");
    return;
  }

  const button = event.submitter;

  if (button) {
    button.disabled = true;
    button.textContent = "Uploading...";
  }

  try {
    const imageUrls = await uploadServiceImages(files);

    const desiredPrice =
      budgetValue === "" ? null : Number(budgetValue);

    const orderData = {
      request_type: "service",
      items: [{
        type: "service",
        name: title,
        quantity: 1,
        description
      }],
      description,
      links,
      image_urls: imageUrls,
      desired_price: desiredPrice,
      subtotal: desiredPrice || 0,
      discount_amount: 0,
      total: desiredPrice || 0,
      status: "pending",
      minecraft_name: currentSession.user.user_metadata?.minecraft_name || "",
      note: "",
      user_id: currentSession.user.id,
      due_date: deadline
    };

    const { error } = await supabaseClient
      .from("orders")
      .insert(orderData);

    if (error) throw error;

    $("service-form").reset();

    showToast("Your service request has been submitted.");

    await loadRequests();

  } catch (error) {
    console.error("Service request error:", error);
    showToast(`Request failed: ${error.message}`, "error");

  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Submit service request";
    }
  }
}
/* =========================================
   AUTHENTICATION
========================================= */

async function loadSession() {
  const {
    data: { session },
    error
  } = await supabaseClient.auth.getSession();

  if (error) {
    console.error("Session error:", error);
    return;
  }

  currentSession = session;

  await updateAuthUI();

  if (currentSession) {
    await checkAdminRole();
  }
}

async function updateAuthUI() {
  const loginButton = $("login-button");
  const accountButton = $("account-button");
  const logoutButton = $("logout-button");
  const userLabel = $("user-label");

  if (currentSession) {
    const username =
      currentSession.user.user_metadata?.minecraft_name ||
      currentSession.user.email;

    if (loginButton) loginButton.hidden = true;
    if (accountButton) accountButton.hidden = false;
    if (logoutButton) logoutButton.hidden = false;

    if (userLabel) {
      userLabel.textContent = username;
    }

  } else {
    if (loginButton) loginButton.hidden = false;
    if (accountButton) accountButton.hidden = true;
    if (logoutButton) logoutButton.hidden = true;

    if (userLabel) {
      userLabel.textContent = "";
    }

    isAdmin = false;
  }
}

/* =========================================
   LOGIN MODAL
========================================= */

function openLogin() {
  const modal = $("login-modal");

  if (modal) {
    modal.classList.add("show");
  }
}

function closeLogin() {
  const modal = $("login-modal");

  if (modal) {
    modal.classList.remove("show");
  }
}

if ($("login-button")) {
  $("login-button").addEventListener("click", openLogin);
}

if ($("login-close")) {
  $("login-close").addEventListener("click", closeLogin);
}

if ($("login-modal")) {
  $("login-modal").addEventListener("click", event => {
    if (event.target === $("login-modal")) {
      closeLogin();
    }
  });
}

/* =========================================
   SIGN IN
========================================= */

async function signIn(event) {
  event.preventDefault();

  const email = $("login-email").value.trim();
  const password = $("login-password").value;

  const message = $("login-message");

  if (message) {
    message.textContent = "Signing in...";
  }

  const { data, error } = await supabaseClient.auth
    .signInWithPassword({
      email,
      password
    });

  if (error) {
    if (message) {
      message.textContent = error.message;
    }

    return;
  }

  currentSession = data.session;

  await updateAuthUI();
  await checkAdminRole();

  closeLogin();

  showToast("Successfully signed in.");

  if ($("login-form")) {
    $("login-form").reset();
  }
}

if ($("login-form")) {
  $("login-form").addEventListener("submit", signIn);
}

/* =========================================
   SIGN OUT
========================================= */

async function signOut() {
  const { error } = await supabaseClient.auth.signOut();

  if (error) {
    showToast(error.message, "error");
    return;
  }

  currentSession = null;
  isAdmin = false;

  await updateAuthUI();

  showCategory("All");

  showToast("You have been signed out.");
}

if ($("logout-button")) {
  $("logout-button").addEventListener("click", signOut);
}

/* =========================================
   ADMIN ROLE CHECK
========================================= */

async function checkAdminRole() {
  if (!currentSession) {
    isAdmin = false;
    return;
  }

  const { data, error } = await supabaseClient
    .from("profiles")
    .select("role")
    .eq("id", currentSession.user.id)
    .maybeSingle();

  if (error) {
    console.error("Role check failed:", error);
    isAdmin = false;
    return;
  }

  isAdmin = data?.role === "admin" || data?.role === "editor";

  const adminButton = $("admin-button");

  if (adminButton) {
    adminButton.hidden = !isAdmin;
  }

  if (isAdmin) {
    await loadRequests();
    await loadCatalogProducts();
  }
}

/* =========================================
   AUTH STATE CHANGES
========================================= */

supabaseClient.auth.onAuthStateChange((_event, session) => {
  currentSession = session;

  setTimeout(async () => {
    await updateAuthUI();

    if (session) {
      await checkAdminRole();
    } else {
      isAdmin = false;
    }
  }, 0);
});
/* =========================================
   ADMIN DASHBOARD
========================================= */

function openAdmin() {
  if (!isAdmin) {
    showToast("You do not have permission to access the admin area.", "error");
    return;
  }

  const adminSection = $("admin-section");

  if (adminSection) {
    adminSection.hidden = false;
    adminSection.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }

  showCategory("Admin");

  loadRequests();
  loadCatalogProducts();
}

function closeAdmin() {
  const adminSection = $("admin-section");

  if (adminSection) {
    adminSection.hidden = true;
  }

  showCategory("All");
}

if ($("admin-button")) {
  $("admin-button").addEventListener("click", openAdmin);
}

if ($("admin-close")) {
  $("admin-close").addEventListener("click", closeAdmin);
}

/* =========================================
   LOAD ORDERS / REQUESTS
========================================= */

async function loadRequests() {
  if (!isAdmin) return;

  const { data, error } = await supabaseClient
    .from("orders")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Could not load orders:", error);
    showToast("Could not load orders.", "error");
    return;
  }

  requests = data || [];

  renderRequests();
  renderAdminStats();
}

/* =========================================
   ADMIN STATISTICS
========================================= */

function renderAdminStats() {
  const totalOrders = requests.length;

  const pendingOrders = requests.filter(
    request => request.status === "pending"
  ).length;

  const completedOrders = requests.filter(
    request => request.status === "completed"
  ).length;

  const totalRevenue = requests
    .filter(request => request.status === "completed")
    .reduce((sum, request) => sum + Number(request.total || 0), 0);

  setText("admin-total-orders", totalOrders);
  setText("admin-pending-orders", pendingOrders);
  setText("admin-completed-orders", completedOrders);
  setText("admin-revenue", money(totalRevenue));
}

/* =========================================
   REQUEST FILTER
========================================= */

function filterRequests(filter) {
  currentRequestFilter = filter;

  document.querySelectorAll("[data-request-filter]").forEach(button => {
    button.classList.toggle(
      "active",
      button.dataset.requestFilter === filter
    );
  });

  renderRequests();
}

document.querySelectorAll("[data-request-filter]").forEach(button => {
  button.addEventListener("click", () => {
    filterRequests(button.dataset.requestFilter);
  });
});

/* =========================================
   RENDER REQUESTS
========================================= */

function renderRequests() {
  const container = $("admin-requests");

  if (!container) return;

  let filteredRequests = [...requests];

  if (currentRequestFilter !== "all") {
    filteredRequests = filteredRequests.filter(
      request => request.status === currentRequestFilter
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

  container.innerHTML = filteredRequests.map(request => {
    const items = Array.isArray(request.items)
      ? request.items
      : [];

    const itemList = items.map(item => `
      <div class="request-item">
        <span>${escapeHTML(item.name || "Unknown item")}</span>
        <span>× ${Number(item.quantity || 1)}</span>
      </div>
    `).join("");

    const status = escapeHTML(request.status || "pending");

    return `
      <article class="admin-request-card">
        <div class="request-header">
          <div>
            <span class="request-number">
              ORDER #${escapeHTML(String(request.id).slice(0, 8))}
            </span>
            <h3>${escapeHTML(request.minecraft_name || "Unknown player")}</h3>
          </div>

          <span class="status-badge status-${status}">
            ${status.toUpperCase()}
          </span>
        </div>

        <div class="request-meta">
          <span>${formatDate(request.created_at)}</span>
          <span>${money(request.total || 0)}</span>
          <span>${escapeHTML(request.request_type || "product")}</span>
        </div>

        <div class="request-items">
          ${itemList || "<p>No item details available.</p>"}
        </div>

        ${
          request.description
            ? `<div class="request-description">
                 <strong>Description</strong>
                 <p>${escapeHTML(request.description)}</p>
               </div>`
            : ""
        }

        ${
          request.note
            ? `<div class="request-description">
                 <strong>Customer note</strong>
                 <p>${escapeHTML(request.note)}</p>
               </div>`
            : ""
        }

        ${
          request.delivery_district || request.delivery_address
            ? `<div class="request-description">
                 <strong>Delivery</strong>
                 <p>
                   ${escapeHTML(request.delivery_district || "")}
                   ${escapeHTML(request.delivery_address || "")}
                 </p>
               </div>`
            : ""
        }

        ${
          Array.isArray(request.links) && request.links.length
            ? `<div class="request-links">
                 <strong>Reference links</strong>
                 ${request.links.map(link => {
                   const safeLink = safeExternalUrl(link);
                   return safeLink
                     ? `<a href="${escapeHTML(safeLink)}" target="_blank" rel="noopener noreferrer">Open reference</a>`
                     : "";
                 }).join("")}
               </div>`
            : ""
        }

        ${
          Array.isArray(request.image_urls) && request.image_urls.length
            ? `<div class="request-images">
                 ${request.image_urls.map(url => {
                   const safeUrl = safeExternalUrl(url);
                   return safeUrl
                     ? `<a href="${escapeHTML(safeUrl)}" target="_blank" rel="noopener noreferrer">
                          <img src="${escapeHTML(safeUrl)}" alt="Reference image" loading="lazy">
                        </a>`
                     : "";
                 }).join("")}
               </div>`
            : ""
        }

        <div class="request-actions">
          <select
            data-status-select="${escapeHTML(request.id)}"
            aria-label="Change order status"
          >
            <option value="pending" ${status === "pending" ? "selected" : ""}>Pending</option>
            <option value="processing" ${status === "processing" ? "selected" : ""}>Processing</option>
            <option value="completed" ${status === "completed" ? "selected" : ""}>Completed</option>
            <option value="cancelled" ${status === "cancelled" ? "selected" : ""}>Cancelled</option>
          </select>

          <button
            class="secondary-button"
            data-update-status="${escapeHTML(request.id)}"
          >
            Update status
          </button>
        </div>
      </article>
    `;
  }).join("");

  container.querySelectorAll("[data-update-status]").forEach(button => {
    button.addEventListener("click", async () => {
      const id = button.dataset.updateStatus;
      const select = container.querySelector(
        `[data-status-select="${CSS.escape(id)}"]`
      );

      if (!select) return;

      await updateRequestStatus(id, select.value);
    });
  });
}

/* =========================================
   UPDATE REQUEST STATUS
========================================= */

async function updateRequestStatus(id, status) {
  const allowedStatuses = [
    "pending",
    "processing",
    "completed",
    "cancelled"
  ];

  if (!allowedStatuses.includes(status)) {
    showToast("Invalid status.", "error");
    return;
  }

  const { error } = await supabaseClient
    .from("orders")
    .update({ status })
    .eq("id", id);

  if (error) {
    console.error("Status update failed:", error);
    showToast(error.message, "error");
    return;
  }

  showToast("Order status updated.");

  await loadRequests();
}
/* =========================================
   LOAD COMPLETE PRODUCT CATALOG
========================================= */

async function loadCatalogProducts() {
  if (!isAdmin) return;

  const container = $("catalog-products");

  if (!container) return;

  container.innerHTML = `
    <div class="loading-state">Loading catalogue...</div>
  `;

  const { data, error } = await supabaseClient
    .from("products")
    .select("*")
    .order("category")
    .order("name");

  if (error) {
    console.error("Catalogue error:", error);

    container.innerHTML = `
      <p class="error-message">
        Could not load catalogue: ${escapeHTML(error.message)}
      </p>
    `;
    return;
  }

  renderCatalogProducts(data || []);
}

/* =========================================
   RENDER CATALOGUE
========================================= */

function renderCatalogProducts(catalog) {
  const container = $("catalog-products");

  if (!container) return;

  const searchValue = (
    $("catalog-search")?.value || ""
  ).toLowerCase();

  const filtered = catalog.filter(product =>
    String(product.name || "").toLowerCase().includes(searchValue)
  );

  if (!filtered.length) {
    container.innerHTML = `
      <div class="empty-state">
        <h3>No products found</h3>
        <p>Try another search or import products.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="catalog-table-wrapper">
      <table class="catalog-table">
        <thead>
          <tr>
            <th>Product</th>
            <th>Category</th>
            <th>Price</th>
            <th>Stack size</th>
            <th>Status</th>
            <th>Action</th>
          </tr>
        </thead>

        <tbody>
          ${filtered.map(product => `
            <tr>
              <td>
                <strong>${escapeHTML(product.name)}</strong>
              </td>

              <td>${escapeHTML(product.category || "Items")}</td>

              <td>
                ${Number(product.price || 0) > 0
                  ? money(product.price)
                  : "Not set"}
              </td>

              <td>${Number(product.stack_size || 64)}</td>

              <td>
                <span class="status-badge ${
                  product.is_active ? "status-completed" : "status-pending"
                }">
                  ${product.is_active ? "Active" : "Inactive"}
                </span>
              </td>

              <td>
                <button
                  class="secondary-button"
                  data-catalog-edit="${escapeHTML(product.id)}"
                >
                  Edit
                </button>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;

  container.querySelectorAll("[data-catalog-edit]").forEach(button => {
    button.addEventListener("click", () => {
      const product = catalog.find(
        item => String(item.id) === button.dataset.catalogEdit
      );

      if (product) openProductEditor(product);
    });
  });
}

if ($("catalog-search")) {
  $("catalog-search").addEventListener("input", loadCatalogProducts);
}

/* =========================================
   CREATE NEW PRODUCT
========================================= */

async function createCatalogProduct() {
  if (!isAdmin) return;

  const name = prompt("Enter the Minecraft item name:");

  if (!name || !name.trim()) return;

  const category = prompt(
    "Category: Blocks, Items, Armor & Weapons, Enchantments",
    "Items"
  );

  const validCategories = [
    "Blocks",
    "Items",
    "Armor & Weapons",
    "Enchantments"
  ];

  if (!validCategories.includes(category)) {
    showToast("Invalid category.", "error");
    return;
  }

  const { error } = await supabaseClient
    .from("products")
    .insert({
      name: name.trim(),
      category,
      description: "",
      price: 0,
      stack_size: 64,
      discount_percent: 0,
      is_active: false
    });

  if (error) {
    showToast(error.message, "error");
    return;
  }

  showToast("Product added to catalogue.");
  await loadCatalogProducts();
}

if ($("catalog-add-button")) {
  $("catalog-add-button").addEventListener(
    "click",
    createCatalogProduct
  );
}

/* =========================================
   IMPORT PRODUCTS FROM JSON OR CSV
========================================= */

function parseCatalogCSV(text) {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter(line => line.trim());

  if (lines.length < 2) {
    throw new Error("The CSV file is empty.");
  }

  const separator = lines[0].includes(";") ? ";" : ",";

  function parseLine(line) {
    const result = [];
    let value = "";
    let insideQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        if (insideQuotes && line[i + 1] === '"') {
          value += '"';
          i++;
        } else {
          insideQuotes = !insideQuotes;
        }
      } else if (char === separator && !insideQuotes) {
        result.push(value.trim());
        value = "";
      } else {
        value += char;
      }
    }

    result.push(value.trim());
    return result;
  }

  const headers = parseLine(lines[0]).map(header =>
    header.trim().toLowerCase()
  );

  return lines.slice(1).map(line => {
    const values = parseLine(line);
    const product = {};

    headers.forEach((header, index) => {
      product[header] = values[index] || "";
    });

    return product;
  });
}

function normalizeImportedProduct(raw) {
  const name = String(
    raw.name || raw.title || raw.item || ""
  ).trim();

  if (!name) return null;

  const validCategories = [
    "Blocks",
    "Items",
    "Armor & Weapons",
    "Enchantments"
  ];

  const requestedCategory = String(
    raw.category || "Items"
  ).trim();

  const category = validCategories.includes(requestedCategory)
    ? requestedCategory
    : "Items";

  const stackSize = Number(
    raw.stack_size || raw.stackSize || 64
  );

  return {
    name,
    category,
    description: String(raw.description || ""),
    price: 0,
    stack_size: [1, 16, 64].includes(stackSize) ? stackSize : 64,
    discount_percent: 0,
    is_active: false
  };
}

async function importCatalogFile(file) {
  if (!isAdmin || !file) return;

  try {
    const text = await file.text();

    let imported;

    if (file.name.toLowerCase().endsWith(".json")) {
      imported = JSON.parse(text);
    } else if (file.name.toLowerCase().endsWith(".csv")) {
      imported = parseCatalogCSV(text);
    } else {
      throw new Error("Please select a JSON or CSV file.");
    }

    if (!Array.isArray(imported)) {
      throw new Error("The import file must contain a product array.");
    }

    const normalized = imported
      .map(normalizeImportedProduct)
      .filter(Boolean);

    if (!normalized.length) {
      throw new Error("No valid products were found.");
    }

    const uniqueProducts = [
      ...new Map(
        normalized.map(product => [
          product.name.toLowerCase(),
          product
        ])
      ).values()
    ];

    const confirmed = confirm(
      `Import ${uniqueProducts.length} products?\n\n` +
      "All imported products will be inactive and have no price."
    );

    if (!confirmed) return;

    const { error } = await supabaseClient
      .from("products")
      .upsert(uniqueProducts, {
        onConflict: "name",
        ignoreDuplicates: true
      });

    if (error) throw error;

    showToast(`${uniqueProducts.length} products imported.`);
    await loadCatalogProducts();
    await loadProducts();

  } catch (error) {
    console.error("Import error:", error);
    showToast(`Import failed: ${error.message}`, "error");
  }
}

if ($("catalog-import-file")) {
  $("catalog-import-file").addEventListener("change", event => {
    const file = event.target.files?.[0];

    if (file) {
      importCatalogFile(file);
    }

    event.target.value = "";
  });
}

/* =========================================
   INITIALIZE SHOP
========================================= */

async function initializeShop() {
  try {
    await loadSession();

    await loadProducts();

    renderCart();

    showCategory("All");

    if (currentSession && isAdmin) {
      await loadRequests();
      await loadCatalogProducts();
    }

    console.log("Brat Ltd. shop initialized.");

  } catch (error) {
    console.error("Shop initialization failed:", error);
    showToast("The shop could not be initialized.", "error");
  }
}

document.addEventListener("DOMContentLoaded", initializeShop);
