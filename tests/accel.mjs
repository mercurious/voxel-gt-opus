// Straight-line performance check: 0-100, 0-200 km/h and top speed per car.
import { CARS } from '../src/cars.js';
import { Vehicle, SURFACE } from '../src/physics.js';
const DT = 1 / 120;
for (const spec of CARS) {
  const v = new Vehicle(spec);
  const env = { surfF: SURFACE.asphalt, surfR: SURFACE.asphalt, slope: 0, auto: true, tcs: true, asm: true };
  let t = 0, t100 = null, t200 = null, q = null;
  let x0 = v.z;
  const gears = [];
  while (t < 90) {
    v.step(DT, { throttle: 1, brake: 0, steer: 0 }, env);
    t += DT;
    const k = v.speed * 3.6;
    if (!t100 && k >= 100) t100 = t;
    if (!t200 && k >= 200) t200 = t;
    if (!q && v.z - x0 >= 402) q = [t, k];
    if (gears[gears.length - 1] !== v.gear) gears.push(v.gear);
  }
  // braking 100-0
  const vb = new Vehicle(spec); vb.vx = 100 / 3.6; let d = 0;
  while (vb.vx > 0.3) { vb.step(DT, { throttle: 0, brake: 1, steer: 0 }, env); d += vb.vx * DT; }
  console.log(`${spec.id.padEnd(6)} 0-100 ${t100?.toFixed(1)}s  0-200 ${t200 ? t200.toFixed(1) + 's' : '--'}  1/4mi ${q[0].toFixed(1)}s@${q[1].toFixed(0)}  top ${(v.speed * 3.6).toFixed(0)} km/h  rpm ${v.rpm.toFixed(0)} gear ${v.gear}  100-0 ${d.toFixed(1)}m`);
}
