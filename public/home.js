// Home / Search: search box, results, "add this restaurant", recent orders.

const $ = (id) => document.getElementById(id);

function show(el, on = true) { el.hidden = !on; }

function setError(el, message) {
  el.textContent = message || "";
  show(el, Boolean(message));
}

async function runSearch(q, city) {
  show($("results"));
  setError($("search-error"), "");
  $("result-list").innerHTML = `<li class="dim empty">SEARCHING...</li>`;
  show($("none"), false);
  show($("not-listed"), false);
  show($("add"), false);

  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (city) params.set("city", city);
  history.replaceState(null, "", "/?" + params);

  try {
    const { results } = await api("/api/search?" + params);
    $("result-list").innerHTML = results.map((r) => `
      <li><a class="row-link" href="/restaurant?id=${encodeURIComponent(r.id)}">
        <span class="name">${esc(r.name)}</span>
        <span class="dim"> — ${restaurantMeta(r)}</span><br>
        <span class="dim">${r.order_count} order${r.order_count === 1 ? "" : "s"}</span>
      </a></li>`).join("");
    if (results.length === 0) {
      show($("none"));
      openAddForm(q, city);
    } else {
      show($("not-listed"));
    }
  } catch (error) {
    $("result-list").innerHTML = "";
    setError($("search-error"), error.message);
  }
}

async function openAddForm(name = "", city = "") {
  show($("add"));
  show($("not-listed"), false);
  const user = await getMe();
  if (!user) {
    $("add-gate-actions").innerHTML = signInButton("SIGN IN TO ADD IT");
    show($("add-gate"));
    show($("add-form"), false);
    return;
  }
  show($("add-gate"), false);
  show($("add-form"));
  if (!$("r-name").value) $("r-name").value = name;
  if (!$("r-city").value) $("r-city").value = city;
}

$("search-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const q = $("q").value.trim();
  const city = $("city").value.trim();
  if (!q && !city) {
    $("q").focus();
    return;
  }
  $("r-name").value = "";
  $("r-city").value = "";
  runSearch(q, city);
});

$("show-add").addEventListener("click", () => {
  openAddForm($("q").value.trim(), $("city").value.trim());
  $("r-name").focus();
});

$("add-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter || $("add-form").querySelector("button");
  button.disabled = true;
  setError($("add-error"), "");
  try {
    const { restaurant } = await api("/api/restaurants", {
      method: "POST",
      body: {
        name: $("r-name").value,
        city: $("r-city").value,
        address: $("r-address").value,
        cuisine: $("r-cuisine").value
      }
    });
    location.href = `/restaurant?id=${encodeURIComponent(restaurant.id)}`;
  } catch (error) {
    if (error.status === 409 && error.data.id) {
      location.href = `/restaurant?id=${encodeURIComponent(error.data.id)}`;
      return;
    }
    setError($("add-error"), error.message);
    button.disabled = false;
  }
});

async function loadRecent() {
  const user = await getMe();
  if (!user) return;
  try {
    const { orders } = await api("/api/my-orders");
    if (orders.length === 0) return;
    $("recent-list").innerHTML = orders.slice(0, 5).map((o) => `
      <li><a class="row-link" href="/restaurant?id=${encodeURIComponent(o.restaurant.id)}">
        <span class="name">${esc(o.restaurant.name)}</span>
        <span class="dim"> — ${esc(o.restaurant.city)}</span><br>
        <span class="dim">${esc(o.title)}: ${esc(o.items.join(", "))}</span>
      </a></li>`).join("");
    show($("recent"));
  } catch (error) {
    // Recent orders are a shortcut; if they fail the page still works.
  }
}

// Restore a search from the URL (so Back returns to your results).
const startParams = new URLSearchParams(location.search);
if (startParams.get("signin") === "failed") {
  show($("signin-error"));
  history.replaceState(null, "", "/");
}
const startQ = startParams.get("q") || "";
const startCity = startParams.get("city") || "";
$("q").value = startQ;
$("city").value = startCity;
if (startQ || startCity) runSearch(startQ, startCity);
loadRecent();
