// 战备纪律提醒 + 随手复盘记录（极简静态视觉 · 全量北京时间 UTC+8 · localStorage 本地持久化）

(function () {
    const STORAGE_KEY = "quant_discipline_journal_v1";

    const STAGES = [
        {
            id: "A",
            badge: "🟢 观察/复盘中",
            shortBadge: "🟢 观察/复盘",
            text: "等大周期结构确认与高流动性时段，不进低效震荡",
            cls: "dj-stage-a"
        },
        {
            id: "B",
            badge: "🚀 顺势浮盈滚仓",
            shortBadge: "🚀 浮盈滚仓",
            text: "仅浮盈才按步长加仓，亏损绝不扩仓",
            cls: "dj-stage-b"
        },
        {
            id: "C",
            badge: "🛡️ 无利回撤警戒",
            shortBadge: "🛡️ 无利回撤",
            text: "防上头律令：回撤无利润立即全平，绝不扛单",
            cls: "dj-stage-c"
        },
        {
            id: "D",
            badge: "⚠️ 情绪反转/色块边界",
            shortBadge: "⚠️ 反转/边界",
            text: "一致预期掉头或触及供需边界：先止盈 70%~80%，轻仓推移动止损，打掉即收工",
            cls: "dj-stage-d"
        }
    ];

    const CHECKLIST_ITEMS = [
        "大周期（1H/1D）结构一致，且处于高流动性时段（避开 03:00–07:30 UTC+8）",
        "盈亏比 R:R > 1:2，且非追大阳/大阴线（仅买跌/买横/买缩）",
        "固定轻仓试探，已设定“无利润回撤全平”红线"
    ];

    const QUICK_TAGS = [
        "#无利回撤全平",
        "#一致预期掉头止盈",
        "#利润抽离转现货",
        "#忍住没追大阳",
        "#低效期空仓观望"
    ];

    function getBeijingTimeStr(dateObj = new Date()) {
        const bj = new Date(dateObj.getTime() + 8 * 3600 * 1000);
        const y = bj.getUTCFullYear();
        const mo = String(bj.getUTCMonth() + 1).padStart(2, "0");
        const d = String(bj.getUTCDate()).padStart(2, "0");
        const h = String(bj.getUTCHours()).padStart(2, "0");
        const mi = String(bj.getUTCMinutes()).padStart(2, "0");
        return `${y}-${mo}-${d} ${h}:${mi} UTC+8`;
    }

    function getBeijingDateCompact(dateObj = new Date()) {
        const bj = new Date(dateObj.getTime() + 8 * 3600 * 1000);
        const y = bj.getUTCFullYear();
        const mo = String(bj.getUTCMonth() + 1).padStart(2, "0");
        const d = String(bj.getUTCDate()).padStart(2, "0");
        return `${y}${mo}${d}`;
    }

    function escapeHtml(str) {
        return String(str || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function loadState() {
        const def = {
            stageId: "A",
            manualLocked: false,
            checks: [false, false, false],
            notes: []
        };
        try {
            const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
            if (!raw || typeof raw !== "object") return def;
            const validStage = STAGES.some(s => s.id === raw.stageId) ? raw.stageId : "A";
            const checks = Array.isArray(raw.checks) && raw.checks.length === 3
                ? raw.checks.map(Boolean)
                : [false, false, false];
            const notes = Array.isArray(raw.notes) ? raw.notes.slice(0, 100) : [];
            return { stageId: validStage, manualLocked: Boolean(raw.manualLocked), checks, notes };
        } catch (e) {
            return def;
        }
    }

    let state = loadState();
    let isDrawerOpen = false;

    function saveState() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch (e) {}
    }

    function getStageObj(id) {
        return STAGES.find(s => s.id === id) || STAGES[0];
    }

    function notify(msg) {
        if (typeof window.showToast === "function") {
            window.showToast(msg);
        }
    }

    function getActiveSymbolLabel() {
        try {
            if (typeof window.getCurrentSymKey === "function") return window.getCurrentSymKey();
        } catch (e) {}
        return "BTC";
    }

    function mountDomIfNeeded() {
        if (!document.getElementById("djTopBeacon")) {
            const mainPane = document.getElementById("lwMainPane");
            if (mainPane) {
                const beacon = document.createElement("button");
                beacon.type = "button";
                beacon.id = "djTopBeacon";
                beacon.className = "dj-top-beacon dj-stage-a";
                beacon.title = "点击切换当前作战纪律阶段（阶段 A → B → C → D）";
                beacon.onclick = () => window.cycleDisciplineStage();
                mainPane.appendChild(beacon);
            }
        }

        const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
        const drawerHost = (fsEl && fsEl !== document.documentElement) ? fsEl : document.body;

        if (!document.getElementById("djBackdrop")) {
            const bd = document.createElement("div");
            bd.id = "djBackdrop";
            bd.className = "dj-backdrop";
            bd.onclick = () => window.toggleDisciplineDrawer(false);
            drawerHost.appendChild(bd);
        }

        if (!document.getElementById("djEdgeTab")) {
            const tab = document.createElement("button");
            tab.type = "button";
            tab.id = "djEdgeTab";
            tab.className = "dj-edge-tab";
            tab.title = "展开/收起战备纪律与复盘抽屉 (快捷键: Alt+R)";
            tab.innerHTML = `<span class="dj-edge-tab-icon">📋</span><span class="dj-edge-tab-txt">纪律/复盘</span>`;
            tab.onclick = () => window.toggleDisciplineDrawer();
            drawerHost.appendChild(tab);
        }

        if (!document.getElementById("djDrawer")) {
            const drawer = document.createElement("aside");
            drawer.id = "djDrawer";
            drawer.className = "dj-drawer";
            drawer.setAttribute("aria-label", "战备纪律提醒与随手复盘记录");
            drawer.innerHTML = `
                <div class="dj-drawer-header">
                    <div class="dj-drawer-title">
                        <span>🛡️ 战备纪律 &amp; 复盘</span>
                        <span class="dj-kbd-hint">Alt+R</span>
                    </div>
                    <button type="button" class="dj-close-btn" onclick="toggleDisciplineDrawer(false)" title="收起抽屉">✕</button>
                </div>

                <div class="dj-drawer-body">
                    <!-- 阶段快捷切换 -->
                    <div class="dj-card">
                        <div class="dj-card-head">
                            <span class="dj-card-title">🎯 当前作战阶段</span>
                            <span class="dj-card-sub">点击同步右上角红线灯</span>
                        </div>
                        <div class="dj-stage-grid" id="djStageSelector"></div>
                        <div class="dj-stage-rule" id="djStageRuleBox"></div>
                    </div>

                    <!-- 卡片 1：开仓前 3 项硬核自检 -->
                    <div class="dj-card">
                        <div class="dj-card-head">
                            <span class="dj-card-title">✅ 开仓前 3 项硬核自检</span>
                            <div style="display:flex; align-items:center; gap:6px;">
                                <span class="dj-check-counter" id="djCheckCounter">0/3</span>
                                <button type="button" class="dj-mini-btn" onclick="resetDisciplineChecklist()" title="重置全部勾选框">↺ 重置</button>
                            </div>
                        </div>
                        <div class="dj-checklist" id="djChecklistWrap"></div>
                    </div>

                    <!-- 卡片 2：盘中随手速记 -->
                    <div class="dj-card">
                        <div class="dj-card-head">
                            <span class="dj-card-title">✍️ 盘中随手速记</span>
                            <span class="dj-card-sub">自动附北京时间</span>
                        </div>
                        <div class="dj-tags-wrap" id="djQuickTagsWrap"></div>
                        <form class="dj-note-form" onsubmit="event.preventDefault(); submitDisciplineNote();">
                            <input type="text" id="djNoteInput" class="dj-note-input" placeholder="记一句盘中观察或纪律执行..." autocomplete="off">
                            <button type="submit" class="dj-submit-btn">记录</button>
                        </form>
                    </div>

                    <!-- 卡片 3：近期复盘流（最近 10 条） -->
                    <div class="dj-card dj-card-log">
                        <div class="dj-card-head">
                            <span class="dj-card-title">📜 近期复盘流 <span id="djLogCount" style="opacity:0.65; font-weight:600;">(0)</span></span>
                            <button type="button" class="dj-mini-btn dj-export-btn" onclick="exportDisciplineMarkdown()" title="导出全部复盘记录为 Markdown 笔记">📤 导出 Markdown</button>
                        </div>
                        <div class="dj-log-list" id="djLogList"></div>
                    </div>
                </div>
            `;
            drawerHost.appendChild(drawer);
        }
    }

    function reparentForFullscreen() {
        const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
        const host = (fsEl && fsEl !== document.documentElement) ? fsEl : document.body;
        const bd = document.getElementById("djBackdrop");
        const tab = document.getElementById("djEdgeTab");
        const drawer = document.getElementById("djDrawer");
        if (bd && bd.parentElement !== host) host.appendChild(bd);
        if (tab && tab.parentElement !== host) host.appendChild(tab);
        if (drawer && drawer.parentElement !== host) host.appendChild(drawer);
    }
    document.addEventListener("fullscreenchange", reparentForFullscreen);
    document.addEventListener("webkitfullscreenchange", reparentForFullscreen);

    function isRollingNav15mActive() {
        try {
            if (typeof showRollingNav15m !== "undefined") return Boolean(showRollingNav15m);
        } catch (e) {}
        try {
            if (typeof lwLastRollingNavSnapshot !== "undefined" && lwLastRollingNavSnapshot) return true;
        } catch (e) {}
        try {
            return localStorage.getItem("quant_rolling_nav_15m") === "true";
        } catch (e) {}
        return false;
    }

    function syncBeaconPosition() {
        const beacon = document.getElementById("djTopBeacon");
        if (!beacon) return;
        beacon.classList.toggle("below-nav-hud", isRollingNav15mActive());
    }

    window.addEventListener("resize", syncBeaconPosition);

    function renderAll() {
        mountDomIfNeeded();
        syncBeaconPosition();

        const st = getStageObj(state.stageId);

        // 1. 渲染右上角单行纪律红线灯
        const beacon = document.getElementById("djTopBeacon");
        if (beacon) {
            beacon.className = `dj-top-beacon ${st.cls}` + (isRollingNav15mActive() ? " below-nav-hud" : "");
            beacon.innerHTML = `<span class="dj-beacon-badge">${st.badge}</span><span class="dj-beacon-sep">·</span><span class="dj-beacon-text">${st.text}</span>`;
        }

        // 2. 渲染抽屉内阶段切换按钮与当前律令
        const stageSel = document.getElementById("djStageSelector");
        if (stageSel) {
            stageSel.innerHTML = STAGES.map(item => `
                <button type="button" class="dj-stage-btn ${item.cls} ${item.id === state.stageId ? "active" : ""}" onclick="setDisciplineStage('${item.id}', true)">
                    ${item.shortBadge}
                </button>
            `).join("");
        }
        const ruleBox = document.getElementById("djStageRuleBox");
        if (ruleBox) {
            ruleBox.className = `dj-stage-rule ${st.cls}`;
            ruleBox.textContent = st.text;
        }

        // 3. 渲染开仓前 3 项硬核自检
        const checkWrap = document.getElementById("djChecklistWrap");
        const checkCounter = document.getElementById("djCheckCounter");
        const doneCount = state.checks.filter(Boolean).length;
        if (checkCounter) {
            checkCounter.textContent = doneCount === 3 ? "3/3 🟢" : `${doneCount}/3`;
            checkCounter.classList.toggle("is-complete", doneCount === 3);
        }
        if (checkWrap) {
            checkWrap.innerHTML = CHECKLIST_ITEMS.map((txt, idx) => `
                <label class="dj-check-item ${state.checks[idx] ? "is-checked" : ""}">
                    <input type="checkbox" ${state.checks[idx] ? "checked" : ""} onchange="toggleDisciplineCheck(${idx}, this.checked)">
                    <span>${escapeHtml(txt)}</span>
                </label>
            `).join("");
        }

        // 4. 渲染 5 个快捷标签
        const tagsWrap = document.getElementById("djQuickTagsWrap");
        if (tagsWrap && !tagsWrap.dataset.inited) {
            tagsWrap.dataset.inited = "1";
            tagsWrap.innerHTML = QUICK_TAGS.map(tag => `
                <button type="button" class="dj-tag-chip" onclick="appendDisciplineQuickTag('${tag}')">${tag}</button>
            `).join("");
        }

        // 5. 渲染近期复盘流（倒序展示最近 10 条）
        const logList = document.getElementById("djLogList");
        const logCount = document.getElementById("djLogCount");
        if (logCount) logCount.textContent = `(${state.notes.length})`;
        if (logList) {
            const recent = state.notes.slice(0, 10);
            if (!recent.length) {
                logList.innerHTML = `<div class="dj-log-empty">暂无复盘记录。点上方快捷标签或输入一句话即可随时存档（北京时间 UTC+8）。</div>`;
            } else {
                logList.innerHTML = recent.map(item => {
                    const sObj = getStageObj(item.stageId);
                    return `
                        <div class="dj-log-item">
                            <div class="dj-log-meta">
                                <span class="dj-log-time">${escapeHtml(item.timeStr)}</span>
                                <span class="dj-log-stage ${sObj.cls}">${escapeHtml(sObj.shortBadge)}</span>
                                <button type="button" class="dj-log-del" onclick="deleteDisciplineNote('${item.id}')" title="删除此条记录">×</button>
                            </div>
                            <div class="dj-log-content">${escapeHtml(item.text)}</div>
                        </div>
                    `;
                }).join("");
            }
        }

        // 6. 同步抽屉展开态与点击空白处关闭遮罩
        const bd = document.getElementById("djBackdrop");
        const drawer = document.getElementById("djDrawer");
        const tab = document.getElementById("djEdgeTab");
        if (bd) bd.classList.toggle("open", isDrawerOpen);
        if (drawer) drawer.classList.toggle("open", isDrawerOpen);
        if (tab) tab.classList.toggle("drawer-open", isDrawerOpen);
    }

    // ---- 对外全局交互接口 ----
    window.toggleDisciplineDrawer = function (forceState) {
        isDrawerOpen = typeof forceState === "boolean" ? forceState : !isDrawerOpen;
        renderAll();
        if (isDrawerOpen) {
            setTimeout(() => {
                const inp = document.getElementById("djNoteInput");
                if (inp) inp.focus();
            }, 180);
        }
    };

    window.setDisciplineStage = function (stageId, isManual = true) {
        if (!STAGES.some(s => s.id === stageId)) return;
        state.stageId = stageId;
        if (isManual) state.manualLocked = true;
        saveState();
        renderAll();
    };

    window.cycleDisciplineStage = function () {
        const idx = STAGES.findIndex(s => s.id === state.stageId);
        const next = STAGES[(idx + 1) % STAGES.length];
        state.stageId = next.id;
        state.manualLocked = true;
        saveState();
        renderAll();
        notify(`已切换纪律阶段：${next.badge}`);
    };

    // 预留条件判断接入接口：供价格/持仓数据在未手动锁定时自动提示阶段切换
    window.syncDisciplineBeaconAuto = function (ctx = {}) {
        if (!ctx || state.manualLocked) return;
        let nextStage = state.stageId;
        if (ctx.noProfitDrawdown) nextStage = "C";
        else if (ctx.sentimentReversal || ctx.nearBoundary) nextStage = "D";
        else if (ctx.inProfitRolling) nextStage = "B";
        else nextStage = "A";
        if (nextStage !== state.stageId) {
            state.stageId = nextStage;
            saveState();
            renderAll();
        }
    };

    window.syncDisciplineBeaconPosition = syncBeaconPosition;

    window.toggleDisciplineCheck = function (idx, checked) {
        if (idx < 0 || idx >= 3) return;
        state.checks[idx] = Boolean(checked);
        saveState();
        renderAll();
    };

    window.resetDisciplineChecklist = function () {
        state.checks = [false, false, false];
        saveState();
        renderAll();
        notify("已重置开仓前 3 项自检清单");
    };

    window.appendDisciplineQuickTag = function (tag) {
        const inp = document.getElementById("djNoteInput");
        if (!inp) return;
        const cur = inp.value.trim();
        if (!cur) {
            inp.value = `${tag} `;
        } else if (!cur.includes(tag)) {
            inp.value = `${cur} ${tag} `;
        }
        inp.focus();
    };

    window.submitDisciplineNote = function () {
        const inp = document.getElementById("djNoteInput");
        if (!inp) return;
        const text = inp.value.trim();
        if (!text) {
            notify("请输入复盘内容或点击上方快捷标签");
            return;
        }
        const entry = {
            id: "dj_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
            timeStr: getBeijingTimeStr(new Date()),
            stageId: state.stageId,
            symbol: getActiveSymbolLabel(),
            text
        };
        state.notes.unshift(entry);
        if (state.notes.length > 100) state.notes = state.notes.slice(0, 100);
        inp.value = "";
        saveState();
        renderAll();
        notify("✅ 已记录至复盘流（北京时间 UTC+8）");
    };

    window.deleteDisciplineNote = function (id) {
        state.notes = state.notes.filter(n => n.id !== id);
        saveState();
        renderAll();
    };

    window.exportDisciplineMarkdown = function () {
        if (!state.notes.length) {
            notify("暂无可导出的复盘记录");
            return;
        }
        const lines = [
            `# 盘中纪律与复盘笔记 (${getBeijingTimeStr(new Date())})`,
            "",
            ...state.notes.map(n => {
                const sObj = getStageObj(n.stageId);
                const symTag = n.symbol ? ` [${n.symbol}]` : "";
                return `- **${n.timeStr}** · ${sObj.badge}${symTag}：${n.text}`;
            }),
            ""
        ];
        const md = lines.join("\n");

        // 同时触发本地 Markdown 文件下载与剪贴板复制
        try {
            const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `trading-review-${getBeijingDateCompact(new Date())}.md`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (e) {}

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(md).catch(() => {});
        }
        notify(`📤 已导出 ${state.notes.length} 条 Markdown 复盘笔记并复制到剪贴板`);
    };

    // 快捷键 Alt+R 呼出/收起右侧复盘抽屉，Esc 关闭
    document.addEventListener("keydown", (e) => {
        if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === "r" || e.key === "R" || e.code === "KeyR")) {
            e.preventDefault();
            window.toggleDisciplineDrawer();
        } else if (e.key === "Escape" && isDrawerOpen) {
            window.toggleDisciplineDrawer(false);
        }
    });

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", renderAll);
    } else {
        renderAll();
    }
})();
