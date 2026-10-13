/* Boulder Lifts demo logic.
 * Sections: rank config -> personal ladder scale -> pebble math -> UI.
 * Pure functions are exposed on window.__boulders for testing.
 */
"use strict";

// ===================== Rank config (PLACEHOLDER values) =====================
// 1 Pebble = PEBBLE_LB lb lifted (weight x reps x sets).
// BASE_PER[i] = how many of rank i-1 make one of rank i.
// Only Stone's size is scaled per person (clamped); the rest are fixed,
// so every threshold scales together and the rank names keep their meaning.
const PEBBLE_LB = 1;
const BASE_PER = [1, 50, 20, 25, 20, 10];
const STONE_MIN = 10;
const STONE_MAX = 100;

const RANKS = [
  { id: "pebble", name: "Pebble", size: 14, color: "#a8a29e" },
  { id: "stone", name: "Stone", size: 20, color: "#8d9aa3" },
  { id: "rock", name: "Rock", size: 28, color: "#8a8f6a" },
  { id: "boulder", name: "Boulder", size: 38, color: "#9a7b5f" },
  { id: "great", name: "Great Boulder", size: 48, color: "#7a5f78" },
  { id: "mono", name: "Monolith", size: 58, color: "#4f5d75" },
];

/** Set each rank's `per` and `value` (worth in Pebbles) for a ladder scale. */
function applyScale(scale) {
  RANKS.forEach((r, i) => (r.per = BASE_PER[i]));
  RANKS[1].per = clamp(Math.round(BASE_PER[1] * scale), STONE_MIN, STONE_MAX);
  RANKS.reduce((v, r) => (r.value = v * r.per), 1);
}

// ============ Personal ladder scale (PLACEHOLDER research values) ===========
const KG_PER_LB = 0.45359237; // exact by definition
const REF_KG = 180 * KG_PER_LB; // standard ladder = male, 180 lb, under 40

// Sex + bodyweight: DOTS powerlifting formula, DOTS = total * 500 / P(bw kg).
// Equal score needs a total proportional to P(bw), so P ratios give the scale.
// Polynomial coefficients a..e; bodyweight clamped to the fitted range.
const DOTS = {
  M: { c: [-307.75076, 24.0900756, -0.1918759221, 0.0007391293, -0.000001093], lo: 40, hi: 210 },
  F: { c: [-57.96288, 13.6175032, -0.1126655495, 0.0005158568, -0.0000010706], lo: 40, hi: 150 },
};

// Age: McCulloch masters coefficients (WRPF 2017 table), linear between points.
// A coefficient above 1 means a lift counts for more, so the ladder shrinks by 1/coef.
const AGE_PTS = [
  [40, 1.0], [45, 1.055], [50, 1.13], [55, 1.225], [60, 1.34],
  [65, 1.48], [70, 1.645], [75, 1.835], [80, 2.05], [90, 2.549],
];

function clamp(x, lo, hi) {
  return Math.min(hi, Math.max(lo, x));
}

function dotsP(sex, kg) {
  const d = DOTS[sex];
  const x = clamp(kg, d.lo, d.hi);
  return d.c.reduce((sum, a, i) => sum + a * Math.pow(x, i), 0);
}

function ageCoef(age) {
  if (!(age >= 40)) return 1;
  const last = AGE_PTS[AGE_PTS.length - 1];
  if (age >= last[0]) return last[1];
  for (let i = 1; i < AGE_PTS.length; i++) {
    const [a1, c1] = AGE_PTS[i - 1];
    const [a2, c2] = AGE_PTS[i];
    if (age <= a2) return c1 + ((c2 - c1) * (age - a1)) / (a2 - a1);
  }
  return 1;
}

/**
 * profile = { age, sex: "M" | "F" | "", bwKg }. Missing parts use the standard:
 * no bodyweight -> 180 lb, no sex -> average of both curves, under 40 -> 1.
 */
