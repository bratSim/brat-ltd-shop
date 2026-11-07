
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
let adminDashboardOpen = false;
let currentRequestFilter = "all";

const $ = id => document.getElementById(id);

const categoryIcons = {
  "Blocks": "▦",
  "Items": "✦",
  "Armor & Weapons": "⚔",
  "Enchantments": "✧",
  "Services": "⌂"
};

const textureAliases = {
  "oak log": "oak_log",
  "oak wood": "oak_log",
  "oak planks": "oak_planks",
  "spruce log": "spruce_log",
  "spruce planks": "spruce_planks",
  "birch log": "birch_log",
  "birch planks": "birch_planks",
  "grass block": "grass_block",
  "gold ingot": "gold_ingot",
  "iron ingot": "iron_ingot",
  "netherite ingot": "netherite_ingot",
  "lapis lazuli": "lapis_lazuli",
  "golden apple": "golden_apple",
  "enchanted golden apple": "enchanted_golden_apple",
  "ender pearl": "ender_pearl",
  "blaze rod": "blaze_rod",
  "diamond sword": "diamond_sword",
  "netherite sword": "netherite_sword",
  "diamond pickaxe": "diamond_pickaxe",
  "netherite pickaxe": "netherite_pickaxe",
  "diamond helmet": "diamond_helmet",
  "diamond chestplate": "diamond_chestplate",
  "diamond leggings": "diamond_leggings",
  "diamond boots": "diamond_boots",
  "netherite helmet": "netherite_helmet",
  "netherite chestplate": "netherite_chestplate",
  "netherite leggings": "netherite_leggings",
  "netherite boots": "netherite_boots",
  "enchanted book": "enchanted_book",
  "shulker box": "shulker_box"
};

// ==================================
// GENERAL HELPERS
// ==================================

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[c]));
}

function money(n) {
  return `${Number(n || 0).toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 3
  })} KB$`;
}

function roundMoney(n) {
  return Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;
}

function checkoutMoney(n) {
  return `${Math.ceil(roundMoney(n)).toLocaleString("en-US")} KB$`;
}

function getDiscountPercent(quantity) {
  if (quantity >= 16) return 15;
  if (quantity >= 10) return 10;
  if (quantity >= 6) return 5;
  return 0;
}

// The manual product discount is applied first.
// The quantity discount is then applied to the reduced price.
function unitPrice(product, quantity) {
  const manual = Number(product.discountPercent || 0);
  const quantityDiscount = getDiscountPercent(quantity);

  const afterManual =
    Number(product.price) * (1 - manual / 100);

  return roundMoney(
    afterManual * (1 - quantityDiscount / 100)
  );
}

function effectiveDiscount(product, quantity) {
  const manual = Number(product.discountPercent || 0);
  const quantityDiscount = getDiscountPercent(quantity);

  return roundMoney(
    100 * (1 - (1 - manual / 100) * (1 - quantityDiscount / 100))
  );
}

function stackText(product) {
  return `${product.stackSize} items per stack`;
}

function setText(id, value) {
  const element = $(id);
  if (element) element.textContent = value;
}

// ==================================
// MINECRAFT TEXTURES
// ==================================

