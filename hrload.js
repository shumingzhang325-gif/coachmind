/* 知练 CoachMind 心率与训练负荷（为接入手表做准备）
   - 心率区间按最大心率百分比（50–60–70–80–90–100%）。最大心率优先用实测值；没有时按年龄估算（208 − 0.7 × 年龄），
     个体误差常在 ±10 次/分以上，界面会标明“估算”。
   - 心率负荷用区间加权法（Edwards TRIMP）：每个区间的分钟数 × 区间序号（1–5）求和。
   - 主观负荷（sRPE）= RPE × 分钟，适用于所有训练，仍是负荷监控的主线；心率负荷作为客观补充。
   - 局限：心率反映心肺负担。短跑、力量、跳跃这类单次几秒的训练心率跟不上，心率负荷会严重低估，这类课以 sRPE 为准。
   - 读取手表导出文件：TCX、GPX（含心率扩展）、CSV（时间, 心率）。iPhone 上的网页 App 读不到“健康”App 和手表里的数据，
     只能通过导出文件或“快捷指令”转出。
   本库未核对 Edwards TRIMP、年龄公式的原始文献，按教材共识处理。 */
(function (root) {
  "use strict";
  const isF = Number.isFinite;
  const ZONES = [[0.5, 0.6], [0.6, 0.7], [0.7, 0.8], [0.8, 0.9], [0.9, 1.01]];
  const ZONE_NAMES = ["1 区 恢复", "2 区 有氧基础", "3 区 有氧强化", "4 区 乳酸阈", "5 区 最大强度"];
  // 心率负荷不可信的课型：单次用力很短，心率滞后
  const HR_INVALID = /力量|最大力量|爆发|快速伸缩|跳|最高速度|加速|冲刺|举重|高翻|抓举|技术/;

  function hrMaxOf(a, today = new Date()) {
    if (isF(a.hrMax) && a.hrMax > 120) return { value: a.hrMax, estimated: false };
    if (isF(a.birthYear)) { const age = today.getFullYear() - a.birthYear; return { value: Math.round(208 - 0.7 * age), estimated: true, note: "按年龄估算，个体误差常在 ±10 次/分以上，建议实测" }; }
    return null;
  }
  // samples：[[秒, 心率], ...]，按时间排序；相邻两点之间的时间算给前一个心率（超过 30 秒的间隔视为暂停，不计）
  function zoneMinutes(samples, hrMax) {
    const mins = [0, 0, 0, 0, 0]; let below = 0, covered = 0;
    for (let i = 0; i + 1 < samples.length; i++) {
      const dt = samples[i + 1][0] - samples[i][0], hr = samples[i][1];
      if (!(dt > 0) || dt > 30 || !isF(hr) || hr < 30 || hr > 240) continue;
      covered += dt;
      const f = hr / hrMax, z = ZONES.findIndex(([lo, hi]) => f >= lo && f < hi);
      if (z >= 0) mins[z] += dt / 60; else if (f < 0.5) below += dt / 60; else mins[4] += dt / 60;
    }
    return { mins, below, coveredMin: covered / 60 };
  }
  function edwardsTrimp(mins) { return mins.reduce((s, m, i) => s + m * (i + 1), 0); }

  // 一次训练的负荷汇总：sRPE（主线）+ 心率负荷（补充）+ 可信度说明
  function sessionLoad(sess, a, today) {
    const out = { notes: [] };
    if (isF(sess.rpe) && isF(sess.minutes)) out.srpe = Math.round(sess.rpe * sess.minutes);
    const HM = hrMaxOf(a || {}, today);
    if (sess.samples && sess.samples.length > 10 && HM) {
      const Z = zoneMinutes(sess.samples, HM.value);
      out.zoneMin = Z.mins.map(m => Math.round(m * 10) / 10);
      out.trimp = Math.round(edwardsTrimp(Z.mins));
      const hrs = sess.samples.map(s => s[1]).filter(v => isF(v) && v > 30);
      out.hrAvg = Math.round(hrs.reduce((s, v) => s + v, 0) / hrs.length); out.hrPeak = Math.max(...hrs);
      if (HM.estimated) out.notes.push("最大心率是" + HM.note);
      if (out.hrPeak > HM.value * 1.02) out.notes.push(`本次最高心率 ${out.hrPeak} 超过设定的最大心率 ${HM.value}：请在档案里更新实测最大心率`);
    } else if (isF(sess.hrAvg) && isF(sess.minutes) && HM) {
      // 只有平均心率：按平均心率所在区间粗略估算（间歇训练会低估）
      const f = sess.hrAvg / HM.value, z = ZONES.findIndex(([lo, hi]) => f >= lo && f < hi);
      if (z >= 0) { out.trimp = Math.round(sess.minutes * (z + 1)); out.notes.push("只有平均心率：心率负荷是粗略估算，间歇训练会被低估"); }
    }
    if (isF(out.trimp) && sess.type && HR_INVALID.test(sess.type)) out.notes.push(`“${sess.type}”这类短时间用力的训练，心率跟不上，心率负荷会明显低估，请以 RPE × 时长为准`);
    // 主观和客观对不上：提示疲劳、生病或记录有误
    if (isF(out.srpe) && isF(out.trimp) && out.trimp > 0 && !(sess.type && HR_INVALID.test(sess.type))) {
      const r = out.srpe / out.trimp;
      if (r > 6) out.notes.push("主观感觉很累，但心率负荷不高：可能是疲劳积累或身体不适，留意明天的状态");
      else if (r < 1.2) out.notes.push("心率负荷高，但主观感觉轻松：可能是天热、脱水、刚生病，或 RPE 记录偏低");
    }
    return out;
  }

  // ---------------- 读取手表导出文件 ----------------
  const tsec = s => Date.parse(s) / 1000;
  function fromPairs(pairs) {
    const ok = pairs.filter(p => isF(p[0]) && isF(p[1])).sort((x, y) => x[0] - y[0]);
    if (ok.length < 2) return null;
    const t0 = ok[0][0];
    return { start: new Date(t0 * 1000).toISOString(), minutes: Math.round((ok[ok.length - 1][0] - t0) / 60), samples: ok.map(p => [p[0] - t0, p[1]]) };
  }
  function parseTCX(text) {
    const pairs = [];
    for (const m of text.matchAll(/<Trackpoint>([\s\S]*?)<\/Trackpoint>/g)) {
      const t = /<Time>([^<]+)<\/Time>/.exec(m[1]), h = /<HeartRateBpm[^>]*>\s*<Value>(\d+)<\/Value>/.exec(m[1]);
      if (t && h) pairs.push([tsec(t[1]), Number(h[1])]);
    }
    return fromPairs(pairs);
  }
  function parseGPX(text) {
    const pairs = [];
    for (const m of text.matchAll(/<trkpt\b[\s\S]*?<\/trkpt>/g)) {
      const t = /<time>([^<]+)<\/time>/.exec(m[0]), h = /<(?:\w+:)?hr>(\d+)<\/(?:\w+:)?hr>/.exec(m[0]);
      if (t && h) pairs.push([tsec(t[1]), Number(h[1])]);
    }
    return fromPairs(pairs);
  }
  // CSV：第一列时间（ISO 时间或秒数），第二列心率；有表头也可以
  function parseCSV(text) {
    const pairs = [];
    for (const line of text.split(/\r?\n/)) {
      const c = line.split(/[,;\t]/).map(x => x.trim().replace(/^"|"$/g, ""));
      if (c.length < 2) continue;
      const t = /^\d+(\.\d+)?$/.test(c[0]) ? Number(c[0]) : tsec(c[0]), h = Number(c[1]);
      if (isF(t) && isF(h)) pairs.push([t, h]);
    }
    return fromPairs(pairs);
  }
  function parseWorkout(name, text) {
    const n = (name || "").toLowerCase();
    if (n.endsWith(".tcx") || /<TrainingCenterDatabase/.test(text)) return parseTCX(text);
    if (n.endsWith(".gpx") || /<gpx\b/.test(text)) return parseGPX(text);
    return parseCSV(text);
  }

  const API = { ZONES, ZONE_NAMES, HR_INVALID, hrMaxOf, zoneMinutes, edwardsTrimp, sessionLoad, parseTCX, parseGPX, parseCSV, parseWorkout };
  if (typeof module !== "undefined" && module.exports) module.exports = API; else root.HRLOAD = API;
})(typeof self !== "undefined" ? self : this);
