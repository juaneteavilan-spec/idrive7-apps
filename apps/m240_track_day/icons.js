'use strict';
/**
 * icons.js - the tiles' pictograms, in the spirit of BMW's warning lights, drawn with the kit's own shapes
 * (the kit has no image decoder). Each is designed on a 24 x 24 grid and drawn at (x, y) in size s.
 *
 *   draw(cv, name, x, y, s, color, bg)   bg: the colour behind it (for the letter in the ethanol drop)
 *
 * cv needs: roundRect, strokeRoundRect, circle, arc (degrees clockwise from 12 o'clock), line, polyline, quad, text.
 * The browser preview (preview/track-day-preview.html) runs this same code through a small canvas adapter.
 */

/** A drop, point up: centre of its round part (cx, cy), radius r. */
function drop(cv, cx, cy, r, c) {
    cv.circle(cx, cy, r, c);
    cv.quad([[cx - r * 0.92, cy - r * 0.38], [cx + r * 0.92, cy - r * 0.38], [cx, cy - r * 2.1], [cx, cy - r * 2.1]], c);
}
/** A thermometer: stem from (cx, top) down, bulb under it. */
function thermometer(cv, k, cx, top, len, c) {
    cv.strokeRoundRect(cx - 3 * k, top, 6 * k, len * k, 3 * k, 2 * k, c);
    cv.circle(cx, top + (len + 3) * k, 4.2 * k, c);
}

const ICONS = {
    // engine oil temperature: thermometer and an oil drop
    oilT(cv, P, k, c) {
        thermometer(cv, k, P(7, 0)[0], P(0, 2)[1], 13, c);
        drop(cv, P(18, 0)[0], P(0, 17)[1], 3.6 * k, c);
    },
    // oil pressure: BMW's oil can
    oilP(cv, P, k, c) {
        cv.roundRect(...P(2, 11), 14 * k, 8 * k, 2 * k, c);
        cv.roundRect(...P(6, 8), 5 * k, 4 * k, 1 * k, c);
        cv.line(...P(15, 13), ...P(22, 9), 2.4 * k, c);
        cv.line(...P(3, 13), ...P(0.5, 10.5), 2.4 * k, c);
        cv.circle(...P(21.5, 15), 1.7 * k, c);
    },
    // coolant: thermometer standing in waves
    coolant(cv, P, k, c) {
        thermometer(cv, k, P(12, 0)[0], P(0, 1)[1], 12, c);
        cv.line(...P(15.5, 5), ...P(18.5, 5), 2 * k, c);
        cv.line(...P(15.5, 9), ...P(18.5, 9), 2 * k, c);
        cv.polyline([P(0.5, 21), P(3, 19), P(5.5, 21), P(7.5, 19.5)], 2 * k, c);
        cv.polyline([P(16.5, 19.5), P(18.5, 21), P(21, 19), P(23.5, 21)], 2 * k, c);
    },
    // gearbox: a gear
    gearbox(cv, P, k, c) {
        const [cx, cy] = P(12, 12);
        cv.arc(cx, cy, 4.2 * k, 7.6 * k, 0, 360, c);
        for (let a = 0; a < 360; a += 45) {
            const r = (a * Math.PI) / 180, s = Math.sin(r), co = -Math.cos(r);
            cv.line(cx + s * 6.5 * k, cy + co * 6.5 * k, cx + s * 10.5 * k, cy + co * 10.5 * k, 3.4 * k, c);
        }
    },
    // intake air: three streams of air
    intake(cv, P, k, c) {
        cv.polyline([P(1, 7), P(15, 7), P(18, 4.5), P(16.5, 2)], 2.2 * k, c);
        cv.line(...P(1, 12), ...P(22, 12), 2.2 * k, c);
        cv.polyline([P(1, 17), P(13, 17), P(16, 19.5), P(14.5, 22)], 2.2 * k, c);
    },
    // charge air: the intercooler's core
    charge(cv, P, k, c) {
        cv.strokeRoundRect(...P(2, 4), 20 * k, 16 * k, 2 * k, 2.2 * k, c);
        for (const x of [7, 12, 17]) cv.line(...P(x, 6.5), ...P(x, 17.5), 1.6 * k, c);
    },
    // fuel temperature: fuel pump with a small thermometer
    fuelT(cv, P, k, c) {
        cv.strokeRoundRect(...P(2, 3), 11 * k, 19 * k, 2 * k, 2.2 * k, c);
        cv.roundRect(...P(4.5, 6), 6 * k, 4 * k, 1 * k, c);
        cv.polyline([P(13, 8), P(16, 8), P(17.5, 10), P(17.5, 14)], 2 * k, c);
        thermometer(cv, k * 0.8, P(20.5, 0)[0], P(0, 10)[1], 8, c);
    },
    // ethanol: a drop with an E
    ethanol(cv, P, k, c, bg) {
        drop(cv, P(12, 0)[0], P(0, 15.5)[1], 7 * k, c);
        cv.text('E', P(12, 0)[0], P(0, 20)[1], 12 * k, bg, { align: 'center', font: 'bold' });
    },
    // boost: a gauge
    boost(cv, P, k, c) {
        const [cx, cy] = P(12, 14);
        cv.arc(cx, cy, 8.6 * k, 11 * k, -125, 125, c);
        cv.line(cx, cy, ...P(17.5, 8.5), 2.6 * k, c);
        cv.circle(cx, cy, 2.4 * k, c);
    },
    // high pressure fuel: a fuel drop with an arrow up
    hpfp(cv, P, k, c) {
        drop(cv, P(8, 0)[0], P(0, 16)[1], 6 * k, c);
        cv.line(...P(19, 22), ...P(19, 7), 2.4 * k, c);
        cv.quad([P(14.5, 9), P(23.5, 9), P(19, 2.5), P(19, 2.5)], c);
    },
    // air-fuel ratio: air beside a fuel drop
    afr(cv, P, k, c) {
        cv.line(...P(1, 8), ...P(10, 8), 2.2 * k, c);
        cv.line(...P(1, 13), ...P(12, 13), 2.2 * k, c);
        cv.line(...P(1, 18), ...P(10, 18), 2.2 * k, c);
        drop(cv, P(18, 0)[0], P(0, 16)[1], 5 * k, c);
    },
    // knock: a lightning bolt
    knock(cv, P, k, c) {
        cv.quad([P(13, 1), P(19, 1), P(12.5, 12.5), P(6, 12.5)], c);
        cv.quad([P(11, 10.5), P(18, 10.5), P(8, 23), P(9.5, 14)], c);
    },
};

