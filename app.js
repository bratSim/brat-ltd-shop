
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

function unitPrice(p, stackCount) {
  const originalPrice = Number(p.price);
  const discount = getDiscountPercent(stackCount);

  return roundMoney(
    originalPrice * (1 - discount / 100)
  );
}

function stackText(p) {
  return `${p.stackSize} items per stack`;
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
// PRODUCTS
// --------------------------------

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
    console.error("Product loading error:", error);

    $("products").innerHTML =
      '<p class="muted">Could not load products. Please try again later.</p>';

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

// --------------------------------
// OFFERS
// --------------------------------

function renderOffers() {
  const selected = products.slice(0, 3);

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
    : '<div class="loading-card">No products are available yet. Check back soon.</div>';
}

// --------------------------------
// PRODUCT DISPLAY
// --------------------------------


function renderProducts() {
  const q = $("search").value.toLowerCase().trim();

  // Startseite und Kategorien unterschiedlich anzeigen
  const isHome = category === "All";

  $("offers-section").style.display = isHome ? "" : "none";
  $("shop-section").style.display = isHome ? "none" : "";

  document.querySelector(".hero").style.display = "none";
  document.querySelector(".value-strip").style.display = "none";
  document.querySelector(".trade-note").style.display = "none";

  // Auf der Startseite keine Produktübersicht anzeigen
  if (isHome) {
    $("products").innerHTML = "";
    $("result-count").textContent = "";
    return;
  }

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

  // Das Formular gibt es ausschließlich im Services-Reiter
  if (category === "Services") {
    html += serviceFormMarkup();
  }

  $("products").innerHTML =
    html || (category === "Services"
      ? ""
      : '<p class="muted">No products available in this category yet.</p>');

  document.querySelectorAll("[data-add]").forEach(b =>
    b.addEventListener("click", () => addToCart(b.dataset.add))
  );

  const serviceForm = $("service-form");

  if (serviceForm) {
    serviceForm.addEventListener("submit", handleServiceSubmit);
  }
}


// --------------------------------
// SERVICE REQUEST FORM
// --------------------------------

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

// Image preview
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

// Upload images to Supabase Storage
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

// Create service request
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

  const submitButton = event.submitter;

  submitButton.disabled = true;
  submitButton.textContent = "Uploading images...";

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
    console.error("Service upload error:", error);

    status.textContent =
      error.message || "Something went wrong. Please try again.";

  } finally {
    submitButton.disabled = false;
    submitButton.innerHTML =
      'Add service request to cart <span>→</span>';
  }
}

// --------------------------------
// CART
// --------------------------------

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

    const product = products.find(p => String(p.id) === String(id));

    return {
      id,
      type: "product",
      product,
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
  let savings = 0;

  entries.forEach(entry => {
    if (entry.type === "service") {
      total += Number(entry.service.price);
      originalTotal += Number(entry.service.price);
      return;
    }

    const p = entry.product;
    const quantity = entry.quantity;

    const discountedPrice = unitPrice(p, quantity);

    total += discountedPrice * quantity;
    originalTotal += Number(p.price) * quantity;
  });

  total = roundMoney(total);
  originalTotal = roundMoney(originalTotal);
  savings = roundMoney(originalTotal - total);

  return {
    entries,
    total,
    originalTotal,
    savings,
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

                <small>
                  ${money(s.price)} · Proposed price
                </small>

                <small>
                  ${escapeHTML(s.description)}
                </small>

                ${s.link ? `
                  <small>
                    Reference: ${escapeHTML(s.link)}
                  </small>
                ` : ""}

                <small>
                  ${s.imageUrls.length} attached image(s)
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

        const p = entry.product;
        const quantity = entry.quantity;

        const discount = getDiscountPercent(quantity);
        const price = unitPrice(p, quantity);

        const sum = roundMoney(price * quantity);
        const originalSum = roundMoney(Number(p.price) * quantity);
        const saved = roundMoney(originalSum - sum);

        const itemCount = quantity * p.stackSize;

        totalStacks += quantity;

        return `
          <div class="cart-line">
            <div>
              <strong>${escapeHTML(p.name)}</strong>

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

  $("cart-count").textContent = totalStacks + totals.entries.filter(e => e.type === "service").length;
  $("cart-total").textContent = money(totals.total);

  if ($("cart-savings")) {
    $("cart-savings").textContent = money(totals.savings);
  }

  document.querySelectorAll("[data-change]").forEach(b =>
    b.addEventListener("click", () =>
      changeQty(
        b.dataset.change,
        Number(b.dataset.delta)
      )
    )
  );

  document.querySelectorAll("[data-remove-service]").forEach(b =>
    b.addEventListener("click", () =>
      removeService(b.dataset.removeService)
    )
  );
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

// --------------------------------
// CATEGORY NAVIGATION
// --------------------------------

function selectCategory(c) {
  category = c;

  document.querySelectorAll("[data-category]").forEach(e =>
    e.classList.toggle("active", e.dataset.category === category)
  );

  renderProducts();
}

document.querySelectorAll("[data-category]").forEach(e =>
  e.addEventListener("click", () => {
    selectCategory(e.dataset.category);

    if (
      e.classList.contains("nav-link") ||
      e.classList.contains("text-link")
    ) {
      document.querySelector("#shop").scrollIntoView({
        behavior: "smooth"
      });
    }
  })
);

// --------------------------------
// SEARCH AND BUTTONS
// --------------------------------

$("search").addEventListener("input", renderProducts);
$("open-cart").onclick = openCart;
$("close-cart").onclick = closeCart;
$("overlay").onclick = closeCart;

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

  let preview = $("checkout-total-preview");

  if (!preview) {
    preview = document.createElement("div");
    preview.id = "checkout-total-preview";

    const modal = $("order-modal");
    const firstInput = $("player-name");

    if (firstInput && firstInput.parentElement) {
      firstInput.parentElement.insertBefore(
        preview,
        firstInput
      );
    } else {
      modal.prepend(preview);
    }
  }

  const serviceCount = entries.filter(e => e.type === "service").length;

  preview.innerHTML = `
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

$("checkout").onclick = showCheckoutTotal;

$("close-modal").onclick = () => {
  $("order-modal").classList.remove("show");
};

// --------------------------------
// CREATE ORDER FILE
// --------------------------------

$("send-order").onclick = () => {
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
    $("order-status").textContent =
      "Your cart is empty.";

    return;
  }

  const lines = entries.map(entry => {
    if (entry.type === "service") {
      const s = entry.service;

      return `
CUSTOM SERVICE REQUEST
Title: ${s.title}

Description:
${s.description}

Proposed price: ${money(s.price)}
Approval: Pending review by Brat Ltd.

Reference link:
${s.link || "None"}

Images:
${s.imageUrls.length
  ? s.imageUrls.join("\n")
  : "None"}
      `.trim();
    }

    const p = entry.product;
    const quantity = entry.quantity;

    const discount = getDiscountPercent(quantity);
    const price = unitPrice(p, quantity);

    const sum = roundMoney(price * quantity);
    const originalSum = roundMoney(Number(p.price) * quantity);
    const saved = roundMoney(originalSum - sum);

    const itemCount = quantity * p.stackSize;

    return `
${p.name}
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
  const a = document.createElement("a");

  a.href = url;
  a.download = `Brat-Ltd-Order-${name.replace(/[^a-z0-9_-]/gi, "_")}.txt`;

  a.click();

  URL.revokeObjectURL(url);

  $("order-status").textContent =
    "Order request created as a text file. It has not been submitted automatically.";
};

// --------------------------------
// START
// --------------------------------

renderCart();
loadProducts();
