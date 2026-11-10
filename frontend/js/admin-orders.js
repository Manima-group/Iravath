/* Admin: order management (status, Shiprocket, notifications) and COD reconciliation. Needs the API server. */
(() => {
  "use strict";
  const A = () => window.IrvAdmin;
  const API_BASE = window.IRAVATH_API_BASE ?? "";

  const FUL = {
    unfulfilled: ["New", "gold"], processing: ["Packed", "gold"], shipped: ["Shipped", "live"],
    out_for_delivery: ["Out for delivery", "live"], delivered: ["Delivered", "live"], cancelled: ["Cancelled", "off"], rto: ["RTO", "warn"],
  };
  const NEXT = {
    unfulfilled: ["processing", "shipped", "cancelled"], processing: ["shipped", "unfulfilled", "cancelled"],
    shipped: ["out_for_delivery", "delivered", "rto"], out_for_delivery: ["delivered", "rto"], delivered: [], cancelled: [], rto: [],
  };
  const ACTION = { processing: "Mark packed", unfulfilled: "Move back to new", shipped: "Mark shipped", out_for_delivery: "Out for delivery",
    delivered: "Mark delivered", cancelled: "Cancel order", rto: "Mark RTO (returned)" };
  const pill = (s) => { const [t, c] = FUL[s] || [s, "off"]; return `<span class="pill ${c}">${t}</span>`; };
  const when = (iso) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "");
  const needServer = () => `<div class="empty-a"><h3>Orders need the server</h3><p class="small">Run the FastAPI backend to manage orders, shipments and COD. The offline demo only covers products and offers.</p></div>`;

  let filters = { fulfilment: "", method: "", q: "" };

  // ---------------------------------------------------------------- orders list
  async function viewOrders() {
    const { $, $$, esc, inr, loader } = A();
    const v = $("#view");
    if (A().isDemo()) { v.innerHTML = needServer(); return; }
    v.innerHTML = loader();
    const qs = new URLSearchParams({ status: "confirmed", limit: "100", ...Object.fromEntries(Object.entries(filters).filter(([, x]) => x)) });
    const [{ items, total }, stats] = await Promise.all([A().req("/api/admin/orders?" + qs), A().req("/api/admin/cod/summary")]);
    const chips = [["", "All"], ["unfulfilled", "New"], ["processing", "Packed"], ["shipped", "Shipped"], ["out_for_delivery", "Out for delivery"],
      ["delivered", "Delivered"], ["cancelled", "Cancelled"], ["rto", "RTO"]];
    v.innerHTML = `
      <div class="stats">
        <div class="stat"><b>${total}</b><span>Orders in view</span></div>
        <div class="stat"><b>${items.filter((o) => o.fulfilment_status === "unfulfilled" || o.fulfilment_status === "processing").length}</b><span>To ship</span></div>
        <div class="stat ${items.some((o) => o.shipment_error) ? "warn" : ""}"><b>${items.filter((o) => o.shipment_error).length}</b><span>Shipment errors</span></div>
        <div class="stat"><b>${inr(stats.awaiting_delivery.amount)}</b><span>COD to collect</span></div>
        <div class="stat"><b>${inr(stats.collected_not_remitted.amount)}</b><span>COD awaiting remittance</span></div>
      </div>
      <div class="a-bar"><h2>Orders</h2><div class="tools">
        <input type="search" id="o-q" placeholder="Order no., AWB, name, phone…" value="${esc(filters.q)}" aria-label="Search orders">
        <select id="o-method" aria-label="Payment method"><option value="">All payments</option><option value="online" ${filters.method === "online" ? "selected" : ""}>Prepaid</option><option value="cod" ${filters.method === "cod" ? "selected" : ""}>COD</option></select>
        <button class="btn ghost" id="o-csv">Export CSV</button></div></div>
      <div class="chips" style="margin-bottom:14px">${chips.map(([k, t]) => `<button class="chip ${filters.fulfilment === k ? "on" : ""}" data-f="${k}">${t}</button>`).join("")}</div>
      <div class="plist">${items.length ? `<div class="orow head"><span>Order</span><span>Customer</span><span>Total</span><span>Payment</span><span>Status</span><span>Shipment</span></div>` + items.map((o) => `
        <button class="orow" data-open="${esc(o.number)}">
          <span><b>${esc(o.number)}</b><br><span class="muted">${when(o.created_at)} · ${o.items} item${o.items === 1 ? "" : "s"}</span></span>
          <span>${esc(o.customer_name)}<br><span class="muted">${esc(o.city)} · ${esc(o.customer_phone)}</span></span>
          <span><b>${inr(o.total)}</b>${o.payment_method === "cod" ? `<br><span class="muted">COD ${inr(o.pay_on_delivery)}</span>` : ""}</span>
          <span>${o.payment_method === "cod" ? `<span class="pill gold">COD</span>${o.cod_remitted ? ` <span class="pill live">Remitted</span>` : o.cod_collected ? ` <span class="pill warn">Collected</span>` : ""}` : `<span class="pill live">Prepaid</span>`}</span>
          <span>${pill(o.fulfilment_status)}</span>
          <span class="muted">${o.shipment_error ? `<span class="pill warn">Error</span>` : o.awb_code ? `${esc(o.courier_name)}<br>${esc(o.awb_code)}` : "—"}</span>
        </button>`).join("") : `<div class="empty-a"><h3>No orders here</h3><p class="small">Paid and COD-confirmed orders show up here.</p></div>`}</div>`;
    $$("[data-f]").forEach((b) => (b.onclick = () => { filters.fulfilment = b.dataset.f; viewOrders(); }));
    $("#o-method").onchange = (e) => { filters.method = e.target.value; viewOrders(); };
    let t; $("#o-q").oninput = (e) => { clearTimeout(t); t = setTimeout(() => { filters.q = e.target.value.trim(); viewOrders(); }, 400); };
    $("#o-csv").onclick = () => downloadCsv(new URLSearchParams({ status: "confirmed", ...Object.fromEntries(Object.entries(filters).filter(([, x]) => x)) }));
    $$("[data-open]").forEach((b) => (b.onclick = () => openOrder(b.dataset.open)));
  }

  async function downloadCsv(qs) {
    try {
      const r = await fetch(`${API_BASE}/api/admin/orders.csv?${qs}`, { headers: { Authorization: `Bearer ${A().token()}` } });
      if (!r.ok) throw new Error("Export failed");
      const url = URL.createObjectURL(await r.blob());
      const a = Object.assign(document.createElement("a"), { href: url, download: `iravath-orders-${new Date().toISOString().slice(0, 10)}.csv` });
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) { A().toast(e.message); }
  }

  // ---------------------------------------------------------------- order drawer
  async function openOrder(number) {
    const { busy, toast } = A();
    try { busy("Loading order…"); renderOrder(await A().req(`/api/admin/orders/${encodeURIComponent(number)}`)); }
    catch (e) { toast(e.message); } finally { busy(); }
  }

  function renderOrder(o) {
    const { $, $$, esc, inr, toast, busy, ask } = A();
    const c = o.customer || {}, a = o.address || {};
    const confirmed = o.status === "paid" || o.status === "cod_confirmed";
    const closed = ["delivered", "cancelled", "rto"].includes(o.fulfilment_status);
    const next = confirmed ? NEXT[o.fulfilment_status] || [] : [];
    const cod = o.payment_method === "cod" && o.status === "cod_confirmed";
    A().openEditor(`
      <div class="ed-head"><div><h3>${esc(o.number)}</h3><div class="small">${when(o.created_at)} · ${pill(o.fulfilment_status)} ${o.payment_method === "cod" ? `<span class="pill gold">COD</span>` : `<span class="pill live">Prepaid</span>`}</div></div>
        <button class="icon-btn" id="ed-x" aria-label="Close">✕</button></div>
      <div class="ed-body">
        <div class="sec"><h4>Customer</h4>
          <p style="margin:0"><b>${esc(c.name)}</b> · <a class="link" href="mailto:${esc(c.email)}">${esc(c.email)}</a> · ${esc(c.phone)}</p>
          <p class="small" style="margin:6px 0 0">${esc(a.line1)}${a.line2 ? ", " + esc(a.line2) : ""}, ${esc(a.city)}, ${esc(a.state)} ${esc(a.pincode)}</p>
          ${o.customer_id ? `<p class="small" style="margin:6px 0 0">Signed-in customer #${o.customer_id}</p>` : `<p class="small" style="margin:6px 0 0">Guest checkout</p>`}</div>

        <div class="sec"><h4>Items &amp; payment</h4>
          ${o.items.map((i) => `<div class="row"><span>${esc(i.name)} · ${esc(i.size)} × ${i.quantity}</span><span>${inr(i.unit_price * i.quantity)}</span></div>`).join("")}
          ${o.discount ? `<div class="row" style="color:var(--ok)"><span>Discount ${esc(o.coupon)}</span><span>−${inr(o.discount)}</span></div>` : ""}
          <div class="row"><span>Shipping</span><span>${o.shipping ? inr(o.shipping) : "Free"}</span></div>
          <div class="row total"><span>Total</span><span>${inr(o.total)}</span></div>
          <div class="row"><span>Paid online</span><span>${inr(o.pay_now)}</span></div>
          ${o.payment_method === "cod" ? `<div class="row"><b>Collect on delivery</b><b>${inr(o.pay_on_delivery)}</b></div>` : ""}
          <p class="small" style="margin:8px 0 0">Razorpay payment: ${esc(o.razorpay_payment_id || "—")}</p></div>

        <div class="sec"><h4>Status</h4>
          ${next.length ? `<p class="hint">Customers get an email${o.customer?.phone ? " and WhatsApp" : ""} when an order ships, is out for delivery, is delivered or is cancelled.</p>
            <div id="ship-fields" class="grid3" style="margin-bottom:10px" ${next.includes("shipped") ? "" : "hidden"}>
              <label class="field">Courier<input id="s-courier" value="${esc(o.courier_name)}" placeholder="Delhivery"></label>
              <label class="field">AWB / tracking no.<input id="s-awb" value="${esc(o.awb_code)}"></label>
              <label class="field">Tracking link<input id="s-url" value="${esc(o.tracking_url)}" placeholder="auto for Shiprocket"></label></div>
            <label class="field" style="margin-bottom:10px">Note (optional, internal)<input id="s-note" maxlength="300"></label>
            <label class="check" style="margin-bottom:12px"><input type="checkbox" id="s-notify" checked> Notify the customer</label>
            <div class="quick">${next.map((s) => `<button class="btn ${s === "cancelled" || s === "rto" ? "danger" : s === next[0] ? "gold" : "ghost"} sm" data-st="${s}">${ACTION[s]}</button>`).join("")}</div>`
          : `<p class="small" style="margin:0">${confirmed ? "This order is closed." : "Awaiting payment: nothing to fulfil yet."}</p>`}</div>

        <div class="sec"><h4>Shipment</h4>
          ${o.shipment_error ? `<p class="err" style="margin:0 0 8px">${esc(o.shipment_error)}</p>` : ""}
          ${o.shiprocket_shipment_id ? `<p class="small" style="margin:0">Shiprocket order ${esc(o.shiprocket_order_id)} · shipment ${esc(o.shiprocket_shipment_id)}</p>` : `<p class="small" style="margin:0">Not sent to Shiprocket yet.</p>`}
          ${o.awb_code ? `<p style="margin:6px 0 0">${esc(o.courier_name || "Courier")} · AWB <b>${esc(o.awb_code)}</b>${o.tracking_url ? ` · <a class="link" href="${esc(o.tracking_url)}" target="_blank" rel="noopener">Track ↗</a>` : ""}</p>` : ""}
          ${confirmed && !closed && (!o.shiprocket_shipment_id || !o.awb_code) ? `<button class="btn ghost sm" id="sr-create" style="margin-top:10px">${o.shipment_error ? "Retry Shiprocket" : o.shiprocket_shipment_id ? "Assign AWB" : "Create Shiprocket shipment"}</button>` : ""}</div>

        ${cod ? `<div class="sec"><h4>COD reconciliation</h4>
          <p class="hint">Delivered COD orders are marked collected automatically. When Shiprocket remits the money to your bank, enter the UTR here (or in bulk on the COD tab).</p>
          <div class="grid2">
            <label class="field">Collected amount (₹)<input id="c-amt" type="number" min="0" value="${o.cod_collected ? o.cod_collected_amount : o.pay_on_delivery}"></label>
            <label class="field">Remittance UTR<input id="c-utr" value="${esc(o.cod_remittance_utr)}" placeholder="e.g. UTIBR52025111012345"></label></div>
          <p class="small">Status: ${o.cod_remitted ? `<span class="pill live">Remitted ${when(o.cod_remitted_at)}</span>` : o.cod_collected ? `<span class="pill warn">Collected ${inr(o.cod_collected_amount)}, not remitted</span>` : `<span class="pill gold">Awaiting delivery</span>`}</p>
          <div class="quick">
            ${o.cod_collected ? `<button class="btn ghost sm" data-cod="uncollect">Undo collected</button>` : `<button class="btn ghost sm" data-cod="collect">Mark collected</button>`}
            ${o.cod_collected && !o.cod_remitted ? `<button class="btn gold sm" data-cod="remit">Mark remitted</button>` : ""}
            ${o.cod_remitted ? `<button class="btn ghost sm" data-cod="unremit">Undo remittance</button>` : ""}</div></div>` : ""}

        <div class="sec"><h4>Timeline</h4>
          <div class="timeline">${o.events.slice().reverse().map((e) => `<div class="tl ${e.kind}"><span class="small">${when(e.created_at)} · ${esc(e.actor)}</span><div>${esc(e.message)}</div></div>`).join("") || `<p class="small">No events yet.</p>`}</div>
          <div class="row-in" style="display:flex;gap:8px;margin-top:12px"><input id="n-text" placeholder="Add an internal note…" style="flex:1;border:1px solid var(--line);padding:9px 10px;border-radius:4px"><button class="btn ghost sm" id="n-add">Add</button></div></div>

        <div class="sec"><h4>Messages sent</h4>
          ${o.notifications.length ? o.notifications.map((n) => `<div class="row small"><span>${esc(n.event.replace(/_/g, " "))} · ${n.channel} → ${esc(n.to)}</span><span class="pill ${n.status === "sent" ? "live" : n.status === "failed" ? "warn" : "off"}" title="${esc(n.error)}">${n.status}</span></div>`).join("") : `<p class="small" style="margin:0">None yet.</p>`}
          <div style="display:flex;gap:8px;margin-top:12px"><select id="r-event"><option value="order_confirmed">Order confirmed</option><option value="order_shipped">Shipped</option><option value="out_for_delivery">Out for delivery</option><option value="order_delivered">Delivered</option><option value="order_cancelled">Cancelled</option></select><button class="btn ghost sm" id="r-send">Resend</button></div>
          <p class="small">“logged” means email/WhatsApp isn't configured on the server yet, so the message was only written to the server log.</p></div>
      </div>
      <div class="ed-foot"><span class="grow"></span><button class="btn ghost" id="ed-close">Close</button></div>`);

    const close = () => { A().closeEditor(); viewOrdersIfOpen(); };
    $("#ed-x").onclick = $("#ed-close").onclick = close;
    const act = async (label, path, body) => {
      try { busy(label); renderOrder(await A().req(path, { method: "POST", body })); toast("Saved"); }
      catch (e) { toast(e.message); } finally { busy(); }
    };
    $$("[data-st]").forEach((b) => (b.onclick = async () => {
      const st = b.dataset.st;
      if ((st === "cancelled" || st === "rto") && !(await ask(st === "cancelled" ? `Cancel ${o.number}? Stock goes back on sale${o.pay_now ? ` and you'll need to refund ${inr(o.pay_now)} from Razorpay` : ""}.` : `Mark ${o.number} as returned to origin?`, { ok: ACTION[st], danger: true }))) return;
      act("Updating status…", `/api/admin/orders/${o.number}/status`, {
        status: st, note: $("#s-note")?.value || "", notify: $("#s-notify")?.checked ?? true,
        courier_name: st === "shipped" ? $("#s-courier").value : "", awb_code: st === "shipped" ? $("#s-awb").value : "",
        tracking_url: st === "shipped" ? $("#s-url").value : "",
      });
    }));
    $("#sr-create") && ($("#sr-create").onclick = () => act("Creating shipment…", `/api/admin/orders/${o.number}/shipment`));
    $$("[data-cod]").forEach((b) => (b.onclick = () => {
      const k = b.dataset.cod, amt = Number($("#c-amt").value), utr = $("#c-utr").value.trim();
      if (k === "remit" && !utr) { $("#c-utr").focus(); return toast("Enter the remittance UTR"); }
      const body = { collect: { collected: true, collected_amount: amt }, uncollect: { collected: false },
        remit: { remitted: true, utr }, unremit: { remitted: false } }[k];
      act("Saving…", `/api/admin/orders/${o.number}/cod`, body);
    }));
    $("#n-add").onclick = () => { const t = $("#n-text").value.trim(); if (t) act("Saving note…", `/api/admin/orders/${o.number}/note`, { note: t }); };
    $("#r-send").onclick = async () => {
      try { await A().req(`/api/admin/orders/${o.number}/notify/${$("#r-event").value}`, { method: "POST" }); toast("Message queued"); setTimeout(() => openOrder(o.number), 800); }
      catch (e) { toast(e.message); }
    };
  }
  const viewOrdersIfOpen = () => { if (location.hash.slice(1) === "orders" || !location.hash) viewOrders(); };

  // ---------------------------------------------------------------- COD tab
  async function viewCod() {
    const { $, $$, esc, inr, loader, toast, busy } = A();
    const v = $("#view");
    if (A().isDemo()) { v.innerHTML = needServer(); return; }
    v.innerHTML = loader();
    const [s, pending, open] = await Promise.all([
      A().req("/api/admin/cod/summary"),
      A().req("/api/admin/orders?status=cod_confirmed&cod=collected_not_remitted&limit=200"),
      A().req("/api/admin/orders?status=cod_confirmed&cod=awaiting_delivery&limit=200"),
    ]);
    v.innerHTML = `
      <div class="stats" style="grid-template-columns:repeat(3,1fr)">
        <div class="stat"><b>${inr(s.awaiting_delivery.amount)}</b><span>${s.awaiting_delivery.count} awaiting delivery</span></div>
        <div class="stat warn"><b>${inr(s.collected_not_remitted.amount)}</b><span>${s.collected_not_remitted.count} collected, not remitted</span></div>
        <div class="stat"><b>${inr(s.remitted.amount)}</b><span>${s.remitted.count} remitted</span></div>
      </div>
      <div class="a-bar"><div><h2>COD reconciliation</h2><p class="small" style="margin:4px 0 0">Match Shiprocket's COD remittance report: tick the orders in a remittance, enter its UTR, and mark them remitted together.</p></div>
        <div class="tools"><button class="btn ghost" id="cod-csv">Export COD CSV</button></div></div>
      ${s.short_collections.length ? `<p class="err">Collected amount differs from expected on: ${s.short_collections.map(esc).join(", ")}</p>` : ""}
      <div class="sec" style="margin-bottom:16px"><h4>Collected, awaiting remittance</h4>
        ${pending.items.length ? `<div class="plist" style="margin:10px 0">${pending.items.map((o) => `
          <label class="orow cod-row"><span><input type="checkbox" class="rem" value="${esc(o.number)}" data-amt="${o.pay_on_delivery}"> <b>${esc(o.number)}</b></span>
            <span>${esc(o.customer_name)}<br><span class="muted">${esc(o.city)}</span></span><span>${inr(o.pay_on_delivery)}</span>
            <span class="muted">${esc(o.awb_code)}</span><span>${pill(o.fulfilment_status)}</span><span></span></label>`).join("")}</div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center"><button class="link small" id="sel-all">Select all</button>
            <input id="bulk-utr" placeholder="Remittance UTR" style="border:1px solid var(--line);padding:9px 10px;border-radius:4px;min-width:220px">
            <button class="btn gold sm" id="bulk-go" disabled>Mark selected remitted</button><span class="small" id="sel-sum"></span></div>`
        : `<p class="small">Nothing waiting. 👍</p>`}</div>
      <div class="sec"><h4>Out for collection</h4>
        ${open.items.length ? `<div class="plist" style="margin-top:10px">${open.items.map((o) => `
          <button class="orow" data-open="${esc(o.number)}"><span><b>${esc(o.number)}</b><br><span class="muted">${when(o.created_at)}</span></span>
            <span>${esc(o.customer_name)}<br><span class="muted">${esc(o.city)}</span></span><span>${inr(o.pay_on_delivery)}</span>
            <span class="muted">${esc(o.awb_code || "—")}</span><span>${pill(o.fulfilment_status)}</span><span></span></button>`).join("")}</div>` : `<p class="small">No COD orders in transit.</p>`}</div>`;
    const upd = () => {
      const sel = $$(".rem:checked");
      $("#bulk-go").disabled = !sel.length;
      $("#sel-sum").textContent = sel.length ? `${sel.length} selected · ${inr(sel.reduce((t, x) => t + Number(x.dataset.amt), 0))}` : "";
    };
    $$(".rem").forEach((x) => (x.onchange = upd));
    $("#sel-all") && ($("#sel-all").onclick = () => { const all = $$(".rem"); const on = !all.every((x) => x.checked); all.forEach((x) => (x.checked = on)); upd(); });
    $("#bulk-go") && ($("#bulk-go").onclick = async () => {
      const utr = $("#bulk-utr").value.trim();
      if (utr.length < 3) { $("#bulk-utr").focus(); return toast("Enter the remittance UTR"); }
      try {
        busy("Marking remitted…");
        const r = await A().req("/api/admin/cod/remit", { method: "POST", body: { order_numbers: $$(".rem:checked").map((x) => x.value), utr } });
        toast(`${r.remitted.length} order${r.remitted.length === 1 ? "" : "s"} remitted · ${inr(r.amount)}`); viewCod();
      } catch (e) { toast(e.message); } finally { busy(); }
    });
    $("#cod-csv").onclick = () => downloadCsv(new URLSearchParams({ status: "cod_confirmed", method: "cod" }));
    $$("[data-open]").forEach((b) => (b.onclick = () => openOrder(b.dataset.open)));
  }

  window.IrvAdminViews = { orders: viewOrders, cod: viewCod };
})();
