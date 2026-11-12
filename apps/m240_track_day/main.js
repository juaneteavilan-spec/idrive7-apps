'use strict';
/**
 * Track Day - everything that matters on track, on one screen, as plain numbers.
 *
 *   ┌─ Tyres ──────────┬─ Oil temp ─┬─ Oil press ┬─ Coolant ──┬─ Gearbox ──┐
 *   │ psi, + from cold │            │            │            │            │
 *   │ deg C, peak      ├─ Intake air┼─ Charge air┼─ Fuel temp ┼─ Ethanol ──┤
 *   │ (four corners)   ├─ Boost ────┼─ HPFP ─────┼─ AFR ──────┼─ Knock ────┤
 *   └──────────────────┴────────────┴────────────┴────────────┴────────────┘
 *
 * Each tile: one big number, and under it the session's peak (or minimum for oil pressure, or the
 * target for boost / HPFP / mixture). Units are settings (deg C / deg F, psi / bar / kPa, AFR / lambda);
 * inside the app values stay in deg C, bar and lambda and are converted only when drawn.
 *
 * Sources:
 *   - the car's own signals: tyres (TPMS), oil and coolant temperature, engine speed
 *   - the engine unit (DME, B58) and the gearbox unit (ZF 8HP), asked with UDS 0x22 over a READ-ONLY
 *     diagnostic link (kit/readonly-diag.js: anything but reading is refused before it reaches the car),
 *     one request at a time, only while this screen is shown. Identifiers: app.json config.dme.
 *   - ethanol: MHD's flex fuel values (Active = what the map uses, CAN = what the sensor reads), read the way
 *     Perea Performance's Flex Fuel app does (mhd_poller.js / mhd_protocol.js, MIT, see NOTICE). This needs one
 *     request the read-only link refuses: 2C, which defines a dynamic identifier over two RAM bytes in the DME's
 *     volatile table (nothing persists, the map is not touched). So the MHD reads go over a full diagnostic link
 *     (kit/diag.js, as M Vitals and Perea use), everything else stays on the read-only one. Without MHD or with
 *     a ROM that has no address profile, the ethanol falls back to the DME's own value (22 550D).
 *   Both links share one queue: one request on the car's diagnostic transport at a time.
 *
 * Tyre temperatures from the TPMS are the AIR inside the tyre, not the tread.
 * A session (peaks, cold tyre pressures, time) lasts until "New session" or 12 h unused, and survives
 * restarts. Signal handling follows M Vitals (apps/car_vitals), which was checked on real cars.
 */
const fs = require('fs');
const path = require('path');
const mgu = require('./kit/mgu');
const { withAlpha } = require('./kit/canvas');
const G = require('./kit/gauges');
const { ReadOnlyDiag } = require('./kit/readonly-diag');
const { Diag } = require('./kit/diag');
const { DidReader } = require('./kit/dids');
const { Poller } = require('./mhd_poller');
const MHD = require('./mhd_protocol');
const Demo = require('./demo');
const Icons = require('./icons');

const W = 1600, H = 520;
const TYRES = ['FL', 'FR', 'RL', 'RR'];
const SESSION_MAX_AGE = 12 * 3600 * 1000;
const PSI = 14.5038;                       // psi per bar
/* Plausible ranges (deg C / bar): anything outside is a "no data" marker and is dropped. */
const TYRE_T = [-40, 150], TYRE_P = [0.5, 6], TYRE_PT = [1, 6];
const RANGE = {
    rpm: [0, 12000], coolant: [-40, 160], oil: [-40, 170], gearboxSig: [-40, 160],
    tFL: TYRE_T, tFR: TYRE_T, tRL: TYRE_T, tRR: TYRE_T, pFL: TYRE_P, pFR: TYRE_P, pRL: TYRE_P, pRR: TYRE_P,
    ptFL: TYRE_PT, ptFR: TYRE_PT, ptRL: TYRE_PT, ptRR: TYRE_PT,
};
/*
 * Engine / gearbox unit values: [key, read every n-th round]. Fast ones every round (~2-3 a second),
 * slow-moving ones less often so the fast ones stay fast.
 */
const UNIT_READS = [
    ['oilP', 1], ['boost', 1], ['boostTarget', 1], ['hpfp', 1], ['hpfpTarget', 1], ['lambda', 1], ['lambdaTarget', 1], ['knock', 1],
    ['chargeAir', 2], ['iat', 3], ['gearbox', 4], ['fuelT', 8], ['ethanol', 8],
];
/** A unit value older than this is shown as no data. */
const STALE_MS = 8000;

const newSessionData = () => ({ start: Date.now(), used: Date.now(), peak: {}, min: {}, cold: {} });

