// Hero live card: a 12 s loop of one ambulance approaching S1, like a vehicle card in the Command Center. The HTML
// markup is the final frame shown without JS and under prefers-reduced-motion; this module only animates it while
// the card is on screen.

const LOOP_S = 12;
const LEAD_S = 40; // backend default ETA_LEAD_S: green opens when the predicted arrival is at most this

const card = document.getElementById("live-card");
const etaVal = document.getElementById("live-eta");
const bar = document.getElementById("live-bar");
const status = document.getElementById("live-status");
const pauseBtn = document.getElementById("hero-pause");
const steps = [...card.querySelectorAll("[data-step]")];

function setText(el, value) {
  if (el.textContent !== value) el.textContent = value;
}

/** Draws the card at loop time t (seconds): ETA 52 → 38 s, green from 40 s on (t = 6), then holds. */
function draw(t) {
  const eta = Math.max(38, Math.round(52 - 2 * t));
  const green = eta <= LEAD_S;
  const step = green ? 3 : t < 2 ? 1 : 2;
  setText(etaVal, String(eta));
  // Same rule as the dashboard bar: fills up as the prediction approaches the threshold, full = green.
  bar.style.width = `${Math.round(Math.min(1, LEAD_S / eta) * 100)}%`;
  card.classList.toggle("is-green", green);
  setText(status, green ? "Lampu S1 hijau" : "Menunggu…");
  for (const li of steps)
    li.classList.toggle("is-on", Number(li.dataset.step) <= step);
}

// Playback: runs only when motion is allowed, not paused by the user, on screen, and the tab is visible.
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
let userPaused = false;
let onScreen = true;
let elapsed = 0;
let last = 0;
let raf = 0;

const shouldRun = () =>
  !reduceMotion.matches && !userPaused && onScreen && !document.hidden;

function tick(now) {
  if (last) elapsed = (elapsed + (now - last) / 1000) % LOOP_S;
  last = now;
  draw(elapsed);
  raf = requestAnimationFrame(tick);
}

function sync() {
  pauseBtn.hidden = reduceMotion.matches;
  if (shouldRun() && !raf) {
    last = 0;
    raf = requestAnimationFrame(tick);
  } else if (!shouldRun() && raf) {
    cancelAnimationFrame(raf);
    raf = 0;
  }
  if (reduceMotion.matches) draw(LOOP_S);
}

pauseBtn.addEventListener("click", () => {
  userPaused = !userPaused;
  pauseBtn.setAttribute("aria-pressed", String(userPaused));
  pauseBtn.setAttribute(
    "aria-label",
    userPaused ? "Putar animasi" : "Jeda animasi",
  );
  sync();
});
pauseBtn.setAttribute("aria-pressed", "false");

new IntersectionObserver(([entry]) => {
  onScreen = entry.isIntersecting;
  sync();
}).observe(card);
document.addEventListener("visibilitychange", sync);
reduceMotion.addEventListener("change", sync);
sync();
