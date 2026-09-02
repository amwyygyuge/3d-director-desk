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
 * 高度不取包围盒——内置人形是 armature 缩放型 rig,`SkinnedMesh.computeBoundingBox` 随壳层缩放线性膨胀,
 * 再乘 `matrixWorld` 就是二次量,重入一次身高就漂一个数量级(已实测)。
 *
 * `heightPerScale`(每单位壳缩放对应的真实身高)由调用方在 **rest 姿态**量一次后传入:骨骼跨度在坐姿、
 * 卧姿下远小于身高,若每次落尺都现测,换个姿势身高就会被放大(实测坐姿下放大 2.35 倍)。
 *
 * 不做居中与贴地:Mixamo rig 的原点即脚底中心,姿势引起的位移由 PoseGroundingService 单独负责。
 */
class ActorHeightNormalization implements ShellNormalization {
    constructor(
        private readonly heightMeters: number,
        private readonly heightPerScale: number,
    ) {}

    normalize(shell: Group): void {
        if (this.heightPerScale <= 0) return;
        shell.scale.setScalar(this.heightMeters / this.heightPerScale);
        shell.position.set(0, 0, 0);
    }
}

/** rest 姿态下「身高 ÷ 壳缩放」:落尺的唯一标定量,只在挂载时量一次。 */
export function measureHeightPerScale(shell: Group): number {
    const scale = shell.scale.y;
    return scale > 0 ? boneSpanY(shell) / scale : 0;
}

const UNIT_BOX_NORMALIZATION = new UnitBoxNormalization();

/** 人偶落尺需要 rest 姿态标定量;缺标定(骨架未就绪)时退化为不改变壳层。 */
export function normalizationFor(entity: SceneObject, heightPerScale = 0): ShellNormalization {
    const actor = entity.actor;
    return actor ? new ActorHeightNormalization(actor.build.heightMeters, heightPerScale) : UNIT_BOX_NORMALIZATION;
}
