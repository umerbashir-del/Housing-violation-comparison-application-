module.exports = (req, res) => {
  if (req.method !== "GET") {
    return res
      .status(405)
      .setHeader("Content-Type", "application/json")
      .send(JSON.stringify({ error: "Method not allowed." }));
  }

  return res
    .status(200)
    .setHeader("Content-Type", "application/json")
    .setHeader("Cache-Control", "no-store")
    .send(
      JSON.stringify({
        status: "ok",
        service: "blockwise-api",
        checkedAt: new Date().toISOString(),
      }),
    );
};
