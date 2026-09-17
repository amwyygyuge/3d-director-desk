import http from "node:http";
import { WebSocketServer } from "ws";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const DEFAULT_PORT = 4005;
/** 默认只绑 loopback:桥的调用方与展示端通常同机;暴露到内网/公网必须显式 opt-in。 */
const LOOPBACK_HOST = "127.0.0.1";
/** 展示端页面只从 localhost:4002 发出;其余 Origin 一律不服务(可用 allowedOrigins 追加)。 */
const DEFAULT_ALLOWED_ORIGINS = ["http://localhost:4002", "http://127.0.0.1:4002"];
/** RPC 请求体上限(截断即断连,拒绝继续缓冲)。 */
const RPC_BODY_LIMIT_BYTES = 256 * 1024;
/** 落盘文件体上限:短视频参考帧量级,超过视为滥用。 */
const SAVE_BODY_LIMIT_BYTES = 64 * 1024 * 1024;
/** 输出落盘目录被钉死在工程内该目录下,文件名不得逃逸。 */
const SAVE_ROOT_DIR = "bridge-output";
const RPC_TIMEOUT_MS = 30000;

const WS_OPEN = 1;

/** 解析 SKILL.md 源文件物理路径(桥的唯一文件读路径:把技能文档发给读不到本地盘的 AI 端) */
function resolveSkillFilePath() {
    const localPath = path.resolve(process.cwd(), "skills/director-desk/SKILL.md");
    if (fs.existsSync(localPath)) return localPath;
    const globalPath = path.resolve(
        process.env.USERPROFILE || process.env.HOME || "",
        ".codex/skills/director-desk/SKILL.md",
    );
    if (fs.existsSync(globalPath)) return globalPath;
    return localPath;
}

function readBody(req, limitBytes) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let received = 0;
        req.on("data", (chunk) => {
            received += chunk.length;
            if (received > limitBytes) {
                reject(Object.assign(new Error("request body too large"), { statusCode: 413 }));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        req.on("error", reject);
    });
}

function sendJson(res, statusCode, payload) {
    res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(payload));
}

/**
 * 已连接展示端注册表:clientId → socket + 自报元信息。
 * 断连时把挂在该端上的未决 RPC 立即失败,避免调用方空等到超时。
 */
class ClientRegistry {
    #clients = new Map();

    constructor(onClientDropped) {
        this.#onClientDropped = onClientDropped;
    }

    #onClientDropped;

    add(ws) {
        const clientId = "client-" + crypto.randomUUID().slice(0, 8);
        this.#clients.set(clientId, { ws, info: { connectedAt: new Date().toISOString() } });
        return clientId;
    }

    updateInfo(clientId, info) {
        const item = this.#clients.get(clientId);
        if (item) item.info = { ...item.info, ...info };
    }

    drop(clientId) {
        const item = this.#clients.get(clientId);
        if (!item) return;
        this.#clients.delete(clientId);
        this.#onClientDropped(clientId);
    }

    /** 优先定向;否则广播给全部存活端;都不存在时报无可路由端。 */
    route(targetClientId) {
        if (targetClientId) {
            const item = this.#clients.get(targetClientId);
            return item ? [{ clientId: targetClientId, ws: item.ws }] : [];
        }
        return [...this.#clients.entries()]
            .filter(([, item]) => item.ws.readyState === WS_OPEN)
            .map(([clientId, item]) => ({ clientId, ws: item.ws }));
    }

    describe() {
        return [...this.#clients.entries()].map(([clientId, item]) => ({
            clientId,
            connectedAt: item.info?.connectedAt,
            userAgent: item.info?.userAgent,
            viewport: item.info?.viewport,
            readyState: item.ws.readyState,
        }));
    }

    get size() {
        return this.#clients.size;
    }
}

/**
 * 未决 RPC 表:reqId → 各目标端的结果收集与完成回调。
 * 与注册表解耦:桥接服务负责把「客户端断开」翻译成「该端失败」。
 */
class PendingRpcTable {
    #entries = new Map();

    begin(reqId, targetClientIds, onComplete) {
        const entry = {
            remaining: targetClientIds.length,
            results: [],
            onComplete,
            awaitedClientIds: new Set(targetClientIds),
            timer: setTimeout(() => {
                this.#entries.delete(reqId);
                onComplete({ timedOut: true, results: entry.results });
            }, RPC_TIMEOUT_MS),
        };
        this.#entries.set(reqId, entry);
        return entry;
    }

