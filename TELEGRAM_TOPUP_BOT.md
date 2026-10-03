# BestDia Telegram Auto Top-up Bot — MVP

This branch adds a Cloudflare Pages Function at:

`/telegram/webhook`

and a dedicated website checkout page at:

`/telegram-checkout.html`

The Telegram bot is the storefront/account-verification layer. Payment and order creation stay on the BestDia website so the existing BestDia payment methods and backend validation can be reused.

## MVP flow

1. `/start`
2. Select **MLBB Global**
3. Send `PLAYER_ID ZONE_ID`
4. BestDia verifies nickname + region through `/api/mlbb-lookup`
5. User selects a live package from `/api/catalog`
6. Bot shows package confirmation and a **Continue to BestDia Checkout** URL button
7. `telegram-checkout.html` receives only player/package/contact identifiers in the URL
8. The checkout page re-fetches `/api/catalog` and `/api/mlbb-lookup`; it does not trust price or IGN from the URL
9. User chooses one of the existing BestDia methods:
   - KBZPay
   - Wave Money
   - TrueMoney
   - PromptPay
   - BestDia Balance
10. Manual payment methods require a payment-slip image
11. BestDia Balance requires login and uses the existing account session
12. Checkout submits to the existing `/api/create-order` route
13. Existing BestDia order/payment/supplier logic continues from there
14. Order status is polled through `/api/order-status`

## Required Cloudflare variables/secrets

- `TELEGRAM_CUSTOMER_BOT_TOKEN` — token from @BotFather. If omitted, the function falls back to the existing `TELEGRAM_BOT_TOKEN`.
- `TELEGRAM_WEBHOOK_SECRET` — random secret used with Telegram `setWebhook(secret_token=...)`.
- Existing BestDia backend secrets already required for `/api/create-order`, account login, Firebase, MXShop/MooGold, and Telegram admin notifications.

No Telegram Stars pricing variable or Telegram payment KV is required for this handoff version.

## Telegram webhook

After deployment to a stable HTTPS URL, configure Telegram to send updates to:

`https://<bestdia-domain>/telegram/webhook`

Use the same `TELEGRAM_WEBHOOK_SECRET` as Telegram's `secret_token` when configuring the webhook.

Recommended update types:

- `message`
- `callback_query`

## Checkout security decisions

- URL query parameters contain only player ID, zone ID, package ID, and optional Telegram contact.
- Price is reloaded from `/api/catalog` on the checkout page.
- MLBB nickname/region are revalidated through `/api/mlbb-lookup` on the checkout page.
- `/api/create-order` remains the authoritative server-side validator for product, package, payment method, player/server, and account-session rules.
- BestDia Balance credentials are entered only on the BestDia checkout page and sent to the existing BestDia account API; the Telegram bot never receives the password.
- Payment slips continue through the existing BestDia order flow.

## Production checklist

- Deploy the branch to a preview/staging URL first.
- Configure the Telegram bot webhook with `TELEGRAM_WEBHOOK_SECRET`.
- Test account lookup and unsupported-region rejection.
- Test every package-button handoff URL.
- Confirm the checkout page always reflects current catalog pricing.
- Test KBZPay, Wave Money, TrueMoney, and PromptPay slip orders.
- Test BestDia Balance login, insufficient balance, successful auto-top-up, and failed supplier flow.
- Confirm created orders appear in the existing BestDia admin dashboard.
- Verify mobile browser behavior when Telegram opens the website URL.

## Current scope

The MVP exposes MLBB Global in Telegram first. The architecture can later reuse the same handoff pattern for PUBG Mobile, Honor of Kings, Free Fire, and other products without moving payment processing into the Telegram bot.
