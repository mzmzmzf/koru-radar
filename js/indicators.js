// 纯指标与策略信号计算模块 (由 index.html 拆分，兼容 file:// 与 http(s)://)

function computeBreakout33AndSmc(candles) {
    const n = candles.length;
    const k10 = 2 / 11;
    const k15 = 2 / 16;
    const volMult = 1.5;
    const lookback = 5;

    const enriched = [];
    let e10 = candles[0].close;
    let e15 = candles[0].close;

    for (let i = 0; i < n; i++) {
        const c = candles[i];
        if (i > 0) {
            e10 = c.close * k10 + e10 * (1 - k10);
            e15 = c.close * k15 + e15 * (1 - k15);
        }
        let ma50 = null;
        if (i >= 49) {
            let s = 0;
            for (let j = i - 49; j <= i; j++) s += candles[j].close;
            ma50 = s / 50;
        }
        let volMa = null;
        if (i >= 19) {
            let vs = 0;
            for (let j = i - 19; j <= i; j++) vs += candles[j].vol;
            volMa = vs / 20;
        }
        enriched.push({ ...c, ema10: e10, ema15: e15, ma50, volMa });
    }

    const markers = [];
    let latestSignalText = "暂无新突破信号 · 均线跟踪中";
    let latestSignalColor = "var(--neon-cyan)";
    const dec = getActiveSymbolDecimals(candles[candles.length - 1]?.close);

    // 100% 对齐 LuxAlgo Smart Money Concepts (Internal Structure size=5 + ATR 波动率过滤 + High/Low Mitigation)
    const parsedHighs = new Array(n);
    const parsedLows = new Array(n);
    let atr200 = 0;
    for (let i = 0; i < n; i++) {
        const c = enriched[i];
        const tr = i === 0
            ? (c.high - c.low)
            : Math.max(c.high - c.low, Math.abs(c.high - enriched[i - 1].close), Math.abs(c.low - enriched[i - 1].close));
        atr200 = i === 0 ? tr : (i < 200 ? ((atr200 * i + tr) / (i + 1)) : ((atr200 * 199 + tr) / 200));
        const highVolBar = (c.high - c.low) >= (2 * atr200);
        parsedHighs[i] = highVolBar ? c.low : c.high;
        parsedLows[i] = highVolBar ? c.high : c.low;
    }

    const swingLen = 5;
    const swingHighs = [];
    const swingLows = [];
    let marketBias = 0; // 1 = BULLISH, -1 = BEARISH
    const biasAtBar = new Int8Array(n);
    let activeSH = null;
    let activeSL = null;
    let shBroken = false;
    let slBroken = false;
    let curLeg = 0;
    let prevLeg = 0;
    const allSupplyBlocks = [];
    const allDemandBlocks = [];
    const structureLines = [];

    for (let idx = swingLen; idx < n; idx++) {
        const bar = enriched[idx];
        const pivotIdx = idx - swingLen;
        let maxNext = -Infinity;
        let minNext = Infinity;
        for (let k = pivotIdx + 1; k <= idx; k++) {
            if (enriched[k].high > maxNext) maxNext = enriched[k].high;
            if (enriched[k].low < minNext) minNext = enriched[k].low;
        }
        const newLegHigh = enriched[pivotIdx].high > maxNext;
        const newLegLow = enriched[pivotIdx].low < minNext;
        if (newLegHigh) curLeg = 0;
        else if (newLegLow) curLeg = 1;

        const legDiff = curLeg - prevLeg;
        if (legDiff === 1) {
            activeSL = { idx: pivotIdx, time: enriched[pivotIdx].time, price: enriched[pivotIdx].low };
            slBroken = false;
            swingLows.push(activeSL);
        } else if (legDiff === -1) {
            activeSH = { idx: pivotIdx, time: enriched[pivotIdx].time, price: enriched[pivotIdx].high };
            shBroken = false;
            swingHighs.push(activeSH);
        }
        prevLeg = curLeg;

        // 向上突破前内部高点 -> Bullish BOS / CHoCH + 按 LuxAlgo parsedLows.min() 取需求订单块
        if (activeSH && !shBroken && bar.close > activeSH.price) {
            shBroken = true;
            const labelType = marketBias === -1 ? "CHoCH" : "BOS";
            marketBias = 1;
            structureLines.push({
                type: labelType,
                direction: "bull",
                startTime: activeSH.time,
                endTime: bar.time,
                price: activeSH.price
            });

            const searchStart = Math.max(0, activeSH.idx);
            let bestIdx = searchStart;
            let minParsedLow = Infinity;
            for (let k = searchStart; k < idx; k++) {
                if (parsedLows[k] < minParsedLow) {
                    minParsedLow = parsedLows[k];
                    bestIdx = k;
                }
            }
            allDemandBlocks.push({
                side: "demand",
                startTime: enriched[bestIdx].time,
                createdIdx: idx,
                top: parsedHighs[bestIdx],
                bottom: parsedLows[bestIdx],
                mitigated: false
            });

            // 当发生空转多 CHoCH 时，若 activeSH 位于反弹中继（导致 searchStart 跨过了真底），回溯整段下跌波段补全极值底部需求块
            if (labelType === "CHoCH") {
                const legLookback = Math.max(0, idx - 48);
                let originIdx = -1;
                let minOriginLow = Infinity;
                for (let k = legLookback; k < searchStart; k++) {
                    if (enriched[k].low < minOriginLow) {
                        minOriginLow = enriched[k].low;
                        originIdx = k;
                    }
                }
                if (originIdx >= 0 && minOriginLow < parsedLows[bestIdx] * 0.992) {
                    let obOrigin = enriched[originIdx];
                    for (let k = originIdx; k >= Math.max(legLookback, originIdx - 2); k--) {
                        if (enriched[k].close < enriched[k].open) {
                            obOrigin = enriched[k];
                            break;
                        }
                    }
                    let alreadyMitigated = false;
                    for (let k = originIdx + 1; k <= idx; k++) {
                        if (enriched[k].low < obOrigin.low) {
                            alreadyMitigated = true;
                            break;
                        }
                    }
                    const dupOrigin = allDemandBlocks.some(b => Math.abs(b.bottom - obOrigin.low) / Math.max(1e-9, obOrigin.low) < 0.0015);
                    if (!alreadyMitigated && !dupOrigin) {
                        allDemandBlocks.push({
                            side: "demand",
                            startTime: obOrigin.time,
                            createdIdx: idx,
                            top: Math.max(obOrigin.open, obOrigin.close),
                            bottom: obOrigin.low,
                            mitigated: false
                        });
                    }
                }
            }
        }

        // 向下跌破前内部低点 -> Bearish BOS / CHoCH + 按 LuxAlgo parsedHighs.max() 取供给订单块
        if (activeSL && !slBroken && bar.close < activeSL.price) {
            slBroken = true;
            const labelType = marketBias === 1 ? "CHoCH" : "BOS";
            marketBias = -1;
            structureLines.push({
                type: labelType,
                direction: "bear",
                startTime: activeSL.time,
                endTime: bar.time,
                price: activeSL.price
            });

            const searchStart = Math.max(0, activeSL.idx);
            let bestIdx = searchStart;
            let maxParsedHigh = -Infinity;
            for (let k = searchStart; k < idx; k++) {
                if (parsedHighs[k] > maxParsedHigh) {
                    maxParsedHigh = parsedHighs[k];
                    bestIdx = k;
                }
            }
            allSupplyBlocks.push({
                side: "supply",
                startTime: enriched[bestIdx].time,
                createdIdx: idx,
                top: parsedHighs[bestIdx],
                bottom: parsedLows[bestIdx],
                mitigated: false
            });
        }

        // 订单块消化检测 (对齐 LuxAlgo 默认 High/Low Mitigation)
        for (let s = 0; s < allSupplyBlocks.length; s++) {
            const sb = allSupplyBlocks[s];
            if (!sb.mitigated && idx > sb.createdIdx && bar.high > sb.top) {
                sb.mitigated = true;
            }
        }
        for (let d = 0; d < allDemandBlocks.length; d++) {
            const db = allDemandBlocks[d];
            if (!db.mitigated && idx > db.createdIdx && bar.low < db.bottom) {
                db.mitigated = true;
            }
        }
        biasAtBar[idx] = marketBias;
    }

    const useResonanceFilter = typeof filterBreakoutBySmcCvd !== "undefined" && filterBreakoutBySmcCvd;
    const cvdSeries = useResonanceFilter
        ? computeGimelfarbCvdSeries(enriched, typeof cvdDailyReset !== "undefined" ? cvdDailyReset : false)
        : null;
    let filteredOutCount = 0;

    for (let i = 50; i < n; i++) {
        const cur = enriched[i];
        const prev = enriched[i - 1];
        if (!cur.ma50 || !prev.ma50 || !cur.volMa) continue;

        let highestPrev5 = -Infinity;
        let lowestPrev5 = Infinity;
        for (let k = i - lookback; k < i; k++) {
            if (enriched[k].high > highestPrev5) highestPrev5 = enriched[k].high;
            if (enriched[k].low < lowestPrev5) lowestPrev5 = enriched[k].low;
        }

        const crossOver10_15 = prev.ema10 <= prev.ema15 && cur.ema10 > cur.ema15;
        const crossUnder10_15 = prev.ema10 >= prev.ema15 && cur.ema10 < cur.ema15;
        const crossOver10_50 = prev.ema10 <= prev.ma50 && cur.ema10 > cur.ma50;
        const crossUnder10_50 = prev.ema10 >= prev.ma50 && cur.ema10 < cur.ma50;

        let greenSignal = (prev.ema10 < prev.ma50 && prev.ema15 < prev.ma50) && crossOver10_15 && cur.vol > cur.volMa;
        let finalBlueSignal = crossOver10_50 && cur.close > cur.ma50 && cur.vol > cur.volMa * volMult && cur.close > highestPrev5;

        let redSignal = (prev.ema10 > prev.ma50 && prev.ema15 > prev.ma50) && crossUnder10_15 && cur.vol > cur.volMa;
        let finalPurpleSignal = crossUnder10_50 && cur.close < cur.ma50 && cur.vol > cur.volMa * volMult && cur.close < lowestPrev5;

        if (useResonanceFilter && (greenSignal || finalBlueSignal || redSignal || finalPurpleSignal)) {
            const barBias = biasAtBar[i];
            const cvdRow = cvdSeries && cvdSeries[i] ? cvdSeries[i] : null;
            let bullCvdDiv = false;
            let bearCvdDiv = false;
            if (cvdRow && i >= 12) {
                let winHigh = -Infinity, winLow = Infinity;
                let winCvdMax = -Infinity, winCvdMin = Infinity;
                for (let k = i - 12; k < i; k++) {
                    if (enriched[k].high > winHigh) winHigh = enriched[k].high;
                    if (enriched[k].low < winLow) winLow = enriched[k].low;
                    if (cvdSeries[k].cvd > winCvdMax) winCvdMax = cvdSeries[k].cvd;
                    if (cvdSeries[k].cvd < winCvdMin) winCvdMin = cvdSeries[k].cvd;
                }
                const bullPriceNewHighDiv = cur.high >= winHigh && cvdRow.cvd < winCvdMax;
                const bullFlowWeak = cvdRow.sma28 !== null && cvdRow.cvd < cvdRow.sma28 && cvdRow.delta < 0;
                bullCvdDiv = bullPriceNewHighDiv || bullFlowWeak;

                const bearPriceNewLowDiv = cur.low <= winLow && cvdRow.cvd > winCvdMin;
                const bearFlowStrong = cvdRow.sma28 !== null && cvdRow.cvd > cvdRow.sma28 && cvdRow.delta > 0;
                bearCvdDiv = bearPriceNewLowDiv || bearFlowStrong;
            }

            if (greenSignal && (barBias === -1 || bullCvdDiv)) { greenSignal = false; filteredOutCount++; }
            if (finalBlueSignal && (barBias === -1 || bullCvdDiv)) { finalBlueSignal = false; filteredOutCount++; }
            if (redSignal && (barBias === 1 || bearCvdDiv)) { redSignal = false; filteredOutCount++; }
            if (finalPurpleSignal && (barBias === 1 || bearCvdDiv)) { finalPurpleSignal = false; filteredOutCount++; }
        }

        if (greenSignal) {
            markers.push({ time: cur.time, position: "belowBar", color: "#10b981", shape: "arrowUp", text: "▲多集结" });
            latestSignalText = `🟢 龙抬头-多头集结 (${formatBeijingTime(cur.time, false)})`;
            latestSignalColor = "#34d399";
        }
        if (finalBlueSignal) {
            markers.push({ time: cur.time, position: "belowBar", color: "#3b82f6", shape: "arrowUp", text: `多:${cur.ma50.toFixed(dec)}` });
            latestSignalText = `🔵 蓝箭破阵-多头起飞 @ ${cur.ma50.toFixed(dec)}`;
            latestSignalColor = "#60a5fa";
        }
        if (redSignal) {
            markers.push({ time: cur.time, position: "aboveBar", color: "#ef4444", shape: "arrowDown", text: "▼空集结" });
            latestSignalText = `🔴 鸣金兵败-空头集结 (${formatBeijingTime(cur.time, false)})`;
            latestSignalColor = "#f87171";
        }
        if (finalPurpleSignal) {
            markers.push({ time: cur.time, position: "aboveBar", color: "#a855f7", shape: "arrowDown", text: `空:${cur.ma50.toFixed(dec)}` });
            latestSignalText = `🟣 紫箭坠阵-空头开仓 @ ${cur.ma50.toFixed(dec)}`;
            latestSignalColor = "#c084fc";
        }
    }

    if (useResonanceFilter && filteredOutCount > 0 && latestSignalText === "暂无新突破信号 · 均线跟踪中") {
        latestSignalText = `🛡️ 共振过滤生效 · 已屏蔽 ${filteredOutCount} 个逆势/背离信号`;
    }

    const supplyBlocks = allSupplyBlocks.filter(b => !b.mitigated).slice(-5);
    const demandBlocks = allDemandBlocks.filter(b => !b.mitigated).slice(-5);
    const recentStructures = structureLines.slice(-14);

    const lastSH = swingHighs[swingHighs.length - 1];
    const lastSL = swingLows[swingLows.length - 1];
    const lastBar = enriched[n - 1];
    const nearestSupply = supplyBlocks[supplyBlocks.length - 1];
    const nearestDemand = demandBlocks[demandBlocks.length - 1];

    let smcState = "震荡区间整固";
    if (nearestSupply && nearestDemand) {
        smcState = `供给块 ${nearestSupply.bottom.toFixed(dec)}~${nearestSupply.top.toFixed(dec)} | 需求块 ${nearestDemand.bottom.toFixed(dec)}~${nearestDemand.top.toFixed(dec)}`;
    } else if (nearestSupply) {
        smcState = `上方供给阻力块: ${nearestSupply.bottom.toFixed(dec)} ~ ${nearestSupply.top.toFixed(dec)}`;
    } else if (nearestDemand) {
        smcState = `下方需求支撑块: ${nearestDemand.bottom.toFixed(dec)} ~ ${nearestDemand.top.toFixed(dec)}`;
    } else if (lastSH && lastSL) {
        smcState = `SMC箱体: 强底 ${lastSL.price.toFixed(dec)} ~ 弱顶 ${lastSH.price.toFixed(dec)}`;
    }

    if (lastSH && lastBar.close > lastSH.price) {
        markers.push({ time: lastBar.time, position: "aboveBar", color: "#06b6d4", shape: "circle", text: "BOS↑" });
    } else if (lastSL && lastBar.close < lastSL.price) {
        markers.push({ time: lastBar.time, position: "belowBar", color: "#f59e0b", shape: "circle", text: "BOS↓" });
    }

    markers.sort((a, b) => a.time - b.time);
    return {
        enriched,
        markers,
        latestSignalText,
        latestSignalColor,
        smcState,
        lastSH,
        lastSL,
        supplyBlocks,
        demandBlocks,
        structureLines: recentStructures,
        marketBias
    };
}


