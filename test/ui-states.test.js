const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const page = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const waitForSuggestions = () =>
  new Promise((resolve) => setTimeout(resolve, 280));
const activeDoms = [];
afterEach(() => {
  while (activeDoms.length) activeDoms.pop().window.close();
});
function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}
function setup({ fetchMock, mapFails = false } = {}) {
  const dom = new JSDOM(page, {
    url: "https://blockwise.example",
    runScripts: "outside-only",
  });
  activeDoms.push(dom);
  const { window } = dom;
  window.fetch =
    fetchMock ||
    (async () =>
      response(200, {
        buildings: [],
        page: 0,
        partial: false,
        hasMore: false,
      }));
  window.L = mapFails
    ? {
        map() {
          throw new Error("Map unavailable");
        },
      }
    : {
        map() {
          return {
            setView() {
              return this;
            },
            fitBounds() {},
          };
        },
        tileLayer() {
          return {
            on() {
              return this;
            },
            addTo() {
              return this;
            },
          };
        },
        circleMarker() {
          return {
            bindPopup() {
              return this;
            },
            addTo() {
              return this;
            },
            remove() {},
            getLatLng() {
              return [40.7, -73.9];
            },
            openPopup() {},
          };
        },
      };
  window.eval(app);
  return { window, document: window.document };
}
function fillSearch(document, value = "11249") {
  document.getElementById("searchInput").value = value;
  document.getElementById("searchButton").click();
}

test("shows loading, then replaces it with no-results guidance", async () => {
  let finish;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const { document } = setup({ fetchMock: async () => pending });
  fillSearch(document);
  assert.equal(document.getElementById("loadingState").hidden, false);
  assert.match(
    document.getElementById("loadingState").textContent,
    /Checking NYC public records/,
  );
  finish(
    response(200, { buildings: [], page: 0, partial: false, hasMore: false }),
  );
  await tick();
  assert.equal(document.getElementById("loadingState").hidden, true);
  assert.match(
    document.getElementById("recordList").textContent,
    /No matching HPD records/,
  );
});

test("reassures visitors when a search takes more than three seconds", async () => {
  let finish;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const { document } = setup({ fetchMock: async () => pending });
  fillSearch(document);
  await new Promise((resolve) => setTimeout(resolve, 3050));
  assert.match(
    document.getElementById("searchStatus").textContent,
    /Still checking NYC public records/,
  );
  finish(
    response(200, { buildings: [], page: 0, partial: false, hasMore: false }),
  );
  await tick();
});

for (const [status, message] of [
  [400, "Invalid borough."],
  [429, "Too many searches. Please wait a minute and try again."],
  [502, "NYC public records are temporarily unavailable."],
  [504, "The data source is taking too long to respond."],
]) {
  test(`shows the correct ${status} error and stops loading`, async () => {
    const { document } = setup({
      fetchMock: async () => response(status, { error: message }),
    });
    fillSearch(document);
    await tick();
    assert.equal(document.getElementById("loadingState").hidden, true);
    assert.equal(document.getElementById("errorState").hidden, false);
    assert.equal(document.getElementById("errorMessage").textContent, message);
    assert.equal(document.getElementById("searchButton").disabled, false);
  });
}

test("shows the connection message while offline", async () => {
  const { window, document } = setup({
    fetchMock: async () => {
      throw new TypeError("Network failed");
    },
  });
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    value: false,
  });
  fillSearch(document);
  await tick();
  assert.equal(
    document.getElementById("errorMessage").textContent,
    "We lost the connection. Check your internet and try again.",
  );
});
test("shows a safe generic message for browser/network failure", async () => {
  const { document } = setup({
    fetchMock: async () => {
      throw new TypeError("Network failed");
    },
  });
  fillSearch(document);
  await tick();
  assert.equal(
    document.getElementById("errorMessage").textContent,
    "We could not load public records right now. Try again in a moment.",
  );
});
test("Retry starts a new request and replaces the error with results", async () => {
  let calls = 0;
  const { document } = setup({
    fetchMock: async () => {
      calls += 1;
      return calls === 1
        ? response(502, {
            error: "NYC public records are temporarily unavailable.",
          })
        : response(200, {
            buildings: [],
            page: 0,
            partial: false,
            hasMore: false,
          });
    },
  });
  fillSearch(document);
  await tick();
  document.getElementById("retryButton").click();
  await tick();
  assert.equal(calls, 2);
  assert.equal(document.getElementById("errorState").hidden, true);
  assert.match(
    document.getElementById("recordList").textContent,
    /No matching HPD records/,
  );
});
test("a stale search cannot replace newer results", async () => {
  const requests = [];
  const { document } = setup({
    fetchMock: () => new Promise((resolve) => requests.push(resolve)),
  });
  fillSearch(document, "11111");
  document.getElementById("searchInput").value = "22222";
  document
    .getElementById("borough")
    .dispatchEvent(new document.defaultView.Event("change"));
  requests[1](
    response(200, { buildings: [], page: 0, partial: false, hasMore: false }),
  );
  await tick();
  requests[0](
    response(200, {
      buildings: [
        {
          id: "old",
          address: "OLD RESULT",
          borough: "BROOKLYN",
          zip: "11111",
          open: 0,
          classC: 0,
          total: 1,
        },
      ],
      page: 0,
      partial: false,
      hasMore: false,
    }),
  );
  await tick();
  assert.equal(document.getElementById("resultTitle").textContent, "22222");
  assert.doesNotMatch(
    document.getElementById("recordList").textContent,
    /OLD RESULT/,
  );
});
test("a stale autocomplete request cannot replace newer suggestions", async () => {
  const requests = [];
  const { window, document } = setup({
    fetchMock: () => new Promise((resolve) => requests.push(resolve)),
  });
  const input = document.getElementById("searchInput");
  input.value = "Grand";
  input.dispatchEvent(new window.Event("input"));
  await waitForSuggestions();
  input.value = "Frank";
  input.dispatchEvent(new window.Event("input"));
  await waitForSuggestions();
  requests[1](
    response(200, {
      suggestions: [
        { address: "160 FRANKLIN AVENUE", borough: "BROOKLYN", zip: "11205" },
      ],
    }),
  );
  await tick();
  requests[0](
    response(200, {
      suggestions: [
        { address: "125 GRAND STREET", borough: "BROOKLYN", zip: "11249" },
      ],
    }),
  );
  await tick();
  assert.match(document.getElementById("suggestions").textContent, /FRANKLIN/);
  assert.doesNotMatch(
    document.getElementById("suggestions").textContent,
    /GRAND/,
  );
});
test("explains when address suggestions need more input or are unavailable", async () => {
  const { window, document } = setup({
    fetchMock: async () => {
      throw new TypeError("Network failed");
    },
  });
  const input = document.getElementById("searchInput");
  input.value = "Gr";
  input.dispatchEvent(new window.Event("input"));
  await waitForSuggestions();
  assert.match(
    document.getElementById("suggestionStatus").textContent,
    /after 3 characters/,
  );
  input.value = "Grand";
  input.dispatchEvent(new window.Event("input"));
  await waitForSuggestions();
  assert.match(
    document.getElementById("suggestionStatus").textContent,
    /unavailable right now/,
  );
});
test("shows the map fallback if the map cannot start", () => {
  const { document } = setup({ mapFails: true });
  assert.equal(document.getElementById("mapFallback").hidden, false);
});

