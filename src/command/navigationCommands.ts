import { Box3, Vector3 } from "three";

import { FramingService, isViewDirection } from "@/camera/FramingService";
import type { ViewDirection } from "@/camera/FramingService";
import { DirectorCommand } from "@/command/DirectorCommand";
import type { DirectorContext } from "@/command/DirectorCommand";
import type { CommandCapability, CommandDispatcher } from "@/command/CommandDispatcher";
import { HOME_DIRECTOR_POSE } from "@/store/CameraStore";

const framing = new FramingService();

/** 取景包围盒:validate 与 execute 共用同一计算——空盒(纯灯光等无几何运行时)两处结论必须一致 */
function computeFrameBounds(ctx: DirectorContext, ids: readonly string[]): Box3 {
    const bounds = new Box3();
    const tmp = new Box3();
    for (const id of ids) {
        const runtime = ctx.scene.manager.getRuntime(id);
        if (runtime) bounds.union(tmp.setFromObject(runtime));
    }
    return bounds;
}

const VIEW_CONTROL_PERMISSION = "view:control";
const VIEW_APPLIES_WHEN = "director-desk.view-v1";

interface FrameViewPayload {
    /** 取景对象 id 集合;缺省 = 全部对象(F vs Home 的差别只在 payload) */
    ids?: string[];
    /** 轴向取景方位(前/顶/右);缺省保持当前朝向只推距离 */
    direction?: ViewDirection;
}

/**
 * 取景命令:把导演相机对准给定对象(或全部)的包围球。
 * 视角导航按 DCC 惯例不入撤销栈(相机移动是浏览行为,不是编辑行为),故无 invert。
 * 应用路径:命令只写 CameraStore.requestDirectorPose(纯数据),实际相机移动由 ShotCameraRig 消费。
 */
export class FrameViewCommand extends DirectorCommand<FrameViewPayload> {
    static readonly TYPE = "view.frame";
    readonly type = FrameViewCommand.TYPE;

    constructor(readonly payload: FrameViewPayload = {}) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        if (this.payload.direction !== undefined && !isViewDirection(this.payload.direction)) {
            return [`未知取景方位:${String(this.payload.direction)}`];
        }
        // 掌镜/镜头视角/全屏预览下相机由机位/运镜/播放驱动,rig 会丢弃取景请求——结构化失败,不静默
        if (ctx.camera.activeShotId !== null || ctx.motionAuthoring.lensViewActive || ctx.layout.presentationMode) {
            return ["掌镜/镜头视角/全屏预览中取景不生效,先 Esc 退出再取景"];
        }
        const ids = this.payload.ids ?? ctx.scene.manager.list().map((e) => e.id);
        if (ids.length === 0) return ["场景为空,无可取景对象"];
        if (!ids.every((id) => ctx.scene.manager.getRuntime(id))) return ["存在未就绪(加载中)的对象"];
        if (computeFrameBounds(ctx, ids).isEmpty()) return ["取景目标无可见体积(如纯灯光),无法取景"];
        return [];
    }

    execute(ctx: DirectorContext): void {
        const ids = this.payload.ids ?? ctx.scene.manager.list().map((e) => e.id);
        const bounds = computeFrameBounds(ctx, ids);
        if (bounds.isEmpty()) return;
        const center = new Vector3();
        const size = new Vector3();
        bounds.getCenter(center);
        bounds.getSize(size);
        const pose = framing.frame({
            center: [center.x, center.y, center.z],
            radius: size.length() / 2,
            fromPose: ctx.camera.lastDirectorPose,
            direction: this.payload.direction,
        });
        ctx.camera.requestDirectorPose(pose);
    }
}

/** 重置视角:回初始工作室机位(HOME_DIRECTOR_POSE 单一真相源);同为浏览行为,不入撤销栈 */
export class ViewResetCommand extends DirectorCommand<Record<string, never>> {
    static readonly TYPE = "view.reset";
    readonly type = ViewResetCommand.TYPE;

    constructor(readonly payload: Record<string, never> = {}) {
        super();
    }

    validate(): string[] {
        return [];
    }

    execute(ctx: DirectorContext): void {
        ctx.camera.requestDirectorPose(HOME_DIRECTOR_POSE);
    }
}

const FRAME_VIEW_CAPABILITY: CommandCapability = {
    type: FrameViewCommand.TYPE,
    version: "1",
    kind: "command",
    permissions: [VIEW_CONTROL_PERMISSION],
    appliesWhen: VIEW_APPLIES_WHEN,
};

export function registerNavigationCommands(dispatcher: CommandDispatcher): void {
    dispatcher.register(
        FrameViewCommand.TYPE,
        (payload: FrameViewPayload) => new FrameViewCommand(payload),
        FRAME_VIEW_CAPABILITY,
    );
    dispatcher.register(ViewResetCommand.TYPE, (payload: Record<string, never>) => new ViewResetCommand(payload), {
        ...FRAME_VIEW_CAPABILITY,
        type: ViewResetCommand.TYPE,
    });
}
