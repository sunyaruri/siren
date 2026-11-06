import { bearingDeg, connectMqtt, formatEta, haversineM, setText } from "./mqtt-client.js?v=20261106o";
// Same traffic-light state machine the dashboard uses (a copy of the ESP32 firmware logic).
import { FIRST_STEP, advance, createSignal, enterNormal, enterPriority } from "/dashboard/signals.js?v=20261106o";

const L = window.L;
const DEFAULT_SIM_SPEED_KMH = 60;
// ETA threshold for green, from /api/config (`etaLeadS`); the backend default until the config arrives.
let etaLeadS = 40;
// How long a stopped vehicle keeps its green (`stopReleaseS`, 0 = no limit).
let stopReleaseS = 0;
const STOP_KMH = 3; // below this the engine counts the vehicle as stopped (priority.ts)
const SIM_SLOW_KMH = 20;
/** Route simulator speed chosen in the HUD: "normal" (Panel Demo speed), "slow" or "stop". */
let simMode = "normal";
const VEHICLE_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const COLOR_WORD = { red: "merah", yellow: "kuning", green: "hijau" };

/** Phase A when coming along the main road (within 45° of axisA, either direction), else B. Mirrors priority.ts. */
function phaseFor(axisA, bearingFromIntersection) {
  const diff = Math.abs(bearingFromIntersection - axisA) % 180;
  return Math.min(diff, 180 - diff) < 45 ? "A" : "B";
}

const el = {
  status: document.getElementById("driver-status"),
  setup: document.getElementById("driver-setup"),
  run: document.getElementById("driver-run"),
  missionCode: document.getElementById("mission-code"),
  error: document.getElementById("driver-error"),
  vehicleId: document.getElementById("vehicle-id"),
  vehicleIdError: document.getElementById("vehicle-id-error"),
  vehicleType: document.getElementById("vehicle-type"),
  gpsToggle: document.getElementById("gps-toggle"),
  btnStart: document.getElementById("btn-start"),
  btnStop: document.getElementById("btn-stop"),
  simSpeed: document.getElementById("sim-speed"),
  confirmStop: document.getElementById("confirm-stop"),
  hud: document.getElementById("hud-card"),
  hudState: document.getElementById("hud-state"),
  hudEtaLabel: document.getElementById("hud-eta-label"),
  hudEta: document.getElementById("hud-eta"),
  hudName: document.getElementById("hud-name"),
  hudDistance: document.getElementById("hud-distance"),
  hudHint: document.getElementById("hud-hint"),
  hudLamp: document.getElementById("hud-lamp"),
  hudLampDot: document.getElementById("hud-lamp-dot"),
  hudLampText: document.getElementById("hud-lamp-text"),
};

/** Shows `message` under `input` (or clears it) and marks the field invalid for screen readers. */
function fieldError(input, errorEl, message) {
  errorEl.textContent = message;
  if (message) input.setAttribute("aria-invalid", "true");
  else input.removeAttribute("aria-invalid");
}

function setStarting(starting) {
  el.btnStart.disabled = starting;
  el.btnStart.classList.toggle("is-loading", starting);
  el.btnStart.setAttribute("aria-busy", String(starting));
  el.btnStart.textContent = starting ? "Memeriksa kode…" : "Mulai Misi";
}

/** Walks route.json at a fixed speed, interpolating between points so movement stays smooth at 1 Hz. */
function makeRouteSimulator(route, speedKmh) {
  let segment = 0;
  let intoSegmentM = 0;
  const speedMs = (speedKmh * 1000) / 3600;

  return {
    next(dtS) {
      if (segment >= route.length - 1) return route[route.length - 1];
      let remaining = speedMs * dtS + intoSegmentM;
      while (segment < route.length - 1) {
        const [lat1, lng1] = route[segment];
        const [lat2, lng2] = route[segment + 1];
        const segLen = haversineM(lat1, lng1, lat2, lng2);
        if (remaining < segLen) {
          const t = segLen === 0 ? 0 : remaining / segLen;
          intoSegmentM = remaining;
          return [lat1 + (lat2 - lat1) * t, lng1 + (lng2 - lng1) * t];
        }
        remaining -= segLen;
        segment += 1;
      }
      intoSegmentM = 0;
      return route[route.length - 1];
    },
    done() {
      return segment >= route.length - 1;
    },
  };
}

