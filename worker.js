// The Worker behind theorder.robertnaanos.com.
// Requests to /api/* and /auth/* are answered here, from the D1 database
// (env.DB) and Google sign-in. Everything else is the static site in the
// public folder.

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) {
      return handleDynamic(request, env, url);
    }
    return env.ASSETS.fetch(request);   // static site
  }
};

// ==================== Routing ====================

// Fixed routes, and the function that answers each method on them.
const ROUTES = {
  "/api/me": { GET: getMe },
  "/api/search": { GET: search },
  "/api/restaurants": { POST: addRestaurant },
  "/api/my-orders": { GET: getMyOrders },
  "/auth/google": { GET: startGoogleSignIn },
  "/auth/google/callback": { GET: finishGoogleSignIn },
  "/auth/logout": { POST: logout }
};

// Routes with a restaurant ID in the path: /api/restaurants/:id[/my-order]
const RESTAURANT_PATH = /^\/api\/restaurants\/([^/]+)(\/my-order)?$/;
const RESTAURANT_ROUTES = {
  "": { GET: getRestaurant },
  "/my-order": { GET: getMyOrder, PUT: saveMyOrder, DELETE: deleteMyOrder }
};

async function handleDynamic(request, env, url) {
  let route = ROUTES[url.pathname];
  const params = {};
  if (!route) {
    const match = url.pathname.match(RESTAURANT_PATH);
    if (match) {
      route = RESTAURANT_ROUTES[match[2] || ""];
      params.id = match[1];
    }
  }
  if (!route) {
    return jsonError(404, "Not found");
  }
  const handler = route[request.method];
  if (!handler) {
    return jsonError(405, "Method not allowed");
  }

  // Anything that changes data must come from our own pages. Browsers always
  // send Origin on POST/PUT/DELETE, so a mismatch means another site is
  // trying to act with this user's cookie.
  if (request.method !== "GET") {
    const origin = request.headers.get("origin");
    if (origin && origin !== url.origin) {
      return jsonError(403, "Cross-site request refused");
    }
  }

  try {
    const user = await currentUser(request, env);
    return await handler({ request, env, url, params, user });
  } catch (error) {
    if (error instanceof HttpError) {
      return jsonError(error.status, error.message);
    }
    console.error(error);
    return jsonError(500, "Server error");
  }
}

// ==================== Helpers ====================

// Thrown anywhere in a handler to send back a JSON error with that status.
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function jsonError(status, message) {
  return Response.json({ error: message }, { status });
}

function requireUser(user) {
  if (!user) {
    throw new HttpError(401, "Sign in first");
  }
  return user;
}

const MAX_BODY_BYTES = 16 * 1024;

// Read the request body as a JSON object, or throw a 400/413 explaining why not.
async function readBody(request) {
  const type = request.headers.get("content-type") || "";
  if (!type.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "Send JSON (Content-Type: application/json)");
  }
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    throw new HttpError(413, "Request is too large");
  }
  let body;
  try {
    body = JSON.parse(text);
  } catch (error) {
    throw new HttpError(400, "Body is not valid JSON");
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "Body must be a JSON object");
  }
  return body;
}

// Clean up one text field: must be a string (or missing), trimmed, with
// control characters removed, no longer than max. Returns null when an
// optional field is empty.
function cleanText(value, label, { max, required = false, multiline = false }) {
  if (value === undefined || value === null) {
    value = "";
  }
  if (typeof value !== "string") {
    throw new HttpError(400, `${label} must be text`);
  }
  value = multiline
    ? value.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "")
    : value.replace(/[\u0000-\u001f\u007f]/g, " ");
  value = value.trim();
  if (!value) {
    if (required) {
      throw new HttpError(400, `${label} is required`);
    }
    return null;
  }
  if (value.length > max) {
    throw new HttpError(400, `${label} must be ${max} characters or fewer`);
  }
  return value;
}

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Look up the restaurant named in the URL, or throw a 404.
async function findRestaurant(env, id) {
  if (!ID_PATTERN.test(id)) {
    throw new HttpError(404, "Restaurant not found");
  }
  const restaurant = await env.DB.prepare(
    "SELECT id, name, address, city, cuisine, created_at FROM restaurants WHERE id = ?"
  ).bind(id).first();
  if (!restaurant) {
    throw new HttpError(404, "Restaurant not found");
  }
  return restaurant;
}

