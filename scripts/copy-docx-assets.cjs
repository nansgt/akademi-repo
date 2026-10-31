const { cp, mkdir } = require("node:fs/promises");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const destination = path.join(projectRoot, "assets", "docx");
const assets = [
  [path.join(projectRoot, "node_modules", "jszip", "dist", "jszip.min.js"), "jszip.min.js"],
  [path.join(projectRoot, "node_modules", "jszip", "LICENSE.markdown"), "jszip.LICENSE.markdown"],
  [path.join(projectRoot, "node_modules", "docx-preview", "dist", "docx-preview.min.js"), "docx-preview.min.js"],
  [path.join(projectRoot, "node_modules", "docx-preview", "LICENSE"), "docx-preview.LICENSE"]
];

async function main() {
  await mkdir(destination, { recursive: true });
  await Promise.all(assets.map(([source, filename]) => cp(source, path.join(destination, filename))));
}

main().catch((error) => {
  console.error("Could not copy the DOCX browser assets:", error);
  process.exitCode = 1;
});
