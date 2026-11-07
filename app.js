
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

// ----------------------------------
// GENERAL HELPERS
// ----------------------------------

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

function getDiscountPercent(quantity) {
  if (quantity >= 16) return 15;
  if (quantity >= 10) return 10;
  if (quantity >= 6) return 5;
  return 0;
}

function unitPrice(product, quantity) {
  const discount = getDiscountPercent(quantity);

  return roundMoney(
    Number(product.price) * (1 - discount / 100)
  );
}

function stackText(product) {
  return `${product.stackSize} items per stack`;
}

// ----------------------------------
// MINECRAFT TEXTURES
// ----------------------------------

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

// ----------------------------------
// LOAD PRODUCTS
// ----------------------------------

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
      is_active
    `)
    .eq("is_active", true)
    .order("name");

  if (error) {
    console.error(error);

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
    stackSize: Number(p.stack_size || 64)
  }));

  renderOffers();
  renderProducts();
  renderCart();
}

// ----------------------------------
// OVERVIEW: OFFERS ONLY
// ----------------------------------

function renderOffers() {
  const q = $("search").value.toLowerCase().trim();

  const selected = products
    .filter(p =>
      (p.name + " " + p.category + " " + p.desc)
        .toLowerCase()
        .includes(q)
    )
    .slice(0, 3);

  $("offers-grid").innerHTML = selected.length
    ? selected.map(p => `
      <article class="offer-card">
        <div class="offer-image">
          ${imageMarkup(p.name, p.category)}
        </div>

        <div class="offer-copy">
          <div class="offer-kicker">QUANTITY DEAL</div>
          <h3>${escapeHTML(p.name)}</h3>

          <div class="offer-price">
            ${money(p.price)} <small>/ stack</small>
          </div>

          <small>${stackText(p)}</small>
        </div>

        <span class="offer-badge">OFFER</span>
      </article>
    `).join("")
    : '<div class="loading-card">No offers found.</div>';
}

// ----------------------------------
// CATEGORY DISPLAY
// ----------------------------------

function renderProducts() {
  const isHome = category === "All";

  $("offers").style.display = isHome ? "" : "none";
  $("shop").style.display =
    !isHome && category !== "Requests" ? "" : "none";

  $("requests-section").style.display =
    category === "Requests" && isAdmin ? "" : "none";

  if (category === "Requests") {
    $("products").innerHTML = "";
    $("result-count").textContent = "";
    return;
  }

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

  let html = shown.map(p => `
    <article class="product-card">
      <div class="product-visual">
        <span class="product-tag">${escapeHTML(p.category)}</span>
        ${imageMarkup(p.name, p.category)}
      </div>

      <div class="product-info">
        <h3>${escapeHTML(p.name)}</h3>
        <p>${escapeHTML(p.desc)}</p>

        <div class="price-row">
          <div class="price">
            ${money(p.price)} <small>/ stack</small>
          </div>

          <button
            class="add-button"
            data-add="${escapeHTML(p.id)}"
            aria-label="Add one stack of ${escapeHTML(p.name)} to cart"
          >+</button>
        </div>

        <small class="stack-info">${stackText(p)}</small>

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
    button.addEventListener("click", () =>
      addToCart(button.dataset.add)
    );
  });

  const form = $("service-form");

  if (form) {
    form.addEventListener("submit", handleServiceSubmit);
  }
}

// ----------------------------------
// SERVICE REQUEST FORM
// ----------------------------------

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
          <input
            id="service-title"
            type="text"
            maxlength="80"
            placeholder="e.g. Custom medieval castle"
            required
          >
        </label>

        <label class="service-label">
          Description
          <textarea
            id="service-description"
            rows="5"
            maxlength="3000"
            placeholder="Describe exactly what you need..."
            required
          ></textarea>
        </label>

        <label class="service-label">
          Reference link <span>(optional)</span>
          <input
            id="service-link"
            type="url"
            maxlength="500"
            placeholder="https://..."
          >
        </label>

        <label class="service-label">
          Images <span>(optional, max. 5 images, 5 MB each)</span>
          <input
            id="service-images"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
          >
        </label>

        <div id="service-image-preview" class="service-image-preview"></div>

        <label class="service-label">
          Your proposed price (KB$)
          <input
            id="service-price"
            type="number"
            min="0.001"
            max="100000000"
            step="0.001"
            placeholder="e.g. 150"
            required
          >
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

