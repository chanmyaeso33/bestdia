# BestDia Telegram Auto Top-up Bot — MVP

This branch adds a Cloudflare Pages Function at:

`/telegram/webhook`

It reuses the existing BestDia backend routes for MLBB account lookup, catalog pricing, and supplier fulfillment.

## MVP flow

1. `/start`
2. Select **MLBB Global**
3. Send `PLAYER_ID ZONE_ID`
4. BestDia verifies nickname + region
5. User selects a live package from `/api/catalog`
6. Bot creates a Telegram Stars invoice (`XTR`)
7. `pre_checkout_query` revalidates the current package price
8. `successful_payment` is deduplicated with Cloudflare KV
9. Existing BestDia supplier route (`/api/mxshop-topup` or `/api/moogold-topup`) fulfills the top-up
10. User and admin receive a result message

## Required Cloudflare variables/secrets

- `TELEGRAM_CUSTOMER_BOT_TOKEN` — token from @BotFather. If omitted, the function falls back to the existing `TELEGRAM_BOT_TOKEN`.
- `TELEGRAM_WEBHOOK_SECRET` — random secret used with Telegram `setWebhook(secret_token=...)`.
- `TELEGRAM_STARS_PER_THB` — conversion multiplier used by the MVP to map BestDia THB retail price to Telegram Stars. Example only: `1.0`. Decide the commercial rate before production.
- `ADMIN_PASSWORD` — already used by the existing protected supplier routes.
- Existing MXShop/MooGold credentials and auto-top-up configuration required by the BestDia backend.

Optional:

- `TELEGRAM_CHAT_ID` — existing admin chat for success/review notifications.

## Required KV binding

Create a Cloudflare KV namespace and bind it to Pages Functions as:

`TELEGRAM_IDEMPOTENCY`

The bot deliberately refuses to open live checkout without this binding. Telegram can retry webhook updates, so payment fulfillment must be idempotent.

## Telegram webhook

After the branch is deployed to a stable HTTPS URL, configure Telegram to send updates to:

`https://<bestdia-domain>/telegram/webhook`

When calling Telegram `setWebhook`, use the same value as `TELEGRAM_WEBHOOK_SECRET` in `secret_token`.

Recommended update types:

- `message`
- `callback_query`
- `pre_checkout_query`

`successful_payment` arrives inside a `message` update.

## Production checklist before enabling payments

- Decide the exact Stars pricing / margin model. Do not guess this value in production.
- Test one low-value MLBB package with a controlled account.
- Confirm account-region rejection works for unsupported MLBB regions.
- Confirm supplier response is classified correctly as success/submitted/failed.
- Confirm repeated delivery of the same `successful_payment` update never creates a second supplier purchase.
- Add a persistent BestDia order record for Telegram Stars purchases before broad launch, so all website and Telegram sales appear in the same admin dashboard.
- Add refund tooling using Telegram's Stars refund method for payment-success / delivery-failure cases.

## Current MVP limitation

The payment is safely deduplicated in KV and supplier fulfillment is wired, but Telegram Stars purchases are not yet inserted into the existing BestDia `orders` collection because `create-order` currently trusts only the website payment methods. The next backend step should add a server-internal Telegram order creation path instead of weakening the public `create-order` validation.
