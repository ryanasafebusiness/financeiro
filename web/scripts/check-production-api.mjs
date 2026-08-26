import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  }));
  return nested.flat();
}

const artifacts = await files(fileURLToPath(new URL("../dist", import.meta.url)));
for (const artifact of artifacts) {
  if (!/\.(?:js|html|css)$/.test(artifact)) continue;
  const content = await readFile(artifact, "utf8");
  if (content.includes("http://localhost:8000")) {
    throw new Error(`Build de produção contém API local: ${artifact}`);
  }
}

console.log("Production API guard: same-origin OK");
