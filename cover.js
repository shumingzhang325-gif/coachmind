/* 知练封面：粒子运动员（黑色舞台 · 金色粒子 · 长曝光拖影）
   开场：粒子从黑暗中聚成“知练”，再流动成奔跑的运动员。全部实时绘制，不依赖图片与外部库。 */
(function (root) {
  "use strict";
  const TAU = Math.PI * 2;
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  // ---------------- 奔跑步态（正向运动学，单位 = 身高） ----------------
  const SEG = { thigh: 0.245, shank: 0.246, foot: 0.09, trunk: 0.30, neck: 0.07, head: 0.06, upper: 0.186, fore: 0.16 };
  function legAngles(p) {                            // p：步态相位 0–1；0 = 触地
    const thigh = 22 + 48 * Math.sin(TAU * (p + 0.13));          // 大腿与竖直线夹角（向前为正）
    const swing = Math.max(0, Math.sin(TAU * (p - 0.12)));        // 摆动期屈膝
    const knee = 18 + 122 * Math.pow(swing, 1.3) + 10 * Math.max(0, Math.sin(TAU * p * 2)) * (p < 0.2 ? 1 : 0);
    const ankle = 8 + 22 * swing;
    return { thigh, knee, ankle };
  }
  function runnerPose(phase, lean = 10) {
    phase = ((1 - phase) % 1 + 1) % 1;                // 步态时间方向：支撑脚从身体前方扫向后方（修正“倒着跑”）
    const P = {};
    const r = d => d * Math.PI / 180;
    const legs = {};
    for (const [side, off] of [["near", 0], ["far", 0.5]]) {
      const a = legAngles((phase + off) % 1);
      const knee = [Math.sin(r(a.thigh)) * SEG.thigh, -Math.cos(r(a.thigh)) * SEG.thigh];
      const sh = r(a.thigh - a.knee);
      const ank = [knee[0] + Math.sin(sh) * SEG.shank, knee[1] - Math.cos(sh) * SEG.shank];
      const ft = r(a.thigh - a.knee + 90 - a.ankle);
      const toe = [ank[0] + Math.sin(ft) * SEG.foot, ank[1] - Math.cos(ft) * SEG.foot];
      legs[side] = { knee, ank, toe };
    }
    const low = Math.min(legs.near.ank[1], legs.near.toe[1], legs.far.ank[1], legs.far.toe[1]);
    const hipY = -low;                                 // 最低的脚刚好踩在地上
    const sh = [Math.sin(r(lean)) * SEG.trunk, hipY + Math.cos(r(lean)) * SEG.trunk];
    const head = [sh[0] + Math.sin(r(lean + 6)) * (SEG.neck + SEG.head), sh[1] + Math.cos(r(lean + 6)) * (SEG.neck + SEG.head)];
    P.hip = [0, hipY]; P.sh = sh; P.head = head;
    for (const side of ["near", "far"]) {
      const L = legs[side];
      P[side + "Knee"] = [L.knee[0], L.knee[1] + hipY]; P[side + "Ank"] = [L.ank[0], L.ank[1] + hipY]; P[side + "Toe"] = [L.toe[0], L.toe[1] + hipY];
      const armPh = side === "near" ? phase + 0.5 : phase;   // 手臂与同侧腿反向
      const s = 58 * Math.sin(TAU * (armPh + 0.13));
      const el = [sh[0] + Math.sin(r(s)) * SEG.upper, sh[1] - Math.cos(r(s)) * SEG.upper];
      const f = r(s + 70 + 25 * Math.sin(TAU * armPh));
      P[side + "Elb"] = el; P[side + "Wri"] = [el[0] + Math.sin(f) * SEG.fore, el[1] - Math.cos(f) * SEG.fore];
    }
    return P;
  }
  const STRIDE_PER_CYCLE = (() => {
    let sum = 0, n = 0, prev = null;
    for (let p = 0; p < 1; p += 0.002) {
      const P = runnerPose(p);
      const st = ["near", "far"].map(k => ({ k, y: Math.min(P[k + "Toe"][1], P[k + "Ank"][1]), x: P[k + "Toe"][0] })).sort((a, b) => a.y - b.y)[0];
      if (st.y < 0.012 && prev && prev.k === st.k && prev.x > st.x) { sum += prev.x - st.x; n++; }
      prev = st.y < 0.012 ? st : null;
    }
    return n ? (sum / n) / 0.002 : 3;                  // 触地时脚相对髋部的平均后移速度（身高/周期）
  })();
  const RUN_BONES = [["hip", "sh"], ["sh", "head"], ["hip", "nearKnee"], ["nearKnee", "nearAnk"], ["nearAnk", "nearToe"], ["hip", "farKnee"], ["farKnee", "farAnk"], ["farAnk", "farToe"],
    ["sh", "nearElb"], ["nearElb", "nearWri"], ["sh", "farElb"], ["farElb", "farWri"]];

  // ---------------- 高翻关键帧（侧面，面向右，单位 = 身高，y 向上） ----------------
  const K = [
    { t: 0.00, name: "预备", ank: [0, 0.03], heel: [-0.04, 0.0], toe: [0.13, 0.0], knee: [0.10, 0.22], hip: [-0.15, 0.33], sh: [0.09, 0.50], head: [0.17, 0.57], elb: [0.09, 0.32], bar: [0.06, 0.13] },
    { t: 0.60, name: "预备", ank: [0, 0.03], heel: [-0.04, 0.0], toe: [0.13, 0.0], knee: [0.10, 0.22], hip: [-0.15, 0.33], sh: [0.09, 0.50], head: [0.17, 0.57], elb: [0.09, 0.32], bar: [0.06, 0.13] },
    { t: 1.10, name: "第一次拉", ank: [0, 0.03], heel: [-0.04, 0.0], toe: [0.13, 0.0], knee: [0.03, 0.245], hip: [-0.14, 0.45], sh: [0.10, 0.65], head: [0.17, 0.73], elb: [0.09, 0.47], bar: [0.06, 0.30] },
    { t: 1.35, name: "发力位", ank: [0, 0.03], heel: [-0.04, 0.0], toe: [0.13, 0.0], knee: [0.07, 0.235], hip: [-0.09, 0.44], sh: [0.03, 0.73], head: [0.09, 0.82], elb: [0.04, 0.56], bar: [0.04, 0.40] },
    { t: 1.52, name: "三关节伸展", ank: [0.02, 0.07], heel: [-0.02, 0.06], toe: [0.13, 0.0], knee: [0.04, 0.31], hip: [0.0, 0.55], sh: [-0.03, 0.85], head: [-0.01, 0.95], elb: [0.0, 0.69], bar: [0.05, 0.55] },
    { t: 1.72, name: "下蹲翻腕", ank: [0, 0.03], heel: [-0.04, 0.0], toe: [0.13, 0.0], knee: [0.11, 0.22], hip: [-0.10, 0.40], sh: [-0.01, 0.69], head: [0.05, 0.78], elb: [0.13, 0.62], bar: [0.08, 0.64] },
    { t: 1.95, name: "接杠", ank: [0, 0.03], heel: [-0.04, 0.0], toe: [0.13, 0.0], knee: [0.17, 0.18], hip: [-0.10, 0.26], sh: [-0.02, 0.55], head: [0.04, 0.64], elb: [0.15, 0.55], bar: [0.06, 0.56] },
    { t: 2.40, name: "接杠", ank: [0, 0.03], heel: [-0.04, 0.0], toe: [0.13, 0.0], knee: [0.17, 0.18], hip: [-0.10, 0.26], sh: [-0.02, 0.55], head: [0.04, 0.64], elb: [0.15, 0.55], bar: [0.06, 0.56] },
    { t: 3.30, name: "站起", ank: [0, 0.03], heel: [-0.04, 0.0], toe: [0.13, 0.0], knee: [0.02, 0.26], hip: [-0.02, 0.50], sh: [0.0, 0.80], head: [0.03, 0.90], elb: [0.14, 0.77], bar: [0.06, 0.80] },
    { t: 4.30, name: "站起", ank: [0, 0.03], heel: [-0.04, 0.0], toe: [0.13, 0.0], knee: [0.02, 0.26], hip: [-0.02, 0.50], sh: [0.0, 0.80], head: [0.03, 0.90], elb: [0.14, 0.77], bar: [0.06, 0.80] },
  ];
  const LIFT_T = 5.0;
  const LIFT_JOINTS = ["ank", "heel", "toe", "knee", "hip", "sh", "head", "elb", "bar"];
  function liftPose(t) {
    t = Math.min(t, K[K.length - 1].t);
    let i = 0; while (i < K.length - 2 && K[i + 1].t < t) i++;
    const a = K[i], b = K[i + 1], u = ease(clamp((t - a.t) / (b.t - a.t || 1), 0, 1));
    const P = { phase: u < 0.5 ? a.name : b.name };
    for (const j of LIFT_JOINTS) P[j] = [lerp(a[j][0], b[j][0], u), lerp(a[j][1], b[j][1], u)];
    return P;
  }
  const LIFT_BONES = [["toe", "ank"], ["heel", "ank"], ["heel", "toe"], ["ank", "knee"], ["knee", "hip"], ["hip", "sh"], ["sh", "head"], ["sh", "elb"], ["elb", "bar"]];


  // ---------------- 身体模型：由关节生成粒子目标点 ----------------
  // [起点, 终点, 半径(身高单位), 亮度]
  const RUN_BODY = [["sh", "hip", 0.062, 1], ["hip", "nearKnee", 0.048, 1], ["nearKnee", "nearAnk", 0.034, 1], ["nearAnk", "nearToe", 0.018, 1],
    ["hip", "farKnee", 0.046, 0.55], ["farKnee", "farAnk", 0.032, 0.55], ["farAnk", "farToe", 0.017, 0.55],
    ["sh", "nearElb", 0.03, 1], ["nearElb", "nearWri", 0.024, 1], ["sh", "farElb", 0.028, 0.55], ["farElb", "farWri", 0.022, 0.55], ["sh", "head", 0.02, 1]];
  const LIFT_BODY = [["sh", "hip", 0.064, 1], ["hip", "knee", 0.05, 1], ["knee", "ank", 0.036, 1], ["heel", "toe", 0.018, 1], ["sh", "elb", 0.03, 1], ["elb", "bar", 0.025, 1], ["sh", "head", 0.02, 1]];
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  function sprite(r, core, glow) {
    const c = document.createElement("canvas"); c.width = c.height = r * 2;
    const g = c.getContext("2d"), gr = g.createRadialGradient(r, r, 0, r, r, r);
    gr.addColorStop(0, core); gr.addColorStop(0.35, glow); gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr; g.fillRect(0, 0, r * 2, r * 2); return c;
  }
  function textPoints(text, w, h) {
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const g = c.getContext("2d");
    const fs = Math.min(w * 0.36, h * 0.3);
    g.fillStyle = "#fff"; g.textAlign = "center"; g.textBaseline = "middle";
    g.font = `700 ${fs}px "Songti SC","STSong","Noto Serif SC",serif`;
    g.fillText(text, w / 2, h * 0.46);
    const d = g.getImageData(0, 0, w, h).data, pts = [], step = Math.max(2, Math.round(fs / 70));
    for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) if (d[(y * w + x) * 4 + 3] > 128) pts.push([x, y]);
    return pts;
  }

  class Cover {
    constructor(canvas, opts = {}) {
      this.c = canvas; this.g = canvas.getContext("2d");
      this.world = opts.world || "sprint";
      this.reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
      this.intro = !!opts.intro && !this.reduced;
      this.onIntroDone = opts.onIntroDone || (() => {});
      this.visible = true; this.running = false;
      this.dotGold = sprite(12, "rgba(255,244,214,1)", "rgba(228,201,139,0.55)");
      this.dotDim = sprite(10, "rgba(228,201,139,0.9)", "rgba(201,164,92,0.25)");
      this.resize();
      addEventListener("resize", () => this.resize());
      document.addEventListener("visibilitychange", () => this.kick());
      if ("IntersectionObserver" in window) new IntersectionObserver(es => { this.visible = es[0].isIntersecting; this.kick(); }).observe(canvas);
      this.t0 = performance.now();
    }
    resize() {
      const dpr = Math.min(2, window.devicePixelRatio || 1), r = this.c.getBoundingClientRect();
      this.dpr = dpr; this.w = Math.max(1, r.width); this.h = Math.max(1, r.height);
      this.c.width = Math.round(this.w * dpr); this.c.height = Math.round(this.h * dpr);
      this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.round(clamp(this.w * this.h / 120, 1100, 3200));
      if (!this.ps || this.ps.length !== count) this.build(count);
      this.textPts = textPoints("知练", Math.round(this.w), Math.round(this.h));
      this.dust = [...Array(90)].map(() => ({ x: rnd() * this.w, y: rnd() * this.h, s: 0.3 + rnd() * 1.2, v: 0.2 + rnd() * 0.8 }));
      this.g.fillStyle = "#050506"; this.g.fillRect(0, 0, this.w, this.h);
      if (this.reduced) this.frame(performance.now());
    }
    build(count) {
      this.ps = [...Array(count)].map((_, i) => ({ k: rnd(), u: rnd(), a: rnd() * TAU, r: Math.sqrt(rnd()), x: rnd() * this.w, y: rnd() * this.h,
        tw: rnd() * TAU, s: 0.5 + rnd() * 0.9, delay: rnd() * 0.5, ti: Math.floor(rnd() * 1e6) }));
    }
    setWorld(w) { if (w !== this.world) { this.world = w; this.morphT = performance.now(); } }
    start() { this.running = true; this.kick(); }
    kick() {
      if (this.reduced) { this.frame(performance.now()); return; }
      if (this.raf || !this.running || document.hidden || !this.visible) return;
      const loop = ts => { this.raf = null; if (!this.running || document.hidden || !this.visible) return; this.frame(ts); this.raf = requestAnimationFrame(loop); };
      this.raf = requestAnimationFrame(loop);
    }
    // 当前身体的目标点
    bodyTargets(t) {
      const W = this.w, H = this.h;
      const sprint = this.world === "sprint";
      const size = Math.min(H * (sprint ? 0.36 : 0.38), W * 0.66);
      const ox = W * 0.5, oy = H * (sprint ? 0.55 : 0.57);
      const P = sprint ? runnerPose((t * 1.05) % 1) : liftPose(t % LIFT_T);
      const segs = sprint ? RUN_BODY : LIFT_BODY;
      const map = p => [ox + (sprint ? -0.05 : -0.04) * size + p[0] * size, oy - p[1] * size];
      return { P, segs, map, size, head: map(P.head), bar: sprint ? null : map(P.bar), ground: oy };
    }
    frame(ts) {
      const g = this.g, W = this.w, H = this.h, t = (ts - this.t0) / 1000;
      // 长曝光拖影：不完全清屏
      g.globalCompositeOperation = "source-over";
      g.fillStyle = this.reduced ? "#050506" : "rgba(5,5,6,0.34)"; g.fillRect(0, 0, W, H);
      const B = this.bodyTargets(this.reduced ? 0.3 : t);
      // 舞台：地面光带 + 分道线 / 举重台
      const gy = B.ground;
      const halo = g.createRadialGradient(W / 2, gy, 0, W / 2, gy, W * 0.6);
      halo.addColorStop(0, "rgba(201,164,92,0.10)"); halo.addColorStop(1, "rgba(201,164,92,0)");
      g.fillStyle = halo; g.fillRect(0, gy - H * 0.25, W, H * 0.5);
      g.strokeStyle = "rgba(201,164,92,0.28)"; g.lineWidth = 1;
      g.beginPath(); g.moveTo(W * 0.08, gy + 1); g.lineTo(W * 0.92, gy + 1); g.stroke();
      if (this.world === "sprint") {
        g.strokeStyle = "rgba(201,164,92,0.10)";
        for (let k = 1; k <= 3; k++) { const yy = gy + k * k * 7; g.beginPath(); g.moveTo(0, yy); g.lineTo(W, yy); g.stroke(); }
      }
      // 漂浮的金尘（短跑时向左流动，表现速度）
      g.globalCompositeOperation = "lighter";
      for (const d of this.dust) {
        if (!this.reduced) { d.x -= (this.world === "sprint" ? 2.2 : 0.25) * d.v; d.y -= this.world === "sprint" ? 0 : 0.15 * d.v; }
        if (d.x < -5) d.x = W + 5; if (d.y < -5) d.y = H + 5;
        g.globalAlpha = 0.25 * d.s; g.drawImage(this.dotDim, d.x - 3, d.y - 3, 6, 6);
      }
      // 粒子目标：开场先是“知练”，然后变成运动员
      const introT = this.intro ? t : 99;
      const toBody = clamp((introT - 2.0) / 1.1, 0, 1);
      const segs = B.segs, pts = this.textPts, nseg = segs.length;
      const headR = 0.052 * B.size;
      for (const p of this.ps) {
        // 身体上的位置
        let bx, by, bri = 1;
        if (p.k < 0.1) { bx = B.head[0] + Math.cos(p.a) * p.r * headR; by = B.head[1] + Math.sin(p.a) * p.r * headR; }
        else if (B.bar && p.k < 0.2) { const R = 0.128 * B.size, rr = R * (0.82 + 0.18 * p.r); bx = B.bar[0] + Math.cos(p.a) * rr; by = B.bar[1] + Math.sin(p.a) * rr; }
        else {
          const sg = segs[Math.floor(p.u * nseg) % nseg], A = B.map(B.P[sg[0]]), C = B.map(B.P[sg[1]]);
          const v = (p.u * nseg) % 1, dx = C[0] - A[0], dy = C[1] - A[1], L = Math.hypot(dx, dy) || 1;
          const halo = p.k > 0.82;                                   // 约 18% 的粒子游离在身体外围，形成光晕
          const w = sg[2] * B.size * (p.r * 2 - 1) * (halo ? 2.6 : 1);
          if (halo) bri *= 0.45;
          bx = A[0] + dx * v - dy / L * w; by = A[1] + dy * v + dx / L * w; bri = sg[3];
        }
        let tx = bx, ty = by;
        if (toBody < 1) {
          const q = pts.length ? pts[p.ti % pts.length] : [W / 2, H / 2];
          const gather = ease(clamp((introT - p.delay * 0.8) / 1.2, 0, 1));
          const sx = lerp(p.x0 ?? (p.x0 = p.x), q[0], gather), sy = lerp(p.y0 ?? (p.y0 = p.y), q[1], gather);
          const m = ease(clamp(toBody * 1.4 - p.delay * 0.5, 0, 1));
          tx = lerp(sx, bx, m); ty = lerp(sy, by, m);
          p.x = tx; p.y = ty;
        } else {
          const k = this.reduced ? 1 : 0.35;
          p.x += (tx - p.x) * k; p.y += (ty - p.y) * k;
        }
        const tw = 0.55 + 0.45 * Math.sin(p.tw + t * 2.6);
        const jx = this.reduced ? 0 : Math.sin(p.tw * 7 + t * 4) * 0.8, jy = this.reduced ? 0 : Math.cos(p.tw * 5 + t * 3.4) * 0.8;
        const sz = (0.9 + p.s * 1.3) * (bri < 0.9 ? 0.85 : 1);
        g.globalAlpha = clamp(0.36 * tw * bri + 0.06, 0, 1);
        g.drawImage(bri < 0.9 ? this.dotDim : this.dotGold, p.x + jx - sz, p.y + jy - sz, sz * 2, sz * 2);
      }
      g.globalAlpha = 1; g.globalCompositeOperation = "source-over";
      if (this.intro && !this.introDone && introT > 3.2) { this.introDone = true; this.onIntroDone(); }
    }
  }
  root.Cover = Cover;
  root.COVER_POSE = { runnerPose, liftPose, STRIDE_PER_CYCLE };
})(typeof self !== "undefined" ? self : this);
