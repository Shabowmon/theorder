# TheOrder — v1 Spec

**What is it?** A Yelp-like app with one twist: it doesn't collect reviews, it collects *orders*.
You find a restaurant, then you see the only two things you actually want to know:

1. **My Order** — your saved go-to order at that place ("the usual")
2. **Community Orders** — other people's go-to orders at that same place

Tagline idea: *"Don't read 400 reviews. See what people actually order."*

- **Live address:** `theorder.robertnaanos.com`
- **Repo:** `Shabowmon/theorder`
- **Folder on Fedora:** `~/Projects/web/theorder/`
- **Stack (same as your fleet):** Cloudflare Worker + D1 database + plain HTML/CSS/JS front end

---

## Look & feel — old school computer (Robert's call, 2026-10-20)

**The vibe is an old terminal / DOS menu, not a modern app.** Nothing sleek,
nothing rounded-and-gradient. Think BBS screens and 80s computer menus.

**Fonts (load both from Google Fonts):**

- **VT323** — display only: the logo, page headings, the 👑 THE Order badge.
  It's a pixelated CRT-terminal font — instantly old school. Headings only,
  big sizes: at small sizes it gets hard to read.
- **IBM Plex Mono** — everything else: body text, order items, buttons, forms.
  Monospace with real heritage (IBM), and it stays readable at phone sizes.
- Fallback stack: `"Courier New", Courier, monospace` if the webfonts fail.
- **Banned:** any modern sans-serif (Inter, Roboto, system-ui, Helvetica...).
  If it looks like a 2024 startup landing page, it's wrong.

**Styling rules that go with the fonts:**

- Monospace everywhere — every screen should feel typed, not typeset
- Sharp square corners (no border-radius), plain 1–2px solid borders
- Flat colors, no gradients, no shadows, no blur
- Old-computer details are welcome where they're cheap: ALL-CAPS section
  labels, `[ bracketed ]` buttons like `[ SEARCH ]`, `===` divider lines,
  a blinking cursor in the logo (`THE ORDER_`)
- Readability still wins: body text ≥16px, real contrast (dark text on light
  background, or a proper green-on-black terminal theme — pick ONE and be
  consistent), generous line spacing. Old school ≠ hard to read.

---

## The restaurant-data problem (checked 2026-10-20) — read this first

Search needs a restaurant list from somewhere. Three options, checked live:

| Source | Cost | Verdict |
|---|---|---|
| **Yelp Fusion API** | $229/mo base plan (only a 30-day, 5,000-call trial is free) | ❌ No. Way too much for a v1. |
| **Google Places API** | Text Search: 5,000 free calls/mo, then $32 per 1,000. Autocomplete: 10,000 free/mo | ✅ Good — but save it for v2 |
| **Your own database** | $0 | ✅ **v1 pick** |

**v1 decision: search searches TheOrder's own database.**
Every restaurant in TheOrder was added by a user (name + city + address + cuisine).
If search finds nothing, the user gets an **"Add this restaurant"** button.
That's how the database grows — and it costs nothing, needs no API key, and can't surprise you with a bill.