mgu.run({
    async start(ctx) {
        const { ui, settings, log } = ctx;
        const S = (ctx.spec.config && ctx.spec.config.scaling) || {};
        const sc = (k, raw) => {
            const c = S[k];
            if (!c || raw === undefined || raw === null || raw === c.invalid || (c.invalidFrom != null && raw >= c.invalidFrom)) return null;
            return raw * c.factor + (c.offset || 0);
        };
        /** The first raw values of doubtful fields go to the log, to check scalings against. */
        const rawLogged = {};
        const logRaw = (name, raw) => {
            const key = JSON.stringify(raw), l = rawLogged[name] || (rawLogged[name] = []);
            if (l.length >= 12 || l.indexOf(key) >= 0) return;
            l.push(key); log.info('raw ' + name + ': ' + key);
        };

        /* ---------- tyre units (as M Vitals) ---------- */
        // The TPMS sends 0.1 x raw in the car's own pressure unit, and the car's degrees + 40.
        const carUnits = { press: null, temp: null, psiSeen: false };
        const PRESS_UNITS = { 1: 'BAR', 2: 'KPA', 3: 'PSI' }, TEMP_UNITS = { 1: 'C', 2: 'F' };
        const PRESS_TO_BAR = { BAR: 1, KPA: 0.01, PSI: 1 / PSI };
        const unitName = (map, v) => (map[v] || (Object.values(map).indexOf(v) >= 0 ? v : null));
        /** A tyre pressure in bar; until the car's unit is known, the unit whose plausible range fits. */
        const tyreP = (raw) => {
            const v = sc('tyrePress', raw);
            if (v === null) return null;
            const k = PRESS_TO_BAR[carUnits.press];
            if (k) return v * k;
            if (v >= TYRE_P[0] && v <= TYRE_P[1]) return v;
            if (v >= 7 && v < 60) { carUnits.psiSeen = true; return v / PSI; }
            if (v >= 60 && v <= 600) return v / 100;
            return v;
        };
        /** A tyre temperature in deg C (the car sends deg F when it is set to Fahrenheit). */
        const tyreT = (raw) => {
            const v = sc('tyreTemp', raw), f = carUnits.temp ? carUnits.temp === 'F' : carUnits.psiSeen;
            return v !== null && f ? (v - 32) * 5 / 9 : v;
        };

        /* ---------- the car's own signals ---------- */
        const live = {}, liveT = {};
        let lastCar = 0;
        // the gearbox oil signal sits at one number on cars that don't fill it: trusted once it moves
        let gbFirst = null, gbMoved = false;
        const put = (k, v) => {
            if (v === null || v === undefined || !isFinite(v)) return;
            lastCar = Date.now();
            const r = RANGE[k];
            if (r && (v < r[0] || v > r[1])) return;
            if (k === 'gearboxSig') {
                if (gbFirst === null) gbFirst = v;
                else if (Math.abs(v - gbFirst) >= 1) gbMoved = true;
            }
            live[k] = v; liveT[k] = Date.now();
        };
        const watches = [
            ['de.bmw.infotainment.vehicle.CDS', {
                statusEngineSpeed2: (v) => put('rpm', sc('rpm', v.actualValueRPMEngineCrankshaft)),
                statusEngineTemperature: (v) => {
                    put('coolant', sc('engineTemp', v.temperatureEngineDrive));
                    put('oil', sc('engineTemp', v.temperatureEngineOilDrive));
                },
            }],
            ['de.bmw.infotainment.vehicle.Vehicle', {
                statusNewCurrentUnitsStatusExt: (v) => {
                    const press = unitName(PRESS_UNITS, v && v.unitOfMeasurementAirPressure), temp = unitName(TEMP_UNITS, v && v.unitOfMeasurementTemperature);
                    if (press === carUnits.press && temp === carUnits.temp) return;
                    carUnits.press = press; carUnits.temp = temp;
                    log.info('car units: pressure ' + (press || '?') + ', temperature ' + (temp || '?'));
                },
            }],
            ['de.bmw.infrastructure.analytics.BasicDataSet', { basicDataSet: (v) => put('gearboxSig', sc('gearboxTemp', v.valueTemperatureTransmissionOil)) }],
            ['de.bmw.infotainment.vehicle.TPMS', {
                statusTyreTemperature: (v) => {
                    logRaw('tyre temperature', [v.actualValueTemperatureTyreFLH, v.actualValueTemperatureTyreFRH, v.actualValueTemperatureTyreRLH, v.actualValueTemperatureTyreRRH]);
                    put('tFL', tyreT(v.actualValueTemperatureTyreFLH)); put('tFR', tyreT(v.actualValueTemperatureTyreFRH));
                    put('tRL', tyreT(v.actualValueTemperatureTyreRLH)); put('tRR', tyreT(v.actualValueTemperatureTyreRRH));
                },
                statusTyrePressure: (v) => {
                    logRaw('tyre pressure', [v.actualValuePressureTyreFLH, v.actualValuePressureTyreFRH, v.actualValuePressureTyreRLH, v.actualValuePressureTyreRRH]);
                    put('pFL', tyreP(v.actualValuePressureTyreFLH)); put('pFR', tyreP(v.actualValuePressureTyreFRH));
                    put('pRL', tyreP(v.actualValuePressureTyreRLH)); put('pRR', tyreP(v.actualValuePressureTyreRRH));
                },
                statusTargetTyrePressure: (v) => {
                    put('ptFL', tyreP(v.targetPressureTyreFLH)); put('ptFR', tyreP(v.targetPressureTyreFRH));
                    put('ptRL', tyreP(v.targetPressureTyreRLH)); put('ptRR', tyreP(v.targetPressureTyreRRH));
                },
            }],
        ];
        // tyre values are also re-read every 10 s: some cars never notify them (as M Vitals)
        const subs = [], startT = Date.now();
        Promise.all(watches.map(([iface, h]) => ctx.signals.watch(iface, '1', h, log, /\.TPMS$/.test(iface) ? { pollMs: 10000 } : undefined)
            .then((s) => { subs.push(s); return s; })))
            .then((all) => log.info('signals: ' + all.map((s) => s.iface.split('.').pop() + (s.error ? '(err)' : '')).join(' ')));

        /* ---------- engine + gearbox unit, read only ---------- */
        const dme = Object.assign({ ecu: 18 }, (ctx.spec.config && ctx.spec.config.dme) || {});
        const link = new ReadOnlyDiag(ctx.signals, log);
        link.init().catch((e) => log.warn('diagnostic link: ' + e));
        /** One request on the car's diagnostic transport at a time, from either link. */
        let queue = Promise.resolve();
        const serial = (fn) => { const p = queue.then(fn, fn); queue = p.catch(() => {}); return p; };
        const rd = new DidReader({ physical: (...a) => serial(() => link.physical(...a)) }, { ecu: dme.ecu });
        const unit = {}, unitT = {}, fail = {}, tryT = {};
        let baro = 1.013, baroT = 0, shownAt = 0, round = 0, pollTimer = null;
        /** Outside air pressure (bar), read again once a minute: absolute pressures minus it. */
        async function freshBaro() {
            if (Date.now() - baroT < 60000) return;
            baroT = Date.now();
            const b = await rd.value('baro', dme.baro);
            if (b !== null) baro = b;
        }
        /** One value from the unit, turned into what the screen shows (bar above outside air for pressures). */
        async function readUnit(k) {
            let v = await rd.value(k, dme[k]);
            const c = (dme[k] || [])[rd.pick[k] || 0], r = c && rd.raws[rd.key(c)];
            if (r) logRaw(k + ' ' + DidReader.label(c), r.bytes || r.why);
            if (v === null) return null;
            if (k === 'oilP' || k === 'boost' || k === 'boostTarget') { await freshBaro(); v -= baro; }
            return v;
        }
        /** Read the values due this round, one request at a time; only while the screen is on. */
        async function poll() {
            const onScreen = Date.now() - shownAt < 1500;
            if (onScreen && link.available) {
                round++;
                try {
                    for (const [k, every] of UNIT_READS) {
                        if (round % every !== 0 || !(dme[k] || []).length) continue;
                        // a value this car refuses is tried again after 30 s at the soonest
                        if ((fail[k] || 0) >= 3 && Date.now() - (tryT[k] || 0) < 30000) continue;
                        tryT[k] = Date.now();
                        const v = await readUnit(k);
                        if (v === null) { fail[k] = (fail[k] || 0) + 1; continue; }
                        fail[k] = 0; unit[k] = v; unitT[k] = Date.now(); lastCar = Date.now();
                    }
                } catch (e) { log.warn('unit poll: ' + e); }
            }
            pollTimer = setTimeout(poll, onScreen ? 100 : 1000);
        }
        pollTimer = setTimeout(poll, 1000);

        /* ---------- MHD flex fuel (Perea Performance's poller), over the full link, through the same queue ---------- */
        const full = new Diag(ctx.signals, log);
        full.quiet = true;
        full.init().catch((e) => log.warn('MHD diagnostic link: ' + e));
        const poller = new Poller({
            physical: (sid, data, ms, accept) => serial(() => full.physical(MHD.DME, sid, data, ms, accept)),
            available: () => !!full.available,
            hasLink: () => !!full.p,
            log, profiles: MHD.PROFILES,
            config: Object.assign({ fuelPollMs: 0 }, (ctx.spec.config && ctx.spec.config.mhd) || {}),
        });
        full.on('available', (on) => poller.linkChanged(on));
        // only while the screen is shown, as the other reads; the setting "DME's own value" sends nothing to MHD
        ui.onVisible((name, on) => { if (name === 'MAIN') poller.setVisible(on); });
        poller.setVisible(ui.isVisible('MAIN'));
        poller.start();
        /** Why MHD's ethanol is not there, in a few words for the tile. */
        const MHD_WHY = { 'no-link': 'no link', 'link-down': 'link down', probing: 'finding MHD', 'no-mhd': 'no MHD',
            identifying: 'reading ROM', 'unsupported-rom': 'ROM unmapped', defining: 'connecting', error: 'MHD error' };

        /* ---------- what the screen shows ---------- */
        const demo = new Demo();
        const carPresent = () => lastCar > 0 || subs.some((s) => s.available) || link.available || !!full.available;
        const usingDemo = () => settings.get('demo') === 'on' || (settings.get('demo') === 'auto' && !carPresent() && Date.now() - startT > 5000);
        setInterval(() => poller.setPaused(usingDemo() || settings.get('ethanolSource') === 'dme'), 1000);
        const fresh = (k) => (unitT[k] && Date.now() - unitT[k] < STALE_MS ? unit[k] : null);
        /*
         * Ethanol: MHD's Active (what the map uses) with the sensor's CAN beside it; Auto falls back to the DME's own
         * value (550D) while MHD has none. ethanolSrc says which one the tile shows; ethanolWhy why MHD is not used.
         */
        function ethanol(d) {
            const v = poller.view(), src = settings.get('ethanolSource');
            const mhdOk = v.state === 'reading' && G.isNum(v.active) && !v.stale;
            const why = MHD_WHY[v.state] || (v.stale ? 'MHD stale' : '');
            if (src !== 'dme' && mhdOk) { d.ethanol = v.active; d.ethanolCan = v.can; d.ethanolSrc = 'mhd'; return; }
            d.ethanolCan = null; d.ethanolWhy = src === 'dme' ? '' : why;
            if (src === 'mhd') { d.ethanol = null; d.ethanolSrc = 'mhd'; return; }
            d.ethanolSrc = 'dme';            // d.ethanol stays the DME's 550D (or null)
        }
        function data() {
            if (usingDemo()) return demo.sample();
            const d = Object.assign({}, live);
            UNIT_READS.forEach(([k]) => { d[k] = fresh(k); });
            ethanol(d);
            // gearbox: the gearbox unit / engine unit first, the car's own signal only once it has moved
            if (!G.isNum(d.gearbox) && gbMoved) d.gearbox = live.gearboxSig;
            // knock control retards ignition: shown as a negative number of degrees (as tuning loggers do)
            if (G.isNum(d.knock)) d.knock = -Math.abs(d.knock);
            return d;
        }

        /* ---------- session: peaks, minimums, cold pressures; kept across restarts ---------- */
        const SES_FILE = path.join(ctx.dataDir, 'session.json');
        let carSession = newSessionData();
        try {
            const s = JSON.parse(fs.readFileSync(SES_FILE, 'utf8'));
            if (s && s.start && Date.now() - (s.used || s.start) < SESSION_MAX_AGE) { carSession = Object.assign(newSessionData(), s); log.info('session resumed from ' + new Date(s.start).toISOString()); }
        } catch (e) { /* first start */ }
        let demoSession = newSessionData(), dirty = false;
        const session = () => (usingDemo() ? demoSession : carSession);
        const saveSession = () => {
            if (!dirty) return;
            dirty = false;
            try { fs.writeFileSync(SES_FILE, JSON.stringify(carSession)); } catch (e) { log.warn('session save: ' + e); }
        };
        setInterval(saveSession, 10000);
        function newSession() {
            if (usingDemo()) { demoSession = newSessionData(); demo.restart(); } else { carSession = newSessionData(); dirty = true; saveSession(); }
            log.info('new session');
        }
        const running = (d) => G.isNum(d.rpm) && d.rpm > 2000;
        /** Session peaks (and the oil pressure's minimum under load) from a sample. */
        function track(ses, d) {
            let ch = false;
            const up = (k, v) => { if (G.isNum(v) && !(ses.peak[k] >= v)) { ses.peak[k] = v; ch = true; } };
            const down = (k, v) => { if (G.isNum(v) && !(ses.min[k] <= v)) { ses.min[k] = v; ch = true; } };
            ['oil', 'coolant', 'gearbox', 'iat', 'chargeAir', 'fuelT', 'boost', 'hpfp'].forEach((k) => up(k, d[k]));
            if (G.isNum(d.knock)) down('knock', d.knock);                  // the most retard (most negative)
            if (running(d)) down('oilP', d.oilP);                          // idle pressure is low by design
            if (G.isNum(d.lambda) && G.isNum(d.lambdaTarget) && d.lambdaTarget < 0.95) up('lean', d.lambda - d.lambdaTarget);
            TYRES.forEach((k) => {
                up('t' + k, d['t' + k]);
                // the session's first pressure is the cold one
                if (ses.cold[k] === undefined && G.isNum(d['p' + k])) { ses.cold[k] = d['p' + k]; ch = true; }
            });
            if (ch || Date.now() - ses.used > 60000) { ses.used = Date.now(); if (ses === carSession) dirty = true; }
        }

        /* ---------- judgement ---------- */
        const psi = (b) => (G.isNum(b) ? b * PSI : null);
        /*
         * Tyre profiles (Dry / Hot track / Wet), each with a hot pressure target per axle in psi. The car's own
         * target (the door placard) is a COLD street pressure, so it is not used at all on track.
         */
        const PROFILE = { dry: ['Dry', 'tgtDryF', 'tgtDryR'], hot: ['Hot track', 'tgtHotF', 'tgtHotR'], wet: ['Wet', 'tgtWetF', 'tgtWetR'] };
        const profile = () => PROFILE[settings.get('tyreProfile')] || PROFILE.dry;
        /** The active profile's hot target for a tyre, in bar, or null when not set. */
        function target(k) {
            const p = profile(), v = settings.get(k[0] === 'F' ? p[1] : p[2]);
            if (v > 0) return v / PSI;
            return usingDemo() ? 35 / PSI : null;          // demo: a sample 35 psi hot so the colours show
        }
        /**
         * A warm tyre's pressure against its hot target: within 1.5 psi = ok, 1.5 to 3 psi under or over = warn,
         * more than 3 psi under (under-inflated) or over = crit.
         */
        function pressState(pr, tg) {
            if (!G.isNum(pr) || !G.isNum(tg)) return null;
            const dv = Math.abs(pr - tg) * PSI;
            return dv <= 1.5 ? 'ok' : dv <= 3 ? 'warn' : 'crit';
        }
        /** 'cold' / 'ok' / 'warn' / 'crit' / null for a tyre's air temperature. */
        function tempState(tc) {
            if (!G.isNum(tc)) return null;
            const lo = settings.get('tyreCold'), hi = settings.get('tyreHot');
            return tc < lo ? 'cold' : tc >= hi + 15 ? 'crit' : tc >= hi ? 'warn' : 'ok';
        }
        /*
         * Tyres have two colour scales:
         *   the tyre drawing and the temperature number - the TEMPERATURE (tempState): blue cold, green in the
         *   working window, yellow a little over it, red well over it
         *   the pressure number - the PRESSURE:
         *     1. puncture / leak: under 20 psi, or 3 psi or more under the session's cold reading - red. (Not against
         *        the door placard: a track cold fill of ~29 psi is far under a ~36 psi placard.)
         *     2. cold tyre: blue; not judged against the HOT target yet (a cold tyre is always under it)
         *     3. warm: against the hot target (pressState) - red under-inflated, green on target, yellow over, red well over
         * A car that sends no tyre temperatures counts as warm (the pressure is judged).
         */
        const puncture = (k, d) => {
            const pr = d['p' + k], cold = session().cold[k];
            return G.isNum(pr) && (pr * PSI < 20 || (G.isNum(cold) && (cold - pr) * PSI >= 3));
        };
        const warm = (k, d) => tempState(d['t' + k]) !== 'cold';
        /** Clearly low (TYRE LOW): a puncture / leak, or a warm tyre under 85 % of its hot target. */
        const tyreLow = (k, d) => {
            const pr = d['p' + k], tg = target(k);
            return puncture(k, d) || (warm(k, d) && G.isNum(pr) && G.isNum(tg) && pr < tg * 0.85);
        };
        /** The pressure number's state: crit when low, 'cold' while the tyre is cold, else against the hot target. */
        function tyrePressState(k, d) {
            if (tyreLow(k, d)) return 'crit';
            if (!warm(k, d)) return G.isNum(d['p' + k]) ? 'cold' : null;
            return pressState(d['p' + k], target(k));
        }
        /*
         * Cold pressure for the next stint: the cold reading of this session plus what is still missing to the hot
         * target (cold + target - hot now). Only for a warm tyre with a target and a cold reading. In bar.
         */
        function nextCold(k, d, ses) {
            const pr = d['p' + k], tg = target(k), cold = ses.cold[k];
            // nothing to advise on a leaking tyre: fix it first
            if (!warm(k, d) || puncture(k, d) || !G.isNum(pr) || !G.isNum(tg) || !G.isNum(cold)) return null;
            const v = cold + tg - pr;
            return v > 0.7 ? v : null;
        }
        /*
         * One colour language for the whole screen: green = checked and normal (on target, in its window),
         * blue = cold, yellow = attention, red = danger. White = not judged (no range for it, e.g. ethanol, or
         * boost off load), so green always means "checked and fine".
         */
        const GO = '#2fd27a';
        const stateCol = (t, s) => (s === 'ok' ? GO : s === 'warn' ? t.warn : s === 'crit' ? t.crit : s === 'cold' ? t.cold : t.text);
        const oilPLow = (d) => running(d) && G.isNum(d.oilP) && psi(d.oilP) < settings.get('oilPressMin');
        const hpfpLow = (d) => G.isNum(d.hpfp) && G.isNum(d.hpfpTarget) && d.hpfpTarget > 100 && d.hpfp < d.hpfpTarget * 0.85;
        // lean: richer than ~0.95 asked for (load), and the mixture is 0.05 or more leaner than asked
        const lean = (d) => G.isNum(d.lambda) && G.isNum(d.lambdaTarget) && d.lambdaTarget < 0.95 && d.lambda - d.lambdaTarget >= 0.05;
        /*
         * Boost against the map's target, judged only under load (target above 6 psi): 2 psi or more under
         * = warn, 4 or more under = crit (the turbo isn't getting there); 3 or more over = crit (overboost).
         */
        function boostState(d) {
            if (!G.isNum(d.boost) || !G.isNum(d.boostTarget) || psi(d.boostTarget) < 6) return null;
            const gap = psi(d.boost) - psi(d.boostTarget);
            return gap >= 3 ? 'crit' : gap <= -4 ? 'crit' : gap <= -2 ? 'warn' : 'ok';
        }
        const knocking = (d) => G.isNum(d.knock) && -d.knock >= settings.get('knockWarn');
        /** MHD's map and the sensor 10 points or more apart: still blending after a fill-up, or a map that ignores the sensor. */
        const ethanolMismatch = (d) => d.ethanolSrc === 'mhd' && G.isNum(d.ethanol) && G.isNum(d.ethanolCan) && Math.abs(d.ethanol - d.ethanolCan) >= 10;

        /** Header badges: what needs the driver now, worst first; DEMO last. */
        function alerts(d) {
            const out = [], crit = (text) => out.push({ text, color: 'crit' });
            if (oilPLow(d)) crit('OIL PRESS LOW');
            if (lean(d)) crit('LEAN');
            if (hpfpLow(d)) crit('HPFP LOW');
            if (knocking(d)) crit('KNOCK');
            if (G.isNum(d.oil) && d.oil >= settings.get('oilWarn')) crit('OIL HOT');
            if (G.isNum(d.coolant) && d.coolant >= settings.get('coolantWarn')) crit('COOLANT HOT');
            if (G.isNum(d.gearbox) && d.gearbox >= settings.get('gearboxWarn')) crit('GEARBOX HOT');
            if (G.isNum(d.chargeAir) && d.chargeAir >= settings.get('chargeWarn')) crit('CHARGE AIR HOT');
            if (TYRES.some((k) => tempState(d['t' + k]) === 'crit')) crit('TYRE HOT');
            if (TYRES.some((k) => tyreLow(k, d))) crit('TYRE LOW');
            if (ethanolMismatch(d)) out.push({ text: 'E MISMATCH', color: 'warn' });
            if (usingDemo()) out.push({ text: 'DEMO' });
            return out;
        }

        /* ---------- units (settings "Units"); values are kept in deg C / bar / lambda and converted here ---------- */
        // [factor from bar, label, decimals for tyres, oil, boost]
        const PRESS = { psi: [PSI, 'psi', 1, 0, 1], bar: [1, 'bar', 2, 1, 2], kpa: [100, 'kPa', 0, 0, 0] };
        // [factor from bar, label, decimals]
        const FUEL_PRESS = { psi: [PSI, 'psi', 0], bar: [1, 'bar', 0], mpa: [0.1, 'MPa', 1] };
        const pu = () => PRESS[settings.get('pressUnit')] || PRESS.psi;
        const fpu = () => FUEL_PRESS[settings.get('fuelPressUnit')] || FUEL_PRESS.psi;
        const DEC = { tyre: 2, oil: 3, boost: 4 };
        /** A pressure (bar) in the chosen unit, as text; kind = tyre / oil / boost picks the decimals. */
        const P = (b, kind) => G.fmt(G.isNum(b) ? b * pu()[0] : null, pu()[DEC[kind]]);
        const pU = () => pu()[1];
        const FP = (b) => G.fmt(G.isNum(b) ? b * fpu()[0] : null, fpu()[2]);
        const fahrenheit = () => settings.get('tempUnit') === 'f';
        /** A temperature (deg C) in the chosen unit; tU = its label. */
        const T = (c) => (G.isNum(c) ? (fahrenheit() ? c * 9 / 5 + 32 : c) : null);
        const tU = () => (fahrenheit() ? '°F' : '°C');
        const tTxt = (c) => G.fmt(T(c), 0) + ' ' + tU();
        /*
         * Mixture: lambda from the engine unit, shown as AFR = lambda x stoichiometric ratio.
         *   afr     - gasoline scale (14.7), as MHD / BM3 log it: comparable with the map whatever the fuel
         *   afrfuel - the real AFR of the fuel in the tank: 14.7 for gasoline down to 9.0 for pure ethanol,
         *             mixed by the flex fuel sensor's % (approximate; 14.7 when the sensor doesn't answer)
         *   lambda  - as the engine unit sends it
         */
        function stoich(d) {
            const m = settings.get('mixture');
            if (m === 'lambda') return 1;
            if (m === 'afrfuel' && G.isNum(d.ethanol)) return 14.7 - (14.7 - 9.0) * Math.min(100, Math.max(0, d.ethanol)) / 100;
            return 14.7;
        }
        const mixLabel = () => (settings.get('mixture') === 'lambda' ? 'Lambda' : settings.get('mixture') === 'afrfuel' ? 'AFR (fuel)' : 'AFR');
        const mixDec = () => (settings.get('mixture') === 'lambda' ? 2 : 1);

        /* ---------- drawing ---------- */

        /**
         * Top-down car with its wheels inside the body; per tyre, beside its wheel, three lines: the pressure (big,
         * coloured against the hot target), the air temperature (coloured by its window) and the cold pressure to
         * inflate to before the next stint. The hot targets (one per axle) go once, in the panel's title row.
         */
        function drawTyres(cv, t, x, y, w, h, d, ses) {
            const p = panel(cv, t, x, y, w, h, 'Tyres - ' + profile()[0]);
            const tf = target('FL'), tr = target('RL');
            cv.text(G.isNum(tf) || G.isNum(tr) ? 'target ' + P(tf, 'tyre') + ' / ' + P(tr, 'tyre') : 'set hot target',
                x + w - 18, y + 40, 20, G.isNum(tf) || G.isNum(tr) ? t.dim : t.warn, { align: 'right' });
            // the car (a G42 from above, nose up), in its real proportions (about 4.5 x 1.8 m), centred under the title
            const yb = p.y + p.h, cx = x + w / 2, bw = 130, bh = 320, L = cx - bw / 2, R = cx + bw / 2;
            const top = Math.round(y + 56 + (yb - 16 - (y + 56) - bh) / 2);
            Icons.car(cv, cx, top, bw, bh, { body: withAlpha(t.tick, 0.6), glass: withAlpha(t.bg, 0.7), line: withAlpha(t.bg, 0.35),
                light: withAlpha('#ffffff', 0.55), tail: withAlpha(t.crit, 0.75) });
            const wheels = Icons.carTyres(cx, top, bw, bh);
            for (const k of TYRES) {
                const side = k[1] === 'L' ? -1 : 1, wh = wheels[k], pr = d['p' + k], tc = d['t' + k];
                const ps = tyrePressState(k, d), ts = tempState(tc);
                // the tyre takes its temperature's colour, as the temperature number; grey without a temperature
                Icons.tyre(cv, wh.x, wh.y, wh.w, wh.h, ts ? withAlpha(stateCol(t, ts), 0.9) : t.tick, withAlpha(t.bg, 0.4));
                const al = side < 0 ? 'right' : 'left', lx = side < 0 ? L - 16 : R + 16, by = wh.y + 36, unit = ' ' + pU();
                const unitW = cv.textWidth(unit, 22);
                const vw = cv.text(P(pr, 'tyre'), lx + (side < 0 ? -unitW : 0), by, 50, G.isNum(pr) ? stateCol(t, ps) : t.dim, { align: al, font: 'num' });
                cv.text(unit, side < 0 ? lx : lx + vw, by, 22, t.dim, { align: al });
                cv.text(G.isNum(tc) ? tTxt(tc) : '-- ' + tU(), lx, by + 40, 32, G.isNum(tc) ? stateCol(t, ts) : t.dim, { align: al, font: 'bold' });
                // the cold pressure to inflate to before the next stint, to reach the hot target (to 0.5 psi in psi)
                let nc = nextCold(k, d, ses);
                if (G.isNum(nc) && pU() === 'psi') nc = Math.round(nc * PSI * 2) / 2 / PSI;
                if (G.isNum(nc)) cv.text('inflate cold: ' + P(nc, 'tyre'), lx, by + 68, 20, t.text, { align: al });
            }
        }

        /**
         * A panel without the M stripes (the stripes go once, next to the app's name in the header): the kit
         * panel's light overlay and a thin line along the top. Like G.panel it reaches down to the screen's bottom
         * where the kit gives the page more room (cv.extra). Returns the rect drawn.
         */
        function panel(cv, t, x, y, w, h, title) {
            const hh = y + h >= 500 && cv.extra ? h + cv.extra : h;
            cv.fillRect(x, y, w, hh, withAlpha('#b4bccc', 0.07));
            cv.fillRect(x, y + 2, w, 1.5, withAlpha('#ffffff', 0.35));
            if (title) cv.text(title, x + 18, y + 42, 26, t.text, { font: 'bold' });
            return { x, y, w, h: hh };
        }

        /** Each tile's pictogram (icons.js), by its label. */
        const ICON_OF = { 'Oil temp': 'oilT', 'Oil pressure': 'oilP', Coolant: 'coolant', Gearbox: 'gearbox', 'Intake air': 'intake',
            'Charge air': 'charge', 'Fuel temp': 'fuelT', Ethanol: 'ethanol', Boost: 'boost', HPFP: 'hpfp', AFR: 'afr', 'AFR (fuel)': 'afr',
            Lambda: 'afr', Knock: 'knock' };
        /**
         * One number tile: icon + label, the value big (coloured by its state), a small line under it.
         * state: null (not judged) / 'ok' / 'warn' / 'crit' / 'cold'. In 'crit' the whole tile turns red, to be seen
         * from the corner of the eye.
         */
        function tile(cv, t, b, label, text, unitText, state, sub) {
            // the panel stretches to the screen's bottom where there is room (G.panel), the sub line follows it
            const p = panel(cv, t, b.x, b.y, b.w, b.h, null), has = text !== '--', alarm = has && state === 'crit';
            if (alarm) cv.fillRect(p.x, p.y, p.w, p.h, withAlpha(t.crit, 0.24));
            Icons.draw(cv, ICON_OF[label], b.x + 18, b.y + 20, 26, alarm ? t.crit : t.dim, alarm ? '#3a1214' : t.bg);
            cv.text(label, b.x + 54, b.y + 42, 26, t.text, { font: 'bold' });
            const vy = b.y + 52 + 58 * 0.78;
            const vw = cv.text(text, b.x + 18, vy, 58, has ? stateCol(t, state) : t.dim, { font: 'num' });
            if (has && unitText) cv.text(unitText, b.x + 26 + vw, vy, 28, t.dim);
            if (sub) cv.text(sub, b.x + 18, p.y + p.h - G.MARGIN, 22, t.dim, { spacing: 0.5 });
        }
        /** Temperature state: 'cold' under a warm-up mark, 'warn' 10 under the warning, 'crit' at it, else 'ok'. */
        const tempSt = (v, warn, coldBelow) => (!G.isNum(v) ? null : v >= warn ? 'crit' : v >= warn - 10 ? 'warn' : G.isNum(coldBelow) && v < coldBelow ? 'cold' : 'ok');
        /** 'crit' when the check fails, 'ok' when it could be made, null when there is nothing to judge. */
        const okOr = (bad, judged) => (bad ? 'crit' : judged ? 'ok' : null);

        function drawTiles(cv, t, d, ses) {
            // 4 columns x 3 rows right of the tyres
            const x0 = 600, cols = 4, rows = 3, gx = 16, gy = 14;
            const tw = (1576 - x0 - gx * (cols - 1)) / cols, th = (G.BOTTOM - G.TOP - gy * (rows - 1)) / rows;
            const B = (c, r) => ({ x: x0 + c * (tw + gx), y: G.TOP + r * (th + gy), w: tw, h: th });
            const pk = ses.peak, mn = ses.min;
            const peak = (k) => (G.isNum(pk[k]) ? 'peak ' + tTxt(pk[k]) : '');
            const temp = (c) => G.fmt(T(c), 0);
            // row 1: oil temp, oil pressure, coolant, gearbox
            tile(cv, t, B(0, 0), 'Oil temp', temp(d.oil), tU(), tempSt(d.oil, settings.get('oilWarn'), 70), peak('oil'));
            tile(cv, t, B(1, 0), 'Oil pressure', P(d.oilP, 'oil'), pU(), okOr(oilPLow(d), G.isNum(d.oilP)),
                G.isNum(mn.oilP) ? 'min ' + P(mn.oilP, 'oil') + ' (>2000 rpm)' : '');
            tile(cv, t, B(2, 0), 'Coolant', temp(d.coolant), tU(), tempSt(d.coolant, settings.get('coolantWarn'), 60), peak('coolant'));
            tile(cv, t, B(3, 0), 'Gearbox', temp(d.gearbox), tU(), tempSt(d.gearbox, settings.get('gearboxWarn'), 40), peak('gearbox'));
            // row 2: intake air, charge air, fuel temp, ethanol
            tile(cv, t, B(0, 1), 'Intake air', temp(d.iat), tU(), tempSt(d.iat, 55), peak('iat'));
            tile(cv, t, B(1, 1), 'Charge air', temp(d.chargeAir), tU(), tempSt(d.chargeAir, settings.get('chargeWarn')), peak('chargeAir'));
            tile(cv, t, B(2, 1), 'Fuel temp', temp(d.fuelT), tU(), tempSt(d.fuelT, 60), peak('fuelT'));
            // MHD: the map's value big, the sensor's under it (yellow while they are 10 points or more apart);
            // DME: its own 550D value; without MHD, why
            const eSub = d.ethanolSrc === 'mhd' && G.isNum(d.ethanolCan) ? 'MHD, sensor ' + G.fmt(d.ethanolCan, 0)
                : d.ethanolSrc === 'dme' ? (d.ethanolWhy ? 'DME: ' + d.ethanolWhy : 'DME 550D') : d.ethanolWhy || '';
            tile(cv, t, B(3, 1), 'Ethanol', G.fmt(d.ethanol, 0), '%', ethanolMismatch(d) ? 'warn' : null, eSub);
            // row 3: boost, HPFP, mixture (each against its target), knock
            tile(cv, t, B(0, 2), 'Boost', P(d.boost, 'boost'), pU(), boostState(d),
                G.isNum(d.boostTarget) ? 'target ' + P(d.boostTarget, 'boost') : '');
            tile(cv, t, B(1, 2), 'HPFP', FP(d.hpfp), fpu()[1], okOr(hpfpLow(d), G.isNum(d.hpfp) && G.isNum(d.hpfpTarget)),
                G.isNum(d.hpfpTarget) ? 'target ' + FP(d.hpfpTarget) : '');
            const st = stoich(d), mix = (l) => G.fmt(G.isNum(l) ? l * st : null, mixDec());
            tile(cv, t, B(2, 2), mixLabel(), mix(d.lambda), '', okOr(lean(d), G.isNum(d.lambda) && G.isNum(d.lambdaTarget)),
                G.isNum(d.lambdaTarget) ? 'target ' + mix(d.lambdaTarget) : '');
            // to 0.1 degree, and never "-0.0"
            const deg = (v) => (G.isNum(v) ? G.fmt(Math.round(v * 10) / 10 || 0, 1) : '--');
            tile(cv, t, B(3, 2), 'Knock', deg(d.knock), '°', knocking(d) ? 'crit' : G.isNum(d.knock) && d.knock <= -1 ? 'warn' : G.isNum(d.knock) ? 'ok' : null,
                G.isNum(mn.knock) ? 'worst ' + deg(mn.knock) + '°' : '');
        }

        async function render() {
            shownAt = Date.now();
            const t = ctx.theme(), d = data(), ses = session();
            track(ses, d);
            const cv = ctx.canvas(W, H).clear(t.bg);
            drawTyres(cv, t, 24, G.TOP, 560, G.BOTTOM - G.TOP, d, ses);
            drawTiles(cv, t, d, ses);
            // no page tabs: the header shows the app's name ("Track Day Mode", config.header) and the alerts
            G.frame(cv, t, [], 0, alerts(d));
            if (!render.n) { render.n = 1; log.info('first frame drawn'); }
            await ui.image('MAIN_GFX', cv);
        }

        ui.onClick('BTN_RESET', () => { newSession(); return render(); });
        // every screen refresh (60 fps) with the GPU renderer; 10 fps in software (PNG frames)
        ctx.loop('MAIN', 10, render);
        render().catch((e) => log.warn('first render: ' + e));
    },
});
