// Restaurant page: two tabs — My Order (yours only) and Community
// (everyone else's public orders).

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const restaurantId = params.get("id") || "";

function selectTab(name) {
  for (const tab of ["mine", "community"]) {
    const on = tab === name;
    $("tab-" + tab).setAttribute("aria-selected", String(on));
    $("panel-" + tab).hidden = !on;
  }
  const url = new URL(location.href);
  url.searchParams.set("tab", name);
  history.replaceState(null, "", url);
}

$("tab-mine").addEventListener("click", () => selectTab("mine"));
$("tab-community").addEventListener("click", () => selectTab("community"));

function editHref() {
  return `/order?id=${encodeURIComponent(restaurantId)}`;
}

async function renderMine() {
  const panel = $("panel-mine");
  const user = await getMe();
  if (!user) {
    panel.innerHTML = `
      <p class="empty">Sign in to save your go-to order here.</p>
      <div class="actions">${signInButton()}</div>`;
    return;
  }
  panel.innerHTML = `<p class="dim empty">LOADING...</p>`;
  try {
    const { order } = await api(`/api/restaurants/${encodeURIComponent(restaurantId)}/my-order`);
    if (!order) {
      panel.innerHTML = `
        <p class="empty">You haven't saved an order here yet.</p>
        <div class="actions"><a class="btn primary" href="${editHref()}">[ SAVE YOUR ORDER ]</a></div>`;
      return;
    }
    panel.innerHTML = `
      <div class="card">${orderCard(order)}</div>
      <div class="actions">
        <a class="btn primary" href="${editHref()}">[ EDIT ]</a>
        <button class="btn danger" type="button" id="delete">[ DELETE ]</button>
      </div>
      <p class="error" id="delete-error" hidden></p>`;
    $("delete").addEventListener("click", deleteMine);
  } catch (error) {
    panel.innerHTML = `<p class="error">${esc(error.message)}</p>`;
  }
}

async function deleteMine() {
  if (!confirm("Delete your order for this restaurant?")) return;
  try {
    await api(`/api/restaurants/${encodeURIComponent(restaurantId)}/my-order`, { method: "DELETE" });
    renderMine();
  } catch (error) {
    $("delete-error").textContent = error.message;
    $("delete-error").hidden = false;
  }
}

function renderCommunity(orders) {
  $("tab-community").textContent = `[ COMMUNITY (${orders.length}) ]`;
  $("panel-community").innerHTML = orders.length
    ? orders.map((o) => `<div class="card">${orderCard(o, { showWho: true })}</div>`).join("")
    : `<p class="empty">No community orders yet. Save yours and be the first.</p>`;
}

async function load() {
  try {
    const { restaurant, community_orders } = await api(`/api/restaurants/${encodeURIComponent(restaurantId)}`);
    document.title = `${restaurant.name} · TheOrder`;
    $("r-name").textContent = restaurant.name;
    $("r-meta").innerHTML = restaurantMeta(restaurant);
    if (restaurant.address) {
      $("r-address").textContent = restaurant.address;
      $("r-address").hidden = false;
    }
    renderCommunity(community_orders);
    $("loading").hidden = true;
    $("restaurant").hidden = false;
    selectTab(params.get("tab") === "community" ? "community" : "mine");
    renderMine();
  } catch (error) {
    $("loading").hidden = true;
    $("page-error").textContent = error.message;
    $("page-error").hidden = false;
  }
}

load();
