// 自动化宏观情报聚合模块：MSTR 情绪锚 + BTC 合约 OI + Coinbase 现货溢价 + DXY / US10Y

(function () {
    const CACHE_KEY = "quant_macro_intel_v1";
    const DEFAULT_STATE = {
        mstrPrice: null,
        mstrChgPct: null,
        mnav: null,
        mstrBtcHoldings: 850849,
        mstrAvgCost: 75452,
        mstrLatest8k: "2026-11-16",
        oiUsd: null,
        oiBtc: null,
        oiChg24hPct: null,
        cbSpotPrice: null,
        cbPremiumPct: null,
        dxyPrice: null,
        dxyChgPct: null,
        us10yYield: null,
        us10yChgPct: null,
        updatedAt: 0,
        viaWorker: false
    };

    let intelState = (() => {
        try {
            const saved = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
            if (saved && typeof saved === "object") return { ...DEFAULT_STATE, ...saved };
        } catch (e) {}
        return { ...DEFAULT_STATE };
    })();

    let isFetchingIntel = false;

    function saveIntelState() {
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(intelState)); } catch (e) {}
    }

    function getRelayUrl() {
        const custom = typeof getCustomRelayBase === "function" ? (getCustomRelayBase() || "") : "";
        if (custom) return custom;
        return typeof LEGACY_WORKERS_DEV_URL === "string" ? LEGACY_WORKERS_DEV_URL : "";
    }

    async function fetchJsonSafe(url, timeoutMs = 6500) {
        if (typeof smartFetchJson === "function") {
            return await smartFetchJson(url, timeoutMs);
        }
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), timeoutMs);
        try {
            const res = await fetch(url, { signal: ctrl.signal });
            clearTimeout(t);
            if (!res.ok) return null;
            return await res.json();
        } catch (e) {
            clearTimeout(t);
            return null;
        }
    }

    async function fetchYahooSnapshot(symbol) {
        const enc = encodeURIComponent(symbol);
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${enc}?interval=1d&range=5d`;
        const data = await fetchJsonSafe(url, 6500);
        const meta = data?.chart?.result?.[0]?.meta;
        if (!meta || !isFinite(Number(meta.regularMarketPrice))) return null;
        const price = Number(meta.regularMarketPrice);
        const prev = Number(meta.chartPreviousClose || meta.previousClose || 0);
        const chgPct = prev > 0 ? ((price - prev) / prev) * 100 : null;
        return { price, chgPct };
    }

    async function fetchMstrIntel() {
        const relay = getRelayUrl();
        if (relay) {
            try {
                const ctrl = new AbortController();
                const t = setTimeout(() => ctrl.abort(), 7000);
                const res = await fetch(`${relay}/mstr`, { signal: ctrl.signal });
                clearTimeout(t);
                if (res.ok) {
                    const d = await res.json();
                    if (d && d.ok) {
                        if (isFinite(Number(d.mstrPrice)) && Number(d.mstrPrice) > 0) intelState.mstrPrice = Number(d.mstrPrice);
                        if (isFinite(Number(d.mstrChgPct))) intelState.mstrChgPct = Number(d.mstrChgPct);
                        if (isFinite(Number(d.mnav)) && Number(d.mnav) > 0) intelState.mnav = Number(d.mnav);
                        if (isFinite(Number(d.btcHoldings)) && Number(d.btcHoldings) > 100000) intelState.mstrBtcHoldings = Number(d.btcHoldings);
                        if (isFinite(Number(d.avgCost)) && Number(d.avgCost) > 10000) intelState.mstrAvgCost = Number(d.avgCost);
                        if (d.latest8kDate) intelState.mstrLatest8k = d.latest8kDate;
                        intelState.viaWorker = true;
                        return;
                    }
                }
            } catch (e) {}
        }
        // 无 Worker 或 Worker 未更新 /mstr 时的直连兜底：拉取 MSTR 实时股价
        const snap = await fetchYahooSnapshot("MSTR");
        if (snap) {
            intelState.mstrPrice = snap.price;
            intelState.mstrChgPct = snap.chgPct;
        }
    }

    async function fetchBtcOiIntel() {
        const url = "https://www.okx.com/api/v5/rubik/stat/contracts/open-interest-history?instId=BTC-USDT-SWAP&period=1H&limit=25";
        const data = await fetchJsonSafe(url, 6500);
        const rows = Array.isArray(data?.data) ? data.data : [];
        if (rows.length >= 2) {
            // OKX 返回按时间倒序: [ts, oi, oiCcy, oiUsd]
            const latest = rows[0];
            const prev24 = rows[rows.length - 1];
            const curBtc = parseFloat(latest[2]) || 0;
            const curUsd = parseFloat(latest[3]) || 0;
            const oldUsd = parseFloat(prev24[3]) || 0;
            if (curUsd > 0) {
                intelState.oiBtc = curBtc;
                intelState.oiUsd = curUsd;
                intelState.oiChg24hPct = oldUsd > 0 ? ((curUsd - oldUsd) / oldUsd) * 100 : null;
                return;
            }
        }
        const fallback = await fetchJsonSafe("https://www.okx.com/api/v5/public/open-interest?instType=SWAP&instId=BTC-USDT-SWAP", 5000);
        const row = fallback?.data?.[0];
        if (row) {
            const ccy = parseFloat(row.oiCcy) || 0;
            const liveBtc = (typeof currentBtcLivePrice !== "undefined" && currentBtcLivePrice > 0) ? currentBtcLivePrice : 0;
            if (ccy > 0) {
                intelState.oiBtc = ccy;
                if (liveBtc > 0) intelState.oiUsd = ccy * liveBtc;
            }
        }
    }

    async function fetchCoinbasePremiumIntel() {
        const url = "https://api.coinbase.com/v2/prices/BTC-USD/spot";
        let data = null;
        try {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), 5000);
            const res = await fetch(url, { signal: ctrl.signal });
            clearTimeout(t);
            if (res.ok) data = await res.json();
        } catch (e) {}
        if (!data) data = await fetchJsonSafe(url, 5500);
        const cbPx = parseFloat(data?.data?.amount) || 0;
        const okxPx = (typeof currentBtcLivePrice !== "undefined" && currentBtcLivePrice > 0) ? currentBtcLivePrice : 0;
        if (cbPx > 0) {
            intelState.cbSpotPrice = cbPx;
            if (okxPx > 0) {
                intelState.cbPremiumPct = ((cbPx - okxPx) / okxPx) * 100;
            }
        }
    }

    async function fetchDxyAndUs10yIntel() {
        const [dxy, tnx] = await Promise.all([
            fetchYahooSnapshot("DX-Y.NYB"),
            fetchYahooSnapshot("^TNX")
        ]);
        if (dxy) {
            intelState.dxyPrice = dxy.price;
            intelState.dxyChgPct = dxy.chgPct;
        }
        if (tnx) {
            intelState.us10yYield = tnx.price;
            intelState.us10yChgPct = tnx.chgPct;
        }
    }

    window.getMacroIntelSnapshot = function () {
        return intelState;
    };

    window.editMstrBaselinePrompt = function () {
        const rawHold = prompt("请输入 Strategy (MSTR) 最新 BTC 持仓总量（枚）：", String(intelState.mstrBtcHoldings || 850849));
        if (rawHold === null) return;
        const rawAvg = prompt("请输入 Strategy (MSTR) 综合平均购入成本（USD）：", String(intelState.mstrAvgCost || 75452));
        if (rawAvg === null) return;
        const h = parseFloat(rawHold);
        const a = parseFloat(rawAvg);
        if (isFinite(h) && h > 0) intelState.mstrBtcHoldings = Math.round(h);
        if (isFinite(a) && a > 0) intelState.mstrAvgCost = Math.round(a);
        intelState.mstrLatest8k = new Date().toISOString().slice(0, 10) + " 手动";
        saveIntelState();
        if (typeof renderMacroOverviewPanel === "function") renderMacroOverviewPanel();
        if (typeof showToast === "function") showToast("✅ 已更新 Strategy (MSTR) 持仓基准参数");
    };

    window.refreshAutomatedMacroIntel = async function (showMsg = false) {
        if (isFetchingIntel) return;
        isFetchingIntel = true;
        try {
            await Promise.all([
                fetchMstrIntel(),
                fetchBtcOiIntel(),
                fetchCoinbasePremiumIntel(),
                fetchDxyAndUs10yIntel()
            ]);
            intelState.updatedAt = Date.now();
            saveIntelState();
            if (typeof renderMacroOverviewPanel === "function") renderMacroOverviewPanel();
            if (showMsg && typeof showToast === "function") {
                showToast("🧭 已同步 MSTR / BTC OI / Coinbase 溢价 / DXY & 美债 10Y");
            }
        } finally {
            isFetchingIntel = false;
        }
    };

    window.buildExtraMacroIntelCardsHtml = function () {
        const s = intelState;
        const liveBtc = (typeof currentBtcLivePrice !== "undefined" && currentBtcLivePrice > 0) ? currentBtcLivePrice : 0;

        // 1. Strategy (MSTR) 华尔街情绪锚
        const underwaterPct = (liveBtc > 0 && s.mstrAvgCost > 0) ? ((liveBtc - s.mstrAvgCost) / s.mstrAvgCost) * 100 : null;
        const mstrPriceTxt = s.mstrPrice ? `$${s.mstrPrice.toFixed(2)}` : "--";
        const mstrChgTxt = s.mstrChgPct !== null && isFinite(s.mstrChgPct)
            ? ` (${s.mstrChgPct >= 0 ? "+" : ""}${s.mstrChgPct.toFixed(2)}%)`
            : "";
        const mnavTxt = s.mnav ? `mNAV ${s.mnav.toFixed(2)}x` : `8-K ${s.mstrLatest8k}`;
        const mstrCol = s.mstrChgPct !== null ? (s.mstrChgPct >= 0 ? "var(--neon-emerald)" : "var(--neon-red)") : "var(--neon-cyan)";
        const uwTxt = underwaterPct !== null
            ? `BTC 距成本 $${s.mstrAvgCost.toLocaleString()} ${underwaterPct >= 0 ? "+" : ""}${underwaterPct.toFixed(1)}%`
            : `持仓 ${Number(s.mstrBtcHoldings).toLocaleString()} BTC`;

        // 2. BTC 合约 OI 24H 变化
        const oiUsdB = s.oiUsd ? `$${(s.oiUsd / 1e9).toFixed(2)}B` : "--";
        const oiChgTxt = s.oiChg24hPct !== null && isFinite(s.oiChg24hPct)
            ? ` (${s.oiChg24hPct >= 0 ? "+" : ""}${s.oiChg24hPct.toFixed(1)}%)`
            : "";
        const oiCol = s.oiChg24hPct !== null
            ? (Math.abs(s.oiChg24hPct) > 8 ? "var(--neon-amber)" : (s.oiChg24hPct >= 0 ? "var(--neon-cyan)" : "var(--neon-emerald)"))
            : "var(--text-main)";
        const oiTip = s.oiChg24hPct !== null
            ? (s.oiChg24hPct > 6 ? "⚡ 杠杆快速堆积 · 防双向插针" : (s.oiChg24hPct < -5 ? "🧊 杠杆明显出清 · 抛压减轻" : "🟢 持仓规模平稳"))
            : "OKX BTC 永续未平仓量";

        // 3. Coinbase 现货溢价率
        let cbPrem = s.cbPremiumPct;
        if (s.cbSpotPrice > 0 && liveBtc > 0) {
            cbPrem = ((s.cbSpotPrice - liveBtc) / liveBtc) * 100;
        }
        const cbValTxt = cbPrem !== null && isFinite(cbPrem) ? `${cbPrem >= 0 ? "+" : ""}${cbPrem.toFixed(3)}%` : "--";
        const cbCol = cbPrem !== null && isFinite(cbPrem)
            ? (cbPrem >= 0.02 ? "var(--neon-emerald)" : (cbPrem <= -0.04 ? "var(--neon-red)" : "var(--text-main)"))
            : "var(--text-main)";
        const cbTip = cbPrem !== null && isFinite(cbPrem)
            ? (cbPrem >= 0.02 ? "🟢 欧美现货正溢价 · 真买盘支撑" : (cbPrem <= -0.04 ? "🚨 负溢价偏弱 · 防合约诱多" : "⚖️ 现货合约价差中性"))
            : "Coinbase BTC-USD 对比 OKX 永续";

        // 4. DXY 美元指数 & US10Y 美债收益率
        const dxyTxt = s.dxyPrice ? s.dxyPrice.toFixed(2) : "--";
        const us10yTxt = s.us10yYield ? `${s.us10yYield.toFixed(2)}%` : "--";
        const macroPressure = (s.dxyPrice && s.dxyPrice >= 106) || (s.us10yYield && s.us10yYield >= 4.5);

        return `
            <div class="kpi-mini-box" style="border-top:2px solid ${mstrCol}; cursor:pointer;" onclick="editMstrBaselinePrompt()" title="点击可手动微调 MSTR 8-K 持仓与均价（配置新版 Worker 后自动同步）">
                <div class="kpi-mini-label">🏢 MSTR 华尔街情绪锚 (${mnavTxt})</div>
                <div class="kpi-mini-val" style="color:${mstrCol};">${mstrPriceTxt}${mstrChgTxt}</div>
                <div class="kpi-mini-sub">${uwTxt} · ${(s.mstrBtcHoldings / 10000).toFixed(1)}万枚</div>
            </div>
            <div class="kpi-mini-box" style="border-top:2px solid ${oiCol};">
                <div class="kpi-mini-label">📊 BTC 合约未平仓量 (OI 24H)</div>
                <div class="kpi-mini-val" style="color:${oiCol};">${oiUsdB}${oiChgTxt}</div>
                <div class="kpi-mini-sub">${oiTip}</div>
            </div>
            <div class="kpi-mini-box" style="border-top:2px solid ${cbCol};">
                <div class="kpi-mini-label">🇺🇸 Coinbase 现货溢价率</div>
                <div class="kpi-mini-val" style="color:${cbCol};">${cbValTxt}</div>
                <div class="kpi-mini-sub">${cbTip}</div>
            </div>
            <div class="kpi-mini-box" style="border-top:2px solid ${macroPressure ? 'var(--neon-red)' : 'var(--neon-cyan)'};">
                <div class="kpi-mini-label">💧 美元指数 DXY / 美债 10Y</div>
                <div class="kpi-mini-val" style="color:${macroPressure ? 'var(--neon-amber)' : 'var(--neon-cyan)'};">${dxyTxt} / ${us10yTxt}</div>
                <div class="kpi-mini-sub">${macroPressure ? '⚠️ 流动性收紧 · 压制 BTC 与 KORU' : '🟢 全球美元流动性温和'}</div>
            </div>
        `;
    };

    document.addEventListener("DOMContentLoaded", () => {
        setTimeout(() => window.refreshAutomatedMacroIntel(false), 1200);
        setInterval(() => {
            if (document.visibilityState === "visible") {
                window.refreshAutomatedMacroIntel(false);
            }
        }, 180000);
    });
})();
