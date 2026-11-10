"""Seed the Iravath catalog. Run: python -m app.seed  (idempotent: skips if products exist)."""
import json
from pathlib import Path

from sqlalchemy import inspect, text

from .db import Base, SessionLocal, engine
from .models import Category, Coupon, Product

CATEGORIES = [
    ("shirts", "Shirts", "Crisp cottons and linens for every day"),
    ("kurtas", "Kurtas", "Hand-finished kurtas in breathable weaves"),
    ("trousers", "Trousers", "Tailored chinos and pleated trousers"),
    ("tshirts", "T-Shirts & Polos", "Supima and piqué essentials"),
    ("ethnic-sets", "Ethnic Sets", "Festive sets, bandhgalas and Nehru jackets"),
    ("accessories", "Accessories", "Pocket squares, stoles and leather"),
]

S = {"S": 8, "M": 14, "L": 16, "XL": 10, "XXL": 5}
W = {"30": 6, "32": 12, "34": 12, "36": 8, "38": 4}
ONE = {"Free": 25}

# slug, name, category, price, mrp, fabric, color, hex, silhouette, rating, reviews, badge, sizes, description
PRODUCTS = [
    ("ivory-linen-shirt", "Ivory Linen Shirt", "shirts", 2499, 3299, "100% European linen", "Ivory", "#efe6d2", "shirt", 4.7, 214, "Bestseller", S,
     "A relaxed, breathable linen shirt with a cutaway collar and mother-of-pearl buttons. Garment-washed for softness from the first wear."),
    ("sandstone-oxford-shirt", "Sandstone Oxford Shirt", "shirts", 1999, 2599, "Cotton Oxford", "Sandstone", "#c9a97a", "shirt", 4.5, 132, "", S,
     "Classic button-down Oxford in a warm sandstone tone. Smart enough for the office, easy enough for weekends."),
    ("midnight-poplin-shirt", "Midnight Poplin Shirt", "shirts", 2199, 2799, "Two-ply cotton poplin", "Midnight Navy", "#1f2a44", "shirt", 4.6, 98, "New", S,
     "Sharp two-ply poplin with a spread collar. Pairs with tailored trousers for evenings."),
    ("olive-cuban-collar-shirt", "Olive Cuban Collar Shirt", "shirts", 1899, 2499, "Viscose-linen blend", "Olive", "#6b6b3a", "shirt", 4.4, 61, "", S,
     "Fluid camp-collar shirt with a boxy fit. Made for humid Hyderabad evenings."),
    ("gold-chikankari-kurta", "Gold Chikankari Kurta", "kurtas", 3499, 4499, "Cotton mul, hand chikankari", "Antique Gold", "#c6a15b", "kurta", 4.8, 176, "Bestseller", S,
     "Lucknowi chikankari hand-embroidered over soft mul cotton. A quiet statement for festive days."),
    ("cream-silk-blend-kurta", "Cream Silk-Blend Kurta", "kurtas", 3999, 5199, "Silk-cotton blend", "Cream", "#f3ead8", "kurta", 4.7, 88, "", S,
     "A lustrous silk-cotton kurta with a concealed placket and side pockets."),
    ("maroon-handloom-kurta", "Maroon Handloom Kurta", "kurtas", 2799, 3599, "Handloom cotton", "Maroon", "#6e1f2b", "kurta", 4.6, 54, "New", S,
     "Woven on handlooms in Pochampally. Every piece carries the slight irregularities of the loom."),
    ("khaki-pleated-chinos", "Khaki Pleated Chinos", "trousers", 2299, 2999, "Stretch cotton twill", "Khaki", "#b59b6d", "trouser", 4.5, 143, "", W,
     "Single-pleat chinos with a tapered leg and a touch of stretch."),
    ("charcoal-tailored-trousers", "Charcoal Tailored Trousers", "trousers", 2799, 3499, "Poly-viscose suiting", "Charcoal", "#3b3b3f", "trouser", 4.6, 77, "", W,
     "Wrinkle-resistant suiting trousers with an adjustable waistband."),
    ("ecru-linen-drawstring-pants", "Ecru Linen Drawstring Pants", "trousers", 1999, 2599, "Linen-cotton", "Ecru", "#e4d8bf", "trouser", 4.3, 39, "New", W,
     "Relaxed drawstring trousers for travel and long weekends."),
    ("black-supima-tee", "Black Supima Tee", "tshirts", 999, 1299, "Supima cotton jersey", "Black", "#1b1b1b", "tee", 4.6, 302, "Bestseller", S,
     "Heavyweight Supima jersey that holds its shape wash after wash."),
    ("camel-pique-polo", "Camel Piqué Polo", "tshirts", 1499, 1899, "Cotton piqué", "Camel", "#b8894f", "tee", 4.5, 120, "", S,
     "A refined polo with a ribbed collar and tonal Iravath monogram."),
    ("ivory-bandhgala-set", "Ivory Bandhgala Set", "ethnic-sets", 8999, 11999, "Jacquard silk blend", "Ivory Gold", "#e9dcc0", "jacket", 4.9, 41, "Premium", S,
     "Structured bandhgala with antique gold buttons and matching trousers. Wedding-ready."),
    ("navy-nehru-jacket", "Navy Nehru Jacket", "ethnic-sets", 3299, 4299, "Linen-silk blend", "Navy", "#22304f", "jacket", 4.7, 66, "", S,
     "A sleeveless Nehru jacket that layers over any kurta or shirt."),
    ("gold-paisley-pocket-square", "Gold Paisley Pocket Square", "accessories", 699, 999, "Pure silk", "Gold", "#c9a14e", "square", 4.6, 58, "", ONE,
     "Hand-rolled silk pocket square in a traditional paisley print."),
    ("tan-leather-belt", "Tan Leather Belt", "accessories", 1499, 1999, "Full-grain leather", "Tan", "#9a6236", "belt", 4.5, 87, "", {"32": 8, "34": 10, "36": 8, "38": 5},
     "Vegetable-tanned leather belt with a brushed brass buckle."),
]


