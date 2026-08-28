import type { CameraStore } from "../store/CameraStore";
import type { SceneStore } from "../store/SceneStore";
import type { TimeTransport } from "../time/TimeTransport";

/**
 * 命令执行上下文:命令可触达的状态面。
 * DirectorDeskStores 在结构上天然满足本接口(接口隔离:命令不需要 selection 等 UI 态)。
 */
export interface DirectorContext {
    readonly scene: SceneStore;
    readonly camera: CameraStore;
    readonly clock: TimeTransport;
}

export type CommandResult = { ok: true } | { ok: false; error: string; issues?: string[] };

/** 线上传输形态:AI 工具调用 / HostBridge 消息 / 回放日志都是它 */
export interface SerializedCommand {
    readonly type: string;
    readonly payload: unknown;
}

/**
 * 导演命令抽象基类(命令层唯一入口)。
 *
 * 纪律:UI 交互、宿主消息、AI 工具调用对场景的一切写操作,
 * 都必须收敛为 DirectorCommand 经 CommandDispatcher 分发——
 * 这是 AI 接入、撤销、操作回放日志的唯一挂点。
 *
 * 实现约束:
 * - payload 必须纯数据可序列化(JSON 往返不丢信息);
 * - validate 先于 execute,非法输入产出结构化 issues 供调用方(AI)重试;
 * - execute 内不抛异常,领域错误走 CommandResult。
 */
export abstract class DirectorCommand<P = unknown> {
    abstract readonly type: string;
    abstract readonly payload: P;

    /** 返回问题列表,空数组 = 校验通过 */
    abstract validate(ctx: DirectorContext): string[];

    abstract execute(ctx: DirectorContext): void;
}
