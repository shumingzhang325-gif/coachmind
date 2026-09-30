// 实时捕捉自测：用合成骨架“表演”已知的动作（真值已知），加抖动噪声和丢帧，检查计数、指标和错误判断
const LIVE = require("../live.js");
const { K } = LIVE;
let fail = 0;
const check = (ok, msg) => { console.log((ok ? "✓ " : "✗ ") + msg); if (!ok) fail++; };
const rad = d => d * Math.PI / 180;

// 可复现的随机数 + 高斯噪声
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());

const SH = 180, TH_ = 190, TORSO = 250, GROUND = 900, AX = 400;   // 像素：小腿、大腿、躯干
const LEG = SH + TH_;
const blank = () => Array.from({ length: 33 }, () => [NaN, NaN, 0.2]);

// 侧面（面朝 +x）：knee 为膝角，trunkOverShin 为躯干比小腿多前倾的度数，heelLift 为脚跟抬起像素
function sidePose({ knee, trunkOverShin = 3, heelLift = 0, lift = 0, thighL = null, thighR = null, trunkAbs = null }) {
  const f = blank();
  const flex = 180 - knee, thS = flex * 0.42, thT = flex * 0.58;          // 小腿前倾 + 大腿后倾 = 屈膝量
  const ank = [AX, GROUND - 20 - lift];
  const kn = [ank[0] + SH * Math.sin(rad(thS)), ank[1] - SH * Math.cos(rad(thS))];
  const hip = [kn[0] - TH_ * Math.sin(rad(thT)), kn[1] - TH_ * Math.cos(rad(thT))];
  const tr = trunkAbs != null ? trunkAbs : thS + trunkOverShin;
  const sh = [hip[0] + TORSO * Math.sin(rad(tr)), hip[1] - TORSO * Math.cos(rad(tr))];
  const put = (i, p, v = 0.95) => { f[i] = [p[0], p[1], v]; };
  put(K.la, ank); put(K.lk, kn); put(K.lh, hip); put(K.ls, sh);
  put(K.lheel, [ank[0] - 25, GROUND - lift - heelLift]); put(K.lt, [ank[0] + 70, GROUND - lift]);
  put(K.nose, [sh[0] + 40, sh[1] - 60]);
  // 右侧（远侧）几乎重合，可见度略低
  put(K.ra, [ank[0] + 4, ank[1]], 0.7); put(K.rk, [kn[0] + 4, kn[1]], 0.7); put(K.rh, [hip[0] + 4, hip[1]], 0.7); put(K.rs, [sh[0] + 8, sh[1]], 0.7);
  put(K.rheel, [ank[0] - 21, GROUND - lift - heelLift], 0.7); put(K.rt, [ank[0] + 74, GROUND - lift], 0.7);
  // 高抬腿：各自的大腿抬起角（0 = 下垂，90 = 水平），小腿自然下垂
  for (const [s, th] of [["l", thighL], ["r", thighR]]) {
    if (th == null) continue;
    const hp = f[K[s + "h"]], kk = [hp[0] + TH_ * Math.sin(rad(th)), hp[1] + TH_ * Math.cos(rad(th))], aa = [kk[0], kk[1] + SH];
    f[K[s + "k"]] = [kk[0], kk[1], f[K[s + "k"]][2]]; f[K[s + "a"]] = [aa[0], aa[1], f[K[s + "a"]][2]];
    f[K[s + "t"]] = [aa[0] + 70, aa[1] + 20, f[K[s + "t"]][2]]; f[K[s + "heel"]] = [aa[0] - 25, aa[1] + 20, f[K[s + "heel"]][2]];
  }
  return f;
}
// 正面：drop 为髋下降（腿长比例），valgus 为膝内扣量（髋宽比例），pelvisTilt 为骨盆倾斜角，liftFoot 为抬起的脚（"r"）
function frontPose({ drop = 0, valgus = 0, pelvisTilt = 0, liftFoot = null, sway = 0 }) {
  const f = blank(), HW = 80, cx = 500 + sway;
  const put = (i, p, v = 0.95) => { f[i] = [p[0], p[1], v]; };
  const hipY = GROUND - 20 - LEG + drop * LEG;
  const dy = Math.tan(rad(pelvisTilt)) * HW * 2;
  const lh = [cx + HW, hipY - dy / 2], rh = [cx - HW, hipY + dy / 2];     // 画面左边是运动员右侧
  for (const [s, h, sign] of [["l", lh, 1], ["r", rh, -1]]) {
    const lifted = liftFoot === s;
    const a = [h[0] + sign * 5, lifted ? GROUND - 20 - 0.15 * LEG : GROUND - 20];
    const t = (h[1] + a[1]) / 2;
    const k = [h[0] + (a[0] - h[0]) * 0.5 - sign * valgus * HW * 2, t];
    put(K[s + "h"], h); put(K[s + "k"], k); put(K[s + "a"], a); put(K[s + "heel"], [a[0], a[1] + 18]); put(K[s + "t"], [a[0] + sign * 10, a[1] + 22]);
  }
  put(K.ls, [cx + 110, hipY - TORSO]); put(K.rs, [cx - 110, hipY - TORSO]); put(K.nose, [cx, hipY - TORSO - 70]);
  return f;
}
// 加噪声（σ 像素）、随机丢帧
function noisy(f, sigma = 2.5, drop = 0.03) {
  if (rnd() < drop) return null;
  return f.map(p => [p[0] + sigma * gauss(), p[1] + sigma * gauss(), p[2]]);
}
function run(drill, frames, fps, smooth = true) {
  const s = LIVE.Session(drill), sm = LIVE.Smoother();
  frames.forEach((f, i) => { const t = i / fps; s.push(smooth && f ? sm.push(f, t) : f, t); });
  return s.summary();
}
// 深蹲序列：每次 下蹲 1.2 s、最低停 0.15 s、起立 1.2 s，之间站 0.6 s
function squatSeq(n, fps, poseAt) {
  const out = [], seg = [0.6, 1.2, 0.15, 1.2];
  for (let r = 0; r < n; r++) {
    const T = seg.reduce((a, b) => a + b);
    for (let i = 0; i < T * fps; i++) {
      const t = i / fps; let u, phase;
      if (t < seg[0]) { u = 0; phase = "stand"; } else if (t < seg[0] + seg[1]) { u = (t - seg[0]) / seg[1]; phase = "down"; }
      else if (t < seg[0] + seg[1] + seg[2]) { u = 1; phase = "bottom"; } else { u = 1 - (t - seg[0] - seg[1] - seg[2]) / seg[3]; phase = "up"; }
      out.push(poseAt((1 - Math.cos(Math.PI * u)) / 2, phase, u));
    }
  }
  for (let i = 0; i < fps; i++) out.push(poseAt(0, "stand", 0));
  return out;
}