    resolveFromClient(reqId, clientId, result) {
        const entry = this.#entries.get(reqId);
        if (!entry) return;
        entry.results.push({ fromClientId: clientId, ...result });
        this.#settleIfExhausted(reqId, entry);
    }

    failFromClient(clientId, reason) {
        for (const [reqId, entry] of this.#entries) {
            if (!entry.awaitedClientIds.delete(clientId)) continue;
            entry.results.push({ fromClientId: clientId, ok: false, error: reason });
            this.#settleIfExhausted(reqId, entry);
        }
    }

    cancelAll(reason) {
        for (const [, entry] of this.#entries) {
            clearTimeout(entry.timer);
            entry.onComplete({ timedOut: false, results: entry.results, abortedReason: reason });
        }
        this.#entries.clear();
    }

    #settleIfExhausted(reqId, entry) {
        entry.remaining -= 1;
        if (entry.remaining > 0) return;
        clearTimeout(entry.timer);
        this.#entries.delete(reqId);
        entry.onComplete({ timedOut: false, results: entry.results });
    }
}

/**
 * 桥接服务:HTTP 端点 + WebSocket 广播,供外部 AI/脚本经命令层驱动本地导演台。
 *
 * 安全边界:
 *  - 默认只绑 127.0.0.1,不响应局域网;非回环绑定是无鉴权裸奔,启动时打警告;
 *  - 跨域浏览器请求由 Origin 白名单拦截(本机调用方进程本无 Origin,直接放行);
 *  - WS 只接受白名单 Origin;
 *  - eval 通道仅在显式 opt-in 时才转发给页面;
 *  - /skill 把 SKILL.md 经 HTTP 提供给读不到本地盘的 AI 端(只读,免鉴权)。
 */
export class DirectorBridgeServer {
    #httpServer;
    #wss;
    #host;
    #allowEval;
    #allowedOrigins;
    #clients;
    #pending = new PendingRpcTable();
    #listening = false;

