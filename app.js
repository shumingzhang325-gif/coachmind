/* 知练 CoachMind App：本机存储、视频逐帧处理、姿态估计、标定、结果展示 */
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const TH = CM_THRESHOLDS, CARDS = CM_CARDS;
  const MP_VERSION = "0.10.14";
  const MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
  const MODEL_URLS = [
    "pose_landmarker_full.task",
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task",
  ];
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
      const r = indexedDB.open("coachmind", 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore("athletes", { keyPath: "id" });
        r.result.createObjectStore("analyses", { keyPath: "id" });
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

  // ---------------- 视图切换 ----------------
  const S = {};                // 当前分析的状态
  let viewStack = ["home"];
  function show(v, push = true) {
    document.querySelectorAll("section.view").forEach(s => s.classList.toggle("on", s.id === "v-" + v));
    if (push && viewStack[viewStack.length - 1] !== v) viewStack.push(v);
    $("backBtn").hidden = v === "home";
    window.scrollTo(0, 0);
    if (v === "home") { viewStack = ["home"]; stopPlayback(); renderHome(); }
  }
  $("backBtn").onclick = () => {
    if (S.processing) { S.cancel = true; return; }
    viewStack.pop();
    const prev = viewStack[viewStack.length - 1] || "home";
    show(prev === "process" ? "calib" : prev, false);
  };

  // ---------------- 首页 ----------------
  let athleteFilter = null;
  async function renderHome() {
    const [athletes, analyses] = await Promise.all([dbAll("athletes"), dbAll("analyses")]);
    const chips = $("athleteFilter");
    chips.innerHTML = athletes.length ? [`<button aria-pressed="${!athleteFilter}" data-a="">全部</button>`]
      .concat(athletes.map(a => `<button aria-pressed="${athleteFilter === a.id}" data-a="${a.id}">${esc(a.name)}</button>`)).join("") : "";
    chips.querySelectorAll("button").forEach(b => b.onclick = () => { athleteFilter = b.dataset.a || null; renderHome(); });
    const list = analyses.filter(a => !athleteFilter || a.athleteId === athleteFilter).sort((a, b) => b.id - a.id);
    $("historyList").innerHTML = list.length ? list.map(a => {
      const key = a.action === "sprint" ? (a.summary.contact_time_s ? `触地 ${a.summary.contact_time_s.toFixed(3)} s` : "")
        : (a.summary.peak_bar_velocity_mps ? `峰速 ${a.summary.peak_bar_velocity_mps.toFixed(2)} m/s` : "");
      const n = (a.hits || []).length;
      return `<li><button data-id="${a.id}"><span class="t">${esc(a.athleteName || "未指定")} · ${ACTION_NAME[a.action]}</span>
        <span class="k num">${key}${n ? `<br><span class="tag">${n} 个问题</span>` : ""}</span>
        <span class="s">${fmtDate(a.date)}${a.reviewed ? " · 教练已确认" : ""}</span></button></li>`;
    }).join("") : `<li class="empty">还没有记录。选择上面的动作开始第一次分析。</li>`;
    $("historyList").querySelectorAll("button[data-id]").forEach(b => b.onclick = () => openSaved(Number(b.dataset.id)));
  }
  document.querySelectorAll(".choice button").forEach(b => b.onclick = () => startNew(b.dataset.action));

  // ---------------- 新建分析 ----------------
  async function startNew(action) {
    for (const k of Object.keys(S)) delete S[k];
    S.action = action;
    $("newTitle").textContent = ACTION_NAME[action] + "分析";
    $("markerField").hidden = action !== "sprint";
    $("fileInfo").innerHTML = ""; $("fpsBox").hidden = true; $("fileInput").value = "";
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

  // 帧率检测：① 逐帧精确测量 ② 解析 MP4/MOV 文件头 ③ 都失败时按 30 并提示
  async function detectFps(file, video) {
    try {
      const f = await probeFps(video);
      if (f && f > 5 && f < 2000) return { fps: f, method: "逐帧测量" };
    } catch (e) { /* 继续 */ }
    try {
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
    $("fileInfo").innerHTML = `<p class="hint">正在读取 ${esc(file.name)}…</p>`;
    hiddenVideo.src = S.url;
    try {
      await primeVideo(hiddenVideo);
    } catch (err) {
      $("fileInfo").innerHTML = `<div class="note">这个视频无法播放。请在 iPhone 设置 → 相机 → 格式 里选“兼容性最佳”后重拍。</div>`;
      return;
    }
    $("fileInfo").innerHTML = `<p class="hint">正在检测帧率…</p>`;
    const d = await detectFps(file, hiddenVideo);
    await seek(hiddenVideo, 0);
    S.fpsFile = d.fps; S.duration = hiddenVideo.duration;
    S.vw = hiddenVideo.videoWidth; S.vh = hiddenVideo.videoHeight;
    const k = Math.min(1, WORK_LONG_SIDE / Math.max(S.vw, S.vh));
    S.W = Math.round(S.vw * k); S.H = Math.round(S.vh * k);
    S.start = 0; S.end = S.duration;
    const hi = d.fps >= 100;
    $("fpsReal").value = hi ? Math.round(d.fps) : 240;
    $("fileInfo").innerHTML = `<p class="meta num">${S.vw}×${S.vh} · 帧率 ${d.fps.toFixed(1)} fps（${d.method}） · ${S.duration.toFixed(2)} s</p>` +
      (d.unknown ? `<div class="note">没能检测到帧率，下面按 240 填写。请确认这是慢动作原片。</div>` :
       hi ? `<div class="note info">检测到高帧率原片，可以直接分析。</div>`
          : `<div class="note">文件只有 ${Math.round(d.fps)} fps。如果这是 iPhone 慢动作被导出成了慢放视频，保持下面的 240；如果本来就是普通速度拍的，请改成 ${Math.round(d.fps)}（触地时间会不准）。</div>`);
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
        cctx.fillStyle = "#43B35A"; cctx.strokeStyle = "#fff";
        cctx.beginPath(); cctx.arc(p[0], p[1], lw * 4, 0, 7); cctx.fill(); cctx.stroke();
        if (S.action === "sprint" && i === 1) { cctx.strokeStyle = "#43B35A"; cctx.beginPath(); cctx.moveTo(...S.calibPts[0]); cctx.lineTo(...p); cctx.stroke(); }
      });
      if (S.action === "clean" && S.calibPts.length === 2) {
        const [c, e] = S.calibPts, r = Math.hypot(e[0] - c[0], e[1] - c[1]);
        cctx.strokeStyle = "#43B35A"; cctx.lineWidth = lw * 1.5; cctx.beginPath(); cctx.arc(c[0], c[1], r, 0, 7); cctx.stroke();
      }
    }
  }
  function calibText() {
    const n = Math.round((S.end - S.start) * S.fpsFile);
    const real = n / S.fpsReal;
    $("rangeInfo").textContent = `片段 ${(S.end - S.start).toFixed(2)} s · ${n} 帧（真实时长 ${real.toFixed(2)} s）`;
    const warn = $("calibWarn");
    const perFrame = 0.12;                        // 估算每帧处理时间（秒）
    warn.innerHTML = n * perFrame > 60 ? `<div class="note">片段有 ${n} 帧，预计处理约 ${Math.round(n * perFrame / 60)} 分钟。建议只保留运动员经过的部分。</div>` : "";
  }
  async function enterCalib() {
    cc.width = S.W; cc.height = S.H;
    $("calibScrub").max = 1000;
    $("calibScrub").value = Math.round(S.start / S.duration * 1000);
    $("calibTime").textContent = S.start.toFixed(3) + " s";
    show("calib");
    updateCalibUI();
    await seek(hiddenVideo, S.phase === "range" ? S.start : S.start + 0.5 / S.fpsFile);
    drawCalib();
  }
  function updateCalibUI() {
    const range = S.phase === "range";
    $("calibTitle").textContent = range ? "选择分析片段" : (S.action === "sprint" ? "标定距离" : "标定杠铃片");
    $("calibHint").textContent = range ? "拖动进度条，把起点设在运动员进入画面前，终点设在离开画面后（高翻设在接杠站稳后）。"
      : S.action === "sprint" ? `在画面上依次点两个标志桶的底部（间距 ${S.markerDist} 米）。不标定也能算触地时间，但算不了步长和速度。`
      : "先点杠铃片中心，再点杠铃片边缘。这一帧是片段起点，杠铃必须清楚可见。";
    $("rangeControls").hidden = !range; $("calibControls").hidden = range;
    $("skipCalib").hidden = S.action !== "sprint";
    $("calibScrub").disabled = !range;
    $("calibNext").textContent = range ? "下一步：标定" : "开始分析";
    $("calibNext").disabled = !range && S.action === "clean" && S.calibPts.length < 2;
    calibText();
  }
  $("calibScrub").oninput = async e => {
    const t = S.duration * e.target.value / 1000;
    $("calibTime").textContent = t.toFixed(3) + " s";
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
  let landmarkerP = null;
  function getLandmarker() {
    if (landmarkerP) return landmarkerP;
    landmarkerP = (async () => {
      const { PoseLandmarker, FilesetResolver } = await import(`${MP_BASE}/vision_bundle.mjs`);
      const fileset = await FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
      let lastErr;
      for (const url of MODEL_URLS) {
        for (const delegate of ["GPU", "CPU"]) {
          try {
            return await PoseLandmarker.createFromOptions(fileset, {
              baseOptions: { modelAssetPath: url, delegate }, runningMode: "VIDEO", numPoses: 1,
              minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
            });
          } catch (e) { lastErr = e; }
        }
      }
      throw lastErr || new Error("模型加载失败");
    })();
    landmarkerP.catch(() => { landmarkerP = null; });
    return landmarkerP;
  }

  // ---------------- 逐帧分析 ----------------
  const pc = $("procCanvas");
  async function runAnalysis() {
    show("process");
    S.processing = true; S.cancel = false;
    pc.width = S.W; pc.height = S.H;
    const pctx = pc.getContext("2d", { willReadFrequently: true });
    $("procBar").style.width = "0%";
    $("procStatus").textContent = "加载姿态模型（首次约需半分钟）…";
    let lm;
    try { lm = await getLandmarker(); }
    catch (e) {
      S.processing = false;
      $("procStatus").innerHTML = `姿态模型加载失败：${esc(e.message || e)}<br>请检查网络。首次使用需要联网下载模型，之后可离线使用。`;
      return;
    }
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
        $("procStatus").textContent = `第 ${i + 1} / ${N} 帧 · 预计还需 ${Math.ceil(left)} 秒`;
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
  $("cancelProc").onclick = () => { S.cancel = true; };

  function computeResult(detected) {
    let scale = null;
    if (S.action === "sprint" && S.calibPts.length === 2 && S.markerDist) {
      const [a, b] = S.calibPts; scale = S.markerDist / Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    if (S.action === "clean") { const [c, e] = S.calibPts; scale = CM.PLATE_DIAMETER_M / (2 * Math.hypot(e[0] - c[0], e[1] - c[1])); }
    const fs = S.fpsReal;
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
      ctx.fillStyle = "#43B35A";
      for (let j = 11; j < 33; j++) if (p[j]) { ctx.beginPath(); ctx.arc(p[j][0] * s, p[j][1] * s, lw * 1.6, 0, 7); ctx.fill(); }
    }
    if (o.contactSide) {
      const S2 = CM.SIDES[o.contactSide];
      if (p && p[S2.foot]) { ctx.strokeStyle = "#E8963F"; ctx.lineWidth = lw * 1.5; ctx.beginPath(); ctx.arc(p[S2.foot][0] * s, p[S2.foot][1] * s, lw * 6, 0, 7); ctx.stroke(); }
      ctx.fillStyle = "#E8963F"; ctx.font = `600 ${Math.round(lw * 9)}px ${getComputedStyle(document.body).fontFamily}`;
      ctx.fillText(o.contactSide === "left" ? "左脚触地" : "右脚触地", lw * 6, lw * 14);
    }
    if (o.bar) {
      ctx.strokeStyle = "#E8963F"; ctx.lineWidth = lw * 1.2; ctx.beginPath();
      let started = false;
      for (let k = 0; k <= o.i && k < o.bar.length; k++) {
        const q = o.bar[k]; if (!q || !Number.isFinite(q[0])) continue;
        if (!started) { ctx.moveTo(q[0] * s, q[1] * s); started = true; } else ctx.lineTo(q[0] * s, q[1] * s);
      }
      ctx.stroke();
      const q = o.bar[Math.min(o.i, o.bar.length - 1)];
      if (q && Number.isFinite(q[0])) { ctx.fillStyle = "#E8963F"; ctx.beginPath(); ctx.arc(q[0] * s, q[1] * s, lw * 2.5, 0, 7); ctx.fill(); }
    }
  }

  // ---------------- 结果页 ----------------
  const pv = $("playVideo"), ov = $("playOverlay"), octx = ov.getContext("2d");
  let playing = false, contactByFrame = null;

  function showResult(live) {
    const R = S.result;
    $("resTitle").textContent = `${S.athleteName} · ${ACTION_NAME[S.action]}`;
    $("resMeta").textContent = `${fmtDate(S.date || new Date().toISOString())} · 按 ${S.fpsReal} fps 计算`;
    $("resNotes").innerHTML = (R.notes || []).map(n => `<div class="note">${esc(n)}</div>`).join("");
    const hitMetrics = new Set(S.hits.map(h => h.condition.metric));
    $("metrics").innerHTML = Object.entries(R.summary).map(([k, v]) => {
      const [name, unit] = CM.LABELS[k] || [k, ""];
      return `<div class="${hitMetrics.has(k) ? "hit" : ""}"><dt>${name}</dt><dd>${esc(CM.fmt(v, unit))}<small>${unit}</small></dd></div>`;
    }).join("") || `<div><dt>没有得到指标</dt><dd>–</dd></div>`;
    $("stepsBox").innerHTML = S.action === "sprint" && R.steps && R.steps.length ? `<h3>逐步数据</h3><div class="tablewrap"><table class="steps num">
      <tr><th>步</th><th>触地 s</th><th>腾空 s</th><th>步长 m</th><th>着地距离 m</th></tr>
      ${R.steps.map((s, i) => `<tr><td>${i + 1} ${s.side === "left" ? "左" : "右"}</td><td>${s.contact_time_s.toFixed(3)}</td><td>${s.flight_time_s != null ? s.flight_time_s.toFixed(3) : "–"}</td>
      <td>${s.step_length_m != null ? s.step_length_m.toFixed(2) : "–"}</td><td>${s.touchdown_distance_m != null ? s.touchdown_distance_m.toFixed(2) : "–"}</td></tr>`).join("")}
      </table></div>` : "";
    renderCards();
    $("coachNote").value = S.coachNote || "";
    $("deleteBtn").hidden = !S.savedId;
    $("saveBtn").textContent = S.savedId ? "更新" : "保存";

    $("playerWrap").hidden = !live; $("noVideo").hidden = live;
    contactByFrame = null;
    if (S.action === "sprint" && R.steps) {
      contactByFrame = new Map();
      R.steps.forEach(s => { for (let f = s.touchdown_frame; f <= s.toeoff_frame; f++) contactByFrame.set(f, s.side); });
    }
    renderStrip();
    show("result");
    if (live) setupPlayer();
  }

  function renderCards() {
    $("cards").innerHTML = S.hits.length ? S.hits.map(h => {
      const v = S.verdicts[h.id] || "";
      return `<article class="card" data-id="${h.id}">
        <h4><span class="id">${h.id}</span>${esc(h.title)}</h4>
        ${h.safety_flag ? `<p class="safety">涉及伤病风险，须由教练或队医判断后再调整训练。</p>` : ""}
        <p class="sym">${esc(h.symptom_text)}</p>
        <div class="sub">可能原因（需要测试确认）：</div>
        <ol>${h.hypotheses.map(y => `<li><b>${esc(y.text)}</b><div class="sub">验证：${esc(y.test)}</div><div class="sub">若成立：${esc(h.prescriptions[y.id] || "–")}</div></li>`).join("")}</ol>
        <details><summary>依据 · ${esc(h.evidence_level)}</summary>
          ${h.evidence.map(e => `<div class="ev">【${esc(e.type)}】${esc(e.citation)}${e.doi ? `<br><a href="https://doi.org/${esc(e.doi)}" target="_blank" rel="noopener">doi.org/${esc(e.doi)}</a>` : ""}<div class="sub">${esc(e.supports)}</div></div>`).join("")}
        </details>
        <div class="verdict" role="group" aria-label="教练判断">
          ${[["agree", "认同"], ["test", "先做测试"], ["disagree", "不认同"]].map(([k, t]) => `<button data-v="${k}" aria-pressed="${v === k}">${t}</button>`).join("")}
        </div>
      </article>`;
    }).join("") : `<div class="note info">各项指标都没有触发问题规则。可以逐帧回看视频做判断，教练的观察可以写在下面的备注里。</div>`;
    $("cards").querySelectorAll(".verdict button").forEach(b => b.onclick = () => {
      const id = b.closest(".card").dataset.id;
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
        `<text x="${xx(s.touchdown_frame) + 4}" y="${y + laneH / 2 + 2}" font-size="17" fill="var(--bg)" class="num">${(s.contact_time_s * 1000).toFixed(0)}</text>`).join("");
      box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" id="stripSvg" role="img" aria-label="左右脚触地时间轴">
        <rect x="0" y="0" width="${W}" height="${laneH * 2}" fill="var(--surface)" rx="8"/>
        <line x1="0" x2="${W}" y1="${laneH}" y2="${laneH}" stroke="var(--rule)"/>
        <text x="6" y="${laneH / 2 + 6}" font-size="15" fill="var(--muted)">左</text>
        <text x="6" y="${laneH * 1.5 + 6}" font-size="15" fill="var(--muted)">右</text>
        <g transform="translate(0,5)">${lane("left", 0)}${lane("right", laneH)}</g>
        <line id="playhead" x1="0" x2="0" y1="0" y2="${laneH * 2}" stroke="var(--flag)" stroke-width="3"/>
        <text x="0" y="${H - 6}" font-size="15" fill="var(--muted)">0</text>
        <text x="${W}" y="${H - 6}" font-size="15" fill="var(--muted)" text-anchor="end" class="num">${(N / S.fpsReal).toFixed(2)} s</text>
      </svg><div class="cap"><span>触地时间轴（方块内数字为毫秒）</span><span>点按可跳转</span></div>`;
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
      const marks = Object.entries(ev).map(([key, i]) => `<circle cx="${gx(i)}" cy="${gy(vy[i])}" r="6" fill="var(--flag)"/><text x="${gx(i) + 8}" y="${gy(vy[i]) - 8}" font-size="15" fill="var(--muted)">${evNames[key]}</text>`).join("");
      box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" id="stripSvg" role="img" aria-label="杠铃轨迹与速度">
        <rect x="0" y="0" width="${pw}" height="${H}" rx="8" fill="var(--surface)"/>
        <line x1="${cx0}" x2="${cx0}" y1="10" y2="${H - 10}" stroke="var(--rule)" stroke-dasharray="4 6"/>
        <path d="${path}" fill="none" stroke="var(--brand)" stroke-width="4" stroke-linejoin="round"/>
        <text x="12" y="${H - 10}" font-size="15" fill="var(--muted)">← 靠近身体　远离身体 →</text>
        <line x1="${pw + 40}" x2="${W - 10}" y1="${gy(0)}" y2="${gy(0)}" stroke="var(--rule)"/>
        <path d="${vpath}" fill="none" stroke="var(--ink)" stroke-width="3"/>${marks}
        <text x="${pw + 40}" y="${H - 8}" font-size="15" fill="var(--muted)">杠铃竖直速度（峰值 ${vmax.toFixed(2)} m/s）</text>
        <line id="playhead" x1="${gx(0)}" x2="${gx(0)}" y1="10" y2="${H - 30}" stroke="var(--flag)" stroke-width="2"/>
        <circle id="pathDot" cx="${cx0}" cy="${cy0}" r="7" fill="var(--flag)"/>
      </svg><div class="cap"><span>左：杠铃轨迹　右：速度曲线</span><span>点按曲线可跳转</span></div>`;
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
    drawOverlay(octx, S.pose[i], { scale: ov.width / S.W, bar: S.bar, i, contactSide: contactByFrame && contactByFrame.get(i) });
    $("playScrub").value = i;
    $("frameInfo").textContent = `第 ${i + 1} / ${S.N} 帧 · ${(i / S.fpsReal * 1000).toFixed(0)} ms`;
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
  function stopPlayback() { playing = false; pv.pause(); $("playBtn").textContent = "播放"; }
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
    playing = true; $("playBtn").textContent = "暂停";
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
    const R = S.result, L = [`知练 CoachMind · ${S.athleteName} · ${ACTION_NAME[S.action]}`, fmtDate(S.date || new Date().toISOString()), ""];
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

  // ---------------- 启动 ----------------
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
  renderHome();
})();
