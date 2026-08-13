const test = require("node:test");
const assert = require("node:assert/strict");

const apiPath = require.resolve("../api/buildings");

function response(status = 200, body = []) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function request(query = {}, method = "GET") {
  return {
    method,
    query,
    headers: { "x-forwarded-for": "198.51.100.8" },
    socket: { remoteAddress: "198.51.100.8" },
  };
}

function reply() {
  return {
    statusCode: null,
    headers: {},
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
      return this;
    },
    send(body) {
      this.body = JSON.parse(body);
      return this;
    },
  };
}

async function withApi(fetchMock, run) {
  const originalFetch = global.fetch;
  const originalTimeout = AbortSignal.timeout;
  global.fetch = fetchMock;
  AbortSignal.timeout = () => new AbortController().signal;
  delete require.cache[apiPath];
  try {
    await run(require("../api/buildings"));
  } finally {
    global.fetch = originalFetch;
    AbortSignal.timeout = originalTimeout;
    delete require.cache[apiPath];
  }
}

test("rejects non-GET requests before consulting the public data service", async () => {
  await withApi(
    async () => {
      throw new Error("fetch should not be called");
    },
    async (handler) => {
      const res = reply();
      await handler(request({}, "POST"), res);
      assert.equal(res.statusCode, 405);
      assert.equal(res.body.error, "Method not allowed.");
    },
  );
});

test("returns a normalized, read-only building result with source timestamp", async () => {
  const calls = [];
  await withApi(
    async (url) => {
      calls.push(url.toString());
      if (url.pathname.endsWith("/api/views/wvxf-dwi5.json"))
        return response(200, { rowsUpdatedAt: 1_700_000_000 });
      return response(200, [
        {
          buildingid: "123456",
          housenumber: "125",
          streetname: "GRAND STREET",
          boro: "BROOKLYN",
          zip: "11249",
          bin: "3060000",
          latitude: "40.7",
          longitude: "-73.9",
          total: "4",
          open: "2",
          classc: "1",
          latest: "2026-01-02T00:00:00.000",
        },
      ]);
    },
    async (handler) => {
      const res = reply();
      await handler(request({ q: "125 Grand St" }), res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.buildings[0].address, "125 GRAND STREET");
      assert.equal(res.body.buildings[0].open, 2);
      assert.equal(res.body.buildings[0].classC, 1);
      assert.match(
        decodeURIComponent(res.body.buildings[0].sourceUrl),
        /buildingid='123456'/,
      );
      assert.match(res.body.datasetUpdatedAt, /^2023-11-14T/);
      assert.equal(calls.length, 2);
    },
  );
});

test("turns invalid searches into a safe, user-facing 400 response", async () => {
  await withApi(
    async () => {
      throw new Error("fetch should not be called");
    },
    async (handler) => {
      const res = reply();
      await handler(request({ q: "11249", borough: "NOT NYC" }), res);
      assert.equal(res.statusCode, 400);
      assert.equal(res.body.error, "Invalid borough.");
    },
  );
});

test("uses a stable error message when the upstream records service fails", async () => {
  await withApi(
    async () => response(503, {}),
    async (handler) => {
      const res = reply();
      await handler(request({ q: "11249" }), res);
      assert.equal(res.statusCode, 502);
      assert.equal(
        res.body.error,
        "NYC public records are temporarily unavailable.",
      );
    },
  );
});

test("returns the timeout message when NYC does not respond in time", async () => {
  await withApi(
    async () => {
      const error = new Error("Timed out");
      error.name = "TimeoutError";
      throw error;
    },
    async (handler) => {
      const res = reply();
      await handler(request({ q: "11249" }), res);
      assert.equal(res.statusCode, 504);
      assert.equal(
        res.body.error,
        "The data source is taking too long to respond.",
      );
    },
  );
});

test("rate limits the thirty-first search in a minute from one address", async () => {
  await withApi(
    async () => response(200, []),
    async (handler) => {
      for (let count = 0; count < 30; count += 1)
        await handler(request({ q: "11249" }), reply());
      const res = reply();
      await handler(request({ q: "11249" }), res);
      assert.equal(res.statusCode, 429);
      assert.equal(
        res.body.error,
        "Too many searches. Please wait a minute and try again.",
      );
    },
  );
});

test("returns small address suggestions without exposing raw source rows", async () => {
  await withApi(
    async () =>
      response(200, [
        {
          housenumber: "125",
          streetname: "GRAND STREET",
          boro: "BROOKLYN",
          zip: "11249",
          bin: "3060000",
        },
      ]),
    async (handler) => {
      const res = reply();
      await handler(request({ mode: "suggest", q: "125 Grand St" }), res);
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body, {
        suggestions: [
          { address: "125 GRAND STREET", borough: "BROOKLYN", zip: "11249" },
        ],
      });
    },
  );
});

test("returns safe individual violation details for a verified building", async () => {
  await withApi(
    async () =>
      response(200, [
        {
          violationid: "123",
          novdescription: "REPAIR LEAKING PLUMBING FIXTURE",
          class: "B",
          violationstatus: "Open",
          novissueddate: "2026-01-02T00:00:00.000",
          apartment: "4B",
          story: "4",
          rentimpairing: "Y",
        },
      ]),
    async (handler) => {
      const res = reply();
      await handler(request({ mode: "details", buildingId: "123456" }), res);
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body, {
        violations: [
          {
            id: "123",
            description: "REPAIR LEAKING PLUMBING FIXTURE",
            class: "B",
            status: "Open",
            issued: "2026-01-02T00:00:00.000",
            apartment: "4B",
            floor: "4",
            rentImpairing: true,
          },
        ],
        partial: false,
      });
    },
  );
});
