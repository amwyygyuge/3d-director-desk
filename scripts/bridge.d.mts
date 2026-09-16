/** scripts/bridge.mjs 的类型声明(手写;源为 .mjs,不纳入 tsc 编译范围) */

export interface DirectorBridgeOptions {
    readonly port?: number;
    /** 绑定地址,默认 127.0.0.1;暴露内网用 0.0.0.0(桥无鉴权,公网需自行前置带鉴权的 TLS 反代) */
    readonly host?: string;
    /** 显式开启 eval 通道;缺省读 DIRECTOR_BRIDGE_ALLOW_EVAL=1 */
    readonly allowEval?: boolean;
    /** 完整 Origin 白名单(替换默认);CLI 的 --origins 是与默认合并后的结果 */
    readonly allowedOrigins?: readonly string[];
}

export class DirectorBridgeServer {
    constructor(options?: DirectorBridgeOptions);
    readonly evalAllowed: boolean;
    readonly listening: boolean;
    listen(port?: number): Promise<DirectorBridgeServer>;
    close(): Promise<void>;
}

/** 进程内按端口缓存桥接实例;重复调用返回同一实例。 */
export function startDirectorBridge(options?: DirectorBridgeOptions): DirectorBridgeServer;

/** 关闭并移除端口上的缓存实例,供 vite 配置热重启调用。 */
export function stopDirectorBridge(port?: number): Promise<void>;