function computeGimelfarbCvdSeries(candles, resetDaily) {
    const n = candles.length;
    const out = [];
    let cumCvd = 0;
    let prevDay = null;

    for (let i = 0; i < n; i++) {
        const c = candles[i];
        const prevC = i > 0 ? candles[i - 1].close : c.open;
        const dayKey = getBeijingDayKey(c.time);
        if (resetDaily && prevDay !== null && dayKey !== prevDay) {
            cumCvd = 0;
        }
        prevDay = dayKey;

        let bp = 0, sp = 0;
        if (c.close < c.open) {
            bp = prevC < c.open ? Math.max(c.high - prevC, c.close - c.low) : Math.max(c.high - c.open, c.close - c.low);
            sp = prevC > c.open ? Math.max(prevC - c.open, c.high - c.low) : (c.high - c.low);
        } else if (c.close > c.open) {
            bp = prevC > c.open ? (c.high - c.low) : Math.max(c.open - prevC, c.high - c.low);
            sp = prevC > c.open ? Math.max(prevC - c.low, c.high - c.close) : Math.max(c.open - c.low, c.high - c.close);
        } else {
            if (c.high - c.close > c.close - c.low) {
                bp = prevC < c.open ? Math.max(c.high - prevC, c.close - c.low) : (c.high - c.open);
                sp = prevC > c.open ? Math.max(prevC - c.open, c.high - c.low) : (c.high - c.low);
            } else if (c.high - c.close < c.close - c.low) {
                bp = prevC > c.open ? (c.high - c.low) : Math.max(c.open - prevC, c.high - c.low);
                sp = prevC > c.open ? Math.max(prevC - c.low, c.high - c.close) : (c.open - c.low);
            } else {
                bp = prevC > c.open ? Math.max(c.high - c.open, c.close - c.low) : (prevC < c.open ? Math.max(c.open - prevC, c.high - c.low) : (c.high - c.low));
                sp = prevC > c.open ? Math.max(prevC - c.open, c.high - c.low) : (prevC < c.open ? Math.max(c.open - prevC, c.high - c.low) : (c.high - c.low));
            }
        }

        const tp = bp + sp;
        const bpv = tp > 0 ? (bp / tp) * c.vol : c.vol * 0.5;
        const spv = tp > 0 ? (sp / tp) * c.vol : c.vol * 0.5;
        const delta = Math.abs(bpv) - Math.abs(spv);
        cumCvd += delta;

        let sma28 = null;
        if (i >= 27) {
            let sum = 0;
            for (let j = i - 27; j < i; j++) sum += out[j].cvd;
            sum += cumCvd;
            sma28 = sum / 28;
        }

        out.push({
            mode: "cvd",
            time: c.time,
            delta,
            cvd: cumCvd,
            sma28
        });
    }
    return out;
}


