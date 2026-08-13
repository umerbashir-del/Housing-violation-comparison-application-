const { validate, groupedQuery, suggestionQuery } = require("../lib/search");
const DATA_URL = "https://data.cityofnewyork.us/resource/wvxf-dwi5.json";
const META_URL = "https://data.cityofnewyork.us/api/views/wvxf-dwi5.json";
const PAGE_SIZE = 50,
  CACHE_TTL = 300_000,
  MAX_CACHE_ENTRIES = 500,
  cache = new Map(),
  windows = new Map();
function json(res, status, data) {
  res
    .status(status)
    .setHeader("Content-Type", "application/json")
    .setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600")
    .send(JSON.stringify(data));
}
function ip(req) {
  return String(
    req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown",
  )
    .split(",")[0]
    .trim();
}
function allowed(req) {
  const now = Date.now(),
    key = ip(req);
  for (const [address, times] of windows) {
    const active = times.filter((time) => now - time < 60_000);
    if (active.length) windows.set(address, active);
    else windows.delete(address);
  }
  const active = windows.get(key) || [];
  if (active.length >= 30) return false;
  active.push(now);
  windows.set(key, active);
  return true;
}
function cacheValue(key, value) {
  if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
  cache.set(key, { at: Date.now(), value });
  return value;
}
async function get(url) {
  const key = url.toString(),
    hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.value;
  if (hit) cache.delete(key);
  const headers = process.env.NYC_OPEN_DATA_APP_TOKEN
    ? { "X-App-Token": process.env.NYC_OPEN_DATA_APP_TOKEN }
    : {};
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error("Upstream data service unavailable");
  return cacheValue(key, await response.json());
}
function url(query) {
  const result = new URL(DATA_URL);
  Object.entries(query).forEach(([key, value]) =>
    result.searchParams.set(key, value),
  );
  return result;
}
function id(row) {
  return (
    row.bin ||
    row.bbl ||
    [row.housenumber, row.streetname, row.boro, row.zip].join("|")
  );
}
function sourceUrl(row) {
  const field = row.bin ? "bin" : row.bbl ? "bbl" : "";
  if (!field)
    return "https://data.cityofnewyork.us/Housing-Development/Housing-Maintenance-Code-Violations/wvxf-dwi5";
  const link = new URL(DATA_URL);
  link.searchParams.set("$where", `${field}='${row[field]}'`);
  return link.toString();
}
function normalize(rows) {
  return rows.map((row) => ({
    id: id(row),
    address: `${row.housenumber || ""} ${row.streetname || ""}`.trim(),
    borough: row.boro || "NYC",
    zip: row.zip || "",
    latitude: Number(row.latitude) || null,
    longitude: Number(row.longitude) || null,
    total: Number(row.total) || 0,
    open: Number(row.open) || 0,
    classC: Number(row.classc) || 0,
    latest: row.latest || null,
    sourceUrl: sourceUrl(row),
  }));
}
async function metadata() {
  try {
    const data = await get(new URL(META_URL));
    return data.rowsUpdatedAt
      ? new Date(data.rowsUpdatedAt * 1000).toISOString()
      : null;
  } catch {
    return null;
  }
}
module.exports = async (req, res) => {
  if (req.method !== "GET")
    return json(res, 405, { error: "Method not allowed." });
  if (!allowed(req))
    return json(res, 429, {
      error: "Too many searches. Please wait a minute and try again.",
    });
  try {
    if (req.query.mode === "suggest") {
      const rows = await get(
        url(suggestionQuery(req.query.q, req.query.borough)),
      );
      return json(res, 200, {
        suggestions: rows.map((row) => ({
          address: `${row.housenumber} ${row.streetname}`,
          borough: row.boro,
          zip: row.zip || "",
        })),
      });
    }
    const filters = validate(req.query),
      offset = filters.page * PAGE_SIZE;
    const [rows, datasetUpdatedAt] = await Promise.all([
      get(url(groupedQuery(filters, "", PAGE_SIZE + 1, offset))),
      metadata(),
    ]);
    const hasMore = rows.length > PAGE_SIZE;
    const buildings = normalize(rows.slice(0, PAGE_SIZE));
    return json(res, 200, {
      buildings,
      page: filters.page,
      hasMore,
      partial: hasMore || filters.page > 0,
      totalBuildings: buildings.length,
      datasetUpdatedAt,
    });
  } catch (error) {
    const status = /Invalid|Enter an address|Search must/.test(error.message)
      ? 400
      : error.name === "TimeoutError"
        ? 504
        : 502;
    if (status >= 500)
      console.error(
        JSON.stringify({
          event: "nyc_records_request_failed",
          status,
          errorName: error.name || "Error",
        }),
      );
    return json(res, status, {
      error:
        status === 504
          ? "The data source is taking too long to respond."
          : error.message === "Upstream data service unavailable"
            ? "NYC public records are temporarily unavailable."
            : error.message,
    });
  }
};