// ----------------------------------
// IMAGE PREVIEW
// ----------------------------------

document.addEventListener("change", event => {
  if (event.target.id !== "service-images") return;

  const preview = $("service-image-preview");
  const files = Array.from(event.target.files || []);

  if (!preview) return;

  preview.innerHTML = "";

  if (files.length > 5) {
    $("service-status").textContent =
      "Please select a maximum of 5 images.";

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

// ----------------------------------
// UPLOAD SERVICE IMAGES
// ----------------------------------

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

// ----------------------------------
// ADD SERVICE TO CART
// ----------------------------------

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
    button.innerHTML =
      'Add service request to cart <span>→</span>';
  }
}

// ----------------------------------
// CART
// ----------------------------------

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
        service: item,
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

    const p = entry.product;
    const quantity = entry.quantity;

    total += unitPrice(p, quantity) * quantity;
    originalTotal += Number(p.price) * quantity;
  });

  total = roundMoney(total);
  originalTotal = roundMoney(originalTotal);

  return {
    entries,
    total,
    originalTotal,
    savings: roundMoney(originalTotal - total),
    checkoutTotal: Math.ceil(total)
  };
}

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

                ${s.link ? `
                  <small>Reference: ${escapeHTML(s.link)}</small>
                ` : ""}

                <small>${s.imageUrls.length} attached image(s)</small>

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

        const p = entry.product;
        const quantity = entry.quantity;
        const discount = getDiscountPercent(quantity);
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
                  ${discount}% discount · You save ${money(saved)}
                </small>
                <small>Regular price: ${money(originalSum)}</small>
              ` : `
                <small>No discount yet</small>
              `}
            </div>

            <div class="qty">
              <button data-change="${escapeHTML(entry.id)}" data-delta="-1">−</button>
              <b>${quantity}</b>
              <button data-change="${escapeHTML(entry.id)}" data-delta="1">+</button>
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
      changeQty(
        button.dataset.change,
        Number(button.dataset.delta)
      )
    );
  });

  document.querySelectorAll("[data-remove-service]").forEach(button => {
    button.addEventListener("click", () =>
      removeService(button.dataset.removeService)
    );
  });
}

// ----------------------------------
// CART PANEL
// ----------------------------------

function openCart() {
  $("cart-panel").classList.add("open");
  $("overlay").classList.add("show");
}

function closeCart() {
  $("cart-panel").classList.remove("open");
  $("overlay").classList.remove("show");
}

// ----------------------------------
// NAVIGATION
// ----------------------------------

function selectCategory(selectedCategory) {
  if (selectedCategory === "Requests" && !isAdmin) {
    selectCategory("All");
    return;
  }

  category = selectedCategory;

  document.querySelectorAll("[data-category]").forEach(element => {
    element.classList.toggle(
      "active",
      element.dataset.category === category
    );
  });

  renderProducts();

  if (category === "Requests") {
    loadRequests();
    $("requests-section").scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
    return;
  }

  const target = category === "All" ? $("offers") : $("shop");

  target.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

document.querySelectorAll(".nav-link, .text-link").forEach(element => {
  if (!element.dataset.category) return;

  element.addEventListener("click", event => {
    event.preventDefault();
    selectCategory(element.dataset.category);
  });
});

// ----------------------------------
// SEARCH
// ----------------------------------

$("search").addEventListener("input", () => {
  if (category === "All") {
    renderOffers();
  } else if (category !== "Requests") {
    renderProducts();
  }
});

// ----------------------------------
// BUTTONS
// ----------------------------------

$("open-cart").onclick = openCart;
$("close-cart").onclick = closeCart;
$("overlay").onclick = closeCart;

$("checkout").onclick = showCheckoutTotal;

$("close-modal").onclick = () => {
  $("order-modal").classList.remove("show");
};

$("admin-login-open").onclick = () => {
  $("admin-login-modal").classList.add("show");
};

$("admin-login-close").onclick = () => {
  $("admin-login-modal").classList.remove("show");
};

$("refresh-requests").onclick = loadRequests;

$("admin-logout").onclick = logoutAdmin;

// ----------------------------------
// CHECKOUT
// ----------------------------------

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

  const preview = $("checkout-total-preview");

  const serviceCount =
    entries.filter(e => e.type === "service").length;

  preview.innerHTML = `
    <div class="checkout-summary">
      <div>Original total: <strong>${money(originalTotal)}</strong></div>
      <div>Quantity discount: <strong>−${money(savings)}</strong></div>
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
  $("order-modal").classList.add("show");
}

