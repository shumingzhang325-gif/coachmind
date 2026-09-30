// 合成一次反向跳：已知腾空时间 0.50 s → 高度 = 9.81×0.25/8 = 30.7 cm
const CM = require("./engine_src.js");
const { TH } = require("./data_node.js");
const fs = 240, n = 480, flight = 0.5, t0 = 1.0, H = 400, scale = H / 1.75;
const pose = [];
for (let i = 0; i < n; i++) {
  const t = i / fs;
  let lift = 0, crouch = 0;
  if (t >= t0 && t < t0 + flight) { const u = t - t0, v0 = 9.81 * flight / 2; lift = (v0 * u - 4.905 * u * u) * scale; }
  if (t > t0 - 0.5 && t < t0) crouch = Math.sin(Math.PI * (t - (t0 - 0.5)) / 0.5) * 60;
  if (t >= t0 + flight && t < t0 + flight + 0.35) crouch = Math.sin(Math.PI * (t - t0 - flight) / 0.35) * 50;
  const gy = 900, ay = gy - 20 - lift, ky = ay - 110 + crouch * 0.3, hy = ky - 110 + crouch, sy = hy - 170;
  const kx = 500 + crouch * 0.9;
  const f = [...Array(33)].map(() => [500, sy - 60, 0.99]);
  const set = (j, x, y) => (f[j] = [x + (Math.random() - 0.5) * 2, y + (Math.random() - 0.5) * 2, 0.99]);
  for (const [s, off] of [[0, -4], [1, 4]]) {
    set(11 + s, 500 + off, sy); set(13 + s, 520 + off, sy + 90); set(15 + s, 540 + off, sy + 160);
    set(23 + s, 480 + off, hy); set(25 + s, kx + off, ky); set(27 + s, 500 + off, ay);
    set(29 + s, 490 + off, gy - lift); set(31 + s, 530 + off, gy - lift);
  }
  pose.push(f);
}
const r = CM.analyzeGeneral(pose, fs, TH);
console.log("跳跃", r.jumps.length, "次；腾空", r.summary.flight_time_s, "s（真值 0.500）；高度", r.summary.jump_height_cm, "cm（真值 30.7）");
console.log("起跳前最小膝角", r.summary.knee_min_pre_deg, "；落地最小膝角", r.summary.landing_knee_min_deg);
const ok = r.jumps.length === 1 && Math.abs(r.summary.flight_time_s - 0.5) <= 3 / fs && Math.abs(r.summary.jump_height_cm - 30.7) < 1.5;
console.log(ok ? "✓ 通过" : "✗ 失败"); process.exit(ok ? 0 : 1);
