// Draws languages-light.svg and languages-dark.svg: a streamgraph of every
// public repo I've started, by primary language.
// Node 20+, no dependencies. GITHUB_TOKEN is optional but avoids rate limits.

import { writeFile } from "node:fs/promises";

const USER = "kristianfreeman";

const headers = { Accept: "application/vnd.github+json" };
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

async function allRepos() {
  const repos = [];
  for (let page = 1; ; page++) {
    const res = await fetch(
      `https://api.github.com/users/${USER}/repos?type=owner&per_page=100&page=${page}`,
      { headers },
    );
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    const batch = await res.json();
    repos.push(...batch);
    if (batch.length < 100) return repos;
  }
}

// Bottom to top. The first four validated categorical slots, plus a
// neutral for everything else so it recedes.
const GROUPS = [
  { name: "Ruby", langs: ["Ruby"], light: "#2a78d6", dark: "#3987e5" },
  { name: "JavaScript", langs: ["JavaScript", "CoffeeScript"], light: "#eb6834", dark: "#d95926" },
  { name: "TypeScript", langs: ["TypeScript"], light: "#1baf7a", dark: "#199e70" },
  { name: "Native", langs: ["Swift", "Objective-C", "Rust", "C++", "C", "C#", "Java", "Kotlin"], light: "#eda100", dark: "#c98500" },
  { name: "Other", langs: null, light: "#b4b2aa", dark: "#5b5a56" },
];
const groupOf = (lang) => GROUPS.findIndex((g) => g.langs === null || g.langs.includes(lang));

const THEMES = {
  light: { surface: "#ffffff", ink: "#59636e", muted: "#8c959f", rule: "#d8dee4" },
  dark: { surface: "#0d1117", ink: "#9198a1", muted: "#656c76", rule: "#30363d" },
};

// ------------------------------------------------------------------ data

const toYears = (iso) => {
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  return y + (d - Date.UTC(y, 0, 1)) / (Date.UTC(y + 1, 0, 1) - Date.UTC(y, 0, 1));
};

const repos = (await allRepos()).filter((r) => !r.fork && r.name !== USER && r.language);
const points = GROUPS.map(() => []);
for (const r of repos) points[groupOf(r.language)].push(toYears(r.created_at));

const NOW = toYears(new Date().toISOString());
const BANDWIDTH = 0.4; // years; about five months
const FIRST = Math.min(...points.flat());
const START = FIRST - 2.5 * BANDWIDTH; // room for the stream to taper in

// Kernel density in repos per year. Points near "now" are mirrored across
// it so the stream doesn't sag just because the year isn't over.
function density(ts, x) {
  const k = (d) => Math.exp((-d * d) / (2 * BANDWIDTH ** 2)) / (BANDWIDTH * Math.sqrt(2 * Math.PI));
  let sum = 0;
  for (const t of ts) {
    sum += k(x - t);
    if (NOW - t < 3 * BANDWIDTH) sum += k(x - (2 * NOW - t));
  }
  return sum;
}

const N = 360;
const xs = Array.from({ length: N + 1 }, (_, i) => START + ((NOW - START) * i) / N);
const layers = GROUPS.map((_, g) => xs.map((x) => density(points[g], x)));
const totals = xs.map((_, i) => layers.reduce((s, l) => s + l[i], 0));

// ----------------------------------------------------------------- chart

const W = 1200;
const H = 420;
const X0 = 8;
const X1 = W - 8;
const MID = 192;
const HALF = 176;
const scale = HALF / (Math.max(...totals) / 2);
const r1 = (n) => Math.round(n * 10) / 10;
const xAt = (x) => X0 + ((x - START) / (NOW - START)) * (X1 - X0);

// Silhouette baseline: the stack is centred on MID.
const bounds = xs.map((_, i) => {
  let y = MID + (totals[i] * scale) / 2;
  return layers.map((l) => {
    const lo = y;
    y -= l[i] * scale;
    return [lo, y];
  });
});