console.log("\n深蹲（侧面，30 fps，噪声 2.5 px，丢帧 3%）");
{
  const good = squatSeq(5, 30, u => noisy(sidePose({ knee: 175 - u * 100 })));      // 最低膝角 75°
  const S = run("squat", good, 30);
  check(S.n === 5, `标准深蹲计数 ${S.n}/5`);
  check(Math.abs(S.kneeMean - 75) < 6, `平均最低膝角 ${S.kneeMean.toFixed(1)}°（真值 75°）`);
  check(S.faults.length === 0, `标准深蹲无误报（${JSON.stringify(S.faults.map(f => f.key))}）`);
  // 下蹲用时从膝角低于 155° 算到最低点：按合成动作的缓动曲线，真值 0.85–1.0 s
  check(S.tempoDown > 0.78 && S.tempoDown < 1.08, `下蹲用时 ${S.tempoDown.toFixed(2)} s（从膝角 155° 到最低点，真值 0.85–1.0 s）`);
  const raw = run("squat", good, 30, false);
  check(raw.n === 5, `不去抖也能计数 ${raw.n}/5`);

  const shallow = run("squat", squatSeq(3, 30, u => noisy(sidePose({ knee: 175 - u * 60 }))), 30);   // 最低 115°
  check(shallow.n === 3 && shallow.faults.some(f => f.key === "shallow" && f.n === 3), `蹲不够深：3 次都报出（${JSON.stringify(shallow.faults)}）`);
  const lean = run("squat", squatSeq(3, 30, u => noisy(sidePose({ knee: 175 - u * 100, trunkOverShin: 3 + u * 32 }))), 30);
  check(lean.faults.some(f => f.key === "lean" && f.n === 3), `躯干过度前倾：3 次都报出`);
  const heel = run("squat", squatSeq(3, 30, u => noisy(sidePose({ knee: 175 - u * 100, heelLift: u * 30 }))), 30);
  check(heel.faults.some(f => f.key === "heel" && f.n >= 2), `脚跟离地：报出 ${JSON.stringify(heel.faults)}`);
  const hipFirst = run("squat", squatSeq(3, 30, (u, ph, lin) => noisy(sidePose({ knee: 175 - u * 100, trunkOverShin: 3 + (ph === "up" && lin > 0.6 ? (1 - lin) * 60 : 0) }))), 30);
  check(hipFirst.faults.some(f => f.key === "hipfirst" && f.n >= 2), `起立时髋先起：报出 ${JSON.stringify(hipFirst.faults)}`);
  // 1 秒站着不动 + 小幅晃动：不应计数
  const still = Array.from({ length: 150 }, (_, i) => noisy(sidePose({ knee: 172 + 3 * Math.sin(i / 5) })));
  check(run("squat", still, 30).n === 0, `站着晃动不误计`);
}

