/* 知练封面：金色光带（WebGL 实时渲染）
   短跑：光带横向流动，光脉冲向前冲（速度）；举重：光带竖直上升（力量）。
   胶片颗粒 + 暗角。无 WebGL 时退回静态渐变。 */
(function (root) {
  "use strict";
  const VS = "attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}";
  const FS = `
precision highp float;
uniform vec2 res; uniform float t; uniform float mode; uniform float fadeIn;
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), u.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), u.x), u.y); }
float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * n(p); p *= 2.03; a *= 0.5; } return v; }
void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5 * res) / res.y;
  vec2 q = mode > 0.5 ? vec2(uv.y, -uv.x) : uv;          // 举重：整体转 90°，光带向上
  vec3 gold = vec3(0.93, 0.76, 0.45), ivory = vec3(1.0, 0.95, 0.84);
  vec3 col = vec3(0.010, 0.009, 0.008);
  float speed = mode > 0.5 ? 0.55 : 0.8;
  for (int i = 0; i < 7; i++) {
    float fi = float(i);
    float warp = fbm(vec2(q.x * 0.9 + t * 0.07 + fi * 1.7, fi * 2.3)) - 0.5;
    float y = 0.16 * sin(q.x * (0.9 + fi * 0.17) + t * (0.22 + fi * 0.03) + fi * 1.9) + warp * 0.42 + (fi - 3.0) * 0.045 - 0.06;
    float d = abs(q.y - y);
    float thin = 1800.0 + fi * 900.0;
    float core = exp(-d * d * thin);
    float glow = exp(-d * d * 60.0) * 0.05;
    float pulse = pow(0.5 + 0.5 * sin((q.x * 2.2 - t * speed * (1.4 + fi * 0.12)) * 3.14159 + fi * 2.0), 8.0);
    float edge = smoothstep(-1.1, -0.35, q.x) * (1.0 - smoothstep(0.55, 1.25, q.x));
    float w = (0.35 + 0.65 * fi / 6.0);
    col += mix(gold, ivory, pulse * 0.6) * (core * (0.18 + 1.1 * pulse) + glow) * edge * w;
  }
  // 远处的金色薄雾
  float mist = fbm(uv * 1.6 + vec2(t * 0.02, 0.0));
  col += gold * 0.035 * smoothstep(0.35, 0.9, mist);
  // 暗角 + 胶片颗粒
  float vig = smoothstep(1.25, 0.25, length(uv * vec2(0.9, 1.1)));
  col *= vig;
  col += (h(gl_FragCoord.xy + fract(t) * 91.0) - 0.5) * 0.028;
  col = 1.0 - exp(-col * 1.6);                               // 柔和色调映射
  gl_FragColor = vec4(col * fadeIn, 1.0);
}`;

  class Cover {
    constructor(canvas, opts = {}) {
      this.c = canvas; this.world = opts.world || "sprint";
      this.reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
      this.visible = true; this.t0 = performance.now(); this.born = performance.now();
      const gl = canvas.getContext("webgl", { antialias: false, premultipliedAlpha: false, powerPreference: "low-power" });
      this.gl = gl;
      if (gl) {
        const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
        try {
          const pr = gl.createProgram();
          gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr); gl.useProgram(pr);
          const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
          gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
          const loc = gl.getAttribLocation(pr, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
          this.u = { res: gl.getUniformLocation(pr, "res"), t: gl.getUniformLocation(pr, "t"), mode: gl.getUniformLocation(pr, "mode"), fadeIn: gl.getUniformLocation(pr, "fadeIn") };
        } catch (e) { this.gl = null; }
      }
      if (!this.gl) canvas.style.background = "radial-gradient(120% 70% at 50% 45%, #2a2112 0%, #0b0a08 55%, #050506 100%)";
      this.mode = this.world === "lift" ? 1 : 0;
      this.resize();
      addEventListener("resize", () => this.resize());
      document.addEventListener("visibilitychange", () => this.kick());
      if ("IntersectionObserver" in window) new IntersectionObserver(es => { this.visible = es[0].isIntersecting; this.kick(); }).observe(canvas);
    }
    resize() {
      const dpr = Math.min(1.5, window.devicePixelRatio || 1), r = this.c.getBoundingClientRect();   // 分辨率上限 1.5x：画质与省电平衡
      this.c.width = Math.max(1, Math.round(r.width * dpr)); this.c.height = Math.max(1, Math.round(r.height * dpr));
      if (this.gl) this.gl.viewport(0, 0, this.c.width, this.c.height);
      this.frame(performance.now());
    }
    setWorld(w) { this.world = w; this.targetMode = w === "lift" ? 1 : 0; this.born = performance.now(); this.kick(); }
    start() { this.running = true; this.kick(); }
    kick() {
      if (this.reduced) { this.frame(performance.now()); return; }
      if (this.raf || !this.running || document.hidden || !this.visible) return;
      const loop = ts => { this.raf = null; if (!this.running || document.hidden || !this.visible) return; this.frame(ts); this.raf = requestAnimationFrame(loop); };
      this.raf = requestAnimationFrame(loop);
    }
    frame(ts) {
      const gl = this.gl; if (!gl || !this.u) return;
      if (this.targetMode != null && this.targetMode !== this.mode) {
        const k = Math.min(1, (ts - this.born) / 600);            // 切换时先暗下去再亮起来
        if (k >= 0.5) this.mode = this.targetMode;
      }
      const fade = Math.min(1, Math.abs((ts - this.born) / 600 - 0.5) * 2 + (this.targetMode == null ? 1 : 0));
      const t = this.reduced ? 12.0 : (ts - this.t0) / 1000 + 12.0;
      gl.uniform2f(this.u.res, this.c.width, this.c.height);
      gl.uniform1f(this.u.t, t);
      gl.uniform1f(this.u.mode, this.mode);
      gl.uniform1f(this.u.fadeIn, Math.max(0.05, Math.min(1, fade)));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
  }
  root.Cover = Cover;
})(typeof self !== "undefined" ? self : this);
