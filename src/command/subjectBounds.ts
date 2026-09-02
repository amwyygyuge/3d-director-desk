import { Box3, Vector3 } from "three";

import { measureModelBox } from "@/core/measureModelBox";
import type { CommandIssue, CommandIssueOption, DirectorContext } from "@/command/DirectorCommand";
import type { SceneObject, Vec3 } from "@/core/SceneObject";

/** 实体装载态:场景描述与装载闸门(place-relative/scene.stage)共用同一判定(Rule of Two) */
export type EntityLoadState = "none" | "loading" | "loaded" | "failed";

/** 装载态判定:结局表是唯一事实源——runtime 外层组在内容加载前就绑定,不能当 loaded 证据 */
export function entityLoadState(ctx: DirectorContext, entity: SceneObject): EntityLoadState {
    if (entity.kind !== "model") return "none";
    if (ctx.ui.loading.has(entity.id)) return "loading";
    return ctx.ui.modelOutcomes.get(entity.id) ?? "loading";
}

/** 装载闸门的下一步建议:AI 按断言协议等待 loaded 后重试 */
export const WAIT_FOR_MODEL_OPTION: readonly CommandIssueOption[] = [
    { type: "wait-for-model", label: "等待模型加载完成后重试" },
];

/**
 * 装载闸门:间距语义强依赖包围球半径——未装载时半径回退 0 会摆出互穿结果,故拒绝而非降级
 * (取景类命令保持宽松,不卡作者)。place-relative 与 scene.stage 共用。
 */
export function entityReadinessIssue(ctx: DirectorContext, entity: SceneObject, path: string): CommandIssue | null {
    const state = entityLoadState(ctx, entity);
    if (state === "loaded" || state === "none") return null;
    return {
        code: "model-not-loaded",
        path,
        message: `对象 "${entity.id}" 尚未装载完成(当前 ${state}),间距语义需要真实包围球`,
        options: WAIT_FOR_MODEL_OPTION,
    };
}

/** 被摄体的构图度量:包围球的世界中心与半径。 */
export interface SubjectBounds {
    readonly center: Vec3;
    readonly radius: number;
}

/** 可跟拍被摄体的构图度量:附带从运行时根节点到构图中心的世界偏移。 */
export interface SubjectFocusBounds extends SubjectBounds {
    readonly focusOffset: Vec3;
}

const TMP_BOX = new Box3();
const TMP_SIZE = new Vector3();
const TMP_CENTER = new Vector3();
const TMP_ROOT_POSITION = new Vector3();
const RADIUS_DIVISOR = 2;

/**
 * 被摄体度量解析(运行时读取,不写任何状态)。
 *
 * 运行时未就绪(模型仍在加载)时回退到实体权威 transform 的位置,半径为 0——
 * 预设仍可生成,只是不做景别定距,失败路径不把作者卡住。
 */
export function subjectBoundsFor(ctx: DirectorContext, objectId: string): SubjectFocusBounds | null {
    const entity = ctx.scene.manager.getEntity(objectId);
    if (!entity) return null;
    const runtime = ctx.scene.manager.getRuntime(objectId);
    if (!runtime) return { center: entity.transform.position, radius: 0, focusOffset: [0, 0, 0] };
    measureModelBox(runtime, TMP_BOX);
    if (TMP_BOX.isEmpty()) return { center: entity.transform.position, radius: 0, focusOffset: [0, 0, 0] };
    TMP_BOX.getCenter(TMP_CENTER);
    TMP_BOX.getSize(TMP_SIZE);
    runtime.getWorldPosition(TMP_ROOT_POSITION);
    const center: Vec3 = [TMP_CENTER.x, TMP_CENTER.y, TMP_CENTER.z];
    return {
        center,
        radius: TMP_SIZE.length() / RADIUS_DIVISOR,
        focusOffset: [
            center[0] - TMP_ROOT_POSITION.x,
            center[1] - TMP_ROOT_POSITION.y,
            center[2] - TMP_ROOT_POSITION.z,
        ],
    };
}
