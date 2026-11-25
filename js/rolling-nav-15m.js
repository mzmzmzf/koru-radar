// 专属《15m 滚仓导航指标》：4 重趋势真伪过滤器（1H共振 + 三均线秩序斜率 + ADX/ER震荡过滤 + SMC空间/情绪）+ 极简信号 + 动态追踪防守线 + 安全垫风控联动

(function () {
    function getBeijingSessionInfo(unixSec) {
        const d = new Date((unixSec + 8 * 3600) * 1000);
        const h = d.getUTCHours();
        const m = d.getUTCMinutes();
        const hm = h + m / 60;
        const isDeadZone = hm >= 3.0 && hm < 7.5; // 北京时间 03:00–07:30 流动性枯竭段
        if (hm >= 20.5 || hm < 1.5) {
            return { code: "US_EU_PRIME", label: "🇺🇸欧美窗", quality: "HIGH", isDeadZone: false, color: "#10b981" };
        }
        if (hm >= 15.0 && hm < 20.5) {
            return { code: "EU_ACTIVE", label: "🇪🇺欧盘", quality: "MED", isDeadZone: false, color: "#38bdf8" };
        }
        if (hm >= 8.0 && hm < 15.0) {
            return { code: "ASIA_TRAP", label: "🌏亚盘防诱", quality: "CAUTION", isDeadZone: false, color: "#f59e0b" };
        }
        return {
            code: "LATE_NIGHT",
            label: isDeadZone ? "🌙03-07枯竭" : "🌙凌晨低流",
            quality: "LOW",
            isDeadZone,
            color: "#94a3b8"
        };
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

    // 考夫曼效率系数 ER(10) = 净位移 / 路程总和（区分单边推进 vs 原地画门锯齿）
    function calcEfficiencyRatio(candles, period = 10) {
        const n = candles.length;
        const er = new Array(n).fill(null);
        for (let i = period; i < n; i++) {
            const net = Math.abs(candles[i].close - candles[i - period].close);
            let path = 0;
            for (let k = i - period + 1; k <= i; k++) {
                path += Math.abs(candles[k].close - candles[k - 1].close);
            }
            er[i] = path > 0 ? (net / path) : 0;
        }
        return er;
    }

    // Wilder ADX(14) 趋势强度指标
    function calcAdx14(candles, period = 14) {
        const n = candles.length;
        const adx = new Array(n).fill(null);
        if (n < period * 2 + 2) return adx;

        const trArr = new Array(n).fill(0);
        const pDmArr = new Array(n).fill(0);
        const mDmArr = new Array(n).fill(0);

        for (let i = 1; i < n; i++) {
            const c = candles[i];
            const p = candles[i - 1];
            trArr[i] = Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
            const up = c.high - p.high;
            const dn = p.low - c.low;
            pDmArr[i] = (up > dn && up > 0) ? up : 0;
            mDmArr[i] = (dn > up && dn > 0) ? dn : 0;
        }

        let smTr = 0, smPdm = 0, smMdm = 0;
        for (let i = 1; i <= period; i++) {
            smTr += trArr[i];
            smPdm += pDmArr[i];
            smMdm += mDmArr[i];
        }

        const dxArr = new Array(n).fill(null);
        const pushDx = (idx) => {
            if (smTr <= 0) { dxArr[idx] = 0; return; }
            const pDi = (smPdm / smTr) * 100;
            const mDi = (smMdm / smTr) * 100;
            const denom = pDi + mDi;
            dxArr[idx] = denom > 0 ? (Math.abs(pDi - mDi) / denom) * 100 : 0;
        };
        pushDx(period);

        for (let i = period + 1; i < n; i++) {
            smTr = smTr - (smTr / period) + trArr[i];
            smPdm = smPdm - (smPdm / period) + pDmArr[i];
            smMdm = smMdm - (smMdm / period) + mDmArr[i];
            pushDx(i);
        }

        let dxSum = 0;
        const firstAdxIdx = period * 2 - 1;
        for (let i = period; i <= firstAdxIdx; i++) dxSum += (dxArr[i] || 0);
        adx[firstAdxIdx] = dxSum / period;

        for (let i = firstAdxIdx + 1; i < n; i++) {
            adx[i] = ((adx[i - 1] * (period - 1)) + (dxArr[i] || 0)) / period;
        }
        return adx;
    }

    // 从当前 K 线自动合成 4 倍大周期（15m -> 1H）趋势状态：每根小周期 K 线都有对应的高周期多空判定
    function buildSynthesizedHtfBias(candles) {
        const n = candles.length;
        const biasArr = new Array(n).fill("NEUTRAL"); // 'LONG' | 'SHORT' | 'NEUTRAL'
        if (n < 24) return biasArr;

        // 推断周期步长，15m (900s) 精确按整点 3600s 聚合为 1H，其它周期按 4 根合并
        const dt = Math.abs(candles[n - 1].time - candles[n - 2].time) || 900;
        const useHourlyBucket = dt >= 800 && dt <= 1000;

        const htfBars = [];
        const barToHtfIdx = new Array(n).fill(0);

        for (let i = 0; i < n; i++) {
            const c = candles[i];
            const bucketKey = useHourlyBucket ? Math.floor(c.time / 3600) : Math.floor(i / 4);
            if (!htfBars.length || htfBars[htfBars.length - 1].key !== bucketKey) {
                htfBars.push({ key: bucketKey, open: c.open, high: c.high, low: c.low, close: c.close });
            } else {
                const last = htfBars[htfBars.length - 1];
                last.high = Math.max(last.high, c.high);
                last.low = Math.min(last.low, c.low);
                last.close = c.close;
            }
            barToHtfIdx[i] = htfBars.length - 1;
        }

        const m = htfBars.length;
        const k15 = 2 / 16;
        const ema15 = new Array(m).fill(0);
        const maSlow = new Array(m).fill(null);
        const slowLen = m >= 52 ? 50 : Math.max(20, Math.min(34, Math.floor(m * 0.6)));

        ema15[0] = htfBars[0].close;
        for (let j = 1; j < m; j++) {
            ema15[j] = htfBars[j].close * k15 + ema15[j - 1] * (1 - k15);
        }
        for (let j = slowLen - 1; j < m; j++) {
            let s = 0;
            for (let k = j - slowLen + 1; k <= j; k++) s += htfBars[k].close;
            maSlow[j] = s / slowLen;
        }

        for (let i = 0; i < n; i++) {
            const j = barToHtfIdx[i];
            const cClose = candles[i].close;
            const e15 = ema15[j];
            const mSlow = maSlow[j];
            if (mSlow !== null) {
                if (cClose > e15 && e15 > mSlow) biasArr[i] = "LONG";
                else if (cClose < e15 && e15 < mSlow) biasArr[i] = "SHORT";
                else biasArr[i] = "NEUTRAL";
            } else if (j >= 3) {
                // 样本较少时用高周期 EMA15 斜率作为温和锚
                if (cClose > e15 && e15 > ema15[j - 2]) biasArr[i] = "LONG";
                else if (cClose < e15 && e15 < ema15[j - 2]) biasArr[i] = "SHORT";
            }
        }
        return biasArr;
    }

    /**
     * 计算《15m 滚仓导航指标》：4 道硬性趋势过滤门 + 极简信号 + 防守线 + 安全垫风控联动
     * @param {Array} candles enrichedCandles
     * @param {Object} opts { longPct, activePosAvg, activePosSide, supplyBlocks, demandBlocks }
     */
    window.compute15mRollingNavigator = function (candles, opts = {}) {
        const empty = {
            state: "CHOP_SLEEP",
            stateLabel: "震荡休眠 · 过滤杂音",
            shortStateLabel: "休眠",
            bias: "NEUTRAL",
            markers: [],
            trailingPoints: [],
            latestTrailing: null,
            hypotheticalBep: null,
            cushionPct: null,
            riskGuard: { level: "OK", isBlocked: false, headline: "", actionTip: "" },
            gates: {
                htfOk: false, htfBias: "NEUTRAL",
                maOk: false,
                chopOk: false, adx: null, er: null,
                roomOk: false, roomReason: "",
                allPass: false,
                stripText: "⚪1H ⚪均线 ⚪震荡 ⚪空间"
            },
            session: getBeijingSessionInfo(Math.floor(Date.now() / 1000)),
            trapAlert: null
        };
        if (!Array.isArray(candles) || candles.length < 30) return empty;

        const n = candles.length;
        const atrArr = calcAtr14(candles);
        const volMaArr = calcVolMa20(candles);
        const erArr = calcEfficiencyRatio(candles, 10);
        const adxArr = calcAdx14(candles, 14);
        const htfBiasArr = buildSynthesizedHtfBias(candles);
        const longPct = Number(opts.longPct) || 0;
        const supplyBlocks = Array.isArray(opts.supplyBlocks) ? opts.supplyBlocks : [];
        const demandBlocks = Array.isArray(opts.demandBlocks) ? opts.demandBlocks : [];

        let state = "CHOP_SLEEP"; // CHOP_SLEEP | TREND_START | ROLLING | TRIM_EXIT
        let bias = "NEUTRAL";     // LONG | SHORT | NEUTRAL
        let trendAnchorPrice = null;

        // 冷却与同向去重追踪器
        let lastStartBarIdx = -99;
        let lastStartBias = "NEUTRAL";
        let lastAddBarIdx = -99;
        let lastAddBias = "NEUTRAL";
        let addSeqInLeg = 0;
        let lastSidewaysBarIdx = -99;
        let lastExitBarIdx = -99;
        let lastRejectShortIdx = -99;
        let lastSupportLongIdx = -99;
        let pausedInCurrentLeg = false;

        // 流动性猎杀 / 孤立巨柱反转追踪器
        let bearTrapIdx = -99;
        let bearTrapHigh = 0;
        let bullTrapIdx = -99;
        let bullTrapLow = 0;

        const markers = [];
        const trailingPoints = [];

        const pushUniqueBarMarker = (barIdx, marker) => {
            if (markers.length > 0 && markers[markers.length - 1].time === marker.time) {
                return;
            }
            marker._barIdx = barIdx;
            markers.push(marker);
        };

        // 辅助：校验前方未消化 SMC 订单块空间是否充足 (> 1.5 * ATR)
        const checkSmcRoom = (barIdx, closePrice, atr, dir) => {
            if (!isFinite(atr) || atr <= 0) return true;
            const minRoom = 1.5 * atr;
            if (dir === "LONG") {
                for (const b of supplyBlocks) {
                    if (b.createdIdx !== undefined && b.createdIdx > barIdx) continue;
                    const bottom = Number(b.bottom);
                    if (isFinite(bottom) && bottom > closePrice && (bottom - closePrice) < minRoom) {
                        return false;
                    }
                }
            } else if (dir === "SHORT") {
                for (const b of demandBlocks) {
                    if (b.createdIdx !== undefined && b.createdIdx > barIdx) continue;
                    const top = Number(b.top);
                    if (isFinite(top) && top < closePrice && (closePrice - top) < minRoom) {
                        return false;
                    }
                }
            }
            return true;
        };

        let latestGates = empty.gates;

        for (let i = 20; i < n; i++) {
            const c = candles[i];
            const prev = candles[i - 1];
            const ema10 = c.ema10;
            const ema15 = c.ema15;
            const ma50 = c.ma50;
            const ema15Prev2 = candles[i - 2]?.ema15;
            const ma50Prev4 = candles[i - 4]?.ma50;
            const atr = atrArr[i];
            const volMa = volMaArr[i];
            const adx = adxArr[i];
            const prevAdx = adxArr[i - 1];
            const er = erArr[i];
            const htfBias = htfBiasArr[i];
            if (!isFinite(ema10) || !isFinite(ema15) || !isFinite(ma50) || !isFinite(atr) || atr <= 0) continue;

            const body = Math.abs(c.close - c.open);
            const upperWick = c.high - Math.max(c.open, c.close);
            const lowerWick = Math.min(c.open, c.close) - c.low;
            const emaGap = Math.abs(ema10 - ema15);
            const midGap = Math.abs(ema15 - ma50);
            const isVolShrunk = volMa > 0 && ((c.vol < volMa * 0.85) || (prev.vol < volMa * 0.85));
            const isVolAddOk = volMa > 0 && ((c.vol <= volMa * 1.05) || (prev.vol <= volMa * 1.05));
            const isVolExpanded = volMa > 0 && (c.vol > volMa * 1.15);
            const sess = getBeijingSessionInfo(c.time);

            // ========== 4 道硬性前置过滤门（Gate 1 ~ Gate 4） ==========
            // Gate 2：三均线秩序 + 开口拉开 + 斜率同向
            const ma50SlopeUp = isFinite(ma50Prev4) ? (ma50 > ma50Prev4) : true;
            const ma50SlopeDn = isFinite(ma50Prev4) ? (ma50 < ma50Prev4) : true;
            const ema15SlopeUp = isFinite(ema15Prev2) ? (ema15 > ema15Prev2) : true;
            const ema15SlopeDn = isFinite(ema15Prev2) ? (ema15 < ema15Prev2) : true;

            const maBullOk = ema10 > ema15 && ema15 > ma50 && ma50SlopeUp && ema15SlopeUp && emaGap >= 0.12 * atr && midGap >= 0.18 * atr;
            const maBearOk = ema10 < ema15 && ema15 < ma50 && ma50SlopeDn && ema15SlopeDn && emaGap >= 0.12 * atr && midGap >= 0.18 * atr;
            const candidateDir = maBullOk ? "LONG" : (maBearOk ? "SHORT" : "NEUTRAL");

            // Gate 1：1H 跨周期同向共振
            const htfBullOk = htfBias === "LONG";
            const htfBearOk = htfBias === "SHORT";
            const gate1Ok = (candidateDir === "LONG" && htfBullOk) || (candidateDir === "SHORT" && htfBearOk);

            // Gate 3：ADX(14) 强度(>=19.5) & 考夫曼效率系数 ER(10)(>=0.23)（兼顾阶梯顺势与横盘排杂）
            const adxValid = isFinite(adx);
            const erValid = isFinite(er);
            const isDeepChop = (adxValid && adx < 17 && erValid && er < 0.18) || (erValid && er < 0.15);
            const adxPass = adxValid && adx >= 19.5 && (!isFinite(prevAdx) || adx >= prevAdx - 0.25);
            const erPass = erValid && er >= 0.23;
            const gate3Ok = !isDeepChop && (adxPass || erPass);

            // Gate 4：SMC 空间距离 (>1.5 ATR) + 拥挤度 (<63%) + 排除 03:00-07:30 枯竭时段
            const smcRoomOk = candidateDir === "NEUTRAL" ? true : checkSmcRoom(i, c.close, atr, candidateDir);
            const crowdOk = !(candidateDir === "LONG" && longPct >= 63);
            const sessionOk = !sess.isDeadZone;
            const gate4Ok = smcRoomOk && crowdOk && sessionOk;

            const all4Bull = maBullOk && htfBullOk && gate3Ok && gate4Ok;
            const all4Bear = maBearOk && htfBearOk && gate3Ok && gate4Ok;

            // 记录最新一根 K 线的四门体检状态，供 HUD 实时渲染
            if (i === n - 1) {
                const roomReason = !sessionOk ? "枯竭段" : (!smcRoomOk ? "撞墙" : (!crowdOk ? "拥挤" : ""));
                const adxTxt = adxValid ? `A${Math.round(adx)}` : "A--";
                const erTxt = erValid ? `E${er.toFixed(2).replace(/^0/, "")}` : "E--";
                const g1 = (htfBias === "LONG" || htfBias === "SHORT") ? (gate1Ok ? "🟢1H" : (candidateDir === "NEUTRAL" ? (htfBias === "LONG" ? "🔵1H多" : "🟣1H空") : "🔴1H逆")) : "⚪1H平";
                const g2 = (maBullOk || maBearOk) ? "🟢均线" : "⚪均线";
                const g3 = gate3Ok ? `🟢${adxTxt}/${erTxt}` : `🔴震(${adxTxt}/${erTxt})`;
                const g4 = gate4Ok ? "🟢空间" : `🔴${roomReason || "受限"}`;
                latestGates = {
                    htfOk: gate1Ok,
                    htfBias,
                    maOk: maBullOk || maBearOk,
                    chopOk: gate3Ok,
                    adx: adxValid ? adx : null,
                    er: erValid ? er : null,
                    roomOk: gate4Ok,
                    roomReason,
                    allPass: all4Bull || all4Bear,
                    stripText: `${g1} ${g2} ${g3} ${g4}`
                };
            }

            // --- A. 孤立巨柱反转预警（防御性提示，保留显示，8根冷却） ---
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

            // --- B. 右侧黄金空/多点（严格遵守 MA50 多空领地隔离 + 1H 不逆势） ---
            const bearCrossActive = ema10 < ema15 && ema15 < ma50 && c.close < ma50 && c.close < ema15;
            if (i - bearTrapIdx >= 1 && i - bearTrapIdx <= 12 && bearCrossActive && htfBias !== "LONG" && sessionOk) {
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
            const bullCrossActive = ema10 > ema15 && ema15 > ma50 && c.close > ma50 && c.close > ema15;
            if (i - bullTrapIdx >= 1 && i - bullTrapIdx <= 12 && bullCrossActive && htfBias !== "SHORT" && sessionOk) {
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

            // --- C. 三段式滚仓状态机（严格受 4 重过滤器门禁约束） ---
            let hi5 = -Infinity, lo5 = Infinity;
            for (let k = i - 4; k <= i; k++) {
                hi5 = Math.max(hi5, candles[k].close);
                lo5 = Math.min(lo5, candles[k].close);
            }
            const isSideways = (emaGap < 0.15 * atr && (hi5 - lo5) < 1.15 * atr) || isDeepChop;

            // 阶段一：4 门全绿才允许发出趋势启动底仓信号
            if (all4Bull && bias !== "LONG") {
                bias = "LONG";
                state = "TREND_START";
                trendAnchorPrice = c.close;
                pausedInCurrentLeg = false;
                addSeqInLeg = 0;
                const canMarkStart = (lastStartBias !== "LONG" && (i - lastStartBarIdx >= 6)) || (i - lastStartBarIdx >= 12);
                if (canMarkStart) {
                    lastStartBarIdx = i;
                    lastStartBias = "LONG";
                    pushUniqueBarMarker(i, {
                        time: c.time,
                        position: "belowBar",
                        color: "#38bdf8",
                        shape: "circle",
                        text: "🚀底多",
                        _kind: "START",
                        _side: "LONG"
                    });
                }
            } else if (all4Bear && bias !== "SHORT") {
                bias = "SHORT";
                state = "TREND_START";
                trendAnchorPrice = c.close;
                pausedInCurrentLeg = false;
                addSeqInLeg = 0;
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

            // 阶段二：4 门全绿 + 回踩靠近 10/15 EMA + 量能<=1.05均量 + 实体<1.8ATR + 同向 3 根冷却（带序号 #1/#2）
            const addCooldownOk = (bias !== lastAddBias) || (i - lastAddBarIdx >= 3);
            if (!isSideways && bias === "LONG" && all4Bull && body < 1.8 * atr && addCooldownOk && (i - lastStartBarIdx >= 1)) {
                const nearEmaZone = (c.low <= ema10 + 0.25 * atr || prev.low <= ema10 + 0.25 * atr) && c.close >= ema15 - 0.15 * atr;
                const holdConfirm = c.close > c.open && c.close >= prev.low;
                if (nearEmaZone && holdConfirm && isVolAddOk) {
                    state = "ROLLING";
                    pausedInCurrentLeg = false;
                    lastAddBarIdx = i;
                    lastAddBias = "LONG";
                    addSeqInLeg += 1;
                    const r3l = Math.min(c.low, prev.low, candles[i - 2].low);
                    const alsoSupport = r3l <= Math.max(ema15 * 1.0015, ema15 + 0.1 * atr) && c.close > ema10;
                    pushUniqueBarMarker(i, {
                        time: c.time,
                        position: "belowBar",
                        color: "#10b981",
                        shape: "arrowUp",
                        text: alsoSupport ? `+多#${addSeqInLeg}·撑` : `+多#${addSeqInLeg}`,
                        _kind: "ADD",
                        _side: "LONG"
                    });
                }
            } else if (!isSideways && bias === "SHORT" && all4Bear && body < 1.8 * atr && addCooldownOk && (i - lastStartBarIdx >= 1)) {
                const nearEmaZone = (c.high >= ema10 - 0.25 * atr || prev.high >= ema10 - 0.25 * atr) && c.close <= ema15 + 0.15 * atr;
                const holdConfirm = c.close < c.open && c.close <= prev.high;
                if (nearEmaZone && holdConfirm && isVolAddOk) {
                    state = "ROLLING";
                    pausedInCurrentLeg = false;
                    lastAddBarIdx = i;
                    lastAddBias = "SHORT";
                    addSeqInLeg += 1;
                    const r3h = Math.max(c.high, prev.high, candles[i - 2].high);
                    const alsoReject = r3h >= Math.min(ema15 * 0.9985, ema15 - 0.1 * atr) && c.close < ema10;
                    pushUniqueBarMarker(i, {
                        time: c.time,
                        position: "aboveBar",
                        color: "#ef4444",
                        shape: "arrowDown",
                        text: alsoReject ? `+空#${addSeqInLeg}·压` : `+空#${addSeqInLeg}`,
                        _kind: "ADD",
                        _side: "SHORT"
                    });
                }
            }

            // 阶段三：走横休眠（单波仅提示 1 次，待新加仓或新趋势重置） / 放量破 15 EMA 或击穿防守线止盈
            const longTrailLine = ema15 - 0.5 * atr;
            const shortTrailLine = ema15 + 0.5 * atr;
            const breakLongExit = bias === "LONG" && ((c.close < ema15 && isVolExpanded) || c.close < longTrailLine);
            const breakShortExit = bias === "SHORT" && ((c.close > ema15 && isVolExpanded) || c.close > shortTrailLine);
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
                pausedInCurrentLeg = false;
                addSeqInLeg = 0;
            } else if ((bias === "LONG" || bias === "SHORT") && isSideways) {
                state = "TRIM_EXIT";
                if (!pausedInCurrentLeg && (i - lastSidewaysBarIdx >= 12)) {
                    lastSidewaysBarIdx = i;
                    pausedInCurrentLeg = true;
                    pushUniqueBarMarker(i, {
                        time: c.time,
                        position: bias === "LONG" ? "aboveBar" : "belowBar",
                        color: "#f59e0b",
                        shape: "square",
                        text: "⏸停",
                        _kind: "SIDEWAYS"
                    });
                }
            } else if (bias === "NEUTRAL" || (!all4Bull && !all4Bear && isDeepChop)) {
                state = "CHOP_SLEEP";
            }

            // --- D1. 反抽压制确认空（🎯压空 · 严格 MA50 下方领地隔离 + 6根冷却） ---
            const strictBearTerritory = c.close < ma50 && ema15 < ma50;
            const ma50DownOrFlat = isFinite(ma50Prev4) ? (ma50 <= ma50Prev4 * 1.0005) : true;
            const bearBackdropOk = strictBearTerritory && !isDeepChop && sessionOk && ema10 < ema15 && ma50DownOrFlat && htfBias !== "LONG";
            const recent3High = Math.max(c.high, prev.high, candles[i - 2].high);
            const hitSupplyBlock = supplyBlocks.some(b =>
                (b.createdIdx === undefined || b.createdIdx <= i) &&
                isFinite(Number(b.bottom)) && isFinite(Number(b.top)) &&
                recent3High >= Number(b.bottom) * 0.999 && recent3High <= Number(b.top) * 1.002
            );
            const touchedResistBand = recent3High >= Math.min(ema15 * 0.9985, ema15 - 0.1 * atr)
                && (recent3High <= ma50 * 1.009 || hitSupplyBlock);
            const bearRejectionCandle = c.close < c.open && c.close < ema10;
            const noBullVolThrust = !(volMa > 0 && prev.close > prev.open && prev.vol > volMa * 1.6);
            const pathAOk = bearBackdropOk && touchedResistBand && bearRejectionCandle && noBullVolThrust;

            // 路径 B 也严格锁死在 MA50 下方空头领地，彻底杜绝主升浪逆势摸顶做空
            const pathBOk = strictBearTerritory && (i - bearTrapIdx >= 2 && i - bearTrapIdx <= 10 && bearTrapHigh > 0)
                && c.high < bearTrapHigh
                && c.close < c.open
                && c.close < ema10;

            const rejectShortCooldownOk = (i - lastRejectShortIdx >= 6)
                && (lastAddBias !== "SHORT" || i - lastAddBarIdx >= 4)
                && (lastStartBias !== "SHORT" || i - lastStartBarIdx >= 4);
            if ((pathAOk || pathBOk) && rejectShortCooldownOk) {
                lastRejectShortIdx = i;
                pushUniqueBarMarker(i, {
                    time: c.time,
                    position: "aboveBar",
                    color: "#be185d",
                    shape: "arrowDown",
                    text: "🎯压空",
                    _kind: "REJECT_SHORT",
                    _side: "SHORT"
                });
            }

            // --- D2. 对称回踩支撑确认多（🎯撑多 · 严格 MA50 上方多头领地 + 6根冷却） ---
            const strictBullTerritory = c.close > ma50 && ema15 > ma50;
            const ma50UpOrFlat = isFinite(ma50Prev4) ? (ma50 >= ma50Prev4 * 0.9995) : true;
            const bullBackdropOk = strictBullTerritory && !isDeepChop && sessionOk && htfBias === "LONG" && ema10 > ema15 && ma50UpOrFlat;
            const recent3Low = Math.min(c.low, prev.low, candles[i - 2].low);
            const hitDemandBlock = demandBlocks.some(b =>
                (b.createdIdx === undefined || b.createdIdx <= i) &&
                isFinite(Number(b.bottom)) && isFinite(Number(b.top)) &&
                recent3Low <= Number(b.top) * 1.001 && recent3Low >= Number(b.bottom) * 0.998
            );
            const touchedSupportBand = recent3Low <= Math.max(ema15 * 1.0015, ema15 + 0.1 * atr)
                && (recent3Low >= ma50 * 0.991 || hitDemandBlock);
            const bullReclaimCandle = c.close > c.open && c.close > ema10;
            const noBearVolThrust = !(volMa > 0 && prev.close < prev.open && prev.vol > volMa * 1.6);
            const supportLongCooldownOk = (i - lastSupportLongIdx >= 6)
                && (lastAddBias !== "LONG" || i - lastAddBarIdx >= 4)
                && (lastStartBias !== "LONG" || i - lastStartBarIdx >= 4);
            if (bullBackdropOk && touchedSupportBand && bullReclaimCandle && noBearVolThrust && supportLongCooldownOk) {
                lastSupportLongIdx = i;
                pushUniqueBarMarker(i, {
                    time: c.time,
                    position: "belowBar",
                    color: "#0d9488",
                    shape: "arrowUp",
                    text: "🎯撑多",
                    _kind: "SUPPORT_LONG",
                    _side: "LONG"
                });
            }

            // 动态追踪防守线：仅在有效持仓偏向期间绘制 15 EMA ± 0.5 * ATR(14)
            if (bias === "LONG") {
                trailingPoints.push({ time: c.time, value: ema15 - 0.5 * atr, bias: "LONG" });
            } else if (bias === "SHORT") {
                trailingPoints.push({ time: c.time, value: ema15 + 0.5 * atr, bias: "SHORT" });
            }
        }

        // 若最新一根 K 线四门未全通且不在破位止盈中，强制切入震荡休眠/门禁拦截状态
        if (!latestGates.allPass && state !== "TRIM_EXIT") {
            state = "CHOP_SLEEP";
        }

        // 计算最新一根的护栏指标
        const lastBar = candles[n - 1];
        const latestSess = getBeijingSessionInfo(lastBar.time);
        const latestTrailObj = trailingPoints.length ? trailingPoints[trailingPoints.length - 1] : null;

        const hasRealActivePos = Number(opts.activePosAvg) > 0 && (opts.activePosSide === "LONG" || opts.activePosSide === "SHORT");
        let baseAvg = Number(opts.activePosAvg) || trendAnchorPrice || 0;
        let effectiveBias = opts.activePosSide || bias;
        let hypotheticalBep = null;
        let cushionPct = null;
        let rawPnlPct = null;
        if (baseAvg > 0 && (effectiveBias === "LONG" || effectiveBias === "SHORT")) {
            const blended = (baseAvg * 1.0 + lastBar.close * 0.2) / 1.2;
            const isLong = effectiveBias === "LONG";
            hypotheticalBep = blended * (isLong ? 1.002 : 0.998);
            cushionPct = lastBar.close > 0
                ? ((isLong ? (lastBar.close - hypotheticalBep) : (hypotheticalBep - lastBar.close)) / lastBar.close) * 100
                : 0;
            rawPnlPct = ((isLong ? (lastBar.close - baseAvg) : (baseAvg - lastBar.close)) / baseAvg) * 100;
        }

        const nearDefense = latestTrailObj && lastBar.close > 0
            ? (Math.abs(lastBar.close - latestTrailObj.value) / lastBar.close < 0.0045)
            : false;

        // 静态文字纪律提醒（仅实盘持仓触及无利回撤临界时静默亮出，不弹窗不闪烁）
        let disciplineNote = "";
        if (hasRealActivePos && rawPnlPct !== null) {
            if (rawPnlPct <= 0.15) {
                disciplineNote = "⚠️ 回撤无利·建议全平防上头";
            } else if (rawPnlPct < 0.8 && nearDefense) {
                disciplineNote = "🛡️ 浮盈较薄·贴近防线留意锁利";
            }
        }

        // 安全垫红线与状态机联动风控评估
        const cStr = cushionPct !== null ? `${cushionPct >= 0 ? "+" : ""}${cushionPct.toFixed(2)}%` : "--";
        let riskGuard = { level: "OK", isBlocked: false, headline: "", actionTip: "", disciplineNote };
        if (cushionPct !== null) {
            if (cushionPct < 0) {
                riskGuard = {
                    level: "LOCKED_NEG",
                    isBlocked: true,
                    headline: `⛔ 垫穿 ${cStr} · 严禁加仓`,
                    actionTip: disciplineNote || "仅守防线或减仓",
                    disciplineNote
                };
            } else if (cushionPct < 1.5) {
                riskGuard = {
                    level: "LOCKED_THIN",
                    isBlocked: true,
                    headline: `🚨 垫薄 ${cStr} · 暂停加仓`,
                    actionTip: disciplineNote || "低于1.5%红线",
                    disciplineNote
                };
            } else if (cushionPct < 2.5) {
                riskGuard = {
                    level: "CAUTION",
                    isBlocked: false,
                    headline: "",
                    actionTip: `缓冲偏窄 ${cStr}`,
                    disciplineNote
                };
            }
        }

        const finalMarkers = markers.filter(m => {
            if (riskGuard.isBlocked && m._barIdx >= n - 2 && (m._kind === "ADD" || m._kind === "START" || m._kind === "REJECT_SHORT" || m._kind === "SUPPORT_LONG") && m._side === effectiveBias) {
                return false;
            }
            return true;
        }).map(m => {
            const bar = candles[m._barIdx];
            return {
                time: m.time,
                position: m.position,
                color: m.color,
                shape: m.shape,
                text: m.text,
                kind: m._kind || "",
                side: m._side || "",
                anchorPrice: bar ? (m.position === "aboveBar" ? bar.high : bar.low) : null
            };
        });

        const stateNameMap = {
            TREND_START: bias === "LONG" ? "多头启动 · 4门全绿" : "空头启动 · 4门全绿",
            ROLLING: bias === "LONG" ? "顺势滚多 · 4门全绿" : "顺势滚空 · 4门全绿",
            TRIM_EXIT: "走横停火 / 锁利",
            CHOP_SLEEP: "💤 震荡休眠 · 过滤无效行情"
        };
        const shortStateMap = {
            TREND_START: bias === "LONG" ? "多启" : "空启",
            ROLLING: bias === "LONG" ? "滚多" : "滚空",
            TRIM_EXIT: "停火",
            CHOP_SLEEP: "休眠"
        };

        const trapAlert = (n - 1 - bearTrapIdx <= 10 && bearTrapHigh > 0)
            ? { side: "SHORT", slRef: bearTrapHigh, text: `⚠️假多监测 · 强高SL ${bearTrapHigh.toFixed(1)}` }
            : ((n - 1 - bullTrapIdx <= 10 && bullTrapLow > 0)
                ? { side: "LONG", slRef: bullTrapLow, text: `⚠️假空监测 · 强低SL ${bullTrapLow.toFixed(1)}` }
                : null);

        return {
            state,
            stateLabel: stateNameMap[state] || "💤 震荡休眠",
            shortStateLabel: shortStateMap[state] || "休眠",
            bias,
            markers: finalMarkers.slice(-45),
            trailingPoints,
            latestTrailing: (bias !== "NEUTRAL" && latestTrailObj && latestTrailObj.time === lastBar.time) ? latestTrailObj.value : null,
            hypotheticalBep,
            cushionPct,
            riskGuard,
            gates: latestGates,
            session: latestSess,
            trapAlert
        };
    };
})();
