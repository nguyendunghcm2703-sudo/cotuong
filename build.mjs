import { rmSync, mkdirSync, cpSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist");

for (const p of ["index.html", "client", "shared"]) {
  cpSync(p, `dist/${p}`, {
    recursive: true,
    filter: (src) => !src.endsWith(".test.js"),
  });
}

console.log("Build xong: dist/");
