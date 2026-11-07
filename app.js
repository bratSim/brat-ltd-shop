
const supabaseClient = window.supabase.createClient(
  window.SUPABASE_URL,
  window.SUPABASE_KEY
);

let products = [];
let category = "All";
let cart = JSON.parse(localStorage.getItem("bratCart") || "{}");

const $ = id => document.getElementById(id);

const categoryIcons = {
  "Blocks": "▦",
  "Items": "✦",
  "Armor & Weapons": "⚔",
  "Enchantments": "✧",
  "Services": "⌂"
};

const categoryDescriptions = {
  "Blocks": "Building materials and blocks for your next project.",
  "Items": "Useful items and resources for every adventure.",
  "Armor & Weapons": "Equipment to protect yourself and fight.",
  "Enchantments": "Enchantments and enchanted equipment.",
  "Services": "Custom work and services made for your projects."
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

// --------------------------------
// GENERAL HELPERS
// --------------------------------

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
  return `${Number(n).toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 3
  })} KB$`;
}

function roundMoney(n) {
  return Math.round(
    (Number(n) + Number.EPSILON) * 1000
  ) / 1000;
}

function checkoutMoney(n) {
  return `${Math.ceil(roundMoney(n)).toLocaleString("en-US")} KB$`;
}

function getDiscountPercent(stackCount) {
  const quantity = Number(stackCount);

  if (quantity >= 16) return 15;
  if (quantity >= 10) return 10;
  if (quantity >= 6) return 5;

  return 0;
}

function unitPrice(product, stackCount) {
  const discount = getDiscountPercent(stackCount);

  return roundMoney(
    Number(product.price) * (1 - discount / 100)
  );
}

function stackText(product) {
  return `${product.stackSize} items per stack`;
}

// --------------------------------
// MINECRAFT TEXTURES
// --------------------------------

