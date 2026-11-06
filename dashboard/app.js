import mqtt from "https://cdn.jsdelivr.net/npm/mqtt@5.16.0/dist/mqtt.esm.js";
import { initDemoPanel } from "./demo-panel.js?v=20261106m";
import { FIRST_STEP, advance, createSignal, enterNormal, enterPriority, laneAt } from "./signals.js?v=20261106m";

const L = window.L;
const LABEL = { ambulance: "Ambulans", firetruck: "Pemadam" };
// Phase A = the main road the demo route runs on, B = the cross street (same labels as the Wokwi board).
const PHASE = { A: "jalur utama", B: "jalur silang" };
const ICON_PATH = {
  ambulance: "M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z",
  firetruck:
    "M12 2c.6 3.2-1.6 4.6-1.6 7 0 1.3 1 2.3 2.2 2.3 1.6 0 2.5-1.4 2.1-3.6 2.4 1.7 3.8 4.3 3.8 6.8a6.5 6.5 0 0 1-13 0c0-3.4 2.4-5.8 3.9-7.3.2 1.3.8 2.3 1.6 2.9-.4-2.7.1-5.6 1-8.1z",
};

const css = getComputedStyle(document.documentElement);
const token = (name) => css.getPropertyValue(name).trim();
const ZONE_STYLE = {
  NORMAL: { color: token("--normal"), weight: 1, opacity: 0.5, fillOpacity: 0.04 },
  PRIORITY: { color: token("--priority"), weight: 1.5, opacity: 0.9, fillOpacity: 0.12 },
};

const el = {
  status: document.getElementById("mqtt-status"),
  steps: {
    gps: document.getElementById("step-gps"),
    ai: document.getElementById("step-ai"),
    green: document.getElementById("step-green"),
  },
  stepAiSub: document.getElementById("step-ai-sub"),
  demoToggle: document.getElementById("demo-toggle"),
  intersections: document.getElementById("intersections"),
  vehicles: document.getElementById("vehicles"),
  log: document.getElementById("log"),
};

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

const [config, intersections, route] = await Promise.all([
  getJson("/api/config"),
  getJson("/api/intersections"),
  getJson("/api/route"),
]);

// --- map -------------------------------------------------------------------
const map = L.map("map", { zoomControl: false, zoomSnap: 0.25 });
L.control.zoom({ position: "topleft" }).addTo(map);
// Standard OSM tiles, softened with a CSS filter (.map-tiles) so the glass UI and overlays read.
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  className: "map-tiles",
  attribution: "&copy; OpenStreetMap contributors",
}).addTo(map);

const COLOR_WORD = { red: "merah", yellow: "kuning", green: "hijau" };
// Two lamps per junction: left = main road (A), right = cross street (B). Colours come from signals.js only.
const signalIcon = ({ A, B }) =>
  L.divIcon({
    className: "",
    html: `<span class="sig" title="Jalur utama ${COLOR_WORD[A]} · jalur silang ${COLOR_WORD[B]}"><i class="lamp lamp--${A}"></i><i class="lamp lamp--${B}"></i></span>`,
    iconSize: [34, 18],
  });

// `type` is whitelisted in onVehicle before it reaches this HTML string.
const vehicleIcon = (type) =>
  L.divIcon({
    className: "",
    html: `<span class="vehicle-icon vehicle-icon--${type}"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="${ICON_PATH[type]}"/></svg></span>`,
    iconSize: [32, 32],
  });

// Demo route: faint line plus start and end pins, so it is clear where the vehicles come from and go to.
const routePin = (modifier, text) =>
  L.divIcon({
    className: "",
    html: `<span class="route-pin route-pin--${modifier}">${text}</span>`,
    iconSize: null,
  });
if (route.length > 1) {
  L.polyline(route, { color: token("--text"), weight: 4, opacity: 0.22 }).addTo(map);
  L.marker(route[0], { icon: routePin("start", "Mulai") })
    .addTo(map)
    .bindTooltip("Titik awal rute · Jl. Gajah Mada");
  L.marker(route[route.length - 1], { icon: routePin("end", "Tujuan") })
    .addTo(map)
    .bindTooltip("Titik akhir rute · RSUD dr. Soebandi");
}