console.log("\n深蹲·正面（膝内扣）");
{
  const seq = v => squatSeq(3, 30, u => noisy(frontPose({ drop: u * 0.45, valgus: v * u })));
  const bad = run("squatFront", seq(0.25), 30), good = run("squatFront", seq(0), 30);
  check(bad.n === 3 && bad.faults.some(f => f.key === "valgus" && f.n === 3), `膝内扣 3 次都报出（最大 ${bad.valgusMax.toFixed(2)} 髋宽）`);
  check(good.n === 3 && good.faults.length === 0, `膝盖对齐不误报（计数 ${good.n}）`);
}

console.log("\n视角检查");
{
  const s = LIVE.Session("squat"); let st;
  for (let i = 0; i < 8; i++) st = s.push(frontPose({}), i / 30);
  check(/侧对镜头/.test(st.viewMsg), `侧面动作却正对镜头时提示：“${st.viewMsg}”`);
  const s2 = LIVE.Session("squat"); let st2;
  for (let i = 0; i < 8; i++) st2 = s2.push(sidePose({ knee: 175 }), i / 30);
  check(!st2.viewMsg, `正侧面时不提示（锁定后）`);
  const s3 = LIVE.Session("squat");
  check(s3.push(sidePose({ knee: 175 }), 0).viewMsg === "正在锁定人体…", `刚出现时先锁定，不马上计算`);
}

console.log("\n只露出半身时识别程序“猜”出的骨架（真机测试中发现的问题）");
{
  // 合理骨架中每隔几帧夹一个躯干横过来的假骨架（F1 画面里实际出现过的情况）：不能数出动作
  const frames = squatSeq(4, 30, (u, ph, lin) => noisy(sidePose({ knee: 175 - u * 100 })))
    .map((f, i) => (i % 4 === 3 ? sidePose({ knee: 160, trunkAbs: 95 }) : f));
  const S = run("squat", frames, 30);
  check(S.n === 0, `真假骨架交替出现时不计数（计数 ${S.n}）`);
  const clean = run("squat", squatSeq(4, 30, u => noisy(sidePose({ knee: 175 - u * 100 }))), 30);
  check(clean.n === 4, `同样的动作、骨架稳定时正常计数（${clean.n}/4）`);
}

