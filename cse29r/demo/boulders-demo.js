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

/**
 * The goal counted in your current rank: on Rock, "7.6 / 25 Rocks, 17.4 to go".
 * `have` is rounded down and `need` is the rest of the target, so they always add
 * up and you never see "25 / 25" before you've actually ranked up.
 * Unranked counts in Pebbles. Null at max rank.
 */
function goalInRankUnits(pebbles) {
  const nx = nextRank(pebbles);
  if (!nx) return null;
  const unit = RANKS[Math.max(0, rankIndex(pebbles))];
  const target = nx.target / unit.value; // whole number: next rank's `per`
  const have = Math.floor((pebbles / unit.value) * 10 + 1e-9) / 10;
  const need = Math.round((target - have) * 10) / 10;
  return { unit, have, target, need };
}

/**
 * What you lifted, counted in your current rank plus the leftover in lb:
 * 1,057 lb on Rock -> { unit: Rock, whole: 1, restLb: 57 } ("1 Rock + 57 lb").
 * Unranked -> whole 0 Pebbles.
 */
function liftedInRank(totalLb) {
  const pebbles = lbToPebbles(totalLb);
  const unit = RANKS[Math.max(0, rankIndex(pebbles))];
  const whole = Math.floor(pebbles / unit.value);
  const restLb = Math.round((totalLb - whole * unit.value * PEBBLE_LB) * 10) / 10;
  return { unit, whole, restLb: Math.max(0, restLb) };
}

applyScale(1);

window.__boulders = {
  RANKS, PEBBLE_LB, applyScale, ladderScale, ageCoef, dotsP,
  lbToPebbles, totalPebbles, rankIndex, breakdown, nextRank, goalInRankUnits, liftedInRank, setVolumeLb,
};

// =================================== UI =====================================
const SAMPLE = [
  { name: "Squat", sets: 3, reps: 5, weight: 225, unit: "lb" },
  { name: "Bench press", sets: 3, reps: 8, weight: 135, unit: "lb" },
  { name: "Curl", sets: 3, reps: 10, weight: 25, unit: "lb" },
  { name: "Lateral raise", sets: 3, reps: 12, weight: 8, unit: "lb" },
];
const SESSIONS_PER_YEAR = 156; // 3 a week x 52 weeks
const HERO_SCALE = [0.36, 0.46, 0.58, 0.71, 0.85, 1]; // boulder size per rank

let sets = [];
let lastRank = -1;
let ladderChanged = false; // no "Ranked up!" when only the ladder changed
let rankedUpTo = null; // set by render() when a lift moves you up a rank
let toastTimer = 0;
let goalUnit = "rank"; // goal card shows "rank" units (e.g. Rocks) or "lb"

// ---------- helpers ----------
const $ = (id) => document.getElementById(id);
const checked = (name) => document.querySelector(`input[name=${name}]:checked`).value;
const fmt = (n, digits = 0) => n.toLocaleString(undefined, { maximumFractionDigits: digits });
const plural = (n, word) => `${fmt(n)} ${word}${n === 1 ? "" : "s"}`;
const lb = (pebbles) => fmt(pebbles * PEBBLE_LB, 1) + " lb";
// count with one decimal: "1 Rock", "17.4 Rocks"
const units = (n, word) => `${fmt(n, 1)} ${word}${n === 1 ? "" : "s"}`;

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

function toast(text, { rankUp = false } = {}) {
  const t = $("toast");
  t.textContent = text;
  t.classList.toggle("rankup", rankUp);
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), rankUp ? 3200 : 2200);
}

// ---------- tabs ----------
function showView(name) {
  document.body.dataset.view = name;
  document.querySelectorAll(".tabbar [role=tab]").forEach((tab) => {
    const on = tab.dataset.view === name;
    tab.setAttribute("aria-selected", String(on));
    tab.tabIndex = on ? 0 : -1;
    $("view-" + tab.dataset.view).hidden = !on;
  });
  window.scrollTo(0, 0);
}

