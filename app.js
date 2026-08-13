/** @param {string} id @returns {any} */
const $ = (id) => document.getElementById(id);
const ui = {
  input: $("searchInput"),
  list: $("recordList"),
  status: $("searchStatus"),
  loading: $("loadingState"),
  error: $("errorState"),
  errorMessage: $("errorMessage"),
  suggestions: $("suggestions"),
  suggestionStatus: $("suggestionStatus"),
  page: 0,
  controller: null,
  suggestionController: null,
  requestId: 0,
  slowTimer: null,
  suggestionIndex: -1,
  map: null,
  markers: [],
  mapPoints: [],
  comparison: [],
};

function filters() {
  return {
    q: ui.input.value.trim(),
    borough: $("borough").value,
    status: $("statusFilter").value,
    severity: $("severity").value,
    problem: $("problem").value,
    issuedWithin: $("issuedWithin").value,
    openOlderThan: $("openOlderThan").value,
    sort: $("sort").value,
    apartment: $("apartment").value.trim(),
    floor: $("floor").value.trim(),
    page: ui.page,
  };
}

function setState(kind, message = "") {
  ui.loading.hidden = kind !== "loading";
  ui.error.hidden = kind !== "error";
  if (kind === "error") ui.errorMessage.textContent = message;
}

/** @param {any} error */
function friendlyError(error) {
  if (error.name === "AbortError") return "";
  if (!navigator.onLine)
    return "We lost the connection. Check your internet and try again.";
  if ([400, 429, 502, 504].includes(error.status)) return error.message;
  return "We could not load public records right now. Try again in a moment.";
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    const error = {
      name: "ResponseError",
      status: 502,
      message:
        "The records service returned an unreadable response. Please try again.",
    };
    throw error;
  }
}

function startSlowMessage(requestId) {
  clearTimeout(ui.slowTimer);
  ui.slowTimer = setTimeout(() => {
    if (requestId === ui.requestId && !ui.loading.hidden)
      ui.status.textContent =
        "Still checking NYC public records. This can take a little longer during busy periods.";
  }, 3000);
}

async function search() {
  const state = filters();
  if (!state.q && !state.borough) {
    ui.status.textContent =
      "Enter an address or ZIP code, or choose a borough.";
    return;
  }
  if (ui.controller) ui.controller.abort();
  const controller = new AbortController(),
    requestId = ++ui.requestId;
  ui.controller = controller;
  closeSuggestions();
  setState("loading");
  ui.status.textContent = "";
  $("searchButton").disabled = true;
  startSlowMessage(requestId);
  try {
    const response = await fetch(
      `/api/buildings?${new URLSearchParams(Object.fromEntries(Object.entries(state).map(([key, value]) => [key, String(value)])))}`,
      { signal: controller.signal },
    );
    const body = await readJson(response);
    if (!response.ok) {
      const error = {
        name: "ResponseError",
        status: response.status,
        message: body.error || "Request failed",
      };
      throw error;
    }
    if (requestId !== ui.requestId) return;
    render(body, state);
    setState("results");
  } catch (error) {
    if (requestId === ui.requestId && error.name !== "AbortError") {
      setState("error", friendlyError(error));
      ui.status.textContent = "Search not completed.";
    }
  } finally {
    if (requestId === ui.requestId) {
      clearTimeout(ui.slowTimer);
      $("searchButton").disabled = false;
    }
  }
}

function render(body, state) {
  const buildings = body.buildings || [];
  $("resultTitle").textContent = state.q || state.borough;
  $("resultCount").textContent = `${buildings.length} shown`;
  ui.status.textContent = body.partial
    ? `Showing page ${body.page + 1} of matching buildings. Narrow filters for a smaller result set.`
    : `${buildings.length} matching buildings shown.`;
  $("sourceStatus").textContent =
    `Source: NYC HPD Housing Maintenance Code Violations. NYC last updated: ${body.datasetUpdatedAt ? new Date(body.datasetUpdatedAt).toLocaleDateString() : "not available"}.`;
  ui.list.replaceChildren();
  if (!buildings.length) {
    const empty = document.createElement("div"),
      symbol = document.createElement("b"),
      message = document.createElement("p");
    empty.className = "empty";
    symbol.textContent = "!";
    message.textContent =
      "No matching HPD records were found. Try a broader street search, another ZIP, or remove a filter.";
    empty.append(symbol, message);
    ui.list.append(empty);
  }
  buildings.forEach((building) => ui.list.append(recordCard(building)));
  renderComparison();
  $("pagination").hidden = !body.partial && body.page === 0;
  $("previousButton").disabled = body.page === 0;
  $("nextButton").disabled = !body.hasMore;
  $("pageLabel").textContent = `Page ${body.page + 1}`;
  drawMap(buildings);
}

