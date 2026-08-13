const test = require("node:test");
const assert = require("node:assert/strict");
const {
  validate,
  normalizeStreet,
  where,
  groupedQuery,
  detailsQuery,
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
test("accepts Class I, time filters, and a renter-focused sort", () => {
  const filters = validate({
    q: "11249",
    severity: "I",
    issuedWithin: "365",
    openOlderThan: "90",
    sort: "open",
    apartment: "4b",
    floor: "4",
  });
  const query = groupedQuery(filters, "", 51, 0);
  assert.match(query.$where, /violationstatus='Open'/);
  assert.match(query.$where, /novissueddate >=/);
  assert.match(query.$where, /novissueddate </);
  assert.match(query.$where, /upper\(apartment\) like '%4B%'/);
  assert.match(query.$where, /upper\(story\) like '%4%'/);
  assert.match(query.$order, /^open DESC,total DESC/);
  assert.match(query.$having, /class='I'/);
});
test("rejects unknown time and sort controls", () => {
  assert.throws(
    () => validate({ q: "11249", issuedWithin: "2" }),
    /Invalid issue-date filter/,
  );
  assert.throws(
    () => validate({ q: "11249", sort: "score" }),
    /Invalid sort option/,
  );
});
test("builds a safe building-specific violation details query", () => {
  const query = detailsQuery("123456");
  assert.equal(query.$where, "buildingid='123456'");
  assert.match(query.$select, /novdescription/);
  assert.match(query.$select, /apartment/);
  assert.throws(
    () => detailsQuery("123 OR 1=1"),
    /Invalid building identifier/,
  );
});
test("builds grouped server-side query with pagination and accurate counts", () => {
  const query = groupedQuery(
    validate({ q: "11249", status: "Open", severity: "C" }),
    "",
    51,
    50,
  );
  assert.equal(query.$limit, "51");
  assert.equal(query.$offset, "50");
  assert.match(query.$group, /buildingid/);
  assert.match(query.$group, /housenumber/);
  assert.match(query.$select, /violationstatus='Open'/);
  assert.match(query.$select, /class='C'/);
  assert.match(query.$having, /violationstatus='Open'/);
  assert.match(query.$having, /class='C'/);
  assert.match(query.$order, /boro ASC/);
});