/** Draws the named icon in a box of size s at (x, y). Unknown names draw nothing. */
function draw(cv, name, x, y, s, color, bg) {
    const f = ICONS[name];
    if (!f) return;
    const k = s / 24, P = (gx, gy) => [x + gx * k, y + gy * k];
    f(cv, P, k, color, bg);
}

/**
 * The car from above, in the lines of a G42 coupé: narrow nose with the twin kidneys, long hood, short cabin,
 * wide rear. Centre cx, from `top` down, bw wide and bh long; the wheels sit inside the body (carTyres).
 * col = { body, glass, line, light, tail }.
 */
function car(cv, cx, top, bw, bh, col) {
    const L = cx - bw / 2, R = cx + bw / 2, Y = (f) => top + bh * f;
    // body: the nose and the cabin
    cv.roundRect(L + 8, top, bw - 16, bh * 0.2, 22, col.body);
    cv.roundRect(L, top + bh * 0.07, bw, bh * 0.93, 24, col.body);
    // kidneys and headlights
    cv.roundRect(cx - 13, top + 3, 11, 6, 3, col.glass);
    cv.roundRect(cx + 2, top + 3, 11, 6, 3, col.glass);
    cv.roundRect(L + 10, top + 10, 14, 5, 2.5, col.light);
    cv.roundRect(R - 24, top + 10, 14, 5, 2.5, col.light);
    // hood creases, between the front wheels
    cv.line(cx - 9, top + 16, cx - 12, Y(0.27), 2, col.line);
    cv.line(cx + 9, top + 16, cx + 12, Y(0.27), 2, col.line);
    // windscreen, roof, rear window, boot lid
    cv.quad([[L + 16, Y(0.31)], [R - 16, Y(0.31)], [R - 9, Y(0.39)], [L + 9, Y(0.39)]], col.glass);
    cv.roundRect(L + 11, Y(0.4), bw - 22, bh * 0.22, 8, col.line);
    cv.quad([[L + 12, Y(0.63)], [R - 12, Y(0.63)], [R - 17, Y(0.69)], [L + 17, Y(0.69)]], col.glass);
    cv.line(L + 26, Y(0.93), R - 26, Y(0.93), 2, col.line);
    // mirrors and tail lights
    cv.roundRect(L - 7, Y(0.36), 10, 6, 3, col.body);
    cv.roundRect(R - 3, Y(0.36), 10, 6, 3, col.body);
    cv.roundRect(L + 6, top + bh - 8, 20, 4, 2, col.tail);
    cv.roundRect(R - 26, top + bh - 8, 20, 4, 2, col.tail);
}

/** Where the four wheels sit inside the body drawn by car(): { FL, FR, RL, RR: { x, y, w, h } }. */
function carTyres(cx, top, bw, bh) {
    const w = Math.round(bw * 0.2), h = Math.round(bh * 0.18), L = cx - bw / 2 + 4, R = cx + bw / 2 - 4 - w;
    const yf = top + bh * 0.1, yr = top + bh * 0.72;
    return { FL: { x: L, y: yf, w, h }, FR: { x: R, y: yf, w, h }, RL: { x: L, y: yr, w, h }, RR: { x: R, y: yr, w, h } };
}

/** A tyre seen from above with a directional tread: chevron grooves down its length. */
function tyre(cv, x, y, w, h, color, groove) {
    cv.roundRect(x, y, w, h, Math.min(6, w / 3), color);
    for (let yy = y + 5; yy + 5 <= y + h - 3; yy += 7) {
        cv.line(x + 3.5, yy + 3, x + w / 2, yy, 1.6, groove);
        cv.line(x + w / 2, yy, x + w - 3.5, yy + 3, 1.6, groove);
    }
}

module.exports = { draw, car, carTyres, tyre, names: Object.keys(ICONS) };
