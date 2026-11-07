
const supabaseClient = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_KEY);

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
  "stone":"stone","cobblestone":"cobblestone","oak log":"oak_log","oak wood":"oak_log","oak planks":"oak_planks",
  "spruce log":"spruce_log","spruce planks":"spruce_planks","birch log":"birch_log","birch planks":"birch_planks",
  "dirt":"dirt","grass block":"grass_block","glass":"glass","sand":"sand","gravel":"gravel","obsidian":"obsidian",
  "deepslate":"deepslate","diamond":"diamond","emerald":"emerald","gold ingot":"gold_ingot","iron ingot":"iron_ingot",
  "netherite ingot":"netherite_ingot","coal":"coal","redstone":"redstone","lapis lazuli":"lapis_lazuli",
  "golden apple":"golden_apple","enchanted golden apple":"enchanted_golden_apple","ender pearl":"ender_pearl",
  "blaze rod":"blaze_rod","elytra":"elytra","diamond sword":"diamond_sword","netherite sword":"netherite_sword",
  "diamond pickaxe":"diamond_pickaxe","netherite pickaxe":"netherite_pickaxe","diamond helmet":"diamond_helmet",
  "diamond chestplate":"diamond_chestplate","diamond leggings":"diamond_leggings","diamond boots":"diamond_boots",
  "netherite helmet":"netherite_helmet","netherite chestplate":"netherite_chestplate","netherite leggings":"netherite_leggings",
  "netherite boots":"netherite_boots","bow":"bow","crossbow":"crossbow","shield":"shield","trident":"trident",
  "enchanted book":"enchanted_book","book":"book","anvil":"anvil","shulker box":"shulker_box","chest":"chest","hopper":"hopper"
};

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;",
    "<":"&lt;",
    ">":"&gt;",
    '"':"&quot;",
    "'":"&#039;"
  }[c]));
}

function money(n) {
  return `${Math.round(Number(n)).toLocaleString("en-US")} KB$`;
}

