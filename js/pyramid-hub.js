// 独立大页面：全品种动态滚仓沙盒 & 仓位安全垫校验台 (BTC / ETH / ZEC / SOL + 自定义品种)

(function () {
    const STORAGE_KEY = "quant_pyramid_hub_v1";
    const PRESET_SYMBOLS = ["BTC", "ETH", "ZEC", "SOL"];

    const DEFAULT_HUB = {
        activeSymbol: "ETH",
        customSymbols: [],
        positions: {},   // sym -> { side, leverage, minCushionPct, currentSl, initialRiskUsd, fills: [] }
        closedTrades: [] // [{ id, symbol, side, openTime, closeTime, fillsCount, maxQty, avgEntry, closePrice, netPnl, rMultiple, hadViolation }]
    };

    let hubState = (() => {
        try {
            const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
            if (raw && typeof raw === "object") {
                return {
                    activeSymbol: raw.activeSymbol || "ETH",
                    customSymbols: Array.isArray(raw.customSymbols) ? raw.customSymbols : [],
                    positions: raw.positions && typeof raw.positions === "object" ? raw.positions : {},
                    closedTrades: Array.isArray(raw.closedTrades) ? raw.closedTrades : []
                };
            }
        } catch (e) {}
        return JSON.parse(JSON.stringify(DEFAULT_HUB));
    })();

    let livePriceMap = {}; // sym -> price
    let activeActionTab = "ADD"; // 'ADD' | 'REDUCE' | 'SL' | 'CLOSE'

    function saveHub() {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(hubState)); } catch (e) {}
    }

    function defaultMinCushionFor(sym) {
        const s = String(sym || "").toUpperCase();
        if (s === "BTC") return 2.0;
        if (s === "KORU" || s === "SOXL" || s === "TQQQ") return 3.5;
        return 2.5;
    }

    function priceDecFor(sym, px) {
        const p = Number(px) || 0;
        if (String(sym).toUpperCase() === "BTC") return 1;
        if (p >= 100) return 2;
        if (p >= 1) return 3;
        return 4;
    }

    function getPos(sym) {
        const key = String(sym || hubState.activeSymbol || "BTC").toUpperCase();
        if (!hubState.positions[key]) {
            hubState.positions[key] = {
                side: "LONG",
                leverage: 10,
                minCushionPct: defaultMinCushionFor(key),
                currentSl: 0,
                initialRiskUsd: 200,
                fills: []
            };
        }
        return hubState.positions[key];
    }

    function fmtTimeNow() {
        if (typeof formatBeijingTime === "function") {
            return formatBeijingTime(Math.floor(Date.now() / 1000), false);
        }
        const d = new Date(Date.now() + 8 * 3600 * 1000);
        const pad = n => String(n).padStart(2, "0");
        return `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
    }

    function computePositionMetrics(pos, liveP) {
        const isLong = pos.side !== "SHORT";
        let qty = 0;
        let costSum = 0;
        let realizedPnl = 0;
        let maxQty = 0;
        let baseQty = 0;
        let lastAddQty = 0;
        let hadViolation = false;

        for (const f of pos.fills) {
            if (f.violated) hadViolation = true;
            if (f.action === "OPEN" || f.action === "ADD") {
                if (qty === 0) baseQty = f.qty;
                lastAddQty = f.qty;
                costSum += f.price * f.qty;
                qty += f.qty;
                if (qty > maxQty) maxQty = qty;
            } else if (f.action === "REDUCE" && qty > 0) {
                const avgBefore = costSum / qty;
                const cutQty = Math.min(qty, f.qty);
                const gross = isLong ? (f.price - avgBefore) * cutQty : (avgBefore - f.price) * cutQty;
                const fee = f.price * cutQty * 0.001;
                realizedPnl += (gross - fee);
                qty -= cutQty;
                costSum = avgBefore * qty;
            }
        }

        const avg = qty > 0 ? (costSum / qty) : 0;
        const bep = avg > 0 ? avg * (isLong ? 1.002 : 0.998) : 0;
        const lev = Math.max(1, Number(pos.leverage) || 10);
        const liq = avg > 0 ? Math.max(0, isLong ? avg * (1 - 1 / lev + 0.005) : avg * (1 + 1 / lev - 0.005)) : 0;
        const notional = avg * qty;
        const marginUsed = notional / lev;
        const curPx = liveP > 0 ? liveP : avg;
        const unrealizedPnl = qty > 0 && curPx > 0
            ? ((isLong ? (curPx - avg) : (avg - curPx)) * qty - (curPx * qty * 0.001))
            : 0;
        const totalPnl = realizedPnl + unrealizedPnl;
        const curR = pos.initialRiskUsd > 0 ? (totalPnl / pos.initialRiskUsd) : 0;
        const sl = Number(pos.currentSl) || 0;
        const cushionToBepPct = (curPx > 0 && bep > 0)
            ? ((isLong ? (curPx - bep) : (bep - curPx)) / curPx) * 100
            : 0;
        const cushionToSlPct = (curPx > 0 && sl > 0)
            ? ((isLong ? (curPx - sl) : (sl - curPx)) / curPx) * 100
            : 0;
        const worstNetAtSl = (qty > 0 && sl > 0)
            ? (realizedPnl + (isLong ? (sl - avg) : (avg - sl)) * qty - (avg * qty * 0.002))
            : 0;

        return {
            isLong, qty, avg, bep, liq, lev, notional, marginUsed,
            realizedPnl, unrealizedPnl, totalPnl, curR,
            sl, cushionToBepPct, cushionToSlPct, worstNetAtSl,
            baseQty, lastAddQty, maxQty, hadViolation
        };
    }

    window.getPyramidHubChartLines = function (symKey) {
        const key = String(symKey || "").toUpperCase();
        const pos = hubState.positions[key];
        if (!pos || !pos.fills || !pos.fills.length) return [];
        const liveP = livePriceMap[key] || (key === "BTC" && typeof currentBtcLivePrice !== "undefined" ? currentBtcLivePrice : 0);
        const m = computePositionMetrics(pos, liveP);
        if (m.qty <= 0 || m.avg <= 0) return [];
        const dir = m.isLong ? "多" : "空";
        const rTag = `${m.curR >= 0 ? "+" : ""}${m.curR.toFixed(2)}R`;
        const lines = [
            { price: m.avg, color: "#a855f7", title: `⚖️ 滚仓均价(${dir} ${rTag})` },
            { price: m.bep, color: "#f59e0b", title: `🛡️ 滚仓BEP` }
        ];
        if (m.sl > 0) lines.push({ price: m.sl, color: "#ef4444", title: `🛑 滚仓移动SL` });
        if (m.liq > 0) lines.push({ price: m.liq, color: "#fb7185", title: `💥 滚仓强平` });
        return lines;
    };

    async function fetchSymbolLivePrice(sym) {
        const key = String(sym || "").toUpperCase();
        if (key === "BTC" && typeof currentBtcLivePrice !== "undefined" && currentBtcLivePrice > 0) {
            livePriceMap[key] = currentBtcLivePrice;
            return currentBtcLivePrice;
        }
        if (key === "KORU" && typeof lastValidKoru !== "undefined" && lastValidKoru > 0) {
            livePriceMap[key] = lastValidKoru;
            return lastValidKoru;
        }
        const url = `https://www.okx.com/api/v5/market/ticker?instId=${encodeURIComponent(key + "-USDT-SWAP")}`;
        try {
            let data = null;
            if (typeof smartFetchJson === "function") {
                const w = await smartFetchJson(url, { timeoutMs: 4500 });
                data = w?.data;
            } else {
                const r = await fetch(url);
                if (r.ok) data = await r.json();
            }
            const last = parseFloat(data?.data?.[0]?.last) || 0;
            if (last > 0) {
                livePriceMap[key] = last;
                return last;
            }
        } catch (e) {}
        return livePriceMap[key] || 0;
    }

    window.pyrHubSelectSymbol = async function (sym) {
        const key = String(sym || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
        if (!key) return;
        hubState.activeSymbol = key;
        if (!PRESET_SYMBOLS.includes(key) && !hubState.customSymbols.includes(key)) {
            hubState.customSymbols.push(key);
        }
        saveHub();
        renderHubUI();
        await fetchSymbolLivePrice(key);
        const pxInput = document.getElementById("phActPrice");
        if (pxInput && livePriceMap[key]) pxInput.value = Number(livePriceMap[key]).toFixed(priceDecFor(key, livePriceMap[key]));
        renderHubUI();
    };

    window.pyrHubAddCustomSymbol = function () {
        const inp = document.getElementById("phCustomSymInput");
        const val = (inp?.value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
        if (!val) {
            if (typeof showToast === "function") showToast("请输入币种代码，例如 HYPE / DOGE / SUI");
            return;
        }
        if (inp) inp.value = "";
        window.pyrHubSelectSymbol(val);
    };

    window.pyrHubSetSide = function (side) {
        const pos = getPos(hubState.activeSymbol);
        if (pos.fills.length > 0 && pos.side !== side) {
            if (typeof showToast === "function") showToast("⚠️ 当前已有持仓，请先平仓或重置后再切换多空方向");
            return;
        }
        pos.side = side === "SHORT" ? "SHORT" : "LONG";
        saveHub();
        renderHubUI();
    };

    window.pyrHubUpdateSettings = function () {
        const pos = getPos(hubState.activeSymbol);
        const lev = parseFloat(document.getElementById("phLeverage")?.value);
        const minC = parseFloat(document.getElementById("phMinCushion")?.value);
        const riskU = parseFloat(document.getElementById("phInitRiskUsd")?.value);
        if (isFinite(lev) && lev >= 1) pos.leverage = lev;
        if (isFinite(minC) && minC >= 0.5) pos.minCushionPct = minC;
        if (isFinite(riskU) && riskU > 0) pos.initialRiskUsd = riskU;
        saveHub();
        renderHubUI();
    };

    window.pyrHubSetActionTab = function (tab) {
        activeActionTab = tab;
        ["ADD", "REDUCE", "SL", "CLOSE"].forEach(t => {
            const b = document.getElementById(`btnPhAct_${t}`);
            if (b) b.classList.toggle("active", t === activeActionTab);
        });
        const sym = hubState.activeSymbol;
        const pos = getPos(sym);
        const liveP = livePriceMap[sym] || 0;
        const dec = priceDecFor(sym, liveP);
        const pxEl = document.getElementById("phActPrice");
        const qtyEl = document.getElementById("phActQty");
        const slEl = document.getElementById("phActNewSl");
        const qtyWrap = document.getElementById("phActQtyWrap");
        const pxWrap = document.getElementById("phActPriceWrap");
        const slWrap = document.getElementById("phActSlWrap");

        if (pxWrap) pxWrap.style.display = activeActionTab === "SL" ? "none" : "";
        if (qtyWrap) qtyWrap.style.display = (activeActionTab === "SL" || activeActionTab === "CLOSE") ? "none" : "";
        if (slWrap) slWrap.style.display = activeActionTab === "CLOSE" ? "none" : "";
        if (pxEl && liveP > 0 && !pxEl.value) pxEl.value = liveP.toFixed(dec);
        if (slEl && pos.currentSl > 0 && !slEl.value) slEl.value = Number(pos.currentSl).toFixed(dec);
        if (qtyEl && activeActionTab === "REDUCE") {
            const m = computePositionMetrics(pos, liveP);
            if (m.qty > 0) qtyEl.value = (m.qty * 0.5).toFixed(4).replace(/\.?0+$/, "");
        }
        window.pyrHubEvaluatePreview();
    };

    window.pyrHubRefreshPrice = async function () {
        const sym = hubState.activeSymbol;
        const p = await fetchSymbolLivePrice(sym);
        const pxEl = document.getElementById("phActPrice");
        if (pxEl && p > 0) pxEl.value = p.toFixed(priceDecFor(sym, p));
        renderHubUI();
        if (typeof showToast === "function") showToast(p > 0 ? `🔄 已同步 ${sym} 现价: ${p}` : `⚠️ 未获取到 ${sym} 实时价，可手动输入`);
    };

    window.pyrHubJumpToChart = function () {
        const sym = hubState.activeSymbol;
        if (typeof selectWatchlistSymbol === "function") {
            selectWatchlistSymbol(`OKX:${sym}`);
        }
        if (typeof switchMainTab === "function") switchMainTab("chart");
        setTimeout(() => {
            if (typeof renderAllLwPriceLines === "function") renderAllLwPriceLines();
        }, 180);
    };

    function evaluateAddSimulation(pos, liveP, addPrice, addQty, newSl) {
        const m = computePositionMetrics(pos, liveP);
        const isFirst = m.qty <= 0;
        const isLong = pos.side !== "SHORT";
        const newQty = m.qty + addQty;
        const newAvg = newQty > 0 ? ((m.avg * m.qty + addPrice * addQty) / newQty) : 0;
        const newBep = newAvg > 0 ? newAvg * (isLong ? 1.002 : 0.998) : 0;
        const effSl = newSl > 0 ? newSl : (pos.currentSl || 0);
        const refPx = liveP > 0 ? liveP : addPrice;
        const lev = Math.max(1, Number(pos.leverage) || 10);
        const newLiq = newAvg > 0 ? Math.max(0, isLong ? newAvg * (1 - 1 / lev + 0.005) : newAvg * (1 + 1 / lev - 0.005)) : 0;

        const cushionBep = (refPx > 0 && newBep > 0) ? ((isLong ? (refPx - newBep) : (newBep - refPx)) / refPx) * 100 : 0;
        const cushionSl = (refPx > 0 && effSl > 0) ? ((isLong ? (refPx - effSl) : (effSl - refPx)) / refPx) * 100 : 0;
        const worstNet = (effSl > 0 && newQty > 0)
            ? (m.realizedPnl + (isLong ? (effSl - newAvg) : (newAvg - effSl)) * newQty - (newAvg * newQty * 0.002))
            : 0;

        const warnings = [];
        const minCushion = Number(pos.minCushionPct) || 2.0;

        if (!isFirst) {
            // 1. 递减纪律校验（杜绝中后段等量/加重追单）
            if (m.lastAddQty > 0 && addQty >= m.lastAddQty * 0.99) {
                warnings.push(`违背正金字塔递减：拟加量(${addQty}) ≥ 上一笔(${m.lastAddQty})，建议减半`);
            } else if (m.baseQty > 0 && addQty > m.baseQty * 0.65) {
                warnings.push(`加仓过重：拟加量超底仓 65%，会大幅拉近均价`);
            }
            // 2. 安全垫红线拦截
            if (cushionBep < minCushion) {
                warnings.push(`安全垫告急：加完后距新BEP仅 ${cushionBep.toFixed(2)}% < ${minCushion}% 红线，一根急抽即吐光浮盈`);
            }
            if (effSl > 0 && cushionSl < minCushion) {
                warnings.push(`止损缓冲不足：现价距新止损仅 ${cushionSl.toFixed(2)}% < ${minCushion}%，易被扫损`);
            }
            // 3. 零亏损锁盈校验
            if (effSl > 0 && worstNet < 0) {
                warnings.push(`未锁死零亏损：打穿新止损仍净亏 $${Math.abs(worstNet).toFixed(1)}，请先推过新BEP`);
            }
        }
        // 4. 强平线红灯
        if (effSl > 0 && newLiq > 0 && (isLong ? effSl <= newLiq : effSl >= newLiq)) {
            warnings.push(`💥 止损超出强平线 (${newLiq.toFixed(1)})，会先爆仓后止损`);
        }

        return {
            isFirst, newQty, newAvg, newBep, effSl, newLiq,
            cushionBep, cushionSl, worstNet, warnings
        };
    }

    window.pyrHubEvaluatePreview = function () {
        const box = document.getElementById("phPreviewBox");
        if (!box) return;
        const sym = hubState.activeSymbol;
        const pos = getPos(sym);
        const liveP = livePriceMap[sym] || 0;
        const dec = priceDecFor(sym, liveP || 100);
        const px = parseFloat(document.getElementById("phActPrice")?.value) || 0;
        const qty = parseFloat(document.getElementById("phActQty")?.value) || 0;
        const newSl = parseFloat(document.getElementById("phActNewSl")?.value) || 0;
        const m = computePositionMetrics(pos, liveP);

        if (activeActionTab === "ADD") {
            if (px <= 0 || qty <= 0) {
                box.innerHTML = `<div style="color:var(--text-muted); font-size:11px;">输入拟成交价与数量，实时预演加仓后的新均价、新 BEP 与安全垫红线校验。</div>`;
                return;
            }
            const sim = evaluateAddSimulation(pos, liveP, px, qty, newSl);
            const ok = sim.warnings.length === 0;
            const verdictHtml = ok
                ? `<div style="color:#34d399; font-weight:700;">🟢 ${sim.isFirst ? "底仓风控通过" : "加仓安全垫达标 · 允许顺势滚仓"}</div>`
                : `<div style="color:#f87171; font-weight:700; line-height:1.5;">🚨 拦截预警：<br>${sim.warnings.map(w => "• " + w).join("<br>")}</div>`;

            box.innerHTML = `
                <div style="display:grid; grid-template-columns: repeat(2, 1fr); gap:6px; font-family:monospace; font-size:11px; margin-bottom:6px;">
                    <div>新合成均价: <b style="color:var(--neon-cyan);">${sim.newAvg.toFixed(dec)}</b></div>
                    <div>新真实 BEP: <b style="color:var(--neon-amber);">${sim.newBep.toFixed(dec)}</b></div>
                    <div>距 BEP 安全垫: <b style="color:${sim.cushionBep < pos.minCushionPct && !sim.isFirst ? 'var(--neon-red)' : 'var(--neon-emerald)'};">${sim.cushionBep.toFixed(2)}%</b></div>
                    <div>新止损锁盈: <b style="color:${sim.worstNet >= 0 ? 'var(--neon-emerald)' : 'var(--neon-red)'};">${sim.effSl > 0 ? (sim.worstNet >= 0 ? '+$' : '-$') + Math.abs(sim.worstNet).toFixed(1) : '未设SL'}</b></div>
                </div>
                ${verdictHtml}
            `;
        } else if (activeActionTab === "REDUCE") {
            if (m.qty <= 0 || px <= 0 || qty <= 0) {
                box.innerHTML = `<div style="color:var(--text-muted); font-size:11px;">输入分批止盈价与减仓数量，系统自动核算本笔兑现利润与剩余持仓。</div>`;
                return;
            }
            const cut = Math.min(m.qty, qty);
            const estPnl = (m.isLong ? (px - m.avg) : (m.avg - px)) * cut - px * cut * 0.001;
            box.innerHTML = `<div style="font-family:monospace; font-size:11px;">预计减仓 <b>${cut} ${sym}</b>，本笔落袋 <b style="color:${estPnl >= 0 ? '#34d399' : '#f87171'};">${estPnl >= 0 ? '+$' : '-$'}${Math.abs(estPnl).toFixed(1)}</b>，剩余持仓 <b>${(m.qty - cut).toFixed(4)} ${sym}</b>。</div>`;
        } else if (activeActionTab === "SL") {
            if (m.qty <= 0 || newSl <= 0) {
                box.innerHTML = `<div style="color:var(--text-muted); font-size:11px;">输入新的移动止损位，校验打穿止损后的最坏净锁盈。</div>`;
                return;
            }
            const worst = m.realizedPnl + (m.isLong ? (newSl - m.avg) : (m.avg - newSl)) * m.qty - m.avg * m.qty * 0.002;
            const refPx = liveP > 0 ? liveP : m.avg;
            const buf = ((m.isLong ? (refPx - newSl) : (newSl - refPx)) / refPx) * 100;
            box.innerHTML = `<div style="font-family:monospace; font-size:11px;">移动止损至 <b>${newSl.toFixed(dec)}</b>（距现价缓冲 <b>${buf.toFixed(2)}%</b>）· 最坏净锁盈 <b style="color:${worst >= 0 ? '#34d399' : '#f87171'};">${worst >= 0 ? '+$' : '-$'}${Math.abs(worst).toFixed(1)}</b></div>`;
        } else {
            if (m.qty <= 0 || px <= 0) {
                box.innerHTML = `<div style="color:var(--text-muted); font-size:11px;">输入最终平仓价，结清当前 ${sym} 滚仓周期并计入复盘胜率统计。</div>`;
                return;
            }
            const finalPnl = m.realizedPnl + (m.isLong ? (px - m.avg) : (m.avg - px)) * m.qty - px * m.qty * 0.001;
            const rMult = pos.initialRiskUsd > 0 ? finalPnl / pos.initialRiskUsd : 0;
            box.innerHTML = `<div style="font-family:monospace; font-size:11px;">全部平仓 <b>${m.qty.toFixed(4)} ${sym}</b> @ <b>${px.toFixed(dec)}</b> · 本轮净盈亏 <b style="color:${finalPnl >= 0 ? '#34d399' : '#f87171'};">${finalPnl >= 0 ? '+$' : '-$'}${Math.abs(finalPnl).toFixed(1)} (${rMult >= 0 ? '+' : ''}${rMult.toFixed(2)}R)</b></div>`;
        }
    };

    window.pyrHubCommitAction = function () {
        const sym = hubState.activeSymbol;
        const pos = getPos(sym);
        const liveP = livePriceMap[sym] || 0;
        const px = parseFloat(document.getElementById("phActPrice")?.value) || 0;
        const qty = parseFloat(document.getElementById("phActQty")?.value) || 0;
        const newSl = parseFloat(document.getElementById("phActNewSl")?.value) || 0;
        const note = (document.getElementById("phActNote")?.value || "").trim();
        const m = computePositionMetrics(pos, liveP);

        if (activeActionTab === "ADD") {
            if (px <= 0 || qty <= 0) {
                if (typeof showToast === "function") showToast("请填写有效的成交价格与数量");
                return;
            }
            const sim = evaluateAddSimulation(pos, liveP, px, qty, newSl);
            const action = sim.isFirst ? "OPEN" : "ADD";
            if (newSl > 0) pos.currentSl = newSl;
            pos.fills.push({
                id: "f_" + Date.now() + "_" + Math.random().toString(36).slice(2, 5),
                ts: Date.now(),
                timeStr: fmtTimeNow(),
                action,
                price: px,
                qty,
                notional: px * qty,
                cushionAfterPct: Number(sim.cushionBep.toFixed(2)),
                violated: !sim.isFirst && sim.warnings.length > 0,
                warnText: sim.warnings.join("；"),
                note
            });
            saveHub();
            if (document.getElementById("phActNote")) document.getElementById("phActNote").value = "";
            renderHubUI();
            if (typeof renderAllLwPriceLines === "function") renderAllLwPriceLines();
            if (typeof showToast === "function") {
                showToast(sim.warnings.length > 0
                    ? `⚠️ 已记录 ${sym} 加仓，但触发安全垫警告（已标记用于复盘）`
                    : `✅ 已记录 ${sym} ${action === "OPEN" ? "底仓" : "顺势加仓"} (${qty} ${sym})`);
            }
        } else if (activeActionTab === "REDUCE") {
            if (m.qty <= 0 || px <= 0 || qty <= 0) {
                if (typeof showToast === "function") showToast("当前无持仓或未填减仓价格/数量");
                return;
            }
            const cut = Math.min(m.qty, qty);
            if (newSl > 0) pos.currentSl = newSl;
            pos.fills.push({
                id: "f_" + Date.now() + "_" + Math.random().toString(36).slice(2, 5),
                ts: Date.now(),
                timeStr: fmtTimeNow(),
                action: "REDUCE",
                price: px,
                qty: cut,
                notional: px * cut,
                cushionAfterPct: Number(m.cushionToBepPct.toFixed(2)),
                violated: false,
                warnText: "",
                note: note || "分批止盈减仓"
            });
            saveHub();
            renderHubUI();
            if (typeof renderAllLwPriceLines === "function") renderAllLwPriceLines();
            if (typeof showToast === "function") showToast(`✂️ 已记录 ${sym} 分批减仓 ${cut}`);
        } else if (activeActionTab === "SL") {
            if (newSl <= 0) {
                if (typeof showToast === "function") showToast("请输入新的移动止损价");
                return;
            }
            pos.currentSl = newSl;
            saveHub();
            renderHubUI();
            if (typeof renderAllLwPriceLines === "function") renderAllLwPriceLines();
            if (typeof showToast === "function") showToast(`🛑 已更新 ${sym} 移动止损至 ${newSl}`);
        } else if (activeActionTab === "CLOSE") {
            if (m.qty <= 0 || px <= 0) {
                if (typeof showToast === "function") showToast("当前无持仓或未填平仓价");
                return;
            }
            const netPnl = m.realizedPnl + (m.isLong ? (px - m.avg) : (m.avg - px)) * m.qty - px * m.qty * 0.001;
            const rMult = pos.initialRiskUsd > 0 ? netPnl / pos.initialRiskUsd : 0;
            hubState.closedTrades.unshift({
                id: "ct_" + Date.now(),
                symbol: sym,
                side: pos.side,
                openTime: pos.fills[0]?.timeStr || fmtTimeNow(),
                closeTime: fmtTimeNow(),
                fillsCount: pos.fills.length,
                maxQty: Number(m.maxQty.toFixed(4)),
                avgEntry: Number(m.avg.toFixed(priceDecFor(sym, m.avg))),
                closePrice: px,
                netPnl: Number(netPnl.toFixed(1)),
                rMultiple: Number(rMult.toFixed(2)),
                hadViolation: m.hadViolation,
                note
            });
            if (hubState.closedTrades.length > 100) hubState.closedTrades = hubState.closedTrades.slice(0, 100);
            pos.fills = [];
            pos.currentSl = 0;
            saveHub();
            renderHubUI();
            if (typeof renderAllLwPriceLines === "function") renderAllLwPriceLines();
            if (typeof showToast === "function") showToast(`🏁 ${sym} 本轮滚仓已结清归档 (${netPnl >= 0 ? '+$' : '-$'}${Math.abs(netPnl).toFixed(1)})`);
        }
    };

    window.pyrHubDeleteFill = function (fillId) {
        const pos = getPos(hubState.activeSymbol);
        pos.fills = pos.fills.filter(f => f.id !== fillId);
        if (!pos.fills.length) pos.currentSl = 0;
        saveHub();
        renderHubUI();
        if (typeof renderAllLwPriceLines === "function") renderAllLwPriceLines();
    };

    window.pyrHubResetPosition = function () {
        const pos = getPos(hubState.activeSymbol);
        pos.fills = [];
        pos.currentSl = 0;
        saveHub();
        renderHubUI();
        if (typeof renderAllLwPriceLines === "function") renderAllLwPriceLines();
        if (typeof showToast === "function") showToast(`🧹 已重置 ${hubState.activeSymbol} 当前未结滚仓`);
    };

    window.pyrHubDeleteClosedTrade = function (id) {
        hubState.closedTrades = hubState.closedTrades.filter(t => t.id !== id);
        saveHub();
        renderHubUI();
    };

    window.pyrHubExportCsv = function () {
        const list = hubState.closedTrades;
        if (!list.length) {
            if (typeof showToast === "function") showToast("暂无已平仓滚仓复盘记录可导出");
            return;
        }
        const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
        const headers = ["品种", "方向", "开仓时间", "平仓时间", "成交笔数", "峰值仓位", "合成均价", "平仓价", "净盈亏($)", "R倍数", "是否违规加仓", "备注"];
        const rows = list.map(t => [
            t.symbol, t.side === "SHORT" ? "空" : "多", t.openTime, t.closeTime,
            t.fillsCount, t.maxQty, t.avgEntry, t.closePrice, t.netPnl, t.rMultiple,
            t.hadViolation ? "是(安全垫/递减违规)" : "否(达标)", t.note || ""
        ].map(esc).join(","));
        const csv = "\uFEFF" + headers.map(esc).join(",") + "\n" + rows.join("\n");
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `pyramid_hub_review_${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        if (typeof showToast === "function") showToast(`📤 已导出 ${list.length} 笔滚仓复盘记录`);
    };

    function renderHubUI() {
        const sym = hubState.activeSymbol;
        const pos = getPos(sym);
        const liveP = livePriceMap[sym] || 0;
        const dec = priceDecFor(sym, liveP || 100);
        const m = computePositionMetrics(pos, liveP);

        // 1. 品种切换胶囊
        const pillsEl = document.getElementById("phSymbolPills");
        if (pillsEl) {
            const allSyms = PRESET_SYMBOLS.concat(hubState.customSymbols.filter(s => !PRESET_SYMBOLS.includes(s)));
            pillsEl.innerHTML = allSyms.map(s => {
                const active = s === sym;
                const hasOpen = hubState.positions[s]?.fills?.length > 0;
                return `<button type="button" class="btn-sm ${active ? 'active' : ''}" onclick="pyrHubSelectSymbol('${s}')" style="padding:5px 11px; font-weight:800;">${s}${hasOpen ? ' ●' : ''}</button>`;
            }).join("");
        }

        // 2. 顶部现价与多空按钮
        const liveEl = document.getElementById("phLivePriceText");
        if (liveEl) liveEl.textContent = liveP > 0 ? `${sym} 现价: ${liveP.toFixed(dec)} USDT` : `${sym} 现价: 待同步`;
        const bLong = document.getElementById("btnPhSideLong");
        const bShort = document.getElementById("btnPhSideShort");
        if (bLong) bLong.className = `btn-side ${pos.side !== "SHORT" ? "active-long" : ""}`;
        if (bShort) bShort.className = `btn-side ${pos.side === "SHORT" ? "active-short" : ""}`;

        const setVal = (id, v) => { const el = document.getElementById(id); if (el && document.activeElement !== el) el.value = v; };
        setVal("phLeverage", pos.leverage);
        setVal("phMinCushion", pos.minCushionPct);
        setVal("phInitRiskUsd", pos.initialRiskUsd);

        // 3. 当前持仓状态卡片
        const statusEl = document.getElementById("phCurrentPosGrid");
        if (statusEl) {
            const pnlCol = m.totalPnl >= 0 ? "var(--neon-emerald)" : "var(--neon-red)";
            const bufCol = m.qty > 0 && m.cushionToBepPct < pos.minCushionPct ? "var(--neon-red)" : "var(--neon-emerald)";
            let disciplineStripHtml = "";
            if (m.qty > 0) {
                if (m.totalPnl <= 0 || m.cushionToBepPct <= 0.15) {
                    disciplineStripHtml = `<div style="grid-column:1/-1; padding:6px 9px; border-radius:6px; font-size:11px; font-weight:700; background:rgba(239,68,68,0.09); border:1px solid rgba(239,68,68,0.32); color:#f87171;">⚠️ 回撤无利 · 建议全平防上头（利润已回吐至成本附近，按纪律退场重来）</div>`;
                } else if (m.cushionToBepPct < pos.minCushionPct) {
                    disciplineStripHtml = `<div style="grid-column:1/-1; padding:6px 9px; border-radius:6px; font-size:11px; font-weight:700; background:rgba(245,158,11,0.09); border:1px solid rgba(245,158,11,0.32); color:#fbbf24;">🛡️ 浮盈较薄 · 暂停加仓守防线（当前安全垫 ${m.cushionToBepPct.toFixed(2)}% 低于 ${pos.minCushionPct}% 红线）</div>`;
                } else {
                    disciplineStripHtml = `<div style="grid-column:1/-1; padding:6px 9px; border-radius:6px; font-size:11px; font-weight:700; background:rgba(16,185,129,0.08); border:1px solid rgba(16,185,129,0.28); color:#34d399;">🟢 有浮盈垫底 · 按防守线持有（当前安全垫 ${m.cushionToBepPct.toFixed(2)}%）</div>`;
                }
            }
            statusEl.innerHTML = `
                <div class="kpi-mini-box"><div class="kpi-mini-label">当前持仓 (${m.isLong ? '多' : '空'} · ${pos.fills.length}笔)</div><div class="kpi-mini-val" style="font-size:14px;">${m.qty > 0 ? m.qty.toFixed(4).replace(/\.?0+$/, '') + ' ' + sym : '空仓'}</div><div class="kpi-mini-sub">名义 $${Math.round(m.notional).toLocaleString()} · 占保证金 $${Math.round(m.marginUsed).toLocaleString()}</div></div>
                <div class="kpi-mini-box"><div class="kpi-mini-label">真实均价 / 新 BEP</div><div class="kpi-mini-val" style="font-size:14px; color:var(--neon-cyan);">${m.avg > 0 ? m.avg.toFixed(dec) : '--'}</div><div class="kpi-mini-sub">BEP ${m.bep > 0 ? m.bep.toFixed(dec) : '--'} · 强平 ${m.liq > 0 ? m.liq.toFixed(dec) : '--'}</div></div>
                <div class="kpi-mini-box"><div class="kpi-mini-label">距 BEP 安全垫 (红线 ${pos.minCushionPct}%)</div><div class="kpi-mini-val" style="font-size:14px; color:${bufCol};">${m.qty > 0 ? m.cushionToBepPct.toFixed(2) + '%' : '--'}</div><div class="kpi-mini-sub">移动SL: ${m.sl > 0 ? m.sl.toFixed(dec) : '未设'} · 锁盈 ${m.sl > 0 && m.qty > 0 ? (m.worstNetAtSl >= 0 ? '+$' : '-$') + Math.abs(m.worstNetAtSl).toFixed(1) : '--'}</div></div>
                <div class="kpi-mini-box"><div class="kpi-mini-label">综合浮盈 / 实时 R</div><div class="kpi-mini-val" style="font-size:14px; color:${pnlCol};">${m.qty > 0 ? (m.totalPnl >= 0 ? '+$' : '-$') + Math.abs(m.totalPnl).toFixed(1) : '--'}</div><div class="kpi-mini-sub">${m.qty > 0 ? (m.curR >= 0 ? '+' : '') + m.curR.toFixed(2) + 'R (基准1R=$' + pos.initialRiskUsd + ')' : '开底仓后实时跟踪'}</div></div>
                ${disciplineStripHtml}
            `;
        }

        // 4. 逐笔成交明细
        const fillsEl = document.getElementById("phFillsList");
        if (fillsEl) {
            if (!pos.fills.length) {
                fillsEl.innerHTML = `<div style="font-size:11px; color:var(--text-muted); padding:6px 0;">当前 ${sym} 暂无持仓记录。可在左侧录入第一笔底仓，之后每次加仓前都会自动触发安全垫校验。</div>`;
            } else {
                const actMap = { OPEN: { t: "① 底仓", c: "#38bdf8" }, ADD: { t: "➕ 加仓", c: "#f59e0b" }, REDUCE: { t: "✂️ 减仓", c: "#10b981" } };
                fillsEl.innerHTML = pos.fills.slice().reverse().map((f, idx) => {
                    const am = actMap[f.action] || actMap.ADD;
                    const badge = f.violated
                        ? `<span style="color:#f87171; font-weight:700;">🚨 违规加仓</span>`
                        : `<span style="color:#34d399; font-weight:700;">🟢 达标</span>`;
                    return `<div style="padding:7px 8px; border-bottom:1px dashed var(--border-color); font-size:11px; display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
                        <div style="line-height:1.45;">
                            <div><b style="color:${am.c};">${am.t}</b> <span style="color:var(--text-muted); font-family:monospace;">${f.timeStr}</span> · ${badge}</div>
                            <div style="font-family:monospace; color:var(--text-main);">价 <b>${Number(f.price).toFixed(dec)}</b> × 量 <b>${f.qty} ${sym}</b> ($${Math.round(f.notional).toLocaleString()}) · 缓冲 <b>${f.cushionAfterPct}%</b></div>
                            ${f.warnText ? `<div style="color:#f87171; font-size:10px;">${f.warnText}</div>` : ""}
                            ${f.note ? `<div style="color:var(--text-muted); font-size:10px;">备注: ${f.note}</div>` : ""}
                        </div>
                        <button type="button" class="btn-sm" onclick="pyrHubDeleteFill('${f.id}')" style="padding:1px 5px; font-size:10px; color:#f87171;">✕</button>
                    </div>`;
                }).join("");
            }
        }

        // 5. 复盘统计与已平仓台账
        const statsEl = document.getElementById("phReviewStats");
        const closedEl = document.getElementById("phClosedList");
        const closed = hubState.closedTrades;
        if (statsEl) {
            if (!closed.length) {
                statsEl.innerHTML = `<div style="grid-column:1/-1; font-size:11px; color:var(--text-muted);">平仓结清后自动对比「达标滚仓 vs 违规加仓」胜率与累计 R 倍数。</div>`;
            } else {
                const wins = closed.filter(x => x.netPnl > 0).length;
                const totPnl = closed.reduce((a, b) => a + (b.netPnl || 0), 0);
                const totR = closed.reduce((a, b) => a + (b.rMultiple || 0), 0);
                const cleanList = closed.filter(x => !x.hadViolation);
                const violList = closed.filter(x => x.hadViolation);
                const cleanWr = cleanList.length ? ((cleanList.filter(x => x.netPnl > 0).length / cleanList.length) * 100).toFixed(0) + "%" : "--";
                const violWr = violList.length ? ((violList.filter(x => x.netPnl > 0).length / violList.length) * 100).toFixed(0) + "%" : "--";
                statsEl.innerHTML = `
                    <div class="kpi-mini-box" style="padding:6px 8px;"><div class="kpi-mini-label">总平仓 / 胜率</div><div class="kpi-mini-val" style="font-size:13px;">${closed.length}笔 · ${((wins / closed.length) * 100).toFixed(0)}%</div></div>
                    <div class="kpi-mini-box" style="padding:6px 8px;"><div class="kpi-mini-label">累计净盈亏</div><div class="kpi-mini-val" style="font-size:13px; color:${totPnl >= 0 ? 'var(--neon-emerald)' : 'var(--neon-red)'};">${totPnl >= 0 ? '+$' : '-$'}${Math.abs(totPnl).toFixed(1)}</div></div>
                    <div class="kpi-mini-box" style="padding:6px 8px;"><div class="kpi-mini-label">累计 R 倍数</div><div class="kpi-mini-val" style="font-size:13px; color:${totR >= 0 ? 'var(--neon-emerald)' : 'var(--neon-red)'};">${totR >= 0 ? '+' : ''}${totR.toFixed(2)}R</div></div>
                    <div class="kpi-mini-box" style="padding:6px 8px;"><div class="kpi-mini-label">达标 vs 违规胜率</div><div class="kpi-mini-val" style="font-size:12px;">🟢${cleanWr} / 🚨${violWr}</div></div>
                `;
            }
        }
        if (closedEl) {
            if (!closed.length) {
                closedEl.innerHTML = `<div style="font-size:11px; color:var(--text-muted); padding:4px 0;">暂无已平仓滚仓归档记录。</div>`;
            } else {
                closedEl.innerHTML = closed.slice(0, 20).map(t => `
                    <div style="padding:6px 8px; border-bottom:1px dashed var(--border-color); font-size:11px; display:flex; justify-content:space-between; align-items:center; gap:6px;">
                        <div style="line-height:1.4;">
                            <div><b>${t.symbol}</b> <span class="badge" style="padding:0 4px; font-size:9.5px;">${t.side === 'SHORT' ? '空' : '多'}</span> · ${t.fillsCount}笔 · ${t.hadViolation ? '<span style="color:#f87171;">🚨曾违规</span>' : '<span style="color:#34d399;">🟢达标</span>'}</div>
                            <div style="font-family:monospace; color:var(--text-muted);">均价 ${t.avgEntry} → 平 ${t.closePrice} · <b style="color:${t.netPnl >= 0 ? '#34d399' : '#f87171'};">${t.netPnl >= 0 ? '+$' : '-$'}${Math.abs(t.netPnl).toFixed(1)} (${t.rMultiple >= 0 ? '+' : ''}${t.rMultiple}R)</b></div>
                        </div>
                        <button type="button" class="btn-sm" onclick="pyrHubDeleteClosedTrade('${t.id}')" style="padding:1px 5px; font-size:10px; color:#f87171;">✕</button>
                    </div>
                `).join("");
            }
        }

        window.pyrHubEvaluatePreview();
    }

    window.initPyramidHubView = function () {
        renderHubUI();
        window.pyrHubSetActionTab(activeActionTab);
        fetchSymbolLivePrice(hubState.activeSymbol).then(p => {
            if (p > 0) renderHubUI();
        });
    };
})();
