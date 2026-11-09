// Draws languages-light.svg and languages-dark.svg from every public repo
// I've started, by primary language. The README picks one per theme.
//
//   node scripts/update.mjs                  # the README's charts
//   node scripts/update.mjs --variants DIR   # every look, for comparing
//
// Node 20+, no dependencies. GITHUB_TOKEN is optional but avoids rate limits.

import { mkdir, writeFile } from "node:fs/promises";

const USER = "kristianfreeman";
const LOOK = "blocks"; // plasma | greens | dots | blocks | lanes | ribbon | ridges

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

// Oldest language first. Colors step through each ramp in that order, so
// newer work reads warmer (plasma) or brighter (greens).
const GROUPS = [
  { name: "Ruby", langs: ["Ruby"] },
  { name: "JavaScript", langs: ["JavaScript", "CoffeeScript"] },
  { name: "TypeScript", langs: ["TypeScript"] },
  { name: "Swift, Rust, C++", langs: ["Swift", "Objective-C", "Rust", "C++", "C", "C#", "Java", "Kotlin"] },
  { name: "Other", langs: null },
];
const groupOf = (lang) => GROUPS.findIndex((g) => g.langs === null || g.langs.includes(lang));

// Every ramp passes protan, deutan and tritan separation for all pairs.
const PALETTES = {
  plasma: {
    light: ["#46327e", "#8f3a9c", "#d24e71", "#f08a3c", "#d6d3cc"],
    dark: ["#3a33a6", "#a35bd8", "#f0648f", "#f9b350", "#33363c"],
  },
  greens: {
    light: ["#b7f0c2", "#56c771", "#2a8c46", "#145a2a", "#e3e6e9"],
    dark: ["#0f4a2c", "#1d7d3e", "#34b155", "#7ee891", "#262b32"],
  },
};
for (const look of ["dots", "blocks", "lanes", "ribbon", "ridges"]) PALETTES[look] = PALETTES.plasma;

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

const repos = (await allRepos())
  .filter((r) => !r.fork && r.name !== USER && r.language)
  .map((r) => ({ t: toYears(r.created_at), g: groupOf(r.language) }))
  .sort((a, b) => a.t - b.t);
const points = GROUPS.map((_, g) => repos.filter((r) => r.g === g).map((r) => r.t));

const NOW = toYears(new Date().toISOString());
const BANDWIDTH = 0.45; // years
const FIRST = repos[0].t;
const START = FIRST - 2.2 * BANDWIDTH;

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

// --------------------------------------------------------------- geometry

const W = 1200;
const X0 = 8;
const X1 = W - 8;
const r1 = (n) => Math.round(n * 10) / 10;
const xAt = (x) => X0 + ((x - START) / (NOW - START)) * (X1 - X0);
const EASE = 'calcMode="spline" keyTimes="0;1" keySplines=".22 1 .36 1"';

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

const SAMPLES = 300;
const xs = Array.from({ length: SAMPLES + 1 }, (_, i) => START + ((NOW - START) * i) / SAMPLES);
const layers = GROUPS.map((_, g) => xs.map((x) => density(points[g], x)));
const totals = xs.map((_, i) => layers.reduce((s, l) => s + l[i], 0));

// Area between two boundary series, as one closed path.
const area = (upper, lower) =>
  `M${curve(xs.map((x, i) => [r1(xAt(x)), r1(upper[i])]))}L${curve(xs.map((x, i) => [r1(xAt(x)), r1(lower[i])]).reverse())}Z`;

// Drawn in from the left on page load.
const sweep = (h) =>
  `<clipPath id="reveal"><rect x="0" y="0" width="0" height="${h}"><animate attributeName="width" from="0" to="${W}" dur="2.4s" begin="0.1s" fill="freeze" ${EASE}/></rect></clipPath>`;

