// 帧率默认值：普通 30 帧视频默认按 30 算，触地/腾空时间正确；旧逻辑（默认 240）会缩成 1/8
const CM = require("./engine_src.js");
const { TH } = require("./data_node.js");
let ok = true; const chk = (c, m) => { console.log((c ? "✓ " : "✗ ") + m); if (!c) ok = false; };
chk(CM.defaultFps(29.97, false) === 30, "29.97 帧视频默认填 30");
chk(CM.defaultFps(240, false) === 240, "240 帧原片默认填 240");
chk(CM.defaultFps(NaN, true) === 30 && CM.defaultFps(0, false) === 30, "测不出帧率时默认 30（界面提示慢动作原片改成 240）");
chk(require("fs").readFileSync("../app.js", "utf8").includes("没测出帧率，慢动作原片请改成 240"), "界面有中文提示");
chk(CM.needsSlowmoConfirm(30, 240) && !CM.needsSlowmoConfirm(30, 30) && !CM.needsSlowmoConfirm(240, 240), "30 帧文件改成 240 需要确认，其他情况不打扰");
const d = JSON.parse(require("fs").readFileSync("./_synthetic_sprint.json", "utf8").replace(/NaN/g, "null"));
const P0 = d.good.pose.map(f => f.map(p => p.map(v => v === null ? NaN : v)));
const P30 = P0.filter((_, i) => i % 8 === 0);                       // 普通速度 30 帧拍摄
const good = CM.analyzeSprint(P30, CM.defaultFps(30, false), TH, null).summary;
const bad = CM.analyzeSprint(P30, 240, TH, null).summary;
chk(Math.abs(good.contact_time_s - 0.11) <= 1.5 / 30 && Math.abs(good.flight_time_s - 0.12) <= 1.5 / 30,
  `按默认 30 fps：触地 ${good.contact_time_s} s、腾空 ${good.flight_time_s} s（真值 0.110 / 0.120，误差 ≤ 1.5 帧）`);
chk(!(Math.abs(bad.contact_time_s - 0.11) < 0.03), `对照：误按 240 fps 时触地 ${bad.contact_time_s ?? "识别失败"}，说明默认值必须用真实帧率`);
console.log(ok ? "\n全部通过 ✓" : "\n有失败 ✗"); process.exit(ok ? 0 : 1);