function ladderScale(profile) {
  const kg = profile.bwKg > 0 ? profile.bwKg : REF_KG;
  const ref = dotsP("M", REF_KG);
  let body = 1;
  if (profile.sex === "M" || profile.sex === "F") body = dotsP(profile.sex, kg) / ref;
  else if (profile.bwKg > 0) body = (dotsP("M", kg) + dotsP("F", kg)) / 2 / ref;
  const age = 1 / ageCoef(profile.age);
  return { scale: body * age, body, age };
}

// ============================== Pebble math =================================
function setVolumeLb(s) {
  const lb = s.unit === "kg" ? s.weight / KG_PER_LB : s.weight;
  return lb * s.reps * s.sets;
}

// Round away float noise first (e.g. 76529.99999...) so no Pebble is lost.
function lbToPebbles(lb) {
  return Math.floor(Math.round((lb / PEBBLE_LB) * 1e4) / 1e4);
}

function totalPebbles(sets) {
  let lb = 0;
  for (const s of sets) {
    if (s.weight > 0 && s.reps > 0 && s.sets > 0) lb += setVolumeLb(s);
  }
  return { lb, pebbles: lbToPebbles(lb) };
}

/** Index of the highest rank held; -1 when unranked (0 Pebbles). */
function rankIndex(pebbles) {
  if (pebbles < 1) return -1;
  for (let i = RANKS.length - 1; i > 0; i--) if (pebbles >= RANKS[i].value) return i;
  return 0;
}

/** Whole ranks held, biggest first, e.g. 7,653 -> 7 Rocks + 13 Stones + 3 Pebbles. */
function breakdown(pebbles) {
  const out = {};
  let left = pebbles;
  for (let i = RANKS.length - 1; i >= 0; i--) {
    out[RANKS[i].id] = Math.floor(left / RANKS[i].value);
    left -= out[RANKS[i].id] * RANKS[i].value;
  }
  return out;
}

/** Next rank and distance to it; null at max rank. */
function nextRank(pebbles) {
  const next = RANKS[rankIndex(pebbles) + 1];
  if (!next) return null;
  return {
    rank: next,
    need: next.value - pebbles,
    have: pebbles,
    target: next.value,
    fraction: pebbles / next.value,
  };
}

applyScale(1);

window.__boulders = {
  RANKS, PEBBLE_LB, applyScale, ladderScale, ageCoef, dotsP,
  lbToPebbles, totalPebbles, rankIndex, breakdown, nextRank, setVolumeLb,
};

// =================================== UI =====================================
const SAMPLE = [
  { name: "Squat", sets: 3, reps: 5, weight: 225, unit: "lb" },
  { name: "Bench press", sets: 3, reps: 8, weight: 135, unit: "lb" },
  { name: "Curl", sets: 3, reps: 10, weight: 25, unit: "lb" },
  { name: "Lateral raise", sets: 3, reps: 12, weight: 8, unit: "lb" },
];
const SESSIONS_PER_YEAR = 156; // 3 a week x 52 weeks

let sets = [];
let lastRank = -1;
let ladderChanged = false; // suppress "Ranked up!" when only the ladder changed

// ---------- helpers ----------
const $ = (id) => document.getElementById(id);
const checked = (name) => document.querySelector(`input[name=${name}]:checked`).value;
const fmt = (n, digits = 0) => n.toLocaleString(undefined, { maximumFractionDigits: digits });
const plural = (n, word) => `${fmt(n)} ${word}${n === 1 ? "" : "s"}`;
const lb = (pebbles) => fmt(pebbles * PEBBLE_LB, 1) + " lb";

function pct(f) {
  const p = f * 100;
  if (p > 0 && p < 0.1) return "<0.1%";
  return fmt(Math.min(100, p), p < 10 ? 1 : 0) + "%";
}

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

function blob(rank, px) {
  const e = el("span", "b");
  e.style.width = e.style.height = (px || rank.size) + "px";
  e.style.background = rank.color;
  e.setAttribute("aria-hidden", "true");
  return e;
}