function makeGpsSource() {
  let last = null;
  const watchId = navigator.geolocation.watchPosition(
    (pos) => {
      last = {
        pos: [pos.coords.latitude, pos.coords.longitude],
        speedKmh: Number.isFinite(pos.coords.speed) ? pos.coords.speed * 3.6 : null,
        headingDeg: Number.isFinite(pos.coords.heading) ? pos.coords.heading : null,
      };
    },
    (err) => console.error("[gps]", err.message),
    { enableHighAccuracy: true, maximumAge: 2000 },
  );
  return {
    next() {
      return last;
    },
    stop() {
      navigator.geolocation.clearWatch(watchId);
    },
  };
}

/** Returns null when the backend accepts the mission code, otherwise a message for the setup form. */
async function checkMission(backendUrl, headers) {
  try {
    const res = await fetch(`${backendUrl}/api/mission`, { headers });
    if (res.ok) return null;
    return res.status === 401 ? "Kode misi tidak valid atau sudah tidak berlaku." : `Backend menolak (HTTP ${res.status}).`;
  } catch {
    return "Server tidak bisa dihubungi. Periksa koneksi internet, lalu coba lagi.";
  }
}

export function initDriver({ getJson }) {
  let map;
  let marker;
  let trail;
  let tickHandle;
  let gpsSource;
  let missionStarted = false;
  let stopped = false;
  let endMission = null;

  el.setup.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (missionStarted) return; // guards against a double-tap firing two submits before the form hides
    const vehicleId = el.vehicleId.value.trim();
    const code = el.missionCode.value.trim();
    fieldError(el.missionCode, el.error, code ? "" : "Masukkan Kode Misi dari Command Center 112.");
    fieldError(
      el.vehicleId,
      el.vehicleIdError,
      VEHICLE_ID_RE.test(vehicleId) ? "" : "Isi ID Kendaraan: huruf, angka, - atau _ (maks. 32).",
    );
    if (!code) return el.missionCode.focus();
    if (!VEHICLE_ID_RE.test(vehicleId)) return el.vehicleId.focus();
    missionStarted = true;
    setStarting(true);
    const type = el.vehicleType.value;
    const backendUrl = window.location.origin; // the PWA is always served by the backend it talks to
    const useRealGps = el.gpsToggle.checked;
    const auth = { authorization: `Bearer ${code.toUpperCase()}` };
    // Releases held lights and clears this vehicle from the dashboard/Citizen HUDs now, not after the stale timeout.
    endMission = () =>
      fetch(`${backendUrl}/api/mission/end`, {
        method: "POST",
        headers: { "content-type": "application/json", ...auth },
        body: JSON.stringify({ vehicleId }),
      }).catch(() => {});

    const problem = await checkMission(backendUrl, auth);
    if (problem) {
      fieldError(el.missionCode, el.error, problem);
      el.missionCode.focus();
      missionStarted = false;
      setStarting(false);
      return;
    }

    el.setup.hidden = true;
    el.run.hidden = false;
    el.status.textContent = "Aktif";
    el.status.className = "pill pill--online";

    const route = useRealGps ? null : await getJson("data/route.json");
    // The Panel Demo on the dashboard can speed the simulator up so a demo run does not take 4 minutes.
    const config = await getJson(`${backendUrl}/api/config`).catch(() => ({}));
    const simSpeedKmh = config.simSpeedKmh ?? DEFAULT_SIM_SPEED_KMH;
    if (Number.isFinite(config.etaLeadS)) etaLeadS = config.etaLeadS;
    if (Number.isFinite(config.stopReleaseS)) stopReleaseS = config.stopReleaseS;
    el.simSpeed.hidden = useRealGps;
    const source = useRealGps ? makeGpsSource() : makeRouteSimulator(route, simSpeedKmh);
    if (useRealGps) gpsSource = source;
    startSignals(config, await getJson(`${backendUrl}/api/intersections`).catch(() => []));

    const mapEl = document.getElementById("driver-map");
    if (mapEl._leaflet_id) mapEl._leaflet_id = null; // defensive: survives initDriver() being invoked twice (e.g. bfcache restore)
    map = L.map("driver-map", { zoomControl: false });
    // Top right, under the topbar: the bottom corners sit behind the floating HUD sheet.
    map.attributionControl.setPosition("topright");
    L.control.zoom({ position: "topright" }).addTo(map);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      className: "map-tiles",
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);
    trail = L.polyline([], { color: "#248a3d", weight: 4 }).addTo(map); // --priority
    marker = L.circleMarker([0, 0], { radius: 8, color: "#ffffff", weight: 3, fillColor: "#0066cc", fillOpacity: 1 });

    let started = false;
    let heading = 0;
    let lastPos = null;

    tickHandle = setInterval(async () => {
      // The simulator walks at simSpeedKmh, so a shorter time step moves it slower (0 = stays put).
      const simKmh = simMode === "stop" ? 0 : simMode === "slow" ? Math.min(SIM_SLOW_KMH, simSpeedKmh) : simSpeedKmh;
      const reading = useRealGps
        ? source.next()
        : { pos: source.next(simKmh / simSpeedKmh), speedKmh: simKmh, headingDeg: null };
      if (!reading?.pos) return;
      const [lat, lng] = reading.pos;

      if (reading.headingDeg !== null) {
        heading = reading.headingDeg;
      } else if (lastPos) {
        const dLat = lat - lastPos[0];
        const dLng = lng - lastPos[1];
        if (dLat !== 0 || dLng !== 0) heading = (Math.atan2(dLng, dLat) * 180) / Math.PI;
      }
      lastPos = [lat, lng];

      if (!started) {
        marker.setLatLng([lat, lng]).addTo(map);
        map.setView([lat, lng], 16);
        started = true;
      } else {
        marker.setLatLng([lat, lng]);
        map.panTo([lat, lng], { animate: !reducedMotion.matches });
      }
      trail.addLatLng([lat, lng]);

      try {
        const res = await fetch(`${backendUrl}/api/gps`, {
          method: "POST",
          headers: { "content-type": "application/json", ...auth },
          body: JSON.stringify({
            vehicleId,
            type,
            lat,
            lng,
            speed: reading.speedKmh ?? undefined,
            heading: Math.round(((heading % 360) + 360) % 360),
          }),
        });
        if (res.ok) {
          const body = await res.json();
          applyHud(body.nextIntersection, myLamp(body.nextIntersection, lat, lng), reading.speedKmh);
        } else if (res.status === 401) {
          stop("Kode ditolak", "Kode misi ditolak"); // code revoked mid-mission: stop sending, lights fall back via ttl
        }
      } catch (err) {
        console.error("[gps post]", err.message);
      }

      if (!useRealGps && source.done()) stop();
    }, 1000);
  });

  function showHud(state, { status, etaLabel = "", eta = "", name = "", distance = "", hint }) {
    el.hud.dataset.state = state;
    setText(el.hudState, status); // live region: only re-announced when the text actually changes
    el.hudEtaLabel.textContent = etaLabel;
    el.hudEta.textContent = eta;
    el.hudName.textContent = name;
    el.hudDistance.textContent = distance;
    el.hudHint.textContent = hint;
  }

  /** id -> { info, signal, expiresAt }: lamp colours mirrored from the intersection commands on MQTT. */
  const junctions = new Map();
  let mqttClient = null;

  function startSignals(config, intersections) {
    if (!config.mqttWsUrl || !config.topicPrefix || !Array.isArray(intersections)) return;
    const now = Date.now();
    for (const info of intersections) {
      if (typeof info?.id !== "string" || !Number.isFinite(info.axisA)) continue;
      junctions.set(info.id, { info, signal: createSignal(FIRST_STEP[info.id] ?? 0, now), expiresAt: 0 });
    }
    // Public broker: every message is shape-checked before it touches the state machine.
    mqttClient = connectMqtt(config.mqttWsUrl, `${config.topicPrefix}/intersection/+/cmd`, {
      onStatus: () => {},
      onMessage: (topic, cmd) => {
        const j = junctions.get(topic.split("/").at(-2));
        if (!j) return;
        const t = Date.now();
        const priority =
          cmd?.mode === "PRIORITY" &&
          (cmd.phase === "A" || cmd.phase === "B") &&
          Number.isFinite(cmd.ttl) &&
          Number.isFinite(cmd.ts) &&
          t - cmd.ts <= cmd.ttl * 1000; // a stale retained PRIORITY counts as NORMAL
        if (priority) {
          j.expiresAt = t + cmd.ttl * 1000;
          if (j.signal.mode !== "PRIORITY" || j.signal.phase !== cmd.phase) enterPriority(j.signal, cmd.phase, t);
        } else if (j.signal.mode === "PRIORITY") {
          enterNormal(j.signal, t);
        }
      },
    });
  }

  /** The colour of this vehicle's own lane at the next intersection, or null when unknown. */
  function myLamp(next, lat, lng) {
    const j = next && junctions.get(next.id);
    if (!j || !mqttClient?.connected) return null;
    const now = Date.now();
    if (j.signal.mode === "PRIORITY" && now > j.expiresAt) enterNormal(j.signal, now); // ttl failsafe, like the ESP32
    const lane = phaseFor(j.info.axisA, bearingDeg(j.info.lat, j.info.lng, lat, lng));
    return advance(j.signal, now)[lane];
  }

  function showLamp(id, color) {
    el.hudLamp.hidden = !color;
    if (!color) return;
    el.hudLampDot.className = `lamp lamp--${color}`;
    el.hudLampText.textContent = `Lampu jalur Anda di ${id}: ${COLOR_WORD[color]}`;
  }

  // Plain-language HUD: the engine's NORMAL/PRIORITY becomes "waiting" vs "green for you".
  function applyHud(next, lamp = null, speedKmh = null) {
    if (stopped) return; // a request still in flight when the mission ended
    showLamp(next?.id, next ? lamp : null);
    if (!next) {
      showHud("idle", {
        status: "Tidak ada simpang di depan",
        hint: "Lampu simpang berjalan normal. Perkiraan tiba muncul saat Anda mendekati simpang.",
      });
      return;
    }
    // Held for this vehicle but the cross street is still on its 3 s yellow: not green yet.
    const opening = next.mode === "PRIORITY" && lamp !== null && lamp !== "green";
    const green = next.mode === "PRIORITY" && !opening;
    const hasEta = Number.isFinite(next.etaS);
    // A stopped vehicle has no real arrival time: the model would only divide the distance by its minimum speed.
    const halted = Number.isFinite(speedKmh) && speedKmh < STOP_KMH;
    const holdFor = stopReleaseS % 60 === 0 ? `${stopReleaseS / 60} menit` : `${stopReleaseS} dtk`;
    showHud(green ? "green" : "wait", {
      // "Waiting for priority", not "waiting for green": the lamp row may show a normal-cycle green at the same time.
      status: green ? "Lampu hijau untuk Anda" : opening ? "Membuka lampu hijau…" : "Menunggu prioritas lampu",
      // Small label + big value: the value alone stays on one line even on a 320px phone.
      etaLabel: !hasEta ? "Simpang berikutnya" : halted ? `Perkiraan AI · ke ${next.id}` : `Perkiraan AI · tiba di ${next.id} dalam`,
      eta: !hasEta ? next.id : halted ? "Berhenti" : formatEta(next.etaS),
      name: next.name,
      distance: `${Math.round(next.distanceM)} m lagi`,
      hint: green
        ? halted && stopReleaseS > 0
          ? `${next.id} tetap hijau maks. ${holdFor} selama Anda berhenti.`
          : `${next.id} tetap hijau sampai Anda melewatinya.`
        : opening
          ? "Jalur silang kuning 3 detik, lalu jalur Anda hijau."
        : halted
          ? "Perkiraan tiba dihitung lagi saat Anda bergerak."
        : etaLeadS > 0
          ? `Dibuka otomatis saat perkiraan tiba ≤ ${etaLeadS} dtk.`
          : "Dibuka otomatis saat Anda masuk radius simpang.",
    });
  }

  function stop(reason = "Selesai", status = "Misi selesai") {
    if (!stopped) {
      clearInterval(tickHandle);
      gpsSource?.stop();
      mqttClient?.end();
      showLamp(null, null);
      endMission?.();
      endMission = null;
      stopped = true;
      el.status.textContent = reason;
      el.status.className = "pill pill--offline";
      showHud("ended", { status, hint: "Lampu simpang kembali ke siklus normal." });
      el.btnStop.textContent = "Kembali ke menu";
      el.btnStop.className = "btn btn--secondary";
      return;
    }
    window.location.reload(); // second tap: back to the landing, same as the topbar back button
  }

  // Ending a mission releases the lights, so it asks first; once ended the same button just goes back to the menu.
  el.simSpeed.addEventListener("click", (e) => {
    const mode = e.target.closest("button[data-mode]")?.dataset.mode;
    if (!mode) return;
    simMode = mode;
    for (const b of el.simSpeed.querySelectorAll("button[data-mode]"))
      b.setAttribute("aria-pressed", String(b.dataset.mode === mode));
  });
  el.btnStop.addEventListener("click", () => {
    if (stopped || !el.confirmStop?.showModal) return stop();
    el.confirmStop.returnValue = "";
    el.confirmStop.showModal();
  });
  el.confirmStop?.addEventListener("close", () => {
    if (el.confirmStop.returnValue === "confirm") stop();
  });
}
