# Free Fire MXShop integration

The Free Fire catalog uses MXShop `StockIDX 15`:

https://mxshop.in.th/game/free-fire/15

The storefront includes all 22 products that were available in the supplier catalog on 2026-09-13: Weekly Membership Lite, Weekly Membership, Monthly Membership, Booyah Pass, eleven diamond amounts from 33 through 11,094, six individual Growth Packs, and the combined Lv6–30 Growth Pack.

Each trusted server package contains its verified `stockreleaselist_id`. Supplier IDs submitted by customers are ignored because checkout resolves the selected package from the server catalog. Unknown package IDs are rejected before persistence.

`MXSHOP_FREE_FIRE_STOCK_IDX` can override the built-in product ID `15`. When MXShop credentials are configured, the shared catalog refresh fetches live Free Fire supplier prices and applies BestDia's existing margin calculation. The checked-in prices are fallbacks from the catalog inspection.

Free Fire fulfillment uses the Player ID without a zone value. Auto fulfillment remains controlled by the existing `MXSHOP_AUTO_TOPUP_ENABLED` environment setting.
