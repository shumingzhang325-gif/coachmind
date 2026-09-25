/* 离线缓存：首次联网打开后，App、姿态模型和运算库都存在手机里，训练场没网也能用 */
const CACHE = "coachmind-v13";
const CORE = ["./", "index.html", "app.js", "engine.js", "coach.js", "cover.js", "sports.js", "manifest.webmanifest", "icon-180.png", "icon-192.png", "icon-512.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || req.url.startsWith("blob:")) return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === location.origin;
  const isLib = /jsdelivr\.net|storage\.googleapis\.com|npmmirror\.com|unpkg\.com/.test(url.host);
  if (!sameOrigin && !isLib) return;
  if (sameOrigin && /\.(html|js)$|\/$/.test(url.pathname)) {
    // 自己的代码：先联网取最新，失败再用缓存
    e.respondWith(fetch(req).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put(req, c)); return r; }).catch(() => caches.match(req)));
    return;
  }
  // 模型和运算库：先用缓存，没有再下载并存起来
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => {
    if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(req, c)); }
    return r;
  })));
});
