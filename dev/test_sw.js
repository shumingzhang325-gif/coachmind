// 离线缓存：CORE 不含大文件（addAll 不会因 19 MB 离线包失败）；激活新版本时保留离线包缓存；app.js 后台逐个缓存离线包
const fs = require("fs");
let ok = true; const chk = (c, m) => { console.log((c ? "✓ " : "✗ ") + m); if (!c) ok = false; };
const src = fs.readFileSync("../sw.js", "utf8"), app = fs.readFileSync("../app.js", "utf8");
const L = {}, self = { addEventListener: (t, f) => (L[t] = f), skipWaiting: () => {}, clients: { claim: () => {} } };
const deleted = [];
const caches = { keys: async () => ["coachmind-v1", "coachmind-offline-v1"], delete: async k => deleted.push(k), open: async () => ({ addAll: async () => {} }) };
const ctx = new Function("self", "caches", "location", src + "; return { CACHE, CORE, OFFLINE };")(self, caches, { origin: "https://x" });
chk(!ctx.CORE.some(f => /\.(task|wasm|mjs)$|mp4box|vision_wasm/.test(f)), "CORE 里没有模型和运算库");
chk(ctx.OFFLINE === "coachmind-offline-v1" && app.includes(`caches.open("${ctx.OFFLINE}")`), "app.js 与 sw.js 用同一个离线包缓存名");
let p; L.activate({ waitUntil: x => (p = x) });
p.then(() => {
  chk(deleted.includes("coachmind-v1") && !deleted.includes(ctx.OFFLINE), "激活新版本：删旧版缓存，保留离线包");
  for (const f of ["pose_landmarker_full.task", "vision_wasm_internal.wasm", "vision_wasm_internal.js", "vision_bundle.mjs", "mp4box.all.min.js"]) chk(app.includes(`["${f}"`), `离线包包含 ${f}`);
  chk(app.includes("正在下载离线包，约 19 MB") && app.includes("离线包已就绪"), "有下载中与完成提示");
  console.log(ok ? "\n全部通过 ✓" : "\n有失败 ✗"); process.exit(ok ? 0 : 1);
});
