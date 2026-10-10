// Service worker: guarda la "cáscara" de la app para abrirla rápido y muestra los avisos push.
const V = "turnos-v10";
const SHELL = ["./", "index.html", "app.js", "style.css", "config.js", "icon.svg", "icon-192.png", "manifest.webmanifest"];
self.addEventListener("install", e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  // primero red (para ver siempre la última versión), caché si no hay conexión
  e.respondWith(fetch(e.request).then(r => { const cp = r.clone(); caches.open(V).then(c => c.put(e.request, cp)); return r; })
    .catch(() => caches.match(e.request)));
});

// ---- avisos push ----
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Turno D", {
    body: d.body || "Hay cambios en el calendario",
    icon: "icon-192.png", badge: "icon-192.png",
    tag: d.tag || "turnos", renotify: true,
    data: { url: d.url || "./" },
  }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(cs => {
    for (const c of cs) { if ("focus" in c) return c.focus(); }
    return self.clients.openWindow((e.notification.data && e.notification.data.url) || "./");
  }));
});
