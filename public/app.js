// Shared helpers for every page: talking to the API, the header bar,
// and small bits of HTML building.

// Call the Worker API. Resolves to the JSON body; rejects with an Error
// whose message is the server's JSON error (and .status set).
async function api(path, { method = "GET", body } = {}) {
  const options = { method, headers: {} };
  if (body !== undefined) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  let response;
  try {
    response = await fetch(path, options);
  } catch (error) {
    throw Object.assign(new Error("Can't reach the server. Check your connection."), { status: 0 });
  }
  let data = {};
  try {
    data = await response.json();
  } catch (error) {
    // Non-JSON reply; fall through with an empty body.
  }
  if (!response.ok) {
    throw Object.assign(new Error(data.error || `Request failed (${response.status})`), {
      status: response.status,
      data
    });
  }
  return data;
}

// Escape text for safe use inside HTML we build with template strings.
function esc(text) {
  return String(text ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}

function signInHref(returnTo = location.pathname + location.search) {
  return "/auth/google?return_to=" + encodeURIComponent(returnTo);
}

function signInButton(text = "SIGN IN WITH GOOGLE") {
  return `<a class="btn primary" href="${esc(signInHref())}">[ ${esc(text)} ]</a>`;
}

// Who's signed in (or null). Fetched once per page.
let mePromise;
function getMe() {
  mePromise ||= api("/api/me").then((d) => d.user).catch(() => null);
  return mePromise;
}

async function logout() {
  try {
    await api("/auth/logout", { method: "POST" });
  } finally {
    location.href = "/";
  }
}

// Fill in the <header class="top"> on every page.
async function renderHeader() {
  const header = document.querySelector("header.top");
  header.innerHTML = `
    <div class="wrap">
      <a class="logo" href="/">THE ORDER<span class="cursor">_</span></a>
      <nav class="nav" id="nav"></nav>
    </div>`;
  const user = await getMe();
  const nav = header.querySelector("#nav");
  if (user) {
    nav.innerHTML = `
      <a class="btn" href="/">[ SEARCH ]</a>
      <a class="btn" href="/my-orders">[ MY ORDERS ]</a>
      <button class="btn" type="button" id="logout">[ LOG OUT ]</button>`;
    nav.querySelector("#logout").addEventListener("click", logout);
  } else {
    nav.innerHTML = `
      <a class="btn" href="/">[ SEARCH ]</a>
      <a class="btn" href="${esc(signInHref())}">[ SIGN IN ]</a>`;
  }
}

// One order as a card. Used on the restaurant page and My Orders.
function orderCard(order, { showWho = false } = {}) {
  const who = showWho ? `<div class="who">${esc(order.display_name)}</div>` : "";
  const privateTag = !order.is_public ? ` <span class="badge">PRIVATE</span>` : "";
  const notes = order.notes ? `<div class="notes">${esc(order.notes)}</div>` : "";
  return `
    ${who}
    <div class="title">${esc(order.title)}${privateTag}</div>
    <ul class="items">${order.items.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>
    ${notes}`;
}

function restaurantMeta(r) {
  return [r.cuisine, r.city].filter(Boolean).map(esc).join(" · ");
}

renderHeader();