**v2 upgrade (parked, don't build yet):** add Google Places autocomplete to the
"Add a restaurant" form, so name/address fill themselves in. The `restaurants`
table already has an `external_id` column waiting for the Google Place ID.

---

## Login

This is your first app where *other people* have accounts, so the old
per-device API-key trick from the workout tracker doesn't work here.

**v1 pick: "Sign in with Google" only.**
- One button, no passwords to create, store, forget, or reset (no Bitwarden repeat)
- The Worker handles Google's OAuth flow and sets a secure session cookie
- First sign-in creates the user row in D1 automatically

*Alternative if you prefer it:* Clerk (free up to 10,000 users) — faster to bolt on,
but it's one more outside account/service in the stack. The Google-on-Worker route
keeps everything in your Cloudflare world like the rest of your fleet.

---

## Data model (D1 — SQLite)

```sql
CREATE TABLE users (
  id          TEXT PRIMARY KEY,          -- random UUID
  google_sub  TEXT UNIQUE NOT NULL,      -- Google's stable user ID
  email       TEXT,
  display_name TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,           -- random token, also the cookie value
  user_id    TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE restaurants (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  address     TEXT,
  city        TEXT NOT NULL,
  cuisine     TEXT,
  external_id TEXT,                      -- Google Place ID later (v2)
  created_by  TEXT REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE top_orders (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  restaurant_id TEXT NOT NULL REFERENCES restaurants(id),
  title         TEXT NOT NULL DEFAULT 'My usual',   -- e.g. "My usual", "Date night order"
  items         TEXT NOT NULL,           -- JSON array of strings, one string per dish
                                         -- e.g. ["Pad See Ew — medium spicy, extra basil",
                                         --        "Thai iced tea, less sweet"]
  notes         TEXT,                    -- "Ask for the chili crisp on the side"
  is_public     INTEGER NOT NULL DEFAULT 1,  -- 1 = community can see it, 0 = just me
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, restaurant_id)       -- one top order per person per restaurant in v1
);
```

---

## Screens (v1 — four pages, nothing more)

1. **Home / Search**
   - Big search box: restaurant name and/or city
   - Results list → tap one to open it
   - No results → "Add this restaurant" form (name, city, address, cuisine)
   - Below: "My recent orders" shortcut list when logged in

2. **Restaurant page** — the heart of the app, two tabs:
   - **My Order tab:** your saved order for this place, or an empty state with
     "Save your order" if you haven't made one yet. Edit / delete.
   - **Community tab:** everyone else's *public* orders for this place,
     each card shows their display name, order title, items, and notes.
     Your own order is NOT repeated here.

3. **Add / Edit My Order**
   - Title field, one input per dish (add/remove dish rows), notes field
   - Public / private toggle (default public)

4. **My Orders (profile)**
   - Every top order you've saved, across all restaurants, newest first
   - Tap one → jumps to that restaurant page

Login gate: you can *browse* search + community orders logged out.
You must log in to save your own order or add a restaurant.

---

## API endpoints (on the Worker)

```
GET    /api/search?q=&city=            → restaurants matching name/city
POST   /api/restaurants                → add a restaurant (login required)
GET    /api/restaurants/:id            → restaurant + community orders
GET    /api/restaurants/:id/my-order   → your order for it (login required)
PUT    /api/restaurants/:id/my-order   → create/update your order
DELETE /api/restaurants/:id/my-order   → delete your order
GET    /api/my-orders                  → all your orders (login required)
GET    /auth/google                    → start Google sign-in
GET    /auth/google/callback         → finish sign-in, set session cookie
POST   /auth/logout
```

Rules for every endpoint: check the session cookie before touching private data,
validate every input (non-empty, sane lengths), return JSON errors — never crash.

---

## V2 — Voting: the community crowns THE Order (Robert's design, 2026-10-20)

**What it is, plain English:** in v1 the Community tab is just a list. In v2 the
list gets a winner. Every user gets **exactly 1 vote per restaurant** — not one
vote per order, one vote *total* for that restaurant — and spends it on the
single order they think is the best one. Votes are tallied per order, the
Community list sorts by score, and the top order sits at the top of the page.

### The rules

- **1 vote per user per restaurant.** Enforced in the database itself (see the
  primary key below), not just hidden in the UI — so it can't be gamed by
  tapping around.
- **You can't vote for your own order.** Your order competes on everyone else's votes.
- **Your vote can move.** Tap a different order and your vote moves there.
  Tap the order you already voted for and your vote comes back off.
- **Voting requires login.** Logged-out visitors see the counts, but the vote
  button asks them to sign in first.
- **Sorting:** vote count, highest first. Ties go to the order that was
  posted first.
- **The winner gets crowned:** the #1 order on a restaurant's page is pinned
  at the top with a **"👑 THE Order"** badge. That badge is the whole point
  of the app's name — the community's top pick literally becomes *The* Order
  for that restaurant.

### Data model addition (D1)

```sql
CREATE TABLE votes (
  user_id       TEXT NOT NULL REFERENCES users(id),
  restaurant_id TEXT NOT NULL REFERENCES restaurants(id),
  top_order_id  TEXT NOT NULL REFERENCES top_orders(id) ON DELETE CASCADE,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, restaurant_id)   -- this IS the 1-vote rule
);
```

Vote counts are computed at query time (`COUNT` grouped by `top_order_id`) —
no stored counter to drift out of sync. If an order is deleted or flipped to
private, its votes go with it.

### API additions

```
PUT    /api/restaurants/:id/vote    body: { "top_order_id": "..." }
                                    → casts your vote, or moves it if you
                                      already voted for a different order here
DELETE /api/restaurants/:id/vote    → removes your vote for this restaurant
GET    /api/restaurants/:id         → (v2 shape) every community order now
                                      includes vote_count, and the response
                                      includes your current vote, if any
```

---

## V3 — Food photos (Robert's design, 2026-10-20)

**What it is, plain English:** text tells you *what* to order; a photo tells you
whether you want it. In v3, every order can carry photos of the actual food.
When you save or edit your order, you can **take a photo with the camera or
pick one from your library**. On the Community tab, each order card shows its
photos — the first one big as a cover image, tap to see it full-size and
swipe through the rest. The 👑 THE Order at the top of the page leads with
its photo, which is what makes the crown worth winning.

### Storage: Cloudflare R2 (checked 2026-10-20)

Photos can't live in D1 (it's a database, not file storage), so they go in
Cloudflare's file storage, **R2** — same account as everything else in the fleet:

