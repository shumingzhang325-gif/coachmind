// 视频分析审查：已知真值的合成数据上，检查各帧率下的误差、诊断规则不误报也不漏报、低帧率会提示
// 审查标准：① 误差有量化 ② 测不准时说“测不准” ③ 正常动作不报问题 ④ 错误动作在可测条件下能报出
const CM = require("./engine_src.js");
const { TH, CARDS } = require("./data_node.js");
const d = JSON.parse(require("fs").readFileSync("./_synthetic_sprint.json", "utf8").replace(/NaN/g, "null"));
const load = name => d[name].pose.map(f => f.map(p => p.map(v => v === null ? NaN : v)));
let fail = 0;
const check = (ok, msg) => { console.log((ok ? "✓ " : "✗ ") + msg); if (!ok) fail++; };
let seed = 3; const rnd = () => ((seed = seed * 16807 % 2147483647) / 2147483647 - 0.5);
const resample = (P, fs, ph) => { const out = [], step = 240 / fs; for (let k = ph; k < P.length; k += step) out.push(P[Math.floor(k)].map(p => [p[0] + rnd() * 3, p[1] + rnd() * 3, p[2]])); return out; };
const phases = fs => { const step = 240 / fs, a = []; for (let p = 0; p < step; p += Math.max(1, step / 4)) a.push(p); return a; };

console.log("短跑：误差随帧率（真值 触地 0.110 s，步频 4.35 /s）");
const good = load("good"), bad = load("bad");
for (const fs of [30, 60, 120, 240]) {
  const rs = phases(fs).map(ph => CM.analyzeSprint(resample(good, fs, ph), fs, TH, 0.005));
  const U = CM.uncertainty(rs[0]);
  const ctOk = rs.every(r => Math.abs(r.summary.contact_time_s - 0.11) <= U.contact_time_s);
  const sfOk = rs.every(r => Math.abs(r.summary.step_frequency_hz - 4.35) < 0.2);
  check(ctOk, `${fs} fps 触地时间都在 0.110 ± ${U.contact_time_s.toFixed(3)} s 内（${rs.map(r => r.summary.contact_time_s).join(" / ")}）`);
  check(sfOk, `${fs} fps 步频误差 < 0.2 /s`);
  check(fs >= 100 || rs.every(r => r.notes.some(n => /只能参考/.test(n))), `${fs} fps ${fs < 100 ? "提示“只能参考”" : "无需提示"}`);
  const fp = rs.flatMap(r => CM.matchCards(r, TH, CARDS).map(h => h.id));
  check(fp.length === 0, `${fs} fps 正常跑不报确认问题${fp.length ? "（误报：" + fp.join(",") + "）" : ""}`);
}
for (const fs of [60, 120, 240]) {
  const ids = phases(fs).map(ph => CM.matchCards(CM.analyzeSprint(resample(bad, fs, ph), fs, TH, 0.005), TH, CARDS).map(h => h.id));
  check(ids.every(x => x.includes("SP-01")), `${fs} fps 错误跑（触地 0.145 s）报出“触地偏长”`);
}
{
  const r = CM.analyzeSprint(bad, 240, TH, 0.005), h = CM.matchCards(r, TH, CARDS);
  check(h.map(x => x.id).includes("SP-02"), `240 fps 已标定时，错误跑报出“着地点过远”`);
  const g = CM.matchCards(CM.analyzeSprint(good, 240, TH, 0.005), TH, CARDS);
  check(!g.some(x => x.id === "SP-02") && g.borderline.some(x => x.id === "SP-02"), `正常跑着地距离 0.375 m 只比阈值 0.35 m 多 0.025 m（误差 ±0.03）：不确认，标为边缘（旧版在这里误报）`);
}
{
  // 触地次数太少：即使超阈值也只算边缘
  const r = CM.analyzeSprint(bad, 240, TH, 0.005);
  const few = Object.assign({}, r, { summary: Object.assign({}, r.summary, { n_contacts: 2 }) });
  const h = CM.matchCards(few, TH, CARDS);
  check(h.length === 0 && h.borderline.some(x => /少于/.test(x.reason)), `只识别到 2 次触地时不下结论`);
}

{
  // 重新打开保存的记录时如果丢了帧率：按 30 帧保守估计误差，不能当作“没有误差”（端到端测试中发现）
  const h = CM.matchCards({ action: "sprint", summary: { contact_time_s: 0.125, n_contacts: 6 } }, TH, CARDS);
  check(h.length === 0 && h.borderline.some(x => x.id === "SP-01"), `帧率未知时触地 0.125 s 只算边缘，不确认`);
}

console.log("\n纵跳：抛物线拟合（真值 0.500 s → 30.7 cm）");
function jumpPose(fs, phase) {
  const n = Math.round(2 * fs), flight = 0.5, t0 = 1.0 + phase / fs, scale = 400 / 1.75, pose = [];
  for (let i = 0; i < n; i++) {
    const t = i / fs; let lift = 0, crouch = 0;
    if (t >= t0 && t < t0 + flight) { const u = t - t0, v0 = 9.81 * flight / 2; lift = (v0 * u - 4.905 * u * u) * scale; }
    if (t > t0 - 0.5 && t < t0) crouch = Math.sin(Math.PI * (t - (t0 - 0.5)) / 0.5) * 60;
    if (t >= t0 + flight && t < t0 + flight + 0.35) crouch = Math.sin(Math.PI * (t - t0 - flight) / 0.35) * 50;
    const gy = 900, ay = gy - 20 - lift, ky = ay - 110 + crouch * 0.3, hy = ky - 110 + crouch, sy = hy - 170, kx = 500 + crouch * 0.9;
    const f = [...Array(33)].map(() => [500, sy - 60, 0.99]);
    const set = (j, x, y) => (f[j] = [x + rnd() * 2, y + rnd() * 2, 0.99]);
    for (const [s, off] of [[0, -4], [1, 4]]) { set(11 + s, 500 + off, sy); set(13 + s, 520 + off, sy + 90); set(15 + s, 540 + off, sy + 160); set(23 + s, 480 + off, hy); set(25 + s, kx + off, ky); set(27 + s, 500 + off, ay); set(29 + s, 490 + off, gy - lift); set(31 + s, 530 + off, gy - lift); }
    pose.push(f);
  }
  return pose;
}
for (const fs of [30, 60, 120, 240]) {
  const rs = [0, 0.25, 0.5, 0.75].map(ph => CM.analyzeGeneral(jumpPose(fs, ph), fs, TH));
  const hs = rs.map(r => r.summary.jump_height_cm);
  check(hs.every(h => Math.abs(h - 30.66) < 1), `${fs} fps 跳高 ${hs.join(" / ")} cm，误差 < 1 cm`);
  const u = CM.uncertainty(rs[0]).jump_height_cm;
  check(isFinite(u) && u < 3, `${fs} fps 跳高给出误差估计 ±${u.toFixed(1)} cm`);
}

console.log(fail ? `\n${fail} 项失败 ✗` : "\n全部通过 ✓");
process.exit(fail ? 1 : 0);