    constructor(options = {}) {
        this.#host = options.host ?? LOOPBACK_HOST;
        this.#allowEval = options.allowEval === true;
        this.#allowedOrigins = options.allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS;
        this.#clients = new ClientRegistry((clientId) => {
            this.#pending.failFromClient(clientId, "client disconnected");
        });
        this.#httpServer = http.createServer((req, res) => {
            this.#handleHttp(req, res).catch((err) => {
                if (res.headersSent) return;
                sendJson(res, err.statusCode ?? 500, { error: err.message });
            });
        });
        this.#wss = new WebSocketServer({ server: this.#httpServer });
        // ws 会把 HTTP server 的 'error' 转发到自身;不接住的话,端口被占(EADDRINUSE)时
        // listen() 的 reject 还没来得及走,进程就先死在 WebSocketServer 的未处理 'error' 上——
        // vite 插件侧的 try/catch 形同虚设(实测拖垮整个 dev 进程)。启动期失败由 listen() reject 上报,
        // 这里静默;listen 成功后的运行期错误不属于启动握手,吞掉会瞎调试,打日志。
        this.#wss.on("error", (err) => {
            if (this.#listening) console.error("[bridge] WebSocket 服务错误:", err);
        });
        this.#wss.on("connection", (ws, req) => this.#handleConnection(ws, req));
        if (this.#host !== LOOPBACK_HOST) {
            console.warn(
                `[bridge] ⚠ 桥接服务绑定到 ${this.#host}(非回环)。桥没有任何鉴权——` +
                    `Origin 白名单只能挡浏览器,挡不住裸 HTTP 调用。` +
                    `请确认该端口只对可信内网开放;公网部署必须前置带鉴权的 HTTPS/WSS 反代。`,
            );
        }
    }

    get evalAllowed() {
        return this.#allowEval;
    }

    get listening() {
        return this.#listening;
    }

    listen(port = DEFAULT_PORT) {
        if (this.#listening) return Promise.resolve(this);
        return new Promise((resolve, reject) => {
            this.#httpServer.once("error", reject);
            this.#httpServer.listen(port, this.#host, () => {
                this.#listening = true;
                console.log(`[bridge] Director Desk RPC 桥接服务已启动: http://${this.#host}:${port}`);
                resolve(this);
            });
        });
    }

    async close() {
        const wasListening = this.#listening;
        this.#listening = false;
        this.#pending.cancelAll("bridge shutting down");
        for (const ws of this.#wss.clients) ws.terminate();
        await new Promise((resolve) => this.#wss.close(resolve));
        // 从未 listen 成功的实例没有可关闭的 HTTP 服务,close 会以 "not running" 报错
        if (!wasListening) return;
        await new Promise((resolve, reject) => this.#httpServer.close((err) => (err ? reject(err) : resolve())));
    }

    #corsHeadersFor(req) {
        const origin = req.headers.origin;
        if (!origin || !this.#allowedOrigins.includes(origin)) return null;
        return {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
            Vary: "Origin",
        };
    }

    async #handleHttp(req, res) {
        const cors = this.#corsHeadersFor(req);
        // 无 Origin 的同进程调用(curl/脚本)不需要 CORS 头;有 Origin 但不在白名单,直接拒
        if (req.headers.origin && !cors) {
            sendJson(res, 403, { error: "Origin not allowed" });
            return;
        }
        if (cors) for (const [name, value] of Object.entries(cors)) res.setHeader(name, value);
        if (req.method === "OPTIONS") {
            res.writeHead(cors ? 204 : 403);
            res.end();
            return;
        }

        const url = new URL(req.url, `http://${req.headers.host || LOOPBACK_HOST}`);

        if (req.method === "GET" && url.pathname === "/") return this.#serveHomePage(res);
        if (req.method === "GET" && ["/skill", "/SKILL.md", "/skill.md"].includes(url.pathname))
            return this.#serveSkillMarkdown(res);
        if (req.method === "GET" && url.pathname === "/skill.json") return this.#serveSkillJson(res);
        if (req.method === "GET" && url.pathname === "/status") return this.#serveStatus(res);
        if (req.method === "POST" && url.pathname === "/save-file") return this.#serveSaveFile(req, res);
        if (req.method === "POST" && url.pathname === "/rpc") return this.#serveRpc(req, res);

        sendJson(res, 404, { error: "not found" });
    }

    #serveHomePage(res) {
        const clients = this.#clients.describe().map((client) => ({
            id: client.clientId,
            viewport: client.viewport ? `${client.viewport.width}x${client.viewport.height}` : "未知",
            userAgent: client.userAgent || "标准客户端",
        }));

        const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <title>3D Director Desk — RPC Bridge</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f1115; color: #e2e8f0; margin: 0; padding: 32px 40px; }
        h1 { color: #38bdf8; margin-bottom: 8px; font-size: 24px; }
        .subtitle { color: #94a3b8; font-size: 14px; margin-bottom: 24px; }
        .card { background: #1a1e26; border: 1px solid #2d3748; border-radius: 8px; padding: 20px 24px; margin-bottom: 20px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); }
        .card h2 { font-size: 16px; color: #f1f5f9; margin-top: 0; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
        .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; background: #10b981; color: #fff; }
        table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 13px; }
        th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #2d3748; }
        th { color: #94a3b8; font-weight: 500; }
        code { background: #0f172a; padding: 2px 6px; border-radius: 4px; font-family: monospace; color: #38bdf8; }
        pre { background: #090d14; padding: 14px; border-radius: 6px; overflow-x: auto; font-family: monospace; font-size: 12px; line-height: 1.5; color: #cbd5e1; border: 1px solid #1e293b; }
    </style>
</head>
<body>
    <h1>🎬 3D 导演台多端通讯桥 &amp; Skill 服务</h1>
    <div class="subtitle">绑定地址 <code>${this.#host}</code> | 本机回环免鉴权,跨域浏览器请求由 Origin 白名单拦截</div>

    <div class="card">
        <h2>📖 导演台 Skill 技能文档</h2>
        <p style="color:#94a3b8;font-size:13px;">
            AI 端不应依赖本地文件路径读技能文档——经 HTTP 获取:<code>GET /skill</code>(Markdown 原文)或 <code>GET /skill.json</code>(结构化)。
            当前源文件:<code>${escapeHtml(resolveSkillFilePath())}</code>
        </p>
    </div>

    <div class="card">
        <h2>📱 已连接展示端浏览器 <span class="badge">${clients.length} 个在线</span></h2>
        ${
            clients.length === 0
                ? '<p style="color:#64748b;font-size:13px;">暂无浏览器连接,请打开 <code>http://localhost:4002/</code></p>'
                : `<table><thead><tr><th>Client ID</th><th>视口</th><th>User Agent</th></tr></thead><tbody>${clients
                      .map(
                          (c) =>
                              `<tr><td><code>${c.id}</code></td><td>${c.viewport}</td><td style="color:#94a3b8">${escapeHtml(c.userAgent)}</td></tr>`,
                      )
                      .join("")}</tbody></table>`
        }
    </div>

    <div class="card">
        <h2>⚡ 快速调用端点速查</h2>
        <pre><code>curl -X POST http://127.0.0.1:${DEFAULT_PORT}/rpc \\
  -H "Content-Type: application/json" \\
  -d '{"method":"dispatch","action":{"type":"transport.play","payload":{}}}'

curl http://127.0.0.1:${DEFAULT_PORT}/status
curl http://127.0.0.1:${DEFAULT_PORT}/skill</code></pre>
    </div>
</body>
</html>`;
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
    }

    #serveSkillMarkdown(res) {
        const skillPath = resolveSkillFilePath();
        if (!fs.existsSync(skillPath)) {
            res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
            res.end(`Skill file not found at ${skillPath}`);
            return;
        }
        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" });
        res.end(fs.readFileSync(skillPath, "utf8"));
    }

    #serveSkillJson(res) {
        const skillPath = resolveSkillFilePath();
        const exists = fs.existsSync(skillPath);
        const rawContent = exists ? fs.readFileSync(skillPath, "utf8") : "";
        sendJson(res, 200, {
            name: "director-desk",
            filePath: skillPath,
            sizeBytes: rawContent.length,
            rawContent,
        });
    }

    #serveStatus(res) {
        sendJson(res, 200, {
            status: "running",
            connected: this.#clients.size > 0,
            clientCount: this.#clients.size,
            clients: this.#clients.describe(),
            evalAllowed: this.#allowEval,
        });
    }

    async #serveSaveFile(req, res) {
        const body = await readBody(req, SAVE_BODY_LIMIT_BYTES);
        try {
            const { filename, dataBase64 } = JSON.parse(body);
            if (typeof filename !== "string" || typeof dataBase64 !== "string") {
                return sendJson(res, 400, { error: "filename and dataBase64 must be strings" });
            }
            // 文件名只允许普通文件名,拒绝路径穿越与绝对路径
            const baseName = path.basename(filename);
            if (baseName !== filename || filename.length === 0) {
                return sendJson(res, 400, { error: "filename must be a plain file name" });
            }
            const saveDir = path.resolve(process.cwd(), SAVE_ROOT_DIR);
            fs.mkdirSync(saveDir, { recursive: true });
            const buffer = Buffer.from(dataBase64, "base64");
            const targetPath = path.join(saveDir, baseName);
            fs.writeFileSync(targetPath, buffer);
            sendJson(res, 200, { ok: true, path: targetPath, size: buffer.length });
        } catch (err) {
            sendJson(res, 400, { error: err.message });
        }
    }

    async #serveRpc(req, res) {
        const body = await readBody(req, RPC_BODY_LIMIT_BYTES);
        let payload;
        try {
            payload = JSON.parse(body);
        } catch {
            return sendJson(res, 400, { error: "Invalid JSON body" });
        }

        const { method = "dispatch", action, code, targetClientId } = payload;
        if (method === "eval" && !this.#allowEval) {
            return sendJson(res, 403, {
                error: "eval channel disabled; pass allowEval to startDirectorBridge or set DIRECTOR_BRIDGE_ALLOW_EVAL=1",
            });
        }
        if (this.#clients.size === 0) {
            return sendJson(res, 503, {
                error: "No Director Desk browser window is connected. Open http://localhost:4002/ first.",
            });
        }

        const targets = this.#clients.route(targetClientId);
        if (targets.length === 0) {
            return sendJson(res, 503, { error: "No reachable browser socket for requested route" });
        }

        const reqId = "rpc-" + crypto.randomUUID();
        this.#pending.begin(
            reqId,
            targets.map((t) => t.clientId),
            (outcome) => this.#finishRpc(res, reqId, outcome),
        );

        const rpcMessage = JSON.stringify({ id: reqId, method, action, code });
        for (const target of targets) target.ws.send(rpcMessage);
    }

    #finishRpc(res, _reqId, outcome) {
        if (res.writableEnded) return;
        if (outcome.timedOut && outcome.results.length === 0) {
            sendJson(res, 504, { error: "RPC timeout waiting for response from browser client" });
            return;
        }
        // 多端广播:汇总各端结果;成功标准 = 至少一端 ok 且无失败端
        const failures = outcome.results.filter((r) => r && r.ok === false);
        const bestResult = outcome.results.find((r) => r && r.ok) ?? outcome.results[0] ?? {};
        if (failures.length > 0) {
            sendJson(res, 207, {
                partial: true,
                bestResult,
                failures: failures.map((f) => ({ clientId: f.fromClientId, error: f.error, issues: f.issues })),
            });
            return;
        }
        sendJson(res, 200, bestResult);
    }

    #handleConnection(ws, req) {
        const origin = req.headers.origin;
        if (origin && !this.#allowedOrigins.includes(origin)) {
            ws.close(1008, "origin not allowed");
            return;
        }
        const clientId = this.#clients.add(ws);
        console.log(`[bridge] 客户端连接: ${clientId} (在线总数: ${this.#clients.size})`);
        ws.send(JSON.stringify({ type: "handshake", clientId }));

        ws.on("message", (raw) => {
            try {
                const msg = JSON.parse(raw.toString());
                if (msg.type === "client-info") return this.#clients.updateInfo(clientId, msg.info);
                if (msg.type === "scene-snapshot") return; // 场景快照为历史遗留协议,当前无消费方
                if (msg.id) this.#pending.resolveFromClient(msg.id, clientId, msg.result ?? {});
            } catch (err) {
                console.error("[bridge] 消息解析异常:", err);
            }
        });
        ws.on("close", () => {
            this.#clients.drop(clientId);
            console.log(`[bridge] 客户端断开: ${clientId} (在线总数: ${this.#clients.size})`);
        });
    }
}

function escapeHtml(text) {
    return String(text)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
}

const activeServers = new Map();

export function startDirectorBridge(options = {}) {
    const port = options.port ?? DEFAULT_PORT;
    const existing = activeServers.get(port);
    if (existing) return existing;
    const server = new DirectorBridgeServer({
        ...options,
        allowEval: options.allowEval ?? process.env.DIRECTOR_BRIDGE_ALLOW_EVAL === "1",
    });
    activeServers.set(port, server);
    return server;
}

/** 释放指定端口上的桥接实例;vite 配置热重启必须走这里,避免拿到已关闭的缓存。 */
export async function stopDirectorBridge(port = DEFAULT_PORT) {
    const server = activeServers.get(port);
    if (!server) return;
    activeServers.delete(port);
    await server.close();
}

/**
 * CLI 参数与环境变量解析(脚本直跑时才生效;vite 插件走代码传参)。
 * --host=0.0.0.0 暴露到内网;--origins=a,b 追加放行 Origin;--allow-eval 开调试通道。
 * 对应 env:DIRECTOR_BRIDGE_HOST / DIRECTOR_BRIDGE_ORIGINS(逗号分隔) / DIRECTOR_BRIDGE_ALLOW_EVAL=1。
 */
function resolveCliOptions(argv) {
    const options = {
        host: process.env.DIRECTOR_BRIDGE_HOST,
        allowEval: process.env.DIRECTOR_BRIDGE_ALLOW_EVAL === "1",
        allowedOrigins: process.env.DIRECTOR_BRIDGE_ORIGINS
            ? process.env.DIRECTOR_BRIDGE_ORIGINS.split(",")
                  .map((origin) => origin.trim())
                  .filter(Boolean)
            : undefined,
    };
    for (const arg of argv) {
        if (arg.startsWith("--host=")) options.host = arg.slice("--host=".length);
        else if (arg.startsWith("--origins="))
            options.allowedOrigins = arg
                .slice("--origins=".length)
                .split(",")
                .map((o) => o.trim())
                .filter(Boolean);
        else if (arg === "--allow-eval") options.allowEval = true;
        else if (arg === "--help" || arg === "-h") {
            console.log(
                "用法: bun scripts/bridge.mjs [--host=127.0.0.1] [--origins=https://a,https://b] [--allow-eval]\n" +
                    "  --host       绑定地址,默认 127.0.0.1;暴露内网用 0.0.0.0(公网需自行前置 TLS 反代)\n" +
                    "  --origins    逗号分隔的额外放行 Origin(展示端页面的来源,如 https://your.vercel.app)\n" +
                    "  --allow-eval 开启页面 eval 调试通道(默认关闭)",
            );
            process.exit(0);
        }
    }
    // 用户显式追加的 origins 与默认白名单合并,而不是替换
    if (options.allowedOrigins) {
        options.allowedOrigins = [...DEFAULT_ALLOWED_ORIGINS, ...options.allowedOrigins];
    }
    // undefined 值不落进构造参数,保持默认生效
    return Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined));
}

// 独立 CLI 启动入口
const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(currentFile)) {
    const options = resolveCliOptions(process.argv.slice(2));
    startDirectorBridge({ ...options, port: DEFAULT_PORT })
        .listen(DEFAULT_PORT)
        .catch((err) => {
            console.error("[bridge] 启动失败:", err);
            process.exitCode = 1;
        });
}