/** id -> { info, zone, dot, cmd, expiresAt } */
const junctions = new Map();
for (const info of intersections) {
  const zone = L.circle([info.lat, info.lng], {
    radius: config.radiusM,
    className: "zone",
    ...ZONE_STYLE.NORMAL,
  }).addTo(map);
  const signal = createSignal(FIRST_STEP[info.id] ?? 0, Date.now());
  const colors = advance(signal, Date.now());
  const dot = L.marker([info.lat, info.lng], { icon: signalIcon(colors) })
    .addTo(map)
    .bindTooltip(info.id, {
      permanent: true,
      direction: "top",
      offset: [0, -10],
      className: "junction-label",
    });
  junctions.set(info.id, {
    info,
    zone,
    dot,
    cmd: { mode: "NORMAL" },
    expiresAt: 0,
    signal,
    colors,
  });
}
// Bounds from coordinates, not circle.getBounds(): layers are not projected until the map has a view.
const bounds = L.latLngBounds([]);
for (const info of intersections)
  bounds.extend(L.latLng(info.lat, info.lng).toBounds(config.radiusM * 2));
for (const point of route) bounds.extend(point);
const panelEl = document.querySelector(".panel");
// The glass panel floats over the map (right column, or a bottom sheet on narrow screens) and the Panel Demo drawer
// over its left edge: pad the view so the route is not hidden behind either.
function fitView(drawerOpen = false) {
  const sheet = matchMedia("(max-width: 800px)").matches;
  map.fitBounds(bounds, {
    paddingTopLeft: [drawerOpen && !sheet ? 392 : 20, 20],
    // Desktop: keep the route clear of the floating panel (right) and the legend (bottom-left).
    paddingBottomRight: sheet
      ? [20, panelEl.offsetHeight + 24]
      : [panelEl.offsetWidth + 32, (document.querySelector(".legend")?.offsetHeight ?? 0) + 32],
  });
}

// Legend: every colour on the map also has a word, so nothing is conveyed by colour alone.
const legend = L.control({ position: "bottomleft" });
legend.onAdd = () => {
  const div = L.DomUtil.create("div", "legend glass");
  div.innerHTML = `
    <strong>Keterangan peta</strong>
    <span><i class="legend__zone"></i><span id="legend-zone"></span></span>
    <span><i class="legend__sig"><b class="lamp lamp--red"></b><b class="lamp lamp--green"></b></i>Lampu simpang: kiri jalur utama, kanan jalur silang</span>
    <span><i class="legend__zone legend__zone--green"></i>Zona hijau: lampu ditahan untuk kendaraan darurat</span>
    <span><i class="legend__vehicle"></i>Ambulans (biru) / pemadam (merah)</span>
    <span><i class="legend__route"></i>Rute demo</span>
    <span><i class="legend__citizen"></i>Warga (posisi simulasi)</span>`;
  return div;
};
legend.addTo(map);
const setLegendRadius = (m) => {
  document.getElementById("legend-zone").textContent =
    `Zona ${m >= 1000 ? `${m / 1000} km` : `${m} m`} di sekitar simpang`;
};
setLegendRadius(config.radiusM);
fitView(); // after the legend exists, so its height is part of the padding
el.stepAiSub.textContent =
  config.etaLeadS > 0
    ? `lampu dibuka saat tiba ≤ ${config.etaLeadS} dtk lagi`
    : "di radius simpang";

/** id -> { marker, trail, data, lastSeen } */
const vehicles = new Map();

// Where Citizen HUDs in "Posisi simulasi" mode are, as set from the Panel Demo.
const citizenMarker = L.circleMarker([0, 0], {
  radius: 7,
  color: token("--on-solid"),
  weight: 3,
  fillColor: token("--text"),
  fillOpacity: 1,
}).bindTooltip("Warga (posisi simulasi)");

// --- panel -----------------------------------------------------------------
/** "Jalur utama ● hijau · Jalur silang ● merah": the colour in words too, never colour alone. */
function lampsRow({ A, B }) {
  const row = document.createElement("span");
  row.className = "card__lamps";
  for (const [label, color] of [["Jalur utama", A], ["Jalur silang", B]]) {
    const item = document.createElement("span");
    const lamp = document.createElement("i");
    lamp.className = `lamp lamp--${color}`;
    item.append(lamp, `${label} ${COLOR_WORD[color]}`);
    row.append(item);
  }
  return row;
}

function card(title, pillText, pillClass, sub) {
  const li = document.createElement("li");
  li.className = "card";
  const titleEl = document.createElement("span");
  titleEl.className = "card__title";
  titleEl.textContent = title;
  const pill = document.createElement("span");
  pill.className = `pill ${pillClass}`;
  pill.textContent = pillText;
  const subEl = document.createElement("span");
  subEl.className = "card__sub";
  subEl.textContent = sub;
  li.append(titleEl, pill, subEl);
  return li;
}

