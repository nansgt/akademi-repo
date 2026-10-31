const { cp, mkdir } = require("node:fs/promises");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const source = path.join(projectRoot, "node_modules", "pdfjs-dist");
const destination = path.join(projectRoot, "assets", "pdfjs");

async function main() {
  await mkdir(destination, { recursive: true });
  for (const filename of ["pdf.min.mjs", "pdf.worker.min.mjs", "LICENSE"]) {
    await cp(path.join(source, filename === "LICENSE" ? filename : `build/${filename}`), path.join(destination, filename));
  }
}

main().catch((error) => {
  console.error("Could not copy the PDF.js browser assets:", error);
  process.exitCode = 1;
});
