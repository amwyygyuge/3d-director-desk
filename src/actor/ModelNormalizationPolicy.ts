import { Box3, Vector3 } from "three";
import type { Group } from "three";

import { boneSpanY } from "@/actor/rigMetrics";
import { measureModelBox } from "@/core/measureModelBox";
import type { SceneObject } from "@/core/SceneObject";

/** 通用模型归一化目标:最大边缩放到 2 个场景单位——游戏模型单位各异(cm/m),裸放会糊满屏。 */
const MODEL_TARGET_MAX_DIM = 2;
const NO_SCALE_FACTOR = 1;

const TMP_BOX = new Box3();
const TMP_SIZE = new Vector3();
const TMP_CENTER = new Vector3();

/** 壳层落尺策略:两种归一化的测量口径本就不同(见下),所以各自拥有完整流程而非只换一个系数。 */
export interface ShellNormalization {
    normalize(shell: Group): void;
}

/** 通用模型:包围盒等比缩放 + 水平居中 + 底面贴地;只在挂载后执行一次(测量口径不可重入)。 */
class UnitBoxNormalization implements ShellNormalization {
    normalize(shell: Group): void {
        measureModelBox(shell, TMP_BOX);
        if (TMP_BOX.isEmpty()) return;
        TMP_BOX.getSize(TMP_SIZE);
        TMP_BOX.getCenter(TMP_CENTER);
        const maxDim = Math.max(TMP_SIZE.x, TMP_SIZE.y, TMP_SIZE.z);
        const factor = maxDim > 0 ? MODEL_TARGET_MAX_DIM / maxDim : NO_SCALE_FACTOR;
        shell.scale.setScalar(factor);
        shell.position.set(-TMP_CENTER.x * factor, -TMP_BOX.min.y * factor, -TMP_CENTER.z * factor);
    }
}

/**
 * 人偶按真实身高落尺:场景单位即米,「相距两米」「比他高半个头」这类空间语义才有可信读数。
 *
 * 高度不取包围盒——内置人形是 armature 缩放型 rig,`SkinnedMesh.computeBoundingBox` 的结果随壳层缩放
 * 线性膨胀,再乘 `matrixWorld` 就是二次量,重入一次身高就漂一个数量级(已实测)。骨骼世界坐标是线性的,
 * 因此按骨骼跨度定高,并以乘法修正当前缩放,任意次调用都收敛到同一身高。
 *
 * 不做居中与贴地:Mixamo rig 的原点即脚底中心,姿势引起的位移由 PoseGroundingService 单独负责。
 */
class ActorHeightNormalization implements ShellNormalization {
    constructor(private readonly heightMeters: number) {}

    normalize(shell: Group): void {
        const span = boneSpanY(shell);
        if (span <= 0) return;
        shell.scale.multiplyScalar(this.heightMeters / span);
        shell.position.set(0, 0, 0);
    }
}

const UNIT_BOX_NORMALIZATION = new UnitBoxNormalization();

export function normalizationFor(entity: SceneObject): ShellNormalization {
    const actor = entity.actor;
    return actor ? new ActorHeightNormalization(actor.build.heightMeters) : UNIT_BOX_NORMALIZATION;
}