function computeWilderRsiArray(values, period = 14) {
    const n = values.length;
    const rsi = new Array(n).fill(null);
    if (n <= period) return rsi;

    let gainSum = 0, lossSum = 0;
    for (let i = 1; i <= period; i++) {
        const diff = values[i] - values[i - 1];
        if (diff >= 0) gainSum += diff;
        else lossSum -= diff;
    }
    let avgGain = gainSum / period;
    let avgLoss = lossSum / period;
    rsi[period] = avgLoss === 0 ? 100 : (100 - 100 / (1 + avgGain / avgLoss));

    for (let i = period + 1; i < n; i++) {
        const diff = values[i] - values[i - 1];
        const g = diff > 0 ? diff : 0;
        const l = diff < 0 ? -diff : 0;
        avgGain = (avgGain * (period - 1) + g) / period;
        avgLoss = (avgLoss * (period - 1) + l) / period;
        rsi[i] = avgLoss === 0 ? 100 : (100 - 100 / (1 + avgGain / avgLoss));
    }
    return rsi;
}


function computeMacdSeries(candles, fast = 12, slow = 26, signal = 9) {
    if (!Array.isArray(candles) || !candles.length) return [];
    const kFast = 2 / (fast + 1);
    const kSlow = 2 / (slow + 1);
    const kSig = 2 / (signal + 1);
    let emaFast = candles[0].close;
    let emaSlow = candles[0].close;
    let dea = 0;
    const out = [];
    for (let i = 0; i < candles.length; i++) {
        const close = candles[i].close;
        if (i > 0) {
            emaFast = close * kFast + emaFast * (1 - kFast);
            emaSlow = close * kSlow + emaSlow * (1 - kSlow);
        }
        const dif = emaFast - emaSlow;
        dea = i === 0 ? dif : (dif * kSig + dea * (1 - kSig));
        const hist = dif - dea;
        const prevHist = i > 0 ? out[i - 1].hist : hist;
        let histColor;
        if (hist >= 0) {
            histColor = hist >= prevHist ? "#26a69a" : "rgba(38, 166, 154, 0.42)";
        } else {
            histColor = hist <= prevHist ? "#ef5350" : "rgba(239, 83, 80, 0.42)";
        }
        out.push({ time: candles[i].time, dif, dea, hist, histColor, divState: "" });
    }

    // 检测每根 K 线近 40 根窗口内的 MACD 顶/底背离（基于局部波段高/低点与 DIF 对比）
    const pivR = 3;
    const peakIdxs = [];
    const troughIdxs = [];
    for (let i = pivR; i < candles.length - pivR; i++) {
        let isPeak = true, isTrough = true;
        for (let k = i - pivR; k <= i + pivR; k++) {
            if (k === i) continue;
            if (candles[k].high >= candles[i].high) isPeak = false;
            if (candles[k].low <= candles[i].low) isTrough = false;
        }
        if (isPeak) peakIdxs.push(i);
        if (isTrough) troughIdxs.push(i);
    }
    for (let i = 26; i < candles.length; i++) {
        let div = "";
        const recentPeaks = peakIdxs.filter(p => p <= i - 1 && p >= i - 40);
        if (recentPeaks.length >= 2) {
            const p2 = recentPeaks[recentPeaks.length - 1];
            const p1 = recentPeaks[recentPeaks.length - 2];
            if (i - p2 <= 14 && candles[p2].high > candles[p1].high && out[p2].dif < out[p1].dif && out[p1].dif > 0) {
                div = "顶背离";
            }
        }
        if (!div) {
            const recentTroughs = troughIdxs.filter(t => t <= i - 1 && t >= i - 40);
            if (recentTroughs.length >= 2) {
                const t2 = recentTroughs[recentTroughs.length - 1];
                const t1 = recentTroughs[recentTroughs.length - 2];
                if (i - t2 <= 14 && candles[t2].low < candles[t1].low && out[t2].dif > out[t1].dif && out[t1].dif < 0) {
                    div = "底背离";
                }
            }
        }
        out[i].divState = div;
    }
    return out;
}


