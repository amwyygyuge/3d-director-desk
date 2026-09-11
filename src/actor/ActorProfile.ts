import { ActorAppearance } from "@/actor/ActorAppearance";
import type { ActorAppearanceInit } from "@/actor/ActorAppearance";
import { ActorBuild } from "@/actor/ActorBuild";
import type { ActorBuildInit } from "@/actor/ActorBuild";

export interface ActorProfileInit {
    /** 骨架家族(如 "ue"):体型解算与姿势库的兼容判据,随实体走而不再反查资源目录。 */
    readonly skeletonFamily: string;
    readonly appearance?: ActorAppearanceInit;
    readonly build?: ActorBuildInit;
}

/**
 * 人偶画像(聚合内值对象):模型实体成为「人偶」的显式凭据。
 *
 * 有画像 ⇒ 该实体可被外观/体型/姿势命令作用;无画像的模型仍是普通模型。
 * 全字段可 JSON 往返,不持有任何 Three 引用。
 */
export class ActorProfile {
    readonly skeletonFamily: string;
    readonly appearance: ActorAppearance;
    readonly build: ActorBuild;

    constructor(init: ActorProfileInit) {
        if (typeof init.skeletonFamily !== "string" || init.skeletonFamily.length === 0) {
            throw new Error("ActorProfile: skeletonFamily 不能为空");
        }
        this.skeletonFamily = init.skeletonFamily;
        this.appearance = new ActorAppearance(init.appearance);
        this.build = new ActorBuild(init.build);
        Object.freeze(this);
    }

    withAppearance(appearance: ActorAppearance): ActorProfile {
        return new ActorProfile({
            skeletonFamily: this.skeletonFamily,
            appearance: appearance.toJSON(),
            build: this.build.toJSON(),
        });
    }

    withBuild(build: ActorBuild): ActorProfile {
        return new ActorProfile({
            skeletonFamily: this.skeletonFamily,
            appearance: this.appearance.toJSON(),
            build: build.toJSON(),
        });
    }

    toJSON(): Required<ActorProfileInit> {
        return {
            skeletonFamily: this.skeletonFamily,
            appearance: this.appearance.toJSON(),
            build: this.build.toJSON(),
        };
    }
}

export function isActorProfileInit(value: unknown): value is ActorProfileInit {
    return (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value) &&
        typeof (value as ActorProfileInit).skeletonFamily === "string"
    );
}