function itemTextureId(name) {
  const key = String(name || "").trim().toLowerCase();

  return textureAliases[key] ||
    key.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function textureUrl(name, type) {
  return `https://assets.mcasset.cloud/1.21.4/assets/minecraft/textures/${type}/${encodeURIComponent(itemTextureId(name))}.png`;
}

function imageMarkup(name, cat, cls = "") {
  const fallback = categoryIcons[cat] || "✦";

  return `
    <img
      class="${cls}"
      src="${textureUrl(name, "item")}"
      data-block-texture="${escapeHTML(textureUrl(name, "block"))}"
      alt="${escapeHTML(name)}"
      loading="lazy"
      onerror="
        if (!this.dataset.triedBlock) {
          this.dataset.triedBlock = 'true';
          this.src = this.dataset.blockTexture;
        } else {
          this.replaceWith(
            Object.assign(document.createElement('span'), {
              className: 'fallback-icon',
              textContent: '${fallback}'
            })
          );
        }
      "
    >
  `;
}

// ==================================
// LOAD PRODUCTS
// ==================================

async function loadProducts() {
  $("products").innerHTML =
    '<p class="muted">Loading products...</p>';

  $("offers-grid").innerHTML =
    '<div class="loading-card">Loading featured offers...</div>';

  const { data, error } = await supabaseClient
    .from("products")
    .select(`
      id,
      name,
      description,
      category,
      price,
      stack_size,
      discount_percent,
      is_active
    `)
    .eq("is_active", true)
    .order("name");

  if (error) {
    console.error("Product loading failed:", error);

    $("products").innerHTML =
      '<p class="muted">Could not load products.</p>';

    $("offers-grid").innerHTML =
      '<div class="loading-card">Offers are temporarily unavailable.</div>';

    return;
  }

  products = (data || []).map(p => ({
    id: p.id,
    name: p.name,
    category: p.category,
    desc: p.description || "",
    price: Number(p.price),
    discountPercent: Number(p.discount_percent || 0),
    stackSize: Number(p.stack_size || 64)
  }));

  renderOffers();
  renderProducts();
  renderCart();

  if (adminDashboardOpen) {
    renderAdminProducts();
  }
}

// ==================================
// HOMEPAGE: MANUAL OFFERS ONLY
// ==================================

function renderOffers() {
  const q = $("search").value.toLowerCase().trim();

  const selected = products
    .filter(p => Number(p.discountPercent) > 0)
    .filter(p =>
      (p.name + " " + p.category + " " + p.desc)
        .toLowerCase()
        .includes(q)
    );

  $("offers-grid").innerHTML = selected.length
    ? selected.map(p => {
        const salePrice = roundMoney(
          p.price * (1 - p.discountPercent / 100)
        );

        return `
          <article class="offer-card">
            <div class="offer-image">
              ${imageMarkup(p.name, p.category)}
            </div>

            <div class="offer-copy">
              <div class="offer-kicker">SPECIAL OFFER</div>
              <h3>${escapeHTML(p.name)}</h3>

              <div class="offer-old-price">
                ${money(p.price)}
              </div>

              <div class="offer-price">
                ${money(salePrice)} <small>/ stack</small>
              </div>

              <small>${stackText(p)}</small>
            </div>

            <span class="offer-badge">−${p.discountPercent}%</span>
          </article>
        `;
      }).join("")
    : '<div class="loading-card">There are currently no special offers.</div>';
}

// ==================================
// CATEGORY DISPLAY
// ==================================

function renderProducts() {
  if (adminDashboardOpen) return;

  const isHome = category === "All";

  $("offers").style.display = isHome ? "" : "none";
  $("shop").style.display = !isHome ? "" : "none";
  $("admin-section").style.display = "none";

  if (isHome) {
    $("products").innerHTML = "";
    $("result-count").textContent = "";
    return;
  }

  const q = $("search").value.toLowerCase().trim();

  const shown = products.filter(p =>
    p.category === category &&
    (p.name + " " + p.category + " " + p.desc)
      .toLowerCase()
      .includes(q)
  );

  $("result-count").textContent = `${shown.length} products`;

  let html = shown.map(p => {
    const salePrice = roundMoney(
      p.price * (1 - p.discountPercent / 100)
    );

    return `
      <article class="product-card">
        <div class="product-visual">
          <span class="product-tag">${escapeHTML(p.category)}</span>

          ${p.discountPercent > 0 ? `
            <span class="product-sale-badge">−${p.discountPercent}%</span>
          ` : ""}

          ${imageMarkup(p.name, p.category)}
        </div>

        <div class="product-info">
          <h3>${escapeHTML(p.name)}</h3>
          <p>${escapeHTML(p.desc)}</p>

          <div class="price-row">
            <div class="price-block">
              ${p.discountPercent > 0 ? `
                <div class="old-price">${money(p.price)}</div>
                <div class="price">${money(salePrice)} <small>/ stack</small></div>
              ` : `
                <div class="price">${money(p.price)} <small>/ stack</small></div>
              `}
            </div>

            <button
              class="add-button"
              data-add="${escapeHTML(p.id)}"
              aria-label="Add one stack of ${escapeHTML(p.name)} to cart"
              type="button"
            >+</button>
          </div>

          <small class="stack-info">${stackText(p)}</small>

          ${p.discountPercent > 0 ? `
            <div class="discount-note">
              Special offer: ${p.discountPercent}% off
            </div>
          ` : `
            <div class="discount-note">
              Quantity discounts: up to 15%
            </div>
          `}

          ${isAdmin ? `
            <details class="product-admin-menu">
              <summary aria-label="Product settings">•••</summary>

              <div class="product-admin-panel">
                <strong>Manage product</strong>

                <label>
                  Regular price (KB$)
                  <input
                    type="number"
                    min="0.001"
                    step="0.001"
                    value="${p.price}"
                    data-edit-price="${escapeHTML(p.id)}"
                  >
                </label>

                <label>
                  Special discount (%)
                  <input
                    type="number"
                    min="0"
                    max="90"
                    step="1"
                    value="${p.discountPercent}"
                    data-edit-discount="${escapeHTML(p.id)}"
                  >
                </label>

                <button
                  type="button"
                  class="product-save-button"
                  data-save-product="${escapeHTML(p.id)}"
                >Save changes</button>

                <button
                  type="button"
                  class="product-reset-button"
                  data-reset-discount="${escapeHTML(p.id)}"
                >Remove discount</button>

                <p class="product-edit-status" id="edit-status-${escapeHTML(p.id)}"></p>
              </div>
            </details>
          ` : ""}
        </div>
      </article>
    `;
  }).join("");

  if (category === "Services") {
    html += serviceFormMarkup();
  }

  if (!html && category !== "Services") {
    html = '<p class="muted">No products available in this category yet.</p>';
  }

  $("products").innerHTML = html;

  document.querySelectorAll("[data-add]").forEach(button => {
    button.addEventListener("click", () =>
      addToCart(button.dataset.add)
    );
  });

  document.querySelectorAll("[data-save-product]").forEach(button => {
    button.addEventListener("click", () =>
      saveProductChanges(button.dataset.saveProduct)
    );
  });

  document.querySelectorAll("[data-reset-discount]").forEach(button => {
    button.addEventListener("click", () =>
      resetProductDiscount(button.dataset.resetDiscount)
    );
  });

  const form = $("service-form");

  if (form) {
    form.addEventListener("submit", handleServiceSubmit);
  }
}

// ==================================
// ADMIN: SAVE PRODUCT PRICE + DISCOUNT
// ==================================

async function saveProductChanges(productId) {
  if (!isAdmin) return;

  const priceInput = document.querySelector(
    `[data-edit-price="${CSS.escape(String(productId))}"]`
  );

  const discountInput = document.querySelector(
    `[data-edit-discount="${CSS.escape(String(productId))}"]`
  );

  const status = $(`edit-status-${productId}`);
  const button = document.querySelector(
    `[data-save-product="${CSS.escape(String(productId))}"]`
  );

  const price = Number(priceInput?.value);
  const discount = Number(discountInput?.value);

  if (!Number.isFinite(price) || price <= 0) {
    if (status) status.textContent = "Enter a valid price.";
    return;
  }

  if (!Number.isFinite(discount) || discount < 0 || discount > 90) {
    if (status) status.textContent = "Discount must be between 0 and 90%.";
    return;
  }

  if (button) {
    button.disabled = true;
    button.textContent = "Saving...";
  }

  const { error } = await supabaseClient
    .from("products")
    .update({
      price: roundMoney(price),
      discount_percent: discount
    })
    .eq("id", productId);

  if (error) {
    console.error("Product update failed:", error);
    if (status) status.textContent = `Error: ${error.message}`;

    if (button) {
      button.disabled = false;
      button.textContent = "Save changes";
    }
    return;
  }

  await loadProducts();

  if (status) status.textContent = "Saved successfully.";
  setText("admin-status", "Product updated successfully.");
}

async function resetProductDiscount(productId) {
  if (!isAdmin) return;

  const { error } = await supabaseClient
    .from("products")
    .update({ discount_percent: 0 })
    .eq("id", productId);

  if (error) {
    console.error("Discount reset failed:", error);
    setText("admin-status", `Could not remove discount: ${error.message}`);
    return;
  }

  await loadProducts();
  setText("admin-status", "Product discount removed.");
}

// ==================================
// ADMIN: PRODUCT OVERVIEW
// ==================================

function ensureAdminProductArea() {
  if ($("admin-products-area")) return;

  const section = $("admin-section");
  const toolbar = section.querySelector(".admin-toolbar");

  if (!section || !toolbar) return;

  const area = document.createElement("div");
  area.id = "admin-products-area";
  area.className = "admin-products-area";

  area.innerHTML = `
    <div class="admin-toolbar">
      <div>
        <h2>Product management</h2>
        <p class="muted small">
          Change prices and manage special offers.
        </p>
      </div>
    </div>

    <div id="admin-product-list" class="admin-product-list"></div>
  `;

  toolbar.insertAdjacentElement("beforebegin", area);
}

function renderAdminProducts() {
  if (!isAdmin) return;

  ensureAdminProductArea();

  const container = $("admin-product-list");
  if (!container) return;

  container.innerHTML = products.length
    ? products.map(p => `
        <article class="admin-product-row">
          <div class="admin-product-image">
            ${imageMarkup(p.name, p.category)}
          </div>

          <div class="admin-product-info">
            <strong>${escapeHTML(p.name)}</strong>
            <small>${escapeHTML(p.category)}</small>
          </div>

          <div class="admin-product-price">
            <strong>${money(p.price)}</strong>
            <small>Regular price</small>
          </div>

          <div class="admin-product-discount">
            <strong>${p.discountPercent}%</strong>
            <small>Special discount</small>
          </div>

          <button
            class="admin-edit-button"
            type="button"
            data-admin-edit="${escapeHTML(p.id)}"
          >Edit product</button>
        </article>
      `).join("")
    : '<p class="muted">No products found.</p>';

  container.querySelectorAll("[data-admin-edit]").forEach(button => {
    button.addEventListener("click", () => {
      const product = products.find(
        p => String(p.id) === String(button.dataset.adminEdit)
      );

      if (!product) return;

      showShopCategory(product.category);

      setTimeout(() => {
        const card = document.querySelector(
          `[data-save-product="${CSS.escape(String(product.id))}"]`
        );

        const details = card?.closest(".product-admin-menu");

        if (details) {
          details.open = true;
          details.scrollIntoView({
            behavior: "smooth",
            block: "center"
          });
        }
      }, 100);
    });
  });
}

// ==================================
// SERVICE REQUEST FORM
// ==================================

function serviceFormMarkup() {
  return `
    <section class="service-request-card">
      <div class="service-request-header">
        <div class="eyebrow orange">MADE FOR YOUR PROJECT</div>
        <h3>Request a <em>custom service.</em></h3>
        <p>
          Need something special? Describe your idea and
          make your own price proposal.
        </p>
      </div>

      <form id="service-form">
        <label class="service-label">
          Service title
          <input id="service-title" type="text" maxlength="80"
            placeholder="e.g. Custom medieval castle" required>
        </label>

        <label class="service-label">
          Description
          <textarea id="service-description" rows="5" maxlength="3000"
            placeholder="Describe exactly what you need..." required></textarea>
        </label>

        <label class="service-label">
          Reference link <span>(optional)</span>
          <input id="service-link" type="url" maxlength="500"
            placeholder="https://...">
        </label>

        <label class="service-label">
          Images <span>(optional, max. 5 images, 5 MB each)</span>
          <input id="service-images" type="file"
            accept="image/png,image/jpeg,image/webp,image/gif" multiple>
        </label>

        <div id="service-image-preview" class="service-image-preview"></div>

        <label class="service-label">
          Your proposed price (KB$)
          <input id="service-price" type="number" min="0.001"
            max="100000000" step="0.001" placeholder="e.g. 150" required>
        </label>

        <p class="service-disclaimer">
          Your proposed price will be reviewed by Brat Ltd.
          before the service is accepted.
        </p>

        <button type="submit" class="checkout">
          Add service request to cart <span>→</span>
        </button>

        <p id="service-status" class="small muted"></p>
      </form>
    </section>
  `;
}

// ==================================
// SERVICE IMAGE PREVIEW
// ==================================

document.addEventListener("change", event => {
  if (event.target.id !== "service-images") return;

  const preview = $("service-image-preview");
  const files = Array.from(event.target.files || []);

  if (!preview) return;

  preview.innerHTML = "";

  if (files.length > 5) {
    setText("service-status", "Please select a maximum of 5 images.");
    event.target.value = "";
    return;
  }

  files.forEach(file => {
    if (!file.type.startsWith("image/")) return;

    const img = document.createElement("img");
    img.alt = file.name;
    img.src = URL.createObjectURL(file);
    preview.appendChild(img);
  });
});

// ==================================
// UPLOAD SERVICE IMAGES
// ==================================

async function uploadServiceImages(files) {
  const urls = [];

  for (const file of files) {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const filePath =
      `${Date.now()}-${crypto.randomUUID()}-${safeName}`;

    const { error } = await supabaseClient.storage
      .from("service-attachments")
      .upload(filePath, file, {
        upsert: false,
        contentType: file.type
      });

    if (error) {
      throw new Error(`Could not upload ${file.name}: ${error.message}`);
    }

    const { data } = supabaseClient.storage
      .from("service-attachments")
      .getPublicUrl(filePath);

    urls.push(data.publicUrl);
  }

  return urls;
}

// ==================================
// ADD SERVICE TO CART
// ==================================

async function handleServiceSubmit(event) {
  event.preventDefault();

  const status = $("service-status");
  const title = $("service-title").value.trim();
  const description = $("service-description").value.trim();
  const link = $("service-link").value.trim();
  const price = Number($("service-price").value);
  const files = Array.from($("service-images").files || []);

  if (!title || !description) {
    status.textContent = "Please complete the title and description.";
    return;
  }

  if (!Number.isFinite(price) || price <= 0) {
    status.textContent = "Please enter a valid price.";
    return;
  }

  if (files.length > 5) {
    status.textContent = "You can upload a maximum of 5 images.";
    return;
  }

  const allowedTypes = [
    "image/png", "image/jpeg", "image/webp", "image/gif"
  ];

  for (const file of files) {
    if (!allowedTypes.includes(file.type)) {
      status.textContent = "Only PNG, JPG, WEBP and GIF images are allowed.";
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      status.textContent = `The image "${file.name}" is larger than 5 MB.`;
      return;
    }
  }

  if (link) {
    try {
      const parsedLink = new URL(link);
      if (!["http:", "https:"].includes(parsedLink.protocol)) {
        throw new Error("Invalid link");
      }
    } catch {
      status.textContent = "Please enter a valid link.";
      return;
    }
  }

  const button = event.submitter;
  button.disabled = true;
  button.textContent = "Uploading images...";
  status.textContent = "Please wait while your images are uploaded.";

  try {
    const imageUrls = await uploadServiceImages(files);

    const serviceId =
      `service_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    cart[serviceId] = {
      type: "service",
      title,
      description,
      link,
      imageUrls,
      price: roundMoney(price)
    };

    saveCart();
    renderCart();
    openCart();

    status.textContent = "Service request added to your cart.";
    $("service-form").reset();
    $("service-image-preview").innerHTML = "";

  } catch (error) {
    console.error(error);
    status.textContent =
      error.message || "Something went wrong. Please try again.";

  } finally {
    button.disabled = false;
    button.innerHTML = 'Add service request to cart <span>→</span>';
  }
}

// ==================================
// CART HELPERS
// ==================================

function saveCart() {
  localStorage.setItem("bratCart", JSON.stringify(cart));
}

function getCartEntries() {
  return Object.entries(cart).filter(([id, item]) => {
    if (item && typeof item === "object" && item.type === "service") {
      return Number(item.price) > 0;
    }

    return products.some(p => String(p.id) === String(id)) &&
      Number(item) > 0;
  }).map(([id, item]) => {
    if (item && typeof item === "object" && item.type === "service") {
      return {
        id,
        type: "service",
        service: {
          ...item,
          imageUrls: Array.isArray(item.imageUrls) ? item.imageUrls : []
        },
        quantity: 1
      };
    }

    return {
      id,
      type: "product",
      product: products.find(p => String(p.id) === String(id)),
      quantity: Number(item)
    };
  });
}

function addToCart(id) {
  cart[id] = (Number(cart[id]) || 0) + 1;
  saveCart();
  renderCart();
  openCart();
}

function changeQty(id, delta) {
  cart[id] = (Number(cart[id]) || 0) + delta;

  if (cart[id] <= 0) delete cart[id];

  saveCart();
  renderCart();
}

function removeService(id) {
  delete cart[id];
  saveCart();
  renderCart();
}

function getCartTotals() {
  const entries = getCartEntries();

  let total = 0;
  let originalTotal = 0;
  let manualSavings = 0;
  let quantitySavings = 0;

  entries.forEach(entry => {
    if (entry.type === "service") {
      total += Number(entry.service.price);
      originalTotal += Number(entry.service.price);
      return;
    }

    const p = entry.product;
    const quantity = entry.quantity;

    const original = Number(p.price) * quantity;
    const afterManual =
      Number(p.price) * (1 - Number(p.discountPercent || 0) / 100) * quantity;

    const final = unitPrice(p, quantity) * quantity;

    originalTotal += original;
    manualSavings += original - afterManual;
    quantitySavings += afterManual - final;
    total += final;
  });

  total = roundMoney(total);
  originalTotal = roundMoney(originalTotal);
  manualSavings = roundMoney(manualSavings);
  quantitySavings = roundMoney(quantitySavings);

  return {
    entries,
    total,
    originalTotal,
    manualSavings,
    quantitySavings,
    savings: roundMoney(originalTotal - total),
    checkoutTotal: Math.ceil(total)
  };
}

// ==================================
// RENDER CART
// ==================================

function renderCart() {
  const entries = getCartEntries();
  let totalStacks = 0;

  $("cart-items").innerHTML = entries.length
    ? entries.map(entry => {
        if (entry.type === "service") {
          const s = entry.service;

          return `
            <div class="cart-line service-cart-line">
              <div>
                <strong>${escapeHTML(s.title)}</strong>
                <small>CUSTOM SERVICE REQUEST</small>
                <small>${money(s.price)} · Proposed price</small>
                <small>${escapeHTML(s.description)}</small>
                ${s.link ? `<small>Reference: ${escapeHTML(s.link)}</small>` : ""}
                <small>${s.imageUrls.length} attached image(s)</small>
                <small class="cart-discount">Subject to approval by Brat Ltd.</small>
              </div>

              <div class="qty">
                <button data-remove-service="${escapeHTML(entry.id)}"
                  aria-label="Remove service" type="button">×</button>
              </div>
            </div>
          `;
        }

        const p = entry.product;
        const quantity = entry.quantity;
        const discount = effectiveDiscount(p, quantity);
        const price = unitPrice(p, quantity);

        const sum = roundMoney(price * quantity);
        const originalSum = roundMoney(Number(p.price) * quantity);
        const saved = roundMoney(originalSum - sum);

        totalStacks += quantity;

        return `
          <div class="cart-line">
            <div>
              <strong>${escapeHTML(p.name)}</strong>

              <small>
                ${money(price)} per stack · ${money(sum)} total
              </small>

              <small>
                ${quantity} stacks · ${quantity * p.stackSize} items
              </small>

              ${discount > 0 ? `
                <small class="cart-discount">
                  ${discount}% total discount · You save ${money(saved)}
                </small>
                <small>Regular price: ${money(originalSum)}</small>
                ${p.discountPercent > 0 ? `
                  <small>Includes ${p.discountPercent}% special offer</small>
                ` : ""}
                ${getDiscountPercent(quantity) > 0 ? `
                  <small>Plus ${getDiscountPercent(quantity)}% quantity discount</small>
                ` : ""}
              ` : `
                <small>No discount yet</small>
              `}
            </div>

            <div class="qty">
              <button data-change="${escapeHTML(entry.id)}"
                data-delta="-1" type="button">−</button>
              <b>${quantity}</b>
              <button data-change="${escapeHTML(entry.id)}"
                data-delta="1" type="button">+</button>
            </div>
          </div>
        `;
      }).join("")
    : '<p class="empty">Your cart is empty.</p>';

  const totals = getCartTotals();
  const serviceCount =
    totals.entries.filter(e => e.type === "service").length;

  $("cart-count").textContent = totalStacks + serviceCount;
  $("cart-total").textContent = money(totals.total);

  if ($("cart-savings")) {
    $("cart-savings").textContent = money(totals.savings);
  }

  document.querySelectorAll("[data-change]").forEach(button => {
    button.addEventListener("click", () =>
      changeQty(button.dataset.change, Number(button.dataset.delta))
    );
  });

  document.querySelectorAll("[data-remove-service]").forEach(button => {
    button.addEventListener("click", () =>
      removeService(button.dataset.removeService)
    );
  });
}

// ==================================
// CART PANEL
// ==================================

function openCart() {
  $("cart-panel").classList.add("open");
  $("overlay").classList.add("show");
}

function closeCart() {
  $("cart-panel").classList.remove("open");
  $("overlay").classList.remove("show");
}

// ==================================
// NAVIGATION
// ==================================

function showShopCategory(selectedCategory) {
  adminDashboardOpen = false;
  category = selectedCategory;

  $("admin-section").style.display = "none";

  document.querySelectorAll(".nav-link").forEach(element => {
    element.classList.toggle(
      "active",
      element.dataset.category === category
    );
  });

  renderProducts();

  const target = category === "All" ? $("offers") : $("shop");

  target.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

function showAdminDashboard() {
  if (!isAdmin) return;

  adminDashboardOpen = true;

  $("offers").style.display = "none";
  $("shop").style.display = "none";
  $("admin-section").style.display = "block";

  document.querySelectorAll(".nav-link").forEach(element => {
    element.classList.remove("active");
  });

  renderAdminProducts();

  $("admin-section").scrollIntoView({
    behavior: "smooth",
    block: "start"
  });

  loadRequests();
}

document.querySelectorAll("[data-category]").forEach(element => {
  element.addEventListener("click", event => {
    event.preventDefault();
    showShopCategory(element.dataset.category);
  });
});

// ==================================
// SEARCH
// ==================================

$("search").addEventListener("input", () => {
  if (adminDashboardOpen) return;

  if (category === "All") {
    renderOffers();
  } else {
    renderProducts();
  }
});

// ==================================
// BUTTONS
// ==================================

$("open-cart").addEventListener("click", openCart);
$("close-cart").addEventListener("click", closeCart);
$("overlay").addEventListener("click", closeCart);

$("checkout").addEventListener("click", showCheckoutTotal);

$("close-modal").addEventListener("click", () => {
  $("order-modal").classList.remove("show");
});

$("admin-login-open").addEventListener("click", () => {
  if (isAdmin) {
    showAdminDashboard();
  } else {
    $("admin-login-modal").classList.add("show");
  }
});

$("admin-login-close").addEventListener("click", () => {
  $("admin-login-modal").classList.remove("show");
});

$("admin-refresh").addEventListener("click", loadRequests);
$("admin-logout").addEventListener("click", logoutAdmin);

// ==================================
// CHECKOUT
// ==================================

function showCheckoutTotal() {
  const {
    entries,
    total,
    originalTotal,
    manualSavings,
    quantitySavings,
    savings,
    checkoutTotal
  } = getCartTotals();

  if (!entries.length) {
    $("order-status").textContent = "Add some products to your cart first.";
    return;
  }

  const preview = $("checkout-total-preview");

  const serviceCount =
    entries.filter(e => e.type === "service").length;

  preview.innerHTML = `
    <div class="checkout-summary">
      <div>Original total: <strong>${money(originalTotal)}</strong></div>
      <div>Special offers: <strong>−${money(manualSavings)}</strong></div>
      <div>Quantity discounts: <strong>−${money(quantitySavings)}</strong></div>
      <div>Total savings: <strong>−${money(savings)}</strong></div>
      <div>Discounted total: <strong>${money(total)}</strong></div>
      <div>Custom service requests: <strong>${serviceCount}</strong></div>
      <hr>
      <div>
        Final total (rounded up):
        <strong>${checkoutMoney(checkoutTotal)}</strong>
      </div>
    </div>
  `;

  $("order-status").textContent = "";
  $("order-status").style.color = "";
  $("order-modal").classList.add("show");
}

// ==================================
// SUBMIT ORDER TO SUPABASE
// ==================================

$("send-order").addEventListener("click", submitOrder);

async function submitOrder() {
  const button = $("send-order");
  const name = $("player-name").value.trim();
  const note = $("order-note").value.trim();

  if (!name || name.length > 32) {
    $("order-status").textContent =
      "Please enter a valid Minecraft username.";
    return;
  }

  const {
    entries,
    total,
    originalTotal,
    savings,
    checkoutTotal
  } = getCartTotals();

  if (!entries.length) {
    $("order-status").textContent = "Your cart is empty.";
    return;
  }

  const items = entries.map(entry => {
    if (entry.type === "service") {
      const s = entry.service;

      return {
        type: "service",
        title: s.title,
        description: s.description,
        proposed_price: s.price,
        link: s.link || null,
        image_urls: s.imageUrls || [],
        quantity: 1
      };
    }

    const p = entry.product;
    const quantity = entry.quantity;
    const quantityDiscount = getDiscountPercent(quantity);
    const totalDiscount = effectiveDiscount(p, quantity);
    const price = unitPrice(p, quantity);

    return {
      type: "product",
      product_id: p.id,
      name: p.name,
      category: p.category,
      quantity,
      stack_size: p.stackSize,
      original_price: p.price,
      manual_discount_percent: p.discountPercent,
      quantity_discount_percent: quantityDiscount,
      discount_percent: totalDiscount,
      discounted_price: price,
      line_total: roundMoney(price * quantity)
    };
  });

  const serviceEntries =
    entries.filter(entry => entry.type === "service");

  const productEntries =
    entries.filter(entry => entry.type === "product");

  const requestType =
    productEntries.length > 0 ? "product" : "service";

  const description = serviceEntries.map(entry =>
    `${entry.service.title}\n${entry.service.description}`
  ).join("\n\n");

  const links = serviceEntries
    .map(entry => entry.service.link)
    .filter(Boolean);

  const imageUrls = serviceEntries
    .flatMap(entry => entry.service.imageUrls || []);

  const desiredPrice = serviceEntries.length
    ? roundMoney(
        serviceEntries.reduce(
          (sum, entry) => sum + Number(entry.service.price),
          0
        )
      )
    : null;

  const payload = {
    user_id: currentSession?.user?.id || null,
    minecraft_name: name,
    note: note || null,
    status: "pending",
    request_type: requestType,
    items,
    description: description || null,
    links,
    image_urls: imageUrls,
    desired_price: desiredPrice,
    subtotal: originalTotal,
    discount_amount: savings,
    total: checkoutTotal
  };

  button.disabled = true;
  button.textContent = "Submitting order...";
  $("order-status").textContent = "Saving your order request...";
  $("order-status").style.color = "";

  try {
    const { error } = await supabaseClient
      .from("orders")
      .insert(payload);

    if (error) throw error;

    cart = {};
    saveCart();
    renderCart();

    $("order-status").textContent =
      "Your order has been submitted successfully!";
    $("order-status").style.color = "#65c98a";

    $("player-name").value = "";
    $("order-note").value = "";

    setTimeout(() => {
      $("order-modal").classList.remove("show");
      $("order-status").textContent = "";
      $("order-status").style.color = "";
    }, 2500);

  } catch (error) {
    console.error("Order submission failed:", error);

    $("order-status").textContent =
      `Could not submit order: ${error.message}`;
    $("order-status").style.color = "#e47766";

  } finally {
    button.disabled = false;
    button.innerHTML = 'Create order request <span>→</span>';
  }
}

// ==================================
// ADMIN LOGIN
// ==================================

$("admin-login-form").addEventListener("submit", async event => {
  event.preventDefault();

  const button = $("admin-login-submit");
  const email = $("admin-email").value.trim();
  const password = $("admin-password").value;

  button.disabled = true;
  button.textContent = "Signing in...";
  $("admin-login-status").textContent = "";

  try {
    const { data, error } = await supabaseClient.auth
      .signInWithPassword({ email, password });

    if (error) throw error;

    currentSession = data.session;

    const admin = await checkAdmin(data.user.id);

    if (!admin) {
      await supabaseClient.auth.signOut();

      currentSession = null;
      isAdmin = false;
      updateAdminUI();

      throw new Error(
        "This account does not have administrator access."
      );
    }

    isAdmin = true;
    $("admin-login-modal").classList.remove("show");
    $("admin-login-form").reset();

    updateAdminUI();
    showAdminDashboard();

  } catch (error) {
    console.error("Admin login failed:", error);
    $("admin-login-status").textContent = error.message;

  } finally {
    button.disabled = false;
    button.innerHTML = 'Sign in <span>→</span>';
  }
});

// ==================================
// CHECK ADMIN PERMISSIONS
// ==================================

async function checkAdmin(userId) {
  const { data, error } = await supabaseClient
    .from("admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("Admin check failed:", error);
    return false;
  }

  return Boolean(data);
}

function updateAdminUI() {
  const button = $("admin-login-open");

  button.innerHTML = isAdmin
    ? '<span class="admin-login-icon">♙</span><span>Admin Dashboard</span>'
    : '<span class="admin-login-icon">♙</span><span>Admin Access</span>';

  $("admin-logout").style.display = isAdmin ? "" : "none";

  if (!isAdmin && adminDashboardOpen) {
    adminDashboardOpen = false;
    $("admin-section").style.display = "none";
    showShopCategory("All");
  }

  renderProducts();

  if (isAdmin && adminDashboardOpen) {
    renderAdminProducts();
  }
}

async function logoutAdmin() {
  const { error } = await supabaseClient.auth.signOut();

  if (error) {
    console.error("Logout failed:", error);
    setText("admin-status", `Could not sign out: ${error.message}`);
    return;
  }

  currentSession = null;
  isAdmin = false;
  requests = [];
  adminDashboardOpen = false;

  updateAdminUI();
  showShopCategory("All");
}

// ==================================
// RESTORE LOGIN SESSION
// ==================================

async function syncAuthSession(session) {
  currentSession = session;

  if (!session) {
    isAdmin = false;
    updateAdminUI();
    return;
  }

  const admin = await checkAdmin(session.user.id);

  currentSession = session;
  isAdmin = admin;
  updateAdminUI();
}

supabaseClient.auth.onAuthStateChange((event, session) => {
  setTimeout(() => {
    syncAuthSession(session);
  }, 0);
});

async function initializeAuth() {
  const { data, error } = await supabaseClient.auth.getSession();

  if (error) {
    console.error("Could not restore login:", error);
    return;
  }

  await syncAuthSession(data.session);
}

// ==================================
// ADMIN: FILTERS
// ==================================

document.querySelectorAll(".admin-filter").forEach(button => {
  button.addEventListener("click", () => {
    currentRequestFilter = button.dataset.status || "all";

    document.querySelectorAll(".admin-filter").forEach(filter => {
      filter.classList.toggle("active", filter === button);
    });

    renderRequests();
  });
});

// ==================================
// ADMIN: LOAD REQUESTS
// ==================================

async function loadRequests() {
  if (!isAdmin) return;

  $("admin-requests").innerHTML =
    '<p class="muted">Loading requests...</p>';

  $("admin-status").textContent = "Loading...";

  const { data, error } = await supabaseClient
    .from("orders")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Request loading failed:", error);

    $("admin-requests").innerHTML =
      `<p class="muted">Could not load requests: ${escapeHTML(error.message)}</p>`;

    $("admin-status").textContent = "Error loading requests.";
    return;
  }

  requests = data || [];

  $("admin-status").textContent =
    `${requests.length} request(s) in total.`;

  renderRequests();
}

// ==================================
// ADMIN: DISPLAY REQUESTS
// ==================================

function renderRequests() {
  const filtered = currentRequestFilter === "all"
    ? requests
    : requests.filter(request =>
        request.status === currentRequestFilter
      );

  if (!filtered.length) {
    $("admin-requests").innerHTML =
      '<p class="muted">No requests found in this category.</p>';
    return;
  }

  $("admin-requests").innerHTML = filtered.map(request => {
    const items = Array.isArray(request.items) ? request.items : [];
    const links = Array.isArray(request.links) ? request.links : [];
    const images = Array.isArray(request.image_urls) ? request.image_urls : [];

    const date = request.created_at
      ? new Date(request.created_at).toLocaleString("en-GB")
      : "Unknown date";

    const itemHTML = items.map(item => {
      if (item.type === "service") {
        return `
          <div class="request-item">
            <strong>${escapeHTML(item.title)}</strong>
            <small>CUSTOM SERVICE</small>
            <p>${escapeHTML(item.description)}</p>
            <p>Proposed price: ${money(item.proposed_price)}</p>
          </div>
        `;
      }

      return `
        <div class="request-item">
          <strong>${escapeHTML(item.name)}</strong>
          <small>
            ${Number(item.quantity)} stacks ·
            ${Number(item.discount_percent || 0)}% total discount
          </small>
          <p>${money(item.line_total)}</p>
        </div>
      `;
    }).join("");

    const linkHTML = links.map(link => {
      let safeLink;

      try {
        const parsed = new URL(link);
        if (!["http:", "https:"].includes(parsed.protocol)) return "";
        safeLink = escapeHTML(parsed.href);
      } catch {
        return "";
      }

      return `
        <p>
          <a href="${safeLink}" target="_blank" rel="noopener noreferrer">
            Open reference link
          </a>
        </p>
      `;
    }).join("");

    const imageHTML = images.map(url => {
      let safeUrl;

      try {
        const parsed = new URL(url);
        if (!["http:", "https:"].includes(parsed.protocol)) return "";
        safeUrl = escapeHTML(parsed.href);
      } catch {
        return "";
      }

      return `
        <a href="${safeUrl}" target="_blank" rel="noopener noreferrer">
          <img src="${safeUrl}" alt="Customer reference" loading="lazy">
        </a>
      `;
    }).join("");

    const status = String(request.status || "pending").toLowerCase();

    return `
      <article class="request-card">
        <div class="request-card-header">
          <div>
            <div class="eyebrow orange">
              ${escapeHTML(request.request_type || "product")} REQUEST
            </div>

            <h3>${escapeHTML(request.minecraft_name || "Unknown player")}</h3>
            <small>${escapeHTML(date)}</small>
          </div>

          <span class="request-status status-${escapeHTML(status)}">
            ${escapeHTML(status)}
          </span>
        </div>

        <div class="request-details">
          <div class="request-items">
            ${itemHTML || '<p>No item details available.</p>'}
          </div>

          ${request.description ? `
            <div class="request-description">
              <strong>Service description</strong>
              <p>${escapeHTML(request.description)}</p>
            </div>
          ` : ""}

          ${request.note ? `
            <div class="request-note">
              <strong>Customer note</strong>
              <p>${escapeHTML(request.note)}</p>
            </div>
          ` : ""}

          ${linkHTML ? `
            <div class="request-links">
              <strong>Reference links</strong>
              ${linkHTML}
            </div>
          ` : ""}

          ${imageHTML ? `
            <div class="request-images">
              <strong>Attached images</strong>
              <div>${imageHTML}</div>
            </div>
          ` : ""}

          <div class="request-financials">
            <div>Subtotal <strong>${money(request.subtotal || 0)}</strong></div>
            <div>Discount <strong>−${money(request.discount_amount || 0)}</strong></div>
            <div>Total <strong>${checkoutMoney(request.total || 0)}</strong></div>
          </div>
        </div>

        <div class="request-actions">
          ${status === "pending" ? `
            <button class="checkout"
              data-request-id="${escapeHTML(request.id)}"
              data-new-status="accepted" type="button">Accept request</button>
          ` : ""}

          ${status === "accepted" ? `
            <button class="checkout"
              data-request-id="${escapeHTML(request.id)}"
              data-new-status="completed" type="button">Complete request</button>
          ` : ""}

          ${status === "pending" || status === "accepted" ? `
            <button class="admin-reject"
              data-request-id="${escapeHTML(request.id)}"
              data-new-status="rejected" type="button">Reject</button>
          ` : ""}
        </div>
      </article>
    `;
  }).join("");

  document.querySelectorAll("[data-request-id]").forEach(button => {
    button.addEventListener("click", () =>
      updateRequestStatus(
        button.dataset.requestId,
        button.dataset.newStatus
      )
    );
  });
}

// ==================================
// ADMIN: UPDATE REQUEST STATUS
// ==================================

async function updateRequestStatus(id, newStatus) {
  const allowedStatuses = [
    "pending",
    "accepted",
    "completed",
    "rejected"
  ];

  if (!isAdmin || !allowedStatuses.includes(newStatus)) return;

  setText("admin-status", "Updating request...");

  const { error } = await supabaseClient
    .from("orders")
    .update({ status: newStatus })
    .eq("id", id);

  if (error) {
    console.error("Status update failed:", error);
    setText("admin-status", `Could not update request: ${error.message}`);
    return;
  }

  await loadRequests();
}

// ==================================
// START
// ==================================

renderCart();
loadProducts();
initializeAuth();
