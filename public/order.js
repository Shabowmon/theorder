// Add / Edit My Order: title, one input per dish, notes, public toggle.

const $ = (id) => document.getElementById(id);
const restaurantId = new URLSearchParams(location.search).get("id") || "";
const restaurantHref = `/restaurant?id=${encodeURIComponent(restaurantId)}&tab=mine`;
const MAX_DISHES = 20;

function addDishRow(value = "") {
  const rows = $("dishes").children;
  if (rows.length >= MAX_DISHES) return;
  const row = document.createElement("div");
  row.className = "dish-row";
  const n = rows.length + 1;
  row.innerHTML = `
    <input type="text" maxlength="200" aria-label="Dish ${n}" placeholder="e.g. Pad See Ew — medium spicy">
    <button class="btn danger" type="button" aria-label="Remove dish">[ X ]</button>`;
  const input = row.querySelector("input");
  input.value = value;
  row.querySelector("button").addEventListener("click", () => {
    row.remove();
    if ($("dishes").children.length === 0) addDishRow();
    updateDishButtons();
  });
  $("dishes").appendChild(row);
  updateDishButtons();
  return input;
}

function updateDishButtons() {
  $("add-dish").disabled = $("dishes").children.length >= MAX_DISHES;
}

$("add-dish").addEventListener("click", () => addDishRow()?.focus());

$("order-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const items = [...$("dishes").querySelectorAll("input")].map((i) => i.value.trim()).filter(Boolean);
  const error = $("form-error");
  if (items.length === 0) {
    error.textContent = "Add at least one dish.";
    error.hidden = false;
    return;
  }
  error.hidden = true;
  $("save").disabled = true;
  try {
    await api(`/api/restaurants/${encodeURIComponent(restaurantId)}/my-order`, {
      method: "PUT",
      body: {
        title: $("title").value,
        items,
        notes: $("notes").value,
        is_public: $("is-public").checked
      }
    });
    location.href = restaurantHref;
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
    $("save").disabled = false;
  }
});

async function load() {
  const user = await getMe();
  $("loading").hidden = true;
  if (!user) {
    $("gate-actions").innerHTML = signInButton();
    $("gate").hidden = false;
    return;
  }
  try {
    const { restaurant, order } = await api(`/api/restaurants/${encodeURIComponent(restaurantId)}/my-order`);
    document.title = `My Order · ${restaurant.name} · TheOrder`;
    $("r-line").textContent = `${restaurant.name} — ${restaurant.city}`;
    $("cancel").href = restaurantHref;
    if (order) {
      $("heading").textContent = "EDIT MY ORDER";
      $("title").value = order.title;
      order.items.forEach((item) => addDishRow(item));
      $("notes").value = order.notes || "";
      $("is-public").checked = order.is_public;
    }
    if ($("dishes").children.length === 0) addDishRow();
    $("order-form").hidden = false;
  } catch (error) {
    $("page-error").textContent = error.message;
    $("page-error").hidden = false;
  }
}

load();