function computeAdaptiveTrailSeries(candles, atrLen = 14, mult = 2.6) {
    const n = candles.length;
    if (n < 5) return [];
    const tr = new Array(n).fill(0);
    const atr = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
        const c = candles[i];
        if (i === 0) {
            tr[i] = c.high - c.low;
            atr[i] = tr[i];
        } else {
            const pc = candles[i - 1].close;
            tr[i] = Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc));
            atr[i] = ((atr[i - 1] * (atrLen - 1)) + tr[i]) / atrLen;
        }
    }

    const out = [];
    let dir = 1; // 1 = 多头绿带, -1 = 空头橙带
    let trail = candles[0].close - atr[0] * mult;

    for (let i = 0; i < n; i++) {
        const c = candles[i];
        const bandDist = Math.max(atr[i] * mult, c.close * 0.002);
        const bufferDist = atr[i] * 0.85;

        if (dir === 1) {
            const candidate = c.close - bandDist;
            trail = Math.max(trail, candidate);
            if (c.close < trail) {
                dir = -1;
                trail = c.close + bandDist;
            }
        } else {
            const candidate = c.close + bandDist;
            trail = Math.min(trail, candidate);
            if (c.close > trail) {
                dir = 1;
                trail = c.close - bandDist;
            }
        }

        const edge = dir === 1 ? (trail - bufferDist) : (trail + bufferDist);
        out.push({
            time: c.time,
            dir,
            trail,
            edge
        });
    }
    return out;
}


