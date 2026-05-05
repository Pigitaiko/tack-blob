# Tack Short — sub-month pin TTL for Tack

This branch is a feature proposal for [`kimo-ice/tack`](https://github.com/kimo-ice/tack): an optional `ttl_seconds` field on `POST /pins` so an agent can pin content for **5 minutes to 30 days** instead of the current 1–24 month minimum, with auto-cleanup and a permanent receipt.

> **Live design overview:** **<https://pigitaiko.github.io/tack-blob/>**
>
> Source: [`index.html`](./index.html). To enable the live site (one-time, owner-only), open **Settings → Pages** on this repo, set _Source_ to **Deploy from a branch**, pick branch **`feat/pin-ttl`** + folder **`/ (root)`**, and click **Save**. The first build takes ~30s.

## What this PR adds

| | Before this PR | With this PR |
|---|---|---|
| Minimum pin lifetime | 1 month | 5 minutes |
| Auto-cleanup | Manual `DELETE /pins/:id` | Background sweeper |
| Receipt after expiry | Pin row remains | Pin row remains **+** `GET /ipfs/:cid` returns `410` with `{ receipt: { cid, requestid, expiredAt } }` |
| Pricing | $0.001 base + $0.001/MB | Unchanged |
| Auth model | Wallet-as-identity (x402) | Unchanged |
| New routes | — | None — extends `POST /pins` and `POST /pins/:requestid` with one body field |

The feature is opt-in: omit `ttl_seconds` and pins behave exactly as they do on `main` today.

## API additions

```bash
curl -X POST https://tack-api-production.up.railway.app/pins \
  -H 'content-type: application/json' \
  -H 'payment-signature: <x402-payment-signature>' \
  -d '{"cid":"bafybeigdyrzt...","name":"handoff","ttl_seconds":1800}'
```

Response (202):

```json
{
  "requestid": "9c1e...",
  "status": "pinned",
  "pin": { "cid": "bafybeigdyrzt...", "name": "handoff" },
  "expiresAt": 1746401800
}
```

After expiry, `GET /ipfs/<cid>` (when no other active pin references the CID):

```
HTTP/1.1 410 Gone
Content-Type: application/json

{
  "error": "Content for CID bafybeigdyrzt... expired at 1746401800",
  "receipt": {
    "cid": "bafybeigdyrzt...",
    "requestid": "9c1e...",
    "expiredAt": 1746401800
  }
}
```

`GET /pins/:requestid` keeps returning the row (with `expiredAt` populated) so the wallet's audit trail is preserved.

The agent card at `/.well-known/agent.json` advertises:

```json
{
  "capabilities": {
    "pinningApi": {
      "ttl": {
        "field": "ttl_seconds",
        "minSeconds": 300,
        "maxSeconds": 2592000,
        "expiredStatus": 410
      }
    },
    "gateway": { "supports": ["expired-410", ...] }
  }
}
```

## How it works

- `POST /pins` validates `ttl_seconds` against bounds (`PIN_TTL_MIN_SECONDS`–`PIN_TTL_MAX_SECONDS`, default 300–2,592,000), stores `expiresAt` on the row.
- `TtlSweeper` runs every `PIN_TTL_SWEEP_INTERVAL_MS` (default 60s), batches `PIN_TTL_SWEEP_BATCH_SIZE` due rows (default 100), calls `pin rm` on Kubo + replicas, stamps `expiredAt`. The unpin is skipped when another active pin references the same CID — matching Kubo's pin-counter semantics.
- DB migration adds `expires_at` and `expired_at` columns plus an index, idempotently via `PRAGMA table_info`.

## Configuration (env, all optional)

| Variable | Default | Description |
|---|---|---|
| `PIN_TTL_MIN_SECONDS` | `300` | Minimum accepted `ttl_seconds` (5 minutes) |
| `PIN_TTL_MAX_SECONDS` | `2592000` | Maximum accepted `ttl_seconds` (30 days) |
| `PIN_TTL_SWEEP_INTERVAL_MS` | `60000` | Sweeper tick interval |
| `PIN_TTL_SWEEP_BATCH_SIZE` | `100` | Maximum rows expired per tick |

## Diff summary

12 files, +573 / −41.

| File | Change |
|---|---|
| `src/types.ts` | `expiresAt`/`expiredAt` on `StoredPinRecord` and `PinStatusResponse` |
| `src/db.ts` | Idempotent migration for new columns + index |
| `src/repositories/pin-repository.ts` | Read/write new columns; `findExpiringBefore`, `hasOtherActivePinForCid` |
| `src/services/pinning-service.ts` | TTL validation, `expirePin`, gateway 410 path |
| `src/services/ttl-sweeper.ts` (new) | Background expiry loop |
| `src/lib/errors.ts` | `GoneError` |
| `src/app.ts` | Parse `ttl_seconds`; 410 on `GoneError`; agent card advertises bounds |
| `src/config.ts` | TTL bound + sweeper env vars |
| `src/index.ts` | Wire sweeper start/stop |
| `tests/unit/pinning-service.test.ts` | 8 new TTL cases |
| `tests/unit/ttl-sweeper.test.ts` (new) | 3 sweeper cases |
| `README.md` | This file (fork-side overview) |

Verified: `tsc --noEmit` clean, `eslint . --ext .ts` clean, `vitest run` 59/59 passing (37 pre-existing + 8 new pinning-service TTL + 3 sweeper + the original 22 integration tests untouched).

## Why this scope

The original concept that led to this branch was framed as "EIP-4844 blob storage with KZG commitments and 5-minute TTL." That framing didn't survive review — EIP-4844 retention is fixed at ~18 days on L1, the chains marketed as targets (Taiko, Base) consume blobs rather than produce them, and the proposed price floor was 2–4 orders of magnitude below what L1 blob gas actually costs. See the `tack-short.html` page for the reframed proposal.

The actual gap worth closing is much simpler: Tack today has a 1-month floor, and agents want shorter. This PR closes that gap with the smallest reasonable diff, leaving pricing decisions for a separate change once usage data exists.

## Running locally

This branch is a superset of upstream `kimo-ice/tack`. Use the upstream development instructions:

```bash
git clone https://github.com/kimo-ice/tack
cd tack
git fetch https://github.com/Pigitaiko/tack-blob feat/pin-ttl
git checkout FETCH_HEAD
pnpm install
cp .env.example .env
pnpm dev
```

Optional new env vars listed above; defaults are sensible.

## License

MIT — same as upstream Tack.
