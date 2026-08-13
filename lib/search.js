const BOROUGHS = new Set([
  "MANHATTAN",
  "BRONX",
  "BROOKLYN",
  "QUEENS",
  "STATEN ISLAND",
]);
const CLASSES = new Set(["A", "B", "C", "I"]);
const ISSUE_WINDOWS = new Set(["365", "730", "1825"]);
const OPEN_AGE_WINDOWS = new Set(["90", "365"]);
const SORTS = new Set(["total", "open", "classC", "newest"]);
const PROBLEMS = new Set([
  "HEAT",
  "MOLD",
  "PEST",
  "LEAD",
  "ELECTRICAL",
  "PLUMBING",
]);
const STREET_WORDS = {
  ST: "STREET",
  AVE: "AVENUE",
  BLVD: "BOULEVARD",
  RD: "ROAD",
  DR: "DRIVE",
  PL: "PLACE",
  CT: "COURT",
  LN: "LANE",
};

function clean(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}
function sql(value) {
  return clean(value).replace(/'/g, "''");
}
function normalizeStreet(street) {
  const words = clean(street).split(" ");
  const last = words[words.length - 1];
  if (STREET_WORDS[last]) words[words.length - 1] = STREET_WORDS[last];
  return words.join(" ");
}
function validate(raw) {
  const value = {
    q: String(raw.q || "").trim(),
    borough: clean(raw.borough),
    status: raw.status === "Open" ? "Open" : "",
    severity: clean(raw.severity),
    problem: clean(raw.problem),
    issuedWithin: String(raw.issuedWithin || ""),
    openOlderThan: String(raw.openOlderThan || ""),
    sort: String(raw.sort || "total"),
    apartment: clean(raw.apartment),
    floor: clean(raw.floor),
    page: Math.max(0, Math.min(Number.parseInt(raw.page, 10) || 0, 200)),
  };
  if (value.borough && !BOROUGHS.has(value.borough))
    throw new Error("Invalid borough.");
  if (value.severity && !CLASSES.has(value.severity))
    throw new Error("Invalid severity.");
  if (value.problem && !PROBLEMS.has(value.problem))
    throw new Error("Invalid problem type.");
  if (value.issuedWithin && !ISSUE_WINDOWS.has(value.issuedWithin))
    throw new Error("Invalid issue-date filter.");
  if (value.openOlderThan && !OPEN_AGE_WINDOWS.has(value.openOlderThan))
    throw new Error("Invalid open-record age filter.");
  if (!SORTS.has(value.sort)) throw new Error("Invalid sort option.");
  if (value.apartment.length > 20 || value.floor.length > 20)
    throw new Error(
      "Apartment and floor filters must be 20 characters or fewer.",
    );
  if (value.q.length > 100)
    throw new Error("Search must be 100 characters or fewer.");
  if (!value.q && !value.borough)
    throw new Error("Enter an address or ZIP code, or choose a borough.");
  return value;
}

function dateDaysAgo(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - Number(days));
  return date.toISOString().slice(0, 10);
}

function baseWhere(filters, extra = "") {
  const parts = [];
  const q = filters.q;
  if (/^\d{5}$/.test(q)) parts.push(`zip='${q}'`);
  else if (q) {
    const match = q.split(",")[0].match(/^(\d+[A-Z0-9-]*)?\s*(.*?)\s*$/i);
    const house = match?.[1],
      street = normalizeStreet(match?.[2] || "");
    if (house) parts.push(`housenumber='${sql(house)}'`);
    if (street) parts.push(`streetname like '%${sql(street)}%'`);
  }
  if (filters.borough) parts.push(`boro='${filters.borough}'`);
  if (filters.issuedWithin)
    parts.push(
      `novissueddate >= '${dateDaysAgo(filters.issuedWithin)}T00:00:00'`,
    );
  if (filters.openOlderThan) {
    parts.push("violationstatus='Open'");
    parts.push(
      `novissueddate < '${dateDaysAgo(filters.openOlderThan)}T00:00:00'`,
    );
  }
  if (filters.apartment)
    parts.push(`upper(apartment) like '%${sql(filters.apartment)}%'`);
  if (filters.floor) parts.push(`upper(story) like '%${sql(filters.floor)}%'`);
  if (extra) parts.push(extra);
  return parts.join(" AND ");
}
function where(filters, extra = "") {
  const parts = [baseWhere(filters, extra)];
  if (filters.status) parts.push("violationstatus='Open'");
  if (filters.severity) parts.push(`class='${filters.severity}'`);
  if (filters.problem)
    parts.push(`upper(novdescription) like '%${filters.problem}%'`);
  return parts.filter(Boolean).join(" AND ");
}
function having(filters) {
  const parts = [];
  if (filters.status)
    parts.push("sum(case when violationstatus='Open' then 1 else 0 end) > 0");
  if (filters.severity)
    parts.push(
      `sum(case when class='${filters.severity}' then 1 else 0 end) > 0`,
    );
  if (filters.problem)
    parts.push(
      `sum(case when upper(novdescription) like '%${filters.problem}%' then 1 else 0 end) > 0`,
    );
  return parts.join(" AND ");
}
function groupedQuery(filters, extra, limit, offset) {
  const fields =
    "buildingid,housenumber,streetname,boro,zip,bin,bbl,latitude,longitude";
  const aggregates =
    "count(*) as total,sum(case when violationstatus='Open' then 1 else 0 end) as open,sum(case when class='C' then 1 else 0 end) as classc,max(inspectiondate) as latest";
  const query = {
    $select: `${fields},${aggregates}`,
    $where: baseWhere(filters, extra),
    $group: fields,
    $order: `${
      {
        total: "total DESC",
        open: "open DESC,total DESC",
        classC: "classc DESC,total DESC",
        newest: "latest DESC,total DESC",
      }[filters.sort]
    },boro ASC,streetname ASC,housenumber ASC,buildingid ASC`,
    $limit: String(limit),
    $offset: String(offset),
  };
  const conditions = having(filters);
  if (conditions) query.$having = conditions;
  return query;
}
function suggestionQuery(q, borough) {
  const filters = validate({ q, borough });
  const fields = "housenumber,streetname,boro,zip,bin,bbl";
  return {
    $select: fields,
    $where: baseWhere(filters),
    $group: fields,
    $order: "boro ASC,streetname ASC,housenumber ASC",
    $limit: "8",
  };
}
module.exports = {
  validate,
  where,
  groupedQuery,
  suggestionQuery,
  normalizeStreet,
  dateDaysAgo,
};
