/* 知练 CoachMind 分析引擎（浏览器版）
   与 Python 版算法一致：姿态序列 → 指标 → 知识卡诊断。浏览器与 Node 均可运行。 */
(function (root) {
  "use strict";

  // ---------- 基础数学 ----------
  const isF = Number.isFinite;
  function median(a) { const v = a.filter(isF).sort((x, y) => x - y); if (!v.length) return NaN; const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; }
  function percentile(a, p) { const v = a.filter(isF).sort((x, y) => x - y); if (!v.length) return NaN; const k = (v.length - 1) * p / 100, f = Math.floor(k), c = Math.min(f + 1, v.length - 1); return v[f] + (v[c] - v[f]) * (k - f); }
  function mean(a) { const v = a.filter(isF); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN; }

  function fillNaN(x) {
    const y = Array.from(x), n = y.length, good = [];
    for (let i = 0; i < n; i++) if (isF(y[i])) good.push(i);
    if (good.length < 2) return y;
    let g = 0;
    for (let i = 0; i < n; i++) {
      if (isF(y[i])) continue;
      if (i < good[0]) { y[i] = x[good[0]]; continue; }
      if (i > good[good.length - 1]) { y[i] = x[good[good.length - 1]]; continue; }
      while (good[g + 1] < i) g++;
      const a = good[g], b = good[g + 1];
      y[i] = x[a] + (x[b] - x[a]) * (i - a) / (b - a);
    }
    return y;
  }

  // 四阶 Butterworth 低通（两个二阶节），零相位前后向滤波
  function biquads(fs, fc) {
    const K = Math.tan(Math.PI * Math.min(fc, fs * 0.49) / fs);
    return [0.54119610, 1.30656296].map(Q => {
      const norm = 1 / (1 + K / Q + K * K), b0 = K * K * norm;
      return { b0, b1: 2 * b0, b2: b0, a1: 2 * (K * K - 1) * norm, a2: (1 - K / Q + K * K) * norm };
    });
  }
  function runBiquad(x, s) {
    const y = new Array(x.length), c = x[0];
    let z2 = s.b2 * c - s.a2 * c, z1 = s.b1 * c - s.a1 * c + z2;   // 以首值为稳态初始化
    for (let i = 0; i < x.length; i++) {
      const out = s.b0 * x[i] + z1;
      z1 = s.b1 * x[i] - s.a1 * out + z2;
      z2 = s.b2 * x[i] - s.a2 * out;
      y[i] = out;
    }
    return y;
  }
  function lowpass(x, fs, fc) {
    let y = fillNaN(x);
    const n = y.length;
    if (n < 16 || !y.every(isF)) return y;
    const pad = Math.min(n - 1, Math.max(15, Math.round(fs / fc)));
    const ext = [];
    for (let i = pad; i >= 1; i--) ext.push(2 * y[0] - y[i]);
    ext.push(...y);
    for (let i = n - 2; i >= n - 1 - pad; i--) ext.push(2 * y[n - 1] - y[i]);
    let z = ext;
    for (const s of biquads(fs, fc)) z = runBiquad(z, s);
    z.reverse();
    for (const s of biquads(fs, fc)) z = runBiquad(z, s);
    z.reverse();
    return z.slice(pad, pad + n);
  }
  function derivative(x, fs) {
    const n = x.length, d = new Array(n);
    if (n < 2) return x.map(() => 0);
    d[0] = (x[1] - x[0]) * fs; d[n - 1] = (x[n - 1] - x[n - 2]) * fs;
    for (let i = 1; i < n - 1; i++) d[i] = (x[i + 1] - x[i - 1]) / 2 * fs;
    return d;
  }
  function angle(a, b, c) {
    const v1x = a[0] - b[0], v1y = a[1] - b[1], v2x = c[0] - b[0], v2y = c[1] - b[1];
    const cos = (v1x * v2x + v1y * v2y) / (Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y) + 1e-9);
    return Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
  }
  function segments(mask, minLen, maxGap) {
    const segs = []; let st = -1;
    for (let i = 0; i < mask.length; i++) {
      if (mask[i] && st < 0) st = i;
      else if (!mask[i] && st >= 0) { segs.push([st, i - 1]); st = -1; }
    }
    if (st >= 0) segs.push([st, mask.length - 1]);
    const merged = [];
    for (const s of segs) {
      if (merged.length && s[0] - merged[merged.length - 1][1] - 1 <= maxGap) merged[merged.length - 1][1] = s[1];
      else merged.push(s.slice());
    }
    return merged.filter(s => s[1] - s[0] + 1 >= minLen);
  }

  // ---------- 姿态索引 ----------
  const SIDES = {
    left: { shoulder: 11, elbow: 13, wrist: 15, hip: 23, knee: 25, ankle: 27, heel: 29, foot: 31 },
    right: { shoulder: 12, elbow: 14, wrist: 16, hip: 24, knee: 26, ankle: 28, heel: 30, foot: 32 },
  };
  const SKELETON = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [27, 29], [29, 31], [27, 31], [24, 26], [26, 28], [28, 30], [30, 32], [28, 32]];

  // pose: 数组，每帧为 33×[x,y,vis] 或 null
  const col = (pose, j, k) => pose.map(f => (f && f[j] ? f[j][k] : NaN));
  const pt = (pose, j) => pose.map(f => (f && f[j] ? [f[j][0], f[j][1]] : [NaN, NaN]));
  function smooth2(xs, ys, fs, fc) { return [lowpass(xs, fs, fc), lowpass(ys, fs, fc)]; }

  // ---------- 左右腿纠正 ----------
  // 侧面拍摄时 MediaPipe 常把左右腿标签互换。逐帧比较“保持”和“互换”哪个更接近上一帧的位置，选更近的。
  const LEG_PAIRS = [[25, 26], [27, 28], [29, 30], [31, 32]];
  function unswapLegs(pose) {
    const out = pose.map(f => (f ? f.map(p => p.slice()) : null));
    let prev = null, swaps = 0;
    for (let t = 0; t < out.length; t++) {
      const f = out[t];
      if (!f) continue;
      if (prev) {
        let keep = 0, swap = 0;
        for (const [l, r] of LEG_PAIRS) {
          keep += Math.hypot(f[l][0] - prev[l][0], f[l][1] - prev[l][1]) + Math.hypot(f[r][0] - prev[r][0], f[r][1] - prev[r][1]);
          swap += Math.hypot(f[r][0] - prev[l][0], f[r][1] - prev[l][1]) + Math.hypot(f[l][0] - prev[r][0], f[l][1] - prev[r][1]);
        }
        if (swap < keep * 0.6) {
          for (const [l, r] of LEG_PAIRS) { const tmp = f[l]; f[l] = f[r]; f[r] = tmp; }
          swaps++;
        }
      }
      prev = f;
    }
    return { pose: out, swaps };
  }

  // ---------- 短跑 ----------
  function refine(tx, ty, seg, tolX, tolY, pad) {
    const [s, e] = seg, q = Math.floor((e - s) / 4), c0 = s + q, c1 = e - q;
    const xs = median(tx.slice(c0, c1 + 1)), ys = median(ty.slice(c0, c1 + 1));
    const ok = i => Math.abs(tx[i] - xs) < tolX && Math.abs(ty[i] - ys) < tolY;
    let td = c0; while (td - 1 >= Math.max(0, s - pad) && ok(td - 1)) td--;
    let to = c1; while (to + 1 <= Math.min(tx.length - 1, e + pad) && ok(to + 1)) to++;
    while (td < c0 && !ok(td)) td++;
    return [td, to];
  }

  function sprintBase(pose, fs, c) {
    const hx0 = col(pose, 23, 0).map((v, i) => (v + col(pose, 24, 0)[i]) / 2);
    const hy0 = col(pose, 23, 1).map((v, i) => (v + col(pose, 24, 1)[i]) / 2);
    const [hx] = smooth2(hx0, hy0, fs, c.filter_hz);
    const hvx = derivative(hx, fs);
    return { hx, runSpeed: median(hvx.map(Math.abs)), dir: median(hvx) >= 0 ? 1 : -1 };
  }

  function detectSprintContacts(pose, fs, c, base) {
    const n = pose.length, contacts = [], debug = {};
    for (const side of ["left", "right"]) {
      const S = SIDES[side];
      const [tx, ty] = smooth2(col(pose, S.foot, 0), col(pose, S.foot, 1), fs, c.foot_filter_hz);
      const vx = derivative(lowpass(tx, fs, c.filter_hz), fs).map(Math.abs);
      const groundY = percentile(ty, 95);
      const legLen = median(pose.map(f => f ? Math.hypot(f[S.hip][0] - f[S.ankle][0], f[S.hip][1] - f[S.ankle][1]) : NaN));
      const nearY = groundY - c.ground_band_leg_ratio * legLen, slowV = c.stance_speed_ratio * base.runSpeed;
      const mask = ty.map((y, i) => y > nearY && vx[i] < slowV);
      debug[side] = { ty, vx, groundY, nearY, slowV };
      const minLen = Math.max(2, Math.round(c.min_contact_s * fs)), gap = Math.round(c.merge_gap_s * fs), pad = Math.round(0.03 * fs);
      for (const seg of segments(mask, minLen, gap)) {
        if (seg[0] === 0 || seg[1] === n - 1) continue;
        const [td, to] = refine(tx, ty, seg, c.refine_tol_x_leg_ratio * legLen, c.refine_tol_y_leg_ratio * legLen, pad);
        if (to - td + 1 >= minLen && td > 0 && to < n - 1) contacts.push({ side, td, to });
      }
    }
    contacts.sort((a, b) => a.td - b.td);
    return { contacts, debug };
  }

  // 由触地列表（自动识别或教练手动标记）计算全部指标

  // 触地识别（不受镜头移动影响）：支撑脚处在“局部最低点”且竖直方向几乎不动。
  // 镜头左右跟拍、人斜着跑导致地面线在画面里变化，这个方法都不受影响。
  function detectContactsVertical(pose, fs, c) {
    const n = pose.length, contacts = [];
    const win = Math.max(3, Math.round(0.35 * fs));
    for (const side of ["left", "right"]) {
      const S = SIDES[side];
      const lowY = pose.map(f => f ? Math.max(f[S.heel][1], f[S.foot][1], f[S.ankle][1]) : NaN);
      const y = lowpass(lowY, fs, Math.min(c.foot_filter_hz, fs / 4));
      const vy = derivative(y, fs).map(Math.abs);
      const legLen = median(pose.map(f => f ? Math.hypot(f[S.hip][0] - f[S.ankle][0], f[S.hip][1] - f[S.ankle][1]) : NaN));
      if (!isF(legLen) || legLen <= 0) continue;
      const g = y.map((_, i) => { let m = -Infinity; for (let k = Math.max(0, i - win); k <= Math.min(n - 1, i + win); k++) if (isF(y[k]) && y[k] > m) m = y[k]; return m; });
      const band = 0.07 * legLen, vmax = 1.6 * legLen;               // 离局部地面 7% 腿长以内、竖直速度小于 1.6 腿长/秒
      const mask = y.map((v, i) => isF(v) && v > g[i] - band && vy[i] < vmax);
      const minLen = Math.max(2, Math.round(0.05 * fs));
      for (const [td, to] of segments(mask, minLen, Math.round(0.02 * fs))) {
        if (td === 0 || to === n - 1) continue;
        const dur = (to - td + 1) / fs;
        if (dur > 0.45) continue;                                      // 太长：站立、起跑器预备姿势，不算跑步触地
        contacts.push({ side, td, to });
      }
    }
    contacts.sort((a, b) => a.td - b.td);
    return contacts;
  }
  // 结果可信度：触地时间在合理范围、左右脚交替出现的次数
  function contactScore(cs, fs) {
    let s = 0;
    cs.forEach((ct, k) => { const d = (ct.to - ct.td + 1) / fs; if (d >= 0.06 && d <= 0.35) s += 1; if (k && cs[k - 1].side !== ct.side) s += 0.5; });
    return s;
  }

  function sprintFromContacts(pose, fs, TH, scale, contacts, base) {
    base = base || sprintBase(pose, fs, TH.sprint);
    const { hx, runSpeed, dir } = base;
    contacts = contacts.slice().sort((a, b) => a.td - b.td);
    const steps = [];
    contacts.forEach((ct, k) => {
      const S = SIDES[ct.side], f = pose[ct.td], { td, to } = ct;
      const toe = pt(pose, S.foot);
      const st = { side: ct.side, touchdown_frame: td, toeoff_frame: to, contact_time_s: r4((to - td + 1) / fs) };
      if (f) {
        st.knee_angle_td_deg = r1(angle(f[S.hip], f[S.knee], f[S.ankle]));
        const sh = [(f[11][0] + f[12][0]) / 2, (f[11][1] + f[12][1]) / 2], hp = [(f[23][0] + f[24][0]) / 2, (f[23][1] + f[24][1]) / 2];
        st.trunk_lean_td_deg = r1(Math.atan2((sh[0] - hp[0]) * dir, hp[1] - sh[1]) * 180 / Math.PI);
      }
      if (scale && isF(toe[td][0]) && isF(hx[td])) st.touchdown_distance_m = r3((toe[td][0] - hx[td]) * dir * scale);
      const nx = contacts[k + 1];
      if (nx && nx.side !== ct.side && nx.td > to) {
        st.flight_time_s = r4((nx.td - to - 1) / fs);
        st.step_time_s = r4((nx.td - td) / fs);
        st.step_frequency_hz = r3(fs / (nx.td - td));
        if (scale) {
          const a = mean(toe.slice(td, to + 1).map(p => p[0]));
          const b = mean(pt(pose, SIDES[nx.side].foot).slice(nx.td, nx.to + 1).map(p => p[0]));
          if (isF(a) && isF(b)) { st.step_length_m = r3(Math.abs(b - a) * scale); st.speed_mps = r2(st.step_length_m * st.step_frequency_hz); }
        }
      }
      steps.push(st);
    });
    const summary = {};
    for (const key of ["contact_time_s", "flight_time_s", "step_frequency_hz", "step_length_m", "speed_mps", "touchdown_distance_m", "trunk_lean_td_deg", "knee_angle_td_deg"]) {
      const v = steps.map(s => s[key]).filter(isF);
      if (v.length) summary[key] = r4(mean(v));
    }
    const L = steps.filter(s => s.side === "left").map(s => s.contact_time_s), R = steps.filter(s => s.side === "right").map(s => s.contact_time_s);
    if (L.length && R.length) { const l = mean(L), r = mean(R); summary.contact_asymmetry_pct = r1(Math.abs(l - r) / ((l + r) / 2) * 100); }
    summary.n_contacts = steps.length;
    if (scale && isF(runSpeed)) summary.hip_speed_mps = r2(runSpeed * scale);
    const notes = [];
    if (!scale) notes.push("未标定比例尺，步长、速度、着地距离未计算。");
    return { action: "sprint", fps: fs, steps, summary, notes, series: { hipX: hx } };
  }


  // 步频（摆腿周期法）：两踝前后距离每一步变号一次。脚看不清、触地识别失败时也能得到节奏。
  function cadenceFromLegSwing(pose, fs, c) {
    const d0 = pose.map(f => f ? f[SIDES.left.ankle][0] - f[SIDES.right.ankle][0] : NaN);
    if (d0.filter(isF).length < fs * 0.4) return null;
    const d = lowpass(d0, fs, 8);
    const legLen = median(pose.map(f => f ? Math.hypot(f[23][0] - f[27][0], f[23][1] - f[27][1]) : NaN));
    const hyst = 0.15 * legLen;
    const cross = [];
    let state = 0;
    for (let i = 0; i < d.length; i++) {
      if (!isF(d[i])) continue;
      if (state >= 0 && d[i] < -hyst) { if (state > 0) cross.push(i); state = -1; }
      else if (state <= 0 && d[i] > hyst) { if (state < 0) cross.push(i); state = 1; }
    }
    if (cross.length < 3) return null;
    const hz = (cross.length - 1) / ((cross[cross.length - 1] - cross[0]) / fs);
    return { hz: r3(hz), steps: cross.length, frames: cross };
  }

  function analyzeSprint(pose, fs, TH, scale) {
    const fixed = unswapLegs(pose);
    const base = sprintBase(fixed.pose, fs, TH.sprint);
    const det = detectSprintContacts(fixed.pose, fs, TH.sprint, base);
    const vcs = detectContactsVertical(fixed.pose, fs, TH.sprint);
    // 两种方法都跑，取更可信的：固定机位时水平法更精确；跟拍、斜向时竖直法更稳
    const useV = contactScore(vcs, fs) > contactScore(det.contacts, fs) + 0.5;
    const r = sprintFromContacts(fixed.pose, fs, TH, scale, useV ? vcs : det.contacts, base);
    r.contactMethod = useV ? "vertical" : "horizontal";
    if (useV) r.notes.unshift("检测到镜头在移动或人斜向跑动，已改用“最低点静止”方法识别触地；步长和着地距离在跟拍镜头下不可靠，已隐藏。");
    if (useV) { for (const k of ["step_length_m", "speed_mps", "touchdown_distance_m", "hip_speed_mps"]) delete r.summary[k]; r.steps.forEach(s => { delete s.step_length_m; delete s.speed_mps; delete s.touchdown_distance_m; }); }
    r.debug = det.debug; r.legSwaps = fixed.swaps; r.pose = fixed.pose;
    const cd = cadenceFromLegSwing(fixed.pose, fs, TH.sprint);
    if (cd) { r.summary.cadence_swing_hz = cd.hz; r.summary.cadence_spm = Math.round(cd.hz * 60); r.cadenceFrames = cd.frames; }
    if (r.steps.length < 2 && cd) r.notes.unshift(`脚的落点看不清，已改用摆腿周期测出步频 ${cd.hz.toFixed(2)} 步/秒（${Math.round(cd.hz * 60)} 步/分钟）。`);
    if (fs < 100) r.notes.unshift(`视频只有 ${Math.round(fs)} 帧/秒：每帧间隔 ${Math.round(1000 / fs)} 毫秒，而触地只有约 100 毫秒，触地时间、腾空时间、左右差异只能参考，诊断规则会自动放宽。请用 240 帧慢动作复测。`);
    if (r.steps.length < 2) r.notes.unshift("自动识别到的触地少于 2 次。常见原因：人太小（请用“选择运动员”框住他）、脚被遮挡、视频帧率太低。");
    return r;
  }


  // ---------- 通用动作分析：骨骼 + 关节角度 + 跳跃检测 ----------
  // 跳跃高度 = g·t²/8（腾空时间法，要求起跳和落地姿势相近；机位必须固定）
  function analyzeGeneral(pose, fs, TH) {
    const c = TH.general, n = pose.length;
    const fixed = unswapLegs(pose), P = fixed.pose;
    const vis = s => mean(P.map(f => f ? (f[SIDES[s].hip][2] + f[SIDES[s].knee][2] + f[SIDES[s].elbow][2]) / 3 : NaN));
    const side = (isF(vis("left")) ? vis("left") : -1) >= (isF(vis("right")) ? vis("right") : -1) ? "left" : "right";
    const S = SIDES[side];
    const J = k => { const p = pt(P, S[k]); return [lowpass(p.map(q => q[0]), fs, c.filter_hz), lowpass(p.map(q => q[1]), fs, c.filter_hz)]; };
    const sh = J("shoulder"), hp = J("hip"), kn = J("knee"), an = J("ankle"), el = J("elbow"), wr = J("wrist");
    const at = (A, i) => [A[0][i], A[1][i]];
    const knee = [], hip = [], elbow = [], shoulder = [], trunk = [];
    for (let i = 0; i < n; i++) {
      knee.push(angle(at(hp, i), at(kn, i), at(an, i)));
      hip.push(angle(at(sh, i), at(hp, i), at(kn, i)));
      elbow.push(angle(at(sh, i), at(el, i), at(wr, i)));
      shoulder.push(angle(at(hp, i), at(sh, i), at(el, i)));
      trunk.push(Math.abs(Math.atan2(sh[0][i] - hp[0][i], hp[1][i] - sh[1][i]) * 180 / Math.PI));
    }
    // 最低的脚（图像 y 最大）
    const footIdx = [27, 28, 29, 30, 31, 32];
    const lowRaw = P.map(f => f ? Math.max(...footIdx.map(j => f[j][1]).filter(isF)) : NaN);
    const low = lowpass(lowRaw, fs, c.foot_filter_hz);
    const bodyH = median(P.map(f => f ? Math.max(...footIdx.map(j => f[j][1]).filter(isF)) - f[0][1] : NaN));
    const ground = percentile(low, c.ground_percentile);
    const band = c.air_band_body_ratio * bodyH;
    const air = low.map(y => isF(y) && y < ground - band);
    const minAir = Math.max(2, Math.round(c.min_flight_s * fs));
    const jumps = [];
    const fine = c.touch_band_body_ratio * bodyH;                      // 精修：脚离开地面几像素即算离地
    for (let [s0, s1] of segments(air, minAir, Math.round(0.01 * fs))) {
      while (s0 > 0 && isF(low[s0 - 1]) && low[s0 - 1] < ground - fine) s0--;
      while (s1 < n - 1 && isF(low[s1 + 1]) && low[s1 + 1] < ground - fine) s1++;
      if (s0 === 0 || s1 === n - 1) continue;                        // 起跳或落地被截断
      // 腾空时间：空中只受重力，脚的轨迹是抛物线。拟合明显离地的点（未滤波），求与地面的两个交点。
      // 比“离地阈值线”准：不受阈值高度和帧率影响（30 fps 时阈值法最多偏低约 4 cm）；拟合不可靠时退回阈值法
      let t = (s1 - s0 + 1) / fs, fitted = false;
      const pts = []; for (let i = s0; i <= s1; i++) if (isF(lowRaw[i]) && lowRaw[i] < ground - band) pts.push([i / fs, ground - lowRaw[i]]);
      const roots = parabolaRoots(pts);
      if (roots && Math.abs(roots[0] - s0 / fs) < 2.5 / fs && Math.abs(roots[1] - (s1 + 1) / fs) < 2.5 / fs) { t = roots[1] - roots[0]; fitted = true; }
      const pre = knee.slice(Math.max(0, s0 - Math.round(0.6 * fs)), s0).filter(isF);
      const post = knee.slice(s1 + 1, Math.min(n, s1 + 1 + Math.round(0.35 * fs))).filter(isF);
      const armPeak = Math.max(...shoulder.slice(s0, s1 + 1).filter(isF));
      jumps.push({ takeoff: s0, landing: s1 + 1, flight_s: r3(t), height_cm: r1(9.81 * t * t / 8 * 100), fitted,
        knee_min_pre_deg: pre.length ? r1(Math.min(...pre)) : null, knee_takeoff_deg: r1(knee[s0 - 1]),
        knee_landing_min_deg: post.length ? r1(Math.min(...post)) : null, arm_peak_deg: isF(armPeak) ? r1(armPeak) : null });
    }
    const best = jumps.slice().sort((a, b) => b.height_cm - a.height_cm)[0];
    const fmin = a => { const v = a.filter(isF); return v.length ? r1(Math.min(...v)) : null; };
    const fmax = a => { const v = a.filter(isF); return v.length ? r1(Math.max(...v)) : null; };
    const summary = {};
    if (best) Object.assign(summary, { jump_height_cm: best.height_cm, flight_time_s: best.flight_s, jump_fitted: best.fitted, knee_min_pre_deg: best.knee_min_pre_deg,
      knee_takeoff_deg: best.knee_takeoff_deg, landing_knee_min_deg: best.knee_landing_min_deg, arm_peak_deg: best.arm_peak_deg });
    Object.assign(summary, { n_jumps: jumps.length, knee_min_deg: fmin(knee), hip_min_deg: fmin(hip), elbow_min_deg: fmin(elbow), trunk_lean_max_deg: fmax(trunk), side_analyzed: side === "left" ? "左" : "右" });
    const notes = [];
    if (!jumps.length) notes.push("没有检测到腾空。如果动作里有起跳，请确认机位固定、双脚在画面内。");
    if (jumps.length) notes.push("跳跃高度按腾空时间计算（g·t²/8），要求起跳和落地时身体姿势相近；落地时屈膝更多会让结果偏高。");
    return { action: "general", fps: fs, summary, notes, jumps, legSwaps: fixed.swaps, pose: P,
      series: { knee, hip, elbow, shoulder, trunk, air } };
  }

  // 最小二乘拟合 y = a·t² + b·t + c（a < 0，开口向下），返回 y = 0 的两个根；点太少或形状不对返回 null
  function parabolaRoots(pts) {
    if (!pts || pts.length < 5) return null;
    const t0 = pts[0][0], S = [0, 0, 0, 0, 0], Y = [0, 0, 0];
    for (const [tt, y] of pts) { const x = tt - t0; let xp = 1; for (let k = 0; k < 5; k++) { S[k] += xp; if (k < 3) Y[k] += xp * y; xp *= x; } }
    const M = [[S[4], S[3], S[2]], [S[3], S[2], S[1]], [S[2], S[1], S[0]]], R = [Y[2], Y[1], Y[0]];
    const det = m => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const D = det(M); if (!D) return null;
    const col = i => M.map((row, r) => row.map((v, cc) => (cc === i ? R[r] : v)));
    const a = det(col(0)) / D, b = det(col(1)) / D, c = det(col(2)) / D, disc = b * b - 4 * a * c;
    if (!(a < 0) || disc <= 0) return null;
    const q = Math.sqrt(disc), r1_ = (-b + q) / (2 * a), r2_ = (-b - q) / (2 * a);
    return [t0 + Math.min(r1_, r2_), t0 + Math.max(r1_, r2_)];
  }

  // ---------- 测量误差 ----------
  // 每个指标的误差估计：帧率决定的部分（每帧 1/fps）+ 方法本身的偏差（合成数据审查得到）+ 关键点抖动（经验值）。
  // 诊断规则只有在“超出阈值的部分 > 误差”时才下结论，落在误差范围内的标为“边缘，建议复测”。
  function uncertainty(result) {
    const fs = isF(result.fps) && result.fps > 0 ? result.fps : 30, fr = 1 / fs, s = result.summary || {}, u = {};   // 帧率未知：按 30 帧保守估计，绝不当作“没有误差”
    if (result.action === "sprint") {
      const k = result.contactMethod === "vertical" ? 2 : 1;             // 跟拍/斜向用的“最低点静止”法边界更模糊
      u.contact_time_s = k * fr + 0.006;                                 // 0.006 s：240 fps 合成数据上的系统偏差
      u.flight_time_s = k * fr + 0.006;
      if (isF(s.contact_time_s) && s.contact_time_s > 0) u.contact_asymmetry_pct = 100 * k * fr / s.contact_time_s;
      // 着地距离：着地时刻差 1 帧，髋就前移了“速度 / 帧率”（10 m/s、240 fps 时约 4 cm），再加关键点抖动约 2 cm
      const v = isF(s.hip_speed_mps) ? s.hip_speed_mps : isF(s.speed_mps) ? s.speed_mps : 9;
      u.touchdown_distance_m = k * v * fr + 0.02;
      u.trunk_lean_td_deg = 3; u.knee_angle_td_deg = 4;                 // 关键点抖动（经验值）
    } else if (result.action === "clean") {
      u.min_elbow_angle_first_pull_deg = 5; u.hip_angle_at_peak_velocity_deg = 5; u.bar_forward_max_m = 0.02;
    } else if (result.action === "general") {
      u.landing_knee_min_deg = 5; u.knee_min_pre_deg = 5;
      if (isF(s.flight_time_s)) u.jump_height_cm = 9.81 * s.flight_time_s * (s.jump_fitted ? 0.5 : 1) * fr / 4 * 100 + 0.5;
    }
    return u;
  }

  // ---------- 高翻：杠铃片模板跟踪（归一化互相关） ----------
  class PlateTracker {
    // gray: Uint8Array（宽 w 高 h）；cx,cy,r 为同一坐标系像素
    constructor(gray, w, h, cx, cy, r) {
      this.w = w; this.h = h; this.r = r;
      this.half = Math.max(6, Math.round(r * 0.95));   // 只取杠铃片圆内像素，避免背景拖住跟踪
      this.search = Math.max(6, Math.round(r * 0.2));   // 配合匀速预测，搜索窗口可以小
      this.vx = 0; this.vy = 0;
      this.step = this.half > 24 ? 2 : 1;
      this.x = cx; this.y = cy;
      this.tpl = this._patch(gray, cx, cy);
      this.lastScore = 1;
    }
    _patch(gray, cx, cy) {
      // 双线性采样，支持亚像素位置（避免模板更新时的量化漂移）
      const s = this.half, st = this.step, out = [], W = this.w, H = this.h;
      for (let dy = -s; dy <= s; dy += st) for (let dx = -s; dx <= s; dx += st) {
        if (dx * dx + dy * dy > s * s) continue;
        const x = Math.min(W - 1.001, Math.max(0, cx + dx)), y = Math.min(H - 1.001, Math.max(0, cy + dy));
        const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, i = y0 * W + x0;
        out.push((gray[i] * (1 - fx) + gray[i + 1] * fx) * (1 - fy) + (gray[i + W] * (1 - fx) + gray[i + W + 1] * fx) * fy);
      }
      const m = out.reduce((a, b) => a + b, 0) / out.length;
      let ss = 0; for (let i = 0; i < out.length; i++) { out[i] -= m; ss += out[i] * out[i]; }
      return { v: Float32Array.from(out), norm: Math.sqrt(ss) + 1e-6 };
    }
    _ncc(gray, cx, cy) {
      const p = this._patch(gray, cx, cy), t = this.tpl;
      let s = 0; for (let i = 0; i < t.v.length; i++) s += t.v[i] * p.v[i];
      return s / (t.norm * p.norm);
    }
    update(gray) {
      const px = this.x, py = this.y;
      const x0 = Math.round(this.x + this.vx), y0 = Math.round(this.y + this.vy), R = this.search;
      let best = -2, bx = x0, by = y0;
      const scores = new Map();
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        const s = this._ncc(gray, x0 + dx, y0 + dy);
        scores.set(dx + "," + dy, s);
        if (s > best) { best = s; bx = x0 + dx; by = y0 + dy; }
      }
      // 亚像素：抛物线插值
      const sub = (m, c, p) => { const d = m - 2 * c + p; return Math.abs(d) < 1e-9 ? 0 : Math.max(-0.5, Math.min(0.5, 0.5 * (m - p) / d)); };
      const g = (dx, dy) => scores.get((bx - x0 + dx) + "," + (by - y0 + dy));
      const cx = g(0, 0), l = g(-1, 0), r = g(1, 0), u = g(0, -1), d = g(0, 1);
      this.x = bx + (l !== undefined && r !== undefined ? sub(l, cx, r) : 0);
      this.y = by + (u !== undefined && d !== undefined ? sub(u, cx, d) : 0);
      this.lastScore = best;
      if (best > 0.3) { this.vx = 0.7 * (this.x - px) + 0.3 * this.vx; this.vy = 0.7 * (this.y - py) + 0.3 * this.vy; }
      if (best > 0.75) {                                  // 模板缓慢更新，适应杠铃片转动和光照
        const p = this._patch(gray, this.x, this.y), t = this.tpl.v;
        let ss = 0; for (let i = 0; i < t.length; i++) { t[i] = 0.9 * t[i] + 0.1 * p.v[i]; ss += t[i] * t[i]; }
        this.tpl.norm = Math.sqrt(ss) + 1e-6;
      }
      return best > 0.3 ? [this.x, this.y] : [NaN, NaN];
    }
  }

  function pickSide(pose) {
    const vis = s => mean(pose.map(f => f ? (f[SIDES[s].hip][2] + f[SIDES[s].knee][2] + f[SIDES[s].elbow][2]) / 3 : NaN));
    const l = vis("left"), r = vis("right");
    return (isF(l) ? l : -1) >= (isF(r) ? r : -1) ? "left" : "right";
  }

  function analyzeClean(bar, fs, scale, TH, pose) {
    const c = TH.clean;
    const x = lowpass(bar.map(p => p[0]), fs, c.filter_hz), y = lowpass(bar.map(p => p[1]), fs, c.filter_hz);
    const h = y.map(v => (y[0] - v) * scale), dxRaw = x.map(v => (v - x[0]) * scale), vy = derivative(h, fs);
    const notes = [];
    const lo = h.findIndex(v => v > c.liftoff_threshold_m);
    if (lo < 0) return { action: "clean", fps: fs, summary: {}, notes: ["未检测到杠铃离地，请检查杠铃片标定点。"], series: {}, events: {} };
    const argmax = (a, s, e) => { let b = s; for (let i = s; i <= e; i++) if (a[i] > a[b]) b = i; return b; };
    const argmin = (a, s, e) => { let b = s; for (let i = s; i <= e; i++) if (a[i] < a[b]) b = i; return b; };
    const n = h.length, pk = argmax(vy, lo, n - 1), top = argmax(h, pk, n - 1);
    let cat = -1, fell = false;
    for (let i = top; i < n; i++) { if (vy[i] < -c.catch_drop_speed) fell = true; if (fell && vy[i] > -c.catch_stop_speed) { cat = i; break; } }
    if (cat < 0) { cat = top < n - 1 ? argmin(h, top, n - 1) : top; notes.push("接杠点不明显（可能是力量翻或视频截断），按最高点后最低位估计。"); }

    let facing = 1, side = null;
    if (pose) {
      side = pickSide(pose);
      const S = SIDES[side];
      const toe = median(pose.slice(0, lo + 1).map(f => f ? f[S.foot][0] : NaN)), heel = median(pose.slice(0, lo + 1).map(f => f ? f[S.heel][0] : NaN));
      if (isF(toe) && isF(heel)) facing = toe >= heel ? 1 : -1;
    }
    const dx = dxRaw.map(v => v * facing), seg = dx.slice(lo, cat + 1);
    const summary = {
      peak_bar_velocity_mps: r3(vy[pk]), max_bar_height_m: r3(h[top]), catch_height_m: r3(h[cat]),
      drop_under_m: r3(h[top] - h[cat]), bar_forward_max_m: r3(Math.max(...seg)),
      bar_backward_max_m: r3(Math.max(0, -Math.min(...seg))), bar_x_at_catch_m: r3(dx[cat]),
      pull_time_s: r3((pk - lo) / fs), time_to_catch_s: r3((cat - pk) / fs),
    };
    if (pose) {
      const S = SIDES[side], P = k => { const p = pt(pose, S[k]); return [fillNaN(p.map(q => q[0])), fillNaN(p.map(q => q[1]))]; };
      const A = (a, b, cc) => { const [ax, ay] = P(a), [bx, by] = P(b), [cx, cy] = P(cc); return ax.map((_, i) => angle([ax[i], ay[i]], [bx[i], by[i]], [cx[i], cy[i]])); };
      const hip = A("shoulder", "hip", "knee"), knee = A("hip", "knee", "ankle"), elbow = A("shoulder", "elbow", "wrist");
      const win = Math.max(1, Math.round(0.03 * fs));
      let fp = lo; while (fp < pk && vy[fp] <= 0.6 * vy[pk]) fp++;
      Object.assign(summary, {
        side_analyzed: side === "left" ? "左" : "右",
        hip_angle_at_peak_velocity_deg: r1(Math.max(...hip.slice(Math.max(0, pk - win), pk + win + 1).filter(isF))),
        knee_angle_at_liftoff_deg: r1(knee[lo]), knee_angle_at_catch_deg: r1(knee[cat]),
        min_elbow_angle_first_pull_deg: r1(Math.min(...elbow.slice(lo, Math.max(lo + 1, fp)).filter(isF))),
      });
      summary.hip_ext_to_peak_velocity_ms = r1((argmax(hip, lo, top) - pk) / fs * 1000);
    } else notes.push("未提供姿态数据，只输出杠铃指标。");
    return { action: "clean", fps: fs, summary, notes, events: { liftoff: lo, peak_velocity: pk, top, catch: cat }, series: { h, dx, vy, barX: x, barY: y } };
  }

  // ---------- 知识卡 ----------
  const OPS = { ">": (a, b) => a > b, "<": (a, b) => a < b, ">=": (a, b) => a >= b, "<=": (a, b) => a <= b };
  // 返回“确认的问题”数组；数组的 borderline 属性里是“边缘结果”（在测量误差内、或样本太少），只提示复测，不当作问题
  const MIN_CONTACTS = 4;
  function matchCards(result, TH, CARDS) {
    const th = TH[result.action], hits = [], borderline = [], U = uncertainty(result);
    for (const card of CARDS.cards) {
      if (card.action !== result.action) continue;
      const m = card.condition.metric, v = result.summary[m], t = th[card.condition.threshold];
      if (!isF(v) || !isF(t)) continue;
      const u = U[m] || 0, op = card.condition.op, up = op === ">" || op === ">=";
      const sure = up ? v > t + u : v < t - u;                       // 超出阈值的部分大于误差
      const maybe = !sure && (up ? v > t - u : v < t + u);           // 在误差范围内
      const unit = (LABELS[m] || ["", ""])[1];
      const info = Object.assign({}, card, { value: v, threshold_value: t, uncertainty: u,
        symptom_text: card.symptom.replace("{value}", fmt(v, unit) + (u ? `（±${fmt(u, unit)}）` : "")).replace("{threshold}", t) });
      const fewSteps = result.action === "sprint" && !(result.summary.n_contacts >= MIN_CONTACTS);
      if (sure && !fewSteps) hits.push(info);
      else if (sure || maybe) borderline.push(Object.assign(info, { reason: fewSteps && sure ? `只识别到 ${result.summary.n_contacts || 0} 次触地，少于 ${MIN_CONTACTS} 次` : "在测量误差范围内" }));
    }
    hits.borderline = borderline;
    return hits;
  }

  const LABELS = {
    contact_time_s: ["触地时间", "s"], flight_time_s: ["腾空时间", "s"], step_frequency_hz: ["步频", "步/s"],
    step_length_m: ["步长", "m"], speed_mps: ["速度", "m/s"], hip_speed_mps: ["髋部水平速度", "m/s"],
    touchdown_distance_m: ["着地距离", "m"], trunk_lean_td_deg: ["触地时躯干前倾", "°"], knee_angle_td_deg: ["触地时膝角", "°"],
    contact_asymmetry_pct: ["左右触地差异", "%"], n_contacts: ["识别触地", "次"],
    peak_bar_velocity_mps: ["杠铃最大速度", "m/s"], max_bar_height_m: ["杠铃最大高度", "m"], catch_height_m: ["接杠高度", "m"],
    drop_under_m: ["下蹲接杠距离", "m"], bar_forward_max_m: ["杠铃最大前移", "m"], bar_backward_max_m: ["杠铃最大后移", "m"],
    bar_x_at_catch_m: ["接杠时水平位移", "m"], pull_time_s: ["离地到最大速度", "s"], time_to_catch_s: ["最大速度到接杠", "s"],
    hip_angle_at_peak_velocity_deg: ["最大速度时髋角", "°"], knee_angle_at_liftoff_deg: ["离地时膝角", "°"],
    knee_angle_at_catch_deg: ["接杠时膝角", "°"], min_elbow_angle_first_pull_deg: ["第一次拉最小肘角", "°"],
    hip_ext_to_peak_velocity_ms: ["最大伸髋相对杠铃峰速", "ms"], side_analyzed: ["分析侧", ""],
    cadence_swing_hz: ["步频（摆腿周期法）", "步/s"], cadence_spm: ["步频", "步/分"],
    jump_height_cm: ["跳跃高度", "cm"], flight_time_s: ["腾空时间", "s"], knee_min_pre_deg: ["起跳前最小膝角", "°"], knee_takeoff_deg: ["离地时膝角", "°"],
    landing_knee_min_deg: ["落地缓冲最小膝角", "°"], arm_peak_deg: ["腾空中手臂最大上举", "°"], n_jumps: ["检测到跳跃", "次"],
    knee_min_deg: ["全程最小膝角", "°"], hip_min_deg: ["全程最小髋角", "°"], elbow_min_deg: ["全程最小肘角", "°"], trunk_lean_max_deg: ["躯干最大倾斜", "°"],
  };
  function fmt(v, unit) {
    if (typeof v !== "number") return String(v);
    if (Number.isInteger(v)) return String(v);
    return unit === "°" || unit === "%" || unit === "ms" || unit === "cm" ? v.toFixed(1) : unit === "s" ? v.toFixed(3) : v.toFixed(2);
  }

  function r1(v) { return Math.round(v * 10) / 10; } function r2(v) { return Math.round(v * 100) / 100; }
  function r3(v) { return Math.round(v * 1000) / 1000; } function r4(v) { return Math.round(v * 10000) / 10000; }

  const API = { median, percentile, lowpass, derivative, angle, segments, fillNaN, SIDES, SKELETON,
    analyzeSprint, analyzeGeneral, cadenceFromLegSwing, detectContactsVertical, sprintFromContacts, sprintBase, unswapLegs, analyzeClean, PlateTracker, matchCards, uncertainty, parabolaRoots, LABELS, fmt, PLATE_DIAMETER_M: 0.45 };
  if (typeof module !== "undefined" && module.exports) module.exports = API; else root.CM = API;
})(typeof self !== "undefined" ? self : this);