// Turn a top_orders row into the shape the front end gets.
function orderOut(row) {
  let items = [];
  try {
    const parsed = JSON.parse(row.items);
    if (Array.isArray(parsed)) {
      items = parsed.filter((item) => typeof item === "string");
    }
  } catch (error) {
    // A malformed row shows as an order with no dishes rather than crashing.
  }
  const order = {
    id: row.id,
    restaurant_id: row.restaurant_id,
    title: row.title,
    items,
    notes: row.notes,
    is_public: row.is_public === 1,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
  if ("display_name" in row) order.display_name = row.display_name || "Anonymous";
  if ("restaurant_name" in row) {
    order.restaurant = { id: row.restaurant_id, name: row.restaurant_name, city: row.restaurant_city };
  }
  return order;
}

// Escape % and _ so a search for "100%" means the text, not a wildcard.
function likePattern(text) {
  return "%" + text.replace(/[\\%_]/g, (c) => "\\" + c) + "%";
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ==================== Sessions & cookies ====================

const SESSION_COOKIE = "theorder_session";
const SESSION_DAYS = 30;

function readCookie(request, name) {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) {
      return rest.join("=");
    }
  }
  return null;
}

// Build a Set-Cookie value. Secure is added on https only, so plain
// http://localhost under `wrangler dev` still works in every browser.
function cookie(url, name, value, { maxAge, path = "/" }) {
  const parts = [`${name}=${value}`, `Path=${path}`, `Max-Age=${maxAge}`, "HttpOnly", "SameSite=Lax"];
  if (url.protocol === "https:") {
    parts.push("Secure");
  }
  return parts.join("; ");
}

// The signed-in user for this request, or null. Expired sessions are deleted.
async function currentUser(request, env) {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token || !/^[0-9a-f]{64}$/.test(token)) {
    return null;
  }
  const row = await env.DB.prepare(
    `SELECT users.id, users.display_name, sessions.expires_at > datetime('now') AS live
       FROM sessions JOIN users ON users.id = sessions.user_id
      WHERE sessions.id = ?`
  ).bind(token).first();
  if (!row) {
    return null;
  }
  if (!row.live) {
    await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(token).run();
    return null;
  }
  return { id: row.id, display_name: row.display_name, session_id: token };
}

// ==================== Google sign-in ====================

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const STATE_COOKIE = "theorder_oauth_state";
const RETURN_COOKIE = "theorder_oauth_return";

function googleConfigured(env) {
  // GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are Worker secrets (set with
  // `npx wrangler secret put`, or .dev.vars locally), never written in code.
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new HttpError(500, "Google sign-in is not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET missing)");
  }
}

function redirectUri(url) {
  return `${url.origin}/auth/google/callback`;
}

// Only allow sending people back to a page on this site after sign-in.
function safeReturnPath(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return "/";
  }
  return value.slice(0, 500);
}

function redirect(location, cookies = []) {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store" });
  for (const c of cookies) {
    headers.append("Set-Cookie", c);
  }
  return new Response(null, { status: 302, headers });
}

// GET /auth/google?return_to=/restaurant?id=...
async function startGoogleSignIn({ env, url }) {
  googleConfigured(env);
  const state = randomToken();
  const returnTo = safeReturnPath(url.searchParams.get("return_to"));
  const google = new URL(GOOGLE_AUTH_URL);
  google.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
  google.searchParams.set("redirect_uri", redirectUri(url));
  google.searchParams.set("response_type", "code");
  google.searchParams.set("scope", "openid email profile");
  google.searchParams.set("state", state);
  // Always show the account chooser, so switching Google accounts is easy.
  google.searchParams.set("prompt", "select_account");
  return redirect(google.toString(), [
    cookie(url, STATE_COOKIE, state, { maxAge: 600, path: "/auth" }),
    cookie(url, RETURN_COOKIE, encodeURIComponent(returnTo), { maxAge: 600, path: "/auth" })
  ]);
}

