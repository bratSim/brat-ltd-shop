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
let catalogCache = [];

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
  Math.ceil(Number(value || 0));

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

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleDateString("en-GB");
};

const safeExternalUrl = value => {
  try {
    const url = new URL(value);

    return ["http:", "https:"].includes(url.protocol)
      ? url.href
      : null;
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
  "Ender Pearl": "ender_pearl",
   "Acacia Door": "acacia_door_bottom",
  "Acacia Fence": "acacia_fence",
  "Acacia Fence Gate": "acacia_fence_gate",
  "Acacia Stairs": "acacia_planks",
  "Armor Stand": "armor_stand",
  "Birch Door": "birch_door_bottom",
  "Bookshelf": "bookshelf",
  "Brewing Stand": "brewing_stand"
};

Object.keys(textureAliases).forEach(key => {
  textureAliases[key.toLowerCase()] = textureAliases[key];
});

const minecraftColors = [
  { name: "White", id: "white", hex: "#e9ecec" },
  { name: "Orange", id: "orange", hex: "#f07613" },
  { name: "Magenta", id: "magenta", hex: "#bd44b3" },
  { name: "Light Blue", id: "light_blue", hex: "#3ab3da" },
  { name: "Yellow", id: "yellow", hex: "#fed83d" },
  { name: "Lime", id: "lime", hex: "#80c71f" },
  { name: "Pink", id: "pink", hex: "#f38baa" },
  { name: "Gray", id: "gray", hex: "#474f52" },
  { name: "Light Gray", id: "light_gray", hex: "#9d9d97" },
  { name: "Cyan", id: "cyan", hex: "#169c9c" },
  { name: "Purple", id: "purple", hex: "#8932b8" },
  { name: "Blue", id: "blue", hex: "#3c44aa" },
  { name: "Brown", id: "brown", hex: "#835432" },
  { name: "Green", id: "green", hex: "#5e7c16" },
  { name: "Red", id: "red", hex: "#b02e26" },
  { name: "Black", id: "black", hex: "#1d1d21" }
];

function getTextureName(name) {
  const normalized = String(name || "").trim().toLowerCase();
  const alias = textureAliases[normalized];

  if (alias) return alias;

  return normalized
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9 ]/g, "")
    .trim()
    .replace(/\s+/g, "_");
}

function getColorFamily(product) {
  const name = String(product?.name || "").toLowerCase();

  if (/\bwool\b/.test(name)) return "wool";
  if (/\bconcrete powder\b/.test(name)) return "concrete_powder";
  if (/\bconcrete\b/.test(name)) return "concrete";
  if (/\bstained glass pane\b/.test(name)) return "stained_glass_pane";
  if (/\bstained glass\b/.test(name)) return "stained_glass";
  if (/\bterracotta\b/.test(name)) return "terracotta";
  if (/\bcarpet\b/.test(name)) return "carpet";

  return null;
}

function getProductTexture(product, colorId = null) {
  const family = getColorFamily(product);

  if (colorId && family) {
    return `${colorId}_${family}`;
  }

  if (family && family !== "terracotta") {
    const name = String(product.name || "").toLowerCase();

    const hasExplicitColor = minecraftColors.some(color =>
      new RegExp(
        `\\b${color.name.toLowerCase().replace(/ /g, "\\s+")}\\b`
      ).test(name)
    );

    if (!hasExplicitColor) {
      return `white_${family}`;
    }
  }

  return getTextureName(product.name);
}

function getTextureCandidates(product, colorId = null) {
  const texture = getProductTexture(product, colorId);

  const base =
    "https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/26.1/assets/minecraft/textures";

  const name = String(product?.name || "").toLowerCase();

  // Beds use a separate entity texture.
  if (/\bbed\b/.test(name)) {
    const color = minecraftColors.find(c =>
      name.includes(c.name.toLowerCase())
    );

    return [
      `${base}/entity/bed/${color?.id || "red"}.png`
    ];
  }

  // These textures belong in the block folder,
  // even if the product is categorized as an item.
  const blockTextures = [
    "anvil",
    "chipped_anvil",
    "damaged_anvil",
    "acacia_door_bottom",
    "birch_door_bottom",
    "oak_door_bottom",
    "spruce_door_bottom",
    "jungle_door_bottom",
    "dark_oak_door_bottom",
    "mangrove_door_bottom",
    "cherry_door_bottom"
  ];

  const isBlock =
    product.category === "Blocks" ||
    product.category === "Redstone" ||
    blockTextures.includes(texture);

  const firstType = isBlock ? "block" : "item";
  const secondType = isBlock ? "item" : "block";

  return [
    `${base}/${firstType}/${texture}.png`,
    `${base}/${secondType}/${texture}.png`
  ];
}

function productImage(product, colorId = null) {
  return getTextureCandidates(product, colorId)[0];
}

function handleProductImageError(image) {
  try {
    const candidates = JSON.parse(
      image.dataset.imageCandidates || "[]"
    );

    const nextIndex =
      Number(image.dataset.imageIndex || 0) + 1;

    if (nextIndex < candidates.length) {
      image.dataset.imageIndex = String(nextIndex);
      image.src = candidates[nextIndex];
      return;
    }
  } catch (error) {
    console.warn("Could not load product textures.", error);
  }

  image.style.display = "none";

  const fallback = image.nextElementSibling;

  if (fallback) {
    fallback.style.display = "flex";
  }
}

function imageMarkup(
  product,
  className = "product-image",
  colorId = null
) {
  const candidates = getTextureCandidates(product, colorId);

  return `
    <img
      class="${className}"
      src="${candidates[0]}"
      data-image-candidates="${escapeHTML(JSON.stringify(candidates))}"
      data-image-index="0"
      alt="${escapeHTML(product.name)}"
      loading="lazy"
      onerror="handleProductImageError(this)"
    >

    <div class="fallback-icon" style="display:none;">▦</div>
  `;
}

/* =========================================
   PRODUCT COLOR VARIANTS
========================================= */

function getCartEntry(key) {
  const rawKey = String(key);
  const marker = "::color::";
  const markerIndex = rawKey.indexOf(marker);

  const productId = markerIndex >= 0
    ? rawKey.slice(0, markerIndex)
    : rawKey;

  const colorId = markerIndex >= 0
    ? rawKey.slice(markerIndex + marker.length)
    : null;

  const product = products.find(
    item => String(item.id) === String(productId)
  );

  return product
    ? { product, colorId, key: rawKey }
    : null;
}

function getCartKey(productId, colorId = null) {
  return colorId
    ? `${productId}::color::${colorId}`
    : String(productId);
}

function getVariantLabel(colorId) {
  return minecraftColors.find(
    color => color.id === colorId
  )?.name || "";
}

function getVariantDisplayName(product, colorId) {
  if (!colorId) return product.name;

  const colorName = getVariantLabel(colorId);

  const baseName = String(product.name || "").replace(
    new RegExp(
      "^" + colorName.split(" ").join("\\s+") + "\\s+",
      "i"
    ),
    ""
  );

  return `${colorName} ${baseName}`;
}

function openColorPicker(productId) {
  const product = products.find(
    item => String(item.id) === String(productId)
  );

  if (!product || product.isService) return;

  if (!getColorFamily(product)) {
    addProductVariantToCart(product, null);
    return;
  }

  const existing = $("color-picker-modal");

  if (existing) existing.remove();

  const modal = document.createElement("div");

  modal.id = "color-picker-modal";
  modal.className = "modal-overlay active";

  modal.innerHTML = `
    <div class="modal color-picker-modal">

      <div class="modal-header">
        <div>
          <div class="modal-eyebrow">
            CHOOSE YOUR VARIANT
          </div>

          <h2>${escapeHTML(product.name)}</h2>

          <p class="color-picker-description">
            Select a Minecraft color before adding this product to your cart.
          </p>
        </div>

        <button
          class="modal-close"
          id="close-color-picker"
          type="button"
        >×</button>
      </div>

      <div class="color-options-grid">

        ${minecraftColors.map(color => `
          <button
            class="color-option"
            type="button"
            data-color-id="${color.id}"
            title="${color.name}"
          >
            <span
              class="color-swatch"
              style="--swatch-color:${color.hex};"
            ></span>

            <span>${color.name}</span>
          </button>
        `).join("")}

      </div>
    </div>
  `;

  document.body.appendChild(modal);

  $("close-color-picker").addEventListener("click", () => {
    modal.remove();
  });

  modal.addEventListener("click", event => {
    if (event.target === modal) {
      modal.remove();
    }
  });

  modal.querySelectorAll("[data-color-id]").forEach(button => {
    button.addEventListener("click", () => {
      addProductVariantToCart(
        product,
        button.dataset.colorId
      );

      modal.remove();
    });
  });
}