/** Progress bar with ARIA. Any progress shows at least a 1% sliver. */
function progressBar(have, max, label, { thin = false, valueText } = {}) {
  const b = el("div", thin ? "bar thin" : "bar");
  const fill = el("span");
  const f = have / max;
  fill.style.width = (f > 0 ? clamp(f * 100, 1, 100) : 0) + "%";
  b.appendChild(fill);
  b.setAttribute("role", "progressbar");
  b.setAttribute("aria-label", label);
  b.setAttribute("aria-valuemin", "0");
  b.setAttribute("aria-valuemax", String(max));
  b.setAttribute("aria-valuenow", String(have));
  if (valueText) b.setAttribute("aria-valuetext", valueText);
  return b;
}

// ---------- render ----------
function renderSets() {
  $("sets").replaceChildren(
    ...sets.map((s, i) => {
      const li = el("li");
      const text =
        `${s.name || "Set"}: ${s.sets} x ${s.reps} at ${fmt(s.weight, 1)} ${s.unit} = ` +
        plural(lbToPebbles(setVolumeLb(s)), "Pebble");
      const remove = el("button", "", "Remove");
      remove.type = "button";
      remove.setAttribute("aria-label", `Remove ${s.name || "set"} entry ${i + 1}`);
      remove.onclick = () => {
        sets.splice(i, 1);
        render();
      };
      li.append(el("span", "", text), remove);
      return li;
    }),
  );
}

function renderRank(ri, total, parts) {
  $("rankicon").replaceChildren();
  if (ri < 0) {
    $("rankname").textContent = "Unranked";
    $("ranktotal").textContent = "Lift something to earn your first Pebble.";
    $("holdings").textContent = "";
    return;
  }
  $("rankicon").appendChild(blob(RANKS[ri], 52));
  $("rankname").textContent = RANKS[ri].name;
  $("ranktotal").textContent = `${fmt(total.lb, 1)} lb lifted = ${plural(total.pebbles, "Pebble")}`;
  const held = RANKS.slice()
    .reverse()
    .filter((r) => parts[r.id])
    .map((r) => plural(parts[r.id], r.name));
  $("holdings").textContent = `You have ${held.join(" + ")}.`;
}

function renderFlash(ri) {
  const flash = $("flash");
  if (ladderChanged) {
    flash.hidden = true;
    ladderChanged = false;
  } else if (ri > lastRank && ri >= 1) {
    flash.textContent = `Ranked up to ${RANKS[ri].name}!`;
    flash.hidden = false;
  } else if (ri < lastRank) {
    flash.hidden = true;
  }
  lastRank = ri;
}

function renderProgress(pebbles) {
  const prog = $("progress");
  const nx = nextRank(pebbles);
  if (!nx) {
    prog.replaceChildren(el("p", "togo", "Max rank reached. You are a Monolith."));
    return;
  }
  const label = el("div", "muted small", "Next rank: ");
  label.appendChild(el("strong", "", nx.rank.name));
  const togo = lb(nx.need) + " to go" + (PEBBLE_LB === 1 ? "" : ` (${plural(nx.need, "Pebble")})`);
  const text = el("div");
  text.append(label, el("div", "togo", togo));
  const head = el("div", "nexthead");
  head.append(blob(nx.rank, 30), text);

  const labels = el("div", "barlabels");
  labels.append(
    el("span", "", `${fmt(nx.have)} / ${fmt(nx.target)} Pebbles`),
    el("span", "", pct(nx.fraction)),
  );
  prog.replaceChildren(
    head,
    progressBar(nx.have, nx.target, `Progress to ${nx.rank.name}`, {
      valueText: `${pct(nx.fraction)}, ${fmt(nx.need)} Pebbles to go`,
    }),
    labels,
  );
}

// Each level fills toward one of the next level, like an odometer.
function renderLadder(parts) {
  const rows = [el("div", "muted small ladder-cap", "Each level fills up, then turns into one of the next:")];
  for (let i = 0; i < RANKS.length - 1; i++) {
    const r = RANKS[i];
    const up = RANKS[i + 1];
    const have = parts[r.id];
    const row = el("div", "rung");
    row.append(
      blob(r, 16),
      el("span", "name", r.name + "s"),
      progressBar(have, up.per, `${r.name}s toward next ${up.name}`, { thin: true }),
      el("span", "num", `${fmt(have)} / ${fmt(up.per)}`),
    );
    rows.push(row);
  }
  $("ladder").replaceChildren(...rows);
}

