// 困难场景：镜头跟拍（人在画面里几乎不动）、地面线斜向漂移、30fps 内容、加噪声
const CM = require("./engine_src.js");
const { TH } = require("./data_node.js");
const d = JSON.parse(require("fs").readFileSync("./_synthetic_sprint.json", "utf8").replace(/NaN/g, "null"));
const P0 = d.good.pose.map(f => f.map(p => p.map(v => v === null ? NaN : v)));
const fs0 = 240, truthCT = 0.11, truthFT = 0.12;
function scene(pan, driftY, fsOut, noise) {
  const step = fs0 / fsOut, out = [];
  let seed = 5; const rnd = () => ((seed = seed * 16807 % 2147483647) / 2147483647 - 0.5);
  for (let i = 0; i * step < P0.length; i++) {
    const k = Math.floor(i * step), t = k / fs0, f = P0[k];
    const camX = pan ? 1800 * t : 0;                       // 镜头以跑速跟拍
    const dy = driftY * t;                                 // 地面线在画面中下移（人斜向朝镜头跑）
    out.push(f.map(p => [p[0] - camX + rnd() * noise, p[1] + dy + rnd() * noise, p[2]]));
  }
  return out;
}
const cases = [["固定机位 240fps", false, 0, 240, 0], ["跟拍 240fps", true, 0, 240, 1.5], ["跟拍+斜向 240fps", true, 60, 240, 2], ["跟拍+斜向 60fps", true, 60, 60, 2], ["跟拍+斜向 30fps", true, 60, 30, 3]];
for (const [name, pan, drift, fs, noise] of cases) {
  const r = CM.analyzeSprint(scene(pan, drift, fs, noise), fs, TH, null);
  const s = r.summary;
  console.log(name.padEnd(16), "方法:", (r.contactMethod === "vertical" ? "最低点静止" : "水平静止").padEnd(6), "触地", s.n_contacts, "次", "触地", s.contact_time_s ?? "—", "s 腾空", s.flight_time_s ?? "—", "s 步频", s.step_frequency_hz ?? "—", "（真值 0.110 / 0.120 / 4.35）");
}