function empty(text) {
  const li = document.createElement("li");
  li.className = "empty";
  li.textContent = text;
  return li;
}

function renderJunctions() {
  el.intersections.replaceChildren(
    ...[...junctions.values()].map(({ info, cmd, colors }) => {
      const li = cmd.mode === "PRIORITY"
        ? card(
            info.id,
            `Hijau · ${PHASE[cmd.phase]}`,
            "pill--priority",
            `${info.name} · untuk ${LABEL[cmd.vehicleType]} ${cmd.vehicleId}`,
          )
        : card(info.id, "Siklus normal", "", info.name);
      li.append(lampsRow(colors));
      return li;
    }),
  );
}

function renderVehicles() {
  const items = [...vehicles.entries()].map(([id, v]) => vehicleCard(id, v));
  el.vehicles.replaceChildren(...(items.length ? items : [vehiclesEmpty()]));
  renderFlow();
}

function vehiclesEmpty() {
  const li = document.createElement("li");
  li.className = "empty-state";
  const text = document.createElement("p");
  text.textContent =
    "Belum ada kendaraan darurat aktif. Tekan Mulai demo untuk menjalankan ambulans simulasi menuju simpang S1, atau buka aplikasi Driver di /mobile/.";
  const btn = document.createElement("button");
  btn.className = "btn btn--primary";
  btn.textContent = "Mulai demo";
  const note = document.createElement("p");
  note.className = "empty-state__note";
  note.setAttribute("role", "status");
  btn.addEventListener("click", () => quickRun(btn, note));
  li.append(text, btn, note);
  return li;
}

/** Keyless demo start (POST /api/demo/quick-run): one ambulance just outside S1's radius, capped server-side. */
async function quickRun(btn, note) {
  btn.disabled = true;
  btn.textContent = "Menjalankan…";
  try {
    const res = await fetch("/api/demo/quick-run", { method: "POST" });
    if (res.ok) {
      note.textContent = "Ambulans simulasi berangkat. Kartunya muncul dalam 1–2 detik.";
      return; // the vehicle message replaces this empty state
    }
    note.textContent =
      res.status === 429
        ? "Simulasi sedang penuh (maks. 3 kendaraan). Coba lagi sebentar."
        : "Simulasi tidak tersedia saat ini.";
  } catch {
    note.textContent = "Tidak bisa terhubung ke server.";
  }
  btn.disabled = false;
  btn.textContent = "Mulai demo";
}

function span(className, text) {
  const node = document.createElement("span");
  node.className = className;
  node.textContent = text;
  return node;
}

const STOP_KMH = 3; // same "stopped" threshold as the engine's stop release (priority.ts)
const duration = (s) => (s % 60 === 0 ? `${s / 60} menit` : `${s} dtk`);

/** One vehicle with the ETA model's prediction for its next intersection. */
function vehicleCard(id, v) {
  const { data } = v;
  const li = document.createElement("li");
  li.className = "vcard";
  const stopped = Number.isFinite(data.speed) && data.speed < STOP_KMH;
  const speed = `${Math.round(data.speed ?? 0)} km/j`;
  const head = document.createElement("div");
  head.className = "vcard__head";
  head.append(
    span("vcard__id", id),
    span(`pill pill--${data.type}`, LABEL[data.type]),
    span("vcard__speed", speed),
  );
  li.append(head);

  const target =
    typeof data.nextId === "string" && Number.isFinite(data.etaS)
      ? junctions.get(data.nextId)
      : undefined;
  if (!target) {
    li.append(span("vcard__idle", "Tidak sedang mendekati simpang"));
    return li;
  }

  const lead = config.etaLeadS;
  const where = target.info.id;
  const holder = target.cmd.mode === "PRIORITY" ? target.cmd.vehicleId : null;
  // Behind the vehicle that holds the light, in the same lane: the green it opened serves this one too.
  const sameLane =
    holder !== null &&
    holder !== id &&
    Number.isFinite(data.lat) &&
    Number.isFinite(data.lng) &&
    target.cmd.phase === laneAt(target.info, data.lat, data.lng);
  const green = holder === id || sameLane;
  const eta = document.createElement("div");
  eta.className = "vcard__eta";
  // A stopped vehicle has no real arrival time (the model would only divide the distance by its minimum speed).
  if (stopped)
    eta.append(
      span("vcard__eta-value vcard__eta-value--text", "Berhenti"),
      span("vcard__eta-label", `prediksi AI ke ${where} lanjut saat bergerak`),
    );
  else
    eta.append(
      span("vcard__eta-value", String(data.etaS)),
      span("vcard__eta-unit", "dtk"),
      span("vcard__eta-label", `prediksi AI tiba di ${where}`),
    );
  // The bar fills up as the predicted arrival approaches the threshold; full = green opens.
  const bar = document.createElement("div");
  bar.className = `vcard__bar${green ? " vcard__bar--green" : ""}`;
  bar.setAttribute("aria-hidden", "true");
  const fill = document.createElement("span");
  const ratio = green || lead <= 0 ? 1 : stopped ? 0 : Math.min(1, lead / Math.max(data.etaS, 1));
  fill.style.width = `${Math.round(ratio * 100)}%`;
  bar.append(fill);
  const release = config.stopReleaseS;
  const state = green
    ? span(
        "vcard__state vcard__state--green",
        sameLane
          ? `Lampu ${where} hijau · searah dengan ${holder}`
          : stopped && release > 0
            ? `Lampu ${where} hijau · dilepas bila berhenti ${duration(release)}`
            : `Lampu ${where} hijau untuk kendaraan ini`,
      )
    : span(
        "vcard__state",
        holder
          ? `Menunggu · ${where} sedang hijau untuk ${holder} (datang lebih dulu)`
          : stopped
            ? "Menunggu kendaraan bergerak lagi"
            : lead > 0
              ? `Menunggu · hijau dibuka saat ETA ≤ ${lead} dtk`
              : "Menunggu masuk radius simpang",
      );
  li.append(eta, bar, state);
  return li;
}

