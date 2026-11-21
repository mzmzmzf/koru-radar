// 多市场行情网关与 K 线数据路由模块 (OKX / 东方财富美股 / Yahoo / CryptoCompare / 自定义中继)

function getCustomRelayBase() {
    const raw = (localStorage.getItem("quant_custom_relay_url") || "").trim();
    if (!raw) return "";
    return raw.replace(new RegExp("/+$"), "");
}

function buildRelayTargetUrl(relayBase, targetUrl) {
    const sep = relayBase.includes("?") ? "&" : "?";
    return `${relayBase}${sep}url=${encodeURIComponent(targetUrl)}`;
}

async function fetchJsonWithTimeout(url, timeoutMs = 2800) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetch(url, { cache: "no-store", signal: ctrl.signal });
        clearTimeout(timer);
        if (!res.ok) throw new Error("HTTP " + res.status);
        return await res.json();
    } catch (e) {
        clearTimeout(timer);
        throw e;
    }
}

async function smartFetchJson(targetUrl, opts = {}) {
    const timeoutMs = opts.timeoutMs || 2800;
    const customRelay = getCustomRelayBase();

    // 1. 若已配置自定义域名中继，优先走自定义中继（国内免翻墙直通）
    if (customRelay) {
        try {
            const relayedUrl = buildRelayTargetUrl(customRelay, targetUrl);
            const data = await fetchJsonWithTimeout(relayedUrl, timeoutMs);
            return { data, via: "CUSTOM_RELAY" };
        } catch (e) {}
    }

    // 2. 自动构建多镜像竞速列表（兼容海外直连与国内镜像）
    const candidates = [targetUrl];
    if (targetUrl.startsWith("https://www.okx.com/")) {
        candidates.push(targetUrl.replace("https://www.okx.com/", "https://aws.okx.com/"));
    }
    if (Array.isArray(opts.extraUrls)) {
        opts.extraUrls.forEach(u => candidates.push(u));
    }

    for (const candidateUrl of candidates) {
        try {
            const data = await fetchJsonWithTimeout(candidateUrl, timeoutMs);
            return { data, via: "DIRECT" };
        } catch (e) {}
    }
    throw new Error("All routes failed for " + targetUrl);
}


function aggregateCandlesByStep(candles, step) {
    if (!step || step <= 1) return candles;
    const out = [];
    for (let i = 0; i < candles.length; i += step) {
        const chunk = candles.slice(i, i + step);
        if (!chunk.length) continue;
        let hi = -Infinity, lo = Infinity, volSum = 0;
        chunk.forEach(c => {
            if (c.high > hi) hi = c.high;
            if (c.low < lo) lo = c.low;
            volSum += (c.vol || 0);
        });
        out.push({
            time: chunk[0].time,
            open: chunk[0].open,
            high: hi,
            low: lo,
            close: chunk[chunk.length - 1].close,
            vol: volSum
        });
    }
    return out;
}

async function fetchCryptoCompareFallbackCandles(ticker, interval) {
    const sym = String(ticker || "").toUpperCase();
    if (sym === "KORU") return [];
    const cfgMap = {
        "1":   { ep: "histominute", agg: 1,  limit: 240 },
        "5":   { ep: "histominute", agg: 5,  limit: 240 },
        "15":  { ep: "histominute", agg: 15, limit: 240 },
        "60":  { ep: "histohour",   agg: 1,  limit: 240 },
        "240": { ep: "histohour",   agg: 4,  limit: 240 },
        "D":   { ep: "histoday",    agg: 1,  limit: 240 },
        "3D":  { ep: "histoday",    agg: 3,  limit: 240 },
        "W":   { ep: "histoday",    agg: 7,  limit: 240 },
        "M":   { ep: "histoday",    agg: 30, limit: 240 }
    };
    const cfg = cfgMap[interval] || cfgMap["60"];
    const url = `https://min-api.cryptocompare.com/data/v2/${cfg.ep}?fsym=${encodeURIComponent(sym)}&tsym=USD&limit=${cfg.limit}&aggregate=${cfg.agg}`;
    try {
        const json = await fetchJsonWithTimeout(url, 3200);
        const rows = json?.Data?.Data;
        if (Array.isArray(rows) && rows.length >= 5) {
            const out = [];
            const seen = new Set();
            rows.forEach(r => {
                if (r && r.time && r.close > 0 && !seen.has(r.time)) {
                    seen.add(r.time);
                    out.push({
                        time: Number(r.time),
                        open: Number(r.open),
                        high: Number(r.high),
                        low: Number(r.low),
                        close: Number(r.close),
                        vol: Number(r.volumeto) || Number(r.volumefrom) || 0
                    });
                }
            });
            return out;
        }
    } catch (e) {}
    return [];
}