// GET /auth/google/callback?code=...&state=...
async function finishGoogleSignIn({ env, url, request }) {
  googleConfigured(env);
  const clearOauthCookies = [
    cookie(url, STATE_COOKIE, "", { maxAge: 0, path: "/auth" }),
    cookie(url, RETURN_COOKIE, "", { maxAge: 0, path: "/auth" })
  ];
  const fail = () => redirect("/?signin=failed", clearOauthCookies);

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expectedState = readCookie(request, STATE_COOKIE);
  if (url.searchParams.get("error") || !code || !state || !expectedState || state !== expectedState) {
    return fail();
  }

  let tokens;
  try {
    const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri(url),
        grant_type: "authorization_code"
      })
    });
    if (!tokenResponse.ok) {
      console.error("Google token exchange failed", tokenResponse.status, await tokenResponse.text());
      return fail();
    }
    tokens = await tokenResponse.json();
  } catch (error) {
    console.error("Google token exchange failed", error);
    return fail();
  }

  // The ID token came straight from Google over TLS in exchange for our
  // client secret, so its signature doesn't need re-checking here; we still
  // check it was issued to this app and hasn't expired.
  const profile = decodeJwtPayload(tokens.id_token);
  if (
    !profile ||
    !["https://accounts.google.com", "accounts.google.com"].includes(profile.iss) ||
    profile.aud !== env.GOOGLE_CLIENT_ID ||
    typeof profile.sub !== "string" ||
    !(profile.exp * 1000 > Date.now())
  ) {
    return fail();
  }

  const email = typeof profile.email === "string" ? profile.email.slice(0, 200) : null;
  const displayName =
    (typeof profile.name === "string" && profile.name.trim().slice(0, 60)) ||
    (email && email.split("@")[0].slice(0, 60)) ||
    "Anonymous";

  // First sign-in creates the user; later sign-ins refresh their name/email.
  await env.DB.prepare(
    `INSERT INTO users (id, google_sub, email, display_name) VALUES (?, ?, ?, ?)
     ON CONFLICT (google_sub) DO UPDATE SET email = excluded.email, display_name = excluded.display_name`
  ).bind(crypto.randomUUID(), profile.sub, email, displayName).run();
  const user = await env.DB.prepare("SELECT id FROM users WHERE google_sub = ?").bind(profile.sub).first();

  const sessionId = randomToken();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND expires_at <= datetime('now')").bind(user.id),
    env.DB.prepare(
      `INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, datetime('now', '+${SESSION_DAYS} days'))`
    ).bind(sessionId, user.id)
  ]);

  let returnTo = "/";
  try {
    returnTo = safeReturnPath(decodeURIComponent(readCookie(request, RETURN_COOKIE) || "/"));
  } catch (error) {
    // Garbled cookie: just go home.
  }
  return redirect(returnTo, [
    ...clearOauthCookies,
    cookie(url, SESSION_COOKIE, sessionId, { maxAge: SESSION_DAYS * 24 * 60 * 60 })
  ]);
}

function decodeJwtPayload(jwt) {
  try {
    const payload = jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    return null;
  }
}

// POST /auth/logout
async function logout({ env, url, user }) {
  if (user) {
    await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(user.session_id).run();
  }
  const headers = new Headers({ "Cache-Control": "no-store" });
  headers.append("Set-Cookie", cookie(url, SESSION_COOKIE, "", { maxAge: 0 }));
  return Response.json({ ok: true }, { headers });
}

// ==================== API handlers ====================

// GET /api/me — who is signed in (null when nobody). Lets pages show the
// right buttons; not in SPEC.md's list but needed by every screen.
async function getMe({ user }) {
  return Response.json(
    { user: user ? { id: user.id, display_name: user.display_name } : null },
    { headers: { "Cache-Control": "no-store" } }
  );
}

// GET /api/search?q=&city=
// q matches name, city or cuisine; city narrows by city. Open to everyone.
async function search({ env, url }) {
  const q = cleanText(url.searchParams.get("q"), "Search", { max: 100 });
  const city = cleanText(url.searchParams.get("city"), "City", { max: 80 });
  if (!q && !city) {
    throw new HttpError(400, "Type a restaurant name or city");
  }
  const where = [];
  const binds = [];
  if (q) {
    where.push("(name LIKE ?1 ESCAPE '\\' OR city LIKE ?1 ESCAPE '\\' OR cuisine LIKE ?1 ESCAPE '\\')");
    binds.push(likePattern(q));
  } else {
    binds.push(null);
  }
  if (city) {
    where.push("city LIKE ?2 ESCAPE '\\'");
    binds.push(likePattern(city));
  }
  const { results } = await env.DB.prepare(
    `SELECT id, name, address, city, cuisine,
            (SELECT COUNT(*) FROM top_orders o WHERE o.restaurant_id = restaurants.id AND o.is_public = 1) AS order_count
       FROM restaurants
      WHERE ${where.join(" AND ")}
      ORDER BY name COLLATE NOCASE, city COLLATE NOCASE
      LIMIT 50`
  ).bind(...binds).all();
  return Response.json({ results });
}

