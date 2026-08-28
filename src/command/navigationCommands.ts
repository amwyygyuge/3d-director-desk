import { Box3, Vector3 } from "three";

import { FramingService } from "../camera/FramingService";
import { DirectorCommand } from "./DirectorCommand";
import type { DirectorContext } from "./DirectorCommand";
import type { CommandDispatcher } from "./CommandDispatcher";

const framing = new FramingService();

interface FrameViewPayload {
    /** 取景对象 id 集合;缺省 = 全部对象(F vs Home 的差别只在 payload) */
    ids?: string[];
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
        const ids = this.payload.ids ?? ctx.scene.manager.list().map((e) => e.id);
        if (ids.length === 0) return ["场景为空,无可取景对象"];
        return ids.every((id) => ctx.scene.manager.getRuntime(id)) ? [] : ["存在未就绪(加载中)的对象"];
    }

    execute(ctx: DirectorContext): void {
        const ids = this.payload.ids ?? ctx.scene.manager.list().map((e) => e.id);
        const bounds = new Box3();
        const tmp = new Box3();
        for (const id of ids) {
            const runtime = ctx.scene.manager.getRuntime(id);
            if (runtime) bounds.union(tmp.setFromObject(runtime));
        }
        if (bounds.isEmpty()) return;
        const center = new Vector3();
        const size = new Vector3();
        bounds.getCenter(center);
        bounds.getSize(size);
        const pose = framing.frame({
            center: [center.x, center.y, center.z],
            radius: size.length() / 2,
            fromPose: ctx.camera.lastDirectorPose,
        });
        ctx.camera.requestDirectorPose(pose);
    }
}

export function registerNavigationCommands(dispatcher: CommandDispatcher): void {
    dispatcher.register(FrameViewCommand.TYPE, (payload: FrameViewPayload) => new FrameViewCommand(payload));
}
