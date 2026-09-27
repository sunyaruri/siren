import { haversineM } from "./mqtt-client.js";

const L = window.L;
const SIM_SPEED_KMH = 60;

const el = {
  status: document.getElementById("driver-status"),
  setup: document.getElementById("driver-setup"),
  run: document.getElementById("driver-run"),
  missionCode: document.getElementById("mission-code"),
  error: document.getElementById("driver-error"),
  vehicleId: document.getElementById("vehicle-id"),
  vehicleType: document.getElementById("vehicle-type"),
  gpsToggle: document.getElementById("gps-toggle"),
  backendUrl: document.getElementById("backend-url"),
  btnStart: document.getElementById("btn-start"),
  btnStop: document.getElementById("btn-stop"),
  hudMode: document.getElementById("hud-mode"),
  hudName: document.getElementById("hud-name"),
  hudDistance: document.getElementById("hud-distance"),
};

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
    return "Backend tidak bisa dihubungi. Cek URL Backend di Pengaturan lanjutan.";
  }
}

export function initDriver({ getJson }) {
  let map;
  let marker;
  let trail;
  let tickHandle;
  let gpsSource;
  let missionStarted = false;

  el.setup.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (missionStarted) return; // guards against a double-tap firing two submits before the form hides
    const vehicleId = el.vehicleId.value.trim();
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(vehicleId)) {
      el.vehicleId.focus();
      return;
    }
    missionStarted = true;
    el.btnStart.disabled = true;
    el.error.textContent = "";
    const type = el.vehicleType.value;
    const backendUrl = el.backendUrl.value.trim() || window.location.origin;
    const useRealGps = el.gpsToggle.checked;
    const auth = { authorization: `Bearer ${el.missionCode.value.trim().toUpperCase()}` };

    const problem = await checkMission(backendUrl, auth);
    if (problem) {
      el.error.textContent = problem;
      missionStarted = false;
      el.btnStart.disabled = false;
      return;
    }

    el.setup.hidden = true;
    el.run.hidden = false;
    el.status.textContent = "Aktif";
    el.status.className = "pill pill--online";

    const route = useRealGps ? null : await getJson("data/route.json");
    const source = useRealGps ? makeGpsSource() : makeRouteSimulator(route, SIM_SPEED_KMH);
    if (useRealGps) gpsSource = source;

    const mapEl = document.getElementById("driver-map");
    if (mapEl._leaflet_id) mapEl._leaflet_id = null; // defensive: survives initDriver() being invoked twice (e.g. bfcache restore)
    map = L.map("driver-map", { zoomControl: false });
    L.control.zoom({ position: "bottomleft" }).addTo(map);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      className: "map-tiles",
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);
    trail = L.polyline([], { color: "#22c55e", weight: 4 }).addTo(map);
    marker = L.circleMarker([0, 0], { radius: 8, color: "#22c55e", fillOpacity: 1 });

    let started = false;
    let heading = 0;
    let lastPos = null;

    tickHandle = setInterval(async () => {
      const reading = useRealGps ? source.next() : { pos: source.next(1), speedKmh: SIM_SPEED_KMH, headingDeg: null };
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
        map.panTo([lat, lng], { animate: true });
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
          applyHud(body.nextIntersection);
        } else if (res.status === 401) {
          stop("Kode ditolak"); // code revoked mid-mission: stop sending, lights fall back via ttl
        }
      } catch (err) {
        console.error("[gps post]", err.message);
      }

      if (!useRealGps && source.done()) stop();
    }, 1000);
  });

  function applyHud(next) {
    if (!next) {
      el.hudMode.textContent = "NORMAL";
      el.hudMode.className = "pill";
      el.hudName.textContent = "Belum ada simpang terdekat";
      el.hudDistance.textContent = "—";
      return;
    }
    const isPriority = next.mode === "PRIORITY";
    el.hudMode.textContent = isPriority ? "PRIORITAS" : "NORMAL";
    el.hudMode.className = `pill ${isPriority ? "pill--priority" : ""}`;
    el.hudName.textContent = next.name;
    el.hudDistance.textContent = `${Math.round(next.distanceM)} m`;
  }

  function stop(reason = "Selesai") {
    clearInterval(tickHandle);
    gpsSource?.stop();
    el.status.textContent = reason;
    el.status.className = "pill pill--offline";
  }

  el.btnStop.addEventListener("click", () => stop());
}
