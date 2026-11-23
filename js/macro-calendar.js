// 关键时间节点倒计时 & 宏观核弹日历模块 (UTC+8 北京时间基准)

(function () {
    const CUSTOM_EVENTS_KEY = "quant_custom_macro_events_v1";

    // 内置经官方日历核验的高影响宏观事件 (UTC+8)
    const BUILTIN_MACRO_EVENTS = [
        { id: "msci_20261130", title: "MSCI 指数季度调整生效窗口 (关注 MSTR 权重)", market: "BOTH", impact: "HIGH", iso: "2026-12-01T05:00:00+08:00" },
        { id: "fomc_202612", title: "美联储 FOMC 利率决议 & 点阵图", market: "BOTH", impact: "HIGH", iso: "2026-12-10T03:00:00+08:00" },
        { id: "cpi_202612", title: "美国 11 月 CPI 通胀数据", market: "BOTH", impact: "HIGH", iso: "2026-12-10T21:30:00+08:00" },
        { id: "ppi_202612", title: "美国 11 月 PPI 生产者物价", market: "BOTH", impact: "MED", iso: "2026-12-15T21:30:00+08:00" },
        { id: "nfp_202701", title: "美国 12 月非农就业报告 (NFP)", market: "BOTH", impact: "HIGH", iso: "2027-01-08T21:30:00+08:00" },
        { id: "cpi_202701", title: "美国 12 月 CPI 通胀数据", market: "BOTH", impact: "HIGH", iso: "2027-01-13T21:30:00+08:00" },
        { id: "ppi_202701", title: "美国 12 月 PPI 生产者物价", market: "BOTH", impact: "MED", iso: "2027-01-14T21:30:00+08:00" }
    ];

    function loadCustomMacroEvents() {
        try {
            const raw = JSON.parse(localStorage.getItem(CUSTOM_EVENTS_KEY) || "[]");
            return Array.isArray(raw) ? raw : [];
        } catch (e) {
            return [];
        }
    }

    function saveCustomMacroEvents(list) {
        try {
            localStorage.setItem(CUSTOM_EVENTS_KEY, JSON.stringify(list));
        } catch (e) {}
    }

    function isUsDstNow(date) {
        try {
            const parts = new Intl.DateTimeFormat("en-US", {
                timeZone: "America/New_York",
                timeZoneName: "short"
            }).formatToParts(date);
            const tz = parts.find(p => p.type === "timeZoneName")?.value || "";
            return tz.includes("EDT");
        } catch (e) {
            const m = date.getUTCMonth() + 1;
            return m >= 4 && m <= 10;
        }
    }

    function getBjParts(nowMs) {
        const bj = new Date(nowMs + 8 * 3600 * 1000);
        return {
            year: bj.getUTCFullYear(),
            month: bj.getUTCMonth(),
            day: bj.getUTCDate(),
            dow: bj.getUTCDay(), // 0 Sun .. 6 Sat
            hour: bj.getUTCHours(),
            min: bj.getUTCMinutes(),
            sec: bj.getUTCSeconds()
        };
    }

    function bjTimeToMs(year, month, day, hour, min) {
        return Date.UTC(year, month, day, hour - 8, min, 0, 0);
    }

    function formatCountdown(ms) {
        if (ms <= 0) return "00:00:00";
        const totalSec = Math.floor(ms / 1000);
        const days = Math.floor(totalSec / 86400);
        const hrs = Math.floor((totalSec % 86400) / 3600);
        const mins = Math.floor((totalSec % 3600) / 60);
        const secs = totalSec % 60;
        const pad = (n) => String(n).padStart(2, "0");
        if (days > 0) return `${days}天 ${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
        return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
    }

    function computeRecurringNodes(nowMs) {
        const p = getBjParts(nowMs);

        // 1. 下一次加密 8H 资金费率结算 (00:00 / 08:00 / 16:00 UTC+8)
        let nextFundHour = 8;
        let nextFundDayOffset = 0;
        if (p.hour < 8) nextFundHour = 8;
        else if (p.hour < 16) nextFundHour = 16;
        else { nextFundHour = 0; nextFundDayOffset = 1; }
        const fundingMs = bjTimeToMs(p.year, p.month, p.day + nextFundDayOffset, nextFundHour, 0);

        // 2. 加密日线收线 (08:00 UTC+8)
        const dailyCloseOffset = p.hour >= 8 ? 1 : 0;
        const dailyCloseMs = bjTimeToMs(p.year, p.month, p.day + dailyCloseOffset, 8, 0);

        // 3. 美股常规盘开盘 (周一至周五，夏令时 21:30 / 冬令时 22:30 UTC+8)
        const dst = isUsDstNow(new Date(nowMs));
        const usOpenHour = dst ? 21 : 22;
        const usOpenMin = 30;
        let usOffset = 0;
        for (let i = 0; i <= 7; i++) {
            const candMs = bjTimeToMs(p.year, p.month, p.day + i, usOpenHour, usOpenMin);
            const candDow = new Date(candMs + 8 * 3600 * 1000).getUTCDay();
            if (candDow >= 1 && candDow <= 5 && candMs > nowMs) {
                usOffset = i;
                break;
            }
        }
        const usOpenMs = bjTimeToMs(p.year, p.month, p.day + usOffset, usOpenHour, usOpenMin);

        // 4. Deribit 期权周度交割 (每周五 16:00 UTC+8)
        let friOffset = (5 - p.dow + 7) % 7;
        let optMs = bjTimeToMs(p.year, p.month, p.day + friOffset, 16, 0);
        if (optMs <= nowMs) {
            optMs = bjTimeToMs(p.year, p.month, p.day + friOffset + 7, 16, 0);
        }

        return [
            { key: "funding", icon: "💸", label: "资金费率结算", sub: `${String(nextFundHour).padStart(2, "0")}:00 UTC+8`, targetMs: fundingMs, warnMs: 20 * 60 * 1000 },
            { key: "usopen", icon: "🇺🇸", label: `美股开盘 (${dst ? "夏令时" : "冬令时"})`, sub: `${usOpenHour}:30 UTC+8`, targetMs: usOpenMs, warnMs: 30 * 60 * 1000 },
            { key: "daily", icon: "🕯️", label: "加密日线收线", sub: "08:00 UTC+8", targetMs: dailyCloseMs, warnMs: 30 * 60 * 1000 },
            { key: "options", icon: "🎯", label: "周五期权交割", sub: "周五 16:00 UTC+8", targetMs: optMs, warnMs: 2 * 3600 * 1000 }
        ];
    }

    function getUpcomingMacroEvents(nowMs) {
        const all = BUILTIN_MACRO_EVENTS.concat(loadCustomMacroEvents());
        return all
            .map(ev => ({ ...ev, ts: Date.parse(ev.iso) }))
            .filter(ev => isFinite(ev.ts) && ev.ts > nowMs - 2 * 3600 * 1000)
            .sort((a, b) => a.ts - b.ts);
    }

    function formatBjDateTime(ts) {
        const d = new Date(ts + 8 * 3600 * 1000);
        const pad = (n) => String(n).padStart(2, "0");
        return `${d.getUTCMonth() + 1}/${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
    }

    window.toggleMacroCalendarDrawer = function (forceState) {
        const el = document.getElementById("macroCalendarDrawer");
        if (!el) return;
        const show = typeof forceState === "boolean" ? forceState : el.style.display === "none";
        if (show && typeof closeAllTopDrawers === "function") closeAllTopDrawers("macroCalendarDrawer");
        el.style.display = show ? "block" : "none";
        if (typeof syncTopDrawerBackdrop === "function") syncTopDrawerBackdrop();
        if (show) window.updateMacroClockUI();
    };

    window.addCustomMacroEvent = function () {
        const titleEl = document.getElementById("customMacroTitle");
        const timeEl = document.getElementById("customMacroTime");
        const marketEl = document.getElementById("customMacroMarket");
        const title = (titleEl?.value || "").trim();
        const rawTime = (timeEl?.value || "").trim();
        const market = marketEl?.value || "BOTH";
        if (!title || !rawTime) {
            if (typeof showToast === "function") showToast("请填写事件名称与北京时间");
            return;
        }
        const iso = rawTime.length === 16 ? `${rawTime}:00+08:00` : `${rawTime}+08:00`;
        if (!isFinite(Date.parse(iso))) {
            if (typeof showToast === "function") showToast("时间格式无效");
            return;
        }
        const list = loadCustomMacroEvents();
        list.push({
            id: "cust_" + Date.now(),
            title,
            market,
            impact: "HIGH",
            iso,
            custom: true
        });
        saveCustomMacroEvents(list);
        if (titleEl) titleEl.value = "";
        if (timeEl) timeEl.value = "";
        window.updateMacroClockUI();
        if (typeof showToast === "function") showToast(`📅 已添加宏观事件：${title}`);
    };

    window.deleteCustomMacroEvent = function (id) {
        const list = loadCustomMacroEvents().filter(x => x.id !== id);
        saveCustomMacroEvents(list);
        window.updateMacroClockUI();
    };

    window.updateMacroClockUI = function () {
        const nowMs = Date.now();
        const nodes = computeRecurringNodes(nowMs);
        const events = getUpcomingMacroEvents(nowMs);

        // 顶部状态栏紧凑倒计时胶囊
        const badge = document.getElementById("btnMacroClockBadge");
        if (badge) {
            const nextMacro = events[0];
            const macroDiff = nextMacro ? (nextMacro.ts - nowMs) : Infinity;
            const nearestNode = nodes.slice().sort((a, b) => (a.targetMs - nowMs) - (b.targetMs - nowMs))[0];
            const nodeDiff = nearestNode ? (nearestNode.targetMs - nowMs) : Infinity;

            if (nextMacro && macroDiff <= 24 * 3600 * 1000 && macroDiff > 0) {
                badge.textContent = `🚨 ${nextMacro.title.slice(0, 8)} ${formatCountdown(macroDiff)}`;
                badge.style.borderColor = "#ef4444";
                badge.style.color = "#f87171";
            } else if (nearestNode && nodeDiff <= nearestNode.warnMs) {
                badge.textContent = `⚡ ${nearestNode.label.slice(0, 4)} ${formatCountdown(nodeDiff)}`;
                badge.style.borderColor = "#f59e0b";
                badge.style.color = "#fbbf24";
            } else if (nearestNode) {
                badge.textContent = `⏱️ ${nearestNode.label.slice(0, 4)} ${formatCountdown(nodeDiff)}`;
                badge.style.borderColor = "var(--border-color)";
                badge.style.color = "var(--text-main)";
            }
        }

        const drawer = document.getElementById("macroCalendarDrawer");
        if (!drawer || drawer.style.display === "none") return;

        // 1. 渲染每日/每周固定盘口节点
        const nodesEl = document.getElementById("macroRecurringNodesGrid");
        if (nodesEl) {
            nodesEl.innerHTML = nodes.map(n => {
                const diff = n.targetMs - nowMs;
                const isSoon = diff <= n.warnMs;
                return `<div class="kpi-mini-box" style="border-color:${isSoon ? '#f59e0b' : 'var(--border-color)'};">
                    <div class="kpi-mini-label">${n.icon} ${n.label}</div>
                    <div class="kpi-mini-val" style="font-size:14px; color:${isSoon ? 'var(--neon-amber)' : 'var(--neon-cyan)'};">${formatCountdown(diff)}</div>
                    <div class="kpi-mini-sub">${n.sub}${isSoon ? " · ⚠️ 临近易插针" : ""}</div>
                </div>`;
            }).join("");
        }

        // 2. 渲染宏观核弹日历列表
        const listEl = document.getElementById("macroEventsList");
        if (listEl) {
            if (!events.length) {
                listEl.innerHTML = `<div style="font-size:11px; color:var(--text-muted); padding:4px 0;">暂无未来宏观事件，可在下方手动添加 BOK / BOJ / 财报等自定义节点。</div>`;
            } else {
                listEl.innerHTML = events.slice(0, 8).map(ev => {
                    const diff = ev.ts - nowMs;
                    const isImminent = diff <= 24 * 3600 * 1000 && diff > 0;
                    const isLive = diff <= 0;
                    const mTag = ev.market === "CRYPTO" ? "🪙 加密" : (ev.market === "US" ? "🇺🇸 美股" : "🌐 双市场");
                    const delBtn = ev.custom
                        ? `<button type="button" class="btn-sm" onclick="deleteCustomMacroEvent('${ev.id}')" style="padding:1px 5px; font-size:10px; color:#f87171;">✕</button>`
                        : "";
                    return `<div style="display:flex; justify-content:space-between; align-items:center; gap:8px; padding:6px 8px; border-bottom:1px dashed var(--border-color); font-size:11px;">
                        <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                            <span class="badge" style="padding:0 5px; font-size:10px; border-color:${isImminent ? '#ef4444' : 'var(--border-color)'}; color:${isImminent ? '#f87171' : 'var(--text-muted)'};">${mTag}</span>
                            <b style="color:var(--text-main);">${ev.title}</b>
                            <span style="color:var(--text-muted); font-family:monospace;">${formatBjDateTime(ev.ts)} (北京时间)</span>
                        </div>
                        <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
                            <span style="font-family:monospace; font-weight:800; color:${isLive ? '#ef4444' : (isImminent ? '#f59e0b' : 'var(--neon-emerald)')};">${isLive ? "已公布/进行中" : formatCountdown(diff)}</span>
                            ${delBtn}
                        </div>
                    </div>`;
                }).join("");
            }
        }
    };
})();
