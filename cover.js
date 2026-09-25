/* 知练封面
   短跑：日出田径场——把真实操场照片从“黑夜”实时重新打光：星星隐去，太阳从地平线后缓缓升起（被楼挡住的地方不透光），
         天空由深蓝转为暖橙，红色塑胶跑道被逐渐照亮，一道阳光沿跑道铺向镜头；全程镜头缓慢推近。
   举重：竖直上升的暖色光带。
   全部由手机显卡实时渲染。 */
(function (root) {
  "use strict";
  const VS = "attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}";
  const COMMON = `
precision highp float;
uniform vec2 res; uniform float t;
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), u.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), u.x), u.y); }
float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * n(p); p *= 2.03; a *= 0.5; } return v; }
vec3 sat(vec3 c, float s){ float l = dot(c, vec3(0.299, 0.587, 0.114)); return mix(vec3(l), c, s); }
`;
  // ---------- 日出 ----------
  const FS_SUN = COMMON + `
uniform sampler2D img; uniform float p, imgA, zoom;
const float HOR = 0.645;                 // 照片中地平线（天空与围栏交界）的位置
const vec2 SUN0 = vec2(0.50, 0.720);     // 太阳起点：地平线以下
const vec2 SUN1 = vec2(0.50, 0.575);     // 太阳终点：刚好在云层下沿
void main(){
  vec2 s = gl_FragCoord.xy / res; s.y = 1.0 - s.y;
  float sa = res.x / res.y; vec2 uv;
  if (sa < imgA) { float f = sa / imgA; uv = vec2(clamp(0.5, f * 0.5, 1.0 - f * 0.5) + (s.x - 0.5) * f, s.y); }
  else { float f = imgA / sa; uv = vec2(s.x, clamp(0.56, f * 0.5, 1.0 - f * 0.5) + (s.y - 0.5) * f); }
  float rise = smoothstep(0.08, 0.88, p);
  vec2 sun = mix(SUN0, SUN1, rise * rise * (3.0 - 2.0 * rise));
  uv = SUN1 + (uv - SUN1) / zoom;                       // 镜头推近
  vec3 base = texture2D(img, clamp(uv, 0.001, 0.999)).rgb;
  float lum = dot(base, vec3(0.299, 0.587, 0.114));
  float sky = smoothstep(HOR + 0.006, HOR - 0.014, uv.y);
  float open = sky * smoothstep(0.20, 0.42, lum);        // 真正的天空（楼、灯杆、围栏不算）
  float ground = smoothstep(HOR - 0.004, HOR + 0.035, uv.y);
  float k = smoothstep(0.12, 0.95, p);                   // 天亮程度

  // 黑夜：整体压暗并偏深蓝；天空上方更蓝
  vec3 night = base * vec3(0.075, 0.10, 0.19) + vec3(0.004, 0.007, 0.02) * (1.0 - uv.y);
  // 白天：暖色调，地面整体提亮，红色跑道加饱和
  vec3 day = base * vec3(1.04, 1.0, 0.96);
  vec3 lit = sat(base * 1.75 * vec3(1.18, 0.9, 0.78), 1.45);
  day = mix(day, lit, ground * 0.9);
  vec3 col = mix(night, day, k);

  // 太阳：光晕（先亮）、日轮（被楼挡住）、光芒
  vec2 d = vec2((uv.x - sun.x) * imgA, uv.y - sun.y);
  float r = length(d);
  vec3 warm = vec3(1.0, 0.52, 0.2), hot = vec3(1.0, 0.86, 0.62);
  col += warm * exp(-r * r * 5.0) * 0.32 * rise * (0.35 + 0.65 * sky);
  col += hot * exp(-r * r * 55.0) * 0.55 * rise * open;
  float R = 0.024;
  float disk = smoothstep(R, R * 0.72, r) * open * smoothstep(0.12, 0.4, p);
  col += vec3(2.6, 2.2, 1.6) * disk;                                  // 日轮比照片更亮（高光）
  col += hot * exp(-r * r * 900.0) * 1.3 * open * rise;               // 紧贴日轮的辉光
  col += warm * exp(-r * r * 160.0) * 0.45 * rise * sky;              // 中等光晕
  float ang = atan(d.y, d.x);
  float rays = fbm(vec2(ang * 5.0, t * 0.05)) ;                       // 不规则的淡光芒
  col += warm * smoothstep(0.55, 0.9, rays) * exp(-r * 4.5) * 0.06 * rise * sky;

  // 阳光铺在跑道上：太阳正下方一道逐渐变宽的暖光
  float depth = clamp((uv.y - HOR) / (1.0 - HOR), 0.0, 1.0);
  float path = exp(-pow((uv.x - sun.x) * imgA / (0.025 + 0.55 * depth), 2.0));
  col += warm * path * ground * (0.8 - 0.45 * depth) * k;
  col += vec3(1.0, 0.6, 0.35) * ground * 0.05 * k;       // 整片场地的暖色反光

  // 星空：只在夜里、只在开阔天空
  vec2 sp = uv * vec2(imgA, 1.0) * 260.0;
  float star = step(0.9972, h(floor(sp))) * (0.55 + 0.45 * sin(t * 1.7 + h(floor(sp)) * 50.0));
  col += vec3(0.8, 0.86, 1.0) * star * (1.0 - smoothstep(0.0, 0.45, p)) * open * smoothstep(0.52, 0.3, uv.y) * 0.9;

  // 暗角、颗粒、色调映射
  float vig = smoothstep(1.2, 0.3, length((s - vec2(0.5, 0.5)) * vec2(1.0, 0.85)));
  col *= mix(0.55, 1.0, vig);
  col += (h(gl_FragCoord.xy + fract(t) * 91.0) - 0.5) * 0.022;
  col = col - max(col - 0.82, 0.0) * 0.55;                           // 柔和高光，保留照片原本的色彩与对比
  gl_FragColor = vec4(col, 1.0);
}`;
  // ---------- 光带（举重） ----------
  const FS_RIB = COMMON + `
void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5 * res) / res.y;
  vec2 q = vec2(uv.y, -uv.x);
  vec3 gold = vec3(0.95, 0.72, 0.45), ivory = vec3(1.0, 0.96, 0.9);
  vec3 col = vec3(0.012, 0.010, 0.009);
  for (int i = 0; i < 7; i++) {
    float fi = float(i);
    float warp = fbm(vec2(q.x * 0.9 + t * 0.07 + fi * 1.7, fi * 2.3)) - 0.5;
    float y = 0.16 * sin(q.x * (0.9 + fi * 0.17) + t * (0.22 + fi * 0.03) + fi * 1.9) + warp * 0.42 + (fi - 3.0) * 0.045 - 0.06;
    float dd = abs(q.y - y);
    float core = exp(-dd * dd * (1800.0 + fi * 900.0));
    float pulse = pow(0.5 + 0.5 * sin((q.x * 2.2 - t * 0.8 * (1.4 + fi * 0.12)) * 3.14159 + fi * 2.0), 8.0);
    float edge = smoothstep(-1.1, -0.35, q.x) * (1.0 - smoothstep(0.55, 1.25, q.x));
    col += mix(gold, ivory, pulse * 0.6) * (core * (0.18 + 1.1 * pulse) + exp(-dd * dd * 60.0) * 0.05) * edge * (0.35 + 0.65 * fi / 6.0);
  }
  col *= smoothstep(1.25, 0.25, length(uv * vec2(0.9, 1.1)));
  col += (h(gl_FragCoord.xy + fract(t) * 91.0) - 0.5) * 0.022;
  gl_FragColor = vec4(1.0 - exp(-col * 1.6), 1.0);
}`;

  class Cover {
    constructor(canvas, opts = {}) {
      this.c = canvas; this.world = opts.world || "sprint";
      this.imageUrl = opts.imageUrl; this.intro = !!opts.intro;
      this.onReveal = opts.onReveal || (() => {});
      this.reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
      this.visible = true; this.t0 = performance.now();
      this.p = this.intro && !this.reduced ? 0 : 0.86; this.pTarget = 1; this.pStart = null;
      this.introDur = this.intro && !this.reduced ? 6.5 : 1.2;
      const gl = canvas.getContext("webgl", { antialias: false, powerPreference: "low-power" });
      this.gl = gl;
      if (gl) {
        try {
          const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
          gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
          this.progSun = this.program(FS_SUN); this.progRib = this.program(FS_RIB);
        } catch (e) { this.gl = null; }
      }
      if (!this.gl) { canvas.style.background = "radial-gradient(120% 70% at 50% 60%, #6b3a1c 0%, #1a1410 50%, #050506 100%)"; this.reveal(); }
      this.resize();
      addEventListener("resize", () => this.resize());
      document.addEventListener("visibilitychange", () => this.kick());
      if ("IntersectionObserver" in window) new IntersectionObserver(es => { this.visible = es[0].isIntersecting; this.kick(); }).observe(canvas);
      canvas.parentElement.addEventListener("click", () => { if (this.p < 0.98 && this.pStart != null) { this.skip = true; } });
      this.loadImage();
    }
    program(fs) {
      const gl = this.gl;
      const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
      const pr = gl.createProgram();
      gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(pr);
      if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error("link");
      const u = {}; ["res", "t", "p", "imgA", "zoom", "img"].forEach(k => (u[k] = gl.getUniformLocation(pr, k)));
      return { pr, u, loc: gl.getAttribLocation(pr, "p") };
    }
    loadImage() {
      if (!this.gl || !this.imageUrl) { this.reveal(); return; }
      const img = new Image();
      img.onload = () => {
        const gl = this.gl; this.tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
        this.imgA = img.width / img.height; this.pStart = performance.now(); this.kick();
      };
      img.onerror = () => { this.imgFailed = true; this.reveal(); this.kick(); };
      img.src = this.imageUrl;
    }
    reveal() { if (!this.revealed) { this.revealed = true; this.onReveal(); } }
    resize() {
      const dpr = Math.min(1.5, window.devicePixelRatio || 1), r = this.c.getBoundingClientRect();
      this.c.width = Math.max(1, Math.round(r.width * dpr)); this.c.height = Math.max(1, Math.round(r.height * dpr));
      if (this.gl) this.gl.viewport(0, 0, this.c.width, this.c.height);
      this.frame(performance.now());
    }
    setWorld(w) { this.world = w; this.kick(); this.frame(performance.now()); }
    start() { this.running = true; this.kick(); }
    kick() {
      if (this.raf || !this.running || document.hidden || !this.visible) return;
      const loop = ts => { this.raf = null; if (!this.running || document.hidden || !this.visible) return; this.frame(ts); this.raf = requestAnimationFrame(loop); };
      this.raf = requestAnimationFrame(loop);
    }
    frame(ts) {
      const gl = this.gl; if (!gl) return;
      const t = (ts - this.t0) / 1000;
      const sunrise = this.world === "sprint" && this.tex && !this.imgFailed;
      if (sunrise && this.pStart != null) {
        let x = Math.min(1, (ts - this.pStart) / 1000 / this.introDur);
        if (this.skip) { this.skipAt = this.skipAt || ts; this.pSkip0 = this.pSkip0 ?? this.p; x = 1; }
        const start = this.introDur > 2 ? 0 : 0.86;
        this.p = this.skip ? Math.min(1, this.pSkip0 + (ts - this.skipAt) / 700) : start + (1 - start) * (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
        if (this.p > 0.72) this.reveal();
      }
      const P = sunrise ? this.progSun : this.progRib;
      gl.useProgram(P.pr);
      gl.enableVertexAttribArray(P.loc); gl.vertexAttribPointer(P.loc, 2, gl.FLOAT, false, 0, 0);
      gl.uniform2f(P.u.res, this.c.width, this.c.height);
      gl.uniform1f(P.u.t, this.reduced ? 5 : t);
      if (sunrise) {
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex); gl.uniform1i(P.u.img, 0);
        gl.uniform1f(P.u.p, this.p); gl.uniform1f(P.u.imgA, this.imgA);
        gl.uniform1f(P.u.zoom, 1.0 + 0.12 * (1 - this.p));
      }
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
  }
  root.Cover = Cover;
})(typeof self !== "undefined" ? self : this);
