/** 动作循环语义:loop 可无缝循环;once 到达排期时长后钳住末帧,不再瞬跳回首帧。 */
export const ACTION_LOOP_MODE = {
    LOOP: "loop",
    ONCE: "once",
} as const;
export type ActionLoopMode = (typeof ACTION_LOOP_MODE)[keyof typeof ACTION_LOOP_MODE];

export function isActionLoopMode(value: unknown): value is ActionLoopMode {
    return value === ACTION_LOOP_MODE.LOOP || value === ACTION_LOOP_MODE.ONCE;
}

/** 动作资产值对象:动作 GLB/FBX 的纯数据描述;clip 本体在 AnimationLibrary 的运行时表 */
export class ActionAsset {
    readonly id: string;
    readonly name: string;
    readonly url: string;
    readonly duration: number;
    readonly loopMode: ActionLoopMode;
    readonly trimStartSeconds: number;
    readonly trimEndSeconds: number;
    /** clip 轨道目标节点名(骨骼预检的展示/诊断素材) */
    readonly trackNames: readonly string[];

    constructor(init: {
        id: string;
        name: string;
        url: string;
        duration: number;
        loopMode: ActionLoopMode;
        trimStartSeconds: number;
        trimEndSeconds: number;
        trackNames: readonly string[];
    }) {
        this.id = init.id;
        this.name = init.name;
        this.url = init.url;
        this.duration = init.duration;
        this.loopMode = init.loopMode;
        this.trimStartSeconds = init.trimStartSeconds;
        this.trimEndSeconds = init.trimEndSeconds;
        this.trackNames = init.trackNames;
        Object.freeze(this);
    }
}
