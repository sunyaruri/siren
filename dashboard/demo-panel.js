// Panel Demo: presenter controls for the live demo (mission codes, citizen position, demo vehicles, radius).
// Every call carries the demo key; the backend refuses all of it when DEMO_KEY is not set.
const KEY_STORAGE = "siren-demo-key";
const POLL_MS = 2000;
const LIVE_MS = 150; // slider drag: at most one PUT per this interval

const $ = (id) => document.getElementById(id);
const el = {
  toggle: $("demo-toggle"),
  panel: $("demo-panel"),
  close: $("demo-close"),
  keyForm: $("demo-key-form"),
  key: $("demo-key"),
  msg: $("demo-msg"),
  body: $("demo-body"),
  speed: $("demo-speed"),
  speedOut: $("demo-speed-out"),
  type: $("demo-type"),
  start: $("demo-start"),
  run: $("demo-run"),
  pause: $("demo-pause"),
  clear: $("demo-clear"),
  runs: $("demo-runs"),
  citizen: $("demo-citizen"),
  citizenOut: $("demo-citizen-out"),
  citizenPresets: $("demo-citizen-presets"),
  radius: $("demo-radius"),
  radiusOut: $("demo-radius-out"),
  codes: $("demo-codes"),
  codeForm: $("demo-code-form"),
  code: $("demo-code"),
  reset: $("demo-reset"),
};

const LABEL = { ambulance: "Ambulans", firetruck: "Pemadam" };
const km = (m) => `${(m / 1000).toFixed(2)} km`;
const runStatus = (r) =>
  r.arrived
    ? "sampai tujuan (Reset untuk ulang)"
    : r.paused
      ? "dijeda"
      : `${r.speedKmh} km/j`;

function readKey() {
  try {
    return sessionStorage.getItem(KEY_STORAGE) ?? "";
  } catch {
    return "";
  }
}
function saveKey(key) {
  try {
    sessionStorage.setItem(KEY_STORAGE, key);
  } catch {
    // private mode: the key just is not remembered across reloads
  }
}

