# Honor of Kings MXShop setup

The MXShop Honor of Kings product is `StockIDX 1712`:

https://mxshop.in.th/game/honor-of-kings/1712

The catalog was read on 2026-09-13. These current BestDia packages have an exact, available MXShop match:

| BestDia package | MXShop `stockreleaselist_id` | Supplier name |
|---|---:|---|
| `hok-80` | `16802454` | 80 Tokens |
| `hok-240` | `16802455` | 240 Tokens |
| `hok-400` | `16802456` | 400 Tokens |
| `hok-560` | `16802457` | 560 Tokens |
| `hok-2400-108` | `16802458` | 2400+108 Tokens |
| `hok-4000-180` | `16802459` | 4000+180 Tokens |
| `hok-honor-point-pack` | `16802462` | Honor Point Pack |
| `hok-premium-purchase-rebate-pack` | `16802463` | Premium Purchase Rebate Pack |
| `hok-standard-purchase-rebate-pack` | `16802464` | Standard Purchase Rebate Pack |
| `hok-weekly-pass` | `16802465` | Weekly Card |
| `hok-weekly-pass-plus` | `16802466` | Weekly Card Plus |

Fallback supplier costs mirror the live catalog: 31, 91, 149, 208, 871, and 1,459 THB for token packages; 12, 42, 12, 33, and 99 THB for the five packs. HOK has no fixed storefront price overrides, so the shared margin calculation produces 33, 96, 156, 218, 941, 1,576, 13, 44, 13, 35, and 104 THB respectively. Live catalog prices replace these fallback costs when supplier credentials are available.

The unsupported 16, 800+30, 1200+45, and 8000+360 token packages were removed from the storefront and trusted server catalog. MXShop's Double Token Bag remains omitted because it was not requested.

## Diagnostic and activation

Sign in to the admin dashboard and click **Check HOK supplier mappings**. The authenticated `POST /api/hok-mapping-diagnostic` endpoint reads the supplier catalog and checks product ID, variation ID, uniqueness, exact normalized supplier name, presence, and availability. It never purchases or enables auto top-up.

`ready: true` means all eleven supported mappings are still present and available. Review the displayed package names before enabling `MXSHOP_AUTO_TOPUP_ENABLED=true`. Keep `MXSHOP_MX_KEY` and `MXSHOP_PASSKEY` configured. Optional `MXSHOP_HOK_STOCK_IDX` and `MXSHOP_HOK_PACKAGE_MAP` environment values override the built-in verified mappings when MXShop changes its catalog.

HOK mapping resolution is server-owned. Browser-submitted supplier IDs and the generic `MXSHOP_PACKAGE_MAP` fallback cannot override it.

Validation: `node --test tests/hok-mapping.test.cjs` uses mocked supplier responses and places no orders.
