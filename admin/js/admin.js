/* Iravath admin panel: products (photos, pricing, stock, visibility) and offers (coupons + banner). */
(() => {
  "use strict";
  const API_BASE = window.IRAVATH_API_BASE ?? "";
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const inr = (n) => "₹" + Number(n || 0).toLocaleString("en-IN");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const imgUrl = (u) => (u && u.startsWith("/media/") ? API_BASE + u : u);
  const slugify = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 110) || "item";
  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
  };

  let toastTimer;
  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 2800); }
  function busy(text) { if (text) { $("#busy-text").textContent = text; $("#busy").hidden = false; } else $("#busy").hidden = true; }
  // In-page dialog (browser confirm/prompt are blocked in sandboxed previews).
  function ask(message, { ok = "OK", danger = false, input = null } = {}) {
    return new Promise((resolve) => {
      const m = document.createElement("div");
      m.className = "modal";
      m.innerHTML = `<div class="modal-card ask" role="dialog" aria-modal="true"><div class="body"><p style="margin:0 0 4px">${esc(message)}</p>
        ${input !== null ? `<input class="ask-in" value="${esc(input)}" style="border:1px solid var(--line);padding:10px;border-radius:4px">` : ""}
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px"><button class="btn ghost sm" data-r="0">Cancel</button><button class="btn ${danger ? "danger" : "gold"} sm" data-r="1">${esc(ok)}</button></div></div></div>`;
      document.body.appendChild(m);
      const field = m.querySelector(".ask-in");
      (field || m.querySelector('[data-r="1"]')).focus();
      const done = (yes) => { m.remove(); resolve(input !== null ? (yes ? field.value : null) : yes); };
      m.addEventListener("click", (e) => { const b = e.target.closest("[data-r]"); if (b) done(b.dataset.r === "1"); else if (e.target === m) done(false); });
      m.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); done(false); } if (e.key === "Enter" && field) done(true); });
    });
  }
  const loader = () => `<div class="brand-loader" role="status" aria-label="Loading"><i class="mark"></i></div>`;

  // ---------------- API: remote (FastAPI) ----------------
  let token = ls.get("irv_admin_token");
  const remote = {
    async req(path, { method = "GET", body, form } = {}) {
      const headers = { Authorization: `Bearer ${token}` };
      if (body) headers["Content-Type"] = "application/json";
      const res = await fetch(API_BASE + path, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401 && path !== "/api/admin/login") { logout(); throw new Error(data.detail || "Please log in again"); }
      if (!res.ok) {
        const d = data.detail;
        throw new Error(Array.isArray(d) ? d.map((e) => `${e.loc?.slice(-1)[0] ?? ""}: ${e.msg.replace(/^Value error, /, "")}`).join(" · ") : d || "Something went wrong");
      }
      return data;
    },
    login: (email, password) => remote.req("/api/admin/login", { method: "POST", body: { email, password } }),
    me: () => remote.req("/api/admin/me"),
    stats: () => remote.req("/api/admin/stats"),
    categories: () => fetch(API_BASE + "/api/categories").then((r) => r.json()),
    addCategory: (name) => remote.req("/api/admin/categories", { method: "POST", body: { name } }),
    products: () => remote.req("/api/admin/products"),
    saveProduct: (id, body) => remote.req(id ? `/api/admin/products/${id}` : "/api/admin/products", { method: id ? "PUT" : "POST", body }),
    deleteProduct: (id) => remote.req(`/api/admin/products/${id}`, { method: "DELETE" }),
    async upload(files) {
      const form = new FormData();
      files.forEach((f) => form.append("files", f));
      return (await remote.req("/api/admin/uploads", { method: "POST", form })).urls;
    },
    coupons: () => remote.req("/api/admin/coupons"),
    saveCoupon: (id, body) => remote.req(id ? `/api/admin/coupons/${id}` : "/api/admin/coupons", { method: id ? "PUT" : "POST", body }),
    deleteCoupon: (id) => remote.req(`/api/admin/coupons/${id}`, { method: "DELETE" }),
  };

  // ---------------- API: demo (browser-only, mirrors the server rules) ----------------
  const fail = (m) => { throw new Error(m); };
  const DB = () => IrvDemoDB.db();
  const persist = () => { if (!IrvDemoDB.save()) toast("Browser storage is full: changes will be lost on reload. Use smaller photos."); };
  const demo = {
    async login(email, password) {
      if (email.trim().toLowerCase() !== "admin@iravath.in" || password !== "iravath-admin") fail("Wrong email or password");
      return { token: "demo", email: "admin@iravath.in" };
    },
    me: async () => ({ email: "admin@iravath.in" }),
    async stats() {
      const p = DB().products;
      return { products: p.length, active: p.filter((x) => x.is_active !== false).length,
        low_stock: p.filter((x) => x.is_active !== false && Object.values(x.sizes).reduce((a, b) => a + b, 0) <= 5).length,
        orders: Object.values(JSON.parse(ls.get("irv_demo_orders") || "{}")).filter((o) => o.status !== "pending_payment").length,
        revenue: Object.values(JSON.parse(ls.get("irv_demo_orders") || "{}")).filter((o) => o.status !== "pending_payment").reduce((s, o) => s + o.total, 0),
        live_offers: DB().coupons.filter((c) => IrvDemoDB.couponLive(c)).length };
    },
    categories: async () => DB().categories,
    async addCategory(name) {
      const base = slugify(name); let slug = base, n = 2;
      while (DB().categories.some((c) => c.slug === slug)) slug = `${base}-${n++}`;
      const c = { slug, name: name.trim(), blurb: "" }; DB().categories.push(c); persist(); return c;
    },
    products: async () => [...DB().products].sort((a, b) => b.id - a.id),
    async saveProduct(id, body) {
      const db = DB();
      const cat = db.categories.find((c) => c.slug === body.category) || fail("Unknown category");
      if (body.mrp < body.price) fail("MRP cannot be lower than the selling price");
      const base = slugify(body.slug || body.name); let slug = base, n = 2;
      while (db.products.some((p) => p.slug === slug && p.id !== id)) slug = `${base}-${n++}`;
      const sizes = Object.fromEntries(Object.entries(body.sizes).map(([k, v]) => [k.trim().toUpperCase(), Number(v)]));
      const row = { ...body, slug, sizes, category: cat };
      if (id) { const i = db.products.findIndex((p) => p.id === id); db.products[i] = { ...db.products[i], ...row }; persist(); return db.products[i]; }
      const p = { ...row, id: IrvDemoDB.nextId(db.products), rating: 0, reviews: 0 }; db.products.push(p); persist(); return p;
    },
    async deleteProduct(id) { const db = DB(); db.products = db.products.filter((p) => p.id !== id); persist(); return { ok: true, archived: false }; },
    async upload(files) { return Promise.all(files.map(compressToDataUrl)); },
    coupons: async () => [...DB().coupons].sort((a, b) => b.id - a.id).map((c) => ({ ...c, live: IrvDemoDB.couponLive(c) })),
    async saveCoupon(id, body) {
      const db = DB(); body.code = body.code.toUpperCase();
      if (db.coupons.some((c) => c.code === body.code && c.id !== id)) fail(`Coupon ${body.code} already exists`);
      if (body.kind === "percent" && body.value > 90) fail("Percent discount must be 90 or less");
      if (id) { const i = db.coupons.findIndex((c) => c.id === id); db.coupons[i] = { ...db.coupons[i], ...body }; }
      else db.coupons.push({ ...body, id: IrvDemoDB.nextId(db.coupons) });
      persist(); return body;
    },
    async deleteCoupon(id) { DB().coupons = DB().coupons.filter((c) => c.id !== id); persist(); return { ok: true }; },
  };
  function compressToDataUrl(file) {
    return new Promise((resolve, reject) => {
      if (!/^image\//.test(file.type)) return reject(new Error("Upload a JPG, PNG or WebP image"));
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const max = 1000, k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        resolve(c.toDataURL("image/jpeg", 0.8));
      };
      img.onerror = () => reject(new Error("Could not read that image"));
      img.src = url;
    });
  }

  let api = remote;
  // Shared helpers for js/admin-orders.js
  window.IrvAdmin = {
    req: (...a) => remote.req(...a), isDemo: () => api === demo, token: () => token,
    toast, busy, ask, loader, esc, inr, imgUrl, $, $$,
    openEditor: (h) => openEditor(h), closeEditor: () => closeEditor(), refresh: () => route(),
  };
  let categories = [];

  // ---------------- auth ----------------
  function showLogin() { $("#shell").hidden = true; $("#login").hidden = false; $("#l-email").focus(); }
  function logout() { token = null; ls.set("irv_admin_token", null); showLogin(); }
  $("#logout").onclick = logout;
  $("#login-form").onsubmit = async (e) => {
    e.preventDefault();
    $("#l-err").textContent = "";
    try {
      busy("Signing in…");
      const r = await api.login($("#l-email").value, $("#l-pass").value);
      token = r.token; ls.set("irv_admin_token", token);
      await enter();
    } catch (err) { $("#l-err").textContent = err.message; }
    finally { busy(); }
  };

  async function enter() {
    $("#login").hidden = true; $("#shell").hidden = false;
    categories = await api.categories();
    route();
  }

  // ---------------- tabs ----------------
  $$(".a-tabs button").forEach((b) => (b.onclick = () => { location.hash = b.dataset.tab; }));
  window.addEventListener("hashchange", route);
  const TABS = ["orders", "cod", "products", "offers"];
  function route() {
    const want = location.hash.slice(1);
    const tab = TABS.includes(want) ? want : "orders";
    $$(".a-tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
    closeEditor();
    const views = { products: viewProducts, offers: viewOffers, ...(window.IrvAdminViews || {}) };
    Promise.resolve(views[tab]()).catch((e) => { $("#view").innerHTML = `<div class="empty-a"><h3>Couldn't load</h3><p class="small">${esc(e.message)}</p></div>`; });
  }

  // ---------------- products ----------------
  const stockOf = (p) => Object.values(p.sizes || {}).reduce((a, b) => a + Number(b), 0);
  const thumb = (p) => (p.images && p.images[0])
    ? `<img src="${esc(imgUrl(p.images[0]))}" alt="">`
    : `<div style="width:100%;height:100%;background:${esc(p.color_hex || "#c8b48a")};display:grid;place-items:center;color:#fff;font-family:var(--serif);font-size:20px">${esc((p.name || "?")[0])}</div>`;

  let allProducts = [];
  async function viewProducts() {
    const v = $("#view");
    v.innerHTML = loader();
    const [stats, products] = await Promise.all([api.stats(), api.products()]);
    allProducts = products;
    v.innerHTML = `
      <div class="stats">
        <div class="stat"><b>${stats.active}</b><span>Live products</span></div>
        <div class="stat"><b>${stats.products - stats.active}</b><span>Hidden</span></div>
        <div class="stat ${stats.low_stock ? "warn" : ""}"><b>${stats.low_stock}</b><span>Low stock (≤5)</span></div>
        <div class="stat"><b>${stats.orders}</b><span>Paid orders</span></div>
        <div class="stat"><b>${inr(stats.revenue)}</b><span>Revenue</span></div>
      </div>
      <div class="a-bar"><h2>Products</h2><div class="tools">
        <input type="search" id="p-search" placeholder="Search products…" aria-label="Search products">
        <button class="btn gold" id="p-new">+ Add product</button></div></div>
      <div class="plist" id="plist"></div>`;
    $("#p-new").onclick = () => openProductEditor();
    $("#p-search").oninput = (e) => renderList(e.target.value);
    renderList("");
  }
  function renderList(q) {
    const t = q.trim().toLowerCase();
    const rows = allProducts.filter((p) => !t || (p.name + " " + p.category.name + " " + p.color).toLowerCase().includes(t));
    $("#plist").innerHTML = rows.length ? `<div class="prow head"><span></span><span>Product</span><span>Category</span><span>Price</span><span>Stock</span><span>Status</span><span></span></div>` +
      rows.map((p) => {
        const off = p.mrp > p.price ? Math.round((1 - p.price / p.mrp) * 100) : 0, st = stockOf(p);
        return `<div class="prow">
          <div class="pthumb">${thumb(p)}</div>
          <div><div class="pname">${esc(p.name)}</div><div class="muted">${esc(p.color)}${p.badge ? " · " + esc(p.badge) : ""} · ${(p.images || []).length} photo${(p.images || []).length === 1 ? "" : "s"}</div></div>
          <div class="c-cat muted">${esc(p.category.name)}</div>
          <div class="c-price"><b>${inr(p.price)}</b> ${off ? `<span class="muted"><s>${inr(p.mrp)}</s> ${off}% off</span>` : ""}</div>
          <div class="c-stock">${st <= 5 ? `<span class="pill warn">${st} left</span>` : st}</div>
          <div class="c-status">${p.is_active === false ? `<span class="pill off">Hidden</span>` : `<span class="pill live">Live</span>`}</div>
          <div class="c-edit"><button class="btn ghost sm" data-edit="${p.id}">Edit</button></div></div>`;
      }).join("") : `<div class="empty-a"><h3>No products found</h3><p class="small">Add your first product with photos and pricing.</p></div>`;
    $$("[data-edit]").forEach((b) => (b.onclick = () => openProductEditor(allProducts.find((p) => p.id === Number(b.dataset.edit)))));
  }

  // ---------------- editor drawer ----------------
  function openEditor(html) { $("#editor").innerHTML = html; document.body.classList.add("editing"); }
  function closeEditor() { document.body.classList.remove("editing"); }
  let dirty = false;
  const confirmDiscard = async () => !dirty || (await ask("Discard your unsaved changes?", { ok: "Discard", danger: true }));
  const tryClose = async () => { if (await confirmDiscard()) closeEditor(); };
  $("#ed-backdrop").onclick = tryClose;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && document.body.classList.contains("editing") && !document.querySelector(".ask")) tryClose(); });

  const SIZE_PRESETS = { "S–XXL": ["S", "M", "L", "XL", "XXL"], "Waist 30–38": ["30", "32", "34", "36", "38"], "Free size": ["FREE"] };
  const BADGES = ["", "New", "Bestseller", "Premium", "Sale", "Limited"];

  function openProductEditor(p) {
    dirty = false;
    const st = {
      images: [...(p?.images || [])],
      sizes: Object.entries(p?.sizes || { S: 0, M: 0, L: 0, XL: 0, XXL: 0 }),
    };
    openEditor(`
      <div class="ed-head"><h3>${p ? "Edit product" : "New product"}</h3><button class="icon-btn" id="ed-x" aria-label="Close">✕</button></div>
      <form class="ed-body" id="pform" novalidate>
        <div class="sec"><h4>Photos</h4><p class="hint">The first photo is the cover on the shop page. Portrait photos (4:5) look best. JPG, PNG or WebP, up to 8 MB each.</p>
          <label class="drop" id="drop"><input type="file" id="files" accept="image/jpeg,image/png,image/webp" multiple hidden>
            <b>Drop photos here or tap to upload</b><span class="small">You can select several at once</span></label>
          <div class="photos" id="photos"></div></div>

        <div class="sec"><h4>Details</h4><div class="grid2">
          <label class="field span2">Product name<input id="f-name" required maxlength="200" value="${esc(p?.name)}" placeholder="e.g. Ivory Linen Shirt"></label>
          <label class="field">Category<div class="row-in"><select id="f-cat">${categories.map((c) => `<option value="${c.slug}" ${p?.category?.slug === c.slug ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>
            <button type="button" class="btn ghost sm" id="f-newcat" style="flex:0 0 auto">+ New</button></div></label>
          <label class="field">Badge<select id="f-badge">${[...new Set([...BADGES, p?.badge || ""])].map((b) => `<option ${b === (p?.badge || "") ? "selected" : ""} value="${esc(b)}">${b || "None"}</option>`).join("")}</select></label>
          <label class="field span2">Description<textarea id="f-desc" maxlength="4000" placeholder="Fabric feel, fit, occasion…">${esc(p?.description)}</textarea></label>
          <label class="field">Fabric<input id="f-fabric" maxlength="120" value="${esc(p?.fabric)}" placeholder="100% linen"></label>
          <label class="field">Colour name<div class="row-in"><input id="f-color" maxlength="40" value="${esc(p?.color)}" placeholder="Ivory"><input type="color" id="f-hex" value="${esc(p?.color_hex || "#c8b48a")}" style="flex:0 0 52px" aria-label="Colour swatch"></div></label>
        </div></div>

        <div class="sec"><h4>Pricing &amp; offer</h4><p class="hint">MRP is shown struck through; the selling price is what customers pay. Quick discount buttons set the selling price from the MRP.</p>
          <div class="grid2">
            <label class="field">MRP (₹)<input id="f-mrp" type="number" min="1" inputmode="numeric" value="${p?.mrp ?? ""}" placeholder="3299"></label>
            <label class="field">Selling price (₹)<input id="f-price" type="number" min="1" inputmode="numeric" value="${p?.price ?? ""}" placeholder="2499"></label>
          </div>
          <div class="quick" id="quick">${[0, 10, 15, 20, 25, 30, 40, 50].map((d) => `<button type="button" data-off="${d}">${d ? d + "% off" : "No discount"}</button>`).join("")}</div>
          <div class="price-read" id="price-read"></div><p class="err" id="price-err"></p></div>

        <div class="sec"><h4>Sizes &amp; stock</h4><p class="hint">Set stock per size. Sizes at 0 show as sold out.</p>
          <div class="quick">${Object.keys(SIZE_PRESETS).map((k) => `<button type="button" data-preset="${k}">${k}</button>`).join("")}</div>
          <div class="sizes-ed" id="sizes" style="margin-top:12px"></div>
          <button type="button" class="link small" id="add-size" style="margin-top:10px">+ Add size</button>
          <div class="stock-total" id="stock-total"></div></div>

        <div class="sec"><h4>Visibility</h4><label class="check"><input type="checkbox" id="f-active" ${p?.is_active === false ? "" : "checked"}> Show this product in the store</label></div>
      </form>
      <div class="ed-foot">${p ? `<button class="btn danger" id="p-del">Delete</button>` : ""}<span class="grow"></span>
        <button class="btn ghost" id="ed-cancel">Cancel</button><button class="btn gold" id="p-save">${p ? "Save changes" : "Add product"}</button></div>`);

    const form = $("#pform");
    form.addEventListener("input", () => (dirty = true));
    $("#ed-x").onclick = $("#ed-cancel").onclick = tryClose;

    // photos
    const renderPhotos = (pending = 0) => {
      $("#photos").innerHTML = st.images.map((u, i) => `<div class="photo"><img src="${esc(imgUrl(u))}" alt="Photo ${i + 1}">${i === 0 ? `<span class="cover">Cover</span>` : ""}
        <div class="acts"><button type="button" data-mv="${i}" data-d="-1" ${i === 0 ? "disabled" : ""} aria-label="Move left">←</button>
        <button type="button" data-rm="${i}" aria-label="Remove photo">✕</button>
        <button type="button" data-mv="${i}" data-d="1" ${i === st.images.length - 1 ? "disabled" : ""} aria-label="Move right">→</button></div></div>`).join("")
        + Array.from({ length: pending }, () => `<div class="photo uploading">${loader()}</div>`).join("");
      $$("[data-rm]").forEach((b) => (b.onclick = () => { st.images.splice(Number(b.dataset.rm), 1); dirty = true; renderPhotos(); }));
      $$("[data-mv]").forEach((b) => (b.onclick = () => { const i = Number(b.dataset.mv), j = i + Number(b.dataset.d); [st.images[i], st.images[j]] = [st.images[j], st.images[i]]; dirty = true; renderPhotos(); }));
    };
    const addFiles = async (files) => {
      files = [...files].filter((f) => /^image\/(jpeg|png|webp)$/.test(f.type));
      if (!files.length) return toast("Choose JPG, PNG or WebP photos");
      if (st.images.length + files.length > 12) return toast("Up to 12 photos per product");
      renderPhotos(files.length);
      try { st.images.push(...(await api.upload(files))); dirty = true; toast(`${files.length} photo${files.length > 1 ? "s" : ""} uploaded`); }
      catch (e) { toast(e.message); }
      renderPhotos();
    };
    $("#files").onchange = (e) => { addFiles(e.target.files); e.target.value = ""; };
    const drop = $("#drop");
    ["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); }));
    ["dragleave", "drop"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
    drop.addEventListener("drop", (e) => addFiles(e.dataTransfer.files));
    renderPhotos();

    // pricing
    const priceRead = () => {
      const mrp = Number($("#f-mrp").value), price = Number($("#f-price").value);
      $("#price-err").textContent = mrp && price && price > mrp ? "Selling price is higher than MRP" : "";
      $("#price-read").innerHTML = mrp && price && price <= mrp
        ? `<span class="small">Customers see</span> <span class="big">${inr(price)}</span>${mrp > price ? ` <s class="muted">${inr(mrp)}</s> <span class="pill warn">${Math.round((1 - price / mrp) * 100)}% off</span> <span class="small">· saves ${inr(mrp - price)}</span>` : ""}` : "";
    };
    $("#f-mrp").oninput = $("#f-price").oninput = priceRead;
    $$("#quick [data-off]").forEach((b) => (b.onclick = () => {
      const mrp = Number($("#f-mrp").value);
      if (!mrp) { $("#f-mrp").focus(); return toast("Enter the MRP first"); }
      $("#f-price").value = Math.round((mrp * (100 - Number(b.dataset.off))) / 100); dirty = true; priceRead();
    }));
    priceRead();

    // sizes
    const renderSizes = () => {
      $("#sizes").innerHTML = st.sizes.map(([k, v], i) => `<div class="size-row"><input value="${esc(k)}" data-sk="${i}" placeholder="Size" aria-label="Size name" maxlength="10">
        <input type="number" min="0" value="${v}" data-sv="${i}" inputmode="numeric" aria-label="Stock for ${esc(k)}"><button type="button" data-sd="${i}" aria-label="Remove size">✕</button></div>`).join("");
      $$("[data-sk]").forEach((el) => (el.oninput = () => { st.sizes[el.dataset.sk][0] = el.value; }));
      $$("[data-sv]").forEach((el) => (el.oninput = () => { st.sizes[el.dataset.sv][1] = Math.max(0, Number(el.value) || 0); totals(); }));
      $$("[data-sd]").forEach((el) => (el.onclick = () => { st.sizes.splice(Number(el.dataset.sd), 1); dirty = true; renderSizes(); }));
      totals();
    };
    const totals = () => { $("#stock-total").textContent = `Total stock: ${st.sizes.reduce((a, [, v]) => a + Number(v || 0), 0)} pieces`; };
    $("#add-size").onclick = () => { st.sizes.push(["", 0]); renderSizes(); $$("[data-sk]").pop().focus(); };
    $$("[data-preset]").forEach((b) => (b.onclick = () => {
      const keep = Object.fromEntries(st.sizes); st.sizes = SIZE_PRESETS[b.dataset.preset].map((k) => [k, keep[k] ?? 0]); dirty = true; renderSizes();
    }));
    renderSizes();

    $("#f-newcat").onclick = async () => {
      const name = await ask("New category name (e.g. Blazers)", { ok: "Add category", input: "" });
      if (!name || name.trim().length < 2) return;
      try { const c = await api.addCategory(name.trim()); categories.push(c); $("#f-cat").insertAdjacentHTML("beforeend", `<option value="${c.slug}">${esc(c.name)}</option>`); $("#f-cat").value = c.slug; toast(`Category “${c.name}” added`); }
      catch (e) { toast(e.message); }
    };

    $("#p-save").onclick = async () => {
      const body = {
        name: $("#f-name").value.trim(), slug: p?.slug || "", category: $("#f-cat").value, badge: $("#f-badge").value,
        description: $("#f-desc").value.trim(), fabric: $("#f-fabric").value.trim(), color: $("#f-color").value.trim(), color_hex: $("#f-hex").value,
        silhouette: p?.silhouette || "shirt", price: Number($("#f-price").value), mrp: Number($("#f-mrp").value),
        sizes: Object.fromEntries(st.sizes.filter(([k]) => k.trim()).map(([k, v]) => [k.trim().toUpperCase(), Number(v) || 0])),
        images: st.images, is_active: $("#f-active").checked,
      };
      const problems = [];
      if (body.name.length < 2) problems.push("product name");
      if (!body.mrp || !body.price) problems.push("MRP and selling price");
      else if (body.price > body.mrp) problems.push("selling price must not exceed MRP");
      if (!Object.keys(body.sizes).length) problems.push("at least one size");
      if (problems.length) return toast("Please add: " + problems.join(", "));
      if (!body.images.length && !(await ask("Save without photos? The store will show a placeholder until you add some.", { ok: "Save anyway" }))) return;
      try {
        busy(p ? "Saving changes…" : "Adding product…");
        await api.saveProduct(p?.id, body);
        dirty = false; closeEditor(); toast(p ? "Product updated" : "Product added to the store"); viewProducts();
      } catch (e) { toast(e.message); }
      finally { busy(); }
    };
    if (p) $("#p-del").onclick = async () => {
      if (!(await ask(`Delete “${p.name}”? Products with past orders are hidden instead, to keep order history.`, { ok: "Delete", danger: true }))) return;
      try { busy("Deleting…"); const r = await api.deleteProduct(p.id); dirty = false; closeEditor(); toast(r.archived ? "Has past orders, so it was hidden" : "Product deleted"); viewProducts(); }
      catch (e) { toast(e.message); } finally { busy(); }
    };
    setTimeout(() => (p ? null : $("#f-name").focus()), 320);
  }

  // ---------------- offers ----------------
  const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "");
  const toLocalInput = (iso) => { if (!iso) return ""; const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
  const offerValue = (c) => (c.kind === "percent" ? `${c.value}% off${c.max_discount ? ` (up to ${inr(c.max_discount)})` : ""}` : `${inr(c.value)} off`);

  async function viewOffers() {
    const v = $("#view");
    v.innerHTML = loader();
    const coupons = await api.coupons();
    v.innerHTML = `<div class="a-bar"><div><h2>Offers &amp; coupons</h2><p class="small" style="margin:4px 0 0">Coupons apply at checkout. Turn on “Show in banner” to announce an offer in the bar at the top of the store.</p></div>
        <div class="tools"><button class="btn gold" id="o-new">+ New offer</button></div></div>
      ${coupons.length ? `<div class="olist">${coupons.map((c) => {
        const now = Date.now(), upcoming = c.starts_at && Date.parse(c.starts_at) > now, expired = c.ends_at && Date.parse(c.ends_at) < now;
        const status = !c.is_active ? `<span class="pill off">Paused</span>` : upcoming ? `<span class="pill gold">Scheduled</span>` : expired ? `<span class="pill warn">Expired</span>` : `<span class="pill live">Live</span>`;
        return `<div class="ocard"><div class="code">${esc(c.code)}</div><div class="val">${offerValue(c)}</div>
          <div>${esc(c.description || "")}</div>
          <div class="meta">${c.min_subtotal ? `Min order ${inr(c.min_subtotal)}` : "No minimum order"}${c.starts_at ? ` · from ${fmtDate(c.starts_at)}` : ""}${c.ends_at ? ` · until ${fmtDate(c.ends_at)}` : ""}</div>
          <div class="pills">${status}${c.show_in_banner ? `<span class="pill gold">In banner</span>` : ""}</div>
          <div class="acts"><button class="btn ghost sm" data-oedit="${c.id}">Edit</button></div></div>`;
      }).join("")}</div>` : `<div class="empty-a"><h3>No offers yet</h3><p class="small">Create a coupon like FESTIVE20 for 20% off.</p></div>`}`;
    $("#o-new").onclick = () => openOfferEditor();
    $$("[data-oedit]").forEach((b) => (b.onclick = () => openOfferEditor(coupons.find((c) => c.id === Number(b.dataset.oedit)))));
  }

  function openOfferEditor(c) {
    dirty = false;
    openEditor(`
      <div class="ed-head"><h3>${c ? "Edit offer" : "New offer"}</h3><button class="icon-btn" id="ed-x" aria-label="Close">✕</button></div>
      <form class="ed-body" id="oform" novalidate>
        <div class="sec"><h4>Coupon</h4><div class="grid2">
          <label class="field">Coupon code<input id="o-code" maxlength="30" value="${esc(c?.code)}" placeholder="FESTIVE20" style="text-transform:uppercase"></label>
          <label class="field">Discount type<select id="o-kind"><option value="percent" ${c?.kind !== "flat" ? "selected" : ""}>Percentage (%)</option><option value="flat" ${c?.kind === "flat" ? "selected" : ""}>Flat amount (₹)</option></select></label>
          <label class="field"><span id="o-val-l">Discount</span><input id="o-value" type="number" min="1" inputmode="numeric" value="${c?.value ?? ""}" placeholder="20"></label>
          <label class="field" id="o-cap-f">Maximum discount (₹, optional)<input id="o-cap" type="number" min="0" inputmode="numeric" value="${c?.max_discount || ""}" placeholder="No cap"></label>
          <label class="field">Minimum order (₹)<input id="o-min" type="number" min="0" inputmode="numeric" value="${c?.min_subtotal || ""}" placeholder="0"></label>
          <label class="field span2">Description (shown to customers)<input id="o-desc" maxlength="160" value="${esc(c?.description)}" placeholder="Festive sale: 20% off everything"></label>
        </div><div class="example" id="o-example" style="margin-top:12px"></div></div>
        <div class="sec"><h4>Schedule</h4><p class="hint">Leave empty to start now and run until you pause it.</p><div class="grid2">
          <label class="field">Starts<input id="o-start" type="datetime-local" value="${toLocalInput(c?.starts_at)}"></label>
          <label class="field">Ends<input id="o-end" type="datetime-local" value="${toLocalInput(c?.ends_at)}"></label></div></div>
        <div class="sec"><h4>Visibility</h4>
          <label class="check"><input type="checkbox" id="o-active" ${c?.is_active === false ? "" : "checked"}> Offer is active</label>
          <label class="check" style="margin-top:10px"><input type="checkbox" id="o-banner" ${c?.show_in_banner ? "checked" : ""}> Show in the store's announcement banner</label></div>
      </form>
      <div class="ed-foot">${c ? `<button class="btn danger" id="o-del">Delete</button>` : ""}<span class="grow"></span>
        <button class="btn ghost" id="ed-cancel">Cancel</button><button class="btn gold" id="o-save">${c ? "Save offer" : "Create offer"}</button></div>`);
    $("#oform").addEventListener("input", () => (dirty = true));
    $("#ed-x").onclick = $("#ed-cancel").onclick = tryClose;
    const example = () => {
      const kind = $("#o-kind").value, val = Number($("#o-value").value), cap = Number($("#o-cap").value), min = Number($("#o-min").value);
      $("#o-val-l").textContent = kind === "percent" ? "Discount (%)" : "Discount (₹)";
      $("#o-cap-f").style.display = kind === "percent" ? "" : "none";
      if (!val) { $("#o-example").textContent = "Enter a discount to see an example."; return; }
      const order = Math.max(min, 2999);
      let save = kind === "percent" ? Math.floor((order * val) / 100) : val;
      if (kind === "percent" && cap) save = Math.min(save, cap);
      save = Math.min(save, order);
      $("#o-example").innerHTML = `Example: on a <b>${inr(order)}</b> order the customer saves <b>${inr(save)}</b> and pays <b>${inr(order - save)}</b>.`;
    };
    ["o-kind", "o-value", "o-cap", "o-min"].forEach((id) => ($("#" + id).oninput = example));
    $("#o-kind").onchange = example;
    example();

    $("#o-save").onclick = async () => {
      const iso = (v) => (v ? new Date(v).toISOString() : null);
      const body = {
        code: $("#o-code").value.trim().toUpperCase(), kind: $("#o-kind").value, value: Number($("#o-value").value),
        max_discount: $("#o-kind").value === "percent" ? Number($("#o-cap").value) || 0 : 0, min_subtotal: Number($("#o-min").value) || 0,
        description: $("#o-desc").value.trim(), starts_at: iso($("#o-start").value), ends_at: iso($("#o-end").value),
        is_active: $("#o-active").checked, show_in_banner: $("#o-banner").checked,
      };
      if (!/^[A-Z0-9_-]{3,30}$/.test(body.code)) return toast("Code: 3–30 letters/numbers, no spaces");
      if (!body.value) return toast("Enter the discount value");
      if (body.kind === "percent" && body.value > 90) return toast("Percent discount must be 90 or less");
      if (body.starts_at && body.ends_at && body.ends_at <= body.starts_at) return toast("End must be after start");
      try { busy("Saving offer…"); await api.saveCoupon(c?.id, body); dirty = false; closeEditor(); toast(c ? "Offer updated" : "Offer created"); viewOffers(); }
      catch (e) { toast(e.message); } finally { busy(); }
    };
    if (c) $("#o-del").onclick = async () => {
      if (!(await ask(`Delete offer ${c.code}? Customers will no longer be able to use it.`, { ok: "Delete", danger: true }))) return;
      try { busy("Deleting…"); await api.deleteCoupon(c.id); dirty = false; closeEditor(); toast("Offer deleted"); viewOffers(); }
      catch (e) { toast(e.message); } finally { busy(); }
    };
  }

  // ---------------- boot ----------------
  (async function boot() {
    try {
      const r = await fetch(API_BASE + "/api/health"); if (!r.ok) throw 0;
      const h = await r.json();
      $("#store-link").href = h.store_url || "/";
    }
    catch { api = demo; $("#demo-hint").hidden = false; $("#demo-banner").hidden = false; }
    if (!token) return showLogin();
    try { await api.me(); await enter(); } catch { showLogin(); }
  })();
})();
