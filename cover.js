/* 知练封面
   短跑：日出田径场（完全程序生成）——凌晨四点的朦胧蓝：薄雾、远处树林与楼群、灯杆亮着；
         太阳从跑道消失点升起，天空由地平线开始转暖，雾散去，灯逐个熄灭，阳光沿跑道铺向镜头；
         红色塑胶、白色分道线、绿色草坪由灰蓝逐渐变得饱满；镜头沿跑道缓慢前滑。
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
  // ---------- 日出田径场（完全程序生成，不使用照片） ----------
  const FS_SUN = COMMON + `
uniform float p;
const float HOR = -0.17;                  // 地平线（屏幕坐标，中心为 0）
const float HC = 2.2;                     // 相机离地高度（米）
const float CAMX = 2.6;                   // 相机横向位置：第 3 道上方（x=0 为内侧路缘）
vec3 skyAt(vec2 uv, float warm, float k) {
  float h = uv.y - HOR;
  vec3 zen = mix(vec3(0.15, 0.22, 0.38), vec3(0.20, 0.34, 0.58), k);
  vec3 hor = mix(vec3(0.50, 0.58, 0.72), vec3(1.0, 0.63, 0.36), warm);
  return mix(hor, zen, smoothstep(0.0, 0.6, h));
}
float skyline(float x) {
  float s = HOR + 0.008 + 0.016 * fbm(vec2(x * 11.0, 1.3)) + 0.006 * n(vec2(x * 60.0, 2.0));   // 远处树林
  s = max(s, HOR + 0.046 * smoothstep(-0.245, -0.240, x) * smoothstep(-0.150, -0.155, x));        // 左侧楼群
  s = max(s, HOR + 0.032 * smoothstep(-0.160, -0.155, x) * smoothstep(-0.105, -0.110, x));
  s = max(s, HOR + 0.036 * smoothstep(0.150, 0.155, x) * smoothstep(0.215, 0.210, x));            // 右侧楼
  return s;
}
void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5 * res) / res.y;
  float rise = smoothstep(0.10, 0.90, p);
  float k = smoothstep(0.20, 0.95, p);                                  // 天亮程度
  vec2 sun = vec2(0.0, HOR + mix(-0.05, 0.07, rise * rise * (3.0 - 2.0 * rise)));
  float warmC = rise * (0.35 + 0.65 * exp(-uv.x * uv.x * 4.0));
  vec3 horizonHaze = skyAt(vec2(uv.x, HOR), warmC, k);
  vec3 sunCol = vec3(1.0, 0.78, 0.52);
  vec3 col;
  float yv = uv.y - HOR;
  if (yv < 0.0) {
    // ---- 地面：光线与地面求交 ----
    float z = HC / (-yv);
    float x = CAMX + uv.x * z;
    float zw = z + t * 0.9;                                              // 缓慢向前滑行
    float pxW = z / res.y * 1.6, pxZ = HC / (yv * yv) / res.y;
    float fine = 1.0 - smoothstep(0.05, 0.35, pxW);                      // 远处细节淡出，避免闪烁
    // 基础材质
    float grain = (n(vec2(x, zw) * 22.0) - 0.5) * 0.16 * fine;
    vec3 rubber = vec3(0.60, 0.17, 0.12) * (1.0 + grain);
    float stripe = mod(floor(zw / 6.0), 2.0);
    vec3 grass = vec3(0.14, 0.36, 0.15) * (0.9 + 0.2 * stripe * fine + (n(vec2(x, zw) * 9.0) - 0.5) * 0.12);
    vec3 alb = rubber;
    float lineMask = 0.0;
    if (x < -0.06) {
      alb = grass;
      float side = abs(x + 9.0);                                         // 足球场边线
      lineMask = smoothstep(0.06 + pxW, 0.06 - pxW, side) * (0.55 + 0.45 * fine);
    } else if (x < 0.0) {
      alb = vec3(0.78, 0.78, 0.76);                                      // 内侧路缘
    } else if (x < 9.76) {
      float d = abs(x - floor(x / 1.22 + 0.5) * 1.22);
      lineMask = smoothstep(0.045 + pxW, 0.045 - pxW * 0.5, d) * step(0.5, x);
      lineMask = mix(lineMask, 0.09, smoothstep(0.02, 0.12, pxW));       // 很远时线条变成平均亮度
    } else if (x < 11.4) {
      alb = rubber * 0.92;
      lineMask = smoothstep(0.05 + pxW, 0.05 - pxW, abs(x - 9.76));
    } else {
      alb = vec3(0.10, 0.20, 0.10) * (0.9 + 0.2 * n(vec2(x, zw) * 3.0));
    }
    vec3 white = vec3(1.0, 1.0, 0.97);
    alb = mix(alb, white, clamp(lineMask, 0.0, 1.0));
    // 光照：蓝调时刻的天光 + 升起后的暖色阳光
    vec3 amb = mix(vec3(0.40, 0.49, 0.66), vec3(0.68, 0.66, 0.68), k);
    float sunI = smoothstep(0.25, 0.9, p) * 0.9;
    vec3 lit = alb * (amb + sunCol * sunI);
    lit += white * clamp(lineMask, 0.0, 1.0) * 0.12 * (0.5 + 0.5 * k);                 // 白线在任何光线下都醒目
    // 阳光铺在跑道上：太阳正下方越近越宽的一道光；白线反光更强
    float path = exp(-pow(uv.x / (0.018 + 0.42 * (-yv)), 2.0));
    float spec = mix(0.30, 1.0, clamp(lineMask, 0.0, 1.0)) * (x < -0.06 ? 0.25 : 1.0);
    lit += sunCol * path * spec * rise * (0.25 + 0.75 * exp(yv * 7.0)) * 0.9;
    // 晨雾：随太阳升起变淡
    float dens = mix(0.020, 0.006, k);
    float fog = 1.0 - exp(-z * dens);
    col = mix(lit, horizonHaze, fog);
    // 最近处稍暗，增加纵深
    col *= 0.9 + 0.1 * smoothstep(-0.55, -0.2, uv.y);
  } else {
    // ---- 天空 ----
    col = skyAt(uv, warmC, k);
    float h = yv;
    float cl = fbm(vec2(uv.x * 1.6 + t * 0.006, h * 10.0 + 3.0));
    float cloud = smoothstep(0.56, 0.82, cl) * smoothstep(0.03, 0.10, h) * smoothstep(0.5, 0.18, h);
    vec3 cloudCol = mix(vec3(0.30, 0.37, 0.50), mix(vec3(0.95, 0.62, 0.52), vec3(1.0, 0.82, 0.62), rise), rise * (0.4 + 0.6 * exp(-uv.x * uv.x * 6.0)));
    col = mix(col, cloudCol, cloud * 0.75);
    // 太阳（被树林和楼挡住的部分不可见）
    float sk = skyline(uv.x);
    float vis = step(sk, uv.y);
    float r = length(uv - sun);
    col += vec3(1.0, 0.55, 0.25) * exp(-r * r * 9.0) * 0.30 * rise;
    col += vec3(1.0, 0.80, 0.55) * exp(-r * r * 140.0) * 0.55 * rise;
    float disk = smoothstep(0.030, 0.023, r) * vis * smoothstep(0.12, 0.35, p);
    col += vec3(2.4, 2.05, 1.5) * disk;
    col += vec3(1.0, 0.85, 0.62) * exp(-r * r * 1400.0) * 0.9 * rise * vis;
    // 远处剪影：被雾染成地平线的颜色
    if (uv.y < sk) col = mix(horizonHaze * 0.72, horizonHaze, 0.45 + 0.3 * smoothstep(HOR, HOR + 0.05, uv.y));
    // 灯杆与灯：蓝调时刻亮着，天亮后逐个熄灭
    for (int i = 0; i < 4; i++) {
      float fi = float(i);
      float px = (i < 2 ? -1.0 : 1.0) * (0.105 + 0.07 * mod(fi, 2.0));
      float top = HOR + 0.11 - 0.025 * mod(fi, 2.0);
      float pole = smoothstep(0.0022, 0.0012, abs(uv.x - px)) * step(HOR, uv.y) * step(uv.y, top);
      col = mix(col, horizonHaze * 0.6, pole * 0.85);
      float head = smoothstep(0.0075, 0.005, abs(uv.x - px)) * smoothstep(0.004, 0.002, abs(uv.y - top));
      float on = 1.0 - smoothstep(0.35 + fi * 0.06, 0.55 + fi * 0.06, p);
      vec2 lp = uv - vec2(px, top);
      col = mix(col, vec3(1.0, 0.97, 0.9) * (0.4 + 0.6 * on), head);
      col += vec3(0.95, 0.95, 1.0) * exp(-dot(lp, lp) * 1800.0) * 0.55 * on;
    }
  }
  // 镜头光斑（很淡）
  vec2 toC = -sun;
  for (int j = 1; j <= 3; j++) {
    vec2 gp = sun + toC * (0.55 * float(j));
    float g = exp(-pow(length(uv - gp) * (26.0 - float(j) * 5.0), 2.0));
    col += vec3(1.0, 0.72, 0.45) * g * 0.05 * rise;
  }
  // 暗角、颗粒、柔和高光
  vec2 sv = gl_FragCoord.xy / res - 0.5;
  col *= mix(0.74, 1.0, smoothstep(0.9, 0.25, length(sv * vec2(0.9, 1.0))));
  col += (h(gl_FragCoord.xy + fract(t) * 91.0) - 0.5) * 0.02;
  col = col - max(col - 0.85, 0.0) * 0.55;
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
      this.introDur = this.intro && !this.reduced ? 7.0 : 1.2;
      const gl = canvas.getContext("webgl", { antialias: false, powerPreference: "low-power" });
      this.gl = gl;
      if (gl) {
        try {
          const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
          gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
          this.progSun = this.program(FS_SUN); this.progRib = this.program(FS_RIB);
        } catch (e) { this.gl = null; window.__coverErr = String(e && e.message || e); }
      }
      if (!this.gl) { canvas.style.background = "radial-gradient(120% 70% at 50% 60%, #6b3a1c 0%, #1a1410 50%, #050506 100%)"; this.reveal(); }
      this.resize();
      addEventListener("resize", () => this.resize());
      document.addEventListener("visibilitychange", () => this.kick());
      if ("IntersectionObserver" in window) new IntersectionObserver(es => { this.visible = es[0].isIntersecting; this.kick(); }).observe(canvas);
      canvas.parentElement.addEventListener("click", () => { if (this.p < 0.98 && this.pStart != null) { this.skip = true; } });
      this.pStart = performance.now();
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
      const sunrise = this.world === "sprint";
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
      if (sunrise) gl.uniform1f(P.u.p, this.p);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
  }
  root.Cover = Cover;
})(typeof self !== "undefined" ? self : this);
