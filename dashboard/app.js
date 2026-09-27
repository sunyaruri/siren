import mqtt from "https://cdn.jsdelivr.net/npm/mqtt@5.16.0/dist/mqtt.esm.js";
import { initDemoPanel } from "./demo-panel.js";

const L = window.L;
const LABEL = { ambulance: "Ambulans", firetruck: "Pemadam" };
const ICON_PATH = {
  ambulance: "M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z",
  firetruck:
    "M12 2c.6 3.2-1.6 4.6-1.6 7 0 1.3 1 2.3 2.2 2.3 1.6 0 2.5-1.4 2.1-3.6 2.4 1.7 3.8 4.3 3.8 6.8a6.5 6.5 0 0 1-13 0c0-3.4 2.4-5.8 3.9-7.3.2 1.3.8 2.3 1.6 2.9-.4-2.7.1-5.6 1-8.1z",
};

const css = getComputedStyle(document.documentElement);
const token = (name) => css.getPropertyValue(name).trim();
const ZONE_STYLE = {
  NORMAL: { color: token("--normal"), weight: 1, fillOpacity: 0.05 },
  PRIORITY: { color: token("--priority"), weight: 2, fillOpacity: 0.15 },
};

const el = {
  status: document.getElementById("mqtt-status"),
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
const map = L.map("map", { zoomControl: false });
L.control.zoom({ position: "bottomleft" }).addTo(map);
// CARTO dark tiles now require an API key; standard OSM tiles are darkened with a CSS filter instead.
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  className: "map-tiles",
  attribution: "&copy; OpenStreetMap contributors",
}).addTo(map);

const dotIcon = (mode) =>
  L.divIcon({
    className: "",
    html: `<span class="signal-dot${mode === "PRIORITY" ? " signal-dot--priority" : ""}"></span>`,
    iconSize: [16, 16],
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
  L.polyline(route, { color: token("--muted"), weight: 3, opacity: 0.35 }).addTo(map);
  L.marker(route[0], { icon: routePin("start", "▶ Mulai") })
    .addTo(map)
    .bindTooltip("Titik awal rute · Jl. Gajah Mada");
  L.marker(route[route.length - 1], { icon: routePin("end", "H Tujuan") })
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
  const dot = L.marker([info.lat, info.lng], { icon: dotIcon("NORMAL") })
    .addTo(map)
    .bindTooltip(`${info.id} · ${info.name}`);
  junctions.set(info.id, {
    info,
    zone,
    dot,
    cmd: { mode: "NORMAL" },
    expiresAt: 0,
  });
}
// Bounds from coordinates, not circle.getBounds(): layers are not projected until the map has a view.
const bounds = L.latLngBounds([]);
for (const info of intersections)
  bounds.extend(L.latLng(info.lat, info.lng).toBounds(config.radiusM * 2));
for (const point of route) bounds.extend(point);
map.fitBounds(bounds, { padding: [20, 20] });

/** id -> { marker, trail, data, lastSeen } */
const vehicles = new Map();

// Where Citizen HUDs in "Posisi simulasi" mode are, as set from the Panel Demo.
const citizenMarker = L.circleMarker([0, 0], {
  radius: 7,
  color: token("--text"),
  fillColor: token("--text"),
  fillOpacity: 1,
}).bindTooltip("Warga (posisi simulasi)");

// --- panel -----------------------------------------------------------------
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
    ...[...junctions.values()].map(({ info, cmd }) =>
      cmd.mode === "PRIORITY"
        ? card(
            info.id,
            `PRIORITAS · ${cmd.phase}`,
            "pill--priority",
            `${info.name} · ${LABEL[cmd.vehicleType]} ${cmd.vehicleId}`,
          )
        : card(info.id, "NORMAL", "", info.name),
    ),
  );
}

function renderVehicles() {
  const items = [...vehicles.entries()].map(([id, v]) => {
    const held = [...junctions.values()]
      .filter((j) => j.cmd.vehicleId === id)
      .map((j) => j.info.id);
    const speed =
      v.data.speed === 0 ? "berhenti" : `${Math.round(v.data.speed ?? 0)} km/j`;
    return card(
      id,
      LABEL[v.data.type],
      `pill--${v.data.type}`,
      held.length ? `${speed} · prioritas di ${held.join(", ")}` : speed,
    );
  });
  el.vehicles.replaceChildren(
    ...(items.length ? items : [empty("Belum ada kendaraan aktif")]),
  );
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
  el.status.textContent = online ? "MQTT online" : "MQTT terputus";
  el.status.className = `pill ${online ? "pill--online" : "pill--offline"}`;
}

// --- state updates -----------------------------------------------------------
function applyJunction(j) {
  const mode = j.cmd.mode;
  j.zone.setStyle(ZONE_STYLE[mode]);
  j.zone.getElement()?.classList.toggle("zone--priority", mode === "PRIORITY");
  j.dot.setIcon(dotIcon(mode));
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
  log(
    isPriority
      ? `${id} → PRIORITAS · ${LABEL[next.vehicleType]} ${next.vehicleId} · fase ${next.phase}`
      : `${id} → NORMAL`,
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
    log(`Radius prioritas → ${msg.radiusM} m`);
  }
}

// Display failsafe mirrors the ESP32: PRIORITY without refresh expires; silent vehicles disappear.
setInterval(() => {
  const now = Date.now();
  for (const [id, j] of junctions) {
    if (j.cmd.mode === "PRIORITY" && now > j.expiresAt) {
      j.cmd = { mode: "NORMAL" };
      log(`${id} → NORMAL (failsafe, tanpa refresh)`);
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
initDemoPanel({
  onToggle: (open) =>
    map.fitBounds(bounds, {
      paddingTopLeft: [open ? 392 : 20, 20],
      paddingBottomRight: [20, 20],
    }),
});

renderJunctions();
renderVehicles();