/** Lights up the "Cara kerja" steps that are happening right now. */
function renderFlow() {
  const list = [...vehicles.values()];
  const active = {
    gps: list.length > 0,
    ai: list.some((v) => Number.isFinite(v.data.etaS)),
    green: [...junctions.values()].some((j) => j.cmd.mode === "PRIORITY"),
  };
  for (const [key, node] of Object.entries(el.steps))
    node.classList.toggle("flow__step--active", active[key]);
}

function log(text, kind = "info") {
  const li = document.createElement("li");
  li.className = `log--${kind}`;
  const time = document.createElement("time");
  time.textContent = new Date().toLocaleTimeString("id-ID", { hour12: false });
  li.append(time, text);
  el.log.prepend(li);
  while (el.log.children.length > 50) el.log.lastElementChild.remove();
}

function setStatus(online) {
  el.status.querySelector(".live__text").textContent = online
    ? "Live"
    : "Terputus · menyambung ulang…";
  el.status.className = `live ${online ? "live--on" : "live--off"}`;
}

// --- state updates -----------------------------------------------------------
function applyJunction(j) {
  const mode = j.cmd.mode;
  j.zone.setStyle(ZONE_STYLE[mode]);
  j.zone.getElement()?.classList.toggle("zone--priority", mode === "PRIORITY");
  // Mirror the ESP32: start or re-target the hold, or go back to the cycle at the held lane's yellow.
  const now = Date.now();
  if (mode === "PRIORITY" && (j.signal.mode !== "PRIORITY" || j.signal.phase !== j.cmd.phase))
    enterPriority(j.signal, j.cmd.phase, now);
  else if (mode === "NORMAL" && j.signal.mode === "PRIORITY") enterNormal(j.signal, now);
  j.colors = advance(j.signal, now);
  j.dot.setIcon(signalIcon(j.colors));
  renderJunctions();
  renderVehicles();
}

// Messages come from a public broker: check shape before use.
function onCmd(id, cmd) {
  const j = junctions.get(id);
  if (!j || (cmd?.mode !== "NORMAL" && cmd?.mode !== "PRIORITY")) return;
  const isPriority =
    cmd.mode === "PRIORITY" &&
    (cmd.phase === "A" || cmd.phase === "B") &&
    Object.hasOwn(LABEL, cmd.vehicleType) &&
    Number.isFinite(cmd.ttl) &&
    Date.now() - cmd.ts <= cmd.ttl * 1000; // stale retained PRIORITY counts as NORMAL
  const next = isPriority ? cmd : { mode: "NORMAL" };
  j.expiresAt = isPriority ? Date.now() + cmd.ttl * 1000 : 0;
  if (
    next.mode === j.cmd.mode &&
    next.phase === j.cmd.phase &&
    next.vehicleId === j.cmd.vehicleId
  )
    return;
  // `etaS` is set only when the ETA model triggered this command.
  const eta =
    isPriority && Number.isFinite(cmd.etaS)
      ? ` · dipicu AI: tiba ${cmd.etaS} dtk lagi`
      : "";
  log(
    isPriority
      ? `${id} hijau (${PHASE[next.phase]}) untuk ${LABEL[next.vehicleType]} ${next.vehicleId}${eta}`
      : `${id} kembali ke siklus normal`,
    isPriority ? "priority" : "info",
  );
  j.cmd = next;
  applyJunction(j);
}

