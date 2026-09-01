import { Box3, Vector3 } from "three";

import type { DirectorContext } from "@/command/DirectorCommand";
import { measureModelBox } from "@/core/measureModelBox";
import type { Vec3 } from "@/core/SceneObject";

/** 被摄体的构图度量:中心与包围球半径,景别与环绕预设据此定距。 */
export interface SubjectBounds {
    readonly center: Vec3;
    readonly radius: number;
}

const TMP_BOX = new Box3();
const TMP_SIZE = new Vector3();
const TMP_CENTER = new Vector3();
const RADIUS_DIVISOR = 2;

/**
 * 被摄体度量解析(运行时读取,不写任何状态)。
 *
 * 运行时未就绪(模型仍在加载)时回退到实体权威 transform 的位置,半径为 0——
 * 预设仍可生成,只是不做景别定距,失败路径不把作者卡住。
 */
export function subjectBoundsFor(ctx: DirectorContext, objectId: string): SubjectBounds | null {
    const entity = ctx.scene.manager.getEntity(objectId);
    if (!entity) return null;
    const runtime = ctx.scene.manager.getRuntime(objectId);
    if (!runtime) return { center: entity.transform.position, radius: 0 };
    measureModelBox(runtime, TMP_BOX);
    if (TMP_BOX.isEmpty()) return { center: entity.transform.position, radius: 0 };
    TMP_BOX.getCenter(TMP_CENTER);
    TMP_BOX.getSize(TMP_SIZE);
    return { center: [TMP_CENTER.x, TMP_CENTER.y, TMP_CENTER.z], radius: TMP_SIZE.length() / RADIUS_DIVISOR };
}
