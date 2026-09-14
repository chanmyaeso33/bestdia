# Magic Chess Go Go and Genshin Impact

Catalogs were verified against MXShop's public product and buyer endpoints on 2026-09-14:

- Magic Chess Go Go (Global): https://mxshop.in.th/game/magic-chess-go-go/91
- Genshin Impact (Asia): https://mxshop.in.th/game/genshin-impact/89
- Metadata: https://api.mxshop.in.th/api/product?id=91 and https://api.mxshop.in.th/api/product?id=89
- Packages: https://api.mxshop.in.th/api/buyer?id=91 and https://api.mxshop.in.th/api/buyer?id=89

Magic Chess has 11 packages (10 diamond amounts and Weekly Pass). It requires numeric player and server IDs, submitted to MXShop as `UID(ServerID)`. Only the Global product is listed; the supplier's separate country catalogs are not included.

Genshin has 14 packages: Blessing of the Welkin Moon, the all-crystal bundle, six Genesis Crystal amounts, and six Chronal Nexus amounts. The supplier currently advertises only `Asia` in its server options. Checkout requires an explicit server selection, validates it on the server, and submits `UID/Asia`, matching the supplier buyer script's slash-separated extra fields.

The storefront and admin catalogs include supplier artwork saved locally. The server owns the package IDs, supplier mappings, and prices; customer-supplied mappings are ignored. Fallback supplier prices use the public catalog's `price` field with BestDia's existing margin and currency rounding. Authenticated supplier refresh includes StockIDX `91` and `89` and replaces fallback prices when available.

Fulfillment uses the existing MXShop credentials and `MXSHOP_AUTO_TOPUP_ENABLED` setting. Tests use mocked supplier responses; no paid supplier orders were placed.

Validation: `node --test tests/*.test.cjs`. Desktop/mobile browser checks also cover game switching, package selection, images, saved server selection, and admin startup.