function dropVehicle(id, reason) {
  const v = vehicles.get(id);
  if (!v) return;
  v.marker.remove();
  v.trail.remove();
  vehicles.delete(id);
  log(`${id} ${reason}`);
  renderVehicles();
}

function onVehicle(msg) {
  // `gone`: the mission ended or the demo vehicle was stopped, so drop it now instead of after staleS.
  if (msg?.gone === true && typeof msg.vehicleId === "string") {
    dropVehicle(msg.vehicleId, "selesai misi");
    return;
  }
  if (
    typeof msg?.vehicleId !== "string" ||
    !Object.hasOwn(LABEL, msg.type) ||
    !Number.isFinite(msg.lat) ||
    !Number.isFinite(msg.lng)
  )
    return;
  const latlng = [msg.lat, msg.lng];
  let v = vehicles.get(msg.vehicleId);
  if (!v) {
    v = {
      marker: L.marker(latlng, {
        icon: vehicleIcon(msg.type),
        zIndexOffset: 1000,
      }).addTo(map),
      trail: L.polyline([], {
        color: token(`--${msg.type}`),
        weight: 3,
        dashArray: "6 6",
        opacity: 0.9,
      }).addTo(map),
    };
    vehicles.set(msg.vehicleId, v);
    log(`${LABEL[msg.type]} ${msg.vehicleId} terdeteksi`);
  }
  v.data = msg;
  v.lastSeen = Date.now();
  v.marker.setLatLng(latlng);
  v.trail.addLatLng(latlng);
  renderVehicles();
}

// Panel Demo settings (retained topic). Public broker: check shape before use.
function onDemo(msg) {
  const c = msg?.citizen;
  if (Number.isFinite(c?.lat) && Number.isFinite(c?.lng)) {
    citizenMarker.setLatLng([c.lat, c.lng]).addTo(map);
  }
  if (Number.isFinite(msg?.radiusM) && msg.radiusM > 0 && msg.radiusM !== config.radiusM) {
    config.radiusM = msg.radiusM;
    for (const j of junctions.values()) j.zone.setRadius(msg.radiusM);
    setLegendRadius(msg.radiusM);
    log(`Radius prioritas diubah ke ${msg.radiusM} m`);
  }
}

// Lamp colours change on their own (cycle steps, the 3 s yield): repaint only when one actually changed.
setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const j of junctions.values()) {
    const next = advance(j.signal, now);
    if (next.A === j.colors.A && next.B === j.colors.B) continue;
    j.colors = next;
    j.dot.setIcon(signalIcon(next));
    changed = true;
  }
  if (changed) renderJunctions();
}, 250);

// Display failsafe mirrors the ESP32: PRIORITY without refresh expires; silent vehicles disappear.
setInterval(() => {
  const now = Date.now();
  for (const [id, j] of junctions) {
    if (j.cmd.mode === "PRIORITY" && now > j.expiresAt) {
      j.cmd = { mode: "NORMAL" };
      log(`${id} kembali normal (failsafe: perintah tidak diperbarui)`);
      applyJunction(j);
    }
  }
  for (const [id, v] of vehicles) {
    if (now - v.lastSeen > config.staleS * 1000)
      dropVehicle(id, "hilang dari radar");
  }
}, 1000);

// --- mqtt ------------------------------------------------------------------
const client = mqtt.connect(config.mqttWsUrl, {
  clientId: `siren-dash-${Math.random().toString(16).slice(2, 10)}`,
  reconnectPeriod: 2000,
});
client.on("connect", () => {
  setStatus(true);
  client.subscribe(`${config.topicPrefix}/#`);
});
client.on("offline", () => setStatus(false));
client.on("close", () => setStatus(false));
client.on("message", (topic, payload) => {
  let msg;
  try {
    msg = JSON.parse(payload.toString());
  } catch {
    return;
  }
  const [kind, id, leaf] = topic
    .slice(config.topicPrefix.length + 1)
    .split("/");
  if (kind === "vehicle") onVehicle(msg);
  else if (kind === "intersection" && leaf === "cmd") onCmd(id, msg);
  else if (kind === "demo") onDemo(msg);
});

// The drawer covers the left of the map, so shift the view right while it is open.
initDemoPanel({ onToggle: fitView });

renderJunctions();
renderVehicles();