// ----------------------------------
// SAVE ORDER TO SUPABASE
// ----------------------------------

$("send-order").onclick = submitOrder;

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
    const discount = getDiscountPercent(quantity);
    const price = unitPrice(p, quantity);

    return {
      type: "product",
      product_id: p.id,
      name: p.name,
      category: p.category,
      quantity,
      stack_size: p.stackSize,
      original_price: p.price,
      discounted_price: price,
      discount_percent: discount,
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

  $("order-status").textContent =
    "Saving your order request...";

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
    button.innerHTML =
      'Submit order request <span>→</span>';
  }
}

// ----------------------------------
// ADMIN LOGIN
// ----------------------------------

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
      .signInWithPassword({
        email,
        password
      });

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

    $("admin-login-modal").classList.remove("show");
    $("admin-login-form").reset();

    updateAdminUI();
    selectCategory("Requests");

  } catch (error) {
    console.error(error);

    $("admin-login-status").textContent = error.message;

  } finally {
    button.disabled = false;
    button.innerHTML = 'Sign in <span>→</span>';
  }
});

// ----------------------------------
// CHECK ADMIN PERMISSIONS
// ----------------------------------

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
  document.querySelectorAll(".admin-only").forEach(element => {
    element.style.display = isAdmin ? "" : "none";
  });

  $("admin-login-open").style.display =
    isAdmin ? "none" : "";

  $("admin-logout").style.display =
    isAdmin ? "" : "none";

  if (!isAdmin && category === "Requests") {
    selectCategory("All");
  }
}

async function logoutAdmin() {
  await supabaseClient.auth.signOut();

  currentSession = null;
  isAdmin = false;
  requests = [];

  updateAdminUI();
  selectCategory("All");
}

// ----------------------------------
// RESTORE LOGIN SESSION
// ----------------------------------

async function initializeAuth() {
  const { data, error } = await supabaseClient.auth.getSession();

  if (error) {
    console.error(error);
    return;
  }

  currentSession = data.session;

  if (currentSession) {
    isAdmin = await checkAdmin(currentSession.user.id);
  }

  updateAdminUI();
}

supabaseClient.auth.onAuthStateChange((event, session) => {
  currentSession = session;

  if (!session) {
    isAdmin = false;
    updateAdminUI();
    return;
  }

  checkAdmin(session.user.id).then(admin => {
    isAdmin = admin;
    updateAdminUI();
  });
});

// ----------------------------------
// ADMIN: LOAD REQUESTS
// ----------------------------------

async function loadRequests() {
  if (!isAdmin) return;

  $("requests-list").innerHTML =
    '<p class="muted">Loading requests...</p>';

  $("requests-count").textContent = "Loading...";

  const { data, error } = await supabaseClient
    .from("orders")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);

    $("requests-list").innerHTML =
      `<p class="muted">Could not load requests: ${escapeHTML(error.message)}</p>`;

    $("requests-count").textContent = "Error loading requests";

    return;
  }

  requests = data || [];

  $("requests-count").textContent =
    `${requests.length} request(s)`;

  renderRequests();
}