test("supports Arrow keys, Enter, and Escape in address suggestions", async () => {
  const { window, document } = setup({
    fetchMock: async () =>
      response(200, {
        suggestions: [
          { address: "125 GRAND STREET", borough: "BROOKLYN", zip: "11249" },
          { address: "126 GRAND STREET", borough: "BROOKLYN", zip: "11249" },
        ],
      }),
  });
  const input = document.getElementById("searchInput");
  input.value = "Grand";
  input.dispatchEvent(new window.Event("input"));
  await waitForSuggestions();
  input.dispatchEvent(
    new window.KeyboardEvent("keydown", { key: "ArrowDown" }),
  );
  assert.equal(input.getAttribute("aria-activedescendant"), "suggestion-0");
  input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape" }));
  assert.equal(document.getElementById("suggestions").hidden, true);
  input.dispatchEvent(new window.Event("input"));
  await waitForSuggestions();
  input.dispatchEvent(
    new window.KeyboardEvent("keydown", { key: "ArrowDown" }),
  );
  input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter" }));
  await tick();
  assert.equal(input.value, "125 GRAND STREET");
});

test("shows a safe error when the API returns malformed JSON", async () => {
  const { document } = setup({
    fetchMock: async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Bad JSON");
      },
    }),
  });
  fillSearch(document);
  await tick();
  assert.equal(
    document.getElementById("errorMessage").textContent,
    "The records service returned an unreadable response. Please try again.",
  );
});

test("renders a separate official source link for each building", async () => {
  const building = {
    id: "1",
    address: "125 GRAND STREET",
    borough: "BROOKLYN",
    zip: "11249",
    open: 2,
    classC: 1,
    total: 4,
    sourceUrl: "https://data.cityofnewyork.us/resource/wvxf-dwi5.json",
  };
  const { document } = setup({
    fetchMock: async () =>
      response(200, {
        buildings: [building],
        page: 0,
        partial: false,
        hasMore: false,
      }),
  });
  fillSearch(document);
  await tick();
  const card = document.querySelector(".record");
  assert.equal(card.querySelector("button a"), null);
  assert.equal(card.querySelector("a").href, building.sourceUrl);
});

test("sends Class I, date, age, and sort choices to the read-only API", async () => {
  let requestedUrl;
  const { document } = setup({
    fetchMock: async (url) => {
      requestedUrl = new URL(url, "https://blockwise.example");
      return response(200, {
        buildings: [],
        page: 0,
        partial: false,
        hasMore: false,
      });
    },
  });
  document.getElementById("severity").value = "I";
  document.getElementById("issuedWithin").value = "365";
  document.getElementById("openOlderThan").value = "90";
  document.getElementById("sort").value = "open";
  document.getElementById("apartment").value = "4B";
  document.getElementById("floor").value = "4";
  fillSearch(document);
  await tick();
  assert.equal(requestedUrl.searchParams.get("severity"), "I");
  assert.equal(requestedUrl.searchParams.get("issuedWithin"), "365");
  assert.equal(requestedUrl.searchParams.get("openOlderThan"), "90");
  assert.equal(requestedUrl.searchParams.get("sort"), "open");
  assert.equal(requestedUrl.searchParams.get("apartment"), "4B");
  assert.equal(requestedUrl.searchParams.get("floor"), "4");
});