function itemTextureId(name) {
  const key = String(name || "").trim().toLowerCase();
  return textureAliases[key] || key.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function textureUrl(name) {
  return `https://assets.mcasset.cloud/1.21.4/assets/minecraft/textures/item/${encodeURIComponent(itemTextureId(name))}.png`;
}

function imageMarkup(name, cat, cls = "") {
  const fallback = categoryIcons[cat] || "✦";

  return `<img class="${cls}" src="${textureUrl(name)}" alt="${escapeHTML(name)}" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'fallback-icon',textContent:'${fallback}'}))">`;
}

// Price is always calculated per stack.
function unitPrice(p, stackCount) {
  let price = Number(p.price);

  for (const d of p.discounts) {
    if (stackCount >= Number(d.min)) {
      price = Number(d.price);
    }
  }

  return price;
}

function isOffer(p) {
  return p.discounts.length > 0;
}

function stackText(p) {
  return `${p.stackSize} items per stack`;
}

async function loadProducts() {
  $("products").innerHTML = '<p class="muted">Loading products...</p>';
  $("offers-grid").innerHTML = '<div class="loading-card">Loading featured offers...</div>';

  const { data, error } = await supabaseClient
    .from("products")
    .select(`
      id,
      name,
      description,
      category,
      price,
      stack_size,
      is_active,
      product_discounts(min_quantity,price)
    `)
    .eq("is_active", true)
    .order("name");

  if (error) {
    console.error("Product loading error:", error);
    $("products").innerHTML = '<p class="muted">Could not load products. Please try again later.</p>';
    $("offers-grid").innerHTML = '<div class="loading-card">Offers are temporarily unavailable.</div>';
    return;
  }

  products = (data || []).map(p => ({
    id: p.id,
    name: p.name,
    category: p.category,
    desc: p.description || "",
    price: Number(p.price),
    stackSize: Number(p.stack_size || 64),
    discounts: (p.product_discounts || [])
      .map(d => ({
        min: Number(d.min_quantity),
        price: Number(d.price)
      }))
      .sort((a, b) => a.min - b.min)
  }));

  renderOffers();
  renderProducts();
  renderCart();
}

function renderOffers() {
  const discounted = products.filter(isOffer);
  const selected = (discounted.length ? discounted : products).slice(0, 3);

  $("offers-grid").innerHTML = selected.length
    ? selected.map(p => `
      <article class="offer-card">
        <div class="offer-image">${imageMarkup(p.name, p.category)}</div>
        <div class="offer-copy">
          <div class="offer-kicker">${isOffer(p) ? "QUANTITY DEAL" : "FEATURED PRODUCT"}</div>
          <h3>${escapeHTML(p.name)}</h3>
          <div class="offer-price">${money(p.price)} <small>/ stack</small></div>
          <small>${stackText(p)}</small>
        </div>
        ${isOffer(p) ? '<span class="offer-badge">OFFER</span>' : ""}
      </article>
    `).join("")
    : '<div class="loading-card">No products are available yet. Check back soon.</div>';
}

function renderProducts() {
  const q = $("search").value.toLowerCase().trim();

  const shown = products.filter(p =>
    (category === "All" || p.category === category) &&
    (p.name + " " + p.category + " " + p.desc).toLowerCase().includes(q)
  );

  $("result-count").textContent = `${shown.length} products`;

  $("products").innerHTML = shown.map(p => `
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
          <button class="add-button" data-add="${escapeHTML(p.id)}"
            aria-label="Add one stack of ${escapeHTML(p.name)} to cart">+</button>
        </div>
        <small class="stack-info">${stackText(p)}</small>
        ${p.discounts.length ? '<div class="discount-note">↘ Quantity discounts available</div>' : ""}
      </div>
    </article>
  `).join("") || '<p class="muted">No matching products found.</p>';

  document.querySelectorAll("[data-add]").forEach(b =>
    b.addEventListener("click", () => addToCart(b.dataset.add))
  );
}

// One click adds one complete stack.
function addToCart(id) {
  cart[id] = (cart[id] || 0) + 1;
  saveCart();
  renderCart();
  openCart();
}

function changeQty(id, delta) {
  cart[id] = (cart[id] || 0) + delta;

  if (cart[id] <= 0) {
    delete cart[id];
  }

  saveCart();
  renderCart();
}

function saveCart() {
  localStorage.setItem("bratCart", JSON.stringify(cart));
}

function renderCart() {
  const entries = Object.entries(cart).filter(([id, q]) =>
    products.some(p => String(p.id) === id) && q > 0
  );

  let total = 0;
  let stackCount = 0;

  $("cart-items").innerHTML = entries.length
    ? entries.map(([id, q]) => {
        const p = products.find(x => String(x.id) === id);
        const price = unitPrice(p, q);
        const sum = price * q;
        const itemCount = q * p.stackSize;

        total += sum;
        stackCount += q;

        return `
          <div class="cart-line">
            <div>
              <strong>${escapeHTML(p.name)}</strong>
              <small>${money(price)} per stack · ${money(sum)} total</small>
              <small>${q} stacks · ${itemCount} items</small>
            </div>
            <div class="qty">
              <button data-change="${escapeHTML(id)}" data-delta="-1">−</button>
              <b>${q}</b>
              <button data-change="${escapeHTML(id)}" data-delta="1">+</button>
            </div>
          </div>
        `;
      }).join("")
    : '<p class="empty">Your cart is empty.</p>';

  $("cart-count").textContent = stackCount;
  $("cart-total").textContent = money(total);

  document.querySelectorAll("[data-change]").forEach(b =>
    b.addEventListener("click", () =>
      changeQty(b.dataset.change, Number(b.dataset.delta))
    )
  );
}

function openCart() {
  $("cart-panel").classList.add("open");
  $("overlay").classList.add("show");
}

function closeCart() {
  $("cart-panel").classList.remove("open");
  $("overlay").classList.remove("show");
}

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

    if (e.classList.contains("nav-link") || e.classList.contains("text-link")) {
      document.querySelector("#shop").scrollIntoView({ behavior: "smooth" });
    }
  })
);

$("search").addEventListener("input", renderProducts);
$("open-cart").onclick = openCart;
$("close-cart").onclick = closeCart;
$("overlay").onclick = closeCart;

$("checkout").onclick = () => {
  if (!Object.keys(cart).length) {
    $("order-status").textContent = "Add some products to your cart first.";
    return;
  }

  $("order-modal").classList.add("show");
};

$("close-modal").onclick = () => $("order-modal").classList.remove("show");

$("send-order").onclick = () => {
  const name = $("player-name").value.trim();

  if (!name) {
    $("order-status").textContent = "Please enter your Minecraft username.";
    return;
  }

  const entries = Object.entries(cart).filter(([id, q]) =>
    products.some(p => String(p.id) === id) && q > 0
  );

  if (!entries.length) {
    $("order-status").textContent = "Your cart is empty.";
    return;
  }

  const lines = entries.map(([id, q]) => {
    const p = products.find(x => String(x.id) === id);
    const price = unitPrice(p, q);
    const itemCount = q * p.stackSize;

    return `${p.name}: ${q} stacks (${itemCount} items) – ${money(price * q)}`;
  });

  const total = entries.reduce((sum, [id, q]) => {
    const p = products.find(x => String(x.id) === id);
    return sum + unitPrice(p, q) * q;
  }, 0);

  const content = `BRAT LTD. ORDER REQUEST
Minecraft Username: ${name}
${lines.join("\n")}
Total: ${money(total)}
Note: ${$("order-note").value.trim() || "None"}

Please arrange payment and delivery in-game with Brat Ltd. using KB$.`;

  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = url;
  a.download = `Brat-Ltd-Order-${name.replace(/[^a-z0-9_-]/gi, "_")}.txt`;
  a.click();

  URL.revokeObjectURL(url);

  $("order-status").textContent =
    "Order request created as a text file. It has not been submitted automatically.";
};

renderCart();
loadProducts();