// ---------- render ----------
function renderSets() {
  const list = $("sets");
  const count = $("logcount");
  count.hidden = sets.length === 0;
  count.textContent = String(sets.length);
  if (!sets.length) {
    list.replaceChildren(el("li", "empty", "No lifts yet. Add one on the Lift tab."));
    return;
  }
  list.replaceChildren(
    ...sets.map((s, i) => {
      const li = el("li");
      const info = el("div");
      info.append(
        el("strong", "", s.name || "Lift"),
        el("small", "", `${s.sets} x ${s.reps} at ${fmt(s.weight, 1)} ${s.unit} = ` +
          plural(lbToPebbles(setVolumeLb(s)), "Pebble")),
      );
      const remove = el("button", "btn", "Remove");
      remove.type = "button";
      remove.setAttribute("aria-label", `Remove ${s.name || "lift"} entry ${i + 1}`);
      remove.onclick = () => {
        sets.splice(i, 1);
        render();
      };
      li.append(info, remove);
      return li;
    }),
  );
}

function renderRank(ri, total) {
  const icon = $("rankicon");
  const name = $("rankname");
  if (ri < 0) {
    const empty = el("span", "b none");
    empty.style.setProperty("--f", HERO_SCALE[0]);
    empty.setAttribute("aria-hidden", "true");
    icon.replaceChildren(empty);
    name.textContent = "0 lb";
    $("ranktotal").textContent = "Lift something to earn your first Pebble.";
    return;
  }
  const hero = blob(RANKS[ri]);
  hero.style.width = hero.style.height = ""; // sized by CSS via --f
  hero.style.setProperty("--f", HERO_SCALE[ri]);
  icon.replaceChildren(hero);

  // "1 Rock + 57 lb" (Pebbles are already lb, so no leftover there)
  const { unit, whole, restLb } = liftedInRank(total.lb);
  name.replaceChildren(plural(whole, unit.name));
  if (unit.value > 1 && restLb > 0) name.append(" ", el("span", "rest", `+ ${fmt(restLb, 1)} lb`));
  $("ranktotal").textContent = `${fmt(total.lb, 1)} lb total`;
}

function checkRankUp(ri) {
  rankedUpTo = !ladderChanged && ri > lastRank && ri >= 1 ? RANKS[ri] : null;
  ladderChanged = false;
  lastRank = ri;
}

/** Show the rank-up message if this change ranked you up, otherwise `text`. */
function announce(text) {
  if (rankedUpTo) toast(`Ranked up to ${rankedUpTo.name}!`, { rankUp: true });
  else if (text) toast(text);
}

function renderGoal(pebbles) {
  const goal = $("progress");
  if (pebbles < 1) {
    const p = el("p", "goal-empty muted", `Goal: your first Stone (${lb(RANKS[1].value)}). Log a lift below.`);
    const demo = el("button", "btn", "Try the sample workout");
    demo.type = "button";
    demo.onclick = loadSample;
    const wrap = el("div", "goal-empty");
    wrap.append(p, demo);
    goal.replaceChildren(wrap);
    return;
  }
  const nx = nextRank(pebbles);
  if (!nx) {
    goal.replaceChildren(el("p", "togo goal-empty", "Max rank reached. You are a Monolith."));
    return;
  }
  const g = goalInRankUnits(pebbles);
  const inLb = goalUnit === "lb";
  const unitName = g.unit.name;

  // row 1: next rank + unit switch
  const label = el("div", "goal-label muted small", "Next goal ");
  label.append(el("strong", "", nx.rank.name));
  const top = el("div", "goal-top");
  top.append(blob(nx.rank, 30), label, unitSwitch(unitName));

  // row 2: how much is left, in the chosen unit
  const togo = inLb ? `${lb(nx.need)} to go` : `${units(g.need, unitName)} to go`;
  const hint = inLb || g.unit.value === 1 ? "" : `1 ${unitName} = ${lb(g.unit.value)}`;

  const labels = el("div", "barlabels");
  labels.append(
    el("span", "", inLb
      ? `${lb(nx.have)} / ${lb(nx.target)}`
      : `${fmt(g.have, 1)} / ${units(g.target, unitName)}`),
    el("span", "", pct(nx.fraction)),
  );
  goal.replaceChildren(
    top,
    el("div", "togo", togo),
    progressBar(nx.have, nx.target, `Progress to ${nx.rank.name}`, {
      valueText: `${pct(nx.fraction)}, ${togo}`,
    }),
    labels,
  );
  if (hint) goal.appendChild(el("div", "goal-hint muted small", hint));
}