// Each look returns its marks, any defs, and how far down they reach.
const LOOKS = {
  // Centred streamgraph. Bands overlap from the top so there are no seams.
  stream(colors) {
    const MID = 92;
    const HALF = 84;
    const scale = HALF / (Math.max(...totals) / 2);
    const bottoms = GROUPS.map((_, g) =>
      xs.map((_, i) => MID + (totals[i] * scale) / 2 - layers.slice(0, g).reduce((s, l) => s + l[i], 0) * scale));
    const top = xs.map((_, i) => MID - (totals[i] * scale) / 2);
    const bands = GROUPS.map((_, g) => `<path d="${area(top, bottoms[g])}" fill="${colors[g]}"/>`).join("");
    return { defs: sweep(190), body: `<g clip-path="url(#reveal)">${bands}</g>`, bottom: 180 };
  },

  // Beeswarm: one dot per repo on the day it was created.
  dots(colors) {
    const MID = 92;
    const R = 5.2;
    const D = 2 * R + 1.2;
    const placed = [];
    for (const r of repos) {
      const x = xAt(r.t);
      const near = placed.filter((p) => Math.abs(p.x - x) < D);
      let y = MID;
      for (let k = 0; k < 400; k++) {
        const cy = MID + Math.ceil(k / 2) * (k % 2 ? -1 : 1);
        if (near.every((p) => (p.x - x) ** 2 + (p.y - cy) ** 2 >= D * D)) {
          y = cy;
          break;
        }
      }
      placed.push({ x, y, g: r.g });
    }
    const body = placed
      .map((p, i) =>
        `<circle cx="${r1(p.x)}" cy="${r1(p.y)}" r="0" fill="${colors[p.g]}"><animate attributeName="r" from="0" to="${R}" dur=".5s" begin="${(0.1 + i * 0.006).toFixed(3)}s" fill="freeze" ${EASE}/></circle>`)
      .join("");
    return { defs: "", body, bottom: 180 };
  },

  // One square per repo, stacked into a block for each year, oldest
  // language at the bottom. Squares grow in, year by year.
  blocks(colors) {
    const first = Math.floor(FIRST);
    const last = Math.floor(NOW);
    const span = (X1 - X0) / (NOW - START);
    const CELL = 9;
    const GAP = 2;
    const across = Math.max(1, Math.floor((span - 14) / (CELL + GAP)));
    const byYear = new Map();
    for (const r of repos) {
      const y = Math.floor(r.t);
      byYear.set(y, [...(byYear.get(y) ?? []), r]);
    }
    const rows = Math.max(...[...byYear.values()].map((l) => Math.ceil(l.length / across)));
    const BASE = 8 + rows * (CELL + GAP);
    const cells = [];
    for (let y = first; y <= last; y++) {
      const list = (byYear.get(y) ?? []).sort((a, b) => a.g - b.g || a.t - b.t);
      const width = across * (CELL + GAP) - GAP;
      const left = xAt(Math.min(y + 0.5, (y + NOW) / 2)) - width / 2;
      list.forEach((r, i) => {
        const cx = left + (i % across) * (CELL + GAP);
        const cy = BASE - (Math.floor(i / across) + 1) * (CELL + GAP);
        const begin = (0.1 + (y - first) * 0.09 + Math.floor(i / across) * 0.03).toFixed(2);
        cells.push(`<rect x="${r1(cx)}" y="${r1(cy)}" width="${CELL}" height="${CELL}" rx="2" fill="${colors[r.g]}" opacity="0"><animate attributeName="opacity" from="0" to="1" dur=".4s" begin="${begin}s" fill="freeze"/></rect>`);
      });
    }
    return { defs: "", body: cells.join(""), bottom: BASE };
  },

  // A lane per language with a tick for every repo.
  lanes(colors, t) {
    const LANE = 20;
    const GAP = 8;
    const body = GROUPS.map((_, g) => {
      const y = 8 + g * (LANE + GAP);
      const track = `<rect x="${X0}" y="${y}" width="${X1 - X0}" height="${LANE}" rx="4" fill="${t.track}"/>`;
      const ticks = repos
        .filter((r) => r.g === g)
        .map((r) => `<rect x="${r1(xAt(r.t) - 1.25)}" y="${y + 3}" width="2.5" height="${LANE - 6}" rx="1.25" fill="${colors[g]}"/>`)
        .join("");
      return track + ticks;
    }).join("");
    const bottom = 8 + GROUPS.length * (LANE + GAP) - GAP;
    return { defs: sweep(bottom + 4), body: `<g clip-path="url(#reveal)">${body}</g>`, bottom };
  },

  // The language mix as shares of 100%, in one slim ribbon.
  ribbon(colors) {
    const TOP = 8;
    const HEIGHT = 72;
    const prior = GROUPS.map((_, g) => points[g].length / repos.length);
    const shares = xs.map((_, i) => layers.map((l, g) => (l[i] + 0.6 * prior[g]) / (totals[i] + 0.6)));
    const bounds = GROUPS.map((_, g) =>
      xs.map((_, i) => TOP + HEIGHT * shares[i].slice(0, g).reduce((a, b) => a + b, 0)));
    const bottom = xs.map(() => TOP + HEIGHT);
    const bands = GROUPS.map((_, g) => `<path d="${area(bounds[g], bottom)}" fill="${colors[g]}"/>`).join("");
    return {
      defs: sweep(TOP + HEIGHT + 4) + `<clipPath id="round"><rect x="${X0}" y="${TOP}" width="${X1 - X0}" height="${HEIGHT}" rx="8"/></clipPath>`,
      body: `<g clip-path="url(#reveal)"><g clip-path="url(#round)">${bands}</g></g>`,
      bottom: TOP + HEIGHT,
    };
  },

  // A ridge per language, overlapping like a joy plot.
  ridges(colors, t) {
    const STEP = 28;
    const PEAK = 52;
    const max = Math.max(...layers.flat());
    const ridges = GROUPS.map((_, g) => {
      const base = 8 + PEAK + g * STEP;
      const top = layers[g].map((v) => base - (v / max) * PEAK);
      const flat = xs.map(() => base);
      const line = `M${curve(xs.map((x, i) => [r1(xAt(x)), r1(top[i])]))}`;
      return `<path d="${area(top, flat)}" fill="${colors[g]}" fill-opacity=".85"/><path d="${line}" fill="none" stroke="${t.surface}" stroke-width="1.5"/>`;
    }).join("");
    const bottom = 8 + PEAK + (GROUPS.length - 1) * STEP;
    return { defs: sweep(bottom + 4), body: `<g clip-path="url(#reveal)">${ridges}</g>`, bottom };
  },
};
LOOKS.plasma = LOOKS.greens = LOOKS.stream;