export function initDemoPanel({ onToggle }) {
  let key = readKey();
  el.key.value = key;
  let state = null;
  let pollHandle = null;

  async function api(method, path = "", body) {
    const res = await fetch(`/api/demo${path}`, {
      method,
      headers: { "content-type": "application/json", "x-demo-key": key },
      body: body && JSON.stringify(body),
    });
    if (res.ok) return res.json();
    if (res.status === 401) throw new Error("Kunci demo salah.");
    if (res.status === 403)
      throw new Error("Panel Demo mati di server (DEMO_KEY belum diset).");
    throw new Error(`Gagal (HTTP ${res.status}).`);
  }

  /** While a slider is dragged: send the latest value at most every LIVE_MS, without re-rendering the panel. */
  function livePut() {
    let timer = null;
    let pending = null;
    return (body) => {
      pending = body;
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        api("PUT", "", pending).catch(() => {});
      }, LIVE_MS);
    };
  }
  const liveRadius = livePut();
  const liveCitizen = livePut();

  async function act(request) {
    try {
      render(await request);
      el.msg.textContent = "";
    } catch (err) {
      el.msg.textContent = err.message;
    }
  }

  /** "S1 + 200 m" style label relative to the nearest intersection. */
  function whereOnRoute(alongM) {
    const nearest = state.stops.reduce((a, b) =>
      Math.abs(b.alongM - alongM) < Math.abs(a.alongM - alongM) ? b : a,
    );
    const delta = Math.round(alongM - nearest.alongM);
    return `${nearest.id} ${delta >= 0 ? "+" : "−"} ${Math.abs(delta)} m`;
  }

  function option(value, text) {
    const o = document.createElement("option");
    o.value = String(value);
    o.textContent = text;
    return o;
  }

  function render(next) {
    state = next;
    el.body.hidden = false;
    document.getElementById("demo-key-hint").hidden = true; // unlocked: the hint about the key no longer applies

    el.speed.value = String(state.speedKmh);
    el.speedOut.textContent = `${state.speedKmh} km/j`;
    el.radius.value = String(state.radiusM);
    el.radiusOut.textContent = `${state.radiusM} m`;
    el.citizen.max = String(state.routeLengthM);
    el.citizen.value = String(state.citizenAlongM);
    el.citizenOut.textContent = whereOnRoute(state.citizenAlongM);

    // Start just outside the radius so the light turns green a few seconds after pressing Jalankan.
    const chosen = el.start.value;
    el.start.replaceChildren(
      option(0, "Mulai dari awal rute"),
      ...state.stops.map((s) =>
        option(
          Math.max(0, s.alongM - state.radiusM - 100),
          `Mulai sebelum ${s.id}`,
        ),
      ),
    );
    if ([...el.start.options].some((o) => o.value === chosen))
      el.start.value = chosen;

    // Just past an intersection: the vehicle heading for it comes from behind the citizen.
    el.citizenPresets.replaceChildren(
      ...state.stops.map((s) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "btn btn--small";
        b.textContent = `Setelah ${s.id}`;
        b.addEventListener("click", () =>
          act(api("PUT", "", { citizenAlongM: s.alongM + 150 })),
        );
        return b;
      }),
    );

    el.runs.replaceChildren(
      ...(state.runs.length
        ? state.runs.map((r) => {
            const li = document.createElement("li");
            li.textContent = `${LABEL[r.type]} ${r.vehicleId} · ${km(r.alongM)} / ${km(state.routeLengthM)} · ${runStatus(r)}`;
            return li;
          })
        : [
            Object.assign(document.createElement("li"), {
              className: "empty",
              textContent: "Tidak ada kendaraan simulasi berjalan",
            }),
          ]),
    );

    // One button: pause while anything moves, otherwise resume.
    // Arrived vehicles are done: only the ones still on the road can be paused or resumed.
    const onRoad = state.runs.filter((r) => !r.arrived);
    el.pause.textContent = onRoad.some((r) => !r.paused) ? "Jeda" : "Lanjutkan";
    el.pause.disabled = onRoad.length === 0;
    el.clear.disabled = state.runs.length === 0;

    el.codes.replaceChildren(
      ...state.codes.map((code) => {
        const li = document.createElement("li");
        li.className = "chip";
        const text = document.createElement("span");
        text.textContent = code;
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "✕";
        remove.setAttribute("aria-label", `Hapus ${code}`);
        remove.addEventListener("click", () =>
          act(api("PUT", "", { codes: state.codes.filter((c) => c !== code) })),
        );
        li.append(text, remove);
        return li;
      }),
    );
  }

  function setOpen(open) {
    el.panel.hidden = !open;
    el.toggle.setAttribute("aria-expanded", String(open));
    onToggle(open);
    clearInterval(pollHandle);
    if (!open) return;
    // Keeps the running-vehicle list moving while the panel is open.
    pollHandle = setInterval(() => {
      if (state?.runs.some((r) => !r.paused)) act(api("GET"));
    }, POLL_MS);
    if (key) act(api("GET"));
    else el.key.focus();
  }

  el.toggle.addEventListener("click", () => setOpen(el.panel.hidden));
  el.close.addEventListener("click", () => setOpen(false));

  el.keyForm.addEventListener("submit", (e) => {
    e.preventDefault();
    key = el.key.value;
    saveKey(key);
    act(api("GET"));
  });

  el.speed.addEventListener("input", () => {
    el.speedOut.textContent = `${el.speed.value} km/j`;
  });
  el.speed.addEventListener("change", () =>
    act(api("PUT", "", { speedKmh: Number(el.speed.value) })),
  );
  el.radius.addEventListener("input", () => {
    el.radiusOut.textContent = `${el.radius.value} m`;
    liveRadius({ radiusM: Number(el.radius.value) });
  });
  el.radius.addEventListener("change", () =>
    act(api("PUT", "", { radiusM: Number(el.radius.value) })),
  );
  el.citizen.addEventListener("input", () => {
    el.citizenOut.textContent = whereOnRoute(Number(el.citizen.value));
    liveCitizen({ citizenAlongM: Number(el.citizen.value) });
  });
  el.citizen.addEventListener("change", () =>
    act(api("PUT", "", { citizenAlongM: Number(el.citizen.value) })),
  );

  el.run.addEventListener("click", () =>
    act(
      api("POST", "/run", {
        type: el.type.value,
        startM: Number(el.start.value),
      }),
    ),
  );
  el.pause.addEventListener("click", () =>
    act(
      api(
        "POST",
        state.runs.some((r) => !r.arrived && !r.paused) ? "/pause" : "/resume",
      ),
    ),
  );
  el.clear.addEventListener("click", () => act(api("POST", "/clear")));
  el.reset.addEventListener("click", () => act(api("POST", "/reset")));

  el.codeForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const code = el.code.value.trim().toUpperCase();
    if (!state || state.codes.includes(code)) return;
    act(api("PUT", "", { codes: [...state.codes, code] }));
    el.code.value = "";
  });
}
