#!/usr/bin/env bun
/**
 * Director Desk MCP server —— 把导演台的命令面经 MCP 协议暴露给 AI 客户端。
 *
 * 纯适配层,零领域逻辑:
 *   tools/list  ⇐  桥 RPC `list-tools`(页面侧 AgentBridge.listToolSchemas,由能力契约派生)
 *   tools/call  ⇒  桥 RPC dispatch/query(写/读按 capability.kind 分流)
 *
 * 前置条件:桥在跑(bun run dev 自动起,或 bun run bridge),且至少一个导演台页面已连桥。
 * 桥不可达或页面未连时,只暴露 desk_status / desk_refresh_tools 两个元工具;
 * 页面连上后调 desk_refresh_tools 即拉取完整动词表(list_changed 通知客户端)。
 *
 * 配置:DIRECTOR_BRIDGE_URL 或 --bridge=<url>,默认 http://127.0.0.1:4005。
 * 桥无鉴权,本服务仅应绑定本机回环场景使用。
 */
import process from "node:process";

// 用低层 Server 而非 McpServer:工具 schema 是页面能力契约派生的 JSON Schema,
// 运行时动态拉取;McpServer.registerTool 要求 zod 形状,转换只会徒增依赖与漂移面
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const DEFAULT_BRIDGE_URL = "http://127.0.0.1:4005";
const HTTP_TIMEOUT_MS = 30_000;
const SERVER_NAME = "3d-director-desk";
const SERVER_VERSION = "0.1.0";
const LOG_PREFIX = "[director-desk-mcp]";

/** MCP 工具名只允许 [a-zA-Z0-9_-];命令 type 里的点映射为下划线。 */
function toMcpName(type) {
    return type.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/** 桥的 HTTP 出口:状态查询 + RPC 转发;统一超时与错误整形。 */
class BridgeHttpClient {
    constructor(baseUrl) {
        this.baseUrl = baseUrl.replace(/\/+$/, "");
    }

    async status() {
        return this.#request("GET", "/status");
    }

    async rpc(body) {
        const res = await this.#request("POST", "/rpc", body);
        // 多端广播的部分失败(HTTP 207)归一化:以首个成功端为准,失败端信息透传
        if (res && res.partial === true) {
            return { ...res.bestResult, partialFailures: res.failures };
        }
        return res;
    }

    async #request(method, path, body) {
        let response;
        try {
            response = await fetch(`${this.baseUrl}${path}`, {
                method,
                headers: body === undefined ? {} : { "Content-Type": "application/json" },
                body: body === undefined ? undefined : JSON.stringify(body),
                signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
            });
        } catch (err) {
            throw new Error(
                `桥不可达(${this.baseUrl}): ${err instanceof Error ? err.message : String(err)};` +
                    "先 bun run dev 或 bun run bridge 起桥",
            );
        }
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(
                `桥 HTTP ${response.status}: ${payload.error ?? "未知错误"}` +
                    (response.status === 503 ? "(页面未连桥——打开 http://127.0.0.1:4002/)" : ""),
            );
        }
        return payload;
    }
}

/** 导演台工具目录:缓存桥拉到的工具 schema,维护 MCP 名 → 命令 type 的映射。 */
class DeskToolCatalog {
    #tools = [];
    #byMcpName = new Map();
    #lastError = null;

    constructor(bridge) {
        this.bridge = bridge;
    }

    /** 从已连桥的页面现取工具面;失败时保留旧缓存并记录原因。 */
    async refresh() {
        try {
            const res = await this.bridge.rpc({ method: "list-tools" });
            if (!res || res.ok !== true || !Array.isArray(res.value)) {
                throw new Error(`list-tools 返回异常: ${JSON.stringify(res)}`);
            }
            const byMcpName = new Map();
            const tools = res.value.map((schema) => {
                const name = toMcpName(schema.name);
                if (byMcpName.has(name)) {
                    console.error(`${LOG_PREFIX} 工具名冲突: ${schema.name} 与 ${byMcpName.get(name).type} 映射同名`);
                }
                const entry = { name, type: schema.name, kind: schema.kind };
                byMcpName.set(name, entry);
                return {
                    name,
                    description: `[${schema.kind}] ${schema.description}`,
                    inputSchema: schema.inputSchema,
                };
            });
            this.#tools = tools;
            this.#byMcpName = byMcpName;
            this.#lastError = null;
            return tools.length;
        } catch (err) {
            this.#lastError = err instanceof Error ? err.message : String(err);
            throw err;
        }
    }

