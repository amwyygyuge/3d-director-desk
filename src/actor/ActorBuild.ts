/**
 * 人偶体型参数(值对象)。
 *
 * 身高走真实米制,由归一化策略在壳层等比缩放兑现——等比不产生剪切,且「相距两米」「比他高半个头」
 * 这类空间语义才有可信读数。围度与肩宽是骨骼级非均匀缩放,故取无量纲倍率。
 */
export interface ActorBuildRange {
    readonly min: number;
    readonly max: number;
    readonly default: number;
}

export const ACTOR_HEIGHT_METERS: ActorBuildRange = { min: 1.2, max: 2.1, default: 1.75 };
export const ACTOR_GIRTH_SCALE: ActorBuildRange = { min: 0.85, max: 1.25, default: 1 };
export const ACTOR_SHOULDER_SCALE: ActorBuildRange = { min: 0.85, max: 1.2, default: 1 };

function clamp(value: number, range: ActorBuildRange): number {
    return Math.min(range.max, Math.max(range.min, value));
}

function resolve(value: number | undefined, range: ActorBuildRange, field: string): number {
    const raw = value ?? range.default;
    if (!Number.isFinite(raw)) throw new Error(`ActorBuild: ${field} 必须是有限数值`);
    return clamp(raw, range);
}

export interface ActorBuildInit {
    readonly heightMeters?: number;
    readonly girthScale?: number;
    readonly shoulderScale?: number;
}

export class ActorBuild {
    readonly heightMeters: number;
    readonly girthScale: number;
    readonly shoulderScale: number;

    constructor(init: ActorBuildInit = {}) {
        this.heightMeters = resolve(init.heightMeters, ACTOR_HEIGHT_METERS, "heightMeters");
        this.girthScale = resolve(init.girthScale, ACTOR_GIRTH_SCALE, "girthScale");
        this.shoulderScale = resolve(init.shoulderScale, ACTOR_SHOULDER_SCALE, "shoulderScale");
        Object.freeze(this);
    }

    with(patch: ActorBuildInit): ActorBuild {
        return new ActorBuild({ ...this.toJSON(), ...patch });
    }

    equals(other: ActorBuild): boolean {
        return (
            this.heightMeters === other.heightMeters &&
            this.girthScale === other.girthScale &&
            this.shoulderScale === other.shoulderScale
        );
    }

    /** 骨骼缩放是否为恒等:是则运行时可整段跳过写入。 */
    get hasNeutralBones(): boolean {
        return this.girthScale === ACTOR_GIRTH_SCALE.default && this.shoulderScale === ACTOR_SHOULDER_SCALE.default;
    }

    toJSON(): Required<ActorBuildInit> {
        return {
            heightMeters: this.heightMeters,
            girthScale: this.girthScale,
            shoulderScale: this.shoulderScale,
        };
    }
}