- **10 GB free storage**, 1M uploads / 10M reads free per month, **$0 egress** (no bandwidth bill, ever)
- With the resize rule below (~300 KB per photo), 10 GB ≈ **30,000+ photos** before it costs a cent
- One-time setup: `npx wrangler r2 bucket create theorder-photos`, plus an
  `[[r2_buckets]]` binding in `wrangler.toml`
- Photos are served **through the Worker** (`GET /api/photos/:id`), never a
  public bucket link — so the app can enforce the privacy rule below

### Two iPhone traps, designed around up front

1. **HEIC.** iPhone photos are HEIC files, which Chrome and Firefox *cannot
   display*. Upload them raw and half your users see broken images.
   **Fix:** before upload, the browser draws the photo onto a canvas and
   re-encodes it as JPEG. Safari can read HEIC natively, and the canvas
   export comes out as a JPEG every browser can show.
2. **Giant originals.** A raw iPhone photo is 3–5 MB — slow on restaurant
   Wi-Fi and eats the free storage 10× faster. **Fix:** that same canvas step
   shrinks the photo to **max 1600px on its longest side, JPEG quality 0.85**
   → ~200–400 KB, still plenty sharp on a phone screen.

### The rules

- **Up to 4 photos per order.** First photo = the cover shown on cards.
- **Only the order's owner** can add or delete its photos. Deleting a photo
  removes the file from R2 *and* its database row.
- **Photos follow their order's privacy.** A public order's photos are visible
  to everyone; flip the order to private and its photos stop being served to
  anyone but you. Delete the order and its photos are deleted too.
- Upload requires login (same rule as saving an order). No login, no camera button.

### Data model addition (D1)

```sql
CREATE TABLE photos (
  id           TEXT PRIMARY KEY,
  top_order_id TEXT NOT NULL REFERENCES top_orders(id) ON DELETE CASCADE,
  r2_key       TEXT NOT NULL,            -- the file's name inside the R2 bucket
  sort_order   INTEGER NOT NULL DEFAULT 0,  -- 0 = cover photo
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### API additions

```
POST   /api/orders/:orderId/photos   → upload one photo (login, owner only)
DELETE /api/photos/:photoId          → delete one photo (login, owner only)
GET    /api/photos/:photoId          → serve the image (public order: anyone;
                                       private order: owner only), long cache headers