    list() {
        return this.#tools;
    }

    resolve(mcpName) {
        return this.#byMcpName.get(mcpName);
    }

    get lastError() {
        return this.#lastError;
    }
}

const META_TOOLS = [
    {
        name: "desk_status",
        description: "导演台桥接状态:桥可达性、在线页面客户端列表、已装载工具数。",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
        name: "desk_refresh_tools",
        description:
            "重新从已连接的导演台页面拉取工具清单。页面刚打开/重连后调用;成功后本服务的工具列表更新并通知客户端。",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
];

function textResult(value, isError = false) {
    return {
        content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
        isError,
    };
}

/** MCP 协议端:stdio 传输,list/call 两个处理器即全部职责。 */
class DirectorMcpServer {
    constructor(options) {
        this.bridge = new BridgeHttpClient(options.bridgeUrl);
        this.catalog = new DeskToolCatalog(this.bridge);
        this.server = new Server(
            { name: SERVER_NAME, version: SERVER_VERSION },
            { capabilities: { tools: { listChanged: true } } },
        );
        this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools: [...META_TOOLS, ...this.catalog.list()],
        }));
        this.server.setRequestHandler(CallToolRequestSchema, (req) => this.handleCall(req));
    }

    async listen() {
        // 启动时尽力拉一次:页面未开不阻塞服务,元工具仍可回答状态
        try {
            const count = await this.catalog.refresh();
            console.error(`${LOG_PREFIX} 已装载 ${count} 个导演台工具`);
        } catch (err) {
            console.error(`${LOG_PREFIX} 工具清单暂不可用(${this.catalog.lastError});先暴露元工具`);
        }
        await this.server.connect(new StdioServerTransport());
        console.error(`${LOG_PREFIX} stdio 服务已就绪(桥: ${this.bridge.baseUrl})`);
    }

    async handleCall(request) {
        const { name, arguments: args } = request.params;
        if (name === "desk_status") return this.handleStatus();
        if (name === "desk_refresh_tools") return this.handleRefresh();
        const tool = this.catalog.resolve(name);
        if (!tool) {
            return textResult(
                `未知工具 "${name}"。工具清单来自已连桥的导演台页面;` +
                    "若页面刚打开或重连,先调 desk_refresh_tools 刷新。",
                true,
            );
        }
        try {
            const result = await this.bridge.rpc({
                method: tool.kind === "query" ? "query" : "dispatch",
                action: { type: tool.type, payload: args ?? {} },
            });
            return textResult(this.shapeCommandResult(result), result.ok !== true);
        } catch (err) {
            return textResult(err instanceof Error ? err.message : String(err), true);
        }
    }

    /** 命令结果统一为文本:成功给值,失败给结构化错误(含 issues 供下一步选择)。 */
    shapeCommandResult(result) {
        if (result.ok === true) {
            return {
                ok: true,
                value: result.value ?? null,
                ...(result.partialFailures ? { partialFailures: result.partialFailures } : {}),
            };
        }
        return {
            ok: false,
            error: result.error ?? "unknown",
            issues: result.issues ?? [],
            issueDetails: result.issueDetails ?? [],
            ...(result.partialFailures ? { partialFailures: result.partialFailures } : {}),
        };
    }

    async handleStatus() {
        try {
            const status = await this.bridge.status();
            return textResult({ ...status, deskToolsLoaded: this.catalog.list().length });
        } catch (err) {
            return textResult(err instanceof Error ? err.message : String(err), true);
        }
    }

    async handleRefresh() {
        try {
            const count = await this.catalog.refresh();
            await this.server.notification({ method: "notifications/tools/list_changed" });
            return textResult(`已装载 ${count} 个导演台工具(能力契约派生,与页面同源)。`);
        } catch (err) {
            return textResult(err instanceof Error ? err.message : String(err), true);
        }
    }
}

function resolveCliBridgeUrl(argv) {
    const flag = argv.find((arg) => arg.startsWith("--bridge="));
    return flag ? flag.slice("--bridge=".length) : (process.env.DIRECTOR_BRIDGE_URL ?? DEFAULT_BRIDGE_URL);
}

const currentFile = process.argv[1] ? new URL(`file://${process.argv[1]}`).pathname : "";
if (currentFile.endsWith("mcp-server.mjs")) {
    const server = new DirectorMcpServer({ bridgeUrl: resolveCliBridgeUrl(process.argv.slice(2)) });
    server.listen().catch((err) => {
        console.error(`${LOG_PREFIX} 启动失败:`, err);
        process.exitCode = 1;
    });
}
