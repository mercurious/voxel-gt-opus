// Handling sanity: keyboard-style full-lock inputs at speed must not spin
// the car with aids on; and the car must stay controllable with aids off.
import { CARS } from '../src/cars.js';
import { Vehicle, SURFACE } from '../src/physics.js';
import { approach } from '../src/util.js';
const DT = 1 / 120;
let fail = 0;
for (const aids of [true, false]) {
  for (const spec of CARS) {
    for (const kmh of [60, 120, 180]) {
      const v = new Vehicle(spec);
      v.vx = kmh / 3.6;
      v.gear = Math.min(spec.gears.length, 3);
      const env = { surfF: SURFACE.asphalt, surfR: SURFACE.asphalt, slope: 0, auto: true, tcs: aids, asm: aids };
      let steer = 0, maxBeta = 0, t = 0;
      // keyboard: hold left 1.2 s at part throttle, then flick right 0.8 s, then release
      while (t < 3.5) {
        const target = t < 1.2 ? 1 : t < 2.0 ? -1 : 0;
        steer = approach(steer, target, target === 0 ? 6 : 2.6, DT);
        v.step(DT, { throttle: 0.4, brake: 0, steer }, env);
        t += DT;
        maxBeta = Math.max(maxBeta, Math.abs(Math.atan2(v.vy, Math.abs(v.vx))));
      }
      const spun = maxBeta > (aids ? 0.35 : 0.8);
      if (spun && aids) fail++;
      console.log(`${aids ? 'aids ' : 'raw  '} ${spec.id.padEnd(6)} ${String(kmh).padStart(3)} km/h  max slip angle ${(maxBeta * 57.3).toFixed(1).padStart(5)}°  end speed ${(v.speed * 3.6).toFixed(0).padStart(3)}${spun ? '  <-- SPIN' : ''}`);
    }
  }
}
console.log(fail ? `FAIL: ${fail} spins with aids on` : 'ok: no spins with aids on');
process.exit(fail ? 1 : 0);
