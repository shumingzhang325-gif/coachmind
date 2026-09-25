/* 知练 CoachMind App：本机存储、视频逐帧处理、姿态估计、标定、结果展示 */
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const TH = CM_THRESHOLDS, CARDS = CM_CARDS;
  // 识别运行时（由 Emscripten 编译）会调用全局函数 dbg() 输出调试信息。
  // 页面里任何 id="dbg" 的元素都会被浏览器当成全局变量 dbg，导致运行时崩溃；这里提前放一个真正的函数。
  for (const name of ["dbg"]) if (typeof window[name] !== "function") window[name] = (...args) => { try { console.debug("[识别运行时]", ...args); } catch (e) { /* 忽略 */ } };
  const MP_VERSION = "0.10.14";
  // 运算库来源：先用你自己网站上的文件，再依次尝试国内镜像和国外 CDN
  const LIB_SOURCES = [
    { name: "本站文件", bundle: new URL("vision_bundle.mjs", location.href).href, wasm: new URL(".", location.href).href.replace(/\/$/, "") },
    { name: "npmmirror 国内镜像", bundle: `https://registry.npmmirror.com/@mediapipe/tasks-vision/${MP_VERSION}/files/vision_bundle.mjs`, wasm: `https://registry.npmmirror.com/@mediapipe/tasks-vision/${MP_VERSION}/files/wasm` },
    { name: "jsDelivr", bundle: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/vision_bundle.mjs`, wasm: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm` },
    { name: "jsDelivr 备用", bundle: `https://fastly.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/vision_bundle.mjs`, wasm: `https://fastly.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm` },
    { name: "unpkg", bundle: `https://unpkg.com/@mediapipe/tasks-vision@${MP_VERSION}/vision_bundle.mjs`, wasm: `https://unpkg.com/@mediapipe/tasks-vision@${MP_VERSION}/wasm` },
  ];
  const MODEL_SOURCES = [
    { name: "你的网站", url: new URL("pose_landmarker_full.task", location.href).href },
    { name: "Google", url: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task" },
  ];
  const MP4BOX_SOURCES = ["mp4box.all.min.js", "https://registry.npmmirror.com/mp4box/0.5.2/files/dist/mp4box.all.min.js", "https://cdn.jsdelivr.net/npm/mp4box@0.5.2/dist/mp4box.all.min.js"];
  const WORK_LONG_SIDE = 1280;           // 处理分辨率：长边 1280 像素
  const MAX_SECONDS_WARN = 3;
  const ACTION_NAME = { sprint: "短跑", clean: "高翻 / 抓举", general: "动作分析" };
  function actionLabel(o) {
    if (o && o.sportId && window.SPORTLIB) { const s = SPORTLIB.byId(o.sportId), t = SPORTLIB.tech(o.sportId, o.techId); if (s && t) return `${s.name}　${t.name}`; }
    return ACTION_NAME[o && o.action] || "";
  }

  // ---------------- 工具 ----------------
  function toast(msg, ms = 2200) { const t = $("toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove("on"), ms); }
  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const fmtDate = iso => { const d = new Date(iso); return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
  const round = (v, k = 3) => (Number.isFinite(v) ? Math.round(v * 10 ** k) / 10 ** k : null);

  // ---------------- 本机数据库（IndexedDB） ----------------
  let dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open("coachmind", 2);
      r.onupgradeneeded = () => {
        const d = r.result;
        for (const n of ["athletes", "analyses", "files"]) if (!d.objectStoreNames.contains(n)) d.createObjectStore(n, { keyPath: "id" });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  async function store(name, mode, fn) {
    const d = await db();
    return new Promise((res, rej) => {
      const tx = d.transaction(name, mode), st = tx.objectStore(name);
      const req = fn(st);
      tx.oncomplete = () => res(req && req.result);
      tx.onerror = () => rej(tx.error);
    });
  }
  const dbAll = name => store(name, "readonly", s => s.getAll());
  const dbPut = (name, obj) => store(name, "readwrite", s => s.put(obj));
  const dbDel = (name, id) => store(name, "readwrite", s => s.delete(id));
  const dbGet = (name, id) => store(name, "readonly", s => s.get(id));

  // ---------------- 视图切换 ----------------
  const S = {};                // 当前分析的状态
  window.__cmState = S;        // 便于排查问题
  let viewStack = ["home"];
  const VIEW_META = {
    home: { title: "", step: 0 }, sport: { title: "项目技术库", step: 0 }, new: { title: "选择视频", step: 1 }, calib: { title: "片段与标定", step: 2 },
    process: { title: "分析", step: 3 }, result: { title: "分析结果", step: 0 }, athlete: { title: "运动员", step: 0 },
  };
  function show(v, push = true) {
    document.querySelectorAll("section.view").forEach(s => s.classList.toggle("on", s.id === "v-" + v));
    if (push && viewStack[viewStack.length - 1] !== v) viewStack.push(v);
    const m = VIEW_META[v];
    $("backBtn").hidden = v === "home";
    $("title").textContent = m.title;
    $("bar").classList.toggle("line", v !== "home");
    $("stepper").hidden = !m.step;
    $("stepper").querySelectorAll("i").forEach((el, k) => el.classList.toggle("on", k < m.step));
    window.scrollTo(0, 0);
    $("bar").hidden = v === "home";
    if (v === "home") { viewStack = ["home"]; stopPlayback(); renderHome(); renderPeople(); renderSports(); renderModelState(); if (cover) requestAnimationFrame(() => cover.resize()); }
  }
  $("backBtn").onclick = () => {
    if (S.processing) { S.cancel = true; return; }
    viewStack.pop();
    const prev = viewStack[viewStack.length - 1] || "home";
    if (prev === "athlete" && A.cur) { openAthlete(A.cur.id, A.pane); return; }
    show(prev === "process" ? "calib" : prev, false);
  };

  // ---------------- 首页 ----------------
  let athleteFilter = null;
  function renderToday() {
    const d = new Date(), wk = "日一二三四五六"[d.getDay()];
    $("today").innerHTML = `<b>${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}</b>星期${wk}`;
  }
  async function renderHome() {
    const [athletes, analyses] = await Promise.all([dbAll("athletes"), dbAll("analyses")]);
    const chips = $("athleteFilter");
    chips.innerHTML = athletes.length > 1 ? [`<button aria-pressed="${!athleteFilter}" data-a="">全部</button>`]
      .concat(athletes.map(a => `<button aria-pressed="${athleteFilter === a.id}" data-a="${a.id}">${esc(a.name)}</button>`)).join("") : "";
    chips.querySelectorAll("button").forEach(b => b.onclick = () => { athleteFilter = b.dataset.a || null; renderHome(); });
    const list = analyses.filter(a => !athleteFilter || a.athleteId === athleteFilter).sort((a, b) => b.id - a.id);
    $("historyList").innerHTML = list.length ? list.map(a => {
      const d = new Date(a.date);
      const [val, unit] = a.action === "sprint"
        ? [a.summary.contact_time_s != null ? a.summary.contact_time_s.toFixed(3) : "–", "s 触地"]
        : a.action === "general"
        ? (a.summary.jump_height_cm != null ? [a.summary.jump_height_cm.toFixed(1), "cm 跳高"] : [a.summary.knee_min_deg != null ? a.summary.knee_min_deg.toFixed(0) : "–", "° 最小膝角"])
        : [a.summary.peak_bar_velocity_mps != null ? a.summary.peak_bar_velocity_mps.toFixed(2) : "–", "m/s 峰速"];
      const n = (a.hits || []).length;
      const tag = a.reviewed ? `<span class="ok">教练已确认</span>` : n ? `<span class="flag">${n} 个待查问题</span>` : "";
      return `<li><button data-id="${a.id}">
        <span class="d"><b>${String(d.getDate()).padStart(2, "0")}</b>${d.getMonth() + 1}月</span>
        <span><span class="who">${esc(a.athleteName || "未指定")}</span><br><span class="what">${esc(actionLabel(a))}　${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}</span></span>
        <span class="val">${val}<small>${unit}</small>${tag}</span></button></li>`;
    }).join("") : `<li class="blank">还没有记录。选一个动作，分析第一段视频。</li>`;
    $("historyList").querySelectorAll("button[data-id]").forEach(b => b.onclick = () => openSaved(Number(b.dataset.id)));
  }
  document.querySelectorAll(".lane").forEach(b => b.onclick = () => startNew(b.dataset.action));

  // ---------------- 新建分析 ----------------
  async function startNew(action, opts = {}) {
    for (const k of Object.keys(S)) delete S[k];
    S.action = action; S.sportId = opts.sportId || null; S.techId = opts.techId || null;
    $("newTitle").textContent = S.sportId ? actionLabel(S) : ACTION_NAME[action] + "分析";
    $("markerField").hidden = action !== "sprint";
    $("fileInfo").innerHTML = ""; $("fpsBox").hidden = true; $("fileInput").value = ""; $("pickBox").hidden = false;
    await renderAthleteSelect();
    show("new");
  }
  async function renderAthleteSelect(selectId) {
    const athletes = (await dbAll("athletes")).sort((a, b) => a.name.localeCompare(b.name, "zh"));
    const sel = $("athleteSel");
    sel.innerHTML = athletes.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join("") + `<option value="__new">＋ 添加运动员</option>`;
    const want = selectId || athleteFilter || localStorage.getItem("cm_lastAthlete");
    if (want && athletes.some(a => a.id === want)) sel.value = want;
    else if (!athletes.length) sel.value = "__new";
    $("addAthleteRow").hidden = sel.value !== "__new";
  }
  $("athleteSel").onchange = () => { $("addAthleteRow").hidden = $("athleteSel").value !== "__new"; if (!$("addAthleteRow").hidden) $("newAthleteName").focus(); };
  $("addAthleteBtn").onclick = async () => {
    const name = $("newAthleteName").value.trim();
    if (!name) { toast("请输入姓名或编号"); return; }
    const a = { id: "a" + Date.now(), name, created: new Date().toISOString() };
    await dbPut("athletes", a);
    $("newAthleteName").value = "";
    await renderAthleteSelect(a.id);
    toast(`已添加 ${name}`);
  };

  function loadScriptFrom(urls) {
    return urls.reduce((p, url) => p.then(ok => ok || new Promise(res => {
      const el = document.createElement("script"); el.src = url; el.onload = () => res(true); el.onerror = () => { el.remove(); res(false); };
      document.head.appendChild(el); setTimeout(() => res(!!window.MP4Box), 8000);
    })), Promise.resolve(false));
  }

  // 帧率检测：① 逐帧精确测量 ② 解析 MP4/MOV 文件头 ③ 都失败时按 30 并提示
  async function detectFps(file, video) {
    try {
      const f = await probeFps(video);
      if (f && f > 5 && f < 2000) return { fps: f, method: "逐帧测量" };
    } catch (e) { /* 继续 */ }
    try {
      if (!window.MP4Box) await loadScriptFrom(MP4BOX_SOURCES);
      if (!window.MP4Box) throw new Error("no mp4box");
      const buf = await file.arrayBuffer();
      buf.fileStart = 0;
      const mp4 = MP4Box.createFile();
      let info = null;
      mp4.onReady = i => { info = i; };
      mp4.appendBuffer(buf); mp4.flush();
      const tr = info && info.videoTracks && info.videoTracks[0];
      if (tr && tr.nb_samples && tr.duration) return { fps: tr.nb_samples / (tr.duration / tr.timescale), method: "文件信息" };
    } catch (e) { /* 继续 */ }
    return { fps: 30, method: "未能检测", unknown: true };
  }

  const hiddenVideo = document.createElement("video");
  hiddenVideo.muted = true; hiddenVideo.playsInline = true; hiddenVideo.preload = "auto";
  hiddenVideo.setAttribute("playsinline", "");
  hiddenVideo.style.cssText = "position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none";
  document.body.appendChild(hiddenVideo);

  // iOS 在视频“播放过一次”之前可能不加载画面，这里静音播放一下再暂停
  async function primeVideo(video) {
    await new Promise((res, rej) => {
      if (video.readyState >= 1) return res();
      video.onloadedmetadata = res; video.onerror = () => rej(new Error("视频无法解码"));
      video.load();
    });
    try { await video.play(); video.pause(); } catch (e) { /* 忽略 */ }
    for (let k = 0; k < 40 && video.readyState < 2; k++) await sleep(50);
    if (video.readyState < 2) throw new Error("视频画面加载失败");
  }

  $("fileInput").onchange = async e => {
    const file = e.target.files[0];
    if (!file) return;
    if (S.url) URL.revokeObjectURL(S.url);
    S.file = file; S.url = URL.createObjectURL(file);
    $("pickBox").hidden = true;
    $("fileInfo").innerHTML = `<div class="filecard"><span class="nm">${esc(file.name)}</span><span class="sp">正在读取…</span></div>`;
    hiddenVideo.src = S.url;
    try {
      await primeVideo(hiddenVideo);
    } catch (err) {
      $("pickBox").hidden = false;
      $("fileInfo").innerHTML = `<div class="msg"><b>这个视频无法读取。</b>请在 iPhone 设置 → 相机 → 格式 里选“兼容性最佳”后重拍。</div>`;
      return;
    }
    $("fileInfo").innerHTML = `<div class="filecard"><span class="nm">${esc(file.name)}</span><span class="sp">正在逐帧测量帧率…</span></div>`;
    const d = await detectFps(file, hiddenVideo);
    await seek(hiddenVideo, 0);
    S.fpsFile = d.fps; S.duration = hiddenVideo.duration;
    S.vw = hiddenVideo.videoWidth; S.vh = hiddenVideo.videoHeight;
    const k = Math.min(1, WORK_LONG_SIDE / Math.max(S.vw, S.vh));
    S.W = Math.round(S.vw * k); S.H = Math.round(S.vh * k);
    S.start = 0; S.end = S.duration;
    const hi = d.fps >= 100;
    $("fpsReal").value = hi ? Math.round(d.fps) : 240;
    $("fileInfo").innerHTML = `<div class="filecard">
        <span class="nm">${esc(file.name)}</span>
        <span class="sp">${S.vw}×${S.vh}　${S.duration.toFixed(2)} 秒　${d.method}</span>
        <span class="fps ${hi ? "good" : "low"}">${Math.round(d.fps)}<small>帧/秒</small></span>
        <label class="btn sm re" for="fileInput">换一个视频</label>
      </div>` +
      (d.unknown ? `<div class="msg"><b>没能测出帧率，</b>下面先按 240 计算。请确认这是慢动作原片。</div>` :
       hi ? `<div class="msg ok"><b>高帧率原片，</b>可以直接分析。</div>`
          : `<div class="msg"><b>只有 ${Math.round(d.fps)} 帧/秒。</b>如果这是 iPhone 慢动作被导出成了慢放视频，保持下面的 240；如果本来就是普通速度拍的，改成 ${Math.round(d.fps)}，但触地时间会不准。</div>`);
    $("fpsBox").hidden = false;
  };

  $("toRangeBtn").onclick = () => {
    const sel = $("athleteSel").value;
    if (sel === "__new") { toast("请先添加运动员"); return; }
    const fps = Number($("fpsReal").value);
    if (!(fps >= 24)) { toast("请填写帧率"); return; }
    S.fpsReal = fps; S.athleteId = sel; S.athleteName = $("athleteSel").selectedOptions[0].textContent;
    localStorage.setItem("cm_lastAthlete", sel);
    S.markerDist = Number($("markerDist").value) || null;
    S.calibPts = []; S.phase = "range";
    enterCalib();
  };

  // ---------------- 片段与标定 ----------------
  const cc = $("calibCanvas"), cctx = cc.getContext("2d");
  // 跳到时间 t，返回画面实际呈现帧的时间戳（浏览器不支持时返回 null）
  async function seek(video, t, waitMs = 60) {
    t = Math.max(0, Math.min(video.duration - 1e-3, t));
    if (Math.abs(video.currentTime - t) < 1e-6 && video.readyState >= 2) return null;
    let frameP = null;
    if ("requestVideoFrameCallback" in video) frameP = new Promise(r => video.requestVideoFrameCallback((_, m) => r(m.mediaTime)));
    await new Promise(res => {
      const done = () => { clearTimeout(to); res(); };
      const to = setTimeout(res, 1500);
      video.addEventListener("seeked", done, { once: true });
      video.currentTime = t;
    });
    return frameP ? Promise.race([frameP, sleep(waitMs).then(() => null)]) : null;
  }

  // 精确测帧率：逐步向后跳，记录画面切换时刻；跨 10 帧取平均，再吸附到常见帧率。与屏幕刷新率无关。
  const STD_FPS = [24, 25, 30, 48, 50, 60, 100, 120, 240, 480, 960];
  async function probeFps(video) {
    if (!("requestVideoFrameCallback" in video)) return null;
    let base = null;
    for (const t of [video.duration * 0.3, video.duration * 0.3 + 0.013, video.duration * 0.5]) {
      base = await seek(video, t, 150);
      if (base != null) break;
    }
    if (base == null) return null;
    const first = base;
    let guess = 0, count = 0;
    for (let k = 0; k < 10; k++) {
      let next = null, d = guess ? guess * 1.02 : 0.0005;
      const stepD = guess ? Math.max(0.0003, guess * 0.1) : 0.0005;
      for (let tries = 0; tries < 120 && next == null; tries++, d += stepD) {
        if (base + d >= video.duration - 0.002) break;
        const m = await seek(video, base + d, 90);
        if (m != null && m > base + 1e-5) next = m;
      }
      if (next == null) break;
      count++; base = next;
      guess = (base - first) / count;
    }
    if (!count) return null;
    const raw = count / (base - first);
    const snap = STD_FPS.find(f => Math.abs(raw - f) / f < 0.05);
    return snap || raw;
  }

  function drawCalib() {
    cctx.drawImage(hiddenVideo, 0, 0, S.W, S.H);
    const lw = Math.max(2, S.W / 400);
    cctx.lineWidth = lw;
    if (S.target) {
      const side = S.roiFrac * Math.min(S.W, S.H), [tx, ty] = S.target;
      cctx.strokeStyle = "#C9A45C"; cctx.lineWidth = lw * 1.4;
      cctx.strokeRect(tx - side / 2, ty - side / 2, side, side);
      cctx.beginPath(); cctx.moveTo(tx - lw * 5, ty); cctx.lineTo(tx + lw * 5, ty); cctx.moveTo(tx, ty - lw * 5); cctx.lineTo(tx, ty + lw * 5); cctx.stroke();
    }
    if (S.phase === "calib") {
      S.calibPts.forEach((p, i) => {
        cctx.fillStyle = "#C9A45C"; cctx.strokeStyle = "#fff";
        cctx.beginPath(); cctx.arc(p[0], p[1], lw * 4, 0, 7); cctx.fill(); cctx.stroke();
        if (S.action === "sprint" && i === 1) { cctx.strokeStyle = "#C9A45C"; cctx.beginPath(); cctx.moveTo(...S.calibPts[0]); cctx.lineTo(...p); cctx.stroke(); }
      });
      if (S.action === "clean" && S.calibPts.length === 2) {
        const [c, e] = S.calibPts, r = Math.hypot(e[0] - c[0], e[1] - c[1]);
        cctx.strokeStyle = "#C9A45C"; cctx.lineWidth = lw * 1.5; cctx.beginPath(); cctx.arc(c[0], c[1], r, 0, 7); cctx.stroke();
      }
    }
  }
  function calibText() {
    const n = Math.round((S.end - S.start) * S.fpsFile);
    $("rangeInfo").innerHTML = `片段 <span class="n">${(S.end - S.start).toFixed(2)}</span> 秒　<span class="n">${n}</span> 帧`;
    const sel = $("rangeSel");
    sel.style.left = (S.start / S.duration * 100) + "%"; sel.style.width = ((S.end - S.start) / S.duration * 100) + "%";
    const perFrame = 0.12;
    $("calibWarn").innerHTML = n * perFrame > 60 ? `<div class="msg"><b>片段较长，</b>${n} 帧预计要处理 ${Math.round(n * perFrame / 60)} 分钟左右。建议只保留运动员经过的部分。</div>` : "";
  }
  function setCalibHead(t) { $("calibHead").style.left = (t / S.duration * 100) + "%"; $("calibTime").textContent = t.toFixed(3) + " s"; }
  async function enterCalib() {
    cc.width = S.W; cc.height = S.H;
    $("calibScrub").max = 1000;
    $("calibScrub").value = Math.round(S.start / S.duration * 1000);
    setCalibHead(S.start);
    show("calib");
    updateCalibUI();
    await seek(hiddenVideo, S.phase === "range" ? hiddenVideo.currentTime || S.start : S.start + 0.5 / S.fpsFile);
    drawCalib();
  }
  function updateCalibUI() {
    const range = S.phase === "range", pick = S.phase === "pick";
    $("roiRow").hidden = !pick || !S.target;
    if (pick) {
      $("calibTitle").textContent = "选择运动员";
      if (!S.target) $("calibHint").textContent = "点一下要分析的运动员（点在腰部附近）。App 会自动找到他并调好框的大小，之后金色框会一直跟着他。";
      $("rangeControls").hidden = true; $("calibControls").hidden = false;
      $("skipCalib").hidden = false; $("skipCalib").textContent = S.target ? "不用框，分析整个画面" : "跳过，分析整个画面";
      $("undoPt").textContent = "重新选";
      $("calibRuler").style.pointerEvents = "none"; $("calibRuler").style.opacity = "0.45";
      $("calibNext").textContent = S.action === "general" ? "开始分析" : "下一步：标定";
      $("calibNext").disabled = !S.target;
      calibText(); return;
    }
    $("undoPt").textContent = "撤销"; $("skipCalib").textContent = "不标定，直接分析";
    $("calibTitle").textContent = range ? "选择片段" : (S.action === "sprint" ? "标定距离" : "标定杠铃片");
    $("calibHint").textContent = range ? "拖动时间尺，把起点设在运动员入画前、终点设在出画后。高翻的终点设在接杠站稳后。"
      : S.action === "sprint" ? `在画面上依次点两个标志桶的底部（间距 ${S.markerDist} 米）。不标定也能算触地时间，但算不了步长和速度。`
      : S.calibPts.length === 0 ? "先点杠铃片的中心。" : S.calibPts.length === 1 ? "再点杠铃片的边缘。" : "绿圈应该正好套住杠铃片。不对就撤销重点。";
    $("rangeControls").hidden = !range; $("calibControls").hidden = range;
    $("skipCalib").hidden = S.action !== "sprint";
    $("calibRuler").style.pointerEvents = range ? "" : "none";
    $("calibRuler").style.opacity = range ? "1" : "0.45";
    $("calibNext").textContent = range ? "下一步：选择运动员" : "开始分析";
    $("calibNext").disabled = !range && ((S.action === "clean" && S.calibPts.length < 2) || (S.action === "sprint" && S.calibPts.length === 1));
    calibText();
  }
  $("calibScrub").oninput = async e => {
    const t = S.duration * e.target.value / 1000;
    setCalibHead(t);
    if (S.seeking) { S.pendingSeek = t; return; }
    S.seeking = true;
    await seek(hiddenVideo, t); drawCalib();
    while (S.pendingSeek != null) { const p = S.pendingSeek; S.pendingSeek = null; await seek(hiddenVideo, p); drawCalib(); }
    S.seeking = false;
  };
  $("setStart").onclick = () => { S.start = Math.min(hiddenVideo.currentTime, S.end - 0.1); calibText(); toast("已设起点 " + S.start.toFixed(2) + " s"); };
  $("setEnd").onclick = () => { S.end = Math.max(hiddenVideo.currentTime, S.start + 0.1); calibText(); toast("已设终点 " + S.end.toFixed(2) + " s"); };
  cc.addEventListener("pointerdown", e => {
    const b = cc.getBoundingClientRect();
    const p = [(e.clientX - b.left) * S.W / b.width, (e.clientY - b.top) * S.H / b.height];
    if (S.phase === "pick") { S.target = p; drawCalib(); updateCalibUI(); autoFitTarget(p); return; }
    if (S.phase !== "calib") return;
    if (S.calibPts.length >= 2) S.calibPts = [];
    S.calibPts.push(p);
    drawCalib(); updateCalibUI();
  });
  // 点选后自动适配框：从很小到整个画面逐级尝试，取“点击位置附近确实识别到人”的最小框
  async function autoFitTarget(p) {
    const token = (S.fitToken = (S.fitToken || 0) + 1);
    $("calibHint").textContent = "正在寻找运动员…（第一次需要加载识别程序）";
    let lm;
    try { lm = await getLandmarker(() => {}); } catch (e) { $("calibHint").textContent = "识别程序还没准备好，先按默认框分析；也可以用滑块手动调整框的大小。"; return; }
    if (token !== S.fitToken) return;
    const minSide = Math.min(S.W, S.H), kv = S.vw / S.W, CROP = 512;
    const rc = document.createElement("canvas"); rc.width = rc.height = CROP; const rctx = rc.getContext("2d");
    const imageMode = typeof lm.detect === "function" && typeof lm.setOptions === "function";
    if (imageMode) { try { await lm.setOptions({ runningMode: "IMAGE" }); } catch (e) { /* 忽略 */ } }
    let found = null;
    try {
      for (const frac of [0.06, 0.09, 0.13, 0.18, 0.25, 0.35, 0.5, 0.75, 1.0]) {
        const side = Math.min(frac * minSide, S.W, S.H);
        const sx = Math.max(0, Math.min(S.W - side, p[0] - side / 2)), sy = Math.max(0, Math.min(S.H - side, p[1] - side / 2));
        rctx.drawImage(hiddenVideo, sx * kv, sy * kv, side * kv, side * kv, 0, 0, CROP, CROP);
        let r;
        if (imageMode) r = lm.detect(rc);
        else { lmClock += 1000; r = lm.detectForVideo(rc, lmClock); }
        for (const l of (r.landmarks || [])) {
          const f = l.map(q => [sx + q.x * side, sy + q.y * side]);
          const hx = (f[23][0] + f[24][0]) / 2, hy = (f[23][1] + f[24][1]) / 2;
          const ys = f.map(q => q[1]), hgt = Math.max(...ys) - Math.min(...ys);
          if (Math.hypot(hx - p[0], hy - p[1]) < Math.max(0.6 * side, hgt) && hgt > 0.2 * side) { found = { hx, hy, hgt }; break; }
        }
        if (found) break;
      }
    } finally { if (imageMode) { try { await lm.setOptions({ runningMode: "VIDEO" }); } catch (e) { /* 忽略 */ } } }
    if (token !== S.fitToken || S.phase !== "pick") return;
    if (found) {
      S.target = [found.hx, found.hy];
      S.roiFrac = Math.max(0.06, Math.min(1, 2.4 * found.hgt / minSide));
      $("roiSize").value = Math.round(S.roiFrac * 100);
      drawCalib(); updateCalibUI();
      $("calibHint").textContent = `已找到运动员（画面中约 ${Math.round(found.hgt)} 像素高），框已自动调好。`;
    } else {
      $("calibHint").textContent = "在点的位置没找到人。请点在运动员身体上（腰部附近），或拖动滑块把框调小后再点一次。";
    }
  }
  $("undoPt").onclick = () => { if (S.phase === "pick") { S.target = null; } else S.calibPts.pop(); drawCalib(); updateCalibUI(); };
  $("skipCalib").onclick = async () => {
    if (S.phase === "pick") { S.target = null; if (S.action === "general") { runAnalysis(); return; } S.phase = "calib"; S.calibPts = []; await enterCalib(); return; }
    S.calibPts = []; runAnalysis();
  };
  $("roiSize").oninput = e => { S.roiFrac = Number(e.target.value) / 100; drawCalib(); };
  $("calibNext").onclick = async () => {
    if (S.phase === "range") { S.phase = "pick"; S.target = null; S.roiFrac = S.roiFrac || 0.35; $("roiSize").value = Math.round(S.roiFrac * 100); await enterCalib(); return; }
    if (S.phase === "pick") { if (S.action === "general") { S.calibPts = []; runAnalysis(); return; } S.phase = "calib"; S.calibPts = []; await enterCalib(); return; }
    if (S.action === "sprint" && S.calibPts.length === 1) { toast("还差一个标志桶"); return; }
    runAnalysis();
  };

  // ---------------- 姿态模型 ----------------
  let landmarkerP = null, loadLog = [], lmClock = 0;
  const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(what + "超时")), ms))]);
  const stageErr = stage => Object.assign(new Error(stage), { stage });
  const MODEL_MIN_BYTES = 1_000_000;
  const isZip = buf => { const b = new Uint8Array(buf, 0, 4); return b[0] === 0x50 && b[1] === 0x4B; };

  // 检查 .task（ZIP）结构是否完整：末尾目录记录、中央目录、里面有没有 .tflite
  // 检查 .task（ZIP）结构是否完整。直接按字节读取，不用 DataView（Safari 对下载得到的数据会报错）
  function zipCheck(buf) {
    let u;
    try { u = buf instanceof Uint8Array ? buf : new Uint8Array(buf); } catch (e) { return { ok: false, reason: "无法读取文件内容" }; }
    const n = u.length;
    const u16 = i => u[i] | (u[i + 1] << 8);
    const u32 = i => (u[i] | (u[i + 1] << 8) | (u[i + 2] << 16) | (u[i + 3] << 24)) >>> 0;
    if (n < 22) return { ok: false, reason: "文件太小" };
    if (u32(0) !== 0x04034b50) return { ok: false, reason: "开头不是 ZIP 文件头" };
    let e = -1;
    for (let i = n - 22; i >= Math.max(0, n - 65557); i--) if (u[i] === 0x50 && u32(i) === 0x06054b50) { e = i; break; }
    if (e < 0) return { ok: false, reason: "找不到 ZIP 结尾目录，文件被截断或损坏" };
    const count = u16(e + 10), cdSize = u32(e + 12), cdOff = u32(e + 16);
    if (cdOff + cdSize > e) return { ok: false, reason: "ZIP 目录位置对不上，文件内容被改动过（常见于换行符转换）" };
    const names = [];
    let p = cdOff;
    for (let k = 0; k < count; k++) {
      if (p + 46 > n || u32(p) !== 0x02014b50) return { ok: false, reason: "ZIP 目录记录损坏" };
      const nl = u16(p + 28), xl = u16(p + 30), cl = u16(p + 32), lho = u32(p + 42);
      if (lho + 4 > n || u32(lho) !== 0x04034b50) return { ok: false, reason: "ZIP 内文件位置错乱，文件内容被改动过" };
      let name = ""; for (let j = 0; j < nl; j++) name += String.fromCharCode(u[p + 46 + j]);
      names.push(name);
      p += 46 + nl + xl + cl;
    }
    if (!names.some(s => s.endsWith(".tflite"))) return { ok: false, reason: "ZIP 里没有模型（.tflite）" };
    return { ok: true, names };
  }
  function safeZipCheck(buf) { try { return zipCheck(buf); } catch (e) { return { ok: false, reason: "检查时出错：" + errText(e) }; } }

  // 模型候选：本机保存 → 你的网站 → Google。每个都先检查 ZIP 结构，坏的跳过
  async function* modelCandidates(onStatus) {
    try {
      const rec = await dbGet("files", "pose_model");
      if (rec && rec.bytes) {
        const z = safeZipCheck(rec.bytes);
        if (z.ok) yield { bytes: rec.bytes, from: "本机保存（" + (rec.from || "") + "）", cached: true };
        else { loadLog.push(`模型　本机保存的文件：${z.reason}，已删除`); await dbDel("files", "pose_model"); }
      }
    } catch (e) { /* 继续 */ }
    for (const m of MODEL_SOURCES) {
      onStatus && onStatus(`正在下载姿态模型（${m.name}）`);
      let buf;
      try {
        const r = await withTimeout(fetch(m.url, { cache: "no-store" }), 90000, "下载");
        if (!r.ok) { loadLog.push(`模型　${m.name}：${r.status === 404 ? "找不到这个文件（404），仓库里没有它" : "服务器返回错误 " + r.status}`); continue; }
        buf = await withTimeout(r.arrayBuffer(), 120000, "下载");
      } catch (e) { loadLog.push(`模型　${m.name}：连不上${m.name === "Google" ? "（国内网络通常访问不了）" : ""}（${errText(e)}）`); continue; }
      if (buf.byteLength < 1000 && new TextDecoder().decode(new Uint8Array(buf, 0, 7)) === "version") { loadLog.push(`模型　${m.name}：这是 Git LFS 占位文件（${buf.byteLength} 字节），GitHub Pages 不提供真实文件`); continue; }
      const z = safeZipCheck(buf);
      if (!z.ok) { loadLog.push(`模型　${m.name}：文件已损坏（${z.reason}，${(buf.byteLength / 1e6).toFixed(2)} MB）`); continue; }
      yield { bytes: buf, from: m.name, cached: false };
    }
  }

  const errText = e => (e && (e.message || e.type || (typeof e === "string" ? e : ""))) || (() => { try { return JSON.stringify(e); } catch (x) { return String(e); } })();

  function getLandmarker(onStatus) {
    if (landmarkerP) return landmarkerP;
    loadLog = [];
    landmarkerP = (async () => {
      const libs = [];                       // 已加载的运算库（按来源）
      let libTried = 0;
      async function nextLib() {
        while (libTried < LIB_SOURCES.length) {
          const c = LIB_SOURCES[libTried++];
          onStatus && onStatus(`正在加载运算库（${c.name}）`);
          try { const L = { src: c, lib: await withTimeout(import(c.bundle), 20000, "下载") }; libs.push(L); return L; }
          catch (e) { loadLog.push(`运算库　${c.name}：${errText(e)}`); }
        }
        return null;
      }
      const isModelErr = t => /zip archive|model asset|flatbuffer|Invalid model|tflite/i.test(t);
      async function tryStart(L, w, bytes) {
        let fileset;
        try { fileset = await withTimeout(L.lib.FilesetResolver.forVisionTasks(w.wasm), 15000, "准备"); }
        catch (e) { fileset = { wasmLoaderPath: `${w.wasm}/vision_wasm_internal.js`, wasmBinaryPath: `${w.wasm}/vision_wasm_internal.wasm` }; }
        let modelBad = false;
        for (const delegate of ["GPU", "CPU"]) {
          onStatus && onStatus(`正在启动识别（${w.name}${delegate === "CPU" ? "，兼容模式" : ""}）`);
          try {
            const lm = await withTimeout(L.lib.PoseLandmarker.createFromOptions(fileset, {
              baseOptions: { modelAssetBuffer: new Uint8Array(bytes), delegate }, runningMode: "VIDEO", numPoses: 2,
              minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
            }), 60000, "启动");
            loadLog.push(`成功：运算库 ${L.src.name} + 运行环境 ${w.name} + ${delegate}`);
            return { lm };
          } catch (e) {
            const t = errText(e).split("=== Source Location")[0].trim();
            loadLog.push(`运行环境　库:${L.src.name}　环境:${w.name}　${delegate}：${t}`);
            if (isModelErr(t)) { modelBad = true; break; }   // 模型本身坏了，换运行环境也没用
          }
        }
        return { modelBad };
      }

      let gotModel = false, runtimeOnly = true;
      for await (const M of modelCandidates(onStatus)) {
        gotModel = true;
        let modelBad = false;
        // 先用已加载的库 + 同源运行环境；没有就加载下一个库
        const pairs = async function* () {
          for (const L of libs) yield [L, L.src];
          let L; while ((L = await nextLib())) yield [L, L.src];
          for (const L2 of libs) for (const w of LIB_SOURCES) if (w !== L2.src) yield [L2, w];
        };
        for await (const [L, w] of pairs()) {
          const r = await tryStart(L, w, M.bytes);
          if (r.lm) {
            if (!M.cached) { try { await dbPut("files", { id: "pose_model", bytes: M.bytes, from: M.from, saved: new Date().toISOString() }); } catch (e) { /* 忽略 */ } }
            return r.lm;
          }
          if (r.modelBad) { modelBad = true; break; }
        }
        if (!modelBad) { runtimeOnly = true; break; }            // 模型没问题，是运行环境的问题
        loadLog.push(`模型　${M.from}：识别程序打不开这个模型文件，换下一个来源`);
        if (M.cached) { try { await dbDel("files", "pose_model"); } catch (e) { /* 忽略 */ } }
        runtimeOnly = false;
      }
      if (!libs.length && libTried >= LIB_SOURCES.length) throw stageErr("lib");
      if (!gotModel || !runtimeOnly) throw stageErr("model");
      throw stageErr("runtime");
    })();
    landmarkerP.catch(() => { landmarkerP = null; });
    return landmarkerP;
  }

  // ---------- 识别环境自检：一屏看清哪一环出问题 ----------
  async function diagnose() {
    const rows = [];
    const ok = (name, good, detail) => rows.push({ name, good, detail });
    const ua = navigator.userAgent, ios = (ua.match(/OS (\d+)_(\d+)/) || []).slice(1).join(".");
    ok("系统", true, ios ? `iOS ${ios}` : ua.slice(0, 60));
    ok("WebAssembly", typeof WebAssembly === "object", typeof WebAssembly === "object" ? "支持" : "不支持");
    let simd = false;
    try { simd = WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11])); } catch (e) { /* 忽略 */ }
    ok("SIMD", simd, simd ? "支持" : "不支持（需要 nosimd 版本的运行环境文件）");
    let gl = false; try { gl = !!document.createElement("canvas").getContext("webgl2"); } catch (e) { /* 忽略 */ }
    ok("WebGL2", gl, gl ? "支持（可用 GPU 模式）" : "不支持（只能用兼容模式）");
    const check = async (file, min, magic) => {
      try {
        const r = await withTimeout(fetch(new URL(file, location.href).href, { cache: "no-store" }), 30000, "下载");
        if (!r.ok) return ok(file, false, r.status === 404 ? "仓库里没有这个文件（404）" : `服务器返回 ${r.status}`);
        const buf = await r.arrayBuffer(), b = new Uint8Array(buf.slice(0, 8));
        const head = [...b.slice(0, 4)].map(x => x.toString(16).padStart(2, "0")).join(" ");
        const text = new TextDecoder().decode(b);
        if (text.startsWith("version")) return ok(file, false, `这是 Git LFS 占位文件（${buf.byteLength} 字节），不是真实文件。GitHub Pages 不提供 LFS 文件，需要取消 LFS 直接提交`);
        if (buf.byteLength < min) return ok(file, false, `只有 ${(buf.byteLength / 1024).toFixed(0)} KB，文件不完整`);
        if (magic && !magic(b)) return ok(file, false, `文件头 ${head} 不对，文件已损坏或不是这个格式`);
        ok(file, true, `${(buf.byteLength / 1e6).toFixed(2)} MB`);
      } catch (e) { ok(file, false, `读取失败：${errText(e)}`); }
    };
    await check("vision_bundle.mjs", 50000);
    await check("vision_wasm_internal.js", 50000);
    await check("vision_wasm_internal.wasm", 1000000, b => b[0] === 0 && b[1] === 0x61 && b[2] === 0x73 && b[3] === 0x6d);
    try {
      const r = await withTimeout(fetch(new URL("pose_landmarker_full.task", location.href).href, { cache: "no-store" }), 30000, "下载");
      if (!r.ok) ok("pose_landmarker_full.task", false, r.status === 404 ? "仓库里没有这个文件（404）" : `服务器返回 ${r.status}`);
      else { const buf = await r.arrayBuffer(), z = safeZipCheck(buf); ok("pose_landmarker_full.task", z.ok, z.ok ? `${(buf.byteLength / 1e6).toFixed(2)} MB，结构完整` : `${(buf.byteLength / 1e6).toFixed(2)} MB，${z.reason}`); }
    } catch (e) { ok("pose_landmarker_full.task", false, `读取失败：${errText(e)}`); }
    try {
      const rec = await dbGet("files", "pose_model");
      if (rec && rec.bytes) { const z = safeZipCheck(rec.bytes); ok("本机保存的模型", z.ok, `${(rec.bytes.byteLength / 1e6).toFixed(2)} MB，来自${rec.from}${z.ok ? "" : "，" + z.reason}`); }
      else ok("本机保存的模型", true, "还没有");
    } catch (e) { /* 忽略 */ }
    return rows;
  }
  function diagHtml(rows) {
    return `<p style="margin:14px 0 6px;font-weight:600">识别环境自检</p><table class="cmp">${rows.map(r => `<tr><td style="width:40%">${esc(r.name)}</td><td style="text-align:left;font-family:var(--font);font-size:13px;color:${r.good ? "var(--muted)" : "var(--red)"}">${r.good ? "✓ " : "✗ "}${esc(r.detail)}</td></tr>`).join("")}</table>`;
  }
  async function clearCachesAndRetry() {
    try { await dbDel("files", "pose_model"); } catch (e) { /* 忽略 */ }
    try { for (const k of await caches.keys()) await caches.delete(k); } catch (e) { /* 忽略 */ }
    landmarkerP = null;
    toast("已清除缓存，重新下载");
    runAnalysis();
  }

  // 从“文件”App 导入模型
  async function importModelFile(file) {
    if (!file) return false;
    const buf = await file.arrayBuffer();
    if (buf.byteLength < MODEL_MIN_BYTES) { toast("这个文件太小，不是姿态模型"); return false; }
    const z = safeZipCheck(buf);
    if (!z.ok) { toast(`这个文件不能用：${z.reason}`); return false; }
    await dbPut("files", { id: "pose_model", bytes: buf, from: "手动导入", saved: new Date().toISOString() });
    landmarkerP = null;
    toast(`模型已保存到本机（${(buf.byteLength / 1e6).toFixed(1)} MB）`);
    renderModelState();
    return true;
  }
  async function renderModelState() {
    try {
      const rec = await dbGet("files", "pose_model");
      $("modelState").innerHTML = rec && rec.bytes ? `<b>已保存在本机</b>　${(rec.bytes.byteLength / 1e6).toFixed(1)} MB，来自${esc(rec.from || "")}` : "还没有保存。第一次分析时会自动下载";
    } catch (e) { $("modelState").textContent = "无法读取"; }
  }
  $("runDiag").onclick = async () => { $("diagHome").innerHTML = `<p class="lead" style="font-size:13px;margin:10px 0 0">正在检查…</p>`; $("diagHome").innerHTML = diagHtml(await diagnose()); };
  $("modelFile").onchange = async e => {
    const ok = await importModelFile(e.target.files[0]);
    e.target.value = "";
    if (ok && $("v-process").classList.contains("on")) runAnalysis();
  };

  // ---------------- 逐帧分析 ----------------
  const pc = $("procCanvas");
  async function runAnalysis() {
    if (window.CM_PREVIEW) {
      show("process");
      $("procHead").hidden = true; $("procStage").hidden = true; $("procError").hidden = false;
      $("procError").innerHTML = `<h3>预览版不能做视频识别</h3><p>这个链接是设计与功能预览，所在平台的安全策略不允许加载姿态识别程序。运动员档案、训练计划、项目技术库都可以正常使用。</p>
        <p>视频分析请打开正式版：</p><p><a href="https://shumingzhang325-gif.github.io/coachmind/" style="color:var(--green);word-break:break-all">shumingzhang325-gif.github.io/coachmind</a></p>`;
      $("retryProc").hidden = true; $("cancelProc").textContent = "返回";
      return;
    }
    show("process");
    S.processing = true; S.cancel = false;
    pc.width = S.W; pc.height = S.H;
    const pctx = pc.getContext("2d", { willReadFrequently: true });
    $("procBar").style.width = "0%"; $("procPct").innerHTML = `0<small>%</small>`;
    $("procStage").hidden = true; $("procError").hidden = true; $("procHead").hidden = false;
    $("retryProc").hidden = true; $("cancelProc").textContent = "取消";
    let lm;
    try { lm = await getLandmarker(t => { $("procStatus").textContent = t + "…"; }); }
    catch (e) {
      S.processing = false;
      const stage = e.stage || "internal";
      $("procHead").hidden = true;
      $("procError").hidden = false;
      const detail = `<div id="diagBox"><p class="lead" style="font-size:13px;margin:12px 0 0">正在自检识别环境…</p></div>
        <details open style="margin-top:12px"><summary style="color:var(--muted);font-size:14px;cursor:pointer">详细日志（截图发给开发者）</summary><code>${loadLog.map(esc).join("<br>") || esc(errText(e))}</code></details>
        <button class="btn" id="clearRetry" style="width:100%;margin-top:12px">清除缓存后重新下载</button>`;
      const T = {
        lib: `<h3>运算库没有加载成功</h3><p>App 从你的网站和几个镜像都没拿到运算库文件。</p>
          <ol><li>确认 GitHub 仓库里有 vision_bundle.mjs、vision_wasm_internal.js、vision_wasm_internal.wasm 三个文件（由“下载离线文件.bat”下载）</li><li>或者打开能访问国外网站的网络后点“重试”</li></ol>`,
        model: `<h3>没拿到姿态模型文件</h3>
          <p>识别需要模型文件 pose_landmarker_full.task（约 9 MB），App 试了这些地方都没拿到能用的：</p>
          <ul style="margin:6px 0 10px;padding-left:18px">${loadLog.filter(l => l.startsWith("模型")).map(l => `<li style="margin:4px 0">${esc(l.replace(/^模型　/, ""))}</li>`).join("")}</ul>
          <p style="font-weight:600;margin:12px 0 4px">解决办法（任选一个）</p>
          <ol><li><b>最快：</b>在能访问国外网站的网络下，用 Safari 打开首页“姿态识别模型”里的地址，下载到“文件”App，然后点下面的“从文件导入模型”</li>
          <li>让仓库里的 pose_landmarker_full.task 恢复正常（上面写着“你的网站”的那一行说明了它现在的问题）</li></ol>
          <label class="btn go" for="modelFile" style="margin-top:14px;width:100%">从文件导入模型</label>`,
        internal: `<h3>App 出错了</h3><p>这是 App 自身的程序错误，不是你的文件或网络问题。请把这一屏截图发给开发者：</p><p style="font-family:monospace;font-size:13px;color:var(--muted)">${esc(errText(e))}</p>`,
        runtime: `<h3>识别程序启动失败</h3><p>模型已经拿到，但识别程序没有启动起来。App 已经把所有来源组合都试过了。下面的自检表里标红的一项就是原因。</p>
          <ol><li>最常见：仓库里的运算库和运行环境文件版本不一致，或上传时被改坏（例如被存成了 Git LFS 占位文件）。按自检结果重新上传那几个文件</li><li>点“清除缓存后重新下载”，排除手机里缓存了坏文件的可能</li><li>还不行就把这一整屏截图发给开发者</li></ol>`,
      };
      $("procError").innerHTML = T[stage] + detail;
      $("clearRetry").onclick = clearCachesAndRetry;
      diagnose().then(rows => { const b = $("diagBox"); if (b) b.innerHTML = diagHtml(rows); });
      $("retryProc").hidden = false; $("cancelProc").textContent = "返回";
      return;
    }
    $("procStage").hidden = false;
    const N = Math.max(2, Math.round((S.end - S.start) * S.fpsFile));
    const pose = new Array(N).fill(null), bar = S.action === "clean" ? new Array(N).fill([NaN, NaN]) : null;
    let tracker = null, lastMT = null, dupes = 0;
    const runBase = lmClock + 1000;
    const t0 = performance.now();
    // 跟踪框：裁剪运动员周围区域放大到 512 像素再识别
    const CROP = 512, rc = document.createElement("canvas"); rc.width = rc.height = CROP;
    const rctx = rc.getContext("2d");
    const minSide = Math.min(S.W, S.H), kv = S.vw / S.W;
    let tcx = S.target ? S.target[0] : null, tcy = S.target ? S.target[1] : null, tside = S.target ? (S.roiFrac || 0.35) * minSide : 0, tvx = 0, tvy = 0, lost = 0;
    let prevHip = null, prevH = null;
    const roiBoxes = new Array(N).fill(null);
    // 重复帧检测：缩成 48×27 灰度图比较
    const SGW = 256, SGH = 144, sg = document.createElement("canvas"); sg.width = SGW; sg.height = SGH;
    const sgx = sg.getContext("2d", { willReadFrequently: true });
    let prevSig = null, sameFrames = 0;
    for (let i = 0; i < N; i++) {
      if (S.cancel) { S.processing = false; toast("已取消"); show("calib", false); return; }
      const mt = await seek(hiddenVideo, S.start + (i + 0.5) / S.fpsFile);
      if (mt != null && lastMT != null && Math.abs(mt - lastMT) < 1e-6) dupes++;
      if (mt != null) lastMT = mt;
      pctx.drawImage(hiddenVideo, 0, 0, S.W, S.H);
      sgx.drawImage(hiddenVideo, 0, 0, SGW, SGH);
      const sd = sgx.getImageData(0, 0, SGW, SGH).data;
      // 数“明显变化”的像素：少于 4 个就算和上一帧完全相同（小目标移动也能被察觉）
      if (prevSig) { let changed = 0; for (let k = 0; k < sd.length && changed < 4; k += 4) if (Math.abs(sd[k] - prevSig[k]) > 10 || Math.abs(sd[k + 1] - prevSig[k + 1]) > 10 || Math.abs(sd[k + 2] - prevSig[k + 2]) > 10) changed++; if (changed < 4) sameFrames++; }
      prevSig = sd;
      let ts = Math.max(lmClock + 1, runBase + Math.round(i * 1000 / S.fpsReal)); lmClock = ts;
      try {
        let cands = [];
        if (S.target) {
          const side = Math.min(tside, S.W, S.H);
          const sx = Math.max(0, Math.min(S.W - side, tcx - side / 2)), sy = Math.max(0, Math.min(S.H - side, tcy - side / 2));
          roiBoxes[i] = [sx, sy, side];
          rctx.drawImage(hiddenVideo, sx * kv, sy * kv, side * kv, side * kv, 0, 0, CROP, CROP);
          const r = lm.detectForVideo(rc, ts);
          cands = (r.landmarks || []).map(l => l.map(p => [sx + p.x * side, sy + p.y * side, p.visibility == null ? 1 : p.visibility]));
        } else {
          const r = lm.detectForVideo(pc, ts);
          cands = (r.landmarks || []).map(l => l.map(p => [p.x * S.W, p.y * S.H, p.visibility == null ? 1 : p.visibility]));
        }
        const hipOf = f => [(f[23][0] + f[24][0]) / 2, (f[23][1] + f[24][1]) / 2];
        const heightOf = f => { const ys = f.map(p => p[1]); return Math.max(...ys) - Math.min(...ys); };
        // 按“预测位置”选人：上一帧位置 + 速度。站着不动的旁观者不会和预测一致
        const base = S.target ? [tcx, tcy] : prevHip;
        const pred = base ? [base[0] + tvx, base[1] + tvy] : null;
        let best = null, ambiguous = false;
        if (cands.length) {
          if (pred) {
            const cost = f => Math.hypot(hipOf(f)[0] - pred[0], hipOf(f)[1] - pred[1]) + (prevH ? 0.5 * Math.abs(heightOf(f) - prevH) : 0);
            const sorted = cands.slice().sort((x, y) => cost(x) - cost(y));
            best = sorted[0];
            if (sorted[1]) { const c0 = cost(sorted[0]), c1 = cost(sorted[1]); ambiguous = c1 < 1.5 * c0 + 2 && c1 < 0.5 * (prevH || heightOf(best)); }
          } else best = cands.reduce((b, f) => (heightOf(f) > heightOf(b) ? f : b));
        }
        if (best) {
          pose[i] = best;
          const h = hipOf(best), bh = heightOf(best);
          if (base && !ambiguous) { tvx = 0.5 * (h[0] - base[0]) + 0.5 * tvx; tvy = 0.5 * (h[1] - base[1]) + 0.5 * tvy; }
          if (S.target) {
            // 交叉时（两个人一样近）按原速度继续走，不被旁人带偏
            if (ambiguous) { tcx += tvx; tcy += tvy; } else { tcx = h[0]; tcy = h[1]; }
            tside = 0.8 * tside + 0.2 * Math.max(0.12 * minSide, Math.min(minSide, 2.6 * bh));
            lost = 0;
          }
          prevHip = ambiguous && base ? [base[0] + tvx, base[1] + tvy] : h;
          prevH = prevH ? 0.8 * prevH + 0.2 * bh : bh;
        } else if (S.target) { tcx += tvx; tcy += tvy; tside = Math.min(minSide, tside * 1.08); lost++; }
      } catch (e) { /* 单帧失败跳过 */ }
      if (bar) {
        const img = pctx.getImageData(0, 0, S.W, S.H).data, g = new Uint8Array(S.W * S.H);
        for (let j = 0, k = 0; j < g.length; j++, k += 4) g[j] = (img[k] * 77 + img[k + 1] * 150 + img[k + 2] * 29) >> 8;
        if (i === 0) {
          const [c, e] = S.calibPts;
          tracker = new CM.PlateTracker(g, S.W, S.H, c[0], c[1], Math.hypot(e[0] - c[0], e[1] - c[1]));
          bar[0] = [c[0], c[1]];
        } else bar[i] = tracker.update(g);
      }
      if (i % 4 === 0 || i === N - 1) {
        drawOverlay(pctx, pose[i], { bar, i, scale: 1 });
        if (roiBoxes[i]) { const [bx, by, bs] = roiBoxes[i]; pctx.strokeStyle = "#C9A45C"; pctx.lineWidth = Math.max(2, S.W / 400); pctx.strokeRect(bx, by, bs, bs); }
        const el = (performance.now() - t0) / 1000, left = el / (i + 1) * (N - i - 1);
        $("procBar").style.width = ((i + 1) / N * 100).toFixed(1) + "%";
        $("procPct").innerHTML = `${Math.floor((i + 1) / N * 100)}<small>%</small>`;
        $("procStatus").textContent = `第 ${i + 1} 帧，共 ${N} 帧　还需约 ${Math.ceil(left)} 秒`;
        await sleep(0);
      }
    }
    S.processing = false;
    S.pose = pose; S.bar = bar; S.N = N; S.dupes = dupes; S.sameFrames = sameFrames;
    S.detectedRatio = pose.filter(Boolean).length / Math.max(1, N);
    const detected = pose.filter(Boolean).length / N;
    computeResult(detected);
    S.saved = false; S.savedId = null; S.verdicts = {}; S.coachNote = "";
    showResult(true);
  }
  $("cancelProc").onclick = () => { if (S.processing) S.cancel = true; else show("calib", false); };
  $("retryProc").onclick = () => runAnalysis();

  function computeResult(detected) {
    let scale = null;
    if (S.action === "sprint" && S.calibPts.length === 2 && S.markerDist) {
      const [a, b] = S.calibPts; scale = S.markerDist / Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    if (S.action === "clean") { const [c, e] = S.calibPts; scale = CM.PLATE_DIAMETER_M / (2 * Math.hypot(e[0] - c[0], e[1] - c[1])); }
    const dupRatio = S.N ? (S.sameFrames || 0) / S.N : 0;
    let fpsNote = null;
    if (dupRatio > 0.2 && S.fpsReal > S.fpsFile * 1.5) {
      fpsNote = `有 ${Math.round(dupRatio * 100)}% 的帧和前一帧完全相同，这是实时录制的视频（例如屏幕录制、网络视频），不是慢动作原片。已改按文件实际帧率 ${Math.round(S.fpsFile)} fps 计算。触地时间这类毫秒级指标在低帧率下不可靠，步频（节奏）仍可参考。`;
      S.fpsReal = Math.round(S.fpsFile);
    } else if (dupRatio > 0.2) fpsNote = `有 ${Math.round(dupRatio * 100)}% 的帧是重复画面，原视频帧率偏低，时间类指标误差较大。`;
    const fs = S.fpsReal;
    S.scale = scale;
    S.result = S.action === "sprint" ? CM.analyzeSprint(S.pose, fs, TH, scale)
      : S.action === "general" ? CM.analyzeGeneral(S.pose, fs, TH)
      : CM.analyzeClean(S.bar, fs, scale, TH, detected > 0.5 ? S.pose : null);
    if (fpsNote) S.result.notes.unshift(fpsNote);
    if (detected < 0.8) S.result.notes.unshift(`只有 ${Math.round(detected * 100)}% 的帧识别到人体，结果可能不完整。检查光线、遮挡和人物大小。`);
    if (S.dupes > S.N * 0.03) S.result.notes.unshift(`有 ${S.dupes} 帧读取重复，时间类指标可能偏差。`);
    if (S.fpsReal < 100) S.result.notes.unshift(`按 ${S.fpsReal} fps 计算，时间类指标误差较大。`);
    S.hits = CM.matchCards(S.result, TH, CARDS);
  }

  // ---------------- 绘制叠加层 ----------------
  function drawOverlay(ctx, p, o) {
    const s = o.scale || 1, lw = Math.max(2, (ctx.canvas.width / 360)) ;
    if (p) {
      ctx.lineWidth = lw; ctx.strokeStyle = "rgba(255,255,255,.95)";
      for (const [a, b] of CM.SKELETON) {
        if (!p[a] || !p[b]) continue;
        ctx.beginPath(); ctx.moveTo(p[a][0] * s, p[a][1] * s); ctx.lineTo(p[b][0] * s, p[b][1] * s); ctx.stroke();
      }
      ctx.fillStyle = "#C9A45C";
      for (let j = 11; j < 33; j++) if (p[j]) { ctx.beginPath(); ctx.arc(p[j][0] * s, p[j][1] * s, lw * 1.6, 0, 7); ctx.fill(); }
    }
    if (o.air) {
      ctx.fillStyle = "#FF6A4A"; ctx.font = `600 ${Math.round(lw * 9)}px ${getComputedStyle(document.body).fontFamily}`;
      ctx.fillText("腾空", lw * 6, lw * 14);
    }
    if (o.contactSide) {
      const S2 = CM.SIDES[o.contactSide];
      if (p && p[S2.foot]) { ctx.strokeStyle = "#FF6A4A"; ctx.lineWidth = lw * 1.5; ctx.beginPath(); ctx.arc(p[S2.foot][0] * s, p[S2.foot][1] * s, lw * 6, 0, 7); ctx.stroke(); }
      ctx.fillStyle = "#FF6A4A"; ctx.font = `600 ${Math.round(lw * 9)}px ${getComputedStyle(document.body).fontFamily}`;
      ctx.fillText(o.contactSide === "left" ? "左脚触地" : "右脚触地", lw * 6, lw * 14);
    }
    if (o.bar) {
      ctx.strokeStyle = "#FF6A4A"; ctx.lineWidth = lw * 1.2; ctx.beginPath();
      let started = false;
      for (let k = 0; k <= o.i && k < o.bar.length; k++) {
        const q = o.bar[k]; if (!q || !Number.isFinite(q[0])) continue;
        if (!started) { ctx.moveTo(q[0] * s, q[1] * s); started = true; } else ctx.lineTo(q[0] * s, q[1] * s);
      }
      ctx.stroke();
      const q = o.bar[Math.min(o.i, o.bar.length - 1)];
      if (q && Number.isFinite(q[0])) { ctx.fillStyle = "#FF6A4A"; ctx.beginPath(); ctx.arc(q[0] * s, q[1] * s, lw * 2.5, 0, 7); ctx.fill(); }
    }
  }

  // ---------------- 结果页 ----------------
  const pv = $("playVideo"), ov = $("playOverlay"), octx = ov.getContext("2d");
  let playing = false, contactByFrame = null;

  const BOARD = {
    sprint: ["contact_time_s", "step_length_m", "speed_mps"],
    sprintNoContact: ["cadence_spm", "cadence_swing_hz", "n_contacts"],
    clean: ["peak_bar_velocity_mps", "max_bar_height_m", "drop_under_m"],
    general: ["jump_height_cm", "flight_time_s", "landing_knee_min_deg"],
    generalNoJump: ["knee_min_deg", "hip_min_deg", "trunk_lean_max_deg"],
  };
  function showResult(live) {
    $("playerWrap").hidden = !live; $("noVideo").hidden = live;
    renderResultPanels();
    show("result");
    if (live) setupPlayer();
  }
  function renderResultPanels() {
    const R = S.result;
    const hitMetrics = new Set(S.hits.map(h => h.condition.metric));
    const d = new Date(S.date || Date.now());
    const [k0, k1, k2] = BOARD[S.action === "general" && R.summary.jump_height_cm == null ? "generalNoJump" : S.action === "sprint" && R.summary.contact_time_s == null && R.summary.cadence_spm != null ? "sprintNoContact" : S.action];
    const cell = k => { const v = R.summary[k]; const [name, unit] = CM.LABELS[k] || [k, ""]; return { v: v == null ? "–" : CM.fmt(v, unit), unit: v == null ? "" : unit, name, hit: hitMetrics.has(k) }; };
    const m0 = cell(k0), m1 = cell(k1), m2 = cell(k2);
    $("board").innerHTML = `<div class="who"><span>${esc(S.athleteName || "")}　${esc(actionLabel(S))}</span><span class="n">${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}</span></div>
      <div class="main"><b>${m0.v}</b><small>${m0.unit}</small></div>
      <div class="lbl ${m0.hit ? "hit" : ""}">${m0.name}${m0.hit ? "　偏离参考值" : ""}</div>
      <div class="sub">${[m1, m2].map(m => `<div class="${m.hit ? "hit" : ""}"><b>${m.v}<small>${m.unit}</small></b><span class="lbl">${m.name}</span></div>`).join("")}</div>`;
    $("resNotes").innerHTML = (R.notes || []).map(n => `<div class="msg">${esc(n)}</div>`).join("");
    $("metrics").innerHTML = Object.entries(R.summary).filter(([k]) => k !== "side_analyzed").map(([k, v]) => {
      const [name, unit] = CM.LABELS[k] || [k, ""];
      return `<div class="${hitMetrics.has(k) ? "hit" : ""}"><dt>${name}</dt><dd>${esc(CM.fmt(v, unit))}<small>${unit}</small></dd></div>`;
    }).join("") || `<div><dt>没有得到指标</dt><dd>–</dd></div>`;
    $("stepsBox").innerHTML = S.action === "sprint" && R.steps && R.steps.length ? `<h3 class="sec">逐步数据</h3><div class="tablewrap"><table class="steps">
      <tr><th>步</th><th>触地 s</th><th>腾空 s</th><th>步长 m</th><th>着地距离 m</th></tr>
      ${R.steps.map((s, i) => `<tr><td><span class="side" style="background:var(--lane-${s.side === "left" ? "l" : "r"})"></span>${i + 1}</td><td>${s.contact_time_s.toFixed(3)}</td><td>${s.flight_time_s != null ? s.flight_time_s.toFixed(3) : "–"}</td>
      <td>${s.step_length_m != null ? s.step_length_m.toFixed(2) : "–"}</td><td>${s.touchdown_distance_m != null ? s.touchdown_distance_m.toFixed(2) : "–"}</td></tr>`).join("")}
      </table></div>` : "";
    renderCards();
    $("coachNote").value = S.coachNote || "";
    $("deleteBtn").hidden = !S.savedId;
    $("saveBtn").textContent = S.savedId ? "更新" : "保存";

    contactByFrame = null;
    if (S.action === "sprint" && R.steps) {
      contactByFrame = new Map();
      R.steps.forEach(s => { for (let f = s.touchdown_frame; f <= s.toeoff_frame; f++) contactByFrame.set(f, s.side); });
    }
    renderStrip();
    renderCompare(); renderDebug(); setupMarking(); renderChecklist();
    if (S.detectedRatio != null && S.detectedRatio < 0.15 && S.file) {
      const box = document.createElement("div"); box.className = "msg"; box.style.cssText = "border-color:rgba(201,164,92,.5);background:rgba(201,164,92,.08)";
      box.innerHTML = `<b style="color:var(--gold)">几乎没识别到人（${Math.round(S.detectedRatio * 100)}% 的帧）</b><br>人在画面里太小或有其他人时，请回到上一步点一下运动员，App 会自动把框调到合适大小。<button class="btn go" id="rePick" style="width:100%;margin-top:12px">重新选择运动员</button>`;
      $("resNotes").prepend(box);
      $("rePick").onclick = async () => { S.phase = "pick"; S.target = null; show("calib"); await enterCalib(); };
    }
    $("toPlanBtn").hidden = !S.hits.length || !S.athleteId;
  }

  function renderCards() {
    $("cards").innerHTML = S.hits.length ? S.hits.map(h => {
      const v = S.verdicts[h.id] || "";
      return `<article class="dx" data-id="${h.id}">
        <div class="code">${h.id}</div>
        <h4>${esc(h.title)}</h4>
        ${h.safety_flag ? `<p class="safety">涉及伤病风险，须由教练或队医判断后再调整训练。</p>` : ""}
        <p class="sym">${esc(h.symptom_text)}</p>
        ${h.hypotheses.map(y => `<div class="hyp"><span class="ab">${esc(y.id)}</span><div><b>${esc(y.text)}</b>
          <div class="kv"><span>验证</span>${esc(y.test)}</div><div class="kv"><span>若成立</span>${esc(h.prescriptions[y.id] || "–")}</div></div></div>`).join("")}
        <details><summary>依据　${esc(h.evidence_level)}</summary>
          ${h.evidence.map(e => `<div class="ev">【${esc(e.type)}】${esc(e.citation)}${e.doi ? `<br><a href="https://doi.org/${esc(e.doi)}" target="_blank" rel="noopener">doi.org/${esc(e.doi)}</a>` : ""}<div class="sub">${esc(e.supports)}</div></div>`).join("")}
        </details>
        <div class="verdict" role="group" aria-label="教练判断">
          ${[["agree", "认同"], ["test", "先做测试"], ["disagree", "不认同"]].map(([k, t]) => `<button data-v="${k}" aria-pressed="${v === k}">${t}</button>`).join("")}
        </div>
      </article>`;
    }).join("") : `<div class="clear">各项指标都在参考范围内，没有触发问题规则。可以逐帧回看视频，把观察写进教练备注。</div>`;
    $("cards").querySelectorAll(".verdict button").forEach(b => b.onclick = () => {
      const id = b.closest(".dx").dataset.id;
      S.verdicts[id] = S.verdicts[id] === b.dataset.v ? "" : b.dataset.v;
      renderCards();
    });
  }

  // 触地条（短跑） / 杠铃轨迹与速度（高翻）
  function renderStrip() {
    const R = S.result, box = $("strip");
    if (S.action === "general") {
      const sr = R.series || {}; if (!sr.knee || !sr.knee.length) { box.innerHTML = ""; return; }
      const n = sr.knee.length, W = 600, H = 220, x = i => 34 + i / Math.max(1, n - 1) * (W - 40), y = v => 12 + (190 - v) / 190 * (H - 40);
      const line = (arr, c) => `<path d="${arr.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(Number.isFinite(v) ? v : 180).toFixed(1)}`).join("")}" fill="none" stroke="${c}" stroke-width="2.5" stroke-linejoin="round"/>`;
      let bands = "", s0 = -1;
      (sr.air || []).forEach((v, i) => { if (v && s0 < 0) s0 = i; if ((!v || i === n - 1) && s0 >= 0) { bands += `<rect x="${x(s0)}" y="6" width="${Math.max(2, x(i) - x(s0))}" height="${H - 34}" fill="color-mix(in srgb, var(--red) 16%, transparent)"/>`; s0 = -1; } });
      const grid = [60, 90, 120, 150, 180].map(v => `<line x1="34" x2="${W - 6}" y1="${y(v)}" y2="${y(v)}" stroke="var(--rule)"/><text x="2" y="${y(v) + 4}" font-size="12" fill="var(--muted)" font-family="DIN Alternate, Bahnschrift, sans-serif">${v}°</text>`).join("");
      box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" id="stripSvg" role="img" aria-label="关节角度曲线">${grid}${bands}
        ${line(sr.knee, "var(--green)")}${line(sr.hip, "var(--ink)")}${sr.elbow ? line(sr.elbow, "var(--muted)") : ""}
        <line id="playhead" x1="${x(0)}" x2="${x(0)}" y1="6" y2="${H - 28}" stroke="var(--red)" stroke-width="2.5"/>
        <text x="34" y="${H - 6}" font-size="13" fill="var(--green)">膝角</text><text x="84" y="${H - 6}" font-size="13" fill="var(--ink)">髋角</text><text x="134" y="${H - 6}" font-size="13" fill="var(--muted)">肘角</text><text x="184" y="${H - 6}" font-size="13" fill="var(--red)">红色区域 = 腾空</text></svg>
        <div class="cap"><span>关节角度随时间变化</span><span>点按跳转</span></div>`;
      S.stripX = x;
      const svg = $("stripSvg"); svg.addEventListener("pointerdown", stripSeek); svg.addEventListener("pointermove", e => { if (e.buttons) stripSeek(e); });
      return;
    }
    if (S.action === "sprint") {
      const steps = R.steps || [], N = S.N || (steps.length ? steps[steps.length - 1].toeoff_frame + 30 : 100);
      const W = 600, laneH = 56, H = laneH * 2 + 30, x = f => f / N * W;
      const x0 = 26; const xx = f => x0 + f / N * (W - x0); const lane = (side, y) => steps.filter(s => s.side === side).map(s =>
        `<rect x="${xx(s.touchdown_frame)}" y="${y}" width="${Math.max(3, xx(s.toeoff_frame + 1) - xx(s.touchdown_frame))}" height="${laneH - 10}" rx="4" fill="var(--lane-${side === "left" ? "l" : "r"})"/>` +
        `<text x="${xx(s.touchdown_frame) + 4}" y="${y + laneH / 2 + 2}" font-size="17" font-family="DIN Alternate, Bahnschrift, sans-serif" fill="${side === "left" ? "var(--green-ink)" : "var(--bg)"}">${(s.contact_time_s * 1000).toFixed(0)}</text>`).join("");
      box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" id="stripSvg" role="img" aria-label="左右脚触地时间轴">
        <rect x="0" y="0" width="${W}" height="${laneH * 2}" fill="var(--sunk)" rx="8"/>
        <line x1="0" x2="${W}" y1="${laneH}" y2="${laneH}" stroke="var(--rule)"/>
        <text x="6" y="${laneH / 2 + 6}" font-size="15" fill="var(--muted)">左</text>
        <text x="6" y="${laneH * 1.5 + 6}" font-size="15" fill="var(--muted)">右</text>
        <g transform="translate(0,5)">${lane("left", 0)}${lane("right", laneH)}</g>
        <line id="playhead" x1="0" x2="0" y1="0" y2="${laneH * 2}" stroke="var(--red)" stroke-width="3"/>
        <text x="0" y="${H - 6}" font-size="15" fill="var(--muted)">0</text>
        <text x="${W}" y="${H - 6}" font-size="15" fill="var(--muted)" text-anchor="end" class="num">${(N / S.fpsReal).toFixed(2)} s</text>
      </svg><div class="cap"><span>左右脚触地（毫秒）</span><span>点按跳转</span></div>`;
      S.stripX = f => xx(f);
    } else {
      const sr = R.series || {};
      if (!sr.h || !sr.h.length) { box.innerHTML = ""; return; }
      const h = sr.h, dx = sr.dx, vy = sr.vy, n = h.length, ev = R.events || {};
      const W = 1000, H = 420, pw = 360;
      // 左：杠铃轨迹（等比例），右：竖直速度曲线
      const xs = dx.filter(Number.isFinite), hs = h.filter(Number.isFinite);
      const span = Math.max(0.3, Math.max(...hs) - Math.min(0, ...hs), (Math.max(...xs) - Math.min(...xs)) * 1.2);
      const k = (H - 40) / span, cx0 = pw / 2, cy0 = H - 20;
      const path = h.map((v, i) => `${i ? "L" : "M"}${(cx0 + dx[i] * k).toFixed(1)},${(cy0 - v * k).toFixed(1)}`).join("");
      const vmax = Math.max(...vy.filter(Number.isFinite)), vmin = Math.min(...vy.filter(Number.isFinite));
      const gx = i => pw + 40 + i / (n - 1) * (W - pw - 50), gy = v => 20 + (vmax - v) / (vmax - vmin || 1) * (H - 60);
      const vpath = vy.map((v, i) => `${i ? "L" : "M"}${gx(i).toFixed(1)},${gy(v).toFixed(1)}`).join("");
      const evNames = { liftoff: "离地", peak_velocity: "最大速度", top: "最高", catch: "接杠" };
      const marks = Object.entries(ev).map(([key, i]) => `<circle cx="${gx(i)}" cy="${gy(vy[i])}" r="6" fill="var(--red)"/><text x="${gx(i) + 8}" y="${gy(vy[i]) - 8}" font-size="15" fill="var(--muted)">${evNames[key]}</text>`).join("");
      box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" id="stripSvg" role="img" aria-label="杠铃轨迹与速度">
        <rect x="0" y="0" width="${pw}" height="${H}" rx="10" fill="var(--sunk)"/>
        <line x1="${cx0}" x2="${cx0}" y1="10" y2="${H - 10}" stroke="var(--rule)" stroke-dasharray="4 6"/>
        <path d="${path}" fill="none" stroke="var(--ink)" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>
        <text x="12" y="${H - 10}" font-size="15" fill="var(--muted)">← 靠近身体　远离身体 →</text>
        <line x1="${pw + 40}" x2="${W - 10}" y1="${gy(0)}" y2="${gy(0)}" stroke="var(--rule)"/>
        <path d="${vpath}" fill="none" stroke="var(--green)" stroke-width="3"/>${marks}
        <text x="${pw + 40}" y="${H - 8}" font-size="15" fill="var(--muted)">杠铃竖直速度（峰值 ${vmax.toFixed(2)} m/s）</text>
        <line id="playhead" x1="${gx(0)}" x2="${gx(0)}" y1="10" y2="${H - 30}" stroke="var(--red)" stroke-width="2"/>
        <circle id="pathDot" cx="${cx0}" cy="${cy0}" r="8" fill="var(--red)"/>
      </svg><div class="cap"><span>杠铃轨迹　竖直速度</span><span>点按跳转</span></div>`;
      S.stripX = gx; S.pathPt = i => [cx0 + dx[i] * k, cy0 - h[i] * k];
    }
    const svg = $("stripSvg");
    svg.addEventListener("pointerdown", stripSeek);
    svg.addEventListener("pointermove", e => { if (e.buttons) stripSeek(e); });
  }
  function stripSeek(e) {
    if (!S.url || $("playerWrap").hidden) return;
    const svg = $("stripSvg"), b = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal;
    const xv = (e.clientX - b.left) / b.width * vb.width;
    let best = 0, bd = Infinity;
    for (let i = 0; i < S.N; i += 1) { const d = Math.abs(S.stripX(i) - xv); if (d < bd) { bd = d; best = i; } }
    gotoFrame(best);
  }
  function setPlayhead(i) {
    const ph = $("playhead"); if (!ph || !S.stripX) return;
    const x = S.stripX(i); ph.setAttribute("x1", x); ph.setAttribute("x2", x);
    const dot = $("pathDot"); if (dot && S.pathPt) { const p = S.pathPt(Math.min(i, S.result.series.h.length - 1)); dot.setAttribute("cx", p[0]); dot.setAttribute("cy", p[1]); }
  }

  // 播放器
  function frameOf(t) { return Math.max(0, Math.min(S.N - 1, Math.round((t - S.start) * S.fpsFile - 0.5))); }
  function drawPlayFrame() {
    const i = frameOf(pv.currentTime);
    const w = pv.clientWidth, h = pv.clientHeight, dpr = window.devicePixelRatio || 1;
    if (ov.width !== Math.round(w * dpr)) { ov.width = Math.round(w * dpr); ov.height = Math.round(h * dpr); }
    octx.clearRect(0, 0, ov.width, ov.height);
    drawOverlay(octx, ((S.result && S.result.pose) || S.pose)[i], { scale: ov.width / S.W, bar: S.bar, i, contactSide: contactByFrame && contactByFrame.get(i), air: S.action === "general" && S.result.series && S.result.series.air && S.result.series.air[i] });
    $("playScrub").value = i;
    $("playHead").style.left = (S.N > 1 ? i / (S.N - 1) * 100 : 0) + "%";
    $("frameInfo").textContent = `第 ${i + 1} 帧，共 ${S.N} 帧`;
    $("frameMs").textContent = `${(i / S.fpsReal * 1000).toFixed(0)} ms`;
    setPlayhead(i);
  }
  async function gotoFrame(i) {
    stopPlayback();
    await seek(pv, S.start + (Math.max(0, Math.min(S.N - 1, i)) + 0.5) / S.fpsFile);
    drawPlayFrame();
  }
  function loop() {
    if (!playing) return;
    if (pv.currentTime >= S.end - 1e-3) { pv.currentTime = S.start; }
    drawPlayFrame();
    if ("requestVideoFrameCallback" in pv) pv.requestVideoFrameCallback(loop); else requestAnimationFrame(loop);
  }
  const ICON_PLAY = "<svg viewBox=\"0 0 24 24\" fill=\"currentColor\"><path d=\"M8 5v14l11-7z\"/></svg>", ICON_PAUSE = "<svg viewBox=\"0 0 24 24\" fill=\"currentColor\"><rect x=\"6\" y=\"5\" width=\"4\" height=\"14\" rx=\"1\"/><rect x=\"14\" y=\"5\" width=\"4\" height=\"14\" rx=\"1\"/></svg>";
  function stopPlayback() { playing = false; pv.pause(); $("playBtn").innerHTML = ICON_PLAY; $("playBtn").setAttribute("aria-label", "播放"); }
  async function setupPlayer() {
    pv.src = S.url;
    $("playScrub").max = S.N - 1;
    try { await primeVideo(pv); } catch (e) { toast("回放视频加载失败"); }
    await gotoFrame(0);
  }
  $("playBtn").onclick = async () => {
    if (playing) { stopPlayback(); return; }
    const rate = Number(document.querySelector(".speed [aria-pressed=true]").dataset.rate);
    pv.playbackRate = rate;
    playing = true; $("playBtn").innerHTML = ICON_PAUSE; $("playBtn").setAttribute("aria-label", "暂停");
    try { await pv.play(); } catch (e) { stopPlayback(); toast("无法播放"); return; }
    loop();
  };
  $("prevFrame").onclick = () => gotoFrame(frameOf(pv.currentTime) - 1);
  $("nextFrame").onclick = () => gotoFrame(frameOf(pv.currentTime) + 1);
  $("playScrub").oninput = e => gotoFrame(Number(e.target.value));
  document.querySelectorAll(".speed button").forEach(b => b.onclick = () => {
    document.querySelectorAll(".speed button").forEach(x => x.setAttribute("aria-pressed", x === b));
    pv.playbackRate = Number(b.dataset.rate);
  });
  window.addEventListener("resize", () => { if ($("v-result").classList.contains("on") && !$("playerWrap").hidden) drawPlayFrame(); });

  // ---------------- 保存、分享、历史 ----------------
  function packSeries() {
    const R = S.result;
    if (S.action === "general" && R.series && R.series.knee) {
      const step = Math.max(1, Math.ceil(R.series.knee.length / 600));
      const pick = arr => arr.filter((_, i) => i % step === 0).map(v => round(v, 1));
      return { knee: pick(R.series.knee), hip: pick(R.series.hip), elbow: pick(R.series.elbow), air: R.series.air.filter((_, i) => i % step === 0) };
    }
    if (S.action !== "clean" || !R.series || !R.series.h) return {};
    const step = Math.max(1, Math.ceil(R.series.h.length / 600));
    const pick = a => a.filter((_, i) => i % step === 0).map(v => round(v, 4));
    const ev = {}; for (const [k, i] of Object.entries(R.events || {})) ev[k] = Math.round(i / step);
    return { h: pick(R.series.h), dx: pick(R.series.dx), vy: pick(R.series.vy), events: ev };
  }
  $("saveBtn").onclick = async () => {
    const R = S.result;
    const rec = {
      id: S.savedId || Date.now(), date: S.date || new Date().toISOString(),
      athleteId: S.athleteId, athleteName: S.athleteName, action: S.action, sportId: S.sportId || null, techId: S.techId || null, checks: S.checks || {},
      jumps: (S.result.jumps || []).map(j => Object.assign({}, j)), fileName: S.file ? S.file.name : S.fileName,
      fpsReal: S.fpsReal, N: S.N, summary: R.summary, steps: R.steps || null, notes: R.notes || [],
      hits: S.hits.map(h => h.id), verdicts: S.verdicts, coachNote: $("coachNote").value.trim(),
      reviewed: Object.values(S.verdicts).some(Boolean), series: S.savedSeries || packSeries(),
    };
    await dbPut("analyses", rec);
    S.savedId = rec.id; S.date = rec.date; S.savedSeries = rec.series; S.coachNote = rec.coachNote;
    $("saveBtn").textContent = "更新"; $("deleteBtn").hidden = false;
    toast("已保存到本机");
  };
  $("deleteBtn").onclick = async () => {
    if (!S.savedId || !confirm("删除这条记录？删除后无法恢复。")) return;
    await dbDel("analyses", S.savedId); toast("已删除"); show("home");
  };
  async function openSaved(id) {
    const rec = (await dbAll("analyses")).find(a => a.id === id);
    if (!rec) return;
    for (const k of Object.keys(S)) delete S[k];
    Object.assign(S, { action: rec.action, sportId: rec.sportId, techId: rec.techId, checks: Object.assign({}, rec.checks || {}), athleteId: rec.athleteId, athleteName: rec.athleteName, fpsReal: rec.fpsReal, N: rec.N,
      savedId: rec.id, date: rec.date, verdicts: Object.assign({}, rec.verdicts), coachNote: rec.coachNote, fileName: rec.fileName, savedSeries: rec.series });
    const series = rec.series || {};
    S.result = { action: rec.action, summary: rec.summary, steps: rec.steps, notes: rec.notes, events: series.events || {}, series, jumps: rec.jumps || [] };
    if (rec.action === "general" && series.knee) S.N = series.knee.length;
    if (rec.action === "clean" && series.h) S.N = series.h.length;
    S.hits = CM.matchCards(S.result, TH, CARDS);
    showResult(false);
  }

  function reportText() {
    const R = S.result, L = [`知练 CoachMind　${S.athleteName}　${actionLabel(S)}`, fmtDate(S.date || new Date().toISOString()), ""];
    L.push("【关键指标】");
    for (const [k, v] of Object.entries(R.summary)) { const [n, u] = CM.LABELS[k] || [k, ""]; L.push(`${n}：${CM.fmt(v, u)} ${u}`); }
    L.push("", "【诊断】");
    if (!S.hits.length) L.push("未触发问题规则。");
    const vt = { agree: "教练认同", test: "待测试确认", disagree: "教练不认同" };
    for (const h of S.hits) {
      L.push(`${h.id} ${h.title}${S.verdicts[h.id] ? `（${vt[S.verdicts[h.id]]}）` : ""}`, `  ${h.symptom_text}`);
      h.hypotheses.forEach(y => L.push(`  · ${y.text}｜验证：${y.test}`));
    }
    const note = $("coachNote").value.trim(); if (note) L.push("", "【教练备注】", note);
    L.push("", "AI 建议仅供参考，由教练确认。");
    return L.join("\n");
  }
  $("shareBtn").onclick = async () => {
    const text = reportText();
    if (navigator.share) { try { await navigator.share({ title: "知练诊断报告", text }); return; } catch (e) { if (e.name === "AbortError") return; } }
    try { await navigator.clipboard.writeText(text); toast("报告已复制"); } catch (e) { toast("复制失败"); }
  };

  // 导出 CSV（用于研究一：AI 与教练判断一致性）
  $("exportCsv").onclick = async () => {
    const all = (await dbAll("analyses")).sort((a, b) => a.id - b.id);
    if (!all.length) { toast("还没有数据"); return; }
    const keys = [...new Set(all.flatMap(a => Object.keys(a.summary || {})))];
    const cardIds = CARDS.cards.map(c => c.id);
    const head = ["日期", "运动员", "动作", "帧率", ...keys.map(k => (CM.LABELS[k] || [k])[0]), ...cardIds.map(id => id + "_AI"), ...cardIds.map(id => id + "_教练"), "教练备注"];
    const q = v => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const rows = all.map(a => [a.date, a.athleteName, ACTION_NAME[a.action], a.fpsReal, ...keys.map(k => a.summary[k]),
      ...cardIds.map(id => (a.hits || []).includes(id) ? 1 : 0), ...cardIds.map(id => (a.verdicts || {})[id] || ""), a.coachNote].map(q).join(","));
    const csv = "\uFEFF" + [head.map(q).join(","), ...rows].join("\n");
    const file = new File([csv], `知练数据_${new Date().toISOString().slice(0, 10)}.csv`, { type: "text/csv" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file] }); return; } catch (e) { if (e.name === "AbortError") return; } }
    const a = document.createElement("a"); a.href = URL.createObjectURL(file); a.download = file.name; a.click();
  };

  // ================= 运动员：画像、计划、档案 =================
  const A = { cur: null, pane: "profile", week: null, checkin: false };
  const todayStr = () => new Date().toISOString().slice(0, 10);
  const daysTo = d => d ? Math.ceil((new Date(d) - new Date(todayStr())) / 864e5) : null;
  const f2 = v => (Number.isFinite(v) ? v.toFixed(2) : "–");
  const refHtml = keys => keys.filter(k => COACH.REFS[k]).map(k => { const r = COACH.REFS[k]; return `<div>${esc(r.t)}${r.doi ? ` <a href="https://doi.org/${r.doi}" target="_blank" rel="noopener">doi.org/${r.doi}</a>` : ""}</div>`; }).join("");

  async function latestVideo(athleteId) {
    const all = (await dbAll("analyses")).filter(a => a.athleteId === athleteId && a.action === "sprint" && a.summary && Number.isFinite(a.summary.contact_time_s));
    all.sort((a, b) => b.id - a.id);
    return all[0] ? all[0].summary : null;
  }
  async function computeAthlete(a) {
    const video = await latestVideo(a.id);
    const P = COACH.profile(a, video);
    return { video, P, I: COACH.insights(a, P, video), PL: COACH.plan(a, P), R: COACH.readiness(a) };
  }
  function currentWeekIndex(PL) {
    const t = new Date(todayStr());
    let idx = 0;
    PL.weeks.forEach((w, i) => { if (new Date(w.start) <= t) idx = i; });
    return idx;
  }

  function renderHeroEvent(athletes) {
    const box = $("heroEvent"); if (!box) return;
    const next = athletes.map(a => ({ a, d: daysTo(a.goalDate) })).filter(x => x.d != null && x.d >= 0).sort((x, y) => x.d - y.d)[0];
    if (next) {
      const sp = window.SPORTLIB ? SPORTLIB.byId(next.a.sport || "sprint") : null;
      box.innerHTML = `<p class="eyebrow">即将到来</p><h2>${esc(next.a.name)}　${esc(sp ? sp.name : "")}</h2>
        <p class="italic">${esc(next.a.goalText || (Number.isFinite(next.a.goalTime) ? `目标 ${next.a.goalTime} 秒` : "目标比赛"))}<br>${next.a.goalDate.replace(/-/g, ".")} · 还有 ${next.d} 天</p>
        <button class="link" id="heroEventGo">查看训练计划</button>`;
      $("heroEventGo").onclick = () => openAthlete(next.a.id);
    } else {
      box.innerHTML = `<p class="eyebrow">运动员</p><h2>建立第一份档案</h2><p class="italic">One athlete, one plan.<br>目标、测试、每日状态，都在这里。</p><button class="link" id="heroEventGo">添加运动员</button>`;
      $("heroEventGo").onclick = () => { const b = $("addPerson"); if (b) b.click(); };
    }
  }
  async function renderPeople() {
    const athletes = (await dbAll("athletes")).sort((a, b) => a.name.localeCompare(b.name, "zh"));
    renderHeroEvent(athletes);
    const cards = athletes.map(a => {
      const R = COACH.readiness(a), d = daysTo(a.goalDate);
      const line = Number.isFinite(a.pb) && Number.isFinite(a.goalTime) ? `${a.pb} → ${a.goalTime} 秒` : "点开完善档案和目标";
      return `<button class="person" data-id="${a.id}"><span><span class="nm"><i class="dot ${R.level}"></i>${esc(a.name)}</span><span class="ln">${line}</span></span>
        ${d != null && d >= 0 ? `<span class="cd">${d}<small>天后目标日</small></span>` : "<span></span>"}</button>`;
    });
    cards.push(`<button class="person add" id="addPerson">＋ 添加运动员</button>`);
    $("people").innerHTML = cards.join("");
    $("people").querySelectorAll(".person[data-id]").forEach(b => b.onclick = () => openAthlete(b.dataset.id));
    $("addPerson").onclick = async () => {
      const a = { id: "a" + Date.now(), name: "新运动员", sex: "男", sessionsPerWeek: 4, tests: [], wellness: [], created: new Date().toISOString() };
      await dbPut("athletes", a);
      openAthlete(a.id, "info");
    };
  }

  async function openAthlete(id, pane) {
    const a = (await dbAll("athletes")).find(x => x.id === id);
    if (!a) return;
    A.cur = a; A.pane = pane || "profile"; A.week = null; A.checkin = false;
    await renderAthlete();
    show("athlete");
  }
  async function saveAthlete() { await dbPut("athletes", A.cur); }

  async function renderAthlete() {
    const a = A.cur, C = await computeAthlete(a);
    A.C = C;
    const d = daysTo(a.goalDate);
    const sp = window.SPORTLIB ? SPORTLIB.byId(a.sport || "sprint") : null;
    if (sp && sp.id !== "sprint") {
      $("aBoard").innerHTML = `<div class="who"><span>${esc(a.name)}　${esc(sp.name)}</span><span>${a.goalDate ? a.goalDate.replace(/-/g, "/") : "未设目标日期"}</span></div>
        <div class="main"><b>${d != null && d >= 0 ? d : "–"}</b><small>天</small></div><div class="lbl">距离目标比赛</div>
        <div class="sub"><div><b style="font-size:20px">${esc(a.goalText || "未填写目标")}</b><span class="lbl">目标</span></div><div><b style="font-size:20px">${esc(SPORTLIB.GROUPS.find(g => g.id === sp.group).name)}</b><span class="lbl">项群</span></div></div>`;
      renderAthleteToday();
      document.querySelectorAll(".tabs button").forEach(b => { b.setAttribute("aria-pressed", b.dataset.pane === A.pane); b.onclick = () => { A.pane = b.dataset.pane; renderPanes(); }; });
      renderPanes(); return;
    }
    $("aBoard").innerHTML = `<div class="who"><span>${esc(a.name)}　100 米</span><span>${a.goalDate ? a.goalDate.replace(/-/g, "/") : "未设目标日期"}</span></div>
      <div class="main"><b>${Number.isFinite(a.goalTime) ? a.goalTime.toFixed(2) : "–"}</b><small>s</small></div>
      <div class="lbl">目标成绩</div>
      <div class="sub">
        <div><b>${Number.isFinite(a.pb) ? a.pb.toFixed(2) : "–"}<small>s</small></b><span class="lbl">当前最好</span></div>
        <div><b>${d != null && d >= 0 ? d : "–"}<small>天</small></b><span class="lbl">${Number.isFinite(C.P.improvePct) ? `需要快 ${C.P.improvePct.toFixed(1)}%` : "距目标日"}</span></div>
      </div>`;
    renderAthleteToday();
    document.querySelectorAll(".tabs button").forEach(b => { b.setAttribute("aria-pressed", b.dataset.pane === A.pane); b.onclick = () => { A.pane = b.dataset.pane; renderPanes(); }; });
    renderPanes();
  }
  function renderPanes() {
    document.querySelectorAll(".tabs button").forEach(b => b.setAttribute("aria-pressed", b.dataset.pane === A.pane));
    ["profile", "plan", "info"].forEach(p => $("p-" + p).classList.toggle("on", p === A.pane));
    if (A.pane === "profile") renderProfilePane();
    if (A.pane === "plan") renderPlanPane();
    if (A.pane === "info") renderInfoPane();
  }

  // ----- 今日 -----
  function renderAthleteToday() {
    const a = A.cur, { PL, R } = A.C;
    const wi = currentWeekIndex(PL), w = PL.weeks[wi];
    const dow = (new Date().getDay() + 6) % 7;
    const day = w && new Date(w.start) <= new Date(todayStr()) ? w.days.find(x => x.dow === dow) : null;
    const sess = day ? day.blocks.map(b => `<div class="bk"><b>${esc(b.t)}</b>${b.items.map(i => `<div>${esc(i)}</div>`).join("")}</div>`).join("") : `<div class="bk"><b>今天没有安排训练</b><div>休息或轻松活动</div></div>`;
    const lv = { green: "状态良好", yellow: "注意", red: "需要恢复", none: "今天还没打卡" }[R.level];
    const last = (a.wellness || []).slice(-1)[0] || {};
    const cur = (a.wellness || []).find(x => x.date === todayStr()) || { sleep: last.sleep || 8, fatigue: 2, soreness: 2 };
    const scale = (k, v) => `<div class="scale" data-k="${k}">${[1, 2, 3, 4, 5].map(n => `<button data-v="${n}" aria-pressed="${v === n}">${n}</button>`).join("")}</div>`;
    $("aToday").innerHTML = `<div class="hd"><i class="dot ${R.level}"></i><span class="grow">今天　${lv}</span><button class="btn sm" id="ciBtn">${A.checkin ? "收起" : R.level === "none" ? "打卡" : "修改"}</button></div>
      <p>${esc(R.text)}${R.reasons && R.reasons.length ? `（${R.reasons.join("，")}）` : ""}</p>
      ${A.checkin ? `<div class="checkin">
        <div class="inrow"><label>昨晚睡眠（小时）<input type="number" inputmode="decimal" id="ciSleep" value="${cur.sleep}" step="0.5" min="0" max="14"></label></div>
        <div class="q"><span>疲劳程度（1 很轻松，5 很累）</span>${scale("fatigue", cur.fatigue)}</div>
        <div class="q"><span>肌肉酸痛（1 没有，5 很痛）</span>${scale("soreness", cur.soreness)}</div>
        <div class="inrow"><label>训练 RPE（0–10，训练后填）<input type="number" inputmode="decimal" id="ciRpe" value="${cur.rpe ?? ""}" min="0" max="10"></label><label>训练时长（分钟）<input type="number" inputmode="numeric" id="ciMin" value="${cur.minutes ?? ""}" min="0"></label></div>
        <button class="btn go" id="ciSave">保存今日状态</button></div>` : ""}
      <div class="sess"><b style="font-size:15px">${w ? `第 ${wi + 1} 周　${w.phaseName}${w.deload ? "　调整周" : ""}` : ""}</b>${sess}</div>`;
    $("ciBtn").onclick = () => { A.checkin = !A.checkin; renderAthleteToday(); };
    if (A.checkin) {
      const vals = { fatigue: cur.fatigue, soreness: cur.soreness };
      $("aToday").querySelectorAll(".scale").forEach(s => s.querySelectorAll("button").forEach(b => b.onclick = () => {
        vals[s.dataset.k] = Number(b.dataset.v);
        s.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x === b));
      }));
      $("ciSave").onclick = async () => {
        const e = { date: todayStr(), sleep: Number($("ciSleep").value) || 0, fatigue: vals.fatigue, soreness: vals.soreness };
        const rpe = Number($("ciRpe").value), mins = Number($("ciMin").value);
        if ($("ciRpe").value !== "" && rpe >= 0) e.rpe = rpe;
        if (mins > 0) e.minutes = mins;
        a.wellness = (a.wellness || []).filter(x => x.date !== e.date).concat([e]).sort((x, y) => x.date < y.date ? -1 : 1);
        await saveAthlete(); A.checkin = false; toast("已保存今日状态");
        await renderAthlete();
      };
    }
  }

  // ----- 画像 -----
  function radarSvg(radar) {
    const n = radar.length, cx = 170, cy = 158, R = 112, maxS = 120;
    const ang = i => -Math.PI / 2 + i * 2 * Math.PI / n;
    const P = (i, s) => [cx + Math.cos(ang(i)) * R * s / maxS, cy + Math.sin(ang(i)) * R * s / maxS];
    const ring = s => radar.map((_, i) => P(i, s).map(v => v.toFixed(1)).join(",")).join(" ");
    const curPts = radar.map((x, i) => P(i, Number.isFinite(x.score) ? x.score : 0).map(v => v.toFixed(1)).join(",")).join(" ");
    const spokes = radar.map((_, i) => { const [x, y] = P(i, maxS); return `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="var(--rule)"/>`; }).join("");
    const labels = radar.map((x, i) => {
      const [lx, ly] = P(i, maxS + 22), anchor = Math.abs(lx - cx) < 8 ? "middle" : lx > cx ? "start" : "end";
      const s = Number.isFinite(x.score) ? `${x.score}` : "缺数据";
      return `<text x="${lx}" y="${ly}" text-anchor="${anchor}" font-size="14" fill="var(--ink)" font-weight="600">${x.name}</text>
        <text x="${lx}" y="${ly + 16}" text-anchor="${anchor}" font-size="13" fill="${Number.isFinite(x.score) ? (x.score < 90 ? "var(--red)" : "var(--muted)") : "var(--muted)"}" font-family="DIN Alternate, Bahnschrift, sans-serif">${s}</text>`;
    }).join("");
    const dots = radar.map((x, i) => Number.isFinite(x.score) ? `<circle cx="${P(i, x.score)[0]}" cy="${P(i, x.score)[1]}" r="4" fill="var(--green)"/>` : "").join("");
    return `<svg viewBox="-28 0 396 330" role="img" aria-label="能力雷达">${spokes}
      <polygon points="${ring(50)}" fill="none" stroke="var(--rule)"/>
      <polygon points="${ring(100)}" fill="none" stroke="var(--ink)" stroke-width="1.5" stroke-dasharray="5 4"/>
      <polygon points="${curPts}" fill="color-mix(in srgb, var(--green) 22%, transparent)" stroke="var(--green)" stroke-width="2.5"/>${dots}${labels}</svg>
      <div class="legend"><span><i style="background:var(--green)"></i>当前</span><span><i style="background:var(--ink)"></i>目标模型 = 100</span></div>`;
  }
  function renderProfilePane() {
    const a = A.cur, { P, I, video } = A.C, E = COACH.ELITE;
    const needGoal = !Number.isFinite(a.goalTime) || !Number.isFinite(a.pb);
    const rows = [
      ["最高速度 m/s", P.cur.vmax, P.tgt.vmax, E.v],
      ["30 米起跑 s", P.cur.t30, P.tgt.t30, null],
      ["30 米行进间 s", Number.isFinite(P.cur.vmax) ? 30 / P.cur.vmax : null, P.tgt.flying30, 30 / E.v],
      ["触地时间 s", video && video.contact_time_s, P.targets.ct, E.ct],
      ["腾空时间 s", video && video.flight_time_s, null, E.ft],
      ["步长 m", video && video.step_length_m, P.combos && P.combos.slAtSameSF, E.sl],
      ["步频 步/秒", video && video.step_frequency_hz, P.combos && P.combos.sfAtSameSL, E.sf],
    ];
    const fmt3 = (v, k) => Number.isFinite(v) ? (k.includes("触地") || k.includes("腾空") ? v.toFixed(3) : v.toFixed(2)) : "–";
    $("p-profile").innerHTML = `
      ${needGoal ? `<div class="msg"><b>先完善档案：</b>填写 100 米最好成绩、目标成绩和目标日期，才能计算目标模型和训练计划。<button class="btn sm" style="margin-left:8px" id="goInfo">去填写</button></div>` : ""}
      <h3 class="sec">能力画像</h3>
      <div class="radarbox">${radarSvg(P.radar)}</div>
      <ul class="axes">${P.radar.map(x => `<li><span class="an">${x.name}</span><span class="as ${Number.isFinite(x.score) && x.score < 90 ? "low" : ""}">${Number.isFinite(x.score) ? x.score : "–"}</span>
        <span class="ad">${x.cur ? `现在 ${esc(x.cur)}　目标 ${esc(x.tgt || "–")}` : `需要：${esc(x.need)}`}</span></li>`).join("")}</ul>
      <h3 class="sec">与目标模型、优秀运动员对比</h3>
      <table class="cmp"><tr><th></th><th>现在</th><th>目标</th><th>${E.name}</th></tr>
        ${rows.map(r => `<tr><td>${r[0]}</td><td>${fmt3(r[1], r[0])}</td><td class="tg">${fmt3(r[2], r[0])}</td><td>${fmt3(r[3], r[0])}</td></tr>`).join("")}</table>
      <p class="lead" style="margin-top:8px;font-size:13px">目标由短跑单指数速度模型从目标成绩倒推（未计后程减速，实际需求略高）；最高速度来源：${esc(P.cur.vmaxSrc || "暂无")}。${E.name}数据为${E.note}。</p>
      <details class="ins" style="padding:10px 18px"><summary style="font-size:13px;color:var(--muted)">模型与数据来源</summary>${refHtml(["samozino2016", "coh2018"])}</details>
      <h3 class="sec">多学科分析</h3>
      ${I.map(x => `<div class="ins"><div class="ar">${esc(x.area)}</div><h4>${esc(x.title)}</h4><ul>${x.bullets.map(b => `<li>${esc(b)}</li>`).join("")}</ul>
        ${x.refs.length || x.level ? `<details><summary>依据${x.level ? "　" + esc(x.level) : ""}</summary>${refHtml(x.refs)}</details>` : ""}</div>`).join("")}`;
    const gi = $("goInfo"); if (gi) gi.onclick = () => { A.pane = "info"; renderPanes(); };
  }

  // ----- 计划 -----
  function renderPlanPane() {
    const { PL } = A.C, now = currentWeekIndex(PL);
    if (A.week == null) A.week = now;
    const w = PL.weeks[A.week];
    const phaseColor = { gp: "var(--ph1)", sp: "var(--ph2)", cp: "var(--ph3)", taper: "var(--ph4)" };
    const t = new Date(todayStr());
    const G = PL.group;
    $("p-plan").innerHTML = `
      ${G ? `<div class="ins"><div class="ar">${esc(G.name)}</div><h4>训练重点</h4><ul>${G.priorities.map(x => `<li>${esc(x)}</li>`).join("")}</ul>
        <details><summary>项群特点、测试指标与伤病预防</summary><p>${esc(G.traits)}</p><p><b>测试：</b>${G.tests.map(esc).join("；")}</p><p><b>预防：</b>${G.prehab.map(esc).join("；")}</p></details></div>` : ""}
      <h3 class="sec">${PL.total} 周计划</h3>
      <div class="weeks">${PL.weeks.map((x, i) => `<button class="wk ${x.phase} ${x.deload ? "deload" : ""} ${i === now ? "now" : ""}" data-i="${i}" aria-pressed="${i === A.week}">${i + 1}${x.test ? `<span class="t">测</span>` : ""}</button>`).join("")}</div>
      <div class="phases">${PL.phases.map(p => `<span><i style="background:${phaseColor[p.key]}"></i>${p.name} ${p.weeks} 周</span>`).join("")}<span>斜纹 = 调整周　测 = 测试</span></div>
      <div class="wkhead"><b>第 ${A.week + 1} 周　${w.phaseName}${w.deload ? "　调整周" : ""}</b><span>${w.start.slice(5).replace("-", "/")} 起</span></div>
      <p class="lead" style="margin:-4px 0 12px">${esc(PL.phases.find(p => p.key === w.phase).goal)}${w.deload ? "。本周训练量约为平时的 60%，让身体吸收训练效果" : ""}</p>
      ${w.days.map(d => { const date = new Date(w.start); date.setDate(date.getDate() + d.dow); const isToday = date.toISOString().slice(0, 10) === todayStr();
        return `<div class="day ${isToday ? "today-day" : ""}"><div class="dn">${d.day}<small>${date.getMonth() + 1}/${date.getDate()}</small></div><div>${d.blocks.map(b => `<div class="bk"><b>${esc(b.t)}</b>${b.items.map(i => `<div>${esc(i)}</div>`).join("")}</div>`).join("")}</div></div>`; }).join("")}
      ${PL.focus.length ? `<div class="msg ok" style="margin-top:12px"><b>当前重点：</b>${PL.focus.map(f => ({ speed: "最高速度", accel: "加速", se: "速度耐力", strength: "力量", power: "爆发力", tech: "技术", recovery: "恢复", reactive: "反应力量" }[f] || f)).join("、")}（来自能力画像短板和视频诊断）</div>` : ""}
      <p class="lead" style="font-size:13px;margin-top:12px">计划按周期化原则从目标日期倒推生成，是模板建议，需要教练审核调整。每个测试周录入新成绩后，画像和计划会自动更新。</p>
      <details class="ins" style="padding:10px 18px"><summary style="font-size:13px;color:var(--muted)">依据</summary>${refHtml(PL.refs)}</details>`;
    $("p-plan").querySelectorAll(".wk").forEach(b => b.onclick = () => { A.week = Number(b.dataset.i); renderPlanPane(); });
    const nowEl = $("p-plan").querySelector(".wk.now"); if (nowEl) nowEl.scrollIntoView({ block: "nearest", inline: "center" });
  }

  // ----- 档案 -----
  function renderInfoPane() {
    const a = A.cur, tg = COACH.profile(a, null).targets;
    const tests = (a.tests || []).slice().sort((x, y) => x.date < y.date ? 1 : -1);
    $("p-info").innerHTML = `
      <h3 class="sec">基本信息</h3>
      <div class="group form">
        <div class="row"><label>姓名</label><input data-f="name" value="${esc(a.name)}"></div>
        <div class="row"><label>项目</label><select data-f="sport">${(window.SPORTLIB ? SPORTLIB.SPORTS : []).map(s => `<option value="${s.id}" ${(a.sport || "sprint") === s.id ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></div>
        <div class="row"><label>性别</label><select data-f="sex"><option ${a.sex !== "女" ? "selected" : ""}>男</option><option ${a.sex === "女" ? "selected" : ""}>女</option></select></div>
        <div class="row"><label>身高</label><input class="n" type="number" inputmode="decimal" data-f="height_cm" value="${a.height_cm ?? ""}"><span class="unit">cm</span></div>
        <div class="row"><label>体重</label><input class="n" type="number" inputmode="decimal" data-f="weight_kg" value="${a.weight_kg ?? ""}"><span class="unit">kg</span></div>
      </div>
      <h3 class="sec">成绩与目标</h3>
      <div class="group form">
        ${(a.sport || "sprint") !== "sprint" ? `<div class="row"><label>目标</label><input data-f="goalText" placeholder="如：省运会进前三" value="${esc(a.goalText || "")}"></div>` : ""}
        <div class="row" ${(a.sport || "sprint") !== "sprint" ? "hidden" : ""}><label>100 米最好成绩</label><input class="n" type="number" inputmode="decimal" step="0.01" data-f="pb" value="${a.pb ?? ""}"><span class="unit">s</span></div>
        <div class="row" ${(a.sport || "sprint") !== "sprint" ? "hidden" : ""}><label>目标成绩</label><input class="n" type="number" inputmode="decimal" step="0.01" data-f="goalTime" value="${a.goalTime ?? ""}"><span class="unit">s</span></div>
        <div class="row"><label>目标日期</label><input type="date" data-f="goalDate" value="${a.goalDate || ""}"></div>
        <div class="row"><label>每周训练次数</label><select data-f="sessionsPerWeek">${[3, 4, 5, 6].map(n => `<option ${Number(a.sessionsPerWeek || 4) === n ? "selected" : ""}>${n}</option>`).join("")}</select></div>
      </div>
      <h3 class="sec">测试成绩</h3>
      <div class="group">
        <div class="addtest"><select id="tType">${Object.entries(COACH.TESTS).map(([k, t]) => `<option value="${k}">${t.name}</option>`).join("")}</select>
          <input type="number" inputmode="decimal" step="0.01" id="tVal" placeholder="成绩"><input type="date" id="tDate" value="${todayStr()}"><button class="btn go sm" id="tAdd">添加</button></div>
        <ul class="tests">${tests.length ? tests.map(t => `<li><span class="tn">${COACH.TESTS[t.type] ? COACH.TESTS[t.type].name : t.type}</span><span class="tv">${t.value}<small style="font-size:12px;color:var(--muted)"> ${COACH.TESTS[t.type] ? COACH.TESTS[t.type].unit : ""}</small></span><span class="td">${t.date.slice(2).replace(/-/g, "/")}</span><button class="x" data-del="${t.id}" aria-label="删除">×</button></li>`).join("")
          : `<li style="color:var(--muted);font-size:14px">还没有测试成绩。建议先测：30 米行进间跑、30 米起跑、立定跳远、深蹲 1RM。</li>`}</ul>
      </div>
      <h3 class="sec">参考目标（经验值，可按老师意见修改）</h3>
      <div class="group form">
        <div class="row"><label>深蹲 / 体重</label><input class="n" type="number" inputmode="decimal" step="0.1" data-t="squat_ratio" value="${tg.squat_ratio}"><span class="unit">倍</span></div>
        <div class="row"><label>立定跳远</label><input class="n" type="number" inputmode="decimal" step="0.05" data-t="slj" value="${tg.slj}"><span class="unit">m</span></div>
        <div class="row"><label>途中跑触地时间</label><input class="n" type="number" inputmode="decimal" step="0.005" data-t="ct" value="${tg.ct}"><span class="unit">s</span></div>
      </div>
      <button class="danger" id="delAthlete">删除这名运动员</button>`;
    const P = $("p-info");
    P.querySelectorAll("[data-f]").forEach(el => el.onchange = async () => {
      const f = el.dataset.f, num = ["height_cm", "weight_kg", "pb", "goalTime", "sessionsPerWeek"].includes(f);
      a[f] = num ? (el.value === "" ? undefined : Number(el.value)) : el.value.trim();
      if (f === "name" && !a.name) a.name = "未命名";
      await saveAthlete(); A.C = await computeAthlete(a); await renderBoardOnly(); if (f === "sport") { A.pane = "info"; renderPanes(); } toast("已保存");
    });
    P.querySelectorAll("[data-t]").forEach(el => el.onchange = async () => {
      a.targets = Object.assign({}, a.targets || {}, { [el.dataset.t]: Number(el.value) });
      await saveAthlete(); toast("已保存");
    });
    $("tAdd").onclick = async () => {
      const v = Number($("tVal").value);
      if (!(v > 0)) { toast("请输入成绩"); return; }
      a.tests = (a.tests || []).concat([{ id: "t" + Date.now(), type: $("tType").value, value: v, date: $("tDate").value || todayStr() }]);
      await saveAthlete(); toast("已添加，画像和计划已更新"); A.C = await computeAthlete(a); renderInfoPane(); renderBoardOnly();
    };
    P.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => {
      a.tests = (a.tests || []).filter(t => t.id !== b.dataset.del); await saveAthlete(); renderInfoPane();
    });
    $("delAthlete").onclick = async () => {
      if (!confirm(`删除 ${a.name} 的档案？训练记录会保留。`)) return;
      await dbDel("athletes", a.id); toast("已删除"); show("home");
    };
  }
  async function renderBoardOnly() { const keep = A.pane; await renderAthlete(); A.pane = keep; }

  // ================= 结果页：对比、手动标记、调试、加入计划 =================
  async function renderCompare() {
    const box = $("cmpBox");
    if (S.action !== "sprint") { box.innerHTML = ""; return; }
    const a = (await dbAll("athletes")).find(x => x.id === S.athleteId);
    const sm = S.result.summary, E = COACH.ELITE;
    const P = a ? COACH.profile(a, sm) : null;
    const items = [
      ["触地时间", sm.contact_time_s, P && P.targets.ct, E.ct, "s", 3, true],
      ["腾空时间", sm.flight_time_s, null, E.ft, "s", 3, false],
      ["步频", sm.step_frequency_hz, P && P.combos && P.combos.sfAtSameSL, E.sf, "步/秒", 2, false],
      ["步长", sm.step_length_m, P && P.combos && P.combos.slAtSameSF, E.sl, "m", 2, false],
      ["速度", sm.speed_mps, P && P.tgt.vmax, E.v, "m/s", 2, false],
    ].filter(x => Number.isFinite(x[1]));
    if (!items.length) { box.innerHTML = ""; return; }
    box.innerHTML = `<h3 class="sec" style="margin-top:4px">与目标、${E.name}对比</h3><div class="bars">${items.map(([n, v, t, e, u, d]) => {
      const max = Math.max(v, t || 0, e) * 1.12, pc = x => (x / max * 100).toFixed(1) + "%";
      return `<div class="br"><div class="bl"><span>${n}</span><b>${v.toFixed(d)} <small style="font-size:12px;color:var(--muted)">${u}</small></b></div>
        <div class="track"><div class="fill" style="width:${pc(v)}"></div>${Number.isFinite(t) ? `<div class="mk t" style="left:${pc(t)}"></div>` : ""}<div class="mk e" style="left:${pc(e)}"></div></div>
        <div class="keys">${Number.isFinite(t) ? `<span><i style="background:var(--green)"></i>目标 ${t.toFixed(d)}</span>` : ""}<span><i style="background:var(--red)"></i>${E.name} ${e.toFixed(d)}</span></div></div>`;
    }).join("")}</div>${!a || !Number.isFinite(a.goalTime) ? `<p class="lead" style="font-size:13px;margin-top:6px">在运动员档案里设定目标成绩后，这里会显示目标值。</p>` : ""}`;
  }

  function renderDebug() {
    const R = S.result, box = $("dbgBox");
    if (S.action !== "sprint" || !R.debug) { box.hidden = true; return; }
    box.hidden = false;
    const n = R.debug.left.ty.length, W = 600, H = 150, x = i => i / (n - 1) * W;
    const panel = (key, f, thr, label) => {
      const vals = ["left", "right"].map(s => R.debug[s][key].map(v => f(v, R.debug[s])));
      const all = vals.flat().filter(Number.isFinite), mx = Math.max(...all, thr * 1.2), mn = Math.min(0, ...all);
      const y = v => H - 16 - (v - mn) / (mx - mn || 1) * (H - 26);
      const line = (arr, c) => `<path d="${arr.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(Number.isFinite(v) ? v : mn).toFixed(1)}`).join("")}" fill="none" stroke="${c}" stroke-width="2"/>`;
      const spans = (R.steps || []).map(s => `<rect x="${x(s.touchdown_frame)}" y="0" width="${Math.max(2, x(s.toeoff_frame) - x(s.touchdown_frame))}" height="${H - 12}" fill="color-mix(in srgb, var(--${s.side === "left" ? "green" : "ink"}) 14%, transparent)"/>`).join("");
      return `<svg viewBox="0 0 ${W} ${H}">${spans}${line(vals[0], "var(--lane-l)")}${line(vals[1], "var(--lane-r)")}
        <line x1="0" x2="${W}" y1="${y(thr)}" y2="${y(thr)}" stroke="var(--red)" stroke-dasharray="5 4"/><text x="4" y="${H - 2}" font-size="13" fill="var(--muted)">${label}</text></svg>`;
    };
    const L = R.debug.left;
    $("debugPlot").innerHTML = panel("ty", (v, d) => d.groundY - v, L.groundY - L.nearY, "脚尖离地高度（像素），虚线以下才可能是触地") +
      panel("vx", (v, d) => v / (d.slowV / TH.sprint.stance_speed_ratio), TH.sprint.stance_speed_ratio, "脚尖水平速度 ÷ 跑速，虚线以下才可能是触地") +
      `<p>绿线左脚，深色线右脚；色块是识别到的触地。左右腿标签互换纠正 ${R.legSwaps || 0} 次。触地要求“足够低”和“几乎不动”同时满足。如果两条曲线从没同时落到虚线以下，常见原因：机位在动、人物太小或被遮挡、跑速太慢。截图这里发给开发者可以帮助排查。</p>`;
  }

  // 手动标记
  function setupMarking() {
    const box = $("markBox");
    box.hidden = !(S.action === "sprint" && !$("playerWrap").hidden && ((S.result.steps || []).length < 2 || S.result.manual));
    if (box.hidden) return;
    S.manual = S.manual || [];
    S.markSide = S.markSide || "left";
    $("markSide").querySelectorAll("button").forEach(b => { b.setAttribute("aria-pressed", b.dataset.s === S.markSide); b.onclick = () => { S.markSide = b.dataset.s; setupMarking(); }; });
    const done = S.manual.filter(c => c.to != null).length, open = S.manual.find(c => c.to == null);
    $("markInfo").textContent = S.manual.length ? `已手动标记 ${done} 次完整触地${open ? `，${open.side === "left" ? "左" : "右"}脚等待标记离地` : ""}。` : "逐帧找到脚刚接触地面的一帧点“着地”，刚离开地面的一帧点“离地”。标记后自动重新计算，手动结果优先。";
  }
  function recomputeFromManual() {
    const cts = S.manual.filter(c => c.to != null && c.to > c.td).map(c => ({ side: c.side, td: c.td, to: c.to }));
    if (!cts.length) return;
    const keep = { debug: S.result.debug, legSwaps: S.result.legSwaps, pose: S.result.pose };
    S.result = Object.assign(CM.sprintFromContacts(keep.pose || S.pose, S.fpsReal, TH, S.scale, cts), keep);
    S.result.notes.unshift(`以下结果使用教练手动标记的 ${cts.length} 次触地。`);
    S.result.manual = true;
    S.hits = CM.matchCards(S.result, TH, CARDS);
    renderResultPanels();
  }
  $("markTd").onclick = () => {
    const i = frameOf(pv.currentTime);
    S.manual = (S.manual || []).filter(c => !(c.side === S.markSide && c.to == null));
    S.manual.push({ side: S.markSide, td: i, to: null });
    toast(`${S.markSide === "left" ? "左" : "右"}脚着地：第 ${i + 1} 帧`); setupMarking();
  };
  $("markTo").onclick = () => {
    const i = frameOf(pv.currentTime);
    const c = (S.manual || []).find(x => x.side === S.markSide && x.to == null);
    if (!c) { toast("先标记这只脚的着地"); return; }
    if (i <= c.td) { toast("离地帧要在着地帧之后"); return; }
    c.to = i; toast(`触地 ${((i - c.td + 1) / S.fpsReal * 1000).toFixed(0)} ms`);
    S.markSide = S.markSide === "left" ? "right" : "left";
    setupMarking(); recomputeFromManual();
  };
  $("markClear").onclick = () => { S.manual = []; setupMarking(); toast("已清除手动标记，请重新分析以恢复自动结果"); };

  $("toPlanBtn").onclick = async () => {
    const a = (await dbAll("athletes")).find(x => x.id === S.athleteId);
    if (!a) return;
    const add = COACH.focusFromHits(S.hits.map(h => h.id));
    a.focus = [...new Set([...(a.focus || []), ...add])];
    await dbPut("athletes", a);
    toast("已加入训练计划重点");
  };


  // ================= 项目技术库 =================
  const GLYPH = {
    sprint: '<circle cx="31" cy="8" r="4"/><path d="M28 14l-7 10 8 5-3 12M21 24l-9 2M28 14l6 8 8-1M26 34l-11 6"/>',
    run: '<circle cx="26" cy="8" r="4"/><path d="M25 14l-3 13 6 6-2 11M22 27l-7 4M25 15l5 8 6 1M24 18l-7 5"/>',
    jump: '<circle cx="34" cy="10" r="4"/><path d="M31 16l-9 8 10 3M22 24l-10 4-4 8M31 16l7 6M26 20l-8-6M6 44h36"/>',
    lift: '<path d="M6 12h36"/><rect x="7" y="7" width="4" height="10" rx="1"/><rect x="37" y="7" width="4" height="10" rx="1"/><circle cx="24" cy="21" r="3.5"/><path d="M24 25v9M18 44l6-10 6 10M17 12l7 10 7-10"/>',
    flip: '<circle cx="20" cy="22" r="4"/><path d="M24 24c6 0 8 4 6 8s-8 4-10 0M20 26l-4 6"/><path d="M36 10a16 16 0 1 0 4 16" stroke-dasharray="3 4"/><path d="M40 20l0 6-6 0"/>',
    dive: '<circle cx="24" cy="30" r="4"/><path d="M24 26V10M20 8l4 2 4-2M24 34l-2 6M24 34l2 6M6 44c4-2 8-2 12 0s8 2 12 0 8-2 12 0"/>',
    spike: '<path d="M4 44V24h2v20"/><circle cx="36" cy="6" r="3.5"/><circle cx="24" cy="14" r="4"/><path d="M24 18l1 12-4 12M25 30l6 12M24 20l8-10M24 20l-8 2"/>',
    racket: '<circle cx="22" cy="14" r="4"/><path d="M22 18l1 12-5 12M23 30l6 12M22 20l9-8M22 21l-8 4"/><ellipse cx="35" cy="7" rx="4" ry="5"/><path d="M33 11l-2 3"/>',
    shoot: '<circle cx="24" cy="12" r="4"/><path d="M24 16v14l-5 12M24 30l5 12M24 18l3-9M24 18l-3-9"/><circle cx="25" cy="5" r="3"/><path d="M34 4h10M36 4l2 5h2l2-5"/>',
    kick: '<circle cx="20" cy="8" r="4"/><path d="M20 12l2 14-4 16M22 26l12-6M20 16l-8 6M20 16l8 3"/><circle cx="39" cy="22" r="4"/>',
  };
  const glyph = (k, size = 40) => `<svg viewBox="0 0 48 48" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${GLYPH[k] || GLYPH.run}</svg>`;
  let sportGroup = "";
  function renderSports() {
    if (!window.SPORTLIB) return;
    const G = SPORTLIB.GROUPS;
    $("sportGroups").innerHTML = [`<button aria-pressed="${!sportGroup}" data-g="">全部</button>`].concat(G.map(g => `<button aria-pressed="${sportGroup === g.id}" data-g="${g.id}">${g.name}</button>`)).join("");
    $("sportGroups").querySelectorAll("button").forEach(b => b.onclick = () => { sportGroup = b.dataset.g; renderSports(); });
    const list = SPORTLIB.SPORTS.filter(s => !sportGroup || s.group === sportGroup);
    $("sportGrid").innerHTML = list.map(s => `<button class="sport" data-s="${s.id}">${glyph(s.glyph)}<b>${esc(s.name)}</b><span>${esc(G.find(g => g.id === s.group).name)}　${s.techniques.length} 项技术</span></button>`).join("");
    $("sportGrid").querySelectorAll(".sport").forEach(b => { b.onclick = () => openSport(b.dataset.s); sportPhoto(b.dataset.s, b); });
  }
  // 项目照片：仓库里的 img/sport-<项目>.jpg，黑白处理；没有就用线条图标
  const photoCache = {};
  function sportPhoto(id, el) {
    if (window.CM_PREVIEW) return;
    const url = `img/sport-${id}.jpg`;
    const apply = () => { el.style.backgroundImage = `url("${url}")`; el.classList.add("photo"); el.style.filter = ""; };
    if (photoCache[id] === true) return apply();
    if (photoCache[id] === false) return;
    const img = new Image(); img.onload = () => { photoCache[id] = true; apply(); }; img.onerror = () => { photoCache[id] = false; }; img.src = url;
  }
  function errorRows(er) {
    const row = (k, v) => v && v !== "—" ? `<div class="er"><span>${k}</span><div>${Array.isArray(v) ? v.map(esc).join("<br>") : esc(v)}</div></div>` : "";
    return row("视频里怎么看", er.look) + row("技术原因", er.tech) + row("身体原因", er.body) + row("纠正练习", er.drills) + row("伤病风险", er.risk);
  }
  function openSport(id) {
    const s = SPORTLIB.byId(id), g = SPORTLIB.GROUPS.find(x => x.id === s.group);
    $("sportHead").classList.remove("photo"); $("sportHead").style.backgroundImage = "";
    sportPhoto(id, $("sportHead"));
    $("sportHead").innerHTML = `<div class="sh-glyph">${glyph(s.glyph, 64)}</div><div><div class="sh-path">${esc(g.parent)}　${esc(g.name)}</div><h2 class="big" style="margin:4px 0">${esc(s.name)}</h2><p class="lead" style="margin:0">${esc(g.desc)}</p></div>`;
    $("sportBody").innerHTML = s.techniques.map(t => `<article class="tech">
      <h3>${esc(t.name)}</h3>
      <div class="phases-seq">${t.phases.map((p, i) => `<span><i>${i + 1}</i>${esc(p)}</span>`).join("")}</div>
      <h4>关键技术点</h4><ul class="kp">${t.keyPoints.map(k => `<li>${esc(k)}</li>`).join("")}</ul>
      <h4>常见错误</h4>${t.errors.map(er => `<details class="errd"><summary>${esc(er.error)}</summary>${errorRows(er)}</details>`).join("")}
      <button class="btn go" data-t="${t.id}" style="width:100%;margin-top:14px">分析这个技术的视频</button></article>`).join("") +
      `<p class="lead" style="font-size:13px;margin-top:14px">技术库按项群训练理论组织，内容为教练经验与教材共识，个别数值为经验参考，请结合老师意见使用。</p>`;
    $("sportBody").querySelectorAll("button[data-t]").forEach(b => b.onclick = () => {
      const t = SPORTLIB.tech(id, b.dataset.t);
      startNew(t.mode === "general" ? "general" : t.mode, { sportId: id, techId: t.id });
    });
    show("sport");
  }
  // 结果页：技术要点检查（教练逐条判断）+ 常见错误对照
  function renderChecklist() {
    const box = $("checkBox");
    const t = S.sportId && window.SPORTLIB ? SPORTLIB.tech(S.sportId, S.techId) : null;
    if (!t) { box.innerHTML = ""; return; }
    S.checks = S.checks || {};
    const opts = [["ok", "达标"], ["fix", "待改进"]];
    box.innerHTML = `<h3 class="sec">技术要点检查</h3><p class="lead" style="margin-top:-4px">一边逐帧回放，一边逐条判断。结果会随记录保存。</p>
      <div class="checks">${t.keyPoints.map((k, i) => `<div class="ck"><p>${esc(k)}</p><div class="verdict">${opts.map(([v, l]) => `<button data-i="${i}" data-v="${v}" aria-pressed="${S.checks[i] === v}">${l}</button>`).join("")}</div></div>`).join("")}</div>
      <h3 class="sec">常见错误对照</h3>${t.errors.map(er => `<details class="errd"><summary>${esc(er.error)}</summary>${errorRows(er)}</details>`).join("")}`;
    box.querySelectorAll(".ck button").forEach(b => b.onclick = () => { const i = b.dataset.i; S.checks[i] = S.checks[i] === b.dataset.v ? "" : b.dataset.v; renderChecklist(); });
  }

  // ---------------- 封面 ----------------
  const HERO = {
    sprint: { title: "SPRINT", eyebrow: "第一章　速度", issue: "Chapter I · The Anatomy of Speed", story: "看清每一次触地", line: "Where speed meets science.", go: "分析一段短跑视频", action: "sprint" },
    lift: { title: "POWER", eyebrow: "第二章　力量", issue: "Chapter II · The Path of the Bar", story: "看清杠铃走过的每一厘米", line: "Where strength meets precision.", go: "分析一段举重视频", action: "clean" },
  };
  let cover = null;
  function setWorld(w) {
    const H = HERO[w] || HERO.sprint;
    document.querySelectorAll(".mnav button[data-w]").forEach(b => b.setAttribute("aria-pressed", b.dataset.w === w));
    $("heroTitle").textContent = H.title; $("heroLine").textContent = H.line; $("heroEyebrow").textContent = H.eyebrow;
    $("heroIssue").textContent = H.issue; $("heroStory").textContent = H.story;
    $("heroGo").textContent = H.go; $("heroGo").dataset.action = H.action;
    if (cover) cover.setWorld(w);
    try { localStorage.setItem("cm_world", w); } catch (e) { /* 忽略 */ }
  }
  // 开场即封面：田径场日出（本次打开第一次完整播放；之后快速亮起；点一下可加速）
  {
    const hero = $("hero");
    let seen = false; try { seen = sessionStorage.getItem("cm_intro") === "1"; sessionStorage.setItem("cm_intro", "1"); } catch (e) { /* 忽略 */ }
    const reveal = () => hero.classList.remove("intro");
    if (window.Cover) { cover = new Cover($("heroCanvas"), { world: localStorage.getItem("cm_world") || "sprint", intro: !seen, onReveal: reveal }); cover.start(); }
    else reveal();
    setTimeout(reveal, seen ? 1500 : 9000);
  }
  document.querySelectorAll(".mnav button[data-w]").forEach(b => b.onclick = () => setWorld(b.dataset.w));
  document.querySelectorAll(".mnav a").forEach(l => l.onclick = e => { e.preventDefault(); const t = document.querySelector(l.getAttribute("href")); if (t) t.scrollIntoView({ behavior: "smooth", block: "start" }); });
  $("heroGo").onclick = () => startNew($("heroGo").dataset.action);
  setWorld(localStorage.getItem("cm_world") || "sprint");

  // ---------------- 启动 ----------------
  if (!window.CM_PREVIEW && "serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
  $("bar").hidden = true;
  renderHome(); renderPeople(); renderSports(); renderModelState();
})();