/** Two-option switch: [Rocks | lb]. Re-renders the goal card when flipped. */
function unitSwitch(unitName) {
  const sw = el("div", "unit-switch");
  sw.setAttribute("role", "group");
  sw.setAttribute("aria-label", "Show goal in");
  for (const [value, text] of [["rank", unitName + "s"], ["lb", "lb"]]) {
    const b = el("button", "", text);
    b.type = "button";
    b.setAttribute("aria-pressed", String(goalUnit === value));
    b.onclick = () => {
      goalUnit = value;
      renderGoal(totalPebbles(sets).pebbles);
      $("progress").querySelector(`.unit-switch [aria-pressed="true"]`).focus();
    };
    sw.appendChild(b);
  }
  return sw;
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
        el("td", "n", lb(r.value)),
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
  renderRank(ri, total);
  checkRankUp(ri);
  renderGoal(total.pebbles);
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

// ---------- actions ----------
function loadSample() {
  sets = SAMPLE.map((s) => ({ ...s }));
  $("err").textContent = "";
  render();
  announce(`Sample workout loaded: ${plural(totalPebbles(sets).pebbles, "Pebble")}`);
}

function addLift(e) {
  e.preventDefault();
  const weight = parseFloat($("weight").value);
  const reps = parseInt($("reps").value, 10);
  const count = parseInt($("setcount").value, 10);
  if (!(weight > 0)) {
    $("err").textContent = "Enter a weight above 0.";
    $("weight").focus();
    return;
  }
  if (!(reps > 0) || !(count > 0)) {
    $("err").textContent = "Reps and sets must be at least 1.";
    return;
  }
  $("err").textContent = "";
  const lift = { name: $("name").value.trim(), reps, sets: count, weight, unit: checked("unit") };
  sets.push(lift);
  // keep weight, name, reps and sets filled in so the next set is one tap
  render();
  announce(`+${plural(lbToPebbles(setVolumeLb(lift)), "Pebble")}${lift.name ? " · " + lift.name : ""}`);
}

function step(id, dir) {
  const input = $(id);
  const v = parseInt(input.value, 10) || 0;
  input.value = String(Math.max(1, v + dir));
}

// Keep the Lift view's bottom padding equal to the docked entry's real height.
function trackEntryHeight() {
  const entry = $("form");
  const set = () =>
    document.documentElement.style.setProperty("--entry-h", entry.offsetHeight + "px");
  if ("ResizeObserver" in window) new ResizeObserver(set).observe(entry);
  set();
}

// ---------- events ----------
document.querySelectorAll(".tabbar [role=tab]").forEach((tab) => {
  tab.addEventListener("click", () => showView(tab.dataset.view));
  // arrow keys move between tabs
  tab.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const tabs = [...document.querySelectorAll(".tabbar [role=tab]")];
    const next = tabs[(tabs.indexOf(tab) + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
    next.focus();
    showView(next.dataset.view);
  });
});
document.querySelectorAll("[data-step]").forEach((b) =>
  b.addEventListener("click", () => step(b.dataset.step, Number(b.dataset.dir))),
);

$("profile").addEventListener("submit", (e) => e.preventDefault());
$("age").addEventListener("input", updateLadder);
$("bw").addEventListener("input", updateLadder);
document
  .querySelectorAll("input[name=sex], input[name=bwunit]")
  .forEach((i) => i.addEventListener("change", updateLadder));

$("form").addEventListener("submit", addLift);
$("weight").addEventListener("input", () => ($("err").textContent = ""));
$("sample").onclick = () => {
  loadSample();
  showView("lift");
};
$("sampleYear").onclick = () => {
  sets = SAMPLE.map((s) => ({ ...s, name: `${s.name} (year)`, sets: s.sets * SESSIONS_PER_YEAR }));
  $("err").textContent = "";
  render();
  showView("lift");
  announce("A year of training loaded");
};
$("clear").onclick = () => {
  sets = [];
  $("err").textContent = "";
  render();
};

showView("lift");
trackEntryHeight();
updateLadder();