function recordCard(building) {
  const card = document.createElement("article"),
    button = document.createElement("button"),
    name = document.createElement("b"),
    location = document.createElement("small"),
    meta = document.createElement("div"),
    compareButton = document.createElement("button"),
    detailsButton = document.createElement("button"),
    details = document.createElement("section"),
    source = document.createElement("a");
  card.className = "record";
  button.className = "record-select";
  button.type = "button";
  name.textContent = building.address;
  location.textContent = `${building.borough} \u00b7 ${building.zip || "ZIP not listed"}`;
  [
    ["open", `${building.open} open`],
    ["open", `${building.openClassC} open Class C`],
    ["", `${building.total} all-time records`],
  ].forEach(([className, text]) => {
    const chip = document.createElement("span");
    chip.className = `chip ${className}`;
    chip.textContent = text;
    meta.append(chip);
  });
  button.append(name, location, meta);
  button.addEventListener("click", () => focusBuilding(building, card));
  const compared = ui.comparison.some((item) => item.id === building.id);
  compareButton.type = "button";
  compareButton.className = "compare-button";
  compareButton.setAttribute("aria-pressed", String(compared));
  compareButton.textContent = compared ? "Remove from comparison" : "Compare";
  compareButton.addEventListener("click", () => toggleComparison(building));
  detailsButton.type = "button";
  detailsButton.className = "details-button";
  detailsButton.textContent = "View violation details";
  details.className = "violation-details";
  details.hidden = true;
  detailsButton.addEventListener("click", () =>
    loadDetails(building, details, detailsButton),
  );
  source.href = building.sourceUrl;
  source.target = "_blank";
  source.rel = "noopener noreferrer";
  source.className = "source-link";
  source.textContent = "Official NYC source";
  card.append(button, compareButton, detailsButton, details, source);
  return card;
}

function toggleComparison(building) {
  const index = ui.comparison.findIndex((item) => item.id === building.id);
  if (index >= 0) ui.comparison.splice(index, 1);
  else if (ui.comparison.length >= 3) {
    ui.status.textContent = "You can compare up to three buildings at once.";
    return;
  } else ui.comparison.push(building);
  renderComparison();
  document.querySelectorAll(".record").forEach((card) => {
    const title = card.querySelector(".record-select b")?.textContent;
    const selected = ui.comparison.some((item) => item.address === title);
    const trigger = card.querySelector(".compare-button");
    if (trigger) {
      trigger.setAttribute("aria-pressed", String(selected));
      trigger.textContent = selected ? "Remove from comparison" : "Compare";
    }
  });
}

function renderComparison() {
  const tray = $("comparisonTray");
  tray.hidden = !ui.comparison.length;
  if (!ui.comparison.length) return;
  const head = $("comparisonHead"),
    body = $("comparisonBody");
  head.replaceChildren();
  body.replaceChildren();
  const headerRow = document.createElement("tr"),
    label = document.createElement("th");
  label.scope = "col";
  label.textContent = "Measure";
  headerRow.append(label);
  ui.comparison.forEach((building) => {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = building.address;
    headerRow.append(cell);
  });
  head.append(headerRow);
  [
    [
      "Location",
      (building) => `${building.borough} · ${building.zip || "ZIP not listed"}`,
    ],
    ["Open violations", (building) => String(building.open)],
    ["Open Class C", (building) => String(building.openClassC)],
    ["All-time records", (building) => String(building.total)],
    ["Most recently inspected", (building) => dateLabel(building.latest)],
  ].forEach(
    (/** @type {[string, (building: any) => string]} */ [name, value]) => {
      const row = document.createElement("tr"),
        heading = document.createElement("th");
      heading.scope = "row";
      heading.textContent = name;
      row.append(heading);
      ui.comparison.forEach((building) => {
        const cell = document.createElement("td");
        cell.textContent = value(building);
        row.append(cell);
      });
      body.append(row);
    },
  );
}

function dateLabel(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.valueOf())
    ? date.toLocaleDateString()
    : "Date not listed";
}

