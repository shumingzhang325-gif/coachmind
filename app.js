/* 知练 CoachMind App：本机存储、视频逐帧处理、姿态估计、标定、结果展示 */
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const TH = CM_THRESHOLDS, CARDS = CM_CARDS;
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
  const ACTION_NAME = { sprint: "短跑", clean: "高翻 / 抓举" };

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
  let viewStack = ["home"];
  const VIEW_META = {
    home: { title: "", step: 0 }, new: { title: "选择视频", step: 1 }, calib: { title: "片段与标定", step: 2 },
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
    if (v === "home") { viewStack = ["home"]; stopPlayback(); renderHome(); renderPeople(); renderModelState(); if (cover) requestAnimationFrame(() => cover.resize()); }
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
        : [a.summary.peak_bar_velocity_mps != null ? a.summary.peak_bar_velocity_mps.toFixed(2) : "–", "m/s 峰速"];
      const n = (a.hits || []).length;
      const tag = a.reviewed ? `<span class="ok">教练已确认</span>` : n ? `<span class="flag">${n} 个待查问题</span>` : "";
      return `<li><button data-id="${a.id}">
        <span class="d"><b>${String(d.getDate()).padStart(2, "0")}</b>${d.getMonth() + 1}月</span>
        <span><span class="who">${esc(a.athleteName || "未指定")}</span><br><span class="what">${ACTION_NAME[a.action]}　${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}</span></span>
        <span class="val">${val}<small>${unit}</small>${tag}</span></button></li>`;
    }).join("") : `<li class="blank">还没有记录。选一个动作，分析第一段视频。</li>`;
    $("historyList").querySelectorAll("button[data-id]").forEach(b => b.onclick = () => openSaved(Number(b.dataset.id)));
  }
  document.querySelectorAll(".lane").forEach(b => b.onclick = () => startNew(b.dataset.action));

  // ---------------- 新建分析 ----------------
  async function startNew(action) {
    for (const k of Object.keys(S)) delete S[k];
    S.action = action;
    $("newTitle").textContent = ACTION_NAME[action] + "分析";
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
    if (S.phase === "calib") {
      S.calibPts.forEach((p, i) => {
        cctx.fillStyle = "#34C27A"; cctx.strokeStyle = "#fff";
        cctx.beginPath(); cctx.arc(p[0], p[1], lw * 4, 0, 7); cctx.fill(); cctx.stroke();
        if (S.action === "sprint" && i === 1) { cctx.strokeStyle = "#34C27A"; cctx.beginPath(); cctx.moveTo(...S.calibPts[0]); cctx.lineTo(...p); cctx.stroke(); }
      });
      if (S.action === "clean" && S.calibPts.length === 2) {
        const [c, e] = S.calibPts, r = Math.hypot(e[0] - c[0], e[1] - c[1]);
        cctx.strokeStyle = "#34C27A"; cctx.lineWidth = lw * 1.5; cctx.beginPath(); cctx.arc(c[0], c[1], r, 0, 7); cctx.stroke();
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
    await seek(hiddenVideo, S.phase === "range" ? S.start : S.start + 0.5 / S.fpsFile);
    drawCalib();
  }
  function updateCalibUI() {
    const range = S.phase === "range";
    $("calibTitle").textContent = range ? "选择片段" : (S.action === "sprint" ? "标定距离" : "标定杠铃片");
    $("calibHint").textContent = range ? "拖动时间尺，把起点设在运动员入画前、终点设在出画后。高翻的终点设在接杠站稳后。"
      : S.action === "sprint" ? `在画面上依次点两个标志桶的底部（间距 ${S.markerDist} 米）。不标定也能算触地时间，但算不了步长和速度。`
      : S.calibPts.length === 0 ? "先点杠铃片的中心。" : S.calibPts.length === 1 ? "再点杠铃片的边缘。" : "绿圈应该正好套住杠铃片。不对就撤销重点。";
    $("rangeControls").hidden = !range; $("calibControls").hidden = range;
    $("skipCalib").hidden = S.action !== "sprint";
    $("calibRuler").style.pointerEvents = range ? "" : "none";
    $("calibRuler").style.opacity = range ? "1" : "0.45";
    $("calibNext").textContent = range ? "下一步：标定" : "开始分析";
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
    if (S.phase !== "calib") return;
    const b = cc.getBoundingClientRect();
    const p = [(e.clientX - b.left) * S.W / b.width, (e.clientY - b.top) * S.H / b.height];
    if (S.calibPts.length >= 2) S.calibPts = [];
    S.calibPts.push(p);
    drawCalib(); updateCalibUI();
  });
  $("undoPt").onclick = () => { S.calibPts.pop(); drawCalib(); updateCalibUI(); };
  $("skipCalib").onclick = () => { S.calibPts = []; runAnalysis(); };
  $("calibNext").onclick = async () => {
    if (S.phase === "range") { S.phase = "calib"; S.calibPts = []; await enterCalib(); return; }
    if (S.action === "sprint" && S.calibPts.length === 1) { toast("还差一个标志桶"); return; }
    runAnalysis();
  };

  // ---------------- 姿态模型 ----------------
  let landmarkerP = null, loadLog = [];
  const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(what + "超时")), ms))]);
  const stageErr = stage => Object.assign(new Error(stage), { stage });
  const MODEL_MIN_BYTES = 1_000_000;
  const isZip = buf => { const b = new Uint8Array(buf, 0, Math.min(4, buf.byteLength || 0)); return (b[0] === 0x50 && b[1] === 0x4B) || (b.length >= 4 && b[0] === 0 && b[1] === 0 && b[2] === 0x50 && b[3] === 0x4B); };
  const normalizeTask = buf => {
    const b = new Uint8Array(buf, 0, Math.min(4, buf.byteLength || 0));
    if (b.length >= 4 && b[0] === 0 && b[1] === 0 && b[2] === 0x50 && b[3] === 0x4B) return buf.slice(2);
    return buf;
  };

  // 第 2 步：拿到模型文件（本机已保存 → 你的网站 → Google），成功后存进本机
  async function getModelBytes(onStatus) {
    try {
      const rec = await dbGet("files", "pose_model");
      if (rec && rec.bytes && rec.bytes.byteLength > MODEL_MIN_BYTES) {
        if (isZip(rec.bytes)) return normalizeTask(rec.bytes);
        loadLog.push("模型　本机保存的文件已损坏，已删除"); await dbDel("files", "pose_model");
      }
    } catch (e) { /* 继续 */ }
    for (const m of MODEL_SOURCES) {
      onStatus && onStatus(`正在下载姿态模型（${m.name}）`);
      try {
        const r = await withTimeout(fetch(m.url, { cache: "no-store" }), 90000, "下载");
        if (!r.ok) { loadLog.push(`模型　${m.name}：${r.status === 404 ? "找不到这个文件（404），仓库里没有它" : "服务器返回错误 " + r.status}`); continue; }
        const buf = await withTimeout(r.arrayBuffer(), 120000, "下载");
        if (buf.byteLength < MODEL_MIN_BYTES) { loadLog.push(`模型　${m.name}：文件只有 ${buf.byteLength < 1024 ? buf.byteLength + " 字节" : Math.round(buf.byteLength / 1024) + " KB"}，不完整${buf.byteLength < 1000 ? "。这是 Git LFS 占位文件，GitHub Pages 不提供真实文件" : ""}`); continue; }
        if (!isZip(buf)) { loadLog.push(`模型　${m.name}：文件头不像 .task 模型（${(buf.byteLength / 1e6).toFixed(1)} MB），仍然尝试使用`); }
        const bytes = normalizeTask(buf);
        await dbPut("files", { id: "pose_model", bytes, from: m.name, saved: new Date().toISOString() });
        return bytes;
      } catch (e) { loadLog.push(`模型　${m.name}：连不上${m.name === "Google" ? "（国内网络通常访问不了）" : ""}（${errText(e)}）`); }
    }
    throw stageErr("model");
  }

  const errText = e => (e && (e.message || e.type || (typeof e === "string" ? e : ""))) || (() => { try { return JSON.stringify(e); } catch (x) { return String(e); } })();

  function getLandmarker(onStatus) {
    if (landmarkerP) return landmarkerP;
    loadLog = [];
    landmarkerP = (async () => {
      const bytes = await getModelBytes(onStatus);
      // 运算库和运行环境必须是同一个版本：先逐个来源“成对”尝试，全部失败再交叉组合
      const libs = [];
      const tryStart = async (L, w) => {
        let fileset;
        try { fileset = await withTimeout(L.lib.FilesetResolver.forVisionTasks(w.wasm), 15000, "准备"); }
        catch (e) { fileset = { wasmLoaderPath: `${w.wasm}/vision_wasm_internal.js`, wasmBinaryPath: `${w.wasm}/vision_wasm_internal.wasm` }; }
        for (const delegate of ["GPU", "CPU"]) {
          onStatus && onStatus(`正在启动识别（${w.name}${delegate === "CPU" ? "，兼容模式" : ""}）`);
          try {
            const lm = await withTimeout(L.lib.PoseLandmarker.createFromOptions(fileset, {
              baseOptions: { modelAssetBuffer: new Uint8Array(bytes), delegate }, runningMode: "VIDEO", numPoses: 1,
              minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
            }), 60000, "启动");
            loadLog.push(`成功：运算库 ${L.src.name} + 运行环境 ${w.name} + ${delegate}`);
            return lm;
          } catch (e) { loadLog.push(`运行环境　库:${L.src.name}　环境:${w.name}　${delegate}：${errText(e)}`); }
        }
        return null;
      };
      for (const c of LIB_SOURCES) {
        onStatus && onStatus(`正在加载运算库（${c.name}）`);
        let lib;
        try { lib = await withTimeout(import(c.bundle), 20000, "下载"); }
        catch (e) { loadLog.push(`运算库　${c.name}：${errText(e)}`); continue; }
        const L = { src: c, lib };
        libs.push(L);
        const lm = await tryStart(L, c);
        if (lm) return lm;
      }
      if (!libs.length) throw stageErr("lib");
      for (const L of libs) for (const w of LIB_SOURCES) {
        if (w === L.src) continue;
        const lm = await tryStart(L, w);
        if (lm) return lm;
      }
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
    await check("pose_landmarker_full.task", 1000000, b => (b[0] === 0x50 && b[1] === 0x4B) || (b[0] === 0 && b[1] === 0 && b[2] === 0x50 && b[3] === 0x4B));
    try {
      const rec = await dbGet("files", "pose_model");
      if (rec && rec.bytes) ok("本机保存的模型", isZip(rec.bytes), `${(rec.bytes.byteLength / 1e6).toFixed(2)} MB，来自${rec.from}${isZip(rec.bytes) ? "" : "，文件头不对，已损坏"}`);
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
    if (!isZip(buf) && !confirm("这个文件看起来不像姿态模型（pose_landmarker_full.task）。仍然导入吗？")) return false;
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
      const stage = e.stage || "runtime";
      $("procHead").hidden = true;
      $("procError").hidden = false;
      const detail = `<div id="diagBox"><p class="lead" style="font-size:13px;margin:12px 0 0">正在自检识别环境…</p></div>
        <details open style="margin-top:12px"><summary style="color:var(--muted);font-size:14px;cursor:pointer">详细日志（截图发给开发者）</summary><code>${loadLog.map(esc).join("<br>") || esc(errText(e))}</code></details>
        <button class="btn" id="clearRetry" style="width:100%;margin-top:12px">清除缓存后重新下载</button>`;
      const T = {
        lib: `<h3>运算库没有加载成功</h3><p>App 从你的网站和几个镜像都没拿到运算库文件。</p>
          <ol><li>确认 GitHub 仓库里有 vision_bundle.mjs、vision_wasm_internal.js、vision_wasm_internal.wasm 三个文件（由“下载离线文件.bat”下载）</li><li>或者打开能访问国外网站的网络后点“重试”</li></ol>`,
        model: `<h3>没拿到姿态模型文件</h3>
          <p>识别需要模型文件 pose_landmarker_full.task（约 9 MB），App 试了这些地方都没拿到：</p>
          <ul style="margin:6px 0 10px;padding-left:18px">${loadLog.filter(l => l.startsWith("模型")).map(l => `<li style="margin:4px 0">${esc(l.replace(/^模型　/, ""))}</li>`).join("")}</ul>
          <p style="font-weight:600;margin:12px 0 4px">解决办法（任选一个）</p>
          <ol><li><b>最快：</b>在能访问国外网站的网络下，用 Safari 打开首页“姿态识别模型”里的地址，下载到“文件”App，然后点下面的“从文件导入模型”</li>
          <li>让仓库里的 pose_landmarker_full.task 恢复正常（上面写着“你的网站”的那一行说明了它现在的问题）</li></ol>
          <label class="btn go" for="modelFile" style="margin-top:14px;width:100%">从文件导入模型</label>`,
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
    let tracker = null, lastTs = -1, lastMT = null, dupes = 0;
    const t0 = performance.now();
    for (let i = 0; i < N; i++) {
      if (S.cancel) { S.processing = false; toast("已取消"); show("calib", false); return; }
      const mt = await seek(hiddenVideo, S.start + (i + 0.5) / S.fpsFile);
      if (mt != null && lastMT != null && Math.abs(mt - lastMT) < 1e-6) dupes++;
      if (mt != null) lastMT = mt;
      pctx.drawImage(hiddenVideo, 0, 0, S.W, S.H);
      let ts = Math.round(i * 1000 / S.fpsReal); if (ts <= lastTs) ts = lastTs + 1; lastTs = ts;
      try {
        const r = lm.detectForVideo(pc, ts);
        if (r.landmarks && r.landmarks[0]) pose[i] = r.landmarks[0].map(p => [p.x * S.W, p.y * S.H, p.visibility == null ? 1 : p.visibility]);
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
        const el = (performance.now() - t0) / 1000, left = el / (i + 1) * (N - i - 1);
        $("procBar").style.width = ((i + 1) / N * 100).toFixed(1) + "%";
        $("procPct").innerHTML = `${Math.floor((i + 1) / N * 100)}<small>%</small>`;
        $("procStatus").textContent = `第 ${i + 1} 帧，共 ${N} 帧　还需约 ${Math.ceil(left)} 秒`;
        await sleep(0);
      }
    }
    S.processing = false;
    S.pose = pose; S.bar = bar; S.N = N; S.dupes = dupes;
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
    const fs = S.fpsReal;
    S.scale = scale;
    S.result = S.action === "sprint" ? CM.analyzeSprint(S.pose, fs, TH, scale)
      : CM.analyzeClean(S.bar, fs, scale, TH, detected > 0.5 ? S.pose : null);
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
      ctx.fillStyle = "#34C27A";
      for (let j = 11; j < 33; j++) if (p[j]) { ctx.beginPath(); ctx.arc(p[j][0] * s, p[j][1] * s, lw * 1.6, 0, 7); ctx.fill(); }
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
    clean: ["peak_bar_velocity_mps", "max_bar_height_m", "drop_under_m"],
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
    const [k0, k1, k2] = BOARD[S.action];
    const cell = k => { const v = R.summary[k]; const [name, unit] = CM.LABELS[k] || [k, ""]; return { v: v == null ? "–" : CM.fmt(v, unit), unit: v == null ? "" : unit, name, hit: hitMetrics.has(k) }; };
    const m0 = cell(k0), m1 = cell(k1), m2 = cell(k2);
    $("board").innerHTML = `<div class="who"><span>${esc(S.athleteName || "")}　${ACTION_NAME[S.action]}</span><span class="n">${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}</span></div>
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
    renderCompare(); renderDebug(); setupMarking();
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
    drawOverlay(octx, ((S.result && S.result.pose) || S.pose)[i], { scale: ov.width / S.W, bar: S.bar, i, contactSide: contactByFrame && contactByFrame.get(i) });
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
      athleteId: S.athleteId, athleteName: S.athleteName, action: S.action, fileName: S.file ? S.file.name : S.fileName,
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
    Object.assign(S, { action: rec.action, athleteId: rec.athleteId, athleteName: rec.athleteName, fpsReal: rec.fpsReal, N: rec.N,
      savedId: rec.id, date: rec.date, verdicts: Object.assign({}, rec.verdicts), coachNote: rec.coachNote, fileName: rec.fileName, savedSeries: rec.series });
    const series = rec.series || {};
    S.result = { action: rec.action, summary: rec.summary, steps: rec.steps, notes: rec.notes, events: series.events || {}, series };
    if (rec.action === "clean" && series.h) S.N = series.h.length;
    S.hits = CM.matchCards(S.result, TH, CARDS);
    showResult(false);
  }

  function reportText() {
    const R = S.result, L = [`知练 CoachMind　${S.athleteName}　${ACTION_NAME[S.action]}`, fmtDate(S.date || new Date().toISOString()), ""];
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

  async function renderPeople() {
    const athletes = (await dbAll("athletes")).sort((a, b) => a.name.localeCompare(b.name, "zh"));
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
    $("p-plan").innerHTML = `
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
        <div class="row"><label>性别</label><select data-f="sex"><option ${a.sex !== "女" ? "selected" : ""}>男</option><option ${a.sex === "女" ? "selected" : ""}>女</option></select></div>
        <div class="row"><label>身高</label><input class="n" type="number" inputmode="decimal" data-f="height_cm" value="${a.height_cm ?? ""}"><span class="unit">cm</span></div>
        <div class="row"><label>体重</label><input class="n" type="number" inputmode="decimal" data-f="weight_kg" value="${a.weight_kg ?? ""}"><span class="unit">kg</span></div>
      </div>
      <h3 class="sec">成绩与目标</h3>
      <div class="group form">
        <div class="row"><label>100 米最好成绩</label><input class="n" type="number" inputmode="decimal" step="0.01" data-f="pb" value="${a.pb ?? ""}"><span class="unit">s</span></div>
        <div class="row"><label>目标成绩</label><input class="n" type="number" inputmode="decimal" step="0.01" data-f="goalTime" value="${a.goalTime ?? ""}"><span class="unit">s</span></div>
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
      await saveAthlete(); A.C = await computeAthlete(a); renderBoardOnly(); toast("已保存");
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
    $("dbg").innerHTML = panel("ty", (v, d) => d.groundY - v, L.groundY - L.nearY, "脚尖离地高度（像素），虚线以下才可能是触地") +
      panel("vx", (v, d) => v / (d.slowV / TH.sprint.stance_speed_ratio), TH.sprint.stance_speed_ratio, "脚尖水平速度 ÷ 跑速，虚线以下才可能是触地") +
      `<p>绿线左脚，深色线右脚；色块是识别到的触地。左右腿标签互换纠正 ${R.legSwaps || 0} 次。触地要求“足够低”和“几乎不动”同时满足。如果两条曲线从没同时落到虚线以下，常见原因：机位在动、人物太小或被遮挡、跑速太慢。截图这里发给开发者可以帮助排查。</p>`;
  }

  // 手动标记
  function setupMarking() {
    const box = $("markBox");
    box.hidden = !(S.action === "sprint" && !$("playerWrap").hidden);
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

  // ---------------- 封面 ----------------
  const HERO = {
    sprint: { title: "短跑", line: "看清 0.1 秒里的每一次触地", go: "分析一段短跑视频", action: "sprint" },
    lift: { title: "高翻 / 抓举", line: "看清杠铃走过的每一厘米", go: "分析一段举重视频", action: "clean" },
  };
  let cover = null;
  function setWorld(w) {
    const H = HERO[w] || HERO.sprint;
    document.querySelectorAll(".worlds button").forEach(b => b.setAttribute("aria-pressed", b.dataset.w === w));
    $("heroTitle").textContent = H.title; $("heroLine").textContent = H.line;
    $("heroGo").textContent = H.go; $("heroGo").dataset.action = H.action;
    if (cover) cover.setWorld(w);
    try { localStorage.setItem("cm_world", w); } catch (e) { /* 忽略 */ }
  }
  if (window.Cover) {
    cover = new Cover($("heroCanvas"), { world: localStorage.getItem("cm_world") || "sprint" });
    cover.start();
  }
  document.querySelectorAll(".worlds button").forEach(b => b.onclick = () => setWorld(b.dataset.w));
  $("heroGo").onclick = () => startNew($("heroGo").dataset.action);
  setWorld(localStorage.getItem("cm_world") || "sprint");

  // ---------------- 启动 ----------------
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
  $("bar").hidden = true;
  renderHome(); renderPeople(); renderModelState();
})();