console.log("\n反向纵跳（腾空 0.5 s → 30.7 cm）");
for (const fps of [30, 60]) {
  const PXM = LEG / 0.9;                    // 腿长 0.9 m
  const T = 0.5, v0 = 9.81 * T / 2;
  const frames = [], add = f => frames.push(f);
  const trials = [0.013, 0.37, 0.71];       // 每次起跳的采样相位不同（模拟真实情况）
  for (const ph of trials) {
    const t0 = frames.length / fps + ph / fps;
    for (let i = 0; i < 0.8 * fps; i++) add(noisy(sidePose({ knee: 175 }), 2));
    // 下蹲 0.5 s，蹬伸 0.25 s（最后 0.1 s 脚跟先抬起，脚尖仍着地）
    for (let i = 0; i < 0.5 * fps; i++) add(noisy(sidePose({ knee: 175 - 70 * i / (0.5 * fps) }), 2));
    for (let i = 0; i < 0.25 * fps; i++) { const u = i / (0.25 * fps); add(noisy(sidePose({ knee: 105 + 70 * u, heelLift: u > 0.6 ? (u - 0.6) * 60 : 0 }), 2)); }
    // 腾空：用精确时刻采样
    const tStart = frames.length / fps, tTake = tStart + ph / fps;
    for (let i = 0; ; i++) {
      const t = tStart + i / fps, tt = t - tTake;
      if (tt > T) break;
      const y = tt < 0 ? 0 : (v0 * tt - 4.905 * tt * tt) * PXM;
      add(noisy(sidePose({ knee: 175, lift: y }), 2));
    }
    // 落地缓冲 0.4 s：膝角到 110°
    for (let i = 0; i < 0.4 * fps; i++) add(noisy(sidePose({ knee: 175 - 65 * Math.sin(Math.PI * Math.min(1, i / (0.4 * fps)) / 2) }), 2));
    for (let i = 0; i < 0.5 * fps; i++) add(noisy(sidePose({ knee: 175 }), 2));
    void t0;
  }
  const S = run("cmj", frames, fps);
  const err = LIVE.jumpError(0.5, fps) * 100 + 1;
  const hs = S.reps.map(r => (r.height * 100).toFixed(1));
  check(S.n === 3, `${fps} fps 计数 ${S.n}/3`);
  check(S.reps.every(r => Math.abs(r.height * 100 - 30.66) < err), `${fps} fps 高度 ${hs.join(" / ")} cm（允许 ±${err.toFixed(1)} cm）`);
  check(S.faults.length === 0, `${fps} fps 缓冲落地不误报`);
}
{
  // 落地僵硬
  const fps = 30, frames = [];
  for (let i = 0; i < 24; i++) frames.push(sidePose({ knee: 175 }));
  for (let i = 0; i < 15; i++) frames.push(sidePose({ knee: 175, lift: 60 * Math.sin(Math.PI * i / 15) }));
  for (let i = 0; i < 30; i++) frames.push(sidePose({ knee: 165 }));
  const S = run("cmj", frames.map(f => noisy(f, 2, 0)), fps);
  check(S.faults.some(f => f.key === "stiff"), `落地僵硬报出`);
}

console.log("\n原地高抬腿（3 步/秒 = 180 步/分）");
{
  const fps = 30, frames = [];
  const mk = peak => { const fr = []; for (let i = 0; i < 6 * fps; i++) { const t = i / fps, w = 2 * Math.PI * 1.5 * t;
    fr.push(noisy(sidePose({ knee: 178, trunkAbs: 4, thighL: Math.max(0, Math.sin(w)) * peak, thighR: Math.max(0, -Math.sin(w)) * peak }))); } return fr; };
  const good = run("highknee", mk(88), fps), low = run("highknee", mk(72), fps);
  check(Math.abs(good.cadence - 180) < 10, `步频 ${good.cadence.toFixed(0)} 步/分（真值 180）`);
  check(good.faults.length === 0, `抬腿到位不误报`);
  check(low.faults.some(f => f.key === "low" && f.n > low.n * 0.8), `抬腿不到水平报出（${low.faults[0] && low.faults[0].n}/${low.n}）`);
}

console.log("\n单腿站立（正面）");
{
  const fps = 30, seq = (tilt, swayAmp) => {
    const fr = []; for (let i = 0; i < fps; i++) fr.push(noisy(frontPose({})));
    for (let i = 0; i < 5 * fps; i++) fr.push(noisy(frontPose({ liftFoot: "r", pelvisTilt: tilt, sway: swayAmp * Math.sin(i / 3) })));
    for (let i = 0; i < fps; i++) fr.push(noisy(frontPose({})));
    return fr;
  };
  const good = run("balance", seq(2, 1), fps), bad = run("balance", seq(11, 1), fps), wobble = run("balance", seq(2, 30), fps);
  check(good.n === 1 && Math.abs(good.holdBest - 5) < 0.4 && good.faults.length === 0, `稳定站 5 秒：记 ${good.holdBest && good.holdBest.toFixed(1)} s，无误报`);
  check(bad.faults.some(f => f.key === "pelvis"), `骨盆下沉报出`);
  check(wobble.faults.some(f => f.key === "sway"), `晃动大报出`);
}

console.log("\n去抖动：One-Euro 滤波减少静止抖动");
{
  const f = LIVE.OneEuro(), xs = [], ys = [];
  for (let i = 0; i < 300; i++) { const v = 100 + 3 * gauss(); xs.push(v); ys.push(f.filter(v, i / 30)); }
  const s = a => Math.sqrt(a.slice(30).reduce((t, v) => t + (v - 100) ** 2, 0) / (a.length - 30));
  check(s(ys) < s(xs) * 0.5, `抖动 ${s(xs).toFixed(2)} px → ${s(ys).toFixed(2)} px`);
}

console.log(fail ? `\n${fail} 项失败 ✗` : "\n全部通过 ✓");
process.exit(fail ? 1 : 0);
