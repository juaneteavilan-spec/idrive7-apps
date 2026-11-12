'use strict';
/**
 * Synthetic track session for demo mode: a 90 s lap of full-throttle straights, heavy braking and
 * corners. Over the first laps the tyres, oil, coolant, gearbox and charge air warm up.
 * Units as the app keeps them: deg C, bar (gauge, above outside air), lambda, degrees.
 * Tyre pressures follow the tyre air temperature from a cold fill, so "+ from cold" behaves as on a car.
 */
const LAP = 90;
// a lap as [seconds, kind]: S = straight (full throttle), B = braking, C = corner (part throttle)
const SECTIONS = [[14, 'S'], [3, 'B'], [8, 'C'], [10, 'S'], [2.5, 'B'], [7, 'C'], [6, 'S'], [6, 'C'], [4, 'C'], [16, 'S'], [3.5, 'B'], [10, 'C']];

class Demo {
    constructor() { this.t0 = Date.now(); }
    restart() { this.t0 = Date.now(); }

    section(tl) {
        let a = 0;
        for (const [d, k] of SECTIONS) { if (tl < a + d) return { k, f: (tl - a) / d }; a += d; }
        return { k: 'S', f: 0 };
    }

    sample() {
        const t = (Date.now() - this.t0) / 1000, s = this.section(t % LAP);
        const warm = Math.min(1, t / 270), tw = Math.min(1, t / 200), soak = Math.min(1, t / 400);
        // load: 1 = full throttle, 0 = off throttle
        const load = s.k === 'S' ? Math.min(1, 0.4 + s.f * 3) : s.k === 'B' ? 0 : 0.35 + 0.25 * Math.sin(s.f * Math.PI);
        const rpm = s.k === 'S' ? 4200 + 2600 * ((s.f * 4) % 1) : s.k === 'B' ? 5500 - 2500 * s.f : 3800 + 900 * Math.sin(s.f * Math.PI);
        const boostTarget = 0.3 + 1.4 * load;
        const hpfpTarget = 60 + 290 * load;
        const lambdaTarget = load > 0.8 ? 0.80 : load > 0.5 ? 0.90 : 1.0;
        // tyres: the fronts work harder on this lap
        const tyreT = (base) => 24 + (base - 24) * tw + 3 * Math.sin(t / 7);
        const tFL = tyreT(66), tFR = tyreT(63), tRL = tyreT(58), tRR = tyreT(57);
        // pressure follows absolute temperature from a cold fill at 24 deg C (gauge -> absolute -> gauge)
        const hot = (cold, tc) => (cold + 1.013) * (tc + 273.15) / (24 + 273.15) - 1.013;
        return {
            rpm,
            oil: 88 + 30 * warm + 4 * load, coolant: 88 + 16 * warm, gearbox: 60 + 45 * warm,
            oilP: 1.6 + 2.9 * Math.min(1, rpm / 6000) - 0.3 * soak,
            iat: 30 + 6 * soak + 2 * load, chargeAir: 34 + 20 * soak + 10 * load, fuelT: 30 + 9 * soak,
            ethanol: 42, ethanolCan: 42, ethanolSrc: 'mhd',
            boost: Math.max(0, boostTarget - 0.08 + 0.04 * Math.sin(t * 3)), boostTarget,
            hpfp: hpfpTarget * (load > 0.95 ? 0.97 : 1.0) + 3 * Math.sin(t * 2), hpfpTarget,
            lambda: lambdaTarget + 0.01 * Math.sin(t * 2), lambdaTarget,
            knock: load > 0.9 && rpm > 6000 ? -1.5 * soak : 0,
            tFL, tFR, tRL, tRR,
            // cold fill 29 psi, as on the owner's car (35 psi hot)
            pFL: hot(29 / 14.5038, tFL), pFR: hot(29 / 14.5038, tFR), pRL: hot(29 / 14.5038, tRL), pRR: hot(29 / 14.5038, tRR),
            ptFL: 2.5, ptFR: 2.5, ptRL: 2.6, ptRR: 2.6,
        };
    }
}
module.exports = Demo;
