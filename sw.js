/* 离线缓存：首次联网打开后，App、姿态模型和运算库都存在手机里，训练场没网也能用 */
const CACHE = "coachmind-v17";
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
  if (sameOrigin && /\.mp4$/.test(url.pathname)) { e.respondWith(videoResponse(req)); return; }
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

// 视频：Safari 播放视频时按字节范围（Range）分段请求，缓存里的整份文件必须切成 206 分段返回，否则 iPhone 上播不出来
async function videoResponse(req) {
  const cache = await caches.open(CACHE);
  let hit = await cache.match(req.url);
  if (!hit) {
    try { const r = await fetch(req.url); if (!r.ok) return r; await cache.put(req.url, r.clone()); hit = r; }
    catch (e) { return fetch(req); }
  }
  const buf = await hit.arrayBuffer(), total = buf.byteLength;
  const head = { "Content-Type": "video/mp4", "Accept-Ranges": "bytes" };
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get("range") || "");
  if (!m) return new Response(buf, { status: 200, headers: { ...head, "Content-Length": String(total) } });
  let start = m[1] ? +m[1] : total - +m[2], end = m[1] && m[2] ? +m[2] : total - 1;
  end = Math.min(end, total - 1); start = Math.max(0, start);
  if (start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${total}` } });
  return new Response(buf.slice(start, end + 1), { status: 206, headers: { ...head, "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${total}` } });
}