COUPONS = [
    # code, kind, value, min_subtotal, max_discount, description, show_in_banner
    ("IRAVATH10", "percent", 10, 0, 500, "10% off your order (up to ₹500)", True),
    ("WELCOME200", "flat", 200, 1499, 0, "₹200 off on orders above ₹1,499", False),
]

# Columns added after the first release. create_all() won't add columns to existing tables,
# so add them here. (Use Alembic once the schema starts changing often.)
NEW_COLUMNS = {"products": {"images": "JSON", "is_active": "BOOLEAN DEFAULT TRUE"}}


def migrate() -> None:
    insp = inspect(engine)
    with engine.begin() as conn:
        for table, cols in NEW_COLUMNS.items():
            if not insp.has_table(table):
                continue
            have = {c["name"] for c in insp.get_columns(table)}
            for name, ddl in cols.items():
                if name not in have:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))
        if insp.has_table("products"):
            conn.execute(text("UPDATE products SET images = '[]' WHERE images IS NULL"))
            conn.execute(text("UPDATE products SET is_active = TRUE WHERE is_active IS NULL"))


def seed(export_json: Path | None = None) -> None:
    migrate()
    Base.metadata.create_all(engine)
    db = SessionLocal()
    try:
        if db.query(Coupon).count() == 0:
            for code, kind, value, min_sub, cap, desc, banner in COUPONS:
                db.add(Coupon(code=code, kind=kind, value=value, min_subtotal=min_sub, max_discount=cap,
                              description=desc, show_in_banner=banner))
            db.commit()
        if db.query(Product).count() == 0:
            cats = {}
            for slug, name, blurb in CATEGORIES:
                cats[slug] = Category(slug=slug, name=name, blurb=blurb)
                db.add(cats[slug])
            db.flush()
            for (slug, name, cat, price, mrp, fabric, color, hexv, sil, rating, reviews, badge, sizes, desc) in PRODUCTS:
                db.add(Product(slug=slug, name=name, category=cats[cat], price=price, mrp=mrp, fabric=fabric,
                               color=color, color_hex=hexv, silhouette=sil, rating=rating, reviews=reviews,
                               badge=badge, sizes=dict(sizes), description=desc, images=[], is_active=True))
            db.commit()
            print(f"Seeded {len(CATEGORIES)} categories and {len(PRODUCTS)} products")
        else:
            print("Catalog already seeded")
    finally:
        db.close()

    if export_json:  # used to build the frontend's offline demo catalog
        data = {
            "categories": [{"slug": s, "name": n, "blurb": b} for s, n, b in CATEGORIES],
            "products": [
                {"id": i + 1, "slug": p[0], "name": p[1], "category": next({"slug": s, "name": n, "blurb": b}
                 for s, n, b in CATEGORIES if s == p[2]), "price": p[3], "mrp": p[4], "fabric": p[5],
                 "color": p[6], "color_hex": p[7], "silhouette": p[8], "rating": p[9], "reviews": p[10],
                 "badge": p[11], "sizes": p[12], "description": p[13], "images": [], "is_active": True}
                for i, p in enumerate(PRODUCTS)
            ],
            "coupons": [{"id": i + 1, "code": c[0], "kind": c[1], "value": c[2], "min_subtotal": c[3],
                         "max_discount": c[4], "description": c[5], "show_in_banner": c[6], "is_active": True,
                         "starts_at": None, "ends_at": None} for i, c in enumerate(COUPONS)],
        }
        export_json.write_text("window.IRAVATH_DEMO = " + json.dumps(data, ensure_ascii=False) + ";\n")


if __name__ == "__main__":
    import sys
    seed(Path(sys.argv[1]) if len(sys.argv) > 1 else None)