async function fetchOkxCandlesForSymbol(symObj, interval) {
    const barMap = { "1": "1m", "5": "5m", "15": "15m", "60": "1H", "240": "4H", "D": "1Dutc", "3D": "3Dutc", "W": "1Wutc", "M": "1Mutc" };
    const bar = barMap[interval] || "1H";
    const tk = String(symObj.ticker || symObj.id || "").toUpperCase().replace(/^OKX:/, "");
    const candidates = [...new Set([
        symObj.okxInstId || `${tk}-USDT-SWAP`,
        `${tk}-USDT-SWAP`,
        `X${tk}-USDT-SWAP`,
        `${tk}-USDT`
    ])];

    for (const instId of candidates) {
        try {
            const primaryUrl = `https://www.okx.com/api/v5/market/candles?instId=${instId}&bar=${bar}&limit=240`;
            let { data: json } = await smartFetchJson(primaryUrl, { timeoutMs: 2800 });
            if ((json?.code !== "0" || !Array.isArray(json.data) || json.data.length === 0) && bar.endsWith("utc")) {
                const fallbackBar = bar.replace("utc", "");
                const fbUrl = `https://www.okx.com/api/v5/market/candles?instId=${instId}&bar=${fallbackBar}&limit=240`;
                const fbOut = await smartFetchJson(fbUrl, { timeoutMs: 2800 });
                json = fbOut.data;
            }
            if (json?.code === "0" && Array.isArray(json.data) && json.data.length >= 5) {
                const rawReversed = json.data.slice().reverse();
                const seenTimes = new Set();
                const candles = [];
                rawReversed.forEach(row => {
                    const t = Math.floor(parseInt(row[0], 10) / 1000);
                    if (!seenTimes.has(t)) {
                        seenTimes.add(t);
                        candles.push({
                            time: t,
                            open: parseFloat(row[1]),
                            high: parseFloat(row[2]),
                            low: parseFloat(row[3]),
                            close: parseFloat(row[4]),
                            vol: parseFloat(row[5]) || 0
                        });
                    }
                });
                return candles;
            }
        } catch (e) {}
    }

    // 仅对纯加密货币（BTC/ETH/SOL等）回退至 CryptoCompare 现货K线，避免误用错误数据源
    if (KNOWN_CRYPTO_ONLY.has(tk)) {
        return await fetchCryptoCompareFallbackCandles(tk, interval);
    }
    return [];
}

function parseYahooChartPayload(json, aggStep = 1) {
    const result = json?.chart?.result?.[0];
    if (!result || !Array.isArray(result.timestamp) || !result.indicators?.quote?.[0]) return [];
    const tsArr = result.timestamp;
    const q = result.indicators.quote[0];
    const seenTimes = new Set();
    const rawCandles = [];

    for (let i = 0; i < tsArr.length; i++) {
        const t = tsArr[i];
        const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i];
        if (t == null || o == null || h == null || l == null || c == null) continue;
        if (!seenTimes.has(t)) {
            seenTimes.add(t);
            rawCandles.push({
                time: Number(t),
                open: Number(o),
                high: Number(h),
                low: Number(l),
                close: Number(c),
                vol: Number(q.volume?.[i]) || 0
            });
        }
    }
    if (rawCandles.length < 5) return [];
    return aggregateCandlesByStep(rawCandles, aggStep).slice(-240);
}

function parseEastmoneyUsKlineRows(klines, aggStep = 1) {
    if (!Array.isArray(klines) || klines.length < 5) return [];
    const parsed = [];
    const seen = new Set();

    klines.forEach(line => {
        // fields2=f51,f52,f53,f54,f55,f56 -> 时间,开盘,收盘,最高,最低,成交量
        const parts = String(line).split(",");
        if (parts.length < 5) return;
        const m = parts[0].trim().match(/(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}):(\d{2}))?/);
        if (!m) return;

        const yr = Number(m[1]), mo = Number(m[2]), dy = Number(m[3]);
        const hr = m[4] !== undefined ? Number(m[4]) : 16;
        const mi = m[5] !== undefined ? Number(m[5]) : 0;
        // 美东时间 (America/New_York) 精确换算为 UTC 秒时间戳，使图表 UTC+8 坐标完全准确
        const isDst = (mo > 3 && mo < 11) || (mo === 3 && dy >= 8) || (mo === 11 && dy <= 7);
        const utcOffsetHours = isDst ? 4 : 5;
        const ts = Math.floor(Date.UTC(yr, mo - 1, dy, hr + utcOffsetHours, mi, 0) / 1000);

        const o = parseFloat(parts[1]);
        const c = parseFloat(parts[2]);
        const h = parseFloat(parts[3]);
        const l = parseFloat(parts[4]);
        const v = parseFloat(parts[5]) || 0;
        if (!isFinite(o) || !isFinite(c) || !isFinite(h) || !isFinite(l) || c <= 0) return;
        if (!seen.has(ts)) {
            seen.add(ts);
            parsed.push({ time: ts, open: o, high: h, low: l, close: c, vol: v });
        }
    });

    parsed.sort((a, b) => a.time - b.time);
    if (parsed.length < 5) return [];
    return aggregateCandlesByStep(parsed, aggStep).slice(-240);
}

