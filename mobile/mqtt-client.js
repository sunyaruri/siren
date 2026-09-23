import mqtt from "https://cdn.jsdelivr.net/npm/mqtt@5.16.0/dist/mqtt.esm.js";

/** Connects to the shared HiveMQ broker over WSS. `onMessage(topic, msg)` gets parsed JSON only; malformed payloads are dropped. */
export function connectMqtt(wsUrl, topicFilter, { onStatus, onMessage }) {
  const client = mqtt.connect(wsUrl, {
    clientId: `siren-mobile-${Math.random().toString(16).slice(2, 10)}`,
    reconnectPeriod: 2000,
  });
  client.on("connect", () => {
    onStatus(true);
    client.subscribe(topicFilter);
  });
  client.on("offline", () => onStatus(false));
  client.on("close", () => onStatus(false));
  client.on("message", (topic, payload) => {
    let msg;
    try {
      msg = JSON.parse(payload.toString());
    } catch {
      return;
    }
    onMessage(topic, msg);
  });
  return client;
}

export function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
