/* 知练封面：连续摄影（chronophotography）
   两个场地：夜场跑道（短跑）、举重台（高翻）。全部由 Canvas 实时绘制，不依赖任何图片或外部库。 */
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

  // ---------------- 工具 ----------------
  function grain(w, h, alpha) {
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const g = c.getContext("2d"), img = g.createImageData(w, h);
    for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = alpha * Math.random(); }
    g.putImageData(img, 0, 0); return c;
  }
  let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  class Cover {
    constructor(canvas, opts = {}) {
      this.c = canvas; this.g = canvas.getContext("2d");
      this.world = opts.world || "sprint";
      this.reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
      this.running = false; this.visible = true; this.t0 = performance.now(); this.fade = 1;
      this.noise = grain(160, 160, 26);
      this.crowd = [...Array(260)].map(() => ({ x: rnd(), y: rnd(), r: 0.4 + rnd() * 1.1, tw: rnd() * TAU }));
      this.dust = [...Array(90)].map(() => ({ x: rnd(), y: rnd(), v: 0.004 + rnd() * 0.012, r: 0.5 + rnd() * 1.6, d: rnd() * TAU }));
      this.resize();
      addEventListener("resize", () => this.resize());
      document.addEventListener("visibilitychange", () => this.kick());
      if ("IntersectionObserver" in window) new IntersectionObserver(es => { this.visible = es[0].isIntersecting; this.kick(); }).observe(canvas);
    }
    setWorld(w) { if (w === this.world) return; this.world = w; this.t0 = performance.now(); this.fade = 0; this.trail = null; if (this.reduced) this.frame(this.t0); }
    resize() {
      const dpr = Math.min(2, window.devicePixelRatio || 1), r = this.c.getBoundingClientRect();
      this.w = Math.max(1, r.width); this.h = Math.max(1, r.height);
      this.c.width = Math.round(this.w * dpr); this.c.height = Math.round(this.h * dpr);
      this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.frame(performance.now());
    }
    start() { this.running = true; this.kick(); }
    kick() {
      if (this.reduced) { this.frame(performance.now(), true); return; }
      if (this.raf || !this.running || document.hidden || !this.visible) return;
      const loop = ts => { this.raf = null; if (!this.running || document.hidden || !this.visible) return; this.frame(ts); this.raf = requestAnimationFrame(loop); };
      this.raf = requestAnimationFrame(loop);
    }
    frame(ts, still) {
      const t = (ts - this.t0) / 1000;
      this.fade = Math.min(1, this.fade + 0.06);
      if (this.world === "sprint") this.sprint(still ? 1.35 : t, !!still);
      else this.lift(still ? 2.0 : t, !!still);
      if (this.fade < 1) { this.g.fillStyle = `rgba(4,8,12,${1 - this.fade})`; this.g.fillRect(0, 0, this.w, this.h); }
    }

    // ---------- 共用：骨骼 ----------
    bones(P, list, map, alpha, width, joints) {
      const g = this.g;
      g.lineCap = "round"; g.lineJoin = "round";
      g.strokeStyle = `rgba(244,247,250,${alpha})`; g.lineWidth = width;
      g.beginPath();
      for (const [a, b] of list) { const A = map(P[a]), B = map(P[b]); g.moveTo(A[0], A[1]); g.lineTo(B[0], B[1]); }
      g.stroke();
      if (joints) {
        g.fillStyle = `rgba(201,164,92,${alpha})`;
        for (const k of Object.keys(P)) { if (!Array.isArray(P[k])) continue; const A = map(P[k]); g.beginPath(); g.arc(A[0], A[1], width * 0.95, 0, TAU); g.fill(); }
      }
    }
    headCircle(P, map, alpha, H, width) {
      const A = map(P.head); this.g.strokeStyle = `rgba(244,247,250,${alpha})`; this.g.lineWidth = width;
      this.g.beginPath(); this.g.arc(A[0], A[1], H * 0.045, 0, TAU); this.g.stroke();
    }

    // ---------- 夜场跑道 ----------
    sprint(t, still) {
      const g = this.g, W = this.w, Hh = this.h;
      const horizon = Hh * 0.36, ground = Hh * 0.66;
      const H = Math.min(Hh * 0.40, W * 0.55);                  // 人物身高（像素）
      const cad = 1.35;                                          // 步态周期/秒（画面放慢，便于看清）
      const speed = H * STRIDE_PER_CYCLE * cad;                  // 与支撑脚后扫速度一致，脚不打滑
      // 夜空
      let gr = g.createLinearGradient(0, 0, 0, horizon);
      gr.addColorStop(0, "#050C15"); gr.addColorStop(1, "#0F2236");
      g.fillStyle = gr; g.fillRect(0, 0, W, horizon);
      // 灯塔：细灯杆 + 灯组，光晕和斜向光束
      for (const [fx, dir] of [[0.24, 1], [0.8, -1]]) {
        const lx = W * fx, ly = horizon * 0.42;
        const rg = g.createRadialGradient(lx, ly, 0, lx, ly, W * 0.7);
        rg.addColorStop(0, "rgba(225,238,255,0.45)"); rg.addColorStop(0.06, "rgba(170,200,235,0.18)"); rg.addColorStop(1, "rgba(20,40,70,0)");
        g.fillStyle = rg; g.fillRect(0, 0, W, horizon + 60);
        g.save(); g.globalAlpha = 0.07; g.fillStyle = "#DDEBFF";
        g.beginPath(); g.moveTo(lx, ly); g.lineTo(lx + dir * W * 0.9, horizon + (Hh - horizon) * 0.3); g.lineTo(lx + dir * W * 0.55, Hh); g.closePath(); g.fill(); g.restore();
        g.strokeStyle = "rgba(120,140,165,0.5)"; g.lineWidth = 1.5; g.beginPath(); g.moveTo(lx, ly + 10); g.lineTo(lx, horizon - Hh * 0.1); g.stroke();
        g.fillStyle = "rgba(255,255,255,0.95)";
        for (let k = 0; k < 12; k++) { g.beginPath(); g.arc(lx - 11 + (k % 4) * 7.3, ly - 6 + Math.floor(k / 4) * 6, 2.1, 0, TAU); g.fill(); }
      }
      // 看台（视差）
      const standTop = horizon - Hh * 0.13;
      g.fillStyle = "#08121C"; g.fillRect(0, standTop, W, horizon - standTop);
      const par = (t * speed * 0.08) % W;
      for (const p of this.crowd) {
        const x = ((p.x * W * 1.5 - par) % (W * 1.5) + W * 1.5) % (W * 1.5) - W * 0.25, y = standTop + p.y * (horizon - standTop - 4);
        const a = 0.18 + 0.25 * (0.5 + 0.5 * Math.sin(p.tw + t * 1.3));
        g.fillStyle = `rgba(200,220,245,${a})`; g.fillRect(x, y, p.r, p.r);
      }
      // 跑道（向前方收窄的分道）
      gr = g.createLinearGradient(0, horizon, 0, Hh);
      gr.addColorStop(0, "#5E2317"); gr.addColorStop(0.45, "#A93A28"); gr.addColorStop(1, "#7A2A1D");
      g.fillStyle = gr; g.fillRect(0, horizon, W, Hh - horizon);
      g.save(); g.globalAlpha = 0.5; g.fillStyle = g.createPattern(this.noise, "repeat"); g.fillRect(0, horizon, W, Hh - horizon); g.restore();
      const lanes = [0, 0.08, 0.2, 0.38, 0.62, 0.95, 1.4];
      g.strokeStyle = "rgba(233,228,218,0.85)";
      lanes.forEach((f, i) => { const y = horizon + (Hh - horizon) * f; g.lineWidth = 0.8 + i * 0.7; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); });
      // 场地标记（随运动员前进向左移动）
      const scroll = t * speed;
      const mk = H * 1.6;
      g.fillStyle = "rgba(233,228,218,0.8)";
      for (let x = -((scroll) % mk); x < W; x += mk) {
        const y0 = horizon + (Hh - horizon) * 0.38, y1 = horizon + (Hh - horizon) * 0.62;
        g.fillRect(x, y0 + (y1 - y0) * 0.45, H * 0.16, 2.5);
      }
      // 人物：机位跟随，人物固定在 58% 宽度
      const rx = W * 0.6;
      const map = P => [rx + P[0] * H, ground - P[1] * H];
      const phase = (t * cad) % 1;
      // 地面阴影与光晕
      const sg = g.createRadialGradient(rx, ground + 4, 0, rx, ground + 4, H * 0.5);
      sg.addColorStop(0, "rgba(0,0,0,0.45)"); sg.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = sg; g.fillRect(rx - H * 0.6, ground - 10, H * 1.2, 30);
      // 多重曝光：过去的姿态按真实位移留在身后
      const exposures = 5, dt = 0.16;
      for (let k = exposures; k >= 1; k--) {
        const tt = t - k * dt;
        const P = runnerPose(((tt * cad) % 1 + 1) % 1);
        const ox = -k * dt * speed;
        const a = 0.42 * Math.pow(1 - k / (exposures + 1), 1.6);
        this.bones(P, RUN_BONES, p => [rx + ox + p[0] * H, ground - p[1] * H], a, Math.max(1.5, H / 120), false);
        this.headCircle(P, p => [rx + ox + p[0] * H, ground - p[1] * H], a, H, Math.max(1.5, H / 120));
      }
      const P = runnerPose(phase);
      g.save(); g.shadowColor = "rgba(160,220,255,0.7)"; g.shadowBlur = 14;
      this.bones(P, RUN_BONES, map, 1, Math.max(2.5, H / 60), true);
      this.headCircle(P, map, 1, H, Math.max(2.5, H / 60));
      g.restore();
      // 触地瞬间：脚下红点
      const near = legAngles(phase), far = legAngles((phase + 0.5) % 1);
      for (const [side, a] of [["near", near], ["far", far]]) {
        const toe = map(P[side + "Toe"]);
        if (Math.abs(toe[1] - ground) < 2.5) { g.fillStyle = "#FF6A4A"; g.beginPath(); g.arc(toe[0], ground, 5, 0, TAU); g.fill(); }
      }
      this.vignette("rgba(3,7,12,0.88)");
      this.ruler(t, still, "rgba(233,228,218,0.9)", "#FF6A4A", rx);
    }

    // ---------- 举重台 ----------
    lift(t, still) {
      const g = this.g, W = this.w, Hh = this.h;
      const floor = Hh * 0.62, H = Math.min(Hh * 0.46, W * 0.7);
      const ax = W * 0.66;
      // 场馆
      let gr = g.createLinearGradient(0, 0, 0, Hh);
      gr.addColorStop(0, "#0B0806"); gr.addColorStop(0.7, "#1C140E"); gr.addColorStop(1, "#0E0A07");
      g.fillStyle = gr; g.fillRect(0, 0, W, Hh);
      // 顶光光锥
      g.save();
      const cone = g.createLinearGradient(0, 0, 0, floor);
      cone.addColorStop(0, "rgba(255,236,205,0.30)"); cone.addColorStop(1, "rgba(255,220,170,0.06)");
      g.fillStyle = cone; g.beginPath(); g.moveTo(ax - W * 0.06, 0); g.lineTo(ax + W * 0.06, 0); g.lineTo(ax + W * 0.42, floor); g.lineTo(ax - W * 0.42, floor); g.closePath(); g.fill();
      g.restore();
      // 举重台（木板）
      const px0 = ax - W * 0.4, px1 = ax + W * 0.4;
      gr = g.createLinearGradient(0, floor, 0, Hh);
      gr.addColorStop(0, "#6B4A2E"); gr.addColorStop(1, "#2A1C11");
      g.fillStyle = gr; g.beginPath(); g.moveTo(px0, floor); g.lineTo(px1, floor); g.lineTo(px1 + W * 0.15, Hh); g.lineTo(px0 - W * 0.15, Hh); g.closePath(); g.fill();
      g.strokeStyle = "rgba(20,12,6,0.55)"; g.lineWidth = 1;
      for (let k = 1; k < 7; k++) { const f = k / 7; g.beginPath(); g.moveTo(lerp(px0, px1, f), floor); g.lineTo(lerp(px0 - W * 0.15, px1 + W * 0.15, f), Hh); g.stroke(); }
      g.save(); g.globalAlpha = 0.35; g.fillStyle = g.createPattern(this.noise, "repeat"); g.fillRect(0, floor, W, Hh - floor); g.restore();
      g.fillStyle = "rgba(237,230,218,0.7)"; g.fillRect(px0, floor - 1, px1 - px0, 2);
      // 镁粉
      for (const p of this.dust) {
        const y = ((p.y - t * p.v) % 1 + 1) % 1, x = ax + (p.x - 0.5) * W * 0.7 * (0.3 + y) + Math.sin(t * 0.6 + p.d) * 8;
        g.fillStyle = `rgba(237,230,218,${0.15 + 0.35 * y})`; g.beginPath(); g.arc(x, y * floor, p.r, 0, TAU); g.fill();
      }
      const lt = still ? 1.9 : (t % LIFT_T);
      const map = P => [ax + P[0] * H, floor - P[1] * H];
      // 多重曝光：拉的过程
      const exp = [];
      for (let s = 0.62; s <= Math.min(lt, 2.0); s += 0.11) exp.push(s);
      exp.forEach((s, k) => {
        const P = liftPose(s), a = 0.12 + 0.2 * (k / Math.max(1, exp.length - 1));
        this.bones(P, LIFT_BONES, map, a, Math.max(1.5, H / 140), false);
      });
      const P = liftPose(lt);
      const bar = map(P.bar), plateR = H * 0.128;
      // 杠铃片：只画橡胶片外圈和很淡的片面，骨骼透过来可见
      g.fillStyle = "rgba(20,15,11,0.35)"; g.beginPath(); g.arc(bar[0], bar[1], plateR, 0, TAU); g.fill();
      g.strokeStyle = "rgba(200,69,46,0.9)"; g.lineWidth = Math.max(2.5, plateR * 0.1); g.beginPath(); g.arc(bar[0], bar[1], plateR * 0.95, 0, TAU); g.stroke();
      g.save(); g.shadowColor = "rgba(160,220,255,0.6)"; g.shadowBlur = 12;
      this.bones(P, LIFT_BONES, map, 1, Math.max(2.5, H / 70), true);
      this.headCircle(P, map, 1, H, Math.max(2.5, H / 70));
      g.restore();
      // 杠铃轨迹（最上层）
      const path = [];
      for (let s2 = 0; s2 <= lt; s2 += 0.02) path.push(map(liftPose(s2).bar));
      if (path.length > 1) {
        g.save(); g.shadowColor = "rgba(255,106,74,0.9)"; g.shadowBlur = 14;
        g.strokeStyle = "#FF6A4A"; g.lineWidth = Math.max(3, H / 80); g.lineCap = "round"; g.lineJoin = "round";
        g.beginPath(); path.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.stroke(); g.restore();
      }
      g.fillStyle = "#FFFFFF"; g.beginPath(); g.arc(bar[0], bar[1], Math.max(4, plateR * 0.12), 0, TAU); g.fill();
      if (!still && lt > 4.6) { g.fillStyle = `rgba(11,8,6,${(lt - 4.6) / 0.4})`; g.fillRect(0, 0, W, Hh); }
      this.vignette("rgba(5,3,2,0.88)");
      this.ruler(t, still, "rgba(237,230,218,0.85)", "#FF6A4A", bar[0]);
    }

    // ---------- 终点摄影时间刻度 ----------
    ruler(t, still, ink, red, lineX) {
      const g = this.g, W = this.w, Hh = this.h, y = Hh - 22;
      const pxPerS = W * 0.9, off = still ? 0 : (t * pxPerS * 0.25) % (pxPerS / 10);
      g.fillStyle = "rgba(0,0,0,0.35)"; g.fillRect(0, y - 16, W, 38);
      g.strokeStyle = ink; g.fillStyle = ink; g.lineWidth = 1;
      g.font = `600 11px "DIN Alternate","Bahnschrift",-apple-system,sans-serif`;
      const base = still ? 0 : Math.floor(t * 0.25 * 10) / 10;
      for (let k = -1; k < 14; k++) {
        const x = k * pxPerS / 10 - off;
        for (let m = 0; m < 10; m++) { const xm = x + m * pxPerS / 100; g.beginPath(); g.moveTo(xm, y + (m === 0 ? -10 : -4)); g.lineTo(xm, y); g.stroke(); }
        g.fillText((base + k / 10).toFixed(2), x + 3, y + 13);
      }
      g.strokeStyle = red; g.lineWidth = 2; g.beginPath(); g.moveTo(lineX, y - 16); g.lineTo(lineX, y + 16); g.stroke();
    }
    vignette(c) {
      const g = this.g, W = this.w, Hh = this.h;
      const gr = g.createLinearGradient(0, Hh * 0.45, 0, Hh);
      gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(1, c);
      g.fillStyle = gr; g.fillRect(0, Hh * 0.45, W, Hh * 0.55);
    }
  }
  root.Cover = Cover;
  root.COVER_POSE = { runnerPose, liftPose, STRIDE_PER_CYCLE };
})(typeof self !== "undefined" ? self : this);
