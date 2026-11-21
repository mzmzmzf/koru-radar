// 纯滚仓模型风控计算模块 (BTC 永续 & KORU 3X 5:3:2 正金字塔公式)

function computeBtcPyramidMetrics({ p1, sl0, equity, riskPct, p2, p3, newSl, liveP, side }) {
    const isLong = side !== "SHORT";
    const riskUsd = equity * (riskPct / 100);
    const rDist = isLong ? (p1 - sl0) : (sl0 - p1);
    const curR = rDist > 0 ? ((isLong ? (liveP - p1) : (p1 - liveP)) / rDist) : 0;
    if (rDist <= 0 || p1 <= 0) {
        return { valid: false, riskUsd, rDist, curR };
    }
    const q1 = riskUsd / rDist;
    const q2 = q1 * 0.6;
    const q3 = q1 * 0.4;
    const q12 = q1 + q2;
    const qAll = q1 + q2 + q3;
    const avg2 = (q1 * p1 + q2 * p2) / q12;
    const avg3 = (q1 * p1 + q2 * p2 + q3 * p3) / qAll;
    const bep2 = avg2 * (isLong ? 1.002 : 0.998);
    const bep3 = avg3 * (isLong ? 1.002 : 0.998);
    const pullbackPct = liveP > 0 ? ((isLong ? (liveP - newSl) : (newSl - liveP)) / liveP) * 100 : 0;
    const worstNet2 = (isLong ? (newSl - avg2) : (avg2 - newSl)) * q12 - (avg2 * q12 * 0.002);
    return {
        valid: true, isLong, riskUsd, rDist, curR,
        q1, q2, q3, q12, qAll, avg2, avg3, bep2, bep3,
        pullbackPct, worstNet2
    };
}

function computeKoruPyramidMetrics({ p1, sl0, cap1, p2, p3, newSl, kp }) {
    const rDist = p1 - sl0;
    const curR = rDist > 0 ? (kp - p1) / rDist : 0;
    if (rDist <= 0 || p1 <= 0) {
        return { valid: false, rDist, curR };
    }
    const q1 = cap1 / p1;
    const q2 = q1 * 0.6;
    const q3 = q1 * 0.4;
    const avg2 = (q1 * p1 + q2 * p2) / (q1 + q2);
    const avg3 = (q1 * p1 + q2 * p2 + q3 * p3) / (q1 + q2 + q3);
    const bep2 = avg2 * 1.002;
    const bep3 = avg3 * 1.002;
    const pbPct = kp > 0 ? ((kp - newSl) / kp) * 100 : 0;
    const worstNetUsd = (newSl - avg2) * (q1 + q2) - (avg2 * (q1 + q2) * 0.002);
    const worstPct = cap1 > 0 ? (worstNetUsd / (cap1 * 1.6)) * 100 : 0;
    return {
        valid: true, rDist, curR, q1, q2, q3,
        avg2, avg3, bep2, bep3, pbPct, worstNetUsd, worstPct
    };
}
