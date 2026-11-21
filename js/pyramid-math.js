// 纯滚仓模型风控计算模块 (BTC 永续 & KORU 3X 5:3:2 正金字塔公式)

function computeBtcPyramidMetrics({
    p1, sl0, equity, riskPct, p2, p3, newSl, liveP, side,
    leverage = 10, fundingRate = 0, holdDays = 0, mmr = 0.005
}) {
    const isLong = side !== "SHORT";
    const lev = Math.max(1, Number(leverage) || 10);
    const days = Math.max(0, Number(holdDays) || 0);
    const fRate = Number(fundingRate) || 0;
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

    // 资金费率折算（每天 3 次结算，仅统计方向需支付的资金费率净磨损）
    const paysFunding = isLong ? fRate > 0 : fRate < 0;
    const fundingDragRate = paysFunding ? Math.abs(fRate) * days * 3 : 0;
    const totalFeeRate = 0.002 + fundingDragRate;

    const bep2 = avg2 * (isLong ? (1 + totalFeeRate) : (1 - totalFeeRate));
    const bep3 = avg3 * (isLong ? (1 + totalFeeRate) : (1 - totalFeeRate));
    const pullbackPct = liveP > 0 ? ((isLong ? (liveP - newSl) : (newSl - liveP)) / liveP) * 100 : 0;
    const worstNet2 = (isLong ? (newSl - avg2) : (avg2 - newSl)) * q12 - (avg2 * q12 * totalFeeRate);

    // 逐仓保证金占用与预估强平爆仓线（MMR 默认 0.5%）
    const calcLiq = (entryAvg) => {
        if (!entryAvg || entryAvg <= 0) return 0;
        const raw = isLong
            ? entryAvg * (1 - (1 / lev) + mmr)
            : entryAvg * (1 + (1 / lev) - mmr);
        return Math.max(0, raw);
    };
    const liqPrice1 = calcLiq(p1);
    const liqPrice2 = calcLiq(avg2);
    const liqPrice3 = calcLiq(avg3);

    const notional2 = avg2 * q12;
    const notional3 = avg3 * qAll;
    const marginUsed2 = notional2 / lev;
    const marginUsed3 = notional3 / lev;
    const marginRatioPct2 = equity > 0 ? (marginUsed2 / equity) * 100 : 0;
    const slBeyondLiq2 = liqPrice2 > 0 && (isLong ? (newSl <= liqPrice2) : (newSl >= liqPrice2));
    const liqDistPct2 = liveP > 0 && liqPrice2 > 0
        ? ((isLong ? (liveP - liqPrice2) : (liqPrice2 - liveP)) / liveP) * 100
        : 0;

    return {
        valid: true, isLong, lev, days, riskUsd, rDist, curR,
        q1, q2, q3, q12, qAll, avg2, avg3, bep2, bep3,
        fundingDragRate, totalFeeRate,
        pullbackPct, worstNet2,
        liqPrice1, liqPrice2, liqPrice3,
        notional2, notional3, marginUsed2, marginUsed3, marginRatioPct2,
        slBeyondLiq2, liqDistPct2
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
