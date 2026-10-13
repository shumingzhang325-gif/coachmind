// 关键点缺口：中间一段（0.25 s）完全丢失时不补直线、不在缺口里识别触地/腾空，报告里标出
const CM = require("./engine_src.js");
const { TH } = require("./data_node.js");
let ok = true; const chk = (c, m) => { console.log((c ? "✓ " : "✗ ") + m); if (!c) ok = false; };
// fillNaN：短缺口照补，长缺口保持 NaN
const x = [0, 1, NaN, 3, 4, NaN, NaN, NaN, NaN, NaN, 10];
const y = CM.fillNaN(x, 3);
chk(y[2] === 2 && y.slice(5, 10).every(v => Number.isNaN(v)), "fillNaN(maxGap)：1 帧缺口补齐，5 帧缺口保持空");
chk(CM.fillNaN(x)[7] === 7, "fillNaN 不传 maxGap 时行为不变");
// 短跑：合成数据中间挖掉 0.25 s 双脚关键点
const d = JSON.parse(require("fs").readFileSync("./_synthetic_sprint.json", "utf8").replace(/NaN/g, "null"));
const P0 = d.good.pose.map(f => f.map(p => p.map(v => v === null ? NaN : v)));
const fs = 240, n = P0.length, a = Math.floor(n / 2) - 30, b = a + 60;
const P = P0.map((f, i) => i >= a && i < b ? f.map((p, j) => j >= 25 ? [NaN, NaN, 0] : p) : f);
const full = CM.analyzeSprint(P0, fs, TH, null), r = CM.analyzeSprint(P, fs, TH, null);
const inGap = r.steps.filter(s => s.toeoff_frame >= a - 1 && s.touchdown_frame <= b);
chk(inGap.length === 0, `缺口 ${a}–${b - 1} 帧内没有识别出触地（完整数据 ${full.summary.n_contacts} 次，缺口后 ${r.summary.n_contacts} 次）`);
chk(r.gaps && r.gaps.length === 1 && r.gaps[0][0] === a && r.gaps[0][1] === b - 1, "报告记录了缺口范围");
chk(r.notes.some(t => t.includes("关键点丢失")), "报告提示：" + (r.notes.find(t => t.includes("关键点丢失")) || "无"));
chk(Math.abs(r.summary.contact_time_s - 0.11) < 0.02, `其余触地时间仍准确：${r.summary.contact_time_s} s（真值 0.110）`);
// 坐标还在、但可见度只有 0.1（MediaPipe 在“猜”被挡住的脚）：同样当作缺失
const PV = P0.map((f, i) => i >= a && i < b ? f.map((p, j) => j >= 25 ? [p[0], p[1], 0.1] : p) : f);
const rv = CM.analyzeSprint(PV, fs, TH, null);
chk(!rv.steps.some(s => s.toeoff_frame >= a - 1 && s.touchdown_frame <= b) && rv.gaps.length === 1 && rv.gaps[0][0] === a && rv.gaps[0][1] === b - 1 && rv.notes.some(t => t.includes("关键点丢失")),
  `可见度 0.1 的片段：不识别触地（${rv.summary.n_contacts} 次），并在报告里标出`);
// 跳跃：腾空中段脚丢失 → 不能把补线当成腾空算高度
const pose = [];
for (let i = 0; i < 480; i++) {
  const t = i / fs; let lift = 0;
  if (t >= 1 && t < 1.5) { const u = t - 1; lift = (2.4525 * u - 4.905 * u * u) * 228; }
  const f = [...Array(33)].map(() => [500, 400, 0.99]);
  for (const s of [0, 1]) { f[11 + s] = [500, 500, .99]; f[13 + s] = [520, 590, .99]; f[15 + s] = [540, 660, .99]; f[23 + s] = [480, 670 - lift, .99]; f[25 + s] = [500, 770 - lift, .99]; f[27 + s] = [500, 880 - lift, .99]; f[29 + s] = [490, 900 - lift, .99]; f[31 + s] = [530, 900 - lift, .99]; }
  if (t >= 1.15 && t < 1.35) for (let j = 25; j <= 32; j++) f[j] = [NaN, NaN, 0];
  pose.push(f);
}
const g = CM.analyzeGeneral(pose, fs, TH);
chk(g.jumps.length === 0 && g.notes.some(t => t.includes("关键点丢失")), `腾空中段缺失：不输出跳跃高度（${g.jumps.length} 次），并提示缺口`);
console.log(ok ? "\n全部通过 ✓" : "\n有失败 ✗"); process.exit(ok ? 0 : 1);