async function loadDetails(building, panel, trigger) {
  if (!building.id) return;
  if (!panel.hidden) {
    panel.hidden = true;
    trigger.textContent = "View violation details";
    return;
  }
  trigger.disabled = true;
  trigger.textContent = "Loading details...";
  panel.replaceChildren();
  panel.hidden = false;
  try {
    const response = await fetch(
      `/api/buildings?mode=details&buildingId=${encodeURIComponent(building.id)}`,
    );
    const body = await readJson(response);
    if (!response.ok) throw { status: response.status, message: body.error };
    const heading = document.createElement("h4");
    heading.textContent = "Violation details";
    panel.append(heading);
    if (body.partial) {
      const notice = document.createElement("p");
      notice.textContent =
        "Showing the 100 most recent records. Use the official source for the complete history.";
      panel.append(notice);
    }
    if (!(body.violations || []).length) {
      const empty = document.createElement("p");
      empty.textContent =
        "No individual violation details were returned for this building.";
      panel.append(empty);
    }
    const records = body.violations || [];
    const openRecords = records.filter(
      (violation) => violation.status === "Open",
    );
    const closedRecords = records.filter(
      (violation) => violation.status !== "Open",
    );
    const appendRecord = (violation, target) => {
      const item = document.createElement("article"),
        description = document.createElement("b"),
        facts = document.createElement("p");
      item.className = "violation-item";
      description.textContent = violation.description;
      facts.textContent = `Class ${violation.class} · ${violation.status} · Issued ${dateLabel(violation.issued)}${violation.apartment ? ` · Apt ${violation.apartment}` : ""}${violation.floor ? ` · Floor ${violation.floor}` : ""}${violation.rentImpairing ? " · Rent-impairing" : ""}`;
      item.append(description, facts);
      target.append(item);
    };
    if (openRecords.length) {
      const openHeading = document.createElement("h5");
      openHeading.textContent = `Open violations (${openRecords.length})`;
      panel.append(openHeading);
      openRecords.forEach((violation) => appendRecord(violation, panel));
    }
    if (closedRecords.length) {
      const closed = document.createElement("details"),
        summary = document.createElement("summary");
      summary.textContent = `Closed records (${closedRecords.length})`;
      closed.append(summary);
      closedRecords.forEach((violation) => appendRecord(violation, closed));
      panel.append(closed);
    }
    trigger.textContent = "Hide violation details";
  } catch (error) {
    const message = document.createElement("p");
    message.className = "details-error";
    message.textContent = friendlyError(error);
    panel.replaceChildren(message);
    trigger.textContent = "Try violation details again";
  } finally {
    trigger.disabled = false;
  }
}

function initMap() {
  try {
    ui.map = L.map("map", { scrollWheelZoom: false }).setView(
      [40.7128, -73.971],
      11,
    );
    const tiles = L.tileLayer(
      "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>',
      },
    );
    tiles.addTo(ui.map);
  } catch {
    $("mapFallback").hidden = false;
  }
}

function drawMap(buildings) {
  if (!ui.map) return;
  ui.markers.forEach((item) => item.marker.remove());
  ui.markers = [];
  ui.mapPoints = [];
  const points = [];
  buildings.forEach((building) => {
    if (!building.latitude || !building.longitude) return;
    const popup = document.createElement("div"),
      address = document.createElement("strong"),
      detail = document.createElement("div");
    address.textContent = building.address;
    detail.textContent = `${building.open} open \u00b7 ${building.classC} Class C`;
    popup.append(address, detail);
    const marker = L.circleMarker([building.latitude, building.longitude], {
      radius: 7,
      color: "#a7462d",
      fillColor: "#d85734",
      fillOpacity: 0.9,
    }).bindPopup(popup);
    marker.addTo(ui.map);
    ui.markers.push({ marker, building });
    points.push([building.latitude, building.longitude]);
  });
  ui.mapPoints = points;
  $("resetMapButton").disabled = !points.length;
  resetMapView();
}

function resetMapView() {
  if (!ui.map || !ui.mapPoints.length) return;
  ui.map.fitBounds(ui.mapPoints, { padding: [25, 25], maxZoom: 15 });
  document
    .querySelectorAll(".record")
    .forEach((item) => item.classList.remove("active"));
}

function focusBuilding(building, card) {
  document
    .querySelectorAll(".record")
    .forEach((item) => item.classList.remove("active"));
  card.classList.add("active");
  const item = ui.markers.find((entry) => entry.building.id === building.id);
  if (item) {
    ui.map.setView(item.marker.getLatLng(), 16);
    item.marker.openPopup();
  }
}

function setSuggestionIndex(index) {
  const options = [...ui.suggestions.querySelectorAll("button")];
  if (!options.length) return;
  ui.suggestionIndex = (index + options.length) % options.length;
  options.forEach((option, optionIndex) => {
    const active = optionIndex === ui.suggestionIndex;
    option.classList.toggle("active", active);
    option.setAttribute("aria-selected", String(active));
  });
  ui.input.setAttribute(
    "aria-activedescendant",
    options[ui.suggestionIndex].id,
  );
  options[ui.suggestionIndex].scrollIntoView?.({ block: "nearest" });
}

