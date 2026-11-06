import { bearingDeg, connectMqtt, formatEta, haversineM, setText } from "./mqtt-client.js?v=20261106o";

const LABEL = { ambulance: "Ambulans", firetruck: "Pemadam" };
const COMPASS = ["utara", "timur laut", "timur", "tenggara", "selatan", "barat daya", "barat", "barat laut"];
// Arrow (SVG, rotated in CSS by data-icon) points at where the vehicle is, relative to the citizen's travel direction.
const SIDE = {
  back: { arrow: "back", text: "DARI BELAKANG" },
  front: { arrow: "front", text: "DARI DEPAN" },
  right: { arrow: "right", text: "DARI KANAN" },
  left: { arrow: "left", text: "DARI KIRI" },
};
const MOVING_AWAY_TOLERANCE_M = 2; // GPS noise margin before "moving away" hides the alert
const BUZZ_PATTERN = [400, 150, 400];
const BUZZ_EVERY_MS = 3000;
const STOP_KMH = 3; // below this a vehicle counts as stopped, same as the backend engine (priority.ts)
// Fallback until the retained `demo` topic arrives: on the demo route between S1 and S2, heading toward the hospital.
const DEFAULT_SIM_POSITION = { lat: -8.15914, lng: 113.7098, heading: 35 };

const el = {
  status: document.getElementById("citizen-status"),
  alert: document.getElementById("citizen-alert"),
  arrow: document.getElementById("citizen-arrow"),
  title: document.getElementById("citizen-title"),
  direction: document.getElementById("citizen-direction"),
  distance: document.getElementById("citizen-distance"),
  detail: document.getElementById("citizen-detail"),
  eta: document.getElementById("citizen-eta"),
  help: document.getElementById("citizen-help"),
  hint: document.getElementById("citizen-hint"),
  sim: document.getElementById("citizen-sim"),
  source: document.getElementById("citizen-source"),
};

