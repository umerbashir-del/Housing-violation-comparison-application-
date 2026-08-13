const test = require("node:test");
const assert = require("node:assert/strict");
const {
  validate,
  normalizeStreet,
  where,
  groupedQuery,
} = require("../lib/search");
test("normalizes common street abbreviations", () =>
  assert.equal(normalizeStreet("Grand St"), "GRAND STREET"));
test("accepts a ZIP-only lookup", () =>
  assert.match(where(validate({ q: "11249" })), /zip='11249'/));
test("uses exact building number and normalized street", () =>
  assert.match(
    where(validate({ q: "125 Grand St" })),
    /housenumber='125'.*streetname like '%GRAND STREET%'/,
  ));
test("rejects unrecognized filters", () =>
  assert.throws(
    () => validate({ q: "11249", borough: "NOT NYC" }),
    /Invalid borough/,
  ));
test("limits client page values", () =>
  assert.equal(validate({ q: "11249", page: "9999" }).page, 200));
test("builds grouped server-side query with pagination and accurate counts", () => {
  const query = groupedQuery(
    validate({ q: "11249", status: "Open", severity: "C" }),
    "",
    51,
    50,
  );
  assert.equal(query.$limit, "51");
  assert.equal(query.$offset, "50");
  assert.match(query.$group, /housenumber/);
  assert.match(query.$select, /violationstatus='Open'/);
  assert.match(query.$select, /class='C'/);
  assert.match(query.$having, /violationstatus='Open'/);
  assert.match(query.$having, /class='C'/);
  assert.match(query.$order, /boro ASC/);
});
