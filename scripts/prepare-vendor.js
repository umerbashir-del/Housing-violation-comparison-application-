const { copyFileSync, cpSync, mkdirSync } = require("node:fs");
const { join } = require("node:path");

const root = join(__dirname, "..");
const leafletSource = join(root, "node_modules", "leaflet", "dist");
const output = join(root, "public");
const leafletDestination = join(output, "vendor", "leaflet");
const siteFiles = ["index.html", "app.js", "styles.css", "trust.html"];

mkdirSync(leafletDestination, { recursive: true });
cpSync(leafletSource, leafletDestination, { recursive: true, force: true });
siteFiles.forEach((file) => copyFileSync(join(root, file), join(output, file)));
console.log("Prepared public site files and local Leaflet assets.");
