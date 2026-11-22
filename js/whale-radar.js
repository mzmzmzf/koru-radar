// Hyperliquid 链上聪明钱 & 清算磁铁雷达 (自挂载版 · 公开 Info API)

(function () {
    const STORAGE_KEY = "quant_hl_whales_v1";
    const MAGNET_LINE_KEY = "quant_hl_magnet_lines";
    const HL_INFO_URL = "https://api.hyperliquid.xyz/info";

    const DEFAULT_WHALES = [
        { addr: "0xecb63caa47c7c4e77f60f1ce858cf28dc2b82b00", label: "榜一做市对冲", role: "SMART", note: "多BTC空山寨对冲，勿当纯多头" },
        { addr: "0x7fdafde5cfb5465924316eced2d3715494c517d1", label: "BobbyBigSize", role: "SMART", note: "3.6x 低杠杆稳健大空头" },
        { addr: "0xb695651daa495f59dd2725c6fe98322d8b51a92d", label: "暴跌印钞机", role: "SMART", note: "高位精准做空，无止盈挂单" },
        { addr: "0x45d26f28196d226497130c4bac709d808fed4029", label: "长线宏观空头", role: "SMART", note: "高位死拿 BTC/ETH 空单" },
        { addr: "0x1f250df59a777d61cb8bd043c12970f3afe4f925", label: "AguilaTrades", role: "MAGNET", note: "高倍单边重仓 · 逼空/扫损磁铁" },
        { addr: "0x04889bbfa46fcf754ba06b1ca6d3e83265dcd87d", label: "12x暴力翻手王", role: "MAGNET", note: "高频重仓画门 · 短线清算燃料" }
    ];

    let whaleWatchlist = (() => {
        try {
            const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
            if (Array.isArray(raw) && raw.length > 0) return raw;
        } catch (e) {}
        return DEFAULT_WHALES.slice();
    })();

    let whaleSnapshots = {};
    let isFetchingWhales = false;
    window.showWhaleMagnetLines = localStorage.getItem(MAGNET_LINE_KEY) === "true";

    function saveWatchlist() {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(whaleWatchlist)); } catch (e) {}
    }

    function shortAddr(addr) {
        if (!addr || addr.length < 12) return addr || "";
        return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
    }

    function fmtUsd(num) {
        const abs = Math.abs(num || 0);
        const sign = num < 0 ? "-" : "";
        if (abs >= 1e8) return `${sign}$${(abs / 1e8).toFixed(2)}亿`;
        if (abs >= 1e4) return `${sign}$${(abs / 1e4).toFixed(1)}万`;
        return `${sign}$${abs.toFixed(0)}`;
    }

    function mountWhaleRadarCard() {
        if (document.getElementById("hlWhaleRadarCard")) return;
        const btcView = document.getElementById("view-btc");
        if (!btcView) return;
        const rulesCard = btcView.querySelector(".rules-card");
        const card = document.createElement("div");
        card.className = "card";
        card.id = "hlWhaleRadarCard";
        card.style.cssText = "margin-bottom:12px; border-top: 2px solid rgba(56,189,248,0.45);";
        card.innerHTML = `
            <div class="card-title" style="flex-wrap:wrap; gap:6px; margin-bottom:6px;">
                <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                    <span>🐋 Hyperliquid 链上聪明钱 &amp; 清算磁铁雷达</span>
                    <span class="badge" id="whaleRadarStatus" style="font-size:10px; color:var(--text-muted);">未拉取</span>
                </div>
                <div style="display:flex; align-items:center; gap:5px; flex-wrap:wrap;">
                    <button type="button" class="btn-sm" id="btnToggleWhaleMagnetLines" onclick="toggleWhaleMagnetChartLines()" style="font-size:10.5px; border-color:rgba(244,63,94,0.45); color:#fb7185;" title="开启后将清算磁铁地址的 BTC 强平价投射到主图左侧">🧲 主图磁铁线</button>
                    <button type="button" class="btn-sm" onclick="refreshHyperliquidWhales(true)" style="font-size:10.5px; border-color:var(--neon-cyan); color:var(--neon-cyan);">🔄 刷新</button>
                    <button type="button" class="btn-sm" id="btnToggleWhaleRadarFold" onclick="toggleWhaleRadarBody()" style="font-size:10.5px; color:var(--text-muted);">展开 ▾</button>
                </div>
            </div>
            <div id="whaleRadarBody" style="display:none;">
                <div id="whaleRadarSummary" style="display:grid; grid-template-columns: repeat(3, 1fr); gap:6px; margin-bottom:8px;"></div>
                <div id="whaleRadarList"></div>
                <div style="display:flex; align-items:center; gap:5px; flex-wrap:wrap; margin-top:8px; padding-top:8px; border-top:1px dashed var(--border-color);">
                    <input type="text" id="newWhaleAddrInput" placeholder="粘贴 0x 地址 (支持一次粘贴多行自动提取)" class="form-input" style="flex:2; min-width:170px; padding:4px 8px; font-size:11px;">
                    <input type="text" id="newWhaleLabelInput" placeholder="备注名 (选填)" class="form-input" style="flex:1; min-width:90px; padding:4px 8px; font-size:11px;">
                    <select id="newWhaleRoleSelect" class="form-input" style="width:auto; padding:4px 7px; font-size:11px;">
                        <option value="SMART">🧠 聪明钱</option>
                        <option value="MAGNET">🧲 清算磁铁</option>
                    </select>
                    <button type="button" class="btn-sm" onclick="addCustomWhaleAddress()" style="border-color:var(--neon-emerald); color:var(--neon-emerald); font-weight:700;">+ 添加监控</button>
                    <button type="button" class="btn-sm" onclick="resetDefaultWhales()" style="color:var(--text-muted); font-size:10px;">恢复默认6地址</button>
                </div>
            </div>
        `;
        if (rulesCard) btcView.insertBefore(card, rulesCard);
        else btcView.appendChild(card);
    }

    async function fetchSingleWhaleState(addr) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 7500);
        try {
            const res = await fetch(HL_INFO_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ type: "clearinghouseState", user: addr }),
                signal: controller.signal
            });
            clearTimeout(timer);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            const positions = Array.isArray(data?.assetPositions) ? data.assetPositions : [];
            let btcPos = null;
            let otherCount = 0;
            for (const wrap of positions) {
                const pos = wrap?.position;
                if (!pos) continue;
                const szi = parseFloat(pos.szi) || 0;
                if (Math.abs(szi) < 1e-6) continue;
                if (String(pos.coin || "").toUpperCase() === "BTC") {
                    btcPos = {
                        szi,
                        side: szi > 0 ? "LONG" : "SHORT",
                        entryPx: parseFloat(pos.entryPx) || 0,
                        positionValue: parseFloat(pos.positionValue) || 0,
                        unrealizedPnl: parseFloat(pos.unrealizedPnl) || 0,
                        liquidationPx: parseFloat(pos.liquidationPx) || 0,
                        leverage: pos.leverage?.value || 0
                    };
                } else {
                    otherCount++;
                }
            }
            return {
                btcPos,
                otherCount,
                accountValue: parseFloat(data?.marginSummary?.accountValue) || 0,
                updatedAt: Date.now(),
                error: null
            };
        } catch (err) {
            clearTimeout(timer);
            return {
                btcPos: null,
                otherCount: 0,
                accountValue: 0,
                updatedAt: Date.now(),
                error: err?.name === "AbortError" ? "超时" : "连接受限"
            };
        }
    }

    window.getActiveWhaleMagnetLines = function () {
        if (!window.showWhaleMagnetLines) return [];
        const lines = [];
        for (const w of whaleWatchlist) {
            if (w.role !== "MAGNET") continue;
            const snap = whaleSnapshots[w.addr.toLowerCase()];
            if (!snap || !snap.btcPos) continue;
            if (snap.btcPos.liquidationPx > 0) {
                lines.push({
                    price: snap.btcPos.liquidationPx,
                    color: "#f43f5e",
                    title: `🧲 ${w.label.slice(0, 6)}强平`
                });
            }
        }
        return lines;
    };

    window.toggleWhaleMagnetChartLines = function () {
        window.showWhaleMagnetLines = !window.showWhaleMagnetLines;
        localStorage.setItem(MAGNET_LINE_KEY, window.showWhaleMagnetLines ? "true" : "false");
        const btn = document.getElementById("btnToggleWhaleMagnetLines");
        if (btn) btn.classList.toggle("active", window.showWhaleMagnetLines);
        if (window.showWhaleMagnetLines && Object.keys(whaleSnapshots).length === 0) {
            window.refreshHyperliquidWhales(false);
        }
        if (typeof renderAllLwPriceLines === "function") renderAllLwPriceLines();
        if (typeof showToast === "function") {
            showToast(window.showWhaleMagnetLines
                ? "🧲 已开启 BTC 主图清算磁铁强平线（左侧显示）"
                : "已隐藏主图清算磁铁强平线");
        }
    };

    window.toggleWhaleRadarBody = function () {
        const body = document.getElementById("whaleRadarBody");
        const btn = document.getElementById("btnToggleWhaleRadarFold");
        if (!body) return;
        const hidden = body.style.display === "none";
        body.style.display = hidden ? "block" : "none";
        if (btn) btn.textContent = hidden ? "收起 ▴" : "展开 ▾";
        if (hidden && Object.keys(whaleSnapshots).length === 0) {
            window.refreshHyperliquidWhales(false);
        }
    };

    window.addCustomWhaleAddress = function () {
        const addrEl = document.getElementById("newWhaleAddrInput");
        const labelEl = document.getElementById("newWhaleLabelInput");
        const roleEl = document.getElementById("newWhaleRoleSelect");
        const rawInput = (addrEl?.value || "").trim();
        const label = (labelEl?.value || "").trim();
        const role = roleEl?.value === "MAGNET" ? "MAGNET" : "SMART";
        const matches = rawInput.match(/0x[a-fA-F0-9]{40}/g) || [];
        if (!matches.length) {
            if (typeof showToast === "function") showToast("请输入有效的 42 位 0x 钱包地址");
            return;
        }
        let added = 0;
        matches.forEach((m, idx) => {
            const addr = m.toLowerCase();
            if (whaleWatchlist.some(x => x.addr.toLowerCase() === addr)) return;
            const itemLabel = (matches.length === 1 && label) ? label : (label ? `${label}#${idx + 1}` : shortAddr(addr));
            whaleWatchlist.push({ addr, label: itemLabel, role, note: role === "MAGNET" ? "清算磁铁监控" : "聪明钱监控" });
            added++;
        });
        if (!added) {
            if (typeof showToast === "function") showToast("地址已在监控列表中");
            return;
        }
        saveWatchlist();
        if (addrEl) addrEl.value = "";
        if (labelEl) labelEl.value = "";
        window.refreshHyperliquidWhales(true);
    };

    window.removeWhaleAddress = function (addr) {
        whaleWatchlist = whaleWatchlist.filter(x => x.addr.toLowerCase() !== String(addr).toLowerCase());
        saveWatchlist();
        renderWhaleRadarUI();
        if (window.showWhaleMagnetLines && typeof renderAllLwPriceLines === "function") renderAllLwPriceLines();
    };

    window.resetDefaultWhales = function () {
        whaleWatchlist = DEFAULT_WHALES.slice();
        saveWatchlist();
        window.refreshHyperliquidWhales(true);
    };

    function renderWhaleRadarUI() {
        const listEl = document.getElementById("whaleRadarList");
        const summaryEl = document.getElementById("whaleRadarSummary");
        const magnetBtn = document.getElementById("btnToggleWhaleMagnetLines");
        if (magnetBtn) magnetBtn.classList.toggle("active", window.showWhaleMagnetLines);
        if (!listEl) return;

        const liveBtc = (typeof currentBtcLivePrice !== "undefined" && currentBtcLivePrice > 0) ? currentBtcLivePrice : 0;
        let smartNetBtc = 0, magnetGrossUsd = 0, nearestMagnet = null;

        whaleWatchlist.forEach(w => {
            const snap = whaleSnapshots[w.addr.toLowerCase()];
            if (!snap || !snap.btcPos) return;
            if (w.role === "SMART") {
                smartNetBtc += snap.btcPos.szi;
            } else {
                magnetGrossUsd += Math.abs(snap.btcPos.positionValue || 0);
                if (snap.btcPos.liquidationPx > 0 && liveBtc > 0) {
                    const distPct = Math.abs((snap.btcPos.liquidationPx - liveBtc) / liveBtc) * 100;
                    if (!nearestMagnet || distPct < nearestMagnet.distPct) {
                        nearestMagnet = { label: w.label, liqPx: snap.btcPos.liquidationPx, distPct };
                    }
                }
            }
        });

        if (summaryEl) {
            const netColor = smartNetBtc > 0 ? "var(--neon-emerald)" : (smartNetBtc < 0 ? "var(--neon-red)" : "var(--text-muted)");
            const nearestTxt = nearestMagnet ? `${nearestMagnet.liqPx.toFixed(0)} (${nearestMagnet.distPct.toFixed(1)}%)` : "暂无活跃强平";
            summaryEl.innerHTML = `
                <div class="kpi-mini-box" style="padding:7px 8px;"><div class="kpi-mini-label">🧠 聪明钱 BTC 净敞口</div><div class="kpi-mini-val" style="font-size:13px; color:${netColor};">${smartNetBtc >= 0 ? "+" : ""}${smartNetBtc.toFixed(1)} BTC</div></div>
                <div class="kpi-mini-box" style="padding:7px 8px;"><div class="kpi-mini-label">🧲 磁铁单边总仓位</div><div class="kpi-mini-val" style="font-size:13px; color:var(--neon-amber);">${fmtUsd(magnetGrossUsd)}</div></div>
                <div class="kpi-mini-box" style="padding:7px 8px;"><div class="kpi-mini-label">💥 最近磁铁强平位</div><div class="kpi-mini-val" style="font-size:13px; color:${nearestMagnet && nearestMagnet.distPct < 4 ? 'var(--neon-red)' : 'var(--neon-cyan)'};">${nearestTxt}</div></div>
            `;
        }

        listEl.innerHTML = whaleWatchlist.map(w => {
            const snap = whaleSnapshots[w.addr.toLowerCase()];
            const isMagnet = w.role === "MAGNET";
            const roleBadge = isMagnet
                ? `<span class="badge" style="padding:0 5px; font-size:10px; border-color:#f43f5e; color:#fb7185;">🧲 磁铁</span>`
                : `<span class="badge" style="padding:0 5px; font-size:10px; border-color:#38bdf8; color:#38bdf8;">🧠 聪明钱</span>`;
            let posHtml = `<span style="color:var(--text-muted);">点击“🔄 刷新”拉取链上持仓</span>`;
            if (snap) {
                if (snap.error) {
                    posHtml = `<span style="color:var(--neon-amber);">⚠️ ${snap.error}（可点右侧直达 Hyperdash）</span>`;
                } else if (!snap.btcPos) {
                    posHtml = `<span style="color:var(--text-muted);">当前空仓 BTC${snap.otherCount > 0 ? `（持有 ${snap.otherCount} 个其他币种）` : ""}</span>`;
                } else {
                    const p = snap.btcPos;
                    const sideCol = p.side === "LONG" ? "var(--neon-emerald)" : "var(--neon-red)";
                    const pnlCol = p.unrealizedPnl >= 0 ? "var(--neon-emerald)" : "var(--neon-red)";
                    const liqDist = (p.liquidationPx > 0 && liveBtc > 0) ? ` (${(((p.liquidationPx - liveBtc) / liveBtc) * 100).toFixed(1)}%)` : "";
                    posHtml = `
                        <span style="color:${sideCol}; font-weight:800;">${p.side === "LONG" ? "多" : "空"} ${Math.abs(p.szi).toFixed(1)} BTC</span>
                        <span style="color:var(--text-muted);">(${fmtUsd(p.positionValue)}${p.leverage ? ` · ${p.leverage}x` : ""})</span>
                        · 均价 <b>${p.entryPx.toFixed(0)}</b>
                        · 浮盈 <b style="color:${pnlCol};">${p.unrealizedPnl >= 0 ? "+" : ""}${fmtUsd(p.unrealizedPnl)}</b>
                        ${p.liquidationPx > 0 ? `· 强平 <b style="color:#fb7185;">${p.liquidationPx.toFixed(0)}${liqDist}</b>` : ""}
                    `;
                }
            }
            return `<div style="padding:7px 8px; border-bottom:1px dashed var(--border-color); font-size:11px; display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
                <div style="line-height:1.5; min-width:0;">
                    <div style="display:flex; align-items:center; gap:5px; flex-wrap:wrap;">
                        ${roleBadge}
                        <b style="color:var(--text-main);">${w.label}</b>
                        <span style="color:var(--text-muted); font-family:monospace; font-size:10px;">${shortAddr(w.addr)}</span>
                        <span style="color:var(--text-muted); font-size:10px;">${w.note || ""}</span>
                    </div>
                    <div style="font-family:monospace; margin-top:2px;">${posHtml}</div>
                </div>
                <div style="display:flex; gap:4px; flex-shrink:0;">
                    <a href="https://hyperdash.info/trader/${w.addr}" target="_blank" rel="noopener noreferrer" class="btn-sm" style="padding:1px 6px; font-size:10px; text-decoration:none; color:var(--neon-cyan);">详情 ↗</a>
                    <button type="button" class="btn-sm" onclick="removeWhaleAddress('${w.addr}')" style="padding:1px 5px; font-size:10px; color:#f87171;">✕</button>
                </div>
            </div>`;
        }).join("");
    }

    window.refreshHyperliquidWhales = async function (showMsg = false) {
        if (isFetchingWhales) return;
        isFetchingWhales = true;
        const statusEl = document.getElementById("whaleRadarStatus");
        if (statusEl) statusEl.textContent = "同步链上持仓中...";
        try {
            const results = await Promise.all(
                whaleWatchlist.map(async (w) => [w.addr.toLowerCase(), await fetchSingleWhaleState(w.addr)])
            );
            results.forEach(([k, v]) => { whaleSnapshots[k] = v; });
            renderWhaleRadarUI();
            if (window.showWhaleMagnetLines && typeof renderAllLwPriceLines === "function") renderAllLwPriceLines();
            const tStr = new Date().toTimeString().slice(0, 8);
            if (statusEl) statusEl.textContent = `已更新 ${tStr}`;
            if (showMsg && typeof showToast === "function") showToast("🐋 Hyperliquid 链上鲸鱼持仓已刷新");
        } finally {
            isFetchingWhales = false;
        }
    };

    document.addEventListener("DOMContentLoaded", () => {
        mountWhaleRadarCard();
        renderWhaleRadarUI();
        if (window.showWhaleMagnetLines) window.refreshHyperliquidWhales(false);
        setInterval(() => {
            const body = document.getElementById("whaleRadarBody");
            if (document.visibilityState === "visible" && body && body.style.display !== "none") {
                window.refreshHyperliquidWhales(false);
            }
        }, 60000);
    });
})();
