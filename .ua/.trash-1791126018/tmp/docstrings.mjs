import fs from "node:fs";
const files = [
  "packages/raptix/raptix/tools/network/protocols.py",
  "packages/raptix/raptix/tools/network/scanners.py",
  "packages/raptix/raptix/tools/network/vulnerability.py",
];
for (const p of files) {
  const lines = fs.readFileSync("D:/.VTNet/redteam/raptix/" + p, "utf8").split("\n");
  lines.forEach((l, i) => {
    const m = l.match(/^(async )?def (\w+)/);
    if (!m) return;
    for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
      const d = lines[j].trim();
      if (d.startsWith('"""')) {
        console.log(p.split("/").pop(), m[2], "@" + (i + 1), "::", d.replaceAll('"', "").slice(0, 110));
        break;
      }
      if (d && !d.startsWith("#")) {
        console.log(p.split("/").pop(), m[2], "@" + (i + 1), ":: (no docstring)", d.slice(0, 40));
        break;
      }
    }
  });
}