const formatDistance = (m) => (m >= 1000 ? `${+(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
const INTERSECTION_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;

export function initCitizen(config) {
  /** Citizen position { lat, lng, heading | null }, or null while waiting for GPS. */
  let me = null;
  let gpsPos = null;
  let demoReceived = false;
  /** Why GPS failed, shown in the waiting state; null while GPS works or has not answered yet. */
  let gpsError = null;
  let lastBuzz = 0;
  /** vehicleId -> { msg, distanceM, prevDistanceM, lastSeen } */
  const vehicles = new Map();

  // Vibration and the alert only work while the screen is on, so keep it on while this view is open.
  // The browser drops the lock whenever the page is hidden, so take it again on return.
  const keepAwake = () => navigator.wakeLock?.request("screen").catch(() => {});
  keepAwake();
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && keepAwake());

  function setMe(pos, { newOrigin = false } = {}) {
    me = pos;
    for (const v of vehicles.values()) {
      if (newOrigin) v.distanceM = undefined; // old distances are not comparable
      updateDistance(v);
    }
    render();
  }

  function updateDistance(v) {
    v.prevDistanceM = v.distanceM;
    v.distanceM = me ? haversineM(me.lat, me.lng, v.msg.lat, v.msg.lng) : undefined;
  }

  const movingAway = (v) => v.prevDistanceM !== undefined && v.distanceM > v.prevDistanceM + MOVING_AWAY_TOLERANCE_M;

  function side(v) {
    const bearing = bearingDeg(me.lat, me.lng, v.msg.lat, v.msg.lng);
    if (me.heading === null)
      return {
        arrow: "",
        text: `DARI ARAH ${COMPASS[Math.round(bearing / 45) % 8].toUpperCase()}`,
      };
    const relative = (bearing - me.heading + 360) % 360;
    if (relative >= 135 && relative <= 225) return SIDE.back;
    if (relative <= 45 || relative >= 315) return SIDE.front;
    return relative < 180 ? SIDE.right : SIDE.left;
  }

  function show(state, { arrow = "", title, direction = "", distance = "", detail = "", eta = "", help = "", hint = "" }) {
    el.alert.className = `citizen citizen--${state}`;
    el.arrow.dataset.icon = arrow;
    setText(el.title, title); // title + direction sit in an assertive live region: write only on change
    setText(el.direction, direction);
    el.distance.textContent = distance;
    el.detail.textContent = detail;
    el.eta.textContent = eta;
    el.help.textContent = help;
    el.hint.textContent = hint;
  }

  // Shown while nothing is closing in, so a first-time viewer knows what this screen is for and how to try it.
  const helpText = () =>
    `Layar ini berubah merah-biru dan HP bergetar saat ambulans atau pemadam mendekat dalam ${formatDistance(config.radiusM)}, lengkap dengan arah dan jaraknya.`;
  const hintText = () =>
    el.sim.checked
      ? "Posisi simulasi aktif. Jalankan kendaraan dari Panel Demo di dashboard untuk melihat peringatan."
      : "Uji coba jauh dari Jember: aktifkan Posisi simulasi di bawah, lalu jalankan kendaraan dari Panel Demo.";

  // Optional `nextId`/`etaS` on the vehicle message: when it reaches its next intersection (not this citizen).
  function etaText(msg) {
    if (!Number.isFinite(msg.etaS) || msg.etaS < 0 || !INTERSECTION_ID_RE.test(msg.nextId ?? "")) return "";
    return `Menuju simpang ${msg.nextId}, tiba ±${formatEta(msg.etaS)}`;
  }

  // Which position the distances use: the alert only makes sense if this matches the dot on the dashboard.
  function renderSource() {
    if (el.sim.checked)
      el.source.textContent = demoReceived
        ? "Posisi: simulasi dari Panel Demo (titik hitam di dashboard)"
        : "Posisi: simulasi bawaan, Panel Demo belum terhubung";
    else el.source.textContent = gpsPos ? `Posisi: GPS asli (±${gpsPos.accuracyM} m)` : "Posisi: menunggu GPS…";
  }

  function render() {
    renderSource();
    const threat = [...vehicles.values()]
      .filter((v) => v.distanceM !== undefined && v.distanceM <= config.radiusM && !movingAway(v))
      .sort((a, b) => a.distanceM - b.distanceM)[0];

    if (!threat) {
      if (lastBuzz) navigator.vibrate?.(0);
      lastBuzz = 0;
      if (!me)
        show("wait", {
          title: gpsError ? "GPS tidak tersedia" : "Menunggu posisi Anda…",
          detail: gpsError ?? "Izinkan akses lokasi.",
          help: helpText(),
          hint: hintText(),
        });
      else
        show("safe", {
          arrow: "safe",
          title: "Aman",
          detail: "Tidak ada kendaraan darurat yang mendekat.",
          help: helpText(),
          hint: hintText(),
        });
      return;
    }

    const { arrow, text } = side(threat);
    // Stopped inside the radius (stuck in traffic, at a scene): still nearby, but not coming yet and its ETA is not
    // meaningful, so no arrival time and no vibration until it moves again.
    const halted = Number.isFinite(threat.msg.speed) && threat.msg.speed < STOP_KMH;
    show("danger", {
      arrow,
      title: `${LABEL[threat.msg.type].toUpperCase()} ${halted ? "BERHENTI" : "MENDEKAT"}`,
      direction: text,
      distance: formatDistance(threat.distanceM),
      detail: halted ? "Siap beri jalan saat bergerak lagi" : "Menepi & beri jalan",
      eta: halted ? "" : etaText(threat.msg),
    });
    // Repeats while the vehicle keeps closing in; Android only (iOS Safari has no Vibration API).
    const now = Date.now();
    if (!halted && now - lastBuzz >= BUZZ_EVERY_MS) {
      navigator.vibrate?.(BUZZ_PATTERN);
      lastBuzz = now;
    }
  }

  navigator.geolocation.watchPosition(
    ({ coords }) => {
      // Heading is only meaningful while moving; a parked phone reports NaN or a stale value.
      const heading = Number.isFinite(coords.heading) && coords.speed > 1 ? coords.heading : null;
      gpsPos = { lat: coords.latitude, lng: coords.longitude, heading, accuracyM: Math.round(coords.accuracy) };
      gpsError = null;
      if (!el.sim.checked) setMe(gpsPos);
    },
    (err) => {
      gpsError = err.code === err.PERMISSION_DENIED ? "Izin lokasi ditolak." : err.message;
      render();
    },
    { enableHighAccuracy: true, maximumAge: 1000 },
  );

  let simPos = DEFAULT_SIM_POSITION;
  el.sim.addEventListener("change", () => setMe(el.sim.checked ? simPos : gpsPos, { newOrigin: true }));

  // Panel Demo settings (retained). Public broker: check shape before use.
  function onDemo(msg) {
    const c = msg?.citizen;
    if (Number.isFinite(c?.lat) && Number.isFinite(c?.lng) && Number.isFinite(c?.heading)) {
      simPos = { lat: c.lat, lng: c.lng, heading: c.heading };
      demoReceived = true;
    }
    if (Number.isFinite(msg?.radiusM) && msg.radiusM > 0) config.radiusM = msg.radiusM;
    if (el.sim.checked) setMe(simPos, { newOrigin: true });
    else render();
  }

  // Messages come from a public broker: check shape before use.
  function onVehicle(msg) {
    // `gone`: mission ended or demo vehicle stopped; clear its alert now instead of after staleS.
    if (msg?.gone === true && typeof msg.vehicleId === "string") {
      if (vehicles.delete(msg.vehicleId)) render();
      return;
    }
    if (
      typeof msg?.vehicleId !== "string" ||
      !Object.hasOwn(LABEL, msg.type) ||
      !Number.isFinite(msg.lat) ||
      !Number.isFinite(msg.lng)
    )
      return;
    let v = vehicles.get(msg.vehicleId);
    if (!v) {
      v = {};
      vehicles.set(msg.vehicleId, v);
    }
    v.msg = msg;
    v.lastSeen = Date.now();
    updateDistance(v);
    render();
  }

  connectMqtt(config.mqttWsUrl, [`${config.topicPrefix}/vehicle/+`, `${config.topicPrefix}/demo`], {
    onStatus: (online) => {
      el.status.textContent = online ? "Terhubung" : "Terputus";
      el.status.className = `pill ${online ? "pill--online" : "pill--offline"}`;
    },
    onMessage: (topic, msg) => (topic.endsWith("/demo") ? onDemo(msg) : onVehicle(msg)),
  });

  setInterval(() => {
    const cutoff = Date.now() - config.staleS * 1000;
    let changed = false;
    for (const [id, v] of vehicles) {
      if (v.lastSeen < cutoff) {
        vehicles.delete(id);
        changed = true;
      }
    }
    if (changed) render();
  }, 1000);

  render();
}
