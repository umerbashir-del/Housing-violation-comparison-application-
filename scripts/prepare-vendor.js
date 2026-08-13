const { cpSync, mkdirSync } = require("node:fs");
const { join } = require("node:path");

const source = join(__dirname, "..", "node_modules", "leaflet", "dist");
const destination = join(__dirname, "..", "vendor", "leaflet");

mkdirSync(destination, { recursive: true });
cpSync(source, destination, { recursive: true, force: true });
console.log("Prepared local Leaflet assets.");
