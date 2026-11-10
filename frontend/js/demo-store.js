/* Offline demo database (localStorage), shared by the storefront and the admin panel.
 * Only used when the FastAPI backend is not reachable, e.g. the hosted preview link. */
(() => {
  const SEED = window.IRAVATH_DEMO || { categories: [], products: [], coupons: [] };
  const KEY = "irv_demo_db_v2";
  const clone = (x) => JSON.parse(JSON.stringify(x));
  let mem = null;

  function load() {
    if (mem) return mem;
    try { mem = JSON.parse(localStorage.getItem(KEY) || "null"); } catch { mem = null; }
    if (!mem) mem = { categories: clone(SEED.categories), products: clone(SEED.products), coupons: clone(SEED.coupons || []) };
    return mem;
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(mem)); return true; }
    catch { return false; } // quota exceeded (large photos) or storage blocked: keep in memory
  }
  const nextId = (rows) => rows.reduce((m, r) => Math.max(m, r.id || 0), 0) + 1;

  function couponLive(c, now = Date.now()) {
    return c.is_active && (!c.starts_at || Date.parse(c.starts_at) <= now) && (!c.ends_at || now <= Date.parse(c.ends_at));
  }

  window.IrvDemoDB = {
    db: load,
    save,
    nextId,
    couponLive,
    reset() { mem = null; try { localStorage.removeItem(KEY); } catch {} return load(); },
  };
})();