function renderGuide(ri) {
  $("guide").replaceChildren(
    ...RANKS.map((r, i) => {
      const tr = el("tr", i === ri ? "current" : "");
      const name = el("span", "guidename");
      name.append(blob(r, 18), r.name);
      const nameCell = el("td");
      nameCell.appendChild(name);
      tr.append(
        nameCell,
        el("td", "n", i === 0 ? "base unit" : `${fmt(r.per)} ${RANKS[i - 1].name}s`),
        el("td", "n hide-sm", lb(r.value)),
      );
      return tr;
    }),
  );
}

function render() {
  const total = totalPebbles(sets);
  const ri = rankIndex(total.pebbles);
  const parts = breakdown(total.pebbles);
  renderSets();
  renderRank(ri, total, parts);
  renderFlash(ri);
  renderProgress(total.pebbles);
  renderLadder(parts);
  renderGuide(ri);
}

// ---------- personal ladder ----------
function readProfile() {
  const p = { age: NaN, sex: checked("sex"), bwKg: NaN };
  const errs = [];
  const ageRaw = $("age").value;
  const bwRaw = $("bw").value;
  if (ageRaw !== "") {
    const age = parseInt(ageRaw, 10);
    if (age >= 18 && age <= 100) p.age = age;
    else errs.push("Age must be 18 to 100 for now (no data for under 18 yet).");
  }
  if (bwRaw !== "") {
    const bw = parseFloat(bwRaw);
    const kg = checked("bwunit") === "kg" ? bw : bw * KG_PER_LB;
    if (kg >= 25 && kg <= 300) p.bwKg = kg;
    else errs.push("Bodyweight looks off (expected about 55 to 660 lb).");
  }
  $("scaleerr").textContent = errs.join(" ");
  return p;
}

function updateLadder() {
  const p = readProfile();
  const { scale, body, age } = ladderScale(p);
  applyScale(scale);

  const parts = [];
  if (p.sex || p.bwKg > 0) parts.push(`body ${body.toFixed(2)}x`);
  if (p.age >= 40) parts.push(`age ${age.toFixed(2)}x`);
  const title = parts.length
    ? `Your ladder: ${scale.toFixed(2)}x (${parts.join(", ")})`
    : "Standard ladder (1.00x)";
  $("scaleinfo").replaceChildren(
    el("strong", "", title),
    `. 1 Stone = ${RANKS[1].per} Pebbles, Boulder = ${lb(RANKS[3].value)}, Monolith = ${lb(RANKS[5].value)}.`,
  );

  ladderChanged = true;
  render();
}

// ---------- events ----------
$("profile").addEventListener("submit", (e) => e.preventDefault());
$("age").addEventListener("input", updateLadder);
$("bw").addEventListener("input", updateLadder);
document
  .querySelectorAll("input[name=sex], input[name=bwunit]")
  .forEach((i) => i.addEventListener("change", updateLadder));

$("form").addEventListener("submit", (e) => {
  e.preventDefault();
  const weight = parseFloat($("weight").value);
  const reps = parseInt($("reps").value, 10);
  const count = parseInt($("setcount").value, 10);
  if (!(weight > 0)) {
    $("err").textContent = "Enter a weight above 0 (0 lb work is not counted).";
    return;
  }
  if (!(reps > 0) || !(count > 0)) {
    $("err").textContent = "Reps and sets must be at least 1.";
    return;
  }
  $("err").textContent = "";
  sets.push({ name: $("name").value.trim(), reps, sets: count, weight, unit: checked("unit") });
  $("weight").value = "";
  $("name").value = "";
  $("weight").focus();
  render();
});

$("sample").onclick = () => {
  sets = SAMPLE.map((s) => ({ ...s }));
  render();
};
$("sampleYear").onclick = () => {
  sets = SAMPLE.map((s) => ({ ...s, name: `${s.name} (year)`, sets: s.sets * SESSIONS_PER_YEAR }));
  render();
};
$("clear").onclick = () => {
  sets = [];
  $("err").textContent = "";
  render();
};

updateLadder();
