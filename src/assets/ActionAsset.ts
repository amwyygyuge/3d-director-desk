/** 动作资产值对象:动作 GLB/FBX 的纯数据描述;clip 本体在 AnimationLibrary 的运行时表 */
export class ActionAsset {
    readonly id: string;
    readonly name: string;
    readonly url: string;
    readonly duration: number;
    /** clip 轨道目标节点名(骨骼预检的展示/诊断素材) */
    readonly trackNames: readonly string[];

    constructor(init: { id: string; name: string; url: string; duration: number; trackNames: readonly string[] }) {
        this.id = init.id;
        this.name = init.name;
        this.url = init.url;
        this.duration = init.duration;
        this.trackNames = init.trackNames;
        Object.freeze(this);
    }
}
