import type { Group } from "three";

import { ActorAppearanceBinder } from "@/actor/ActorAppearanceBinder";
import { ActorBuildBinder } from "@/actor/ActorBuildBinder";
import { BodyBuildSolver } from "@/actor/BodyBuildSolver";
import { normalizationFor } from "@/actor/ModelNormalizationPolicy";
import { boneSpanY, lowestBoneWorldY } from "@/actor/rigMetrics";
import type { ActorAppearance } from "@/actor/ActorAppearance";
import type { ActorBuild } from "@/actor/ActorBuild";
import type { SceneManager } from "@/core/SceneManager";

/**
 * 人偶运行时(协调器):把纯数据画像落到 Three 的唯一出口。
 *
 * 命令与 UI 拖拽预览调用的是同一组方法——预览不写实体、不进历史,而任何一次命令执行都会以实体状态
 * 全量重写运行时,预览因此自动作废,不需要额外的失效机制。
 */
export class ActorRuntime {
    private readonly appearanceBinder = new ActorAppearanceBinder();
    private readonly buildBinder = new ActorBuildBinder();
    private readonly solver = new BodyBuildSolver();
    private readonly shellsByObject = new Map<string, Group>();
    /** rest 姿态下「最低骨骼 ÷ 身高」的比例:趾/踝关节高于鞋底,贴地时必须保留这段余量。 */
    private readonly clearanceRatios = new Map<string, number>();

    constructor(private readonly scene: SceneManager) {}

    /** 同一 shell 重复 attach 只做同步:重复克隆材质会泄漏,重复取余量会把当前姿势当成 rest。 */
    attach(objectId: string, shell: Group): void {
        if (this.shellsByObject.get(objectId) === shell) {
            this.sync(objectId);
            return;
        }
        this.shellsByObject.set(objectId, shell);
        this.appearanceBinder.attach(objectId, shell);
        this.buildBinder.attach(objectId, shell);
        // 余量必须在任何姿势写入之前取:此时骨架仍是 bind 姿态
        this.recordClearance(objectId, shell);
        this.sync(objectId);
    }

    detach(objectId: string): void {
        this.shellsByObject.delete(objectId);
        this.clearanceRatios.delete(objectId);
        this.appearanceBinder.detach(objectId);
        this.buildBinder.detach(objectId);
    }

    /** 实体画像 → 运行时的全量同步(挂载、撤销、文档导入后的唯一入口)。 */
    sync(objectId: string): void {
        const actor = this.scene.getEntity(objectId)?.actor;
        if (!actor) return;
        this.paint(objectId, actor.appearance);
        this.shape(objectId, actor.build);
    }

    paint(objectId: string, appearance: ActorAppearance): void {
        this.appearanceBinder.paint(objectId, appearance);
    }

    shape(objectId: string, build: ActorBuild): void {
        this.buildBinder.shape(objectId, this.solver.solve(build));
        this.normalize(objectId);
    }

    /**
     * 落尺入口:渲染层在骨架矩阵就绪的第二帧调用一次,之后每次体型提交自行重算。
     * 策略按骨骼跨度做乘法修正,重入收敛,挂载早期骨架未就绪时会自行跳过。
     */
    normalize(objectId: string): void {
        const shell = this.shellsByObject.get(objectId);
        const entity = this.scene.getEntity(objectId);
        if (!shell || !entity) return;
        normalizationFor(entity).normalize(shell);
    }

    /**
     * 贴地目标高度:人偶按 rest 余量折算(骨骼度量),非人偶返回 null 由调用方走包围盒。
     * 这条余量不能省——最低骨骼是趾关节而非鞋底,按 0 贴地会把脚埋进地面。
     */
    groundTargetY(objectId: string): number | null {
        const entity = this.scene.getEntity(objectId);
        const ratio = this.clearanceRatios.get(objectId);
        if (!entity?.actor || ratio === undefined) return null;
        return ratio * entity.actor.build.heightMeters * entity.transform.scale[1];
    }

    private recordClearance(objectId: string, shell: Group): void {
        const span = boneSpanY(shell);
        const lowest = lowestBoneWorldY(shell);
        const originY = shell.parent?.matrixWorld.elements[13] ?? 0;
        if (span > 0 && lowest !== null) this.clearanceRatios.set(objectId, (lowest - originY) / span);
    }

    dispose(): void {
        this.shellsByObject.clear();
        this.appearanceBinder.dispose();
        this.buildBinder.dispose();
    }
}
