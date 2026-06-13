# BestDia Payment Automation

BestDia can safely automate delivery only after a payment provider confirms the payment.
Payment slip screenshots should stay manual-review only because screenshots can be edited.

## Recommended Flow

1. Customer creates an order.
2. BestDia gives the customer an order reference, for example `BD123456`.
3. Customer pays through KBZPay/Wave/gateway using that reference.
4. The payment provider sends a server-to-server webhook to BestDia.
5. BestDia marks the order payment as verified.
6. Admin or MXShop auto top-up completes the order.

## Webhook Endpoint

Use this endpoint for provider callbacks:

```txt
https://YOUR_SITE.pages.dev/api/payment-webhook
```

The webhook accepts JSON and looks for an order reference in any of these fields:

```txt
orderId
order_id
reference
client_reference
merchant_reference
data.client_reference
data.custom_fields.order_id
data.custom_fields.account_number
```

It treats these statuses as paid:

```txt
paid
success
succeeded
complete
completed
payment_success
merchant.payment_received
checkout.session.completed
```

## Required Environment Variables

```txt
PAYMENT_WEBHOOK_SECRET=random-long-secret
FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
```

Optional, for Telegram payment alerts:

```txt
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
```

The provider should send either:

```txt
Authorization: Bearer PAYMENT_WEBHOOK_SECRET
```

or:

```txt
X-BestDia-Secret: PAYMENT_WEBHOOK_SECRET
```

## KBZPay / Wave Notes

- If KBZPay or Wave gives you official merchant API/webhook access, use this webhook endpoint.
- If they only provide a static merchant QR and screenshots, do not auto-deliver. Keep manual admin approval.
- If using a payment gateway that supports KBZPay/Wave, configure its webhook to include the BestDia order ID as the reference.
