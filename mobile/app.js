import { initDriver } from "./driver.js?v=20261107a";
import { initCitizen } from "./citizen.js?v=20261107a";

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

let roleChosen = false; // a double-tap on a landing button would otherwise init the same Leaflet map twice

document.getElementById("btn-driver").addEventListener("click", () => {
  if (roleChosen) return;
  roleChosen = true;
  show("driver");
  initDriver({ getJson }); // synchronous: the submit listener must exist before the user can possibly submit
});

document.getElementById("btn-citizen").addEventListener("click", async () => {
  if (roleChosen) return;
  roleChosen = true;
  show("citizen");
  const config = await getJson(`${window.location.origin}/api/config`);
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
