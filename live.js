/* 知练 CoachMind 实时动作捕捉：关节角度、去抖动、视角检查、次数计数、动作规则
   纯计算，不碰界面，Node 里可直接测试（dev/test_live.js）。
   输入：一帧 33 个关键点 [[x, y, 可见度], ...]，x/y 为像素坐标（y 向下），与 app.js 的格式相同。
   阈值是经验值（TH），需教练校准；所有角度都是 2D 画面里的投影角，只有相机垂直于动作平面时才接近真实角度。 */
(function (root) {
  "use strict";
  const K = { nose: 0, ls: 11, rs: 12, le: 13, re: 14, lw: 15, rw: 16, lh: 23, rh: 24, lk: 25, rk: 26, la: 27, ra: 28, lheel: 29, rheel: 30, lt: 31, rt: 32 };
  const DEG = 180 / Math.PI;
  const isF = Number.isFinite;
  const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
  const sd = a => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1)); };

  // ---------------- 阈值（经验值，改这里即可） ----------------
  const TH = {
    minVis: 0.5,                 // 关键点可见度低于此值视为看不到
    body: { legTorso: [0.9, 2.6], thighShank: [0.35, 2.2], maxTrunk: 80, lockFrames: 6 },   // 人体比例的合理范围（2D 投影，放得较宽）；躯干不超过 80°（这些动作都是站立完成）；连续 6 帧合理才“锁定”
    sideMaxShoulderRatio: 0.35,  // 侧面拍摄：两肩水平距离 / 躯干长度应小于此值
    frontMinShoulderRatio: 0.45, // 正面拍摄：应大于此值
    squat: { downKnee: 120, upKnee: 155, shallowKnee: 100, leanOverShin: 20, heelLift: 0.035, hipFirst: 12, valgus: 0.12, minRepS: 0.6, maxRepS: 8 },
    cmj: { leave: 0.035, back: 0.018, stiffKnee: 145, cushionS: 0.35, minFlightS: 0.12, maxFlightS: 1.2 },
    highknee: { thighUp: 60, thighDown: 35, targetThigh: 80, backLean: 8 },
    balance: { pelvisTilt: 6, swayWarn: 0.08, valgus: 0.12, minHoldS: 2 },
  };

  // ---------------- 几何 ----------------
  const ok = (f, i) => f && f[i] && isF(f[i][0]) && isF(f[i][1]) && (f[i][2] == null || f[i][2] >= TH.minVis);
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  // b 点处的夹角（0–180°）
  function angle(a, b, c) {
    const v1 = [a[0] - b[0], a[1] - b[1]], v2 = [c[0] - b[0], c[1] - b[1]];
    const n = Math.hypot(...v1) * Math.hypot(...v2);
    if (!n) return NaN;
    return Math.acos(Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / n))) * DEG;
  }
  // 线段 下→上 与竖直方向的夹角；带符号：上端在下端右侧为正
  function tilt(lower, upper) { return Math.atan2(upper[0] - lower[0], lower[1] - upper[1]) * DEG; }

  // 侧面拍摄时用离镜头近的一侧（可见度高的一侧）
  function pickSide(f) {
    const sc = s => [K[s + "h"], K[s + "k"], K[s + "a"], K[s + "s"]].reduce((t, i) => t + (f[i] && f[i][2] != null ? f[i][2] : 1), 0);
    return sc("l") >= sc("r") ? "l" : "r";
  }
  // 拍摄视角：两肩水平距离 / 躯干长度。侧面接近 0，正面接近 0.6–0.9
  function viewRatio(f) {
    if (!(ok(f, K.ls) && ok(f, K.rs) && ok(f, K.lh) && ok(f, K.rh))) return NaN;
    const torso = dist(mid(f[K.ls], f[K.rs]), mid(f[K.lh], f[K.rh]));
    return torso ? Math.abs(f[K.ls][0] - f[K.rs][0]) / torso : NaN;
  }
  function viewCheck(f, want) {
    const r = viewRatio(f);
    if (!isF(r)) return { ok: null, ratio: r };
    if (want === "side") return { ok: r < TH.sideMaxShoulderRatio, ratio: r, msg: r < TH.sideMaxShoulderRatio ? "" : "请让运动员侧对镜头（正侧面），否则角度会失真" };
    return { ok: r > TH.frontMinShoulderRatio, ratio: r, msg: r > TH.frontMinShoulderRatio ? "" : "请让运动员正对镜头" };
  }
  // 膝内扣：膝关节偏离“髋—踝连线”的水平距离，除以髋宽；正值 = 向身体中线内扣
  function valgus(f, s) {
    const h = f[K[s + "h"]], k = f[K[s + "k"]], a = f[K[s + "a"]], oh = f[K[(s === "l" ? "r" : "l") + "h"]];
    if (![h, k, a, oh].every(p => p && isF(p[0]))) return NaN;
    const hipW = Math.abs(h[0] - oh[0]); if (hipW < 1) return NaN;
    const t = (k[1] - h[1]) / ((a[1] - h[1]) || 1e-9), lineX = h[0] + t * (a[0] - h[0]);
    const inward = Math.sign(oh[0] - h[0]);           // 指向身体中线的方向
    return ((k[0] - lineX) * inward) / hipW;
  }

  // 人体比例合理性：只露出上半身时，识别程序会把腿“猜”进画面，可见度还不低；比例不对的帧不参与计算
  function plausible(f, s, F) {
    const P = n => f[K[s + n]];
    if (!["s", "h", "k", "a"].every(n => ok(f, K[s + n]))) return false;
    const torso = dist(P("s"), P("h")), thigh = dist(P("h"), P("k")), shank = dist(P("k"), P("a"));
    if (!(torso > 0 && shank > 0)) return false;
    const legTorso = (thigh + shank) / torso, ts = thigh / shank;
    const feet = ["la", "ra"].filter(n => ok(f, K[n])).map(n => f[K[n]][1]);
    const feetBelow = feet.length && Math.max(...feet) > P("h")[1] + 0.35 * (thigh + shank);
    const trunk = Math.abs(tilt(P("h"), P("s")));
    return trunk < TH.body.maxTrunk && legTorso > TH.body.legTorso[0] && legTorso < TH.body.legTorso[1] && ts > TH.body.thighShank[0] && ts < TH.body.thighShank[1] && feetBelow;
  }

  // 一帧的全部特征
  function features(f) {
    if (!f) return null;
    const s = pickSide(f), P = n => f[K[s + n]];
    const has = (...n) => n.every(x => ok(f, K[s + x]));
    const legLen = has("h", "k", "a") ? dist(P("h"), P("k")) + dist(P("k"), P("a")) : NaN;
    const out = { side: s, legLen, view: viewRatio(f) };
    out.knee = has("h", "k", "a") ? angle(P("h"), P("k"), P("a")) : NaN;
    out.hip = has("s", "h", "k") ? angle(P("s"), P("h"), P("k")) : NaN;
    out.trunk = has("s", "h") ? Math.abs(tilt(P("h"), P("s"))) : NaN;               // 躯干前倾（与竖直夹角）
    out.trunkSigned = has("s", "h") ? tilt(P("h"), P("s")) : NaN;
    out.shin = has("k", "a") ? Math.abs(tilt(P("a"), P("k"))) : NaN;                  // 小腿前倾
    out.hipY = has("h") ? P("h")[1] : NaN; out.kneeY = has("k") ? P("k")[1] : NaN;
    out.hipBelowKnee = isF(out.hipY) && isF(out.kneeY) ? out.hipY >= out.kneeY : false;
    const hs = ["l", "r"].map(x => ok(f, K[x + "heel"]) && ok(f, K[x + "t"]) ? f[K[x + "heel"]][1] - f[K[x + "t"]][1] : NaN).filter(isF);
    out.heelUp = hs.length ? -Math.min(...hs) : NaN;                                   // 脚跟高于脚尖的像素（越大越“踮脚”）
    const ank = ["la", "ra"].filter(n => ok(f, K[n])).map(n => f[K[n]][1]);
    out.ankleY = ank.length ? mean(ank) : NaN;
    // 脚尖：起跳时最后离地、落地时最先着地，用它判断腾空比脚踝准（起跳前脚跟先抬起，脚踝会提前上升）
    const toe = ["lt", "rt"].filter(n => ok(f, K[n])).map(n => f[K[n]][1]);
    out.toeY = toe.length ? Math.max(...toe) : out.ankleY;
    const lk = ok(f, K.lh) && ok(f, K.lk) ? tilt(f[K.lh], f[K.lk]) : NaN, rk = ok(f, K.rh) && ok(f, K.rk) ? tilt(f[K.rh], f[K.rk]) : NaN;
    out.thighL = isF(lk) ? 180 - Math.abs(lk) : NaN; out.thighR = isF(rk) ? 180 - Math.abs(rk) : NaN;   // 大腿抬起角：0 = 自然下垂，90 = 水平
    out.valgusL = valgus(f, "l"); out.valgusR = valgus(f, "r");
    out.pelvis = ok(f, K.lh) && ok(f, K.rh) ? Math.atan2(f[K.rh][1] - f[K.lh][1], Math.abs(f[K.rh][0] - f[K.lh][0]) || 1e-9) * DEG : NaN;
    out.hipX = ok(f, K.lh) && ok(f, K.rh) ? (f[K.lh][0] + f[K.rh][0]) / 2 : NaN;
    out.hipW = ok(f, K.lh) && ok(f, K.rh) ? Math.abs(f[K.lh][0] - f[K.rh][0]) : NaN;
    out.reliable = plausible(f, s, out);
    return out;
  }

  // ---------------- 去抖动：One-Euro 滤波（静止时平滑多、快速运动时延迟小） ----------------
  function OneEuro(minCutoff = 1.5, beta = 0.03, dCutoff = 1) {
    let x = null, dx = 0, t0 = null;
    const alpha = (cut, dt) => 1 / (1 + 1 / (2 * Math.PI * cut * dt));
    return {
      filter(v, t) {
        if (x == null || !isF(v)) { x = v; t0 = t; dx = 0; return v; }
        const dt = Math.max(1e-3, t - t0); t0 = t;
        const d = (v - x) / dt; dx = dx + alpha(dCutoff, dt) * (d - dx);
        x = x + alpha(minCutoff + beta * Math.abs(dx), dt) * (v - x);
        return x;
      },
      reset() { x = null; },
    };
  }
  function Smoother(opts = {}) {
    const fs = [];
    let lastT = -Infinity;
    return {
      push(f, t) {
        if (!f) return null;
        if (t - lastT > 0.5) fs.length = 0;          // 丢失超过 0.5 秒：重新开始
        lastT = t;
        return f.map((p, i) => {
          if (!p) return p;
          if (!fs[i]) fs[i] = [OneEuro(opts.minCutoff, opts.beta), OneEuro(opts.minCutoff, opts.beta)];
          if (p[2] != null && p[2] < TH.minVis) return p;
          return [fs[i][0].filter(p[0], t), fs[i][1].filter(p[1], t), p[2]];
        });
      },
    };
  }

  // ---------------- 次数计数：带滞回的状态机 ----------------
  // 信号低于 down 进入“下”，回到 up 以上算完成一次；时长不在 [minS, maxS] 内的当作噪声丢弃
  function RepCounter({ down, up, minS = 0.4, maxS = 10 }) {
    let state = "up", start = null, lowV = Infinity, lowT = null;
    return {
      get state() { return state; },
      push(v, t) {
        if (!isF(v)) return null;
        if (state === "up") { if (v > up) start = t; else if (v < down) { state = "down"; lowV = v; lowT = t; } return null; }
        if (v < lowV) { lowV = v; lowT = t; }
        if (v > up) {
          state = "up";
          const rep = { t0: start == null ? lowT : start, tLow: lowT, t1: t, low: lowV };
          start = t; lowV = Infinity;
          const dur = rep.t1 - rep.t0;
          return dur >= minS && dur <= maxS ? rep : null;
        }
        return null;
      },
    };
  }

  // ---------------- 训练动作 ----------------
  // 每个动作：拍摄方向、摆位说明、主信号、每次的指标、规则（错误 → 提示语）、关联原理（knowledge.js）
  const DRILLS = [
    { id: "squat", name: "深蹲", view: "side", setup: "手机横放或竖放，正侧面对着运动员，距离 2–3 米，高度约在髋部，全身入镜。",
      principles: ["torque", "balance", "overload"], unit: "次",
      cues: { shallow: "再蹲低一点，大腿至少到水平", lean: "胸口朝前，躯干和小腿尽量平行", heel: "全脚掌踩稳，重心在脚掌中部", hipfirst: "起立时胸和髋一起起来" } },
    { id: "squatFront", name: "深蹲·正面", view: "front", setup: "正对运动员，距离 2–3 米，高度约在膝部，看膝盖是否内扣。",
      principles: ["balance", "injury"], unit: "次",
      cues: { valgus: "膝盖对准脚尖方向，别往里扣" } },
    { id: "cmj", name: "反向纵跳", view: "any", setup: "侧面或正面均可，全身入镜，相机固定不动。双手叉腰，下蹲后尽力向上跳，落地缓冲。",
      principles: ["ssc", "impulse", "injury"], unit: "跳",
      cues: { stiff: "落地屈髋屈膝，像弹簧一样缓冲", valgus: "落地时膝盖对准脚尖" } },
    { id: "highknee", name: "原地高抬腿", view: "side", setup: "正侧面，距离 3 米，全身入镜。原地快速高抬腿 10 秒。",
      principles: ["impulse", "specificity"], unit: "步",
      cues: { low: "大腿抬到水平", back: "身体别后仰，略向前倾" } },
    { id: "balance", name: "单腿站立", view: "front", setup: "正对运动员，全身入镜。单腿站立，另一只脚离地，保持 10 秒以上。",
      principles: ["balance", "injury"], unit: "秒",
      cues: { pelvis: "支撑侧臀部发力，骨盆放平", sway: "稳住，眼睛看前方一个固定点", valgus: "支撑腿膝盖对准脚尖" } },
  ];

  // 一次训练的分析器：每帧 push(关键点, 秒)，随时 summary()
  function Session(drillId) {
    const D = DRILLS.find(d => d.id === drillId);
    if (!D) throw new Error("没有这个动作：" + drillId);
    const reps = [], log = [];
    let cue = "", cueT = -Infinity, frames = 0, seen = 0, viewBad = 0, viewN = 0, lockN = 0, lockT = -Infinity;
    const say = (key, t) => { const c = D.cues[key]; if (c && t - cueT > 1.2) { cue = c; cueT = t; } return c; };
    let cur = null;          // 当前这一次（下蹲中）的逐帧记录
    let st = {};             // 各动作自己的状态

    const handlers = {
      squat(F, t) {
        if (!st.rc) st.rc = RepCounter({ down: TH.squat.downKnee, up: TH.squat.upKnee, minS: TH.squat.minRepS, maxS: TH.squat.maxRepS });
        if (!isF(F.knee)) return;
        if (st.rc.state === "up" && F.knee > TH.squat.upKnee && isF(F.heelUp)) st.heelBase = st.heelBase == null ? F.heelUp : 0.9 * st.heelBase + 0.1 * F.heelUp;
        if (F.knee < TH.squat.upKnee) { if (!cur) cur = []; cur.push({ t, ...F }); }
        const r = st.rc.push(F.knee, t);
        if (r) {
          const fr = (cur || []).filter(x => x.t >= r.t0 && x.t <= r.t1);
          cur = null;
          if (!fr.length) return;
          const bottom = fr.reduce((b, x) => (x.knee < b.knee ? x : b));
          const faults = [];
          if (bottom.knee > TH.squat.shallowKnee && !bottom.hipBelowKnee) faults.push("shallow");
          if (isF(bottom.trunk) && isF(bottom.shin) && bottom.trunk - bottom.shin > TH.squat.leanOverShin) faults.push("lean");
          const heelMax = Math.max(...fr.map(x => x.heelUp).filter(isF));
          if (isF(heelMax) && st.heelBase != null && isF(bottom.legLen) && heelMax - st.heelBase > TH.squat.heelLift * bottom.legLen) faults.push("heel");
          // 起立前段（膝角打开 5–35°）：“躯干比小腿多前倾的角度”比最低点又大了 hipFirst 度 → 髋先起。
          // 不能只看躯干角：起立时小腿回正，躯干角本来就会变小，会把髋先起掩盖掉
          const gap = x => isF(x.trunk) && isF(x.shin) ? x.trunk - x.shin : NaN;
          const asc = fr.filter(x => x.t > bottom.t && x.knee - bottom.knee < 35 && x.knee - bottom.knee > 5).map(gap).filter(isF);
          if (asc.length && isF(gap(bottom)) && Math.max(...asc) - gap(bottom) > TH.squat.hipFirst) faults.push("hipfirst");
          const rep = { n: reps.length + 1, t: r.t1, knee: bottom.knee, hip: bottom.hip, trunk: bottom.trunk, shin: bottom.shin, full: bottom.hipBelowKnee,
            down: bottom.t - r.t0, up: r.t1 - bottom.t, faults };
          reps.push(rep);
          if (faults.length) say(faults[0], t); else { cue = "好，保持"; cueT = t; }
        }
      },
      squatFront(F, t) {
        if (!st.rc) st.rc = RepCounter({ down: TH.squat.downKnee + 15, up: TH.squat.upKnee + 5, minS: TH.squat.minRepS, maxS: TH.squat.maxRepS });
        // 正面拍摄时膝角被压扁，改用髋部下降量作为信号：换算成“伪膝角”
        if (!isF(F.hipY) || !isF(F.legLen)) return;
        if (st.rc.state === "up" && (st.standY == null || F.hipY < st.standY + 0.02 * F.legLen)) st.standY = st.standY == null ? F.hipY : Math.min(F.hipY, 0.95 * st.standY + 0.05 * F.hipY);
        const drop = (F.hipY - st.standY) / F.legLen;                 // 0 = 站直，约 0.45 = 大腿水平
        const pseudo = 180 - Math.min(1, drop / 0.45) * 90;
        if (pseudo < TH.squat.upKnee + 5) { if (!cur) cur = []; cur.push({ t, drop, ...F }); }
        const r = st.rc.push(pseudo, t);
        if (r) {
          const fr = (cur || []).filter(x => x.t >= r.t0 && x.t <= r.t1); cur = null;
          if (!fr.length) return;
          const vL = Math.max(...fr.map(x => x.valgusL).filter(isF)), vR = Math.max(...fr.map(x => x.valgusR).filter(isF));
          const faults = []; if (Math.max(vL, vR) > TH.squat.valgus) faults.push("valgus");
          reps.push({ n: reps.length + 1, t: r.t1, depth: Math.max(...fr.map(x => x.drop)), valgusL: vL, valgusR: vR, faults });
          if (faults.length) say(faults[0], t); else { cue = "膝盖稳，保持"; cueT = t; }
        }
      },
      cmj(F, t) {
        if (!isF(F.toeY) || !isF(F.legLen)) return;
        const L = F.legLen, lv = TH.cmj.back;
        // 在同一条阈值线上用线性插值找“离地”和“着地”时刻，两端误差对称
        const cross = (a, b) => a.t + (b.t - a.t) * Math.max(0, Math.min(1, (lv - a.rise) / ((b.rise - a.rise) || 1e-9)));
        if (st.mode == null) { st.mode = "ground"; st.hist = []; }
        if (st.mode === "ground") {
          // 站立基线：脚尖最低（y 最大）处；向下快跟、向上慢跟
          st.base = st.base == null ? F.toeY : (F.toeY > st.base ? 0.7 * st.base + 0.3 * F.toeY : 0.98 * st.base + 0.02 * F.toeY);
          const rise = (st.base - F.toeY) / L;
          st.hist.push({ t, rise }); if (st.hist.length > 12) st.hist.shift();
          if (rise > TH.cmj.leave) {
            const h = st.hist; let i = h.length - 1; while (i > 0 && h[i - 1].rise >= lv) i--;
            st.tOff = i > 0 ? cross(h[i - 1], h[i]) : h[i].t;
            st.mode = "air"; st.prev = { t, rise }; st.air = [{ t, rise }];
          }
        } else if (st.mode === "air") {
          const rise = (st.base - F.toeY) / L;
          if (rise >= lv) st.air.push({ t, rise });
          if (rise < lv) {
            const tOn = st.prev && st.prev.rise >= lv ? cross(st.prev, { t, rise }) : t;
            // 空中只受重力，脚尖轨迹是抛物线：拟合所有空中的点，求与地面（高度 0）的两个交点 = 真正的离地和着地时刻。
            // 比“阈值线插值”准：不受阈值线高度和帧率影响；拟合不可靠时退回插值
            const fit = parabolaRoots(st.air);
            const good = fit && Math.abs(fit[0] - st.tOff) < 0.08 && Math.abs(fit[1] - tOn) < 0.08;
            st.mode = "land"; st.tOn = good ? fit[1] : tOn; st.land = []; st.flight = good ? fit[1] - fit[0] : tOn - st.tOff; st.fitUsed = !!good;
          }
          st.prev = { t, rise };
          if (t - st.tOff > TH.cmj.maxFlightS + 0.5) { st.mode = "ground"; st.hist = []; }   // 很久没落地：多半是走出画面，重置
        } else if (st.mode === "land") {
          st.land.push(F);
          if (t - st.tOn >= TH.cmj.cushionS) {
            const fl = st.flight;
            st.mode = "ground"; st.hist = [];
            if (fl >= TH.cmj.minFlightS && fl <= TH.cmj.maxFlightS) {
              const kneeMin = Math.min(...st.land.map(x => x.knee).filter(isF));
              const vMax = Math.max(...st.land.flatMap(x => [x.valgusL, x.valgusR]).filter(isF));
              const faults = [];
              if (isF(kneeMin) && kneeMin > TH.cmj.stiffKnee) faults.push("stiff");
              if (isF(vMax) && isF(F.view) && F.view > TH.frontMinShoulderRatio && vMax > TH.squat.valgus) faults.push("valgus");
              const h = 9.81 * fl * fl / 8;
              reps.push({ n: reps.length + 1, t, flight: fl, height: h, landKnee: kneeMin, faults });
              if (faults.length) say(faults[0], t); else { cue = `${(h * 100).toFixed(0)} 厘米，落地很好`; cueT = t; }
            }
          }
        }
      },
      highknee(F, t) {
        for (const [s, th] of [["L", F.thighL], ["R", F.thighR]]) {
          if (!isF(th)) continue;
          const k = "up" + s;
          if (!st[k] && th > TH.highknee.thighUp) { st[k] = { peak: th }; }
          else if (st[k]) {
            st[k].peak = Math.max(st[k].peak, th);
            if (th < TH.highknee.thighDown) {
              const faults = [];
              // 一步只有约 0.3 秒，单步的最高点容易被丢帧和去抖削低：用同一条腿最近 3 步的中位数判断，偶尔一次测低不报
              const peaks = (st["pk" + s] = (st["pk" + s] || []).concat(st[k].peak).slice(-3));
              const med = peaks.slice().sort((a, b) => a - b)[Math.floor(peaks.length / 2)];
              if (peaks.length >= 2 && med < TH.highknee.targetThigh) faults.push("low");   // 至少 2 步才下判断
              if (isF(F.trunkSigned) && st.facing != null && -st.facing * F.trunkSigned > TH.highknee.backLean) faults.push("back");
              reps.push({ n: reps.length + 1, t, side: s, thigh: st[k].peak, faults });
              st[k] = null;
              if (faults.length) say(faults[0], t);
            }
          }
        }
        // 面朝方向：鼻子在肩的哪一侧（用于判断“后仰”）
        if (st.facing == null && isF(F.noseDx)) st.facing = Math.sign(F.noseDx);
      },
      balance(F, t) {
        if (!isF(F.ankleY) || !isF(F.hipX) || !isF(F.hipW)) return;
        st.lastF = F;
        const hold = F.oneLeg;
        if (hold) {
          if (!st.hold) st.hold = { t0: t, xs: [], tilts: [], valg: [] };
          const h = st.hold; h.xs.push(F.hipX / F.hipW); h.tilts.push(Math.abs(F.pelvis)); h.valg.push(F.stanceValgus);
          h.t1 = t;
          if (Math.abs(F.pelvis) > TH.balance.pelvisTilt) say("pelvis", t);
          else if (isF(F.stanceValgus) && F.stanceValgus > TH.balance.valgus) say("valgus", t);
          const recent = h.xs.slice(-30); if (recent.length > 10 && sd(recent) > TH.balance.swayWarn) say("sway", t);
        } else if (st.hold) {
          const h = st.hold; st.hold = null;
          const dur = h.t1 - h.t0;
          if (dur >= TH.balance.minHoldS) {
            const faults = [];
            const tilt = mean(h.tilts), sway = sd(h.xs), vg = Math.max(...h.valg.filter(isF));
            if (tilt > TH.balance.pelvisTilt) faults.push("pelvis");
            if (sway > TH.balance.swayWarn) faults.push("sway");
            if (isF(vg) && vg > TH.balance.valgus) faults.push("valgus");
            reps.push({ n: reps.length + 1, t, hold: dur, pelvis: tilt, sway, faults });
          }
        }
      },
    };

    return {
      drill: D,
      push(f, t) {
        frames++;
        if (!f) return this.status(t);
        const F = features(f);
        // 锁定：连续 lockFrames 帧都合理才开始计算；只露出半身时识别程序猜的骨架时好时坏，锁不住
        if (!F.reliable || t - lockT > 0.3) lockN = 0;
        if (F.reliable) { lockN++; lockT = t; }
        if (lockN < TH.body.lockFrames) { const st = this.status(t); st.viewMsg = F.reliable ? "正在锁定人体…" : "全身没有完整入镜（或姿势识别不可靠），这一帧不计算"; return st; }
        seen++;
        if (D.view !== "any") { const v = viewCheck(f, D.view); if (v.ok != null) { viewN++; if (!v.ok) viewBad++; } F.viewMsg = v.msg; }
        if (ok(f, K.nose) && ok(f, K.ls) && ok(f, K.rs)) F.noseDx = f[K.nose][0] - (f[K.ls][0] + f[K.rs][0]) / 2;
        // 单腿站立：两脚踝高度差超过 6% 腿长 = 一只脚离地；支撑腿 = 更低的那只
        if (ok(f, K.la) && ok(f, K.ra) && isF(F.legLen)) {
          const dy = f[K.la][1] - f[K.ra][1];
          F.oneLeg = Math.abs(dy) > 0.06 * F.legLen;
          F.stanceValgus = dy > 0 ? F.valgusL : F.valgusR;
        }
        handlers[D.id](F, t);
        log.push([t, F.knee, F.trunk]);
        return this.status(t, F);
      },
      status(t, F) {
        return { reps: reps.length, last: reps[reps.length - 1] || null, cue: t - cueT < 2.5 ? cue : "", features: F || null,
          viewMsg: F && F.viewMsg ? F.viewMsg : "", holding: !!(st.hold), holdS: st.hold ? st.hold.t1 - st.hold.t0 : 0, airborne: st.mode === "air" };
      },
      summary() {
        if (D.id === "balance" && st.hold && st.lastF) handlers.balance({ ...st.lastF, oneLeg: false }, st.hold.t1);   // 结束时还在单腿站：算完成一次
        const count = {}; reps.forEach(r => r.faults.forEach(k => { count[k] = (count[k] || 0) + 1; }));
        const faults = Object.entries(count).sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ key: k, n, cue: D.cues[k] }));
        const S = { drill: D.id, name: D.name, reps: reps.slice(), n: reps.length, faults, detectRate: frames ? seen / frames : 0, viewOkRate: viewN ? 1 - viewBad / viewN : null };
        const col = k => reps.map(r => r[k]).filter(isF);
        if (D.id === "squat" && reps.length) Object.assign(S, { kneeMean: mean(col("knee")), kneeSd: sd(col("knee")), trunkMean: mean(col("trunk")), tempoDown: mean(col("down")), tempoUp: mean(col("up")), fullRate: reps.filter(r => r.full).length / reps.length });
        if (D.id === "squatFront" && reps.length) Object.assign(S, { valgusMax: Math.max(...reps.map(r => Math.max(r.valgusL, r.valgusR)).filter(isF)) });
        if (D.id === "cmj" && reps.length) Object.assign(S, { heightBest: Math.max(...col("height")), heightMean: mean(col("height")), heightSd: sd(col("height")) });
        if (D.id === "highknee" && reps.length > 1) {
          const span = reps[reps.length - 1].t - reps[0].t;
          const nL = reps.filter(r => r.side === "L").length, nR = reps.length - nL;
          // 远侧腿看不清时只数到一条腿：按单腿频率 ×2
          const cad = span > 0 ? (reps.length - 1) / span * 60 * (nL && nR ? 1 : 2) : NaN;
          Object.assign(S, { cadence: cad, thighMean: mean(col("thigh")),
            thighL: mean(reps.filter(r => r.side === "L").map(r => r.thigh)), thighR: mean(reps.filter(r => r.side === "R").map(r => r.thigh)) });
        }
        if (D.id === "balance" && reps.length) Object.assign(S, { holdBest: Math.max(...col("hold")), pelvisMean: mean(col("pelvis")), swayMean: mean(col("sway")) });
        return S;
      },
    };
  }

  // 最小二乘拟合 y = a·t² + b·t + c（a < 0），返回 y = 0 的两个根；点太少或形状不对返回 null
  function parabolaRoots(pts) {
    if (!pts || pts.length < 5) return null;
    const t0 = pts[0].t; let S = [0, 0, 0, 0, 0], Y = [0, 0, 0];
    for (const p of pts) { const x = p.t - t0; let xp = 1; for (let k = 0; k < 5; k++) { S[k] += xp; if (k < 3) Y[k] += xp * p.rise; xp *= x; } }
    const M = [[S[4], S[3], S[2]], [S[3], S[2], S[1]], [S[2], S[1], S[0]]], R = [Y[2], Y[1], Y[0]];
    const det = m => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const D = det(M); if (!D) return null;
    const col = (i) => M.map((row, r) => row.map((v, c) => (c === i ? R[r] : v)));
    const a = det(col(0)) / D, b = det(col(1)) / D, c = det(col(2)) / D;
    const disc = b * b - 4 * a * c;
    if (!(a < 0) || disc <= 0) return null;
    const q = Math.sqrt(disc), r1 = (-b + q) / (2 * a), r2 = (-b - q) / (2 * a);
    return [t0 + Math.min(r1, r2), t0 + Math.max(r1, r2)];
  }

  // 跳高的测量误差：腾空时间两端各有约半帧的不确定，h = g·t²/8 ⇒ Δh ≈ g·t·Δt/4
  function jumpError(flightS, fps) { return 9.81 * flightS * (1 / fps) / 4; }

  // 保存到训练记录、导出表格时用的指标名
  const LABELS = {
    n: ["次数"], kneeMean: ["平均最低膝角", "°"], kneeSd: ["膝角波动", "°"], trunkMean: ["平均躯干前倾", "°"], tempoDown: ["下蹲用时（膝角 155° 到最低点）", "s"], tempoUp: ["起立用时（最低点到膝角 155°）", "s"],
    fullRate: ["蹲到位比例"], valgusMax: ["最大膝内扣"], heightBest: ["最好跳高", "m"], heightMean: ["平均跳高", "m"], heightSd: ["跳高波动", "m"],
    cadence: ["步频", "步/分"], thighMean: ["平均抬腿角", "°"], thighL: ["左腿抬腿角", "°"], thighR: ["右腿抬腿角", "°"],
    holdBest: ["最长保持", "s"], pelvisMean: ["平均骨盆倾斜", "°"], swayMean: ["晃动"], detectRate: ["识别率"], viewOkRate: ["视角合格率"],
  };

  // 实时模式能做什么、不能做什么（界面上原样展示）
  const LIMITS = [
    "角度来自 2D 画面：相机要垂直于动作平面（侧面动作拍正侧面），偏 30° 左右角度就会明显失真。界面会自动检查视角并提示。",
    "纵跳高度用腾空时间法（h = g·t²/8），起跳和落地时刻由空中轨迹的抛物线拟合得到：合成测试 30 帧/秒误差约 1 厘米，真实场景受关键点抖动影响会更大，建议同一条件下多跳几次看平均。",
    "短跑触地时间这种毫秒级指标实时测不准（30 帧每帧 0.033 秒），仍要用 240 帧慢动作视频分析。",
    "只露出半身时，识别程序会“猜”出看不见的腿，而且可见度不低：系统用人体比例、躯干角度和“连续 6 帧合理才锁定”来过滤，但不能保证完全排除，请让全身入镜。",
    "关键点会抖动：用 One-Euro 滤波去抖，代价是快速动作有 1–2 帧延迟；次数计数用滞回阈值，防止抖动误计。",
    "阈值是经验模板，不同身材（腿长、躯干长）的“标准动作”不一样，请教练校准，提示只作参考。",
    "一次最多给一条提示，避免信息过多干扰动作；训练结束看汇总再复盘。",
  ];

  const API = { K, TH, angle, tilt, features, viewRatio, viewCheck, valgus, OneEuro, Smoother, RepCounter, DRILLS, Session, jumpError, LABELS, LIMITS };
  if (typeof module !== "undefined" && module.exports) module.exports = API; else root.LIVE = API;
})(typeof window !== "undefined" ? window : globalThis);