// ----------------------------------------------------------------- render

function chart(mode, look) {
  const t = { ...THEMES[mode], track: mode === "dark" ? "#161b22" : "#f3f4f6" };
  const colors = PALETTES[look][mode];
  const { defs, body, bottom } = LOOKS[look](colors, t);
  const AXIS = bottom + 10;
  const H = AXIS + 46;

  const firstYear = Math.floor(FIRST);
  const axis = [`<line x1="${X0}" x2="${X1}" y1="${AXIS}" y2="${AXIS}" stroke="${t.rule}"/>`];
  for (let y = firstYear; y <= Math.floor(NOW); y++) {
    const mid = Math.min(y + 0.5, (y + NOW) / 2);
    axis.push(`<text x="${r1(xAt(mid))}" y="${AXIS + 19}" text-anchor="middle" fill="${t.muted}">${y}</text>`);
    if (y > firstYear) axis.push(`<line x1="${r1(xAt(y))}" x2="${r1(xAt(y))}" y1="${AXIS}" y2="${AXIS + 5}" stroke="${t.rule}"/>`);
  }
  const widths = GROUPS.map((g) => 15 + g.name.length * 7 + 22);
  let lx = X1 - widths.reduce((a, b) => a + b, 0) + 22;
  const legend = GROUPS.map((g, i) => {
    const s = `<circle cx="${r1(lx + 4)}" cy="${H - 10}" r="4" fill="${colors[i]}"/><text x="${r1(lx + 14)}" y="${H - 6}" fill="${t.ink}">${g.name}</text>`;
    lx += widths[i];
    return s;
  }).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="The public repos I've started each year since ${firstYear}, by language">
<style>text{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans",Helvetica,Arial,sans-serif;font-size:12.5px}</style>
<defs>${defs}</defs>
<rect width="${W}" height="${H}" fill="${t.surface}"/>
${body}
${axis.join("")}
${legend}
</svg>
`;
}

const variantsAt = process.argv.indexOf("--variants");
if (variantsAt > -1) {
  const dir = process.argv[variantsAt + 1];
  await mkdir(dir, { recursive: true });
  for (const look of Object.keys(PALETTES))
    for (const mode of ["light", "dark"]) await writeFile(`${dir}/${look}-${mode}.svg`, chart(mode, look));
} else {
  await writeFile("languages-light.svg", chart("light", LOOK));
  await writeFile("languages-dark.svg", chart("dark", LOOK));
}
