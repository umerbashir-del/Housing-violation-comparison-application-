const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("does not expose the NYC token in browser-delivered files", () => {
  const tokenName = "NYC_OPEN_DATA_APP_TOKEN";
  for (const file of ["index.html", "app.js", "styles.css", "trust.html"])
    assert.doesNotMatch(read(file), new RegExp(tokenName));
});
test("keeps local secrets and generated vendor assets out of Git", () => {
  const ignore = read(".gitignore");
  assert.match(ignore, /^\.env$/m);
  assert.match(ignore, /^vendor\/$/m);
  assert.match(ignore, /^node_modules\/$/m);
});
test("uses locally served Leaflet assets rather than a public CDN", () => {
  const page = read("index.html");
  assert.match(page, /vendor\/leaflet\/leaflet\.css/);
  assert.match(page, /vendor\/leaflet\/leaflet\.js/);
  assert.doesNotMatch(page, /unpkg\.com/);
});
test("sets a restrictive same-origin security policy", () => {
  const headers = JSON.parse(read("vercel.json")).headers[0].headers;
  const csp = headers.find(
    (header) => header.key === "Content-Security-Policy",
  ).value;
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self'/);
  assert.doesNotMatch(csp, /unpkg\.com/);
  assert.equal(
    headers.find((header) => header.key === "Cross-Origin-Opener-Policy").value,
    "same-origin",
  );
});
