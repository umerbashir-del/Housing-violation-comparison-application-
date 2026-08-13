const test = require("node:test");
const assert = require("node:assert/strict");
const health = require("../api/health");

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

test("health endpoint is read-only and does not cache its status", () => {
  const res = reply();
  health({ method: "GET" }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["Cache-Control"], "no-store");
  assert.equal(res.body.status, "ok");
  assert.equal(res.body.service, "blockwise-api");
});

test("health endpoint rejects non-GET requests", () => {
  const res = reply();
  health({ method: "POST" }, res);
  assert.equal(res.statusCode, 405);
});
