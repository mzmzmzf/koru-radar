// 本地存储 Schema 保护与安全读写模块 (兼容 file:// 与 http(s)://)
const QUANT_STORAGE_SCHEMA_VERSION = 2;

(function ensureQuantStorageSchema() {
    try {
        const curVer = parseInt(localStorage.getItem("quant_schema_version") || "0", 10);
        if (curVer < QUANT_STORAGE_SCHEMA_VERSION) {
            localStorage.setItem("quant_schema_version", String(QUANT_STORAGE_SCHEMA_VERSION));
        }
    } catch (e) {}
})();

function safeStorageGetJson(key, fallbackVal) {
    try {
        const raw = localStorage.getItem(key);
        if (raw === null || raw === "") return fallbackVal;
        const parsed = JSON.parse(raw);
        return parsed !== null && parsed !== undefined ? parsed : fallbackVal;
    } catch (e) {
        return fallbackVal;
    }
}

function safeStorageSetJson(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
    } catch (e) {
        return false;
    }
}