function itemTextureId(name) {
  const key = String(name || "").trim().toLowerCase();

  return textureAliases[key] ||
    key.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function textureUrl(name, type) {
  const id = itemTextureId(name);

  return `https://assets.mcasset.cloud/1.21.4/assets/minecraft/textures/${type}/${encodeURIComponent(id)}.png`;
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

// --------------------------------
// NAVIGATION
// --------------------------------

function selectCategory(newCategory) {
  category = newCategory;

  document.querySelectorAll("[data-category]").forEach(element => {
    element.classList.toggle(
      "active",
      element.dataset.category === category
    );
  });

  $("search").value = "";

  renderPage();

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
}

document.querySelectorAll("[data-category]").forEach(element => {
  element.addEventListener("click", event => {
    event.preventDefault();
    selectCategory(element.dataset.category);
  });
});

$("search").addEventListener("input", () => {
  if (category === "All") {
    selectCategory("Blocks");
  } else {
    renderProducts();
  }
});

// --------------------------------
// PAGE DISPLAY
// --------------------------------

function renderPage() {
  const isOverview = category === "All";

  $("offers-section").style.display =
    isOverview ? "block" : "none";

  $("shop-section").style.display =
    isOverview ? "none" : "block";

  if (isOverview) {
    $("search").placeholder = "Search the collection...";
    return;
  }

  const title = category === "Armor & Weapons"
    ? "Armor & <em>Weapons.</em>"
    : category === "Enchantments"
      ? "Enchantments."
      : category === "Services"
        ? "Our <em>Services.</em>"
        : `${escapeHTML(category)}.`;

  $("category-title").innerHTML = title;

  $("category-description").textContent =
    categoryDescriptions[category] || "";

  $("search").placeholder = `Search ${category}...`;

  renderProducts();
}

// --------------------------------
// LOAD PRODUCTS
// --------------------------------

async function loadProducts() {
  $("offers-grid").innerHTML =
    '<div class="loading-card">Loading featured offers...</div>';

  $("products").innerHTML =
    '<p class="muted">Loading products...</p>';

  const { data, error } = await supabaseClient
    .from("products")
    .select(`
      id,
      name,
      description,
      category,
      price,
      stack_size,
      is_active
    `)
    .eq("is_active", true)
    .order("name");

  if (error) {
    console.error("Product loading error:", error);

    $("offers-grid").innerHTML =
      '<div class="loading-card">Offers are temporarily unavailable.</div>';

    $("products").innerHTML =
      '<p class="muted">Could not load products. Please try again later.</p>';

    return;
  }

  products = (data || []).map(product => ({
    id: product.id,
    name: product.name,
    category: product.category,
    desc: product.description || "",
    price: Number(product.price),
    stackSize: Number(product.stack_size || 64)
  }));

  renderOffers();
  renderPage();
  renderCart();
}

// --------------------------------
// FEATURED OFFERS
// --------------------------------

function renderOffers() {
  const selected = products.slice(0, 3);

  $("offers-grid").innerHTML = selected.length
    ? selected.map(product => `
      <article class="offer-card">
        <div class="offer-image">
          ${imageMarkup(product.name, product.category)}
        </div>

        <div class="offer-copy">
          <div class="offer-kicker">QUANTITY DEAL</div>

          <h3>${escapeHTML(product.name)}</h3>

          <div class="offer-price">
            ${money(product.price)} <small>/ stack</small>
          </div>

          <small>${stackText(product)}</small>
        </div>

        <span class="offer-badge">OFFER</span>
      </article>
    `).join("")
    : '<div class="loading-card">No products are available yet. Check back soon.</div>';
}

// --------------------------------
// PRODUCT DISPLAY
// --------------------------------

function renderProducts() {
  const q = $("search").value.toLowerCase().trim();

  const shown = products.filter(product =>
    product.category === category &&
    (
      product.name + " " +
      product.category + " " +
      product.desc
    ).toLowerCase().includes(q)
  );

  $("result-count").textContent =
    `${shown.length} products`;

  let html = shown.map(product => `
    <article class="product-card">

      <div class="product-visual">
        <span class="product-tag">
          ${escapeHTML(product.category)}
        </span>

        ${imageMarkup(product.name, product.category)}
      </div>

      <div class="product-info">
        <h3>${escapeHTML(product.name)}</h3>

        <p>${escapeHTML(product.desc)}</p>

        <div class="price-row">
          <div class="price">
            ${money(product.price)}
            <small>/ stack</small>
          </div>

          <button
            class="add-button"
            data-add="${escapeHTML(product.id)}"
            aria-label="Add ${escapeHTML(product.name)} to cart"
          >+</button>
        </div>

        <small class="stack-info">
          ${stackText(product)}
        </small>

        <div class="discount-note">
          ↘ Quantity discounts: up to 15%
        </div>
      </div>

    </article>
  `).join("");

  if (category === "Services") {
    html += serviceFormMarkup();
  }

  if (!html && category !== "Services") {
    html = '<p class="muted">No products available in this category yet.</p>';
  }

  $("products").innerHTML = html;

  document.querySelectorAll("[data-add]").forEach(button => {
    button.addEventListener("click", () => {
      addToCart(button.dataset.add);
    });
  });

  const form = $("service-form");

  if (form) {
    form.addEventListener("submit", handleServiceSubmit);
  }
}

// --------------------------------
// SERVICE FORM
// --------------------------------

function serviceFormMarkup() {
  return `
    <section class="service-request-card">

      <div class="service-request-header">
        <div class="eyebrow orange">
          MADE FOR YOUR PROJECT
        </div>

        <h2>Request a <em>custom service.</em></h2>

        <p>
          Need something special? Describe your idea,
          add reference images and suggest your own price.
        </p>
      </div>

      <form id="service-form">

        <div class="service-field">
          <label for="service-title">Service title</label>

          <input
            id="service-title"
            type="text"
            maxlength="80"
            placeholder="e.g. Custom medieval castle"
            required
          >
        </div>

        <div class="service-field">
          <label for="service-description">Description</label>

          <textarea
            id="service-description"
            rows="6"
            maxlength="3000"
            placeholder="Describe exactly what you need..."
            required
          ></textarea>
        </div>

        <div class="service-field">
          <label for="service-link">
            Reference link <span>Optional</span>
          </label>

          <input
            id="service-link"
            type="url"
            maxlength="500"
            placeholder="https://..."
          >
        </div>

        <div class="service-field">
          <label for="service-images">
            Reference images <span>Optional · Maximum 5 images</span>
          </label>

          <input
            id="service-images"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
          >

          <div class="field-help">
            PNG, JPG, WEBP or GIF · Maximum 5 MB per image
          </div>
        </div>

        <div
          id="service-image-preview"
          class="service-image-preview"
        ></div>

        <div class="service-field">
          <label for="service-price">
            Your proposed price <span>KB$</span>
          </label>

          <input
            id="service-price"
            type="number"
            min="0.001"
            max="100000000"
            step="0.001"
            placeholder="e.g. 150"
            required
          >
        </div>

        <div class="service-disclaimer">
          Your proposed price will be reviewed by Brat Ltd.
          before the service is accepted.
        </div>

        <button type="submit" class="service-submit">
          Add service request to cart <span>→</span>
        </button>

        <p id="service-status" class="service-status"></p>

      </form>
    </section>
  `;
}

// Image preview
document.addEventListener("change", event => {
  if (event.target.id !== "service-images") return;

  const preview = $("service-image-preview");
  const status = $("service-status");
  const files = Array.from(event.target.files || []);

  if (!preview) return;

  preview.innerHTML = "";

  if (status) status.textContent = "";

  if (files.length > 5) {
    if (status) {
      status.textContent = "Please select a maximum of 5 images.";
    }

    event.target.value = "";
    return;
  }

  files.forEach(file => {
    if (!file.type.startsWith("image/")) return;

    const wrapper = document.createElement("div");
    wrapper.className = "preview-image";

    const img = document.createElement("img");
    img.alt = file.name;
    img.src = URL.createObjectURL(file);

    const label = document.createElement("span");
    label.textContent = file.name;

    wrapper.appendChild(img);
    wrapper.appendChild(label);
    preview.appendChild(wrapper);
  });
});

// --------------------------------
// UPLOAD SERVICE IMAGES
// --------------------------------

async function uploadServiceImages(files) {
  const urls = [];

  for (const file of files) {
    const safeName = file.name.replace(
      /[^a-zA-Z0-9._-]/g,
      "_"
    );

    const uniqueId = window.crypto?.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const filePath = `${uniqueId}-${safeName}`;

    const { error } = await supabaseClient.storage
      .from("service-attachments")
      .upload(filePath, file, {
        upsert: false,
        contentType: file.type
      });

    if (error) {
      throw new Error(
        `Could not upload ${file.name}: ${error.message}`
      );
    }

    const { data } = supabaseClient.storage
      .from("service-attachments")
      .getPublicUrl(filePath);

    urls.push(data.publicUrl);
  }

  return urls;
}

// --------------------------------
// ADD SERVICE TO CART
// --------------------------------

async function handleServiceSubmit(event) {
  event.preventDefault();

  const status = $("service-status");
  const button = event.submitter;

  const title = $("service-title").value.trim();
  const description = $("service-description").value.trim();
  const link = $("service-link").value.trim();
  const price = Number($("service-price").value);
  const files = Array.from($("service-images").files || []);

  if (!title || !description) {
    status.textContent =
      "Please complete the title and description.";
    return;
  }

  if (!Number.isFinite(price) || price <= 0) {
    status.textContent = "Please enter a valid price.";
    return;
  }

  if (files.length > 5) {
    status.textContent =
      "You can upload a maximum of 5 images.";
    return;
  }

  const allowedTypes = [
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif"
  ];

  for (const file of files) {
    if (!allowedTypes.includes(file.type)) {
      status.textContent =
        "Only PNG, JPG, WEBP and GIF images are allowed.";
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      status.textContent =
        `The image "${file.name}" is larger than 5 MB.`;
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

  button.disabled = true;
  button.textContent = "Uploading images...";

  status.textContent =
    "Please wait while your images are uploaded.";

  try {
    const imageUrls = await uploadServiceImages(files);

    const serviceId = `service_${Date.now()}_${Math.random()
      .toString(36).slice(2, 8)}`;

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

    $("service-form").reset();
    $("service-image-preview").innerHTML = "";

    status.textContent =
      "Service request added to your cart.";

  } catch (error) {
    console.error("Service upload error:", error);

    status.textContent =
      error.message || "Something went wrong. Please try again.";

  } finally {
    button.disabled = false;
    button.innerHTML =
      'Add service request to cart <span>→</span>';
  }
}

// --------------------------------
// CART STORAGE AND ENTRIES
// --------------------------------

function saveCart() {
  localStorage.setItem("bratCart", JSON.stringify(cart));
}

function getCartEntries() {
  return Object.entries(cart)
    .filter(([id, item]) => {
      if (
        item &&
        typeof item === "object" &&
        item.type === "service"
      ) {
        return Number(item.price) > 0;
      }

      return products.some(product =>
        String(product.id) === String(id)
      ) && Number(item) > 0;
    })
    .map(([id, item]) => {
      if (
        item &&
        typeof item === "object" &&
        item.type === "service"
      ) {
        return {
          id,
          type: "service",
          service: item,
          quantity: 1
        };
      }

      const product = products.find(p =>
        String(p.id) === String(id)
      );

      return {
        id,
        type: "product",
        product,
        quantity: Number(item)
      };
    });
}

// --------------------------------
// PRODUCT CART ACTIONS
// --------------------------------

function addToCart(id) {
  cart[id] = (Number(cart[id]) || 0) + 1;

  saveCart();
  renderCart();
  openCart();
}

function changeQty(id, delta) {
  cart[id] = (Number(cart[id]) || 0) + delta;

  if (cart[id] <= 0) {
    delete cart[id];
  }

  saveCart();
  renderCart();
}

function removeService(id) {
  delete cart[id];

  saveCart();
  renderCart();
}

// --------------------------------
// CART TOTALS
// --------------------------------

function getCartTotals() {
  const entries = getCartEntries();

  let total = 0;
  let originalTotal = 0;

  entries.forEach(entry => {
    if (entry.type === "service") {
      total += Number(entry.service.price);
      originalTotal += Number(entry.service.price);
      return;
    }

    const product = entry.product;
    const quantity = entry.quantity;

    total += unitPrice(product, quantity) * quantity;
    originalTotal += Number(product.price) * quantity;
  });

  total = roundMoney(total);
  originalTotal = roundMoney(originalTotal);

  const savings = roundMoney(originalTotal - total);

  return {
    entries,
    total,
    originalTotal,
    savings,
    checkoutTotal: Math.ceil(total)
  };
}

// --------------------------------
// RENDER CART
// --------------------------------

function renderCart() {
  const entries = getCartEntries();

  let totalStacks = 0;
  let serviceCount = 0;

  $("cart-items").innerHTML = entries.length
    ? entries.map(entry => {
        if (entry.type === "service") {
          const service = entry.service;
          serviceCount++;

          return `
            <div class="cart-line service-cart-line">
              <div>
                <strong>${escapeHTML(service.title)}</strong>

                <small>CUSTOM SERVICE REQUEST</small>

                <small>
                  ${money(service.price)} · Proposed price
                </small>

                <small>
                  ${escapeHTML(service.description)}
                </small>

                ${service.link ? `
                  <small>
                    Reference:
                    <a
                      href="${escapeHTML(service.link)}"
                      target="_blank"
                      rel="noopener noreferrer"
                    >Open link</a>
                  </small>
                ` : ""}

                <small>
                  ${service.imageUrls.length} attached image(s)
                </small>

                <small class="cart-discount">
                  Subject to approval by Brat Ltd.
                </small>
              </div>

              <div class="qty">
                <button
                  data-remove-service="${escapeHTML(entry.id)}"
                  aria-label="Remove service"
                >×</button>
              </div>
            </div>
          `;
        }

        const product = entry.product;
        const quantity = entry.quantity;

        const discount = getDiscountPercent(quantity);
        const price = unitPrice(product, quantity);

        const sum = roundMoney(price * quantity);
        const originalSum = roundMoney(
          Number(product.price) * quantity
        );
        const saved = roundMoney(originalSum - sum);

        const itemCount = quantity * product.stackSize;

        totalStacks += quantity;

        return `
          <div class="cart-line">
            <div>
              <strong>${escapeHTML(product.name)}</strong>

              <small>
                ${money(price)} per stack · ${money(sum)} total
              </small>

              <small>
                ${quantity} stacks · ${itemCount} items
              </small>

              ${discount > 0 ? `
                <small class="cart-discount">
                  ${discount}% discount · You save ${money(saved)}
                </small>

                <small>
                  Regular price: ${money(originalSum)}
                </small>
              ` : `
                <small>No discount yet</small>
              `}
            </div>

            <div class="qty">
              <button
                data-change="${escapeHTML(entry.id)}"
                data-delta="-1"
              >−</button>

              <b>${quantity}</b>

              <button
                data-change="${escapeHTML(entry.id)}"
                data-delta="1"
              >+</button>
            </div>
          </div>
        `;
      }).join("")
    : '<p class="empty">Your cart is empty.</p>';

  const totals = getCartTotals();

  $("cart-count").textContent =
    totalStacks + serviceCount;

  $("cart-total").textContent = money(totals.total);

  document.querySelectorAll("[data-change]").forEach(button => {
    button.addEventListener("click", () => {
      changeQty(
        button.dataset.change,
        Number(button.dataset.delta)
      );
    });
  });

  document.querySelectorAll("[data-remove-service]").forEach(button => {
    button.addEventListener("click", () => {
      removeService(button.dataset.removeService);
    });
  });
}

// --------------------------------
// CART PANEL
// --------------------------------

function openCart() {
  $("cart-panel").classList.add("open");
  $("overlay").classList.add("show");
}

function closeCart() {
  $("cart-panel").classList.remove("open");
  $("overlay").classList.remove("show");
}

$("open-cart").addEventListener("click", openCart);
$("close-cart").addEventListener("click", closeCart);
$("overlay").addEventListener("click", closeCart);

// --------------------------------
// CHECKOUT
// --------------------------------

function showCheckoutTotal() {
  const {
    entries,
    total,
    originalTotal,
    savings,
    checkoutTotal
  } = getCartTotals();

  if (!entries.length) {
    $("order-status").textContent =
      "Add some products to your cart first.";
    return;
  }

  const serviceCount =
    entries.filter(entry => entry.type === "service").length;

  $("checkout-total-preview").innerHTML = `
    <div class="checkout-summary">

      <div>
        Original total:
        <strong>${money(originalTotal)}</strong>
      </div>

      <div>
        Quantity discount:
        <strong>−${money(savings)}</strong>
      </div>

      <div>
        Discounted total:
        <strong>${money(total)}</strong>
      </div>

      <div>
        Custom service requests:
        <strong>${serviceCount}</strong>
      </div>

      <hr>

      <div>
        Final total (rounded up):
        <strong>${checkoutMoney(checkoutTotal)}</strong>
      </div>

    </div>
  `;

  $("order-status").textContent = "";
  $("order-modal").classList.add("show");
}

$("checkout").addEventListener("click", showCheckoutTotal);

$("close-modal").addEventListener("click", () => {
  $("order-modal").classList.remove("show");
});

// --------------------------------
// CREATE ORDER FILE
// --------------------------------

$("send-order").addEventListener("click", () => {
  const name = $("player-name").value.trim();

  if (!name) {
    $("order-status").textContent =
      "Please enter your Minecraft username.";
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

  const lines = entries.map(entry => {
    if (entry.type === "service") {
      const service = entry.service;

      return `
CUSTOM SERVICE REQUEST
Title: ${service.title}

Description:
${service.description}

Proposed price: ${money(service.price)}
Approval: Pending review by Brat Ltd.

Reference link:
${service.link || "None"}

Images:
${service.imageUrls.length
  ? service.imageUrls.join("\n")
  : "None"}
      `.trim();
    }

    const product = entry.product;
    const quantity = entry.quantity;

    const discount = getDiscountPercent(quantity);
    const price = unitPrice(product, quantity);

    const sum = roundMoney(price * quantity);
    const originalSum = roundMoney(
      Number(product.price) * quantity
    );
    const saved = roundMoney(originalSum - sum);

    const itemCount = quantity * product.stackSize;

    return `
${product.name}
${quantity} stacks (${itemCount} items)
Price: ${money(sum)}
Discount: ${discount}%
Saved: ${money(saved)}
    `.trim();
  });

  const content = `BRAT LTD. ORDER REQUEST

Minecraft Username: ${name}

${lines.join("\n\n")}

Original total: ${money(originalTotal)}
Quantity discount: -${money(savings)}
Discounted total: ${money(total)}
Final total (rounded up): ${checkoutMoney(checkoutTotal)}

Note: ${$("order-note").value.trim() || "None"}

Please arrange payment and delivery in-game with Brat Ltd. using KB$.

Custom service prices are proposed prices and require approval by Brat Ltd.`;

  const blob = new Blob([content], {
    type: "text/plain"
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download =
    `Brat-Ltd-Order-${name.replace(/[^a-z0-9_-]/gi, "_")}.txt`;

  link.click();

  URL.revokeObjectURL(url);

  $("order-status").textContent =
    "Order request created as a text file. It has not been submitted automatically.";
});

// --------------------------------
// START
// --------------------------------

renderCart();
loadProducts();
