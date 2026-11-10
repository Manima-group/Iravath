/* Iravath storefront — vanilla JS SPA.
 * Talks to the FastAPI backend at API_BASE. If the backend isn't reachable (e.g. the page is opened
 * as a static demo), it falls back to an in-browser demo API with the same pricing rules + mock payment. */
(() => {
  "use strict";

  const API_BASE = window.IRAVATH_API_BASE ?? "";
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const inr = (n) => "₹" + Number(n).toLocaleString("en-IN");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ---------- storage (try/catch: some embed contexts block localStorage) ----------
  const mem = {};
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return mem[k] ?? d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { mem[k] = v; } },
  };
  let SID = store.get("irv_sid", null);
  if (!SID) { SID = "s_" + Math.random().toString(36).slice(2) + Date.now().toString(36); store.set("irv_sid", SID); }

  // ---------- API (remote or demo) ----------
  const remote = {
    async req(path, opts = {}) {
      const res = await fetch(API_BASE + path, {
        ...opts,
        headers: { "Content-Type": "application/json", "X-Session-Id": SID, ...(opts.headers || {}) },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const d = data.detail;
        const msg = Array.isArray(d) ? d.map((e) => e.msg.replace(/^Value error, /, "")).join(" · ") : d || "Something went wrong";
        const err = new Error(msg); err.detail = d; throw err;
      }
      return data;
    },
    health: () => remote.req("/api/health"),
    categories: () => remote.req("/api/categories"),
    offers: () => remote.req("/api/offers"),
    products: (p = {}) => remote.req("/api/products?" + new URLSearchParams(Object.entries(p).filter(([, v]) => v !== "" && v != null))),
    product: (slug) => remote.req("/api/products/" + encodeURIComponent(slug)),
    wishlist: () => remote.req("/api/wishlist"),
    wishAdd: (id) => remote.req("/api/wishlist/" + id, { method: "POST" }),
    wishDel: (id) => remote.req("/api/wishlist/" + id, { method: "DELETE" }),
    quote: (body) => remote.req("/api/checkout/quote", { method: "POST", body }),
    createOrder: (body) => remote.req("/api/checkout/orders", { method: "POST", body }),
    mockPay: (rzpOrderId) => remote.req("/api/checkout/mock-pay", { method: "POST", body: { razorpay_order_id: rzpOrderId } }),
    verify: (body) => remote.req("/api/checkout/verify", { method: "POST", body }),
    order: (num) => remote.req("/api/orders/" + encodeURIComponent(num)),
  };

  const D = () => window.IrvDemoDB.db();
  const live = () => D().products.filter((p) => p.is_active !== false);
  const RULES = { free_shipping_threshold: 1999, shipping_fee: 99, cod_advance: 200, cod_max_order_value: 10000 };
  const fail = (m) => { throw new Error(m); };
  const demo = {
    health: async () => ({ ok: true, payments: "mock", ...RULES, demo: true }),
    categories: async () => D().categories,
    offers: async () => D().coupons.filter((c) => c.show_in_banner && IrvDemoDB.couponLive(c)).map(({ code, description }) => ({ code, description })),
    async products({ category, q, sort = "featured", limit = 24 } = {}) {
      let items = live().filter((p) => !category || p.category.slug === category);
      if (q) { const t = q.toLowerCase(); items = items.filter((p) => [p.name, p.fabric, p.color].join(" ").toLowerCase().includes(t)); }
      const cmp = { price_asc: (a, b) => a.price - b.price, price_desc: (a, b) => b.price - a.price, rating: (a, b) => b.rating - a.rating, newest: (a, b) => b.id - a.id }[sort];
      if (cmp) items = [...items].sort(cmp);
      return { items: items.slice(0, limit), total: items.length };
    },
    product: async (slug) => live().find((p) => p.slug === slug) || fail("Product not found"),
    wishlist: async () => store.get("irv_demo_wish", []).map((id) => live().find((p) => p.id === id)).filter(Boolean),
    async wishAdd(id) { const w = store.get("irv_demo_wish", []); if (!w.includes(id)) store.set("irv_demo_wish", [id, ...w]); return { ok: true }; },
    async wishDel(id) { store.set("irv_demo_wish", store.get("irv_demo_wish", []).filter((x) => x !== id)); return { ok: true }; },
    async quote({ items, coupon = "", payment_method = "online" }) {
      const lines = items.map((l) => {
        const p = live().find((x) => x.id === l.product_id) || fail("Product not found");
        if (!(l.size in p.sizes)) fail(`Size ${l.size} not offered`);
        if (p.sizes[l.size] < l.quantity) fail(`Only ${p.sizes[l.size]} left of ${p.name} (${l.size})`);
        return { product_id: p.id, name: p.name, size: l.size, quantity: l.quantity, unit_price: p.price, line_total: p.price * l.quantity };
      });
      const subtotal = lines.reduce((s, l) => s + l.line_total, 0);
      let discount = 0, code = "", msg = "";
      const c = coupon.trim().toUpperCase();
      if (c) {
        const r = D().coupons.find((x) => x.code === c);
        if (!r || !IrvDemoDB.couponLive(r)) msg = "Invalid or expired coupon code";
        else if (subtotal < r.min_subtotal) msg = `${c} needs a subtotal of ${inr(r.min_subtotal)}`;
        else {
          let amt = r.kind === "percent" ? Math.floor((subtotal * r.value) / 100) : r.value;
          if (r.max_discount) amt = Math.min(amt, r.max_discount);
          discount = Math.max(0, Math.min(amt, subtotal)); code = c; msg = r.description || `${c} applied`;
        }
      }
      const after = subtotal - discount;
      const shipping = after >= RULES.free_shipping_threshold ? 0 : RULES.shipping_fee;
      const total = after + shipping;
      const cod_available = total <= RULES.cod_max_order_value && total > RULES.cod_advance;
      if (payment_method === "cod" && !cod_available) fail(`Cash on Delivery is available for orders up to ${inr(RULES.cod_max_order_value)}`);
      const [pay_now, pay_on_delivery] = payment_method === "cod" ? [RULES.cod_advance, total - RULES.cod_advance] : [total, 0];
      return { lines, subtotal, discount, coupon: code, coupon_message: msg, shipping, total, payment_method, pay_now, pay_on_delivery, cod_available };
    },
    async createOrder(body) {
      const q = await demo.quote(body);
      const number = "IRV" + new Date().toISOString().slice(2, 10).replace(/-/g, "") + String(Math.floor(Math.random() * 1e4)).padStart(4, "0");
      const rzp = "order_mock_" + Math.random().toString(16).slice(2, 16);
      const orders = store.get("irv_demo_orders", {});
      orders[number] = { number, status: "pending_payment", payment_method: q.payment_method, customer: body.customer, address: body.address,
        subtotal: q.subtotal, discount: q.discount, shipping: q.shipping, total: q.total, pay_now: q.pay_now, pay_on_delivery: q.pay_on_delivery,
        coupon: q.coupon, razorpay_order_id: rzp, razorpay_payment_id: "",
        items: q.lines.map((l) => ({ name: l.name, size: l.size, unit_price: l.unit_price, quantity: l.quantity })) };
      store.set("irv_demo_orders", orders);
      return { order_number: number, razorpay_order_id: rzp, key_id: "rzp_mock", amount_paise: q.pay_now * 100, currency: "INR", mock: true, quote: q,
        prefill: { name: body.customer.name, email: body.customer.email, contact: body.customer.phone } };
    },
    mockPay: async (rzp) => ({ razorpay_order_id: rzp, razorpay_payment_id: "pay_mock_" + Math.random().toString(16).slice(2, 16), razorpay_signature: "demo" }),
    async verify({ razorpay_order_id, razorpay_payment_id }) {
      const orders = store.get("irv_demo_orders", {});
      const o = Object.values(orders).find((x) => x.razorpay_order_id === razorpay_order_id) || fail("Order not found");
      o.status = o.payment_method === "cod" ? "cod_confirmed" : "paid"; o.razorpay_payment_id = razorpay_payment_id;
      store.set("irv_demo_orders", orders); return o;
    },
    order: async (num) => store.get("irv_demo_orders", {})[num] || fail("Order not found"),
  };

  let api = remote;
  let health = { ...RULES, payments: "mock" };

  // ---------- product art: generated SVG garments (swap for real photography via image_url later) ----------
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const c = (v) => Math.max(0, Math.min(255, v + amt));
    return "#" + [c(n >> 16), c((n >> 8) & 255), c(n & 255)].map((v) => v.toString(16).padStart(2, "0")).join("");
  }
  function art(p, variant = 0) {
    const c = p.color_hex || "#c8b48a", d = shade(c, -28), l = shade(c, 22);
    const bg = ["#efe5d3", "#e9dcc6", "#f3ebdc"][variant % 3];
    const shapes = {
      shirt: `<path d="M140 70 L105 82 L60 118 L78 160 L104 148 L104 330 L296 330 L296 148 L322 160 L340 118 L295 82 L260 70 Q200 98 140 70Z" fill="${c}"/>
        <path d="M140 70 Q200 98 260 70 L246 66 Q200 86 154 66Z" fill="${d}"/><path d="M200 92 L200 330" stroke="${d}" stroke-width="2"/>
        ${[120, 160, 200, 240, 280].map((y) => `<circle cx="200" cy="${y}" r="3.2" fill="${l}"/>`).join("")}
        <path d="M154 66 L176 108 L200 92 L224 108 L246 66" fill="${l}" opacity=".55"/>`,
      kurta: `<path d="M150 66 L110 80 L66 130 L86 168 L112 152 L106 350 L294 350 L288 152 L314 168 L334 130 L290 80 L250 66 Q200 86 150 66Z" fill="${c}"/>
        <path d="M200 76 L200 160" stroke="${d}" stroke-width="2.5"/>${[100, 122, 144].map((y) => `<circle cx="200" cy="${y}" r="3" fill="${l}"/>`).join("")}
        <path d="M150 66 Q200 86 250 66 L240 62 Q200 78 160 62Z" fill="${d}"/>
        <path d="M120 300 Q200 320 280 300" stroke="${l}" stroke-width="3" fill="none" opacity=".7"/><path d="M118 315 Q200 335 282 315" stroke="${l}" stroke-width="2" fill="none" opacity=".5"/>`,
      trouser: `<path d="M138 60 L262 60 L270 350 L216 350 L200 140 L184 350 L130 350Z" fill="${c}"/><rect x="138" y="60" width="124" height="18" fill="${d}"/>
        <path d="M170 80 L176 200 M230 80 L224 200" stroke="${d}" stroke-width="1.6"/>`,
      tee: `<path d="M145 72 L100 88 L62 132 L92 160 L112 146 L112 330 L288 330 L288 146 L308 160 L338 132 L300 88 L255 72 Q200 104 145 72Z" fill="${c}"/>
        <path d="M145 72 Q200 104 255 72" stroke="${d}" stroke-width="6" fill="none"/>`,
      jacket: `<path d="M148 64 L104 80 L72 128 L88 300 L118 300 L118 340 L282 340 L282 300 L312 300 L328 128 L296 80 L252 64 L200 80Z" fill="${c}"/>
        <path d="M200 80 L200 340" stroke="${d}" stroke-width="2.5"/><path d="M168 66 L200 80 L232 66 L232 52 L168 52Z" fill="${d}"/>
        ${[110, 150, 190, 230, 270, 310].map((y) => `<circle cx="210" cy="${y}" r="4" fill="#d9b25f" stroke="#8c6b2a"/>`).join("")}`,
      square: `<g transform="rotate(-8 200 200)"><rect x="110" y="110" width="180" height="180" fill="${c}"/>
        <rect x="124" y="124" width="152" height="152" fill="none" stroke="${l}" stroke-width="3"/>
        ${[0, 1, 2].map((i) => `<path d="M${160 + i * 40} 170 q14 -26 22 0 q-8 30 -22 0" fill="${d}"/><path d="M${160 + i * 40} 240 q14 -26 22 0 q-8 30 -22 0" fill="${d}"/>`).join("")}</g>`,
      belt: `<path d="M70 230 Q200 150 330 230" stroke="${c}" stroke-width="34" fill="none" stroke-linecap="round"/>
        <rect x="178" y="166" width="48" height="44" rx="4" fill="none" stroke="#c9a14e" stroke-width="7"/>`,
    };
    const shape = shapes[p.silhouette] || shapes.shirt;
    const zoom = variant === 1 ? 'transform="translate(-120 -60) scale(1.6)"' : variant === 2 ? 'transform="translate(30 20) scale(.85)"' : "";
    return `<svg viewBox="0 0 400 400" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${esc(p.name)}">
      <rect width="400" height="400" fill="${bg}"/><ellipse cx="200" cy="360" rx="130" ry="14" fill="#000" opacity=".06"/><g ${zoom}>${shape}</g></svg>`;
  }

  // Real product photos (uploaded from the admin panel) win; the generated art is the fallback.
  const imgUrl = (u) => (u && u.startsWith("/media/") ? API_BASE + u : u);
  function media(p, variant = 0, cls = "") {
    const imgs = p.images || (p.image ? [p.image] : []);
    if (!imgs.length) return art(p, variant);
    const src = imgs[Math.min(variant, imgs.length - 1)];
    const alt = imgs[variant + 1] && cls === "hover" ? `<img class="ph alt" src="${esc(imgUrl(imgs[variant + 1]))}" alt="" loading="lazy">` : "";
    return `<img class="ph" src="${esc(imgUrl(src))}" alt="${esc(p.name)}" loading="lazy">${alt}`;
  }

  // ---------- state ----------
  const cart = {
    items: store.get("irv_cart", []), // {product_id, size, quantity, snapshot:{name, price, slug, color_hex, silhouette}}
    save() { store.set("irv_cart", this.items); renderCartCount(); },
    add(p, size, qty = 1) {
      const ex = this.items.find((i) => i.product_id === p.id && i.size === size);
      const max = p.sizes[size] ?? 10;
      if (ex) ex.quantity = Math.min(ex.quantity + qty, max, 10);
      else this.items.push({ product_id: p.id, size, quantity: Math.min(qty, max), snapshot: { name: p.name, price: p.price, slug: p.slug, color_hex: p.color_hex, silhouette: p.silhouette, image: (p.images || [])[0] || "" } });
      this.save();
    },
    set(idx, qty) { if (qty <= 0) this.items.splice(idx, 1); else this.items[idx].quantity = Math.min(qty, 10); this.save(); },
    clear() { this.items = []; this.save(); },
    count() { return this.items.reduce((s, i) => s + i.quantity, 0); },
    subtotal() { return this.items.reduce((s, i) => s + i.snapshot.price * i.quantity, 0); },
    lines() { return this.items.map(({ product_id, size, quantity }) => ({ product_id, size, quantity })); },
  };
  let wishIds = new Set();
  let categories = [];

  async function loadWish() {
    try { wishIds = new Set((await api.wishlist()).map((p) => p.id)); } catch { wishIds = new Set(); }
    renderWishCount();
  }
  async function toggleWish(id, btn) {
    const on = wishIds.has(id);
    try {
      if (on) { await api.wishDel(id); wishIds.delete(id); toast("Removed from wishlist"); }
      else { await api.wishAdd(id); wishIds.add(id); toast("Saved to wishlist ♥"); }
    } catch (e) { return toast(e.message); }
    $$(`.heart[data-id="${id}"]`).forEach((b) => { b.classList.toggle("on", !on); b.setAttribute("aria-pressed", String(!on)); });
    renderWishCount();
    if (location.hash.startsWith("#/wishlist")) route();
  }
  const setCount = (el, n) => { el.textContent = n || ""; n ? el.removeAttribute("data-zero") : el.setAttribute("data-zero", ""); };
  function renderWishCount() { setCount($("#wish-count"), wishIds.size); }
  function renderCartCount() { setCount($("#cart-count"), cart.count()); }

  let toastTimer;
  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 2400); }

  // ---------- components ----------
  const heartSvg = `<svg viewBox="0 0 24 24"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.3 3.1 4.5 6.9 4.5c2.1 0 3.6 1.1 5.1 3 1.5-1.9 3-3 5.1-3 3.8 0 6 3.8 4.5 7.3C19.5 16.4 12 21 12 21z"/></svg>`;
  const off = (p) => Math.round((1 - p.price / p.mrp) * 100);
  const stars = (p) => `<div class="stars">${"★".repeat(Math.round(p.rating))}${"☆".repeat(5 - Math.round(p.rating))}<span>${p.rating} (${p.reviews})</span></div>`;
  const priceHtml = (p) => `<div class="price"><b>${inr(p.price)}</b>${p.mrp > p.price ? `<s>${inr(p.mrp)}</s><em>${off(p)}% off</em>` : ""}</div>`;
  const firstSize = (p) => Object.entries(p.sizes).find(([, n]) => n > 0)?.[0];

  function card(p) {
    const on = wishIds.has(p.id);
    return `<article class="card">
      <a class="media" href="#/product/${p.slug}">${p.badge ? `<span class="badge">${esc(p.badge)}</span>` : ""}${media(p, 0, "hover")}</a>
      <button class="heart ${on ? "on" : ""}" data-action="wish" data-id="${p.id}" aria-pressed="${on}" aria-label="Wishlist ${esc(p.name)}">${heartSvg}</button>
      <div class="info"><div class="cat">${esc(p.category.name)}</div><a class="name" href="#/product/${p.slug}">${esc(p.name)}</a>${priceHtml(p)}${stars(p)}</div>
    </article>`;
  }
  // Branded loader: the Iravath elephant with a gold shimmer, used everywhere instead of spinners/skeletons.
  const loader = (size = "", label = "Loading") => `<div class="brand-loader ${size}" role="status" aria-label="${label}" style="grid-column:1/-1"><i class="mark"></i></div>`;
  function busy(text) {
    const b = $("#busy");
    if (text) { $("#busy-text").textContent = text; b.hidden = false; } else b.hidden = true;
  }

  // ---------- views ----------
  const app = $("#app");
  const views = {
    async home() {
      const [best, all] = await Promise.all([api.products({ sort: "rating", limit: 8 }), api.products({ limit: 100 })]);
      const pick = (slug) => all.items.find((p) => p.slug === slug) || all.items[0];
      const heroA = pick("gold-chikankari-kurta"), heroB = pick("ivory-linen-shirt"), heroC = pick("navy-nehru-jacket");
      const catArt = (slug) => all.items.find((p) => p.category.slug === slug);
      app.innerHTML = `
        <div class="wrap">
          <section class="hero">
            <div>
              <div class="eyebrow">The Festive Edit · 2026</div>
              <h1>Quiet luxury,<br>woven in India.</h1>
              <p>Linen shirts, hand-embroidered kurtas and tailored essentials in natural fabrics. Cut for Indian summers, finished to last for years.</p>
              <div class="cta"><a class="btn" href="#/shop">Shop the collection</a><a class="btn ghost" href="#/shop?category=kurtas">Explore kurtas</a></div>
            </div>
            <div class="hero-art"><div>${media(heroA)}</div><div>${media(heroB, 2)}</div><div>${media(heroC, 2)}</div></div>
          </section>
        </div>
        <div class="wrap usp">
          <div><b>Natural fabrics</b>Linen, mul, handloom</div><div><b>Free shipping</b>On orders over ${inr(health.free_shipping_threshold)}</div>
          <div><b>COD available</b>${inr(health.cod_advance)} advance, rest on delivery</div><div><b>7-day exchange</b>Size swaps, no fuss</div>
        </div>
        <section class="block wrap">
          <div class="section-head"><div><div class="eyebrow">Shop by category</div><h2>Find your fit</h2></div></div>
          <div class="cat-grid">${categories.map((c) => { const p = catArt(c.slug); return `<a class="cat-tile" href="#/shop?category=${c.slug}"><div class="art">${p ? media(p, 0) : ""}</div><b>${esc(c.name)}</b></a>`; }).join("")}</div>
        </section>
        <section class="block wrap">
          <div class="section-head"><div><div class="eyebrow">Most loved</div><h2>Bestsellers</h2></div><a class="link" href="#/shop?sort=rating">View all</a></div>
          <div class="grid">${best.items.map(card).join("")}</div>
        </section>
        <section class="block wrap" style="text-align:center;max-width:640px">
          <div class="eyebrow">Iravath circle</div><h2>10% off your first order</h2>
          <p class="small">Use code <b>IRAVATH10</b> at checkout. New arrivals and early access to festive drops, once a fortnight.</p>
        </section>`;
    },

    async shop(params) {
      const category = params.get("category") || "", sort = params.get("sort") || "featured", q = params.get("q") || "";
      const cat = categories.find((c) => c.slug === category);
      app.innerHTML = `<div class="wrap"><div class="page-head"><div class="crumbs"><a href="#/">Home</a> / Shop${cat ? " / " + esc(cat.name) : ""}</div>
        <h1>${q ? `Results for “${esc(q)}”` : cat ? esc(cat.name) : "All menswear"}</h1>${cat ? `<p class="small">${esc(cat.blurb)}</p>` : ""}</div>
        <div class="toolbar"><div class="chips">
          <a class="chip ${!category ? "on" : ""}" href="#/shop${sort !== "featured" ? "?sort=" + sort : ""}">All</a>
          ${categories.map((c) => `<a class="chip ${c.slug === category ? "on" : ""}" href="#/shop?category=${c.slug}${sort !== "featured" ? "&sort=" + sort : ""}">${esc(c.name)}</a>`).join("")}
        </div>
        <label class="small">Sort <select id="sort">${[["featured", "Featured"], ["newest", "Newest"], ["rating", "Top rated"], ["price_asc", "Price: low to high"], ["price_desc", "Price: high to low"]]
          .map(([v, t]) => `<option value="${v}" ${v === sort ? "selected" : ""}>${t}</option>`).join("")}</select></label></div>
        <div id="results">${loader()}</div></div>`;
      $("#sort").onchange = (e) => { const p = new URLSearchParams(params); p.set("sort", e.target.value); location.hash = "#/shop?" + p; };
      const { items, total } = await api.products({ category, sort, q, limit: 100 });
      $("#results").innerHTML = items.length
        ? `<p class="small" style="margin-top:-12px">${total} product${total === 1 ? "" : "s"}</p><div class="grid">${items.map(card).join("")}</div>`
        : `<div class="empty"><h2>Nothing found</h2><p>Try a different search or browse all products.</p><a class="btn" href="#/shop">Browse all</a></div>`;
    },

    async product(slug) {
      const p = await api.product(slug);
      let size = firstSize(p), qty = 1;
      const on = wishIds.has(p.id);
      document.title = `${p.name} — Iravath`;
      app.innerHTML = `<div class="wrap"><div class="crumbs" style="padding-top:26px"><a href="#/">Home</a> / <a href="#/shop?category=${p.category.slug}">${esc(p.category.name)}</a> / ${esc(p.name)}</div>
        <div class="pdp"><div class="pdp-media">${(p.images && p.images.length ? p.images.map((_, i) => `<div>${media(p, i)}</div>`) : [0, 1, 2].map((i) => `<div>${art(p, i)}</div>`)).join("")}</div>
        <div class="pdp-info"><div class="eyebrow">${esc(p.category.name)}${p.badge ? " · " + esc(p.badge) : ""}</div><h1>${esc(p.name)}</h1>${stars(p)}${priceHtml(p)}
          <p class="small">Inclusive of all taxes · ${p.price - (health.cod_advance || 200) > 0 ? `or pay ${inr(health.cod_advance)} now with COD` : ""}</p>
          <p>${esc(p.description)}</p>
          <div style="margin-top:18px"><b>Size</b> <span class="small" id="stock"></span></div>
          <div class="sizes">${Object.entries(p.sizes).map(([s, n]) => `<button class="size ${s === size ? "on" : ""}" data-size="${s}" ${n <= 0 ? "disabled" : ""}>${s}</button>`).join("")}</div>
          <div class="qty" aria-label="Quantity"><button data-q="-1" aria-label="Decrease">−</button><span id="qty">1</span><button data-q="1" aria-label="Increase">+</button></div>
          <div class="buy-row"><button class="btn" id="add" ${size ? "" : "disabled"}>${size ? "Add to bag" : "Sold out"}</button>
            <button class="btn gold" id="buy" ${size ? "" : "disabled"}>Buy now</button>
            <button class="btn ghost heart-inline" data-action="wish" data-id="${p.id}" aria-label="Wishlist">${on ? "♥ Saved" : "♡ Wishlist"}</button></div>
          <div class="details">
            <details open><summary>Fabric &amp; care</summary><p>${esc(p.fabric)} · Colour: ${esc(p.color)}<br>Gentle machine wash cold, dry in shade, warm iron.</p></details>
            <details><summary>Shipping &amp; COD</summary><p>Free shipping above ${inr(health.free_shipping_threshold)}, otherwise ${inr(health.shipping_fee)}. Dispatch in 24–48 hours. Cash on Delivery: pay ${inr(health.cod_advance)} online to confirm, balance on delivery.</p></details>
            <details><summary>Exchanges</summary><p>Free size exchange within 7 days of delivery. Items must be unworn with tags.</p></details>
          </div></div></div>
        <section class="block"><div class="section-head"><h2>You may also like</h2></div><div class="grid" id="related">${loader()}</div></section></div>`;
      const showStock = () => { const n = p.sizes[size] ?? 0; $("#stock").className = "stock " + (n <= 5 ? "low" : "in"); $("#stock").textContent = size ? (n <= 5 ? `· Only ${n} left` : "· In stock") : ""; };
      showStock();
      $$(".size", app).forEach((b) => (b.onclick = () => { size = b.dataset.size; $$(".size", app).forEach((x) => x.classList.toggle("on", x === b)); qty = 1; $("#qty").textContent = 1; showStock(); }));
      $$(".qty button", app).forEach((b) => (b.onclick = () => { qty = Math.max(1, Math.min(qty + Number(b.dataset.q), p.sizes[size] || 1, 10)); $("#qty").textContent = qty; }));
      $("#add").onclick = () => { cart.add(p, size, qty); openCart(); };
      $("#buy").onclick = () => { cart.add(p, size, qty); location.hash = "#/checkout"; };
      const rel = await api.products({ category: p.category.slug, limit: 5 });
      let others = rel.items.filter((x) => x.id !== p.id);
      if (others.length < 4) others = others.concat((await api.products({ sort: "rating", limit: 8 })).items.filter((x) => x.id !== p.id && !others.some((o) => o.id === x.id)));
      $("#related").innerHTML = others.slice(0, 4).map(card).join("");
    },

    async wishlist() {
      const items = await api.wishlist();
      wishIds = new Set(items.map((p) => p.id)); renderWishCount();
      app.innerHTML = `<div class="wrap"><div class="page-head"><div class="crumbs"><a href="#/">Home</a> / Wishlist</div><h1>My wishlist</h1></div>
        ${items.length ? `<table class="wish-table"><thead><tr><th>Product</th><th>Unit price</th><th>Stock status</th><th></th><th></th></tr></thead><tbody>
          ${items.map((p) => { const s = firstSize(p); return `<tr>
            <td><div class="wish-prod"><a class="thumb" href="#/product/${p.slug}">${media(p)}</a><div><a href="#/product/${p.slug}">${esc(p.name)}</a><div class="small">${esc(p.color)} · ${esc(p.fabric)}</div></div></div></td>
            <td>${priceHtml(p)}</td>
            <td class="stock ${s ? "in" : "low"}">${s ? "In stock" : "Out of stock"}</td>
            <td><select class="wsize" data-id="${p.id}" aria-label="Size">${Object.entries(p.sizes).map(([k, n]) => `<option ${n <= 0 ? "disabled" : ""} ${k === s ? "selected" : ""}>${k}</option>`).join("")}</select>
              <button class="btn" style="padding:9px 14px" data-action="wish-to-cart" data-id="${p.id}" ${s ? "" : "disabled"}>Add to bag</button></td>
            <td><button class="remove" data-action="wish" data-id="${p.id}" aria-label="Remove ${esc(p.name)}">✕</button></td></tr>`; }).join("")}
          </tbody></table>
          <div class="wish-actions"><button class="btn ghost" data-action="wish-all-to-cart">Add all to bag</button><button class="btn ghost" data-action="share-wish">Share wishlist</button></div>`
        : `<div class="empty"><h2>Your wishlist is empty</h2><p>Tap the ♡ on anything you like and it will wait for you here.</p><a class="btn" href="#/shop">Start shopping</a></div>`}</div>`;
      app._wishItems = items;
    },

    async checkout() {
      if (!cart.items.length) { app.innerHTML = `<div class="wrap empty"><h2>Your bag is empty</h2><a class="btn" href="#/shop">Continue shopping</a></div>`; return; }
      const saved = store.get("irv_customer", {});
      const f = (id, label, type = "text", full = false, extra = "") =>
        `<label class="field ${full ? "full" : ""}">${label}<input id="${id}" type="${type}" value="${esc(saved[id] || "")}" ${extra}><span class="err" data-for="${id}"></span></label>`;
      app.innerHTML = `<div class="wrap"><div class="page-head"><div class="crumbs"><a href="#/">Home</a> / Checkout</div><h1>Checkout</h1></div>
        <div class="checkout"><form id="co-form" novalidate>
          <div class="panel"><h3>Contact</h3><div class="fields">${f("name", "Full name", "text", true, 'autocomplete="name" required')}${f("email", "Email", "email", false, 'autocomplete="email" required')}${f("phone", "Mobile number", "tel", false, 'autocomplete="tel" inputmode="numeric" placeholder="10-digit mobile" required')}</div></div>
          <div class="panel"><h3>Delivery address</h3><div class="fields">${f("line1", "House / flat, street", "text", true, 'autocomplete="address-line1" required')}${f("line2", "Area, landmark (optional)", "text", true, 'autocomplete="address-line2"')}
            ${f("city", "City", "text", false, 'autocomplete="address-level2" required')}${f("state", "State", "text", false, 'autocomplete="address-level1" required')}${f("pincode", "PIN code", "text", false, 'inputmode="numeric" maxlength="6" autocomplete="postal-code" required')}</div></div>
          <div class="panel"><h3>Payment</h3>
            <label class="pay-opt"><input type="radio" name="pm" value="online" checked><div><b>Pay online</b><span class="small">UPI, cards, net banking, wallets via Razorpay</span></div></label>
            <label class="pay-opt" id="cod-opt"><input type="radio" name="pm" value="cod"><div><b>Cash on Delivery</b><span class="small">Pay ${inr(health.cod_advance)} online now to confirm, balance in cash/UPI on delivery</span></div></label>
            ${health.payments === "mock" ? `<p class="small">⚠︎ Test mode: payments are simulated. Add Razorpay keys on the server to go live.</p>` : ""}
          </div></form>
          <aside class="panel summary" id="summary"><h3>Order summary</h3>${loader("", "Calculating totals")}</aside></div></div>`;
      const state = { coupon: store.get("irv_coupon", ""), pm: "online", quote: null };
      const renderSummary = async () => {
        const box = $("#summary");
        let q;
        try { q = await api.quote({ items: cart.lines(), coupon: state.coupon, payment_method: state.pm }); }
        catch (e) {
          if (state.pm === "cod") { state.pm = "online"; $('input[value="online"]').checked = true; toast(e.message); return renderSummary(); }
          box.innerHTML = `<h3>Order summary</h3><p class="coupon-msg bad">${esc(e.message)}</p><a class="link" data-action="open-cart">Edit bag</a>`; return;
        }
        state.quote = q;
        $("#cod-opt").classList.toggle("disabled", !q.cod_available);
        box.innerHTML = `<h3>Order summary</h3>
          ${q.lines.map((l) => { const it = cart.items.find((i) => i.product_id === l.product_id && i.size === l.size); return `<div class="line" style="grid-template-columns:56px 1fr auto"><div class="thumb">${media({ ...it.snapshot, name: l.name })}</div><div><div class="nm" style="font-size:16px">${esc(l.name)}</div><div class="meta">Size ${esc(l.size)} · Qty ${l.quantity}</div></div><b>${inr(l.line_total)}</b></div>`; }).join("")}
          <div class="coupon"><input id="coupon" placeholder="Coupon code" value="${esc(state.coupon)}" aria-label="Coupon code"><button class="btn ghost" type="button" id="apply">${q.coupon ? "Remove" : "Apply"}</button></div>
          <div class="coupon-msg ${q.coupon ? "ok" : q.coupon_message ? "bad" : ""}">${esc(q.coupon_message || "Try IRAVATH10 or WELCOME200")}</div>
          <div style="margin-top:12px"><div class="row"><span>Subtotal</span><span>${inr(q.subtotal)}</span></div>
          ${q.discount ? `<div class="row" style="color:var(--ok)"><span>Discount (${esc(q.coupon)})</span><span>−${inr(q.discount)}</span></div>` : ""}
          <div class="row"><span>Shipping</span><span>${q.shipping ? inr(q.shipping) : "Free"}</span></div>
          <div class="row total"><span>Total</span><span>${inr(q.total)}</span></div></div>
          ${q.payment_method === "cod" ? `<div class="cod-note"><div class="row"><span>Pay now (online)</span><b>${inr(q.pay_now)}</b></div><div class="row"><span>Pay on delivery</span><b>${inr(q.pay_on_delivery)}</b></div></div>` : ""}
          <button class="btn gold block" id="pay" style="margin-top:16px">Pay ${inr(q.pay_now)} securely</button>
          <div class="secure">🔒 256-bit secured · Razorpay</div>`;
        $("#apply").onclick = () => { state.coupon = q.coupon ? "" : $("#coupon").value.trim(); store.set("irv_coupon", state.coupon); renderSummary(); };
        $("#coupon").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); $("#apply").click(); } };
        $("#pay").onclick = () => placeOrder(state);
      };
      $$('input[name="pm"]').forEach((r) => (r.onchange = () => { state.pm = r.value; renderSummary(); }));
      renderSummary();
    },

    async order(num) {
      const o = await api.order(num);
      const paid = o.status === "paid" || o.status === "cod_confirmed";
      app.innerHTML = `<div class="wrap success">
        <div class="tick" style="${paid ? "" : "background:var(--sale)"}">${paid ? "✓" : "!"}</div>
        <h1>${paid ? "Thank you, " + esc(o.customer.name.split(" ")[0]) + "!" : "Payment pending"}</h1>
        <p>${paid ? `Your order <b>${esc(o.number)}</b> is confirmed. We'll send updates to ${esc(o.customer.email)}.` : `Order ${esc(o.number)} is awaiting payment.`}</p>
        <div class="panel"><h3>Order ${esc(o.number)}</h3>
          ${o.items.map((i) => `<div class="row"><span>${esc(i.name)} · ${esc(i.size)} × ${i.quantity}</span><span>${inr(i.unit_price * i.quantity)}</span></div>`).join("")}
          <div class="row total"><span>Total</span><span>${inr(o.total)}</span></div>
          <div class="row"><span>Paid online</span><span>${paid ? inr(o.pay_now) : inr(0)}</span></div>
          ${o.payment_method === "cod" ? `<div class="row"><b>Due on delivery</b><b>${inr(o.pay_on_delivery)}</b></div>` : ""}
          <p class="small" style="margin-top:14px">Ship to: ${esc(o.address.line1)}${o.address.line2 ? ", " + esc(o.address.line2) : ""}, ${esc(o.address.city)}, ${esc(o.address.state)} ${esc(o.address.pincode)}<br>Payment ref: ${esc(o.razorpay_payment_id || "—")}</p></div>
        <a class="btn" href="#/shop" style="margin-top:22px">Continue shopping</a></div>`;
    },

    page(slug) {
      const pages = {
        shipping: ["Shipping & COD", `Free shipping on orders above ${inr(health.free_shipping_threshold)}; ${inr(health.shipping_fee)} otherwise. Orders dispatch in 24–48 hours and arrive in 3–6 working days across India.<br><br><b>Cash on Delivery:</b> pay ${inr(health.cod_advance)} online at checkout to confirm the order. The balance is collected on delivery. COD is available on orders up to ${inr(health.cod_max_order_value)}.`],
        returns: ["Returns & exchanges", "Free size exchanges within 7 days of delivery. Products must be unworn, unwashed and with tags attached. Online-paid orders can be refunded to the original payment method within 5–7 working days."],
        contact: ["Contact us", "Hyderabad, Telangana · Write to us and we reply within one working day."],
      };
      const [t, b] = pages[slug] || ["Not found", "This page doesn't exist."];
      app.innerHTML = `<div class="wrap" style="max-width:760px;padding:50px 0 70px"><h1>${t}</h1><p>${b}</p></div>`;
    },
  };

  // ---------- checkout + payment ----------
  const FIELDS = ["name", "email", "phone", "line1", "line2", "city", "state", "pincode"];
  function validate() {
    const v = Object.fromEntries(FIELDS.map((k) => [k, $("#" + k).value.trim()]));
    const errs = {};
    if (v.name.length < 2) errs.name = "Enter your name";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email)) errs.email = "Enter a valid email";
    if (!/^[6-9]\d{9}$/.test(v.phone.replace(/\D/g, "").slice(-10))) errs.phone = "Enter a valid 10-digit mobile";
    if (v.line1.length < 3) errs.line1 = "Enter your address";
    if (v.city.length < 2) errs.city = "Enter city";
    if (v.state.length < 2) errs.state = "Enter state";
    if (!/^[1-9]\d{5}$/.test(v.pincode)) errs.pincode = "6-digit PIN code";
    FIELDS.forEach((k) => { $("#" + k).classList.toggle("invalid", !!errs[k]); const e = $(`.err[data-for="${k}"]`); if (e) e.textContent = errs[k] || ""; });
    const first = Object.keys(errs)[0];
    if (first) { $("#" + first).focus(); return null; }
    store.set("irv_customer", v);
    return v;
  }

  async function placeOrder(state) {
    const v = validate();
    if (!v) return toast("Please check the highlighted fields");
    const btn = $("#pay"); btn.disabled = true;
    busy("Creating your order…");
    try {
      const order = await api.createOrder({
        items: cart.lines(), coupon: state.coupon, payment_method: state.pm,
        customer: { name: v.name, email: v.email, phone: v.phone },
        address: { line1: v.line1, line2: v.line2, city: v.city, state: v.state, pincode: v.pincode },
      });
      busy();
      const result = order.mock ? await mockCheckout(order) : await razorpayCheckout(order);
      busy("Confirming your payment…");
      await api.verify(result);
      cart.clear(); store.set("irv_coupon", "");
      location.hash = "#/order/" + order.order_number;
      setTimeout(() => busy(), 600);
    } catch (e) {
      busy();
      toast(e.message || "Payment was not completed");
      btn.disabled = false; btn.textContent = "Try payment again";
    }
  }

  function loadScript(src) {
    return new Promise((res, rej) => { if ($(`script[src="${src}"]`)) return res(); const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("Could not load Razorpay")); document.head.appendChild(s); });
  }
  async function razorpayCheckout(order) {
    await loadScript("https://checkout.razorpay.com/v1/checkout.js");
    return new Promise((resolve, reject) => {
      const rzp = new window.Razorpay({
        key: order.key_id, amount: order.amount_paise, currency: order.currency, order_id: order.razorpay_order_id,
        name: "Iravath", description: order.quote.payment_method === "cod" ? `COD advance · ${order.order_number}` : `Order ${order.order_number}`,
        prefill: order.prefill, notes: { order_number: order.order_number }, theme: { color: "#b08a3e" },
        handler: (resp) => resolve(resp),
        modal: { ondismiss: () => reject(new Error("Payment cancelled")) },
      });
      rzp.on("payment.failed", (r) => reject(new Error(r.error?.description || "Payment failed")));
      rzp.open();
    });
  }
  function mockCheckout(order) {
    const m = $("#modal");
    m.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true" aria-label="Test payment">
      <header><b>Iravath</b><small>${esc(order.order_number)} · Test mode</small><div style="font-size:26px;margin-top:6px">${inr(order.amount_paise / 100)}</div></header>
      <div class="body"><div class="methods"><div>UPI</div><div>Card</div><div>NetBanking</div></div>
        <p class="small">This is a simulated Razorpay checkout. With live keys, the real Razorpay window opens here.</p>
        <button class="btn gold block" id="mock-ok">Simulate successful payment</button><button class="btn ghost block" id="mock-cancel">Cancel</button></div></div>`;
    m.hidden = false;
    return new Promise((resolve, reject) => {
      $("#mock-ok").onclick = async () => { $("#mock-ok").disabled = true; try { resolve(await api.mockPay(order.razorpay_order_id)); } catch (e) { reject(e); } m.hidden = true; };
      $("#mock-cancel").onclick = () => { m.hidden = true; reject(new Error("Payment cancelled")); };
    });
  }

  // ---------- cart drawer ----------
  function openCart() { renderCart(); document.body.classList.add("cart-open"); }
  function closeCart() { document.body.classList.remove("cart-open"); }
  function renderCart() {
    const body = $("#cart-body"), foot = $("#cart-foot");
    if (!cart.items.length) {
      body.innerHTML = `<div class="empty" style="padding:50px 0"><h3>Your bag is empty</h3><p class="small">Add something you love.</p></div>`;
      foot.innerHTML = `<a class="btn block" href="#/shop" data-action="close-cart">Shop now</a>`; return;
    }
    body.innerHTML = cart.items.map((i, idx) => `<div class="line"><a class="thumb" href="#/product/${i.snapshot.slug}" data-action="close-cart">${media(i.snapshot)}</a>
      <div><div class="nm">${esc(i.snapshot.name)}</div><div class="meta">Size ${esc(i.size)} · ${inr(i.snapshot.price)}</div>
      <div class="qty"><button data-action="qty" data-idx="${idx}" data-d="-1" aria-label="Decrease">−</button><span>${i.quantity}</span><button data-action="qty" data-idx="${idx}" data-d="1" aria-label="Increase">+</button></div></div>
      <div style="text-align:right"><b>${inr(i.snapshot.price * i.quantity)}</b><br><button class="link small" data-action="qty" data-idx="${idx}" data-d="-999">Remove</button></div></div>`).join("");
    const sub = cart.subtotal(), need = health.free_shipping_threshold - sub;
    foot.innerHTML = `<div class="ship-meter">${need > 0 ? `Add <b>${inr(need)}</b> more for free shipping` : "🎉 You've unlocked free shipping"}<div class="bar"><i style="width:${Math.min(100, (sub / health.free_shipping_threshold) * 100)}%"></i></div></div>
      <div class="row total" style="border:0;margin:0"><span>Subtotal</span><span>${inr(sub)}</span></div><p class="small" style="margin:2px 0 12px">Coupons and shipping calculated at checkout.</p>
      <a class="btn gold block" href="#/checkout" data-action="close-cart">Checkout</a>`;
  }

  // ---------- events ----------
  document.addEventListener("click", async (e) => {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    const a = el.dataset.action;
    if (a === "wish") { e.preventDefault(); toggleWish(Number(el.dataset.id), el); if (el.classList.contains("heart-inline")) el.textContent = wishIds.has(Number(el.dataset.id)) ? "♡ Wishlist" : "♥ Saved"; }
    else if (a === "open-cart") openCart();
    else if (a === "close-cart") closeCart();
    else if (a === "toggle-menu") document.body.classList.toggle("menu-open");
    else if (a === "qty") { const i = cart.items[el.dataset.idx]; cart.set(Number(el.dataset.idx), i.quantity + Number(el.dataset.d)); renderCart(); if (location.hash === "#/checkout") route(); }
    else if (a === "wish-to-cart") {
      const p = app._wishItems.find((x) => x.id === Number(el.dataset.id)); const size = $(`.wsize[data-id="${p.id}"]`).value;
      cart.add(p, size, 1); toast(`${p.name} (${size}) added to bag`); renderCart();
    } else if (a === "wish-all-to-cart") {
      let n = 0; app._wishItems.forEach((p) => { const s = $(`.wsize[data-id="${p.id}"]`)?.value; if (s && p.sizes[s] > 0) { cart.add(p, s, 1); n++; } });
      toast(`${n} item${n === 1 ? "" : "s"} added to bag`); openCart();
    } else if (a === "share-wish") {
      const text = "My Iravath wishlist:\n" + app._wishItems.map((p) => `• ${p.name} — ${inr(p.price)}`).join("\n");
      try { if (navigator.share) await navigator.share({ title: "My Iravath wishlist", text }); else { await navigator.clipboard.writeText(text); toast("Wishlist copied"); } } catch { /* user cancelled */ }
    }
  });
  $("#search-form").addEventListener("submit", (e) => { e.preventDefault(); const q = e.target.q.value.trim(); location.hash = q ? "#/shop?q=" + encodeURIComponent(q) : "#/shop"; });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeCart(); });

  // Announcement bar: live offers from the admin panel rotate with the standard shipping/COD message.
  function renderOffers(offers) {
    const bar = $(".announce");
    const base = bar.innerHTML;
    const msgs = offers.map((o) => `${esc(o.description || "Special offer")} · Use code <b>${esc(o.code)}</b>`);
    if (!msgs.length) return;
    const all = [...msgs, base];
    let i = 0;
    bar.innerHTML = all[0];
    if (all.length > 1) setInterval(() => { i = (i + 1) % all.length; bar.classList.add("swap"); setTimeout(() => { bar.innerHTML = all[i]; bar.classList.remove("swap"); }, 250); }, 4500);
  }

  // ---------- router ----------
  async function route() {
    const [path, qs] = (location.hash.slice(1) || "/").split("?");
    const parts = path.split("/").filter(Boolean);
    const params = new URLSearchParams(qs || "");
    document.body.classList.remove("menu-open");
    document.title = "Iravath — Considered menswear";
    $$("#main-nav a").forEach((a) => a.classList.toggle("active", a.getAttribute("href") === location.hash));
    // If a page takes more than a moment, show the elephant loader (only if the view hasn't painted yet).
    const painted = app.firstElementChild;
    const slow = setTimeout(() => { if (app.firstElementChild === painted) app.innerHTML = `<div class="wrap">${loader("lg")}</div>`; }, 180);
    try {
      if (!parts.length) await views.home();
      else if (parts[0] === "shop") await views.shop(params);
      else if (parts[0] === "product") await views.product(decodeURIComponent(parts[1] || ""));
      else if (parts[0] === "wishlist") await views.wishlist();
      else if (parts[0] === "checkout") await views.checkout();
      else if (parts[0] === "order") await views.order(decodeURIComponent(parts[1] || ""));
      else if (parts[0] === "page") views.page(parts[1]);
      else views.page("404");
    } catch (err) {
      app.innerHTML = `<div class="wrap empty"><h2>Something went wrong</h2><p>${esc(err.message)}</p><a class="btn" href="#/">Go home</a></div>`;
    }
    clearTimeout(slow);
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", route);

  // ---------- boot ----------
  (async function boot() {
    const started = Date.now();
    const hideSplash = () => setTimeout(() => document.body.classList.remove("booting"), Math.max(0, 1100 - (Date.now() - started)));
    setTimeout(() => document.body.classList.remove("booting"), 8000); // never trap the user behind the splash
    $("#year").textContent = new Date().getFullYear();
    try { health = { ...health, ...(await remote.health()) }; }
    catch { api = demo; health = await demo.health(); }
    categories = await api.categories();
    renderOffers(await api.offers().catch(() => []));
    $("#main-nav").innerHTML = `<a href="#/shop">Shop all</a>` + categories.slice(0, 5).map((c) => `<a href="#/shop?category=${c.slug}">${esc(c.name)}</a>`).join("");
    $("#footer-cats").innerHTML = categories.map((c) => `<li><a href="#/shop?category=${c.slug}">${esc(c.name)}</a></li>`).join("");
    renderCartCount();
    await loadWish();
    await route();
    hideSplash();
  })();
})();