// Catmull–Rom through the samples, written as cubic Béziers.
function curve(pts) {
  let d = `${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const [p0, p1, p2, p3] = [pts[i - 1] ?? pts[i], pts[i], pts[i + 1], pts[i + 2] ?? pts[i + 1]];
    const c1 = [r1(p1[0] + (p2[0] - p0[0]) / 6), r1(p1[1] + (p2[1] - p0[1]) / 6)];
    const c2 = [r1(p2[0] - (p3[0] - p1[0]) / 6), r1(p2[1] - (p3[1] - p1[1]) / 6)];
    d += `C${c1} ${c2} ${p2[0]},${p2[1]}`;
  }
  return d;
}

const paths = GROUPS.map((_, g) => {
  const top = xs.map((x, i) => [r1(xAt(x)), r1(bounds[i][g][1])]);
  const bottom = xs.map((x, i) => [r1(xAt(x)), r1(bounds[i][g][0])]).reverse();
  return `M${curve(top)}L${curve(bottom)}Z`;
});

// A label sits where its band is thickest, if it fits there.
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const inkOn = (hex) => (1.05 / (luminance(hex) + 0.05) >= 4 ? "#ffffff" : "#1f2328");

const labels = GROUPS.map((group, g) => {
  let best = { i: 0, px: 0 };
  bounds.forEach((row, i) => {
    const px = row[g][0] - row[g][1];
    if (px > best.px) best = { i, px };
  });
  if (best.px < 30) return null;
  const x = xAt(xs[best.i]);
  const anchor = x > X1 - 70 ? "end" : x < X0 + 70 ? "start" : "middle";
  const dx = anchor === "end" ? -10 : anchor === "start" ? 10 : 0;
  const [lo, hi] = bounds[best.i][g];
  return { g, x: r1(x + dx), y: r1((lo + hi) / 2 + 6.5), anchor };
}).filter(Boolean);

function chart(mode) {
  const t = THEMES[mode];
  const years = [];
  for (let y = Math.floor(FIRST); y <= Math.floor(NOW); y++) {
    const mid = Math.min(y + 0.5, (y + NOW) / 2);
    years.push(`<text x="${r1(xAt(mid))}" y="${H - 8}" text-anchor="middle" fill="${t.muted}">${y}</text>`);
    if (y > Math.floor(FIRST)) years.push(`<line x1="${r1(xAt(y))}" x2="${r1(xAt(y))}" y1="${H - 30}" y2="${H - 23}" stroke="${t.rule}"/>`);
  }
  const fills = paths
    .map((d, g) => `<path d="${d}" fill="${GROUPS[g][mode]}" stroke="${t.surface}" stroke-width="2" stroke-linejoin="round"/>`)
    .join("");
  const text = labels
    .map(({ g, x, y, anchor }) =>
      `<text x="${x}" y="${y}" text-anchor="${anchor}" class="in" fill="${inkOn(GROUPS[g][mode])}">${GROUPS[g].name}</text>`)
    .join("");
  // A legend only appears if some band was too thin to label directly.
  const unlabeled = GROUPS.filter((_, g) => !labels.some((l) => l.g === g));
  let lx = X0 + 4;
  const legend = unlabeled
    .map((g) => {
      const s = `<rect x="${lx}" y="12" width="10" height="10" rx="2" fill="${g[mode]}"/><text x="${lx + 15}" y="21" fill="${t.ink}">${g.name}</text>`;
      lx += 15 + g.name.length * 9 + 18;
      return s;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Streamgraph of public repos started per year, by language, ${Math.floor(FIRST)} to now">
<style>text{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans",Helvetica,Arial,sans-serif;font-size:16px}.in{font-size:19px;font-weight:600;letter-spacing:-.01em}</style>
<rect width="${W}" height="${H}" fill="${t.surface}"/>
${fills}
${text}
${legend}
<line x1="${X0}" x2="${X1}" y1="${H - 30}" y2="${H - 30}" stroke="${t.rule}"/>
${years.join("")}
</svg>
`;
}

await writeFile("languages-light.svg", chart("light"));
await writeFile("languages-dark.svg", chart("dark"));
