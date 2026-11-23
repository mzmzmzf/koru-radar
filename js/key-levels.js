// CoinGlass 同款「关键价位墙」聚合模块：多所大额买卖单墙 (OKX/Binance/Coinbase) + Deribit 期权最大痛点 + 清算磁铁

(function () {
    let keyLevelsCache = {
        items: [],
        maxPain: null,
        updatedAt: 0,
        sourcesOk: []
    };
    let isFetchingKeyLevels = false;

    function getWorkerBase() {
        const custom = typeof getCustomRelayBase === "function" ? (getCustomRelayBase() || "") : "";
        if (custom) return custom;
        return typeof LEGACY_WORKERS_DEV_URL === "string" ? LEGACY_WORKERS_DEV_URL : "";
    }

    async function fetchJsonAny(url, timeoutMs = 6000) {
        if (typeof smartFetchJson === "function") {
            try {
                const wrapped = await smartFetchJson(url, { timeoutMs });
                if (wrapped && wrapped.data !== undefined) return wrapped.data;
            } catch (e) {}
        }
        const relay = getWorkerBase();
        if (relay) {
            try {
                const sep = relay.includes("?") ? "&" : "?";
                const ctrl = new AbortController();
                const t = setTimeout(() => ctrl.abort(), timeoutMs);
                const res = await fetch(`${relay}${sep}url=${encodeURIComponent(url)}`, { cache: "no-store", signal: ctrl.signal });
                clearTimeout(t);
                if (res.ok) return await res.json();
            } catch (e) {}
        }
        try {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), timeoutMs);
            const res = await fetch(url, { cache: "no-store", signal: ctrl.signal });
            clearTimeout(t);
            if (res.ok) return await res.json();
        } catch (e) {}
        return null;
    }

    function fmtWan(usd) {
        const abs = Math.abs(usd || 0);
        if (abs >= 1e8) return `$${(abs / 1e8).toFixed(2)}亿`;
        if (abs >= 1e4) return `$${(abs / 1e4).toFixed(0)}万`;
        return `$${abs.toFixed(0)}`;
    }

    function aggregateOrderbookWalls(entries, side, exchange, marketType, liveP, bucketSize = 100) {
        if (!Array.isArray(entries) || !entries.length || !liveP) return [];
        const buckets = new Map();
        const minP = liveP * 0.91;
        const maxP = liveP * 1.09;

        for (const row of entries) {
            const px = parseFloat(row[0]);
            const qty = parseFloat(row[1]);
            if (!isFinite(px) || !isFinite(qty) || px <= 0 || qty <= 0) continue;
            if (px < minP || px > maxP) continue;
            if (side === "ASK" && px <= liveP * 1.001) continue;
            if (side === "BID" && px >= liveP * 0.999) continue;

            // OKX SWAP 合约 1 张 = 0.01 BTC，其余为 BTC 数量
            const btcQty = (exchange === "OKX" && marketType === "合约") ? (qty * 0.01) : qty;
            const notional = px * btcQty;
            const bucketPx = Math.round(px / bucketSize) * bucketSize;
            buckets.set(bucketPx, (buckets.get(bucketPx) || 0) + notional);
        }

        const out = [];
        buckets.forEach((usd, bucketPx) => {
            if (usd >= 1500000) { // 仅保留 >= $150万 的有效挂单墙
                out.push({
                    type: side === "ASK" ? "SELL_WALL" : "BUY_WALL",
                    title: side === "ASK" ? "大额卖单墙" : "大额买单墙",
                    badge: marketType,
                    sub: `${exchange} · ${fmtWan(usd)}`,
                    price: bucketPx,
                    usd,
                    color: side === "ASK" ? "#f87171" : "#34d399"
                });
            }
        });
        out.sort((a, b) => b.usd - a.usd);
        return out.slice(0, 2);
    }

    async function fetchMultiExchangeWalls(liveP) {
        const walls = [];
        const okSources = [];
        const tasks = [
            fetchJsonAny("https://www.okx.com/api/v5/market/books?instId=BTC-USDT-SWAP&sz=400", 5500).then(d => {
                const book = d?.data?.[0];
                if (book) {
                    okSources.push("OKX合约");
                    walls.push(...aggregateOrderbookWalls(book.asks, "ASK", "OKX", "合约", liveP, 100));
                    walls.push(...aggregateOrderbookWalls(book.bids, "BID", "OKX", "合约", liveP, 100));
                }
            }),
            fetchJsonAny("https://www.okx.com/api/v5/market/books?instId=BTC-USDT&sz=400", 5500).then(d => {
                const book = d?.data?.[0];
                if (book) {
                    okSources.push("OKX现货");
                    walls.push(...aggregateOrderbookWalls(book.asks, "ASK", "OKX", "现货", liveP, 100));
                    walls.push(...aggregateOrderbookWalls(book.bids, "BID", "OKX", "现货", liveP, 100));
                }
            }),
            fetchJsonAny("https://fapi.binance.com/fapi/v1/depth?symbol=BTCUSDT&limit=500", 5500).then(d => {
                if (d && Array.isArray(d.asks)) {
                    okSources.push("Binance合约");
                    walls.push(...aggregateOrderbookWalls(d.asks, "ASK", "Binance", "合约", liveP, 100));
                    walls.push(...aggregateOrderbookWalls(d.bids, "BID", "Binance", "合约", liveP, 100));
                }
            }),
            fetchJsonAny("https://api.binance.com/api/v3/depth?symbol=BTCUSDT&limit=500", 5500).then(d => {
                if (d && Array.isArray(d.asks)) {
                    okSources.push("Binance现货");
                    walls.push(...aggregateOrderbookWalls(d.asks, "ASK", "Binance", "现货", liveP, 100));
                    walls.push(...aggregateOrderbookWalls(d.bids, "BID", "Binance", "现货", liveP, 100));
                }
            }),
            fetchJsonAny("https://api.exchange.coinbase.com/products/BTC-USD/book?level=2", 5500).then(d => {
                if (d && Array.isArray(d.asks)) {
                    okSources.push("Coinbase现货");
                    walls.push(...aggregateOrderbookWalls(d.asks, "ASK", "Coinbase", "现货", liveP, 100));
                    walls.push(...aggregateOrderbookWalls(d.bids, "BID", "Coinbase", "现货", liveP, 100));
                }
            })
        ];
        await Promise.allSettled(tasks);
        return { walls, okSources };
    }

    function parseDeribitExpiryMs(code) {
        // 例: 27NOV26 -> 2026-11-27 08:00 UTC
        const m = String(code || "").match(/^(\d{1,2})([A-Z]{3})(\d{2})$/);
        if (!m) return NaN;
        const months = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
        const mon = months[m[2]];
        if (mon === undefined) return NaN;
        return Date.UTC(2000 + parseInt(m[3], 10), mon, parseInt(m[1], 10), 8, 0, 0);
    }

    async function fetchDeribitMaxPain(liveP) {
        const d = await fetchJsonAny("https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=BTC&kind=option", 7000);
        const list = Array.isArray(d?.result) ? d.result : [];
        if (!list.length) return null;

        const nowMs = Date.now();
        const byExpiry = new Map();
        for (const item of list) {
            const name = String(item.instrument_name || "");
            const parts = name.split("-");
            if (parts.length !== 4) continue;
            const expCode = parts[1];
            const strike = parseFloat(parts[2]);
            const optType = parts[3]; // C or P
            const oi = parseFloat(item.open_interest) || 0;
            if (!isFinite(strike) || oi <= 0) continue;
            const expMs = parseDeribitExpiryMs(expCode);
            if (!isFinite(expMs) || expMs <= nowMs) continue;
            if (!byExpiry.has(expCode)) byExpiry.set(expCode, { expCode, expMs, rows: [], totalOiBtc: 0 });
            const grp = byExpiry.get(expCode);
            grp.rows.push({ strike, optType, oi });
            grp.totalOiBtc += oi;
        }

        // 选择最近一个具有足够持仓量（>= 500 BTC）的到期日
        const candidates = Array.from(byExpiry.values())
            .filter(g => g.totalOiBtc >= 500)
            .sort((a, b) => a.expMs - b.expMs);
        const target = candidates[0];
        if (!target) return null;

        const strikes = Array.from(new Set(target.rows.map(r => r.strike))).sort((a, b) => a - b);
        let bestStrike = strikes[0];
        let minPayout = Infinity;

        for (const testPrice of strikes) {
            let payout = 0;
            for (const r of target.rows) {
                if (r.optType === "C" && testPrice > r.strike) {
                    payout += (testPrice - r.strike) * r.oi;
                } else if (r.optType === "P" && testPrice < r.strike) {
                    payout += (r.strike - testPrice) * r.oi;
                }
            }
            if (payout < minPayout) {
                minPayout = payout;
                bestStrike = testPrice;
            }
        }

        const dt = new Date(target.expMs + 8 * 3600 * 1000);
        const dateLabel = `${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
        const notionalUsd = target.totalOiBtc * (liveP || bestStrike);

        return {
            type: "MAX_PAIN",
            title: "期权最大痛点",
            badge: "期权",
            sub: `${dateLabel} 到期 · ${fmtWan(notionalUsd)}`,
            price: bestStrike,
            usd: notionalUsd,
            color: "#94a3b8"
        };
    }

    window.renderKeyLevelsPanel = function () {
        const listEl = document.getElementById("qdKeyLevelsList");
        const statusEl = document.getElementById("qdKeyLevelsStatus");
        if (!listEl) return;

        const liveP = (typeof currentBtcLivePrice !== "undefined" && currentBtcLivePrice > 0) ? currentBtcLivePrice : 0;
        if (!keyLevelsCache.items.length) {
            listEl.innerHTML = `<div style="font-size:11px; color:var(--text-muted); padding:8px 2px;">点击上方“🔄 刷新”聚合 OKX / Binance / Coinbase 大额挂单墙与 Deribit 期权最大痛点。</div>`;
            return;
        }

        const combined = keyLevelsCache.items.slice();
        if (typeof getActiveWhaleMagnetLines === "function") {
            getActiveWhaleMagnetLines().forEach(ml => {
                if (ml && isFinite(ml.price) && ml.price > 0) {
                    combined.push({
                        type: "LIQ_MAGNET",
                        title: ml.title || "清算磁铁",
                        badge: "清算",
                        sub: "Hyperliquid 链上强平位",
                        price: Number(ml.price),
                        usd: 0,
                        color: "#fb7185"
                    });
                }
            });
        }

        const above = combined.filter(x => liveP > 0 && x.price >= liveP).sort((a, b) => b.price - a.price).slice(0, 6);
        const below = combined.filter(x => liveP > 0 && x.price < liveP).sort((a, b) => b.price - a.price).slice(0, 6);

        const renderRow = (item) => {
            const pct = liveP > 0 ? ((item.price - liveP) / liveP) * 100 : 0;
            const pctStr = `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
            const pctCol = pct >= 0 ? "var(--neon-emerald)" : "var(--neon-red)";
            return `<div onclick="if(typeof addCustomHLineValue==='function'){addCustomHLineValue(${item.price}, false); showToast('📌 已将 ${item.title} (${item.price.toFixed(1)}) 画入主图');}" style="display:flex; justify-content:space-between; align-items:center; gap:6px; padding:6px 7px; border-bottom:1px dashed var(--border-color); cursor:pointer; transition:background 0.15s;" title="点击一键画入 K 线主图">
                <div style="display:flex; align-items:center; gap:6px; min-width:0;">
                    <span style="width:44px; font-family:monospace; font-size:10.5px; font-weight:700; color:${pctCol}; flex-shrink:0;">${pctStr}</span>
                    <span style="width:6px; height:6px; border-radius:50%; background:${item.color}; flex-shrink:0;"></span>
                    <div style="min-width:0; line-height:1.35;">
                        <div style="display:flex; align-items:center; gap:4px;">
                            <b style="font-size:11px; color:var(--text-main); white-space:nowrap;">${item.title}</b>
                            <span class="badge" style="padding:0 4px; font-size:9.5px;">${item.badge}</span>
                        </div>
                        <div style="font-size:10px; color:var(--text-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${item.sub}</div>
                    </div>
                </div>
                <b style="font-family:monospace; font-size:11.5px; color:var(--text-main); flex-shrink:0;">${Number(item.price).toFixed(1)}</b>
            </div>`;
        };

        const currentRow = `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:7px 8px; margin:4px 0; border-radius:7px; background:rgba(56,189,248,0.14); border:1px solid rgba(56,189,248,0.42);">
                <div style="display:flex; align-items:center; gap:6px;">
                    <span style="font-size:10.5px; color:var(--neon-cyan); font-weight:800; width:44px;">现价</span>
                    <span style="width:7px; height:7px; border-radius:50%; background:#38bdf8;"></span>
                    <div>
                        <b style="font-size:11.5px; color:var(--text-main);">当前价格</b>
                        <div style="font-size:9.5px; color:var(--text-muted);">实时 BTC-USDT</div>
                    </div>
                </div>
                <b style="font-family:monospace; font-size:12.5px; color:var(--neon-cyan);">${liveP > 0 ? liveP.toFixed(1) : "--"}</b>
            </div>
        `;

        listEl.innerHTML = above.map(renderRow).join("") + currentRow + below.map(renderRow).join("");
        if (statusEl && keyLevelsCache.updatedAt) {
            const tStr = new Date(keyLevelsCache.updatedAt).toTimeString().slice(0, 8);
            statusEl.textContent = `${keyLevelsCache.sourcesOk.length}源 · ${tStr}`;
        }
    };

    window.refreshKeyLevelsRadar = async function (showMsg = false) {
        if (isFetchingKeyLevels) return;
        const liveP = (typeof currentBtcLivePrice !== "undefined" && currentBtcLivePrice > 0) ? currentBtcLivePrice : 60000;
        isFetchingKeyLevels = true;
        const statusEl = document.getElementById("qdKeyLevelsStatus");
        if (statusEl) statusEl.textContent = "聚合深度中...";

        try {
            const [wallRes, maxPain] = await Promise.all([
                fetchMultiExchangeWalls(liveP),
                fetchDeribitMaxPain(liveP)
            ]);
            const items = wallRes.walls.slice();
            if (maxPain) {
                items.push(maxPain);
                wallRes.okSources.push("Deribit期权");
            }
            keyLevelsCache = {
                items,
                maxPain,
                updatedAt: Date.now(),
                sourcesOk: wallRes.okSources
            };
            window.renderKeyLevelsPanel();
            if (showMsg && typeof showToast === "function") {
                showToast(`🧱 已聚合 ${wallRes.okSources.length} 个数据源的关键价位墙与期权痛点`);
            }
        } finally {
            isFetchingKeyLevels = false;
        }
    };
})();
