// Generates public/brand/contours.svg: the topographic contour texture used
// behind the sidebar, the welcome panel and view headers. Deterministic, so
// re-running it produces the same file. Run: node scripts/generate-contours.js
const fs = require("node:fs");
const path = require("node:path");

const SIZE = 900;

// A closed, smooth contour: radius wobbles with a few low-frequency harmonics.
function ring(cx, cy, radius, phase, squash) {
  const points = [];
  const steps = 40;
  for (let index = 0; index < steps; index += 1) {
    const angle = (index / steps) * Math.PI * 2;
    const wobble = 1 + 0.11 * Math.sin(3 * angle + phase) + 0.05 * Math.sin(5 * angle + phase * 1.7) + 0.03 * Math.cos(2 * angle - phase);
    const r = radius * wobble;
    points.push([cx + Math.cos(angle) * r, cy + Math.sin(angle) * r * squash]);
  }
  // Catmull-Rom through the points, converted to cubic Béziers.
  let d = `M${points[0][0].toFixed(0)} ${points[0][1].toFixed(0)}`;
  for (let index = 0; index < steps; index += 1) {
    const p0 = points[(index - 1 + steps) % steps];
    const p1 = points[index];
    const p2 = points[(index + 1) % steps];
    const p3 = points[(index + 2) % steps];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${c1[0].toFixed(0)} ${c1[1].toFixed(0)} ${c2[0].toFixed(0)} ${c2[1].toFixed(0)} ${p2[0].toFixed(0)} ${p2[1].toFixed(0)}`;
  }
  return `${d}Z`;
}

// Two hills: a main summit and a smaller shoulder, each a set of nested rings
// whose centres drift uphill like real terrain.
function hill(cx, cy, count, step, phase, squash) {
  return Array.from({ length: count }, (_, index) => {
    const level = count - index;
    return ring(cx - level * 6, cy + level * 5, 26 + level * step, phase + level * 0.22, squash);
  });
}

const paths = [
  ...hill(560, 330, 14, 34, 0.6, 0.78),
  ...hill(190, 720, 7, 30, 2.1, 0.7)
];

// contours.svg is full strength (the page fades it with CSS opacity);
// contours-faint.svg bakes the fade in for CSS backgrounds, which can't take
// an opacity of their own (used behind the sidebar).
const variants = [
  { file: "contours.svg", strokeOpacity: 1, summitOpacity: 1 },
  { file: "contours-faint.svg", strokeOpacity: 0.3, summitOpacity: 0.55 }
];

for (const variant of variants) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}" fill="none" stroke="#3d8f86" stroke-opacity="${variant.strokeOpacity}" stroke-width="1.6" stroke-linejoin="round">
${paths.map((d) => `  <path d="${d}"/>`).join("\n")}
  <circle cx="560" cy="330" r="7" fill="#c8f04a" fill-opacity="${variant.summitOpacity}" stroke="none"/>
</svg>
`;
  const output = path.resolve(__dirname, "../public/brand", variant.file);
  fs.writeFileSync(output, svg);
  console.log(`Wrote ${path.relative(process.cwd(), output)} (${(svg.length / 1024).toFixed(0)} KB)`);
}
