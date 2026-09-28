const CM = require("./engine_src.js");
const { TH, CARDS } = require("./data_node.js");
const data = JSON.parse(require("fs").readFileSync("./_synthetic_sprint.json", "utf8").replace(/NaN/g, "null"));
const FS = 240;
let fail = 0;
const check = (name, got, want, tol) => { const ok = Math.abs(got - want) <= tol; if (!ok) fail++; console.log(`${ok ? "✓" : "✗"} ${name}: JS ${got}  对照 ${want}`); };

for (const name of ["good", "bad"]) {
  const pose = data[name].pose.map(f => f.map(p => p.map(v => v === null ? NaN : v)));
  const r = CM.analyzeSprint(pose, FS, TH, 0.005), py = data[name].py_summary;
  console.log(`\n短跑-${name}`);
  for (const k of ["contact_time_s", "flight_time_s", "step_length_m", "touchdown_distance_m", "n_contacts"])
    check(k, r.summary[k], py[k], k === "n_contacts" ? 0 : k.endsWith("_s") ? 1 / FS : 0.01);
  if (name === "bad") { const ids = CM.matchCards(r, TH, CARDS).map(h => h.id); console.log("  触发:", ids); if (!(ids.includes("SP-01") && ids.includes("SP-02"))) fail++; }
}

// 高翻：合成帧 + 模板跟踪 + 指标
console.log("\n高翻");
const W = 360, H = 360, r = 22, scale = 0.45 / (2 * r), n = 480;
const t = [...Array(n).keys()].map(i => i / FS), vy = t.map(tt =>
  tt >= 0.3 && tt < 0.8 ? Math.sin(Math.PI * (tt - 0.3) / 1.0) :
  tt >= 0.8 && tt < 1.0 ? 1 + 0.9 * Math.sin(Math.PI / 2 * (tt - 0.8) / 0.2) :
  tt >= 1.0 && tt < 1.25 ? 1.9 * Math.cos(Math.PI / 2 * (tt - 1.0) / 0.25) :
  tt >= 1.25 && tt < 1.45 ? -0.9 * Math.sin(Math.PI * (tt - 1.25) / 0.2) : 0);
const h = []; vy.reduce((s, v, i) => (h[i] = s + v / FS), 0);
const dx = t.map(tt => 0.06 * Math.sin(Math.min(1, Math.max(0, (tt - 0.3) / 1.2)) * Math.PI));
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const bg = new Uint8Array(W * H).map(() => 170 + Math.floor(rnd() * 60));
function frame(i) {
  const g = bg.slice(), cx = 120 + dx[i] / scale, cy = 320 - h[i] / scale;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = Math.hypot(x - cx, y - cy);
    if (d < r) g[y * W + x] = d < r / 3 ? 200 : Math.abs(y - cy) < 1.5 ? 240 : 45;
  }
  return g;
}
const tr = new CM.PlateTracker(frame(0), W, H, 120, 320, r);
const bar = [[120, 320]];
for (let i = 1; i < n; i++) bar.push(tr.update(frame(i)));
const ok = bar.filter(p => Number.isFinite(p[0])).length / n;
const res = CM.analyzeClean(bar, FS, scale, TH, null);
const truePk = Math.max(...vy), trueTop = Math.max(...h);
console.log("  跟踪成功率", (ok * 100).toFixed(0) + "%");
check("峰速", res.summary.peak_bar_velocity_mps, truePk, 0.12);
check("最高", res.summary.max_bar_height_m, trueTop, 0.02);
check("下蹲", res.summary.drop_under_m, trueTop - h[n - 1], 0.03);
check("前移", res.summary.bar_forward_max_m, Math.max(...dx), 0.01);
{
  const tr30 = new CM.PlateTracker(frame(0), W, H, 120, 320, r); let lost = 0;
  for (let i = 8; i < n; i += 8) { const p = tr30.update(frame(i)); const ty = 320 - h[i] / scale; if (!(Math.abs(p[1] - ty) < 3)) lost++; }
  console.log(`${lost ? "✗" : "✓"} 30 fps 跟踪：${lost} 帧偏离`); if (lost) fail++;
}
console.log(fail ? `\n${fail} 项失败` : "\n全部通过 ✓");
process.exit(fail ? 1 : 0);
