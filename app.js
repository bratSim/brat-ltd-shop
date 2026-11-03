
const supabaseClient = window.supabase.createClient(
  window.SUPABASE_URL,
  window.SUPABASE_KEY
);

let products = [];
let category = "Alle";
let cart = JSON.parse(localStorage.getItem("bratCart") || "{}");

const $ = id => document.getElementById(id);

const categoryEmojis = {
  "Blöcke": "🧱",
  "Items": "💎",
  "Rüstung & Waffen": "⚔️",
  "Verzauberungen": "📘",
  "Dienstleistungen": "🏗️"
};

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function money(n) {
  return `${Number(Number(n).toFixed(2)).toLocaleString("de-DE")} KB$`;
}

function unitPrice(product, quantity) {
  let price = Number(product.price);

  for (const discount of product.discounts) {
    if (quantity >= Number(discount.min)) {
      price = Number(discount.price);
    }
  }

  return price;
}

// Produkte und Mengenrabatte aus Supabase laden
async function loadProducts() {
  $("products").innerHTML =
    '<p class="muted">Produkte werden geladen ...</p>';

  const { data, error } = await supabaseClient
    .from("products")
    .select(`
      id,
      name,
      description,
      category,
      price,
      is_active,
      product_discounts (
        min_quantity,
        price
      )
    `)
    .eq("is_active", true)
    .order("name");

  if (error) {
    console.error("Fehler beim Laden:", error);
    $("products").innerHTML =
      '<p class="muted">Produkte konnten nicht geladen werden. Bitte später erneut versuchen.</p>';
    return;
  }

  products = (data || []).map(product => ({
    id: product.id,
    name: product.name,
    category: product.category,
    desc: product.description || "",
    price: Number(product.price),
    emoji: categoryEmojis[product.category] || "📦",
    discounts: (product.product_discounts || [])
      .map(d => ({
        min: Number(d.min_quantity),
        price: Number(d.price)
      }))
      .sort((a, b) => a.min - b.min)
  }));

  renderProducts();
  renderCart();
}

function renderProducts() {
  const query = $("search").value.toLowerCase();

  const shown = products.filter(p =>
    (category === "Alle" || p.category === category) &&
    (p.name + " " + p.category + " " + p.desc)
      .toLowerCase()
      .includes(query)
  );

  $("result-count").textContent = `${shown.length} Produkte`;

  $("products").innerHTML = shown.map(p => `
    <article class="product-card">
      <div class="product-visual">
        <span class="product-tag">${escapeHTML(p.category)}</span>
        <span class="emoji">${p.emoji}</span>
      </div>
      <div class="product-info">
        <h3>${escapeHTML(p.name)}</h3>
        <p>${escapeHTML(p.desc)}</p>
        <div class="price-row">
          <div class="price">${money(p.price)} <small>/ Stück</small></div>
          <button class="add-button" data-add="${escapeHTML(p.id)}"
            aria-label="Produkt hinzufügen">+</button>
        </div>
        ${p.discounts.length
          ? '<div class="discount-note">↘ Mengenrabatt verfügbar</div>'
          : ''}
      </div>
    </article>
  `).join("") || '<p class="muted">Keine passenden Produkte gefunden.</p>';

  document.querySelectorAll("[data-add]").forEach(button => {
    button.addEventListener("click", () => addToCart(button.dataset.add));
  });
}

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
  const entries = Object.entries(cart).filter(([id, quantity]) =>
    products.some(p => String(p.id) === id) && quantity > 0
  );

  let total = 0;
  let count = 0;

  $("cart-items").innerHTML = entries.length
    ? entries.map(([id, quantity]) => {
        const p = products.find(x => String(x.id) === id);
        const unit = unitPrice(p, quantity);
        const sum = unit * quantity;

        total += sum;
        count += quantity;

        return `
          <div class="cart-line">
            <div>
              <strong>${escapeHTML(p.name)}</strong>
              <small>${money(unit)} pro Stück · ${money(sum)} gesamt</small>
            </div>
            <div class="qty">
              <button data-change="${escapeHTML(id)}" data-delta="-1">−</button>
              <b>${quantity}</b>
              <button data-change="${escapeHTML(id)}" data-delta="1">+</button>
            </div>
          </div>
        `;
      }).join("")
    : '<p class="empty">Dein Warenkorb ist noch leer.</p>';

  $("cart-count").textContent = count;
  $("cart-total").textContent = money(total);

  document.querySelectorAll("[data-change]").forEach(button => {
    button.addEventListener("click", () => {
      changeQty(button.dataset.change, Number(button.dataset.delta));
    });
  });
}

function openCart() {
  $("cart-panel").classList.add("open");
  $("overlay").classList.add("show");
}

function closeCart() {
  $("cart-panel").classList.remove("open");
  $("overlay").classList.remove("show");
}

document.querySelectorAll("[data-category]").forEach(el => {
  el.addEventListener("click", () => {
    category = el.dataset.category;

    document.querySelectorAll(".chip").forEach(c =>
      c.classList.toggle("active", c.dataset.category === category)
    );

    renderProducts();
  });
});

$("search").addEventListener("input", renderProducts);
$("open-cart").onclick = openCart;
$("close-cart").onclick = closeCart;
$("overlay").onclick = closeCart;

$("checkout").onclick = () => {
  if (!Object.keys(cart).length) {
    $("order-status").textContent =
      "Füge zuerst Produkte zum Warenkorb hinzu.";
    return;
  }

  $("order-modal").classList.add("show");
};

$("close-modal").onclick = () =>
  $("order-modal").classList.remove("show");

// Bestellanfrage vorerst als Textdatei erstellen
$("send-order").onclick = () => {
  const name = $("player-name").value.trim();

  if (!name) {
    $("order-status").textContent =
      "Bitte gib deinen Minecraft-Spielernamen ein.";
    return;
  }

  const entries = Object.entries(cart).filter(([id, q]) =>
    products.some(p => String(p.id) === id) && q > 0
  );

  if (!entries.length) {
    $("order-status").textContent = "Dein Warenkorb ist leer.";
    return;
  }

  const lines = entries.map(([id, q]) => {
    const p = products.find(x => String(x.id) === id);
    return `${p.name} x${q} – ${money(unitPrice(p, q) * q)}`;
  });

  const total = entries.reduce((sum, [id, q]) => {
    const p = products.find(x => String(x.id) === id);
    return sum + unitPrice(p, q) * q;
  }, 0);

  const text = `BESTELLANFRAGE BRAT LTD.
Spieler: ${name}
${lines.join("\n")}
Gesamt: ${money(total)}
Hinweis: ${$("order-note").value.trim() || "–"}

Bitte ingame mit Brat Ltd. die Übergabe und Zahlung in KB$ vereinbaren.`;

  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = url;
  a.download = `Brat-Ltd-Bestellung-${name}.txt`;
  a.click();

  URL.revokeObjectURL(url);

  $("order-status").textContent =
    "Bestellanfrage wurde als Textdatei erstellt. Eine automatische Übermittlung erfolgt noch nicht.";
};

// Shop starten
renderCart();
loadProducts();
