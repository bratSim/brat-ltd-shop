const products = [
 {id:1,name:"Stein",category:"Blöcke",desc:"Solider Baustoff für jedes Bauprojekt.",price:2,emoji:"🪨",discounts:[{min:64,price:1.8},{min:256,price:1.5}]},
 {id:2,name:"Eichenholz",category:"Blöcke",desc:"Beliebtes Holz für Häuser und Möbel.",price:5,emoji:"🪵",discounts:[{min:64,price:4.5},{min:256,price:4}]},
 {id:3,name:"Diamant",category:"Items",desc:"Wertvolle Ressource aus der Farmwelt.",price:30,emoji:"💎",discounts:[{min:10,price:27},{min:50,price:24}]},
 {id:4,name:"Obsidian",category:"Blöcke",desc:"Robuster Block für besondere Bauwerke.",price:15,emoji:"🟪",discounts:[{min:32,price:13},{min:128,price:11}]},
 {id:5,name:"Goldener Apfel",category:"Items",desc:"Nützliche Nahrung für Abenteuer.",price:80,emoji:"🍎",discounts:[{min:8,price:72},{min:32,price:65}]},
 {id:6,name:"Diamant-Brustplatte",category:"Rüstung & Waffen",desc:"Diamantrüstung für deinen Schutz.",price:650,emoji:"🛡️",discounts:[{min:2,price:620}]},
 {id:7,name:"Netherit-Schwert",category:"Rüstung & Waffen",desc:"Starke Waffe für den Kampf.",price:1200,emoji:"⚔️",discounts:[{min:2,price:1120}]},
 {id:8,name:"Reparatur (Mending)",category:"Verzauberungen",desc:"Verzauberung für ausgewählte Ausrüstung.",price:350,emoji:"📘",discounts:[{min:4,price:320},{min:10,price:290}]},
 {id:9,name:"Bauauftrag – klein",category:"Dienstleistungen",desc:"Kleinere Bauarbeiten nach Absprache.",price:1500,emoji:"🏗️",discounts:[]},
 {id:10,name:"Terraforming",category:"Dienstleistungen",desc:"Gelände nach deinen Wünschen gestalten.",price:3000,emoji:"🌳",discounts:[]},
 {id:11,name:"Glas",category:"Blöcke",desc:"Klares Glas für Fenster und Fassaden.",price:4,emoji:"🪟",discounts:[{min:64,price:3.5},{min:256,price:3}]},
 {id:12,name:"Redstone-Staub",category:"Items",desc:"Für Schaltungen und technische Projekte.",price:8,emoji:"🔴",discounts:[{min:64,price:7},{min:256,price:6}]}
];
let category="Alle", cart=JSON.parse(localStorage.getItem("bratCart")||"{}");
const $=id=>document.getElementById(id);
function unitPrice(p,q){let price=p.price;for(const d of p.discounts){if(q>=d.min)price=d.price;}return price;}
function money(n){return `${Number(n.toFixed(2)).toLocaleString("de-DE")} KB$`;}
function renderProducts(){
 const query=$("search").value.toLowerCase();
 const shown=products.filter(p=>(category==="Alle"||p.category===category)&&(p.name+" "+p.category+" "+p.desc).toLowerCase().includes(query));
 $("result-count").textContent=`${shown.length} Produkte`;
 $("products").innerHTML=shown.map(p=>`<article class="product-card"><div class="product-visual"><span class="product-tag">${p.category}</span><span class="emoji">${p.emoji}</span></div><div class="product-info"><h3>${p.name}</h3><p>${p.desc}</p><div class="price-row"><div class="price">${money(p.price)} <small>/ Stück</small></div><button class="add-button" aria-label="${p.name} hinzufügen" onclick="addToCart(${p.id})">+</button></div>${p.discounts.length?'<div class="discount-note">↘ Mengenrabatt verfügbar</div>':''}</div></article>`).join("")||'<p class="muted">Keine passenden Produkte gefunden.</p>';
}
function addToCart(id){cart[id]=(cart[id]||0)+1;saveCart();renderCart();openCart();}
function changeQty(id,delta){cart[id]=(cart[id]||0)+delta;if(cart[id]<=0)delete cart[id];saveCart();renderCart();}
function saveCart(){localStorage.setItem("bratCart",JSON.stringify(cart));}
function renderCart(){
 const entries=Object.entries(cart).filter(([id,q])=>products.some(p=>p.id===Number(id))&&q>0);
 let total=0,count=0;
 $("cart-items").innerHTML=entries.length?entries.map(([id,q])=>{const p=products.find(x=>x.id===Number(id)),unit=unitPrice(p,q),sum=unit*q;total+=sum;count+=q;return `<div class="cart-line"><div><strong>${p.name}</strong><small>${money(unit)} pro Stück · ${money(sum)} gesamt</small></div><div class="qty"><button onclick="changeQty(${id},-1)">−</button><b>${q}</b><button onclick="changeQty(${id},1)">+</button></div></div>`}).join(""):'<p class="empty">Dein Warenkorb ist noch leer.</p>';
 $("cart-count").textContent=count;$("cart-total").textContent=money(total);
}
function openCart(){$("cart-panel").classList.add("open");$("overlay").classList.add("show")}
function closeCart(){$("cart-panel").classList.remove("open");$("overlay").classList.remove("show")}
document.querySelectorAll("[data-category]").forEach(el=>el.addEventListener("click",()=>{category=el.dataset.category;document.querySelectorAll(".chip").forEach(c=>c.classList.toggle("active",c.dataset.category===category));renderProducts();}));
$("search").addEventListener("input",renderProducts);$("open-cart").onclick=openCart;$("close-cart").onclick=closeCart;$("overlay").onclick=closeCart;
$("checkout").onclick=()=>{if(!Object.keys(cart).length){$("order-status").textContent="Füge zuerst Produkte zum Warenkorb hinzu.";return;}$("order-modal").classList.add("show");};
$("close-modal").onclick=()=>$("order-modal").classList.remove("show");
$("send-order").onclick=()=>{
 const name=$("player-name").value.trim();if(!name){$("order-status").textContent="Bitte gib deinen Minecraft-Spielernamen ein.";return;}
 const lines=Object.entries(cart).map(([id,q])=>{const p=products.find(x=>x.id===Number(id));return `${p.name} x${q} – ${money(unitPrice(p,q)*q)}`;});
 const total=Object.entries(cart).reduce((s,[id,q])=>{const p=products.find(x=>x.id===Number(id));return s+unitPrice(p,q)*q;},0);
 const text=`BESTELLANFRAGE BRAT LTD.\nSpieler: ${name}\n${lines.join("\n")}\nGesamt: ${money(total)}\nHinweis: ${$("order-note").value.trim()||"–"}\n\nBitte ingame mit Brat Ltd. die Übergabe und Zahlung in KB$ vereinbaren.`;
 const blob=new Blob([text],{type:"text/plain"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=`Brat-Ltd-Bestellung-${name}.txt`;a.click();URL.revokeObjectURL(url);
 $("order-status").textContent="Bestellanfrage wurde als Textdatei erstellt. Sende sie an Brat Ltd. (noch keine automatische Übermittlung).";
};
renderProducts();renderCart();
