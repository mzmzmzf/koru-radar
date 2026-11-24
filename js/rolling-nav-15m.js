// 专属《15m 滚仓导航指标》核心状态机 + 流动性猎杀反转捕捉 + 动态追踪防守线 + 安全垫风控联动

(function () {
    function getBeijingSessionInfo(unixSec) {
        const d = new Date((unixSec + 8 * 3600) * 1000);
        const h = d.getUTCHours();
        const m = d.getUTCMinutes();
        const hm = h + m / 60;
        // 北京时间 (UTC+8) 流动性与时段分类
        if (hm >= 20.5 || hm < 1.5) {
            return { code: "US_EU_PRIME", label: "🇺🇸欧美窗", quality: "HIGH", weight: 1.0, color: "#10b981" };
        }
        if (hm >= 15.0 && hm < 20.5) {
            return { code: "EU_ACTIVE", label: "🇪🇺欧盘", quality: "MED", weight: 0.9, color: "#38bdf8" };
        }
        if (hm >= 8.0 && hm < 15.0) {
            return { code: "ASIA_TRAP", label: "🌏亚盘防诱", quality: "CAUTION", weight: 0.75, color: "#f59e0b" };
        }
        return { code: "LATE_NIGHT", label: "🌙凌晨低流", quality: "LOW", weight: 0.5, color: "#94a3b8" };
    }

    function calcAtr14(candles) {
        const n = candles.length;
        const atr = new Array(n).fill(null);
        if (n < 2) return atr;
        let sum = 0;
        const period = 14;
        for (let i = 0; i < n; i++) {
            const c = candles[i];
            const prevC = i > 0 ? candles[i - 1].close : c.open;
            const tr = Math.max(c.high - c.low, Math.abs(c.high - prevC), Math.abs(c.low - prevC));
            if (i < period) {
                sum += tr;
                if (i === period - 1) atr[i] = sum / period;
            } else {
                atr[i] = (atr[i - 1] * (period - 1) + tr) / period;
            }
        }
        return atr;
    }

    function calcVolMa20(candles) {
        const n = candles.length;
        const ma = new Array(n).fill(null);
        let sum = 0;
        const period = 20;
        for (let i = 0; i < n; i++) {
            sum += (Number(candles[i].vol) || 0);
            if (i >= period) sum -= (Number(candles[i - period].vol) || 0);
            if (i >= period - 1) ma[i] = sum / period;
        }
        return ma;
    }

    /**
     * 计算《15m 滚仓导航指标》状态机、极简信号标记、追踪防守线与安全垫风控联动
     * @param {Array} candles enrichedCandles (含 time, open, high, low, close, vol, ema10, ema15, ma50)
     * @param {Object} opts { longPct, activePosAvg, activePosSide, activePosQty }
     */
    window.compute15mRollingNavigator = function (candles, opts = {}) {
        const empty = {
            state: "NEUTRAL",
            stateLabel: "观望静默",
            shortStateLabel: "观望",
            bias: "NEUTRAL",
            markers: [],
            trailingPoints: [],
            latestTrailing: null,
            hypotheticalBep: null,
            cushionPct: null,
            riskGuard: { level: "OK", isBlocked: false, headline: "", actionTip: "" },
            session: getBeijingSessionInfo(Math.floor(Date.now() / 1000)),
            trapAlert: null
        };
        if (!Array.isArray(candles) || candles.length < 25) return empty;

        const n = candles.length;
        const atrArr = calcAtr14(candles);
        const volMaArr = calcVolMa20(candles);
        const longPct = Number(opts.longPct) || 0;

        let state = "NEUTRAL"; // NEUTRAL | TREND_START | ROLLING | TRIM_EXIT
        let bias = "NEUTRAL";  // LONG | SHORT | NEUTRAL
        let trendAnchorPrice = null;

        // 冷却与同向去重追踪器（防止连刷和文字重叠）
        let lastStartBarIdx = -99;
        let lastStartBias = "NEUTRAL";
        let lastAddBarIdx = -99;
        let lastAddBias = "NEUTRAL";
        let lastSidewaysBarIdx = -99;
        let lastExitBarIdx = -99;

        // 流动性猎杀 / 孤立巨柱反转追踪器（第 1 步预警 -> 第 2 步右侧黄金进场）
        let bearTrapIdx = -99;
        let bearTrapHigh = 0;
        let bullTrapIdx = -99;
        let bullTrapLow = 0;

        const markers = [];
        const trailingPoints = [];

        const pushUniqueBarMarker = (barIdx, marker) => {
            if (markers.length > 0 && markers[markers.length - 1].time === marker.time) {
                return; // 同一根 K 线只保留最高优先级信号，避免重叠
            }
            marker._barIdx = barIdx;
            markers.push(marker);
        };

        for (let i = 20; i < n; i++) {
            const c = candles[i];
            const prev = candles[i - 1];
            const ema10 = c.ema10;
            const ema15 = c.ema15;
            const ma50 = c.ma50;
            const ma50Prev3 = candles[i - 3]?.ma50;
            const atr = atrArr[i];
            const volMa = volMaArr[i];
            if (!isFinite(ema10) || !isFinite(ema15) || !isFinite(ma50) || !isFinite(atr) || atr <= 0) continue;

            const body = Math.abs(c.close - c.open);
            const upperWick = c.high - Math.max(c.open, c.close);
            const lowerWick = Math.min(c.open, c.close) - c.low;
            const emaGap = Math.abs(ema10 - ema15);
            const isVolShrunk = volMa > 0 && ((c.vol < volMa * 0.85) || (prev.vol < volMa * 0.85));
            const isVolExpanded = volMa > 0 && (c.vol > volMa * 1.15);
            const sess = getBeijingSessionInfo(c.time);

            // --- A. 第 1 步：孤立巨柱 + 长影/反包（流动性猎杀预警，8 根冷却防连刷） ---
            const prevSpikeUp = (prev.high - prev.ema10) > 2.2 * atr && (prev.close > prev.open);
            const curSpikeUp = (c.high - ema10) > 2.2 * atr;
            const isBearReject = (c.close < c.open && body > Math.abs(prev.close - prev.open) * 0.7) || (upperWick > body * 1.35 && upperWick > 0.6 * atr);
            if ((prevSpikeUp || curSpikeUp) && isBearReject && (i - bearTrapIdx >= 8)) {
                bearTrapIdx = i;
                bearTrapHigh = Math.max(c.high, prev.high);
                pushUniqueBarMarker(i, {
                    time: c.time,
                    position: "aboveBar",
                    color: "#f43f5e",
                    shape: "arrowDown",
                    text: "⚠️假多",
                    _kind: "TRAP"
                });
            }

            const prevSpikeDn = (prev.ema10 - prev.low) > 2.2 * atr && (prev.close < prev.open);
            const curSpikeDn = (ema10 - c.low) > 2.2 * atr;
            const isBullReject = (c.close > c.open && body > Math.abs(prev.close - prev.open) * 0.7) || (lowerWick > body * 1.35 && lowerWick > 0.6 * atr);
            if ((prevSpikeDn || curSpikeDn) && isBullReject && (i - bullTrapIdx >= 8)) {
                bullTrapIdx = i;
                bullTrapLow = Math.min(c.low, prev.low);
                pushUniqueBarMarker(i, {
                    time: c.time,
                    position: "belowBar",
                    color: "#10b981",
                    shape: "arrowUp",
                    text: "⚠️假空",
                    _kind: "TRAP"
                });
            }

            // --- B. 第 2 步：右侧黄金空点 / 黄金多点（死叉/金叉后缩量回踩 10/15 EMA 滞涨） ---
            const bearCrossActive = ema10 < ema15 && c.close < ema15;
            if (i - bearTrapIdx >= 1 && i - bearTrapIdx <= 12 && bearCrossActive) {
                const touchedZone = c.high >= Math.min(ema10, ema15) * 0.999;
                if (touchedZone && c.close < c.open && isVolShrunk) {
                    pushUniqueBarMarker(i, {
                        time: c.time,
                        position: "aboveBar",
                        color: "#fbbf24",
                        shape: "arrowDown",
                        text: "🎯空",
                        _kind: "GOLDEN_ENTRY",
                        _side: "SHORT"
                    });
                    bearTrapIdx = -99;
                }
            }
            const bullCrossActive = ema10 > ema15 && c.close > ema15;
            if (i - bullTrapIdx >= 1 && i - bullTrapIdx <= 12 && bullCrossActive) {
                const touchedZone = c.low <= Math.max(ema10, ema15) * 1.001;
                if (touchedZone && c.close > c.open && isVolShrunk) {
                    pushUniqueBarMarker(i, {
                        time: c.time,
                        position: "belowBar",
                        color: "#fbbf24",
                        shape: "arrowUp",
                        text: "🎯多",
                        _kind: "GOLDEN_ENTRY",
                        _side: "LONG"
                    });
                    bullTrapIdx = -99;
                }
            }

            // --- C. 三段式滚仓主状态机 ---
            const ma50SlopeUp = isFinite(ma50Prev3) ? (ma50 > ma50Prev3) : true;
            const ma50SlopeDn = isFinite(ma50Prev3) ? (ma50 < ma50Prev3) : true;
            const bullTrend = ema10 > ema15 && ema15 > ma50 && ma50SlopeUp && emaGap >= 0.12 * atr;
            const bearTrend = ema10 < ema15 && ema15 < ma50 && ma50SlopeDn && emaGap >= 0.12 * atr;

            // 走横/均线走平检测（最近 5 根窄幅收窄 + EMA 间距 < 0.15 ATR）
            let hi5 = -Infinity, lo5 = Infinity;
            for (let k = i - 4; k <= i; k++) {
                hi5 = Math.max(hi5, candles[k].close);
                lo5 = Math.min(lo5, candles[k].close);
            }
            const isSideways = emaGap < 0.15 * atr && (hi5 - lo5) < 1.15 * atr;

            // 阶段一：趋势启动（仅允许方向切换，或同向间隔 >= 12 根 K 线的新波段才打底仓标）
            if (bullTrend && bias !== "LONG") {
                bias = "LONG";
                state = "TREND_START";
                trendAnchorPrice = c.close;
                const canMarkStart = (lastStartBias !== "LONG" && (i - lastStartBarIdx >= 6)) || (i - lastStartBarIdx >= 12);
                if (canMarkStart) {
                    lastStartBarIdx = i;
                    lastStartBias = "LONG";
                    const crowdWarn = longPct >= 63 ? "⚠" : "";
                    pushUniqueBarMarker(i, {
                        time: c.time,
                        position: "belowBar",
                        color: "#38bdf8",
                        shape: "circle",
                        text: `🚀底多${crowdWarn}`,
                        _kind: "START",
                        _side: "LONG"
                    });
                }
            } else if (bearTrend && bias !== "SHORT") {
                bias = "SHORT";
                state = "TREND_START";
                trendAnchorPrice = c.close;
                const canMarkStart = (lastStartBias !== "SHORT" && (i - lastStartBarIdx >= 6)) || (i - lastStartBarIdx >= 12);
                if (canMarkStart) {
                    lastStartBarIdx = i;
                    lastStartBias = "SHORT";
                    pushUniqueBarMarker(i, {
                        time: c.time,
                        position: "aboveBar",
                        color: "#f87171",
                        shape: "circle",
                        text: "🚀底空",
                        _kind: "START",
                        _side: "SHORT"
                    });
                }
            }

            // 阶段二：顺势 +1/5 缩量回踩加仓信号（同向强制 6 根冷却 + 走横时禁发）
            const addCooldownOk = (bias !== lastAddBias) || (i - lastAddBarIdx >= 6);
            if (!isSideways && bias === "LONG" && bullTrend && body < 1.8 * atr && addCooldownOk && (i - lastStartBarIdx >= 2)) {
                const pullbackTouch = (c.low <= ema10 * 1.001 || prev.low <= ema10 * 1.001) && c.close >= ema15 * 0.999;
                const holdConfirm = c.close > c.open && c.close > prev.low;
                if (pullbackTouch && holdConfirm && isVolShrunk) {
                    state = "ROLLING";
                    lastAddBarIdx = i;
                    lastAddBias = "LONG";
                    const lowLiqTag = sess.quality === "LOW" ? "⚠" : "";
                    pushUniqueBarMarker(i, {
                        time: c.time,
                        position: "belowBar",
                        color: sess.quality === "LOW" ? "#94a3b8" : "#10b981",
                        shape: "arrowUp",
                        text: `+多${lowLiqTag}`,
                        _kind: "ADD",
                        _side: "LONG"
                    });
                }
            } else if (!isSideways && bias === "SHORT" && bearTrend && body < 1.8 * atr && addCooldownOk && (i - lastStartBarIdx >= 2)) {
                const pullbackTouch = (c.high >= ema10 * 0.999 || prev.high >= ema10 * 0.999) && c.close <= ema15 * 1.001;
                const holdConfirm = c.close < c.open && c.close < prev.high;
                if (pullbackTouch && holdConfirm && isVolShrunk) {
                    state = "ROLLING";
                    lastAddBarIdx = i;
                    lastAddBias = "SHORT";
                    const lowLiqTag = sess.quality === "LOW" ? "⚠" : "";
                    pushUniqueBarMarker(i, {
                        time: c.time,
                        position: "aboveBar",
                        color: sess.quality === "LOW" ? "#94a3b8" : "#ef4444",
                        shape: "arrowDown",
                        text: `+空${lowLiqTag}`,
                        _kind: "ADD",
                        _side: "SHORT"
                    });
                }
            }

            // 阶段三：走横停火（8根冷却） / 放量破 15 EMA 减仓止盈（6根冷却）
            const breakLongExit = bias === "LONG" && c.close < ema15 && isVolExpanded;
            const breakShortExit = bias === "SHORT" && c.close > ema15 && isVolExpanded;
            if ((bias === "LONG" || bias === "SHORT") && (breakLongExit || breakShortExit)) {
                state = "TRIM_EXIT";
                if (i - lastExitBarIdx >= 6) {
                    lastExitBarIdx = i;
                    pushUniqueBarMarker(i, {
                        time: c.time,
                        position: bias === "LONG" ? "aboveBar" : "belowBar",
                        color: "#f59e0b",
                        shape: "square",
                        text: "✂️盈",
                        _kind: "EXIT"
                    });
                }
                bias = "NEUTRAL";
            } else if ((bias === "LONG" || bias === "SHORT") && isSideways) {
                state = "TRIM_EXIT";
                if (i - lastSidewaysBarIdx >= 8) {
                    lastSidewaysBarIdx = i;
                    pushUniqueBarMarker(i, {
                        time: c.time,
                        position: bias === "LONG" ? "aboveBar" : "belowBar",
                        color: "#f59e0b",
                        shape: "square",
                        text: "⏸停",
                        _kind: "SIDEWAYS"
                    });
                }
            }

            // 动态追踪防守线：15 EMA ± 0.5 * ATR(14)
            if (bias === "LONG") {
                trailingPoints.push({ time: c.time, value: ema15 - 0.5 * atr, bias: "LONG" });
            } else if (bias === "SHORT") {
                trailingPoints.push({ time: c.time, value: ema15 + 0.5 * atr, bias: "SHORT" });
            }
        }

        // 计算最新一根的护栏指标
        const lastBar = candles[n - 1];
        const latestSess = getBeijingSessionInfo(lastBar.time);
        const latestTrailObj = trailingPoints.length ? trailingPoints[trailingPoints.length - 1] : null;

        // 假定按现价再加 1/5 后的新 BEP 与安全缓冲垫
        let baseAvg = Number(opts.activePosAvg) || trendAnchorPrice || 0;
        let effectiveBias = opts.activePosSide || bias;
        let hypotheticalBep = null;
        let cushionPct = null;
        if (baseAvg > 0 && (effectiveBias === "LONG" || effectiveBias === "SHORT")) {
            const blended = (baseAvg * 1.0 + lastBar.close * 0.2) / 1.2;
            const isLong = effectiveBias === "LONG";
            hypotheticalBep = blended * (isLong ? 1.002 : 0.998);
            cushionPct = lastBar.close > 0
                ? ((isLong ? (lastBar.close - hypotheticalBep) : (hypotheticalBep - lastBar.close)) / lastBar.close) * 100
                : 0;
        }

        // 安全垫红线与状态机联动风控评估
        const cStr = cushionPct !== null ? `${cushionPct >= 0 ? "+" : ""}${cushionPct.toFixed(2)}%` : "--";
        let riskGuard = { level: "OK", isBlocked: false, headline: "", actionTip: "" };
        if (cushionPct !== null) {
            if (cushionPct < 0) {
                riskGuard = {
                    level: "LOCKED_NEG",
                    isBlocked: true,
                    headline: `⛔ 垫穿 ${cStr} · 严禁加仓`,
                    actionTip: "仅守防线或减仓"
                };
            } else if (cushionPct < 1.5) {
                riskGuard = {
                    level: "LOCKED_THIN",
                    isBlocked: true,
                    headline: `🚨 垫薄 ${cStr} · 暂停加仓`,
                    actionTip: "低于1.5%红线"
                };
            } else if (cushionPct < 2.5) {
                riskGuard = {
                    level: "CAUTION",
                    isBlocked: false,
                    headline: "",
                    actionTip: `缓冲偏窄 ${cStr}`
                };
            }
        }

        // 若实时安全垫已触发禁加红线，屏蔽最新 2 根 K 线上的同向新增开仓/加仓提示，消除自相矛盾
        const finalMarkers = markers.filter(m => {
            if (riskGuard.isBlocked && m._barIdx >= n - 2 && (m._kind === "ADD" || m._kind === "START") && m._side === effectiveBias) {
                return false;
            }
            return true;
        }).map(m => ({
            time: m.time,
            position: m.position,
            color: m.color,
            shape: m.shape,
            text: m.text
        }));

        const stateNameMap = {
            TREND_START: bias === "LONG" ? "多头启动" : "空头启动",
            ROLLING: bias === "LONG" ? "顺势滚多" : "顺势滚空",
            TRIM_EXIT: "走横停火 / 锁利",
            NEUTRAL: "震荡静默"
        };
        const shortStateMap = {
            TREND_START: bias === "LONG" ? "多启" : "空启",
            ROLLING: bias === "LONG" ? "滚多" : "滚空",
            TRIM_EXIT: "停火",
            NEUTRAL: "静默"
        };

        const trapAlert = (n - 1 - bearTrapIdx <= 10 && bearTrapHigh > 0)
            ? { side: "SHORT", slRef: bearTrapHigh, text: `⚠️假多监测 · 强高SL ${bearTrapHigh.toFixed(1)}` }
            : ((n - 1 - bullTrapIdx <= 10 && bullTrapLow > 0)
                ? { side: "LONG", slRef: bullTrapLow, text: `⚠️假空监测 · 强低SL ${bullTrapLow.toFixed(1)}` }
                : null);

        return {
            state,
            stateLabel: stateNameMap[state] || "观望静默",
            shortStateLabel: shortStateMap[state] || "观望",
            bias,
            markers: finalMarkers.slice(-30),
            trailingPoints,
            latestTrailing: latestTrailObj ? latestTrailObj.value : null,
            hypotheticalBep,
            cushionPct,
            riskGuard,
            session: latestSess,
            trapAlert
        };
    };
})();