// POST /api/restaurants  { name, city, address?, cuisine? }  (login required)
async function addRestaurant({ request, env, user }) {
  requireUser(user);
  const body = await readBody(request);
  const name = cleanText(body.name, "Name", { max: 100, required: true });
  const city = cleanText(body.city, "City", { max: 80, required: true });
  const address = cleanText(body.address, "Address", { max: 200 });
  const cuisine = cleanText(body.cuisine, "Cuisine", { max: 50 });

  // Same name in the same city is almost certainly the same place.
  const existing = await env.DB.prepare(
    "SELECT id FROM restaurants WHERE lower(name) = lower(?) AND lower(city) = lower(?)"
  ).bind(name, city).first();
  if (existing) {
    return Response.json(
      { error: "That restaurant is already listed", id: existing.id },
      { status: 409 }
    );
  }

  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO restaurants (id, name, address, city, cuisine, created_by) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(id, name, address, city, cuisine, user.id).run();
  const restaurant = await findRestaurant(env, id);
  return Response.json({ restaurant }, { status: 201 });
}

// GET /api/restaurants/:id — the restaurant plus other people's public orders.
async function getRestaurant({ env, params, user }) {
  const restaurant = await findRestaurant(env, params.id);
  const { results } = await env.DB.prepare(
    `SELECT o.*, u.display_name
       FROM top_orders o JOIN users u ON u.id = o.user_id
      WHERE o.restaurant_id = ? AND o.is_public = 1 AND o.user_id != ?
      ORDER BY o.updated_at DESC
      LIMIT 200`
  ).bind(restaurant.id, user ? user.id : "").all();
  return Response.json({ restaurant, community_orders: results.map(orderOut) });
}

// GET /api/restaurants/:id/my-order
async function getMyOrder({ env, params, user }) {
  requireUser(user);
  const restaurant = await findRestaurant(env, params.id);
  const row = await env.DB.prepare(
    "SELECT * FROM top_orders WHERE user_id = ? AND restaurant_id = ?"
  ).bind(user.id, restaurant.id).first();
  return Response.json({ restaurant, order: row ? orderOut(row) : null });
}

const MAX_DISHES = 20;

// PUT /api/restaurants/:id/my-order  { title?, items: [..], notes?, is_public? }
async function saveMyOrder({ request, env, params, user }) {
  requireUser(user);
  const restaurant = await findRestaurant(env, params.id);
  const body = await readBody(request);

  const title = cleanText(body.title, "Title", { max: 80 }) || "My usual";
  if (!Array.isArray(body.items)) {
    throw new HttpError(400, "Items must be a list of dishes");
  }
  const items = body.items
    .map((item, i) => cleanText(item, `Dish ${i + 1}`, { max: 200 }))
    .filter(Boolean);
  if (items.length === 0) {
    throw new HttpError(400, "Add at least one dish");
  }
  if (items.length > MAX_DISHES) {
    throw new HttpError(400, `${MAX_DISHES} dishes at most`);
  }
  const notes = cleanText(body.notes, "Notes", { max: 1000, multiline: true });
  if (body.is_public !== undefined && typeof body.is_public !== "boolean") {
    throw new HttpError(400, "is_public must be true or false");
  }
  const isPublic = body.is_public === false ? 0 : 1;

  await env.DB.prepare(
    `INSERT INTO top_orders (id, user_id, restaurant_id, title, items, notes, is_public)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, restaurant_id) DO UPDATE SET
       title = excluded.title, items = excluded.items, notes = excluded.notes,
       is_public = excluded.is_public, updated_at = datetime('now')`
  ).bind(crypto.randomUUID(), user.id, restaurant.id, title, JSON.stringify(items), notes, isPublic).run();

  const row = await env.DB.prepare(
    "SELECT * FROM top_orders WHERE user_id = ? AND restaurant_id = ?"
  ).bind(user.id, restaurant.id).first();
  return Response.json({ order: orderOut(row) });
}

// DELETE /api/restaurants/:id/my-order
async function deleteMyOrder({ env, params, user }) {
  requireUser(user);
  const restaurant = await findRestaurant(env, params.id);
  const result = await env.DB.prepare(
    "DELETE FROM top_orders WHERE user_id = ? AND restaurant_id = ?"
  ).bind(user.id, restaurant.id).run();
  if (!result.meta.changes) {
    throw new HttpError(404, "You don't have an order here");
  }
  return Response.json({ ok: true });
}

// GET /api/my-orders — every order you've saved, newest first.
async function getMyOrders({ env, user }) {
  requireUser(user);
  const { results } = await env.DB.prepare(
    `SELECT o.*, r.name AS restaurant_name, r.city AS restaurant_city
       FROM top_orders o JOIN restaurants r ON r.id = o.restaurant_id
      WHERE o.user_id = ?
      ORDER BY o.updated_at DESC, o.created_at DESC`
  ).bind(user.id).all();
  return Response.json({ orders: results.map(orderOut) });
}
