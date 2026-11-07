// Steady-state cornering: ramp speed on a fixed-radius circle and record the
// highest lateral acceleration the car holds within 1.5 m of the line.
import { CARS } from '../src/cars.js';
import { Vehicle, SURFACE, G, TIRE_MU } from '../src/physics.js';
const DT = 1 / 120;
const asm = process.argv[2] !== 'noasm';
for (const R of [40, 150]) {
  for (const spec of CARS) {
    const v = new Vehicle(spec);
    // circle centred at (R,0) driving counter-clockwise (left turn), start at origin heading +z
    v.reset(0, 0, 0);
    v.vx = 8;
    const env = { surfF: SURFACE.asphalt, surfR: SURFACE.asphalt, slope: 0, auto: true, tcs: true, asm };
    let vt = 8, best = 0, t = 0, fail = 0;
    while (t < 240) {
      const dx = v.x - R, dz = v.z;
      const rad = Math.hypot(dx, dz);
      // target point ahead on circle
      const ang = Math.atan2(dz, dx) - 12 / R; // moving clockwise in atan2 terms? choose direction by heading
      const ang2 = Math.atan2(dz, dx) + 12 / R;
      const p1 = [R + R * Math.cos(ang), R * Math.sin(ang)], p2 = [R + R * Math.cos(ang2), R * Math.sin(ang2)];
      const fx = Math.sin(v.h), fz = Math.cos(v.h);
      const pick = ((p1[0] - v.x) * fx + (p1[1] - v.z) * fz) > ((p2[0] - v.x) * fx + (p2[1] - v.z) * fz) ? p1 : p2;
      const ddx = pick[0] - v.x, ddz = pick[1] - v.z;
      const lf = ddx * fx + ddz * fz, ll = ddx * fz - ddz * fx;
      const alpha = Math.atan2(ll, lf);
      const st = Math.atan(2 * v.L * Math.sin(alpha) / Math.hypot(ddx, ddz));
      const err = vt - v.vx;
      const inp = { steer: Math.max(-1, Math.min(1, st / v.maxSteer())), throttle: err > 0 ? Math.min(1, 0.3 + err) : 0, brake: err < -1 ? 0.3 : 0 };
      v.step(DT, inp, env);
      t += DT;
      vt += DT * 0.15;
      if (Math.abs(rad - R) < 1.5 && t > 5) best = Math.max(best, v.vx * v.vx / R);
      if (Math.abs(rad - R) > 4 && t > 5) { fail++; if (fail > 120) break; } else fail = 0;
    }
    console.log(`R=${R} ${spec.id.padEnd(6)} asm=${asm} max ay=${(best / G).toFixed(2)} g (theory ${(spec.grip * TIRE_MU).toFixed(2)}) at ${(Math.sqrt(best * R) * 3.6).toFixed(0)} km/h`);
  }
}