function addProductVariantToCart(product, colorId = null) {
  const key = getCartKey(product.id, colorId);

  cart[key] = Number(cart[key] || 0) + 1;

  saveCart();
  renderCart();
  openCart();

  showToast(
    `${getVariantDisplayName(product, colorId)} added to cart.`
  );
}

/* =========================================
   PRICES AND DISCOUNTS
========================================= */

function getManualDiscount(product) {
  return Math.max(
    0,
    Math.min(90, Number(product.discount_percent || 0))
  );
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

function stackText(product) {
  const size = Number(product.stack_size || 64);
  return `${size} items per stack`;
}

/* =========================================
   CART TOTALS
========================================= */

function getCartTotals() {
  let original = 0;
  let afterManual = 0;
  let afterQuantity = 0;
  let serviceTotal = 0;

  for (const [key, quantity] of Object.entries(cart)) {
    const entry = getCartEntry(key);

    if (!entry) continue;

    const { product } = entry;

    if (product.isService) {
      const budget = Number(product.desiredPrice || 0);

      original += budget;
      afterManual += budget;
      afterQuantity += budget;
      serviceTotal += budget;

      continue;
    }

    const stacks = Number(quantity);
    const stackPrice = Number(product.price || 0);
    const salePrice = getSalePrice(product);
    const quantityDiscount = getDiscountPercent(stacks);

    original += stackPrice * stacks;
    afterManual += salePrice * stacks;

    afterQuantity +=
      salePrice * stacks *
      (1 - quantityDiscount / 100);
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
    serviceTotal,
    total: afterQuantity,
    checkoutTotal: roundMoney(afterQuantity)
  };
}

/* =========================================
   RENDER CART
========================================= */

function renderCart() {
  const container = $("cart-items");
  const totalContainer = $("cart-total");

  if (!container) return;

  const entries = Object.entries(cart)
    .map(([key, quantity]) => ({
      key,
      quantity: Number(quantity),
      entry: getCartEntry(key)
    }))
    .filter(item =>
      item.quantity > 0 && item.entry
    );

  // Cart item count
  const count = entries.reduce(
    (sum, item) => sum + item.quantity,
    0
  );

  setText("cart-count", count);

  // Empty cart
  if (!entries.length) {
    container.innerHTML = `
      <div class="empty-cart">
        <div class="empty-icon">🛒</div>
        <p>Your cart is empty.</p>
      </div>
    `;

    if (totalContainer) {
      totalContainer.innerHTML = "";
    }

    const checkoutButton = $("checkout-button");
    if (checkoutButton) checkoutButton.disabled = true;

    return;
  }

  const checkoutButton = $("checkout-button");
  if (checkoutButton) checkoutButton.disabled = false;

  // Render products
  container.innerHTML = entries.map(item => {
    const { key, quantity, entry } = item;
    const { product, colorId } = entry;

    const displayName = getVariantDisplayName(
      product,
      colorId
    );

    const discount = getDiscountPercent(quantity);
    const unitPrice = getSalePrice(product);

    const totalPrice =
      unitPrice * quantity * (1 - discount / 100);

    return `
      <div class="cart-item">

        <div class="cart-item-image">
          ${imageMarkup(
            product,
            "cart-product-image",
            colorId
          )}
        </div>

        <div class="cart-item-details">

          <h3>${escapeHTML(displayName)}</h3>

          <div class="cart-item-price">
            ${money(totalPrice)}
          </div>

          <div class="quantity-controls">

            <button
              type="button"
              data-cart-key="${escapeHTML(key)}"
              data-change="-1"
              aria-label="Decrease quantity"
            >−</button>

            <span>${quantity}</span>

            <button
              type="button"
              data-cart-key="${escapeHTML(key)}"
              data-change="1"
              aria-label="Increase quantity"
            >+</button>

          </div>

          <button
            type="button"
            class="remove-cart-item"
            data-remove-cart="${escapeHTML(key)}"
          >
            Remove
          </button>

        </div>
      </div>
    `;
  }).join("");

  // Quantity buttons
  container.querySelectorAll("[data-cart-key]")
    .forEach(button => {
      button.addEventListener("click", () => {
        changeQuantity(
          button.dataset.cartKey,
          Number(button.dataset.change)
        );
      });
    });

  // Remove buttons
  container.querySelectorAll("[data-remove-cart]")
    .forEach(button => {
      button.addEventListener("click", () => {
        delete cart[button.dataset.removeCart];

        saveCart();
        renderCart();
      });
    });

  // Cart totals
  const totals = getCartTotals();

  if (totalContainer) {
    totalContainer.innerHTML = `
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
      $("products").innerHTML = `
        <p class="error-message">
          Could not load products: ${escapeHTML(error.message)}
        </p>
      `;
    }

    if ($("offers-grid")) {
      $("offers-grid").innerHTML = `
        <p class="error-message">Could not load offers.</p>
      `;
    }

    return;
  }

  const serviceProducts = products.filter(
    product => product.isService
  );

  products = [
    ...(data || []),
    ...serviceProducts
  ];

  renderOffers();
  renderProducts();
  renderCart();
}

/* =========================================
   NAVIGATION
========================================= */

function showCategory(nextCategory) {
  const validCategories = [
    "All",
    "Blocks",
    "Items",
    "Redstone",
    "Armor & Weapons",
    "Enchantments",
    "Services"
  ];

  if (!validCategories.includes(nextCategory)) {
    nextCategory = "All";
  }

  category = nextCategory;

  document.querySelectorAll(".nav-link").forEach(link => {
    link.classList.toggle(
      "active",
      link.dataset.category === nextCategory
    );
  });

  const requestsTab = document.querySelector(
    "[data-requests-tab]"
  );

  if (requestsTab) {
    requestsTab.classList.remove("active");
  }

  if ($("offers")) {
    $("offers").style.display =
      nextCategory === "All" ? "" : "none";
  }

  if ($("shop")) {
    $("shop").style.display =
      nextCategory === "All" ? "none" : "";
  }

  if ($("admin-section")) {
    $("admin-section").hidden = true;
    $("admin-section").style.display = "none";
  }

  const descriptions = {
    "Blocks": "Building materials and decorative blocks.",
    "Items": "Useful items and resources.",
    "Redstone": "Redstone components, mechanisms and automation.",
    "Armor & Weapons": "Equipment for your adventures.",
    "Enchantments": "Enchantments and upgrades.",
    "Services": "Services and custom requests."
  };

  setText("category-title", nextCategory);

  setText(
    "category-description",
    descriptions[nextCategory] ||
      "Browse available products."
  );

  renderProducts();

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
}

/* Delegated navigation click handler */

document.addEventListener("click", event => {
  const link = event.target.closest(".nav-link");

  if (!link) return;

  event.preventDefault();

  showCategory(link.dataset.category);
});

/* =========================================
   OFFERS
========================================= */

function renderOffers() {
  const container = $("offers-grid");

  if (!container) return;

  const search = (
    $("search")?.value || ""
  ).toLowerCase();

  const offers = products.filter(product => {
    if (product.isService) return false;

    const hasDiscount =
      Number(product.discount_percent || 0) > 0;

    const matchesSearch =
      String(product.name || "").toLowerCase().includes(search) ||
      String(product.description || "").toLowerCase().includes(search);

    return hasDiscount && matchesSearch;
  });

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
    const oldPrice = Number(product.price || 0);
    const newPrice = getSalePrice(product);

    return `
      <article class="offer-card">

        <div class="offer-copy">

          <div class="offer-kicker">
            ${escapeHTML(product.category)}
          </div>

          <h3>${escapeHTML(product.name)}</h3>

          <p>
            ${escapeHTML(
              product.description || "Available now at Brat Ltd."
            )}
          </p>

          <div class="offer-details">

            <div class="offer-prices">
              <span class="old-price">
                ${money(oldPrice)}
              </span>

              <span class="offer-price">
                ${money(newPrice)}
              </span>

              <span class="product-discount-badge">
                -${getManualDiscount(product)}%
              </span>
            </div>

            <span class="stack-info">
              ${stackText(product)}
            </span>

          </div>

          <button
            class="primary-button offer-add-button"
            data-add="${escapeHTML(product.id)}"
            type="button"
          >
            Add to cart
          </button>

        </div>

      </article>
    `;
  }).join("");

  container.querySelectorAll("[data-add]").forEach(button => {
    button.addEventListener("click", () => {
      addToCart(button.dataset.add);
    });
  });
}

/* =========================================
   PRODUCT DISPLAY
========================================= */

function productPriceMarkup(product) {
  const price = Number(product.price || 0);
  const discount = getManualDiscount(product);

  if (discount > 0) {
    return `
      <span class="old-price">${money(price)}</span>

      <span class="price">
        ${money(getSalePrice(product))}
      </span>

      <span class="product-discount-badge">
        -${discount}%
      </span>
    `;
  }

  return `<span class="price">${money(price)}</span>`;
}

/* ADMIN PRODUCT BUTTONS */

function adminProductButton(product) {
  if (!isAdmin) return "";

  return `
    <div class="product-admin-actions">
      <button
        class="product-admin-menu"
        data-edit-product="${escapeHTML(product.id)}"
        type="button"
      >
        ✎ Edit
      </button>

      <button
        class="product-delete-button"
        data-delete-product="${escapeHTML(product.id)}"
        type="button"
      >
        🗑 Delete
      </button>
    </div>
  `;
}

function renderProducts() {
  const container = $("products");

  if (!container) return;

  if (category === "Services") {
    if ($("empty-products")) {
      $("empty-products").style.display = "none";
    }

    renderServiceForm();
    return;
  }

  const search = (
    $("search")?.value || ""
  ).toLowerCase();

  const filtered = products.filter(product => {
    if (product.isService) return false;

    const matchesCategory =
      product.category === category;

    const matchesSearch =
      String(product.name || "").toLowerCase().includes(search) ||
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

      <div class="product-info">

        <div class="product-main-info">

          <div class="product-tag">
            ${escapeHTML(product.category)}
          </div>

          <h3 class="product-name">
            ${escapeHTML(product.name)}
          </h3>

          <p class="product-description">
            ${escapeHTML(product.description || "")}
          </p>

          <div class="stack-info">
            ${stackText(product)}
          </div>

        </div>

        <div class="product-price-area">

          <div class="price-row">
            ${productPriceMarkup(product)}
          </div>

        </div>

        <div class="product-actions">

          <button
            class="primary-button add-button"
            data-add="${escapeHTML(product.id)}"
            type="button"
          >
            Add to cart
          </button>

          ${adminProductButton(product)}

        </div>

      </div>

    </article>
  `).join("");

  container.querySelectorAll("[data-add]").forEach(button => {
    button.addEventListener("click", () => {
      addToCart(button.dataset.add);
    });
  });

  container.querySelectorAll("[data-edit-product]").forEach(button => {
    button.addEventListener("click", () => {
      const product = products.find(item =>
        String(item.id) === String(button.dataset.editProduct)
      );

      if (product) {
        openProductEditor(product);
      }
    });
  });

  container.querySelectorAll("[data-delete-product]").forEach(button => {
    button.addEventListener("click", async () => {
      await deleteProduct(button.dataset.deleteProduct);
    });
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
   PRODUCT EDITOR
========================================= */

function openProductEditor(productOrId) {
  if (!isAdmin) return;

  const product = typeof productOrId === "object"
    ? productOrId
    : products.find(item =>
        String(item.id) === String(productOrId)
      ) || catalogCache.find(item =>
        String(item.id) === String(productOrId)
      );

  if (!product) {
    showToast("Product not found.", "error");
    return;
  }

  editingProductId = product.id;

  const existing = $("product-editor-modal");

  if (existing) existing.remove();

  const modal = document.createElement("div");

  modal.id = "product-editor-modal";
  modal.className = "modal-backdrop show";

  const categories = [
    "Blocks",
    "Items",
    "Redstone",
    "Armor & Weapons",
    "Enchantments"
  ];

  modal.innerHTML = `
    <div class="modal product-editor-modal">
      <button
        class="modal-close"
        id="close-product-editor"
        type="button"
      >×</button>

      <div class="modal-eyebrow">PRODUCT MANAGEMENT</div>

      <h2>
        Edit <span class="orange">product.</span>
      </h2>

      <form id="product-editor-form">
        <label>Product name</label>

        <input
          id="edit-product-name"
          type="text"
          maxlength="100"
          value="${escapeHTML(product.name)}"
          required
        >

        <label>Category</label>

        <select id="edit-product-category">
          ${categories.map(item => `
            <option
              value="${item}"
              ${product.category === item ? "selected" : ""}
            >${item}</option>
          `).join("")}
        </select>

        <label>
          Price per stack (${Number(product.stack_size || 64)} items)
        </label>

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

        <button
          class="primary-button full-width"
          type="submit"
        >
          Save changes
        </button>

        <p id="product-editor-message" class="form-message"></p>
      </form>
    </div>
  `;

  document.body.appendChild(modal);

  $("close-product-editor").addEventListener("click", () => {
    modal.remove();
  });

  modal.addEventListener("click", event => {
    if (event.target === modal) {
      modal.remove();
    }
  });

  $("product-editor-form").addEventListener(
    "submit",
    async event => {
      event.preventDefault();

      const name = $("edit-product-name").value.trim();
      const price = Number($("edit-product-price").value);
      const discount = Number($("edit-product-discount").value);
      const stackSize = Number($("edit-product-stack").value);

      if (
        !name ||
        !Number.isFinite(price) ||
        price < 0 ||
        !Number.isInteger(discount) ||
        discount < 0 ||
        discount > 90 ||
        !Number.isInteger(stackSize) ||
        stackSize < 1 ||
        stackSize > 64
      ) {
        setText(
          "product-editor-message",
          "Please enter valid values."
        );
        return;
      }

      const saveButton = $("product-editor-form")
        .querySelector('button[type="submit"]');

      saveButton.disabled = true;
      saveButton.textContent = "Saving...";

      const { error } = await supabaseClient
        .from("products")
        .update({
          name,
          price,
          discount_percent: discount,
          stack_size: stackSize,
          category: $("edit-product-category").value,
          is_active: $("edit-product-active").checked
        })
        .eq("id", editingProductId);

      if (error) {
        setText("product-editor-message", error.message);
        saveButton.disabled = false;
        saveButton.textContent = "Save changes";
        return;
      }

      modal.remove();

      showToast("Product updated successfully.");

      await loadProducts();

      if (isAdmin) {
        await loadCatalogProducts();
      }
    }
  );
}

/* =========================================
   DELETE PRODUCT
========================================= */

async function deleteProduct(productId) {
  if (!isAdmin || !currentSession) {
    showToast("Permission denied.", "error");
    return;
  }

  const product =
    catalogCache.find(item =>
      String(item.id) === String(productId)
    ) ||
    products.find(item =>
      String(item.id) === String(productId)
    );

  if (!product) {
    showToast("Product not found.", "error");
    return;
  }

  const confirmed = confirm(
    `Are you sure you want to permanently delete "${product.name}"?\n\n` +
    "This action cannot be undone."
  );

  if (!confirmed) return;

  try {
    const { error } = await supabaseClient
      .from("products")
      .delete()
      .eq("id", productId);

    if (error) throw error;

    Object.keys(cart).forEach(key => {
      if (
        String(key) === String(productId) ||
        String(key).startsWith(`${productId}::color::`)
      ) {
        delete cart[key];
      }
    });

    saveCart();

    products = products.filter(
      item => String(item.id) !== String(productId)
    );

    catalogCache = catalogCache.filter(
      item => String(item.id) !== String(productId)
    );

    renderProducts();
    renderOffers();
    renderCart();
    renderCatalogProducts(catalogCache);

    showToast("Product deleted successfully.");

  } catch (error) {
    console.error("Product deletion failed:", error);

    showToast(
      `Could not delete product: ${error.message}`,
      "error"
    );
  }
}

/* =========================================
   CART STORAGE
========================================= */

function saveCart() {
  localStorage.setItem("bratCart", JSON.stringify(cart));
}

/* =========================================
   ADD TO CART
========================================= */

function addToCart(id) {
  openColorPicker(id);
}

/* =========================================
   CHANGE QUANTITY
========================================= */

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
  const entries = Object.entries(cart).filter(([key, quantity]) =>
    Number(quantity) > 0 &&
    Boolean(getCartEntry(key))
  );

  if (!entries.length) {
    showToast("Your cart is empty.", "error");
    return;
  }

  if (!currentSession) {
    showToast("Please log in before checkout.", "error");
    closeCart();
    openLogin();
    return;
  }

  const modal = $("checkout-modal");

  if (!modal) {
    showToast("Checkout is currently unavailable.", "error");
    return;
  }

  const totals = getCartTotals();

  const totalStacks = entries.reduce(
    (sum, [, quantity]) => sum + Number(quantity),
    0
  );

  if ($("checkout-summary")) {
    $("checkout-summary").innerHTML = `
      <div class="checkout-summary-row">
        <span>Stacks in cart</span>
        <strong>${totalStacks}</strong>
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

  if (modal) {
    modal.classList.remove("active");
  }

  document.body.style.overflow = "";
}

if ($("checkout-button")) {
  $("checkout-button").addEventListener("click", openCheckout);
}

if ($("checkout-close")) {
  $("checkout-close").addEventListener("click", closeCheckout);
}

if ($("checkout-modal")) {
  $("checkout-modal").addEventListener("click", event => {
    if (event.target === $("checkout-modal")) {
      closeCheckout();
    }
  });
}

/* =========================================
   CHECKOUT FORM
========================================= */

function getCheckoutValues() {
  return {
    minecraftName:
      $("checkout-minecraft-name")?.value.trim() || "",

    district:
      $("checkout-district")?.value.trim() || "",

    address:
      $("checkout-address")?.value.trim() || "",

    note:
      $("checkout-note")?.value.trim() || ""
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
    .filter(([, quantity]) => Number(quantity) > 0)
    .map(([key, quantity]) => {
      const entry = getCartEntry(key);

      if (!entry) return null;

      const { product, colorId } = entry;

      if (product.isService) return null;

      const stacks = Number(quantity);
      const stackPrice = Number(product.price || 0);
      const manualDiscount = getManualDiscount(product);
      const quantityDiscount = getDiscountPercent(stacks);

      const priceAfterManual =
        stackPrice * (1 - manualDiscount / 100);

      const finalPrice =
        priceAfterManual *
        stacks *
        (1 - quantityDiscount / 100);

      return {
        id: product.id,
        name: getVariantDisplayName(product, colorId),
        type: "product",
        category: product.category,
        quantity: stacks,
        stack_size: Number(product.stack_size || 64),
        price_per_stack: stackPrice,
        manual_discount: manualDiscount,
        quantity_discount: quantityDiscount,

        // Color variant information
        variant_color: colorId,
        variant_color_name: colorId
          ? getVariantLabel(colorId)
          : null,

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
   PLACE PRODUCT ORDER
========================================= */

async function placeOrder(event) {
  event.preventDefault();

  if (!currentSession) {
    showToast("Please log in before placing an order.", "error");
    closeCheckout();
    openLogin();
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
    request_type: "product",
    items: orderItems,
    description: "",
    links: [],
    image_urls: [],
    desired_price: null,
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

  try {
    const { error } = await supabaseClient
      .from("orders")
      .insert(orderData);

    if (error) throw error;

    cart = {};
    saveCart();
    renderCart();

    closeCheckout();

    if ($("checkout-form")) {
      $("checkout-form").reset();
    }

    showToast("Your order has been submitted successfully.");

  } catch (error) {
    console.error("Order error:", error);

    showToast(
      `Could not place order: ${error.message}`,
      "error"
    );

  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Place order";
    }
  }
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

  container.innerHTML = `
    <div class="service-page">

      <div class="service-intro">
        <div class="modal-eyebrow">BRAT LTD. SERVICES</div>

        <h2>
          Need something <span class="orange">special?</span>
        </h2>

        <p>
          Request custom builds, deliveries or other services
          directly from our team.
        </p>
      </div>

      <form id="service-request-form" class="service-form">

        <div class="form-group">
          <label for="service-title">Request title</label>

          <input
            id="service-title"
            type="text"
            maxlength="100"
            placeholder="What do you need?"
            required
          >
        </div>

        <div class="form-group">
          <label for="service-type">Service type</label>

          <select id="service-type" required>
            <option value="">Select a service</option>
            <option value="Building">Building</option>
            <option value="Delivery">Delivery</option>
            <option value="Mining">Mining</option>
            <option value="Redstone">Redstone</option>
            <option value="Custom">Other / Custom</option>
          </select>
        </div>

        <div class="form-group">
          <label for="service-description">
            Description
          </label>

          <textarea
            id="service-description"
            rows="5"
            maxlength="3000"
            placeholder="Describe your request in detail..."
            required
          ></textarea>
        </div>

        <div class="form-group">
          <label for="service-budget">
            Your budget (KB$)
          </label>

          <input
            id="service-budget"
            type="number"
            min="0"
            step="1"
            placeholder="Optional"
          >
        </div>

        <div class="form-group">
          <label for="service-links">
            Reference links
          </label>

          <textarea
            id="service-links"
            rows="2"
            placeholder="Paste links, one per line..."
          ></textarea>
        </div>

        <div class="form-group">
          <label for="service-images">
            Reference images
          </label>

          <input
            id="service-images"
            type="file"
            accept="image/*"
            multiple
          >

          <small>
            You can upload up to 5 images.
          </small>
        </div>

        <div class="form-group">
          <label for="service-minecraft-name">
            Minecraft username
          </label>

          <input
            id="service-minecraft-name"
            type="text"
            maxlength="32"
            placeholder="Your Minecraft name"
            required
          >
        </div>

        <button
          class="primary-button full-width"
          type="submit"
          id="submit-service-request"
        >
          Submit request →
        </button>

        <p
          id="service-request-message"
          class="form-message"
        ></p>

      </form>
    </div>
  `;

  $("service-request-form").addEventListener(
    "submit",
    submitServiceRequest
  );
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
      throw new Error(
        `${file.name} is too large. Maximum size is 5 MB.`
      );
    }

    const extension = file.name.split(".").pop();

    const fileName =
      `${currentSession.user.id}/` +
      `${Date.now()}-${crypto.randomUUID()}.${extension}`;

    const { data, error } = await supabaseClient
      .storage
      .from("service-images")
      .upload(fileName, file, {
        cacheControl: "3600",
        upsert: false
      });

    if (error) throw error;

    const { data: publicData } = supabaseClient
      .storage
      .from("service-images")
      .getPublicUrl(data.path);

    if (publicData?.publicUrl) {
      uploadedUrls.push(publicData.publicUrl);
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
    showToast("Please log in first.", "error");
    openLogin();
    return;
  }

  const title = $("service-title").value.trim();
  const type = $("service-type").value;
  const description = $("service-description").value.trim();
  const budgetInput = $("service-budget").value;
  const minecraftName =
    $("service-minecraft-name").value.trim();

  const budget = budgetInput
    ? Number(budgetInput)
    : null;

  if (!title || !type || !description || !minecraftName) {
    showToast("Please complete all required fields.", "error");
    return;
  }

  if (
    budget !== null &&
    (!Number.isFinite(budget) || budget < 0)
  ) {
    showToast("Please enter a valid budget.", "error");
    return;
  }

  const links = $("service-links").value
    .split("\n")
    .map(link => link.trim())
    .filter(Boolean)
    .map(safeExternalUrl)
    .filter(Boolean);

  const files = $("service-images").files;
  const button = $("submit-service-request");

  button.disabled = true;
  button.textContent = "Uploading...";

  try {
    const imageUrls = await uploadServiceImages(files);

    button.textContent = "Submitting...";

    const requestData = {
      request_type: "service",
      items: [],
      description: `${title}\n\nType: ${type}\n\n${description}`,
      links,
      image_urls: imageUrls,
      desired_price: budget,
      subtotal: budget || 0,
      discount_amount: 0,
      total: budget || 0,
      status: "pending",
      minecraft_name: minecraftName,
      note: "",
      user_id: currentSession.user.id
    };

    const { error } = await supabaseClient
      .from("orders")
      .insert(requestData);

    if (error) throw error;

    $("service-request-form").reset();

    showToast("Your service request was submitted.");

    setText(
      "service-request-message",
      "Your request has been successfully submitted."
    );

    if (isAdmin) {
      await loadRequests();
    }

  } catch (error) {
    console.error("Service request error:", error);

    showToast(
      `Request failed: ${error.message}`,
      "error"
    );

    setText(
      "service-request-message",
      error.message
    );

  } finally {
    button.disabled = false;
    button.textContent = "Submit request →";
  }
}

/* =========================================
   AUTHENTICATION
========================================= */

async function loadSession() {
  const { data, error } = await supabaseClient.auth.getSession();

  if (error) {
    console.error("Session loading error:", error);
    return;
  }

  currentSession = data.session;

  await updateAuthState();
}

/* =========================================
   AUTH STATE
========================================= */

async function updateAuthState() {
  currentSession = (
    await supabaseClient.auth.getSession()
  ).data.session;

  isAdmin = false;

  if (currentSession) {
    const { data: profile, error } = await supabaseClient
      .from("profiles")
      .select("role")
      .eq("id", currentSession.user.id)
      .maybeSingle();

    if (error) {
      console.error("Profile loading error:", error);
    }

    isAdmin = Boolean(
      profile &&
      ["admin", "editor"].includes(profile.role)
    );
  }

  updateAccountUI();

  if (isAdmin) {
    await loadCatalogProducts();
  }
}

/* =========================================
   ACCOUNT UI
========================================= */


function updateAccountUI() {
  const accountButton = $("account-button");
  const loginButton = $("login-button");
  const logoutButton = $("logout-button");
  const adminButton = $("admin-button");

  // Login button
  if (loginButton) {
    loginButton.hidden = Boolean(currentSession);
  }

  // Account button
  if (accountButton) {
    accountButton.hidden = !currentSession;
    accountButton.textContent = currentSession
      ? "Account"
      : "Account";
  }

  // Logout button
  if (logoutButton) {
    logoutButton.hidden = !currentSession;
  }

  // Admin dashboard button
  if (adminButton) {
    adminButton.hidden = !isAdmin;
  }

  // Admin-only navigation elements
  document.querySelectorAll("[data-admin-only]").forEach(element => {
    element.hidden = !isAdmin;
  });
}

/* =========================================
   LOGIN MODAL
========================================= */

function openLogin() {
  const modal = $("login-modal");

  if (!modal) {
    showToast("Login is currently unavailable.", "error");
    return;
  }

  modal.classList.add("active");
  document.body.style.overflow = "hidden";
}

function closeLogin() {
  const modal = $("login-modal");

  if (modal) {
    modal.classList.remove("active");
  }

  document.body.style.overflow = "";
}

if ($("login-button")) {
  $("login-button").addEventListener("click", openLogin);
}

if ($("account-button")) {
  $("account-button").addEventListener("click", () => {
    if (currentSession) {
      if (isAdmin) {
        openAdmin();
      } else {
        showToast(
          `Logged in as ${currentSession.user.email}`
        );
      }
    } else {
      openLogin();
    }
  });
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
   LOGIN FORM
========================================= */

async function loginUser(event) {
  event.preventDefault();

  const email = $("login-email").value.trim();
  const password = $("login-password").value;

  // Submit-Button zuverlässig finden
  const button =
    event.submitter ||
    event.currentTarget.querySelector(
      'button[type="submit"], input[type="submit"]'
    ) ||
    $("login-submit");

  if (!email || !password) {
    showToast("Enter your email and password.", "error");
    return;
  }

  // Button nur deaktivieren, wenn er gefunden wurde
  if (button) {
    button.disabled = true;

    if (button.tagName === "BUTTON") {
      button.textContent = "Signing in...";
    }
  }

  try {
    const { data, error } = await supabaseClient.auth
      .signInWithPassword({
        email,
        password
      });

    if (error) throw error;

    currentSession = data.session;

    await updateAuthState();

    closeLogin();

    showToast("Successfully signed in.");

    if (isAdmin) {
      await loadRequests();
      await loadCatalogProducts();
    }

  } catch (error) {
    console.error("Login error:", error);

    showToast(
      `Login failed: ${error.message}`,
      "error"
    );

  } finally {
    if (button) {
      button.disabled = false;

      if (button.tagName === "BUTTON") {
        button.textContent = "Sign in";
      }
    }
  }
}

/* =========================================
   REGISTER
========================================= */

async function registerUser(event) {
  event.preventDefault();

  const email = $("register-email")?.value.trim();
  const password = $("register-password")?.value;

  if (!email || !password) {
    showToast("Enter email and password.", "error");
    return;
  }

  if (password.length < 6) {
    showToast(
      "Password must contain at least 6 characters.",
      "error"
    );
    return;
  }

  try {
    const { data, error } = await supabaseClient.auth
      .signUp({
        email,
        password
      });

    if (error) throw error;

    if (data.session) {
      currentSession = data.session;
      await updateAuthState();
    }

    showToast(
      "Registration successful. Check your email if confirmation is required."
    );

    closeLogin();

  } catch (error) {
    console.error("Registration error:", error);

    showToast(
      `Registration failed: ${error.message}`,
      "error"
    );
  }
}

if ($("register-form")) {
  $("register-form").addEventListener(
    "submit",
    registerUser
  );
}

/* =========================================
   PASSWORD RESET
========================================= */

async function resetPassword() {
  const email = $("login-email")?.value.trim();

  if (!email) {
    showToast(
      "Please enter your email address first.",
      "error"
    );
    return;
  }

  try {
    const { error } = await supabaseClient.auth
      .resetPasswordForEmail(email, {
        redirectTo: window.location.origin
      });

    if (error) throw error;

    showToast("Password reset email sent.");

  } catch (error) {
    console.error("Password reset error:", error);

    showToast(
      `Could not send reset email: ${error.message}`,
      "error"
    );
  }
}

if ($("forgot-password")) {
  $("forgot-password").addEventListener(
    "click",
    resetPassword
  );
}

/* =========================================
   LOGOUT
========================================= */

async function logoutUser() {
  try {
    const { error } = await supabaseClient.auth.signOut();

    if (error) throw error;

    currentSession = null;
    isAdmin = false;

    updateAccountUI();

    closeCart();

    cart = {};
    saveCart();
    renderCart();

    showToast("You have been signed out.");

  } catch (error) {
    console.error("Logout error:", error);

    showToast(
      `Logout failed: ${error.message}`,
      "error"
    );
  }
}

if ($("logout-button")) {
  $("logout-button").addEventListener(
    "click",
    logoutUser
  );
}

/* =========================================
   AUTH STATE LISTENER
========================================= */

supabaseClient.auth.onAuthStateChange(
  async (event, session) => {
    currentSession = session;

    if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
      await updateAuthState();
    }

    if (event === "SIGNED_OUT") {
      currentSession = null;
      isAdmin = false;
      updateAccountUI();
    }
  }
);
/* =========================================
   ADMIN DASHBOARD
========================================= */

function openAdmin() {
  if (!isAdmin) {
    showToast("You do not have permission to access the admin panel.", "error");
    return;
  }

  const section = $("admin-section");

  if (!section) {
    showToast("Admin panel is unavailable.", "error");
    return;
  }

  section.hidden = false;
  section.style.display = "";

  if ($("offers")) {
    $("offers").style.display = "none";
  }

  if ($("shop")) {
    $("shop").style.display = "none";
  }

  section.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });

  loadAdminDashboard();
}

async function loadAdminDashboard() {
  if (!isAdmin) return;

  await Promise.all([
    loadOrders(),
    loadRequests(),
    loadCatalogProducts()
  ]);

  renderAdminStats();
}

if ($("admin-button")) {
  $("admin-button").addEventListener("click", openAdmin);
}

/* =========================================
   ADMIN NAVIGATION
========================================= */

function showAdminTab(tab) {
  if (!isAdmin) return;

  document.querySelectorAll("[data-admin-panel]").forEach(panel => {
    panel.style.display =
      panel.dataset.adminPanel === tab ? "" : "none";
  });

  document.querySelectorAll("[data-admin-tab]").forEach(button => {
    button.classList.toggle(
      "active",
      button.dataset.adminTab === tab
    );
  });

  if (tab === "orders") {
    loadOrders();
  }

  if (tab === "requests") {
    loadRequests();
  }

  if (tab === "products") {
    loadCatalogProducts();
  }
}

document.querySelectorAll("[data-admin-tab]").forEach(button => {
  button.addEventListener("click", () => {
    showAdminTab(button.dataset.adminTab);
  });
});

/* =========================================
   ADMIN STATISTICS
========================================= */

async function renderAdminStats() {
  if (!isAdmin) return;

  const { data: orderData, error } = await supabaseClient
    .from("orders")
    .select("id,status,total,request_type");

  if (error) {
    console.error("Admin statistics error:", error);
    return;
  }

  const allOrders = orderData || [];

  const pending = allOrders.filter(
    order => order.status === "pending"
  );

  const completed = allOrders.filter(
    order => order.status === "completed"
  );

  const revenue = allOrders
    .filter(order => order.status === "completed")
    .reduce(
      (sum, order) => sum + Number(order.total || 0),
      0
    );

  setText("admin-stat-orders", allOrders.length);
  setText("admin-stat-pending", pending.length);
  setText("admin-stat-completed", completed.length);
  setText("admin-stat-revenue", money(revenue));
}

/* =========================================
   LOAD ORDERS
========================================= */

let orders = [];

async function loadOrders() {
  if (!isAdmin) return;

  const container = $("admin-orders");

  if (container) {
    container.innerHTML = `
      <div class="loading-state">
        Loading orders...
      </div>
    `;
  }

  const { data, error } = await supabaseClient
    .from("orders")
    .select("*")
    .order("created_at", {
      ascending: false
    });

  if (error) {
    console.error("Order loading error:", error);

    if (container) {
      container.innerHTML = `
        <p class="error-message">
          Could not load orders: ${escapeHTML(error.message)}
        </p>
      `;
    }

    return;
  }

  orders = data || [];

  renderOrders();
  renderAdminStats();
}

/* =========================================
   ORDER STATUS
========================================= */

const orderStatuses = [
  "pending",
  "processing",
  "completed",
  "cancelled"
];

function getStatusLabel(status) {
  const labels = {
    pending: "Pending",
    processing: "Processing",
    completed: "Completed",
    cancelled: "Cancelled"
  };

  return labels[status] || status;
}

function getStatusClass(status) {
  const allowed = [
    "pending",
    "processing",
    "completed",
    "cancelled"
  ];

  return allowed.includes(status)
    ? status
    : "pending";
}

async function updateOrderStatus(orderId, status) {
  if (!isAdmin) return;

  if (!orderStatuses.includes(status)) {
    showToast("Invalid order status.", "error");
    return;
  }

  const { error } = await supabaseClient
    .from("orders")
    .update({
      status
    })
    .eq("id", orderId);

  if (error) {
    console.error("Order status error:", error);

    showToast(
      `Could not update status: ${error.message}`,
      "error"
    );

    return;
  }

  showToast("Order status updated.");

  await loadOrders();
}

/* =========================================
   ORDER ITEMS DISPLAY
========================================= */

function renderOrderItems(items) {
  if (!Array.isArray(items) || !items.length) {
    return `<span class="muted">No products</span>`;
  }

  return `
    <div class="order-item-list">
      ${items.map(item => `
        <div class="order-item-row">

          <span>
            ${escapeHTML(item.name || "Product")}
            ${item.variant_color_name ? `
              <span class="order-variant">
                (${escapeHTML(item.variant_color_name)})
              </span>
            ` : ""}
          </span>

          <strong>
            × ${Number(item.quantity || 1)}
          </strong>

        </div>
      `).join("")}
    </div>
  `;
}

/* =========================================
   RENDER ORDERS
========================================= */

function renderOrders() {
  const container = $("admin-orders");

  if (!container) return;

  if (!orders.length) {
    container.innerHTML = `
      <div class="empty-state">
        <p>No orders found.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = orders.map(order => {
    const items = Array.isArray(order.items)
      ? order.items
      : [];

    const requestType =
      order.request_type === "service"
        ? "Service request"
        : "Product order";

    return `
      <article class="admin-order-card">

        <div class="admin-order-header">

          <div>
            <span class="order-number">
              #${escapeHTML(String(order.id).slice(0, 8))}
            </span>

            <span class="order-date">
              ${formatDate(order.created_at)}
            </span>
          </div>

          <span class="status-badge ${getStatusClass(order.status)}">
            ${escapeHTML(getStatusLabel(order.status))}
          </span>

        </div>

        <div class="admin-order-body">

          <div class="order-meta">
            <span>Type</span>
            <strong>${requestType}</strong>
          </div>

          <div class="order-meta">
            <span>Minecraft username</span>
            <strong>
              ${escapeHTML(order.minecraft_name || "Not provided")}
            </strong>
          </div>

          <div class="order-meta">
            <span>Customer ID</span>
            <strong>
              ${escapeHTML(order.user_id || "Unknown")}
            </strong>
          </div>

          <div class="order-meta">
            <span>Total</span>
            <strong>${money(order.total)}</strong>
          </div>

          ${order.delivery_district ? `
            <div class="order-meta">
              <span>District</span>
              <strong>
                ${escapeHTML(order.delivery_district)}
              </strong>
            </div>
          ` : ""}

          ${order.delivery_address ? `
            <div class="order-meta">
              <span>Address</span>
              <strong>
                ${escapeHTML(order.delivery_address)}
              </strong>
            </div>
          ` : ""}

          ${order.note ? `
            <div class="order-note">
              <strong>Customer note</strong>
              <p>${escapeHTML(order.note)}</p>
            </div>
          ` : ""}

          ${order.request_type === "service" ? `
            <div class="order-description">
              <strong>Service description</strong>
              <p>${escapeHTML(order.description || "")}</p>
            </div>
          ` : renderOrderItems(items)}

          ${Array.isArray(order.links) && order.links.length ? `
            <div class="order-links">
              <strong>Reference links</strong>

              ${order.links.map(link => {
                const safeUrl = safeExternalUrl(link);

                return safeUrl ? `
                  <a
                    href="${escapeHTML(safeUrl)}"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open reference
                  </a>
                ` : "";
              }).join("")}
            </div>
          ` : ""}

          ${Array.isArray(order.image_urls) && order.image_urls.length ? `
            <div class="order-images">
              <strong>Reference images</strong>

              <div class="order-image-grid">
                ${order.image_urls.map(url => {
                  const safeUrl = safeExternalUrl(url);

                  return safeUrl ? `
                    <a
                      href="${escapeHTML(safeUrl)}"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <img
                        src="${escapeHTML(safeUrl)}"
                        alt="Customer reference"
                        loading="lazy"
                      >
                    </a>
                  ` : "";
                }).join("")}
              </div>
            </div>
          ` : ""}

        </div>

        <div class="admin-order-footer">

          <label>
            Update status

            <select
              data-order-status="${escapeHTML(order.id)}"
            >
              ${orderStatuses.map(status => `
                <option
                  value="${status}"
                  ${order.status === status ? "selected" : ""}
                >
                  ${getStatusLabel(status)}
                </option>
              `).join("")}
            </select>
          </label>

          <button
            class="secondary-button"
            data-order-update="${escapeHTML(order.id)}"
            type="button"
          >
            Save status
          </button>

        </div>

      </article>
    `;
  }).join("");

  container.querySelectorAll("[data-order-update]").forEach(button => {
    button.addEventListener("click", async () => {
      const id = button.dataset.orderUpdate;

      const select = container.querySelector(
        `[data-order-status="${CSS.escape(id)}"]`
      );

      if (select) {
        await updateOrderStatus(id, select.value);
      }
    });
  });
}

/* =========================================
   SERVICE REQUESTS
========================================= */

async function loadRequests() {
  if (!isAdmin) return;

  const container = $("admin-requests");

  if (container) {
    container.innerHTML = `
      <div class="loading-state">
        Loading requests...
      </div>
    `;
  }

  const { data, error } = await supabaseClient
    .from("orders")
    .select("*")
    .eq("request_type", "service")
    .order("created_at", {
      ascending: false
    });

  if (error) {
    console.error("Request loading error:", error);

    if (container) {
      container.innerHTML = `
        <p class="error-message">
          Could not load requests:
          ${escapeHTML(error.message)}
        </p>
      `;
    }

    return;
  }

  requests = data || [];

  renderRequests();
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

  let filtered = [...requests];

  if (currentRequestFilter !== "all") {
    filtered = filtered.filter(request =>
      request.status === currentRequestFilter
    );
  }

  if (!filtered.length) {
    container.innerHTML = `
      <div class="empty-state">
        <p>No service requests found.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(request => `
    <article class="admin-order-card">

      <div class="admin-order-header">

        <div>
          <span class="order-number">
            #${escapeHTML(String(request.id).slice(0, 8))}
          </span>

          <span class="order-date">
            ${formatDate(request.created_at)}
          </span>
        </div>

        <span class="status-badge ${getStatusClass(request.status)}">
          ${escapeHTML(getStatusLabel(request.status))}
        </span>

      </div>

      <div class="admin-order-body">

        <div class="order-meta">
          <span>Minecraft username</span>
          <strong>
            ${escapeHTML(request.minecraft_name || "Not provided")}
          </strong>
        </div>

        <div class="order-meta">
          <span>Desired budget</span>
          <strong>
            ${request.desired_price
              ? money(request.desired_price)
              : "Not specified"}
          </strong>
        </div>

        <div class="order-description">
          <strong>Description</strong>
          <p>${escapeHTML(request.description || "")}</p>
        </div>

        ${Array.isArray(request.links) && request.links.length ? `
          <div class="order-links">
            <strong>Reference links</strong>

            ${request.links.map(link => {
              const safeUrl = safeExternalUrl(link);

              return safeUrl ? `
                <a
                  href="${escapeHTML(safeUrl)}"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open reference
                </a>
              ` : "";
            }).join("")}
          </div>
        ` : ""}

        ${Array.isArray(request.image_urls) && request.image_urls.length ? `
          <div class="order-images">
            <strong>Reference images</strong>

            <div class="order-image-grid">
              ${request.image_urls.map(url => {
                const safeUrl = safeExternalUrl(url);

                return safeUrl ? `
                  <a
                    href="${escapeHTML(safeUrl)}"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <img
                      src="${escapeHTML(safeUrl)}"
                      alt="Reference image"
                      loading="lazy"
                    >
                  </a>
                ` : "";
              }).join("")}
            </div>
          </div>
        ` : ""}

      </div>

      <div class="admin-order-footer">

        <select
          data-request-status="${escapeHTML(request.id)}"
        >
          ${orderStatuses.map(status => `
            <option
              value="${status}"
              ${request.status === status ? "selected" : ""}
            >
              ${getStatusLabel(status)}
            </option>
          `).join("")}
        </select>

        <button
          class="secondary-button"
          data-request-update="${escapeHTML(request.id)}"
          type="button"
        >
          Save status
        </button>

      </div>

    </article>
  `).join("");

  container.querySelectorAll("[data-request-update]").forEach(button => {
    button.addEventListener("click", async () => {
      const id = button.dataset.requestUpdate;

      const select = container.querySelector(
        `[data-request-status="${CSS.escape(id)}"]`
      );

      if (select) {
        await updateOrderStatus(id, select.value);
        await loadRequests();
      }
    });
  });
}

/* =========================================
   ADMIN PRODUCT CATALOG
========================================= */

async function loadCatalogProducts() {
  if (!isAdmin) return;

  const container = $("admin-products");

  if (container) {
    container.innerHTML = `
      <div class="loading-state">
        Loading products...
      </div>
    `;
  }

  const { data, error } = await supabaseClient
    .from("products")
    .select("*")
    .order("name");

  if (error) {
    console.error("Catalog loading error:", error);

    if (container) {
      container.innerHTML = `
        <p class="error-message">
          Could not load catalog:
          ${escapeHTML(error.message)}
        </p>
      `;
    }

    return;
  }

  catalogCache = data || [];

  renderCatalogProducts(catalogCache);
}

/* =========================================
   RENDER ADMIN CATALOG
========================================= */

function renderCatalogProducts(list = catalogCache) {
  const container = $("admin-products");

  if (!container) return;

  if (!list.length) {
    container.innerHTML = `
      <div class="empty-state">
        <p>No products in catalog.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="catalog-toolbar">
      <input
        id="catalog-search"
        type="search"
        placeholder="Search products..."
      >

      <button
        class="primary-button"
        id="create-product-button"
        type="button"
      >
        + Add product
      </button>
    </div>

    <div class="catalog-table-wrapper">
      <table class="catalog-table">

        <thead>
          <tr>
            <th>Product</th>
            <th>Category</th>
            <th>Price</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>

        <tbody>
          ${list.map(product => `
            <tr>

              <td>
                <div class="catalog-product-name">
                  ${escapeHTML(product.name)}
                </div>
              </td>

              <td>${escapeHTML(product.category)}</td>

              <td>${money(product.price)}</td>

              <td>
                <span class="status-badge ${
                  product.is_active ? "completed" : "cancelled"
                }">
                  ${product.is_active ? "Active" : "Inactive"}
                </span>
              </td>

              <td>
                <div class="catalog-actions">

                  <button
                    class="secondary-button"
                    data-catalog-edit="${escapeHTML(product.id)}"
                    type="button"
                  >
                    Edit
                  </button>

                  <button
                    class="danger-button"
                    data-catalog-delete="${escapeHTML(product.id)}"
                    type="button"
                  >
                    Delete
                  </button>

                </div>
              </td>

            </tr>
          `).join("")}
        </tbody>

      </table>
    </div>
  `;

  $("catalog-search").addEventListener("input", event => {
    const query = event.target.value.toLowerCase();

    const filtered = catalogCache.filter(product =>
      String(product.name || "").toLowerCase().includes(query) ||
      String(product.category || "").toLowerCase().includes(query)
    );

    renderCatalogProducts(filtered);

    const searchInput = $("catalog-search");

    if (searchInput) {
      searchInput.value = query;
    }
  });

  $("create-product-button").addEventListener("click", () => {
    openCreateProductEditor();
  });

  container.querySelectorAll("[data-catalog-edit]").forEach(button => {
    button.addEventListener("click", () => {
      const product = catalogCache.find(item =>
        String(item.id) === String(button.dataset.catalogEdit)
      );

      if (product) {
        openProductEditor(product);
      }
    });
  });

  container.querySelectorAll("[data-catalog-delete]").forEach(button => {
    button.addEventListener("click", async () => {
      await deleteProduct(button.dataset.catalogDelete);
    });
  });
}
/* =========================================
   CREATE PRODUCT EDITOR
========================================= */

function openCreateProductEditor() {
  if (!isAdmin) return;

  const existingModal = $("product-create-modal");

  if (existingModal) {
    existingModal.remove();
  }

  const modal = document.createElement("div");

  modal.id = "product-create-modal";
  modal.className = "modal-overlay";

  modal.innerHTML = `
    <div class="modal-content">

      <div class="modal-header">
        <h2>Create product</h2>

        <button
          type="button"
          class="modal-close"
          id="close-create-product"
        >
          ×
        </button>
      </div>

      <form id="create-product-form">

        <label>
          Product name

          <input
            type="text"
            id="new-product-name"
            required
            maxlength="100"
            placeholder="e.g. Diamond"
          >
        </label>

        <label>
          Category

          <select id="new-product-category" required>
            <option value="Blocks">Blocks</option>
            <option value="Items">Items</option>
            <option value="Redstone">Redstone</option>
            <option value="Armor & Weapons">Armor & Weapons</option>
            <option value="Enchantments">Enchantments</option>
            <option value="Services">Services</option>
          </select>
        </label>

        <label>
          Price (KB$)

          <input
            type="number"
            id="new-product-price"
            min="0"
            step="0.01"
            required
            placeholder="10"
          >
        </label>

        <label>
          Stack size

          <input
            type="number"
            id="new-product-stack"
            min="1"
            max="999999"
            value="64"
            required
          >
        </label>

        <label>
          Discount (%)

          <input
            type="number"
            id="new-product-discount"
            min="0"
            max="99"
            step="0.1"
            value="0"
          >
        </label>

        <label class="checkbox-label">
          <input
            type="checkbox"
            id="new-product-active"
            checked
          >

          Product is active
        </label>

        <div class="modal-actions">

          <button
            type="button"
            class="secondary-button"
            id="cancel-create-product"
          >
            Cancel
          </button>

          <button
            type="submit"
            class="primary-button"
          >
            Create product
          </button>

        </div>

      </form>

    </div>
  `;

  document.body.appendChild(modal);

  $("close-create-product").addEventListener("click", () => {
    modal.remove();
  });

  $("cancel-create-product").addEventListener("click", () => {
    modal.remove();
  });

  $("create-product-form").addEventListener("submit", createProduct);
}

/* =========================================
   CREATE PRODUCT
========================================= */

async function createProduct(event) {
  event.preventDefault();

  if (!isAdmin) return;

  const name = $("new-product-name").value.trim();
  const categoryValue = $("new-product-category").value;
  const price = Number($("new-product-price").value);
  const stackSize = Number($("new-product-stack").value);
  const discount = Number($("new-product-discount").value);
  const active = $("new-product-active").checked;

  if (!name) {
    showToast("Please enter a product name.", "error");
    return;
  }

  if (!Number.isFinite(price) || price < 0) {
    showToast("Please enter a valid price.", "error");
    return;
  }

  if (
    !Number.isInteger(stackSize) ||
    stackSize < 1 ||
    stackSize > 999999
  ) {
    showToast("Please enter a valid stack size.", "error");
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

  const button = event.submitter;

  if (button) {
    button.disabled = true;
    button.textContent = "Creating...";
  }

  const { data, error } = await supabaseClient
    .from("products")
    .insert({
      name,
      category: categoryValue,
      price,
      stack_size: stackSize,
      discount_percent: discount,
      is_active: active
    })
    .select()
    .single();

  if (error) {
    console.error("Product creation error:", error);

    showToast(
      `Could not create product: ${error.message}`,
      "error"
    );

    if (button) {
      button.disabled = false;
      button.textContent = "Create product";
    }

    return;
  }

  $("product-create-modal")?.remove();

  showToast("Product created successfully.");

  await Promise.all([
    loadProducts(),
    loadCatalogProducts()
  ]);
}

/* =========================================
   PRODUCT IMPORT
========================================= */

function openProductImport() {
  if (!isAdmin) return;

  const existingModal = $("product-import-modal");

  if (existingModal) {
    existingModal.remove();
  }

  const modal = document.createElement("div");

  modal.id = "product-import-modal";
  modal.className = "modal-overlay";

  modal.innerHTML = `
    <div class="modal-content import-modal">

      <div class="modal-header">
        <h2>Import products</h2>

        <button
          type="button"
          class="modal-close"
          id="close-product-import"
        >
          ×
        </button>
      </div>

      <p>
        Import multiple products using a JSON file.
      </p>

      <p class="muted">
        Required fields: name, category and price.
        Optional fields: stack_size, discount_percent and is_active.
      </p>

      <textarea
        id="product-import-json"
        rows="12"
        placeholder='[
  {
    "name": "Diamond",
    "category": "Items",
    "price": 30,
    "stack_size": 64,
    "discount_percent": 0,
    "is_active": true
  }
]'
      ></textarea>

      <div class="modal-actions">

        <button
          type="button"
          class="secondary-button"
          id="cancel-product-import"
        >
          Cancel
        </button>

        <button
          type="button"
          class="primary-button"
          id="confirm-product-import"
        >
          Import products
        </button>

      </div>

    </div>
  `;

  document.body.appendChild(modal);

  $("close-product-import").addEventListener("click", () => {
    modal.remove();
  });

  $("cancel-product-import").addEventListener("click", () => {
    modal.remove();
  });

  $("confirm-product-import").addEventListener("click", importProducts);
}

/* =========================================
   IMPORT PRODUCTS
========================================= */

async function importProducts() {
  if (!isAdmin) return;

  const input = $("product-import-json");
  const button = $("confirm-product-import");

  let importedProducts;

  try {
    importedProducts = JSON.parse(input.value);
  } catch (error) {
    showToast("Invalid JSON format.", "error");
    return;
  }

  if (
    !Array.isArray(importedProducts) ||
    importedProducts.length === 0
  ) {
    showToast("Please provide a non-empty product list.", "error");
    return;
  }

  const validCategories = [
    "Blocks",
    "Items",
    "Redstone",
    "Armor & Weapons",
    "Enchantments",
    "Services"
  ];

  const cleanedProducts = [];

  for (const product of importedProducts) {
    const name = String(product.name || "").trim();
    const categoryValue = String(product.category || "").trim();
    const price = Number(product.price);

    if (!name || !validCategories.includes(categoryValue)) {
      showToast(
        "Every product needs a valid name and category.",
        "error"
      );
      return;
    }

    if (!Number.isFinite(price) || price < 0) {
      showToast(
        `Invalid price for product: ${name}`,
        "error"
      );
      return;
    }

    const stackSize = Number(product.stack_size ?? 64);
    const discount = Number(product.discount_percent ?? 0);

    if (
      !Number.isInteger(stackSize) ||
      stackSize < 1 ||
      stackSize > 999999
    ) {
      showToast(
        `Invalid stack size for product: ${name}`,
        "error"
      );
      return;
    }

    if (
      !Number.isFinite(discount) ||
      discount < 0 ||
      discount > 99
    ) {
      showToast(
        `Invalid discount for product: ${name}`,
        "error"
      );
      return;
    }

    cleanedProducts.push({
      name,
      category: categoryValue,
      price,
      stack_size: stackSize,
      discount_percent: discount,
      is_active: product.is_active !== false
    });
  }

  button.disabled = true;
  button.textContent = "Importing...";

  const { error } = await supabaseClient
    .from("products")
    .insert(cleanedProducts);

  if (error) {
    console.error("Product import error:", error);

    showToast(
      `Import failed: ${error.message}`,
      "error"
    );

    button.disabled = false;
    button.textContent = "Import products";

    return;
  }

  $("product-import-modal")?.remove();

  showToast(
    `${cleanedProducts.length} products imported successfully.`
  );

  await Promise.all([
    loadProducts(),
    loadCatalogProducts()
  ]);
}

/* =========================================
   ADMIN IMPORT BUTTON
========================================= */

if ($("import-products-button")) {
  $("import-products-button").addEventListener(
    "click",
    openProductImport
  );
}

/* =========================================
   REFRESH BUTTONS
========================================= */

if ($("refresh-orders")) {
  $("refresh-orders").addEventListener("click", loadOrders);
}

if ($("refresh-requests")) {
  $("refresh-requests").addEventListener("click", loadRequests);
}

if ($("refresh-products")) {
  $("refresh-products").addEventListener(
    "click",
    loadCatalogProducts
  );
}

/* =========================================
   MAIN NAVIGATION
========================================= */

function showMainSection(sectionName) {
  const sections = {
    offers: $("offers"),
    shop: $("shop"),
    account: $("account-section"),
    admin: $("admin-section")
  };

  Object.entries(sections).forEach(([name, element]) => {
    if (!element) return;

    element.style.display =
      name === sectionName ? "" : "none";
  });

  if (sectionName === "offers") {
    renderOffers();
  }

  if (sectionName === "shop") {
    loadProducts();
  }

  if (sectionName === "account") {
    updateAccountUI();
  }

  if (sectionName === "admin") {
    openAdmin();
  }

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
}

document.querySelectorAll("[data-main-section]").forEach(button => {
  button.addEventListener("click", () => {
    showMainSection(button.dataset.mainSection);
  });
});

/* =========================================
   APPLICATION INITIALIZATION
========================================= */

async function initializeApp() {
  console.log("Brat Ltd. shop initializing...");

  try {
    await loadSession();

    await loadProducts();

    renderOffers();

    updateAccountUI();

    console.log("Brat Ltd. shop initialized.");
  } catch (error) {
    console.error("Application initialization error:", error);

    showToast(
      "The shop could not be fully initialized. Please reload the page.",
      "error"
    );
  }
}

/* =========================================
   START APPLICATION
========================================= */

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    initializeApp
  );
} else {
  initializeApp();
}