async function resolveEastmoneyUsSecId(ticker) {
    const tk = String(ticker || "").toUpperCase();
    if (EM_US_SECID_MAP[tk]) return EM_US_SECID_MAP[tk];
    try {
        const cachedMap = JSON.parse(localStorage.getItem("quant_em_secid_cache") || "{}");
        if (cachedMap[tk]) return cachedMap[tk];
    } catch (e) {}

    try {
        const suggestUrl = `https://searchapi.eastmoney.com/api/suggest/get?input=${encodeURIComponent(tk)}&type=14&token=D43BF722C8E33BDC906FB84D85E756E8&count=6`;
        const json = await fetchJsonWithTimeout(suggestUrl, 2600);
        const items = json?.QuotationCodeTable?.Data;
        if (Array.isArray(items)) {
            const hit = items.find(x =>
                String(x.Code || "").toUpperCase() === tk &&
                ["105", "106", "107"].includes(String(x.MktNum || ""))
            );
            if (hit && hit.QuoteID) {
                try {
                    const cachedMap = JSON.parse(localStorage.getItem("quant_em_secid_cache") || "{}");
                    cachedMap[tk] = hit.QuoteID;
                    localStorage.setItem("quant_em_secid_cache", JSON.stringify(cachedMap));
                } catch (e) {}
                return hit.QuoteID;
            }
        }
    } catch (e) {}
    return "";
}

async function fetchEastmoneyUsCandles(symObj, interval) {
    const tk = String(symObj.ticker || symObj.id || "").toUpperCase().replace(/^US:/, "");
    if (!tk) return [];

    // 东方财富 K 线周期代码: 1=1m, 5=5m, 15=15m, 60=1H, 101=1D, 102=1W, 103=1M
    const kltMap = { "1": "1", "5": "5", "15": "15", "60": "60", "240": "60", "D": "101", "3D": "101", "W": "102", "M": "103" };
    const aggMap = { "1": 1,   "5": 1,   "15": 1,    "60": 1,    "240": 4,    "D": 1,     "3D": 3,     "W": 1,     "M": 1 };
    const klt = kltMap[interval] || "60";
    const aggStep = aggMap[interval] || 1;
    const lmt = Math.min(960, 245 * aggStep);

    const knownSecId = symObj.emSecId || await resolveEastmoneyUsSecId(tk);
    const secIdCandidates = [...new Set([
        knownSecId,
        `105.${tk}`,
        `107.${tk}`,
        `106.${tk}`
    ].filter(Boolean))];

    for (const secid of secIdCandidates) {
        try {
            const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${encodeURIComponent(secid)}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56&klt=${klt}&fqt=1&end=20500101&lmt=${lmt}`;
            const json = await fetchJsonWithTimeout(url, 3200);
            const klines = json?.data?.klines;
            const candles = parseEastmoneyUsKlineRows(klines, aggStep);
            if (candles.length >= 5) {
                symObj.emSecId = secid;
                return candles;
            }
        } catch (e) {}
    }
    return [];
}

async function fetchUsEquityCandlesForSymbol(symObj, interval) {
    const ticker = String(symObj.ticker || symObj.id || "").toUpperCase().replace(/^US:/, "");
    const cfgMap = {
        "1":   { yfInt: "1m",  yfRange: "5d",  agg: 1 },
        "5":   { yfInt: "5m",  yfRange: "1mo", agg: 1 },
        "15":  { yfInt: "15m", yfRange: "1mo", agg: 1 },
        "60":  { yfInt: "60m", yfRange: "3mo", agg: 1 },
        "240": { yfInt: "60m", yfRange: "6mo", agg: 4 },
        "D":   { yfInt: "1d",  yfRange: "1y",  agg: 1 },
        "3D":  { yfInt: "1d",  yfRange: "2y",  agg: 3 },
        "W":   { yfInt: "1wk", yfRange: "5y",  agg: 1 },
        "M":   { yfInt: "1mo", yfRange: "10y", agg: 1 }
    };
    const cfg = cfgMap[interval] || cfgMap["60"];
    const yfUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=${cfg.yfInt}&range=${cfg.yfRange}&includePrePost=false`;

    // 1. 优先通过国内三网直连的东方财富美股/ETF K线接口获取（全周期 1m/5m/15m/1H/4H/1D/1W/1M 免翻墙秒出）
    const emCandles = await fetchEastmoneyUsCandles(symObj, interval);
    if (emCandles.length >= 5) return emCandles;

    // 2. 若已配置自定义中继，走自定义中继请求 Yahoo Finance
    const customRelay = getCustomRelayBase();
    if (customRelay) {
        try {
            const json = await fetchJsonWithTimeout(buildRelayTargetUrl(customRelay, yfUrl), 4000);
            const candles = parseYahooChartPayload(json, cfg.agg);
            if (candles.length >= 5) return candles;
        } catch (e) {}
    }

    // 3. 备用公共镜像代理
    const candidateUrls = [
        `https://corsproxy.io/?url=${encodeURIComponent(yfUrl)}`,
        `https://api.allorigins.win/raw?url=${encodeURIComponent(yfUrl)}`
    ];
    for (const u of candidateUrls) {
        try {
            const json = await fetchJsonWithTimeout(u, 2800);
            const candles = parseYahooChartPayload(json, cfg.agg);
            if (candles.length >= 5) return candles;
        } catch (e) {}
    }
    return [];
}