function computeEmaFromSeries(arr, period) {
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const k = 2 / (period + 1);
    let ema = Number(arr[0]);
    for (let i = 1; i < arr.length; i++) {
        ema = Number(arr[i]) * k + ema * (1 - k);
    }
    return ema;
}


function calcLocalStrategy(closes, currentP) {
    if (!closes || closes.length < 50) return null;
    const ma50 = closes.slice(-50).reduce((a, b) => a + b, 0) / 50.0;
    const calcEma = (arr, period) => {
        const k = 2.0 / (period + 1);
        let e = arr[0];
        for (let i = 1; i < arr.length; i++) e = arr[i] * k + e * (1.0 - k);
        return e;
    };
    const ema10 = calcEma(closes, 10), ema15 = calcEma(closes, 15);
    const diffPct = Math.abs(ema10 - ema15) / ema10;

    let bias = "NEUTRAL", title = "", desc = "", t1 = 0, t2 = 0, t3 = 0, sl = 0, tp = 0;
    if (diffPct < 0.0008) {
        bias = "NEUTRAL"; title = "⏸️ 均线走平缠绕 · 强制静默观望";
        desc = `10 EMA (${ema10.toFixed(1)}) 与 15 EMA (${ema15.toFixed(1)}) 高度粘合，严禁在磨损区开单。`;
    } else if (ema10 < ema15) {
        bias = "SHORT"; title = "🔴 顺势偏空 · 剔除做多选项";
        desc = `10 EMA (${ema10.toFixed(1)}) 死叉 15 EMA (${ema15.toFixed(1)})，50 MA (${ma50.toFixed(1)}) 强压。逢高分批做空。`;
        t1 = Math.round(Math.max(ema10, currentP * 1.006)); t2 = Math.round(Math.max(ema15, currentP * 1.015)); t3 = Math.round(Math.max(ma50, currentP * 1.026));
        sl = Math.round(Math.max(ma50 * 1.012, currentP * 1.035, t3 * 1.012)); tp = Math.round(currentP * 0.958);
    } else {
        bias = "LONG"; title = "🟢 顺势偏多 · 剔除做空选项";
        desc = `10 EMA (${ema10.toFixed(1)}) 金叉 15 EMA (${ema15.toFixed(1)})，运行于 50 MA 之上。缩量回踩分批做多。`;
        t1 = Math.round(Math.min(ema10, currentP * 0.994)); t2 = Math.round(Math.min(ema15, currentP * 0.985)); t3 = Math.round(Math.min(ma50, currentP * 0.974));
        sl = Math.round(Math.min(ma50 * 0.988, currentP * 0.965, t3 * 0.988)); tp = Math.round(currentP * 1.042);
    }
    return { ema10: Math.round(ema10 * 10) / 10, ema15: Math.round(ema15 * 10) / 10, ma50: Math.round(ma50 * 10) / 10, bias, title, desc, tier1: t1, tier2: t2, tier3: t3, sl, tp };
}


