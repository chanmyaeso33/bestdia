# BestDia balance security migration (Firestore)

This project uses Firestore through server-side service-account calls; the existing SQL files are unrelated marketing tables and are not the Balance datastore.

## Safe rollout

1. Set `ACCOUNT_SESSION_SECRET` in the Netlify environment to a long random value before deploying. Existing customers must log in again; this intentionally prevents the former client-supplied account-ID authorization.
2. Deploy the API. New `balance_topups` records include `verificationStatus`, `balanceCreditStatus`, `reviewRequired`, `submittedAt`, `expiresAt`, a slip fingerprint, and verification metadata. Existing records remain readable: missing status fields are treated as their legacy `status`.
3. Firestore collections created on demand: `balance_ledger` (append-only by server convention) and `admin_audit_logs`. Do not grant browser clients direct write access to `account_balances`, `balance_topups`, `balance_ledger`, or audit logs.
4. Retain existing `balance_topups` and `account_balances`; do not backfill legacy rows as credited without reconciling them first. For a legacy confirmed record, manually create/reconcile its ledger entry under a controlled admin run.

## Firestore security rules

This app accesses Firestore only with a service account. If direct client Firebase SDK access is ever enabled, deny client writes to the collections above and allow reads only through authenticated, owner-scoped APIs. The API remains the sole authority for credit, reversal, balance status, and audit writes.
