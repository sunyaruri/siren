import { connectMqtt, haversineM } from "./mqtt-client.js";

const L = window.L;
const LABEL = { ambulance: "Ambulans", firetruck: "Pemadam" };
const WARN_RADIUS_M = 1000;

const el = {
  status: document.getElementById("citizen-status"),
  alerts: document.getElementById("citizen-alerts"),
};

export function initCitizen(config) {
  const map = L.map("citizen-map", { zoomControl: false });
  L.control.zoom({ position: "bottomleft" }).addTo(map);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    className: "map-tiles",
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);
  map.setView([-8.166, 113.706], 14); // demo route fallback center, replaced once self-position arrives

  let selfPos = null;
  let selfMarker = null;
  /** vehicleId -> { marker, data, lastSeen } */
  const vehicles = new Map();

  navigator.geolocation.watchPosition(
    (pos) => {
      selfPos = [pos.coords.latitude, pos.coords.longitude];
      if (!selfMarker) {
        selfMarker = L.circleMarker(selfPos, { radius: 8, color: "#f3f4f6", fillOpacity: 1 }).addTo(map);
        map.setView(selfPos, 15);
      } else {
        selfMarker.setLatLng(selfPos);
      }
      renderAlerts();
    },
    (err) => console.error("[gps]", err.message),
    { enableHighAccuracy: true, maximumAge: 2000 },
  );

  function renderAlerts() {
    const items = [];
    for (const [id, v] of vehicles) {
      if (!selfPos) continue;
      const distanceM = haversineM(selfPos[0], selfPos[1], v.data.lat, v.data.lng);
      if (distanceM <= WARN_RADIUS_M) items.push({ id, type: v.data.type, distanceM });
    }
    items.sort((a, b) => a.distanceM - b.distanceM);

    el.alerts.replaceChildren(
      ...(items.length
        ? items.map(({ id, type, distanceM }) => {
            const card = document.createElement("div");
            card.className = `alert-card${type === "firetruck" ? " alert-card--firetruck" : ""}`;
            const title = document.createElement("p");
            title.className = "alert-card__title";
            title.textContent = `${LABEL[type] ?? type} ${id} mendekat`;
            const dist = document.createElement("p");
            dist.className = "alert-card__distance";
            dist.textContent = `${Math.round(distanceM)} m`;
            card.append(title, dist);
            return card;
          })
        : [emptyCard()]),
    );
  }

  function emptyCard() {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "Belum ada kendaraan darurat terdeteksi di sekitar.";
    return p;
  }

  // Messages come from a public broker: check shape before use.
  function onVehicle(msg) {
    if (
      typeof msg?.vehicleId !== "string" ||
      !Object.hasOwn(LABEL, msg.type) ||
      !Number.isFinite(msg.lat) ||
      !Number.isFinite(msg.lng)
    )
      return;
    let v = vehicles.get(msg.vehicleId);
    if (!v) {
      v = { marker: L.marker([msg.lat, msg.lng]).addTo(map).bindTooltip(`${LABEL[msg.type]} ${msg.vehicleId}`) };
      vehicles.set(msg.vehicleId, v);
    }
    v.data = msg;
    v.lastSeen = Date.now();
    v.marker.setLatLng([msg.lat, msg.lng]);
    renderAlerts();
  }

  connectMqtt(config.mqttWsUrl, `${config.topicPrefix}/vehicle/+`, {
    onStatus: (online) => {
      el.status.textContent = online ? "MQTT online" : "MQTT terputus";
      el.status.className = `pill ${online ? "pill--online" : "pill--offline"}`;
    },
    onMessage: (_topic, msg) => onVehicle(msg),
  });

  setInterval(() => {
    const now = Date.now();
    let changed = false;
    for (const [id, v] of vehicles) {
      if (now - v.lastSeen > config.staleS * 1000) {
        v.marker.remove();
        vehicles.delete(id);
        changed = true;
      }
    }
    if (changed) renderAlerts();
  }, 1000);
}