// ----------------------------------
// ADMIN: DISPLAY REQUESTS
// ----------------------------------

function renderRequests() {
  if (!requests.length) {
    $("requests-list").innerHTML =
      '<p class="muted">No requests have been submitted yet.</p>';
    return;
  }

  $("requests-list").innerHTML = requests.map(request => {
    const items = Array.isArray(request.items)
      ? request.items
      : [];

    const links = Array.isArray(request.links)
      ? request.links
      : [];

    const images = Array.isArray(request.image_urls)
      ? request.image_urls
      : [];

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
            ${Number(item.discount_percent || 0)}% discount
          </small>
          <p>
            ${money(item.line_total)}
          </p>
        </div>
      `;
    }).join("");

    const linkHTML = links.map(link => `
      <p>
        <a href="${escapeHTML(link)}" target="_blank" rel="noopener noreferrer">
          Open reference link
        </a>
      </p>
    `).join("");

    const imageHTML = images.map(url => `
      <a href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">
        <img
          src="${escapeHTML(url)}"
          alt="Customer reference"
          loading="lazy"
          style="width:100px;height:100px;object-fit:cover;border-radius:8px;margin:5px"
        >
      </a>
    `).join("");

    return `
      <article class="request-card">

        <div class="request-card-header">
          <div>
            <div class="eyebrow orange">
              ${escapeHTML(request.request_type || "product")}
              REQUEST
            </div>

            <h3>${escapeHTML(request.minecraft_name)}</h3>

            <small>${escapeHTML(date)}</small>
          </div>

          <span class="request-status status-${escapeHTML(request.status)}">
            ${escapeHTML(request.status)}
          </span>
        </div>

        <div class="request-details">
          ${itemHTML || '<p>No item details available.</p>'}

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
            <div>Subtotal: <strong>${money(request.subtotal || 0)}</strong></div>
            <div>Discount: <strong>−${money(request.discount_amount || 0)}</strong></div>
            <div>Total: <strong>${checkoutMoney(request.total || 0)}</strong></div>
          </div>
        </div>

        <div class="request-actions">
          ${request.status !== "accepted" && request.status !== "completed" && request.status !== "rejected" ? `
            <button class="checkout" data-status="${request.id}" data-value="accepted">
              Accept
            </button>
          ` : ""}

          ${request.status === "accepted" ? `
            <button class="checkout" data-status="${request.id}" data-value="paid">
              Mark as paid
            </button>
          ` : ""}

          ${request.status === "accepted" || request.status === "paid" ? `
            <button class="checkout" data-status="${request.id}" data-value="completed">
              Complete
            </button>
          ` : ""}

          ${request.status === "pending" || request.status === "accepted" ? `
            <button class="admin-reject" data-status="${request.id}" data-value="rejected">
              Reject
            </button>
          ` : ""}
        </div>

      </article>
    `;
  }).join("");

  document.querySelectorAll("[data-status]").forEach(button => {
    button.addEventListener("click", () =>
      updateRequestStatus(
        button.dataset.status,
        button.dataset.value
      )
    );
  });
}

// ----------------------------------
// ADMIN: UPDATE REQUEST STATUS
// ----------------------------------

async function updateRequestStatus(id, newStatus) {
  const allowedStatuses = [
    "pending",
    "accepted",
    "paid",
    "completed",
    "rejected"
  ];

  if (!isAdmin || !allowedStatuses.includes(newStatus)) {
    return;
  }

  const { error } = await supabaseClient
    .from("orders")
    .update({ status: newStatus })
    .eq("id", id);

  if (error) {
    console.error(error);
    alert(`Could not update request: ${error.message}`);
    return;
  }

  await loadRequests();
}

// ----------------------------------
// START
// ----------------------------------

renderCart();
loadProducts();
initializeAuth();
