const views = {
  landing: document.getElementById("view-landing"),
  driver: document.getElementById("view-driver"),
  citizen: document.getElementById("view-citizen"),
};

function show(name) {
  for (const [key, el] of Object.entries(views)) el.hidden = key !== name;
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

/** Same origin as this page by default; overridable in the Driver form for cloudflared tunnels. */
function defaultBackendUrl() {
  return window.location.origin;
}

document.getElementById("backend-url").value = defaultBackendUrl();

document.getElementById("btn-driver").addEventListener("click", async () => {
  show("driver");
  const { initDriver } = await import("./driver.js");
  initDriver({ getJson });
});

document.getElementById("btn-citizen").addEventListener("click", async () => {
  show("citizen");
  const backendUrl = defaultBackendUrl();
  const config = await getJson(`${backendUrl}/api/config`);
  const { initCitizen } = await import("./citizen.js");
  initCitizen(config);
});

for (const btn of document.querySelectorAll("[data-back]")) {
  btn.addEventListener("click", () => {
    window.location.reload(); // simplest reset: drop any running simulation/watch and start clean
  });
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