```

On the phone, one file input does both jobs Robert asked for:
`<input type="file" accept="image/*">` offers **Take Photo / Photo Library**
on iOS — no separate camera code needed.

---

## NOT in v1 (parked — do not build in the v1 pass)

- Voting (fully designed above as v2 — build it in the second pass, not the first)
- Food photos (fully designed above as v3 — build it in the third pass)
- Google Places autocomplete / place photos / hours / ratings
- Following other users
- Copy someone's order into yours in one tap *(great v2 feature — it's the viral loop)*
- Multiple orders per person per restaurant
- Native iPhone app (this same Worker API can power it later — that's your SwiftUI bridge)

---

## Deploy (your normal loop)

Same as `~/workspace/your_files/how-to-publish-a-new-site.md`, plus the D1 steps:

1. Build in `~/Projects/web/theorder/` with Claude Code (prompt below)
2. Create the D1 database: `npx wrangler d1 create theorder` → put the ID in `wrangler.toml`
3. Apply the schema: `npx wrangler d1 execute theorder --remote --file=schema.sql`
4. Add Google OAuth secrets (never in git):
   `npx wrangler secret put GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`
   (Google Cloud Console → APIs & Services → Credentials → OAuth client,
   redirect URI: `https://theorder.robertnaanos.com/auth/google/callback`)
5. `bash ~/Projects/web/new-site.sh theorder "Initial deploy"`
6. Cloudflare → Connect to Git → deploy command `npx wrangler deploy`
7. Add custom domain `theorder.robertnaanos.com`
8. iPhone airplane-mode toggle if the subdomain won't load (negative DNS cache)

---

## Claude Code prompt (ready to paste)

Use your four-part pattern — context, rules, constraints, done-means:

```
CONTEXT
I'm building a new web app called TheOrder in this folder. It's a Yelp-like
app, but instead of reviews it stores people's go-to orders at restaurants.
Stack is my usual fleet setup: a Cloudflare Worker serving plain HTML/CSS/JS,
with a D1 (SQLite) database, deployed from this repo. The full spec is in
SPEC.md in this folder — read it before writing any code.

RULES
- Follow SPEC.md exactly for the data model, screens, and API endpoints.
- Sign-in is "Sign in with Google" only, handled by the Worker with a
  session cookie backed by the sessions table. No passwords anywhere.
- Visitors can browse search and community orders logged out. Saving an
  order or adding a restaurant requires login.
- A user sees only their own order in the "My Order" tab; the Community tab
  shows other users' public orders only.
- Validate all inputs server-side. Return JSON errors, never an unhandled crash.
- No external restaurant API in v1 — search only queries our restaurants table.
- Look & feel is OLD SCHOOL COMPUTER, per the "Look & feel" section in
  SPEC.md: VT323 (Google Fonts) for the logo/headings/badges, IBM Plex Mono
  for all body text and UI, monospace everywhere, sharp square corners,
  flat colors, no gradients or shadows, [ bracketed ] buttons. NO modern
  sans-serif fonts (no Inter/Roboto/system-ui) anywhere.

CONSTRAINTS
- Plain HTML/CSS/JS front end, no framework, no build step.
- Secrets (Google client ID/secret) come from Worker environment/secrets,
  never hardcoded, never committed.
- Include wrangler.toml (name = "theorder", with the D1 binding) and
  schema.sql with the exact tables from SPEC.md.
- Mobile-first layout — I'll mostly use this on my iPhone.

DONE MEANS
- I can run it locally with `npx wrangler dev`, sign in with Google,
  add a restaurant, save my order for it, log out, sign in as a second
  Google account, and see the first account's order in the Community tab.
- README.md in the repo lists the one-time setup steps (D1 create, schema
  apply, the two wrangler secret commands, and the Google redirect URI).
```

---

## Decisions still needed from Robert

1. **Login:** Google-only on the Worker (recommended) — or Clerk?
2. **First seed restaurants:** hand-add 5–10 Pleasanton spots you actually go to
   on day one, so the app isn't empty when you open it.