function chooseSuggestion(button) {
  ui.input.value = button.dataset.address;
  ui.page = 0;
  closeSuggestions();
  search();
}

let suggestionTimer;
async function suggest() {
  const q = ui.input.value.trim();
  if (q.length < 3) {
    closeSuggestions();
    ui.suggestionStatus.textContent = q
      ? "Keep typing: suggestions appear after 3 characters."
      : "Start typing an address to see building suggestions.";
    return;
  }
  if (/^\d{5}$/.test(q)) {
    closeSuggestions();
    ui.suggestionStatus.textContent =
      "ZIP searches show results after you select Search.";
    return;
  }
  if (ui.suggestionController) ui.suggestionController.abort();
  const controller = new AbortController();
  ui.suggestionController = controller;
  try {
    const response = await fetch(
      `/api/buildings?mode=suggest&q=${encodeURIComponent(q)}&borough=${encodeURIComponent($("borough").value)}`,
      { signal: controller.signal },
    );
    const body = await readJson(response);
    if (!response.ok || controller !== ui.suggestionController) return;
    ui.suggestions.replaceChildren();
    ui.suggestionIndex = -1;
    (body.suggestions || []).forEach((suggestion, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.id = `suggestion-${index}`;
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", "false");
      button.dataset.address = suggestion.address;
      button.textContent = `${suggestion.address}, ${suggestion.borough} ${suggestion.zip || ""}`;
      button.addEventListener("click", () => chooseSuggestion(button));
      ui.suggestions.append(button);
    });
    ui.suggestions.hidden = !ui.suggestions.childElementCount;
    ui.input.setAttribute("aria-expanded", String(!ui.suggestions.hidden));
    ui.suggestionStatus.textContent = ui.suggestions.hidden
      ? "No address suggestions yet. Keep typing or select Search."
      : `${ui.suggestions.childElementCount} address suggestions available.`;
  } catch (error) {
    if (error.name !== "AbortError") {
      closeSuggestions();
      ui.suggestionStatus.textContent =
        "Address suggestions are unavailable right now. You can still select Search.";
    }
  }
}

function closeSuggestions() {
  if (ui.suggestionController) ui.suggestionController.abort();
  ui.suggestionIndex = -1;
  ui.suggestions.hidden = true;
  ui.input.setAttribute("aria-expanded", "false");
  ui.input.removeAttribute("aria-activedescendant");
}

function runSearchFromInput() {
  ui.page = 0;
  closeSuggestions();
  search();
}
$("searchButton").onclick = runSearchFromInput;
$("retryButton").onclick = search;
$("resetMapButton").onclick = resetMapView;
$("clearComparison").onclick = () => {
  ui.comparison = [];
  renderComparison();
  document.querySelectorAll(".compare-button").forEach((button) => {
    button.setAttribute("aria-pressed", "false");
    button.textContent = "Compare";
  });
};
$("previousButton").onclick = () => {
  ui.page -= 1;
  search();
};
$("nextButton").onclick = () => {
  ui.page += 1;
  search();
};
ui.input.oninput = () => {
  clearTimeout(suggestionTimer);
  suggestionTimer = setTimeout(suggest, 250);
};
ui.input.onkeydown = (event) => {
  const hasSuggestions = !ui.suggestions.hidden;
  if (event.key === "ArrowDown" && hasSuggestions) {
    event.preventDefault();
    setSuggestionIndex(ui.suggestionIndex + 1);
  } else if (event.key === "ArrowUp" && hasSuggestions) {
    event.preventDefault();
    setSuggestionIndex(ui.suggestionIndex - 1);
  } else if (event.key === "Escape") {
    closeSuggestions();
  } else if (event.key === "Enter") {
    event.preventDefault();
    const options = ui.suggestions.querySelectorAll("button");
    if (hasSuggestions && ui.suggestionIndex >= 0)
      chooseSuggestion(options[ui.suggestionIndex]);
    else runSearchFromInput();
  }
};
document.querySelectorAll("[data-example-search]").forEach((button) =>
  button.addEventListener("click", () => {
    ui.input.value =
      /** @type {HTMLButtonElement} */ (button).dataset.exampleSearch || "";
    runSearchFromInput();
  }),
);
[
  "borough",
  "statusFilter",
  "severity",
  "problem",
  "issuedWithin",
  "openOlderThan",
  "sort",
  "apartment",
  "floor",
].forEach((id) => {
  $(id).onchange = () => {
    ui.page = 0;
    if (ui.input.value.trim() || $("borough").value) search();
  };
});
initMap();
