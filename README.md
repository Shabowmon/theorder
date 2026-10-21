# TheOrder

Don't read 400 reviews. See what people actually order.

A Yelp-like app that stores people's go-to orders at restaurants instead of
reviews. Cloudflare Worker + D1 + plain HTML/CSS/JS, no build step.
The full design is in [SPEC.md](SPEC.md).

```
worker.js        API (/api/*) and Google sign-in (/auth/*)
schema.sql       D1 tables (users, sessions, restaurants, top_orders)
wrangler.toml    Worker config + D1 binding
public/          the static site: index (search), restaurant, order (add/edit), my-orders
```

## One-time setup

### 1. Google OAuth client

1. Google Cloud Console → **APIs & Services → OAuth consent screen**: set it up
   (External). While it's in **Testing** mode, only accounts listed under
   **Test users** can sign in — add **both** Google accounts you'll test with.
2. **APIs & Services → Credentials → Create credentials → OAuth client ID**,
   type **Web application**.
3. Under **Authorized redirect URIs** add both:
   - `http://localhost:8787/auth/google/callback` (local dev)
   - `https://theorder.robertnaanos.com/auth/google/callback` (production)
4. Keep the client ID and client secret handy for step 4.

### 2. Create the D1 database

```bash
npx wrangler d1 create theorder
```

Paste the `database_id` it prints into `wrangler.toml` (replacing
`REPLACE_WITH_D1_DATABASE_ID`).

### 3. Apply the schema

```bash
npx wrangler d1 execute theorder --local  --file=schema.sql   # for wrangler dev
npx wrangler d1 execute theorder --remote --file=schema.sql   # production
```

### 4. Google secrets (never committed)

Production:

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

Local dev reads them from `.dev.vars` (already gitignored):

```bash
cp .dev.vars.example .dev.vars   # then paste in the real values
```

## Run locally

```bash
npx wrangler dev
```

Open **http://localhost:8787**. Use `localhost`, not `127.0.0.1` — the
sign-in redirect is built from the address you're on, and Google only
accepts the one you registered.

Test loop: sign in → search → add a restaurant → save your order → log out →
sign in with the second account (Google shows the account chooser every time)
→ open the restaurant → **Community** tab shows the first account's order.

## Deploy

Follow the "Deploy" section of SPEC.md (new-site.sh, Connect to Git with
deploy command `npx wrangler deploy`, custom domain `theorder.robertnaanos.com`).
