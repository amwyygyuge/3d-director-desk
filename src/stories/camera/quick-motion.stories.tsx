import type { Meta, StoryObj } from "@storybook/react-vite";

import type { DirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { DirectorDesk } from "@/ui/shell/DirectorDesk";
import { TEST_ASSETS } from "@/stories/seeds";
import { assertAcceptance, dispatchCatching, dispatchOk as dispatch } from "@/stories/harness";

const SUBJECT_ID = "quick-motion-subject";
const ORBIT_MOTION_ID = `motion-${SUBJECT_ID}-orbit-0`;
const ZOOM_MOTION_ID = `motion-${SUBJECT_ID}-dolly-zoom-2`;
const ORBIT_KEY_COUNT_360 = 13;
const DEFAULT_TIMELINE_DURATION = 10;
const ORBIT_RADIUS_METERS = 3;
const ORBIT_RADIUS_EPSILON = 1e-6;

function seedQuickMotionAcceptance(stores: DirectorDeskStores): void {
    const capabilityTypes = stores.dispatcher.listCapabilities().map((capability) => capability.type);
    assertAcceptance(capabilityTypes.includes("motion.quick-author"), "motion.quick-author capability 未注册");

    dispatch(stores, "object.place", {
        id: SUBJECT_ID,
        kind: "model",
        sourceUrl: TEST_ASSETS.helmet,
        transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    });

    // 围栏:参数越界走领域拒绝(!ok);非法枚举撞契约闸门(dev throw/生产 !ok,dispatchCatching 归一两态)
    const badDegrees = dispatchCatching(stores, "motion.quick-author", {
        subjectId: SUBJECT_ID,
        shotSize: "medium",
        move: "orbit",
        durationSeconds: 2,
        orbit: { degrees: 500 },
    });
    assertAcceptance(!badDegrees.ok && badDegrees.issues?.[0]?.includes("环绕参数"), "orbit 围栏未生效");
    const badDirection = dispatchCatching(stores, "motion.quick-author", {
        subjectId: SUBJECT_ID,
        shotSize: "medium",
        move: "orbit",
        durationSeconds: 2,
        orbit: { direction: "x" },
    });
    assertAcceptance(!badDirection.ok, "direction 围栏未生效");
    const badRadius = dispatchCatching(stores, "motion.quick-author", {
        subjectId: SUBJECT_ID,
        shotSize: "medium",
        move: "orbit",
        durationSeconds: 2,
        orbit: { radiusMeters: 0.1 },
    });
    assertAcceptance(!badRadius.ok && badRadius.issues?.[0]?.includes("环绕参数"), "radiusMeters 围栏未生效");

    // 360° 环绕:片段追加 Program 末尾、跟拍绑定、键数按角度自适应，且不创建静态机位依赖。
    dispatch(stores, "motion.quick-author", {
        subjectId: SUBJECT_ID,
        shotSize: "medium",
        move: "orbit",
        durationSeconds: 2,
        orbit: { degrees: 360, direction: "ccw", radiusMeters: ORBIT_RADIUS_METERS },
    });
    const orbitClip = stores.motion.clip(ORBIT_MOTION_ID);
    assertAcceptance(orbitClip !== undefined, "环绕片段未创建");
    assertAcceptance(stores.camera.director.listShots().length === 0, "快速运镜不应创建静态机位依赖");
    assertAcceptance(orbitClip.startTimeSeconds === 0, "首段应从 Program 0 时刻开始");
    assertAcceptance(orbitClip.keys.length === ORBIT_KEY_COUNT_360, `360° 环绕应自适应为 ${ORBIT_KEY_COUNT_360} 键`);
    const radii = orbitClip.keys.map((key) => Math.hypot(key.position[0], key.position[2]));
    assertAcceptance(
        radii.every((radius) => Math.abs(radius - ORBIT_RADIUS_METERS) <= ORBIT_RADIUS_EPSILON),
        "环绕关键帧未落在指定半径的圆上",
    );
    assertAcceptance(orbitClip.focus?.target?.kind === "scene-object", "被摄对象未自动绑跟拍");
    assertAcceptance(stores.motion.program.clips.length === 1, "Program 输出未跟随");

    // 第二段:滑动变焦(末帧 fov 反比放大,主体构图不变)+ 追加在 Program 末尾
    dispatch(stores, "motion.quick-author", {
        subjectId: SUBJECT_ID,
        shotSize: "medium",
        move: "dolly-zoom",
        durationSeconds: 2,
    });
    const zoomClip = stores.motion.clip(ZOOM_MOTION_ID);
    assertAcceptance(zoomClip !== undefined, "滑动变焦片段未创建");
    assertAcceptance(zoomClip.startTimeSeconds === 2, "第二段未追加到 Program 末尾");
    const lastKey = zoomClip.keys[zoomClip.keys.length - 1];
    const firstOrbitFov = orbitClip.keys[0];
    assertAcceptance(
        lastKey !== undefined && firstOrbitFov !== undefined && lastKey.fov > firstOrbitFov.fov,
        "滑动变焦末帧 fov 未放大",
    );

    // 第三段:超出时间轴时长 → 一并扩轴;撤销一步整体回滚(片段/机位/时长)
    dispatch(stores, "motion.quick-author", {
        subjectId: SUBJECT_ID,
        shotSize: "long",
        move: "spiral",
        durationSeconds: 8,
        orbit: { degrees: 180 },
    });
    assertAcceptance(stores.timeline.document.duration > DEFAULT_TIMELINE_DURATION, "超轴片段未触发扩时长");

    assertAcceptance(stores.history.undo(stores).ok, "spiral undo 失败");
    assertAcceptance(stores.timeline.document.duration === DEFAULT_TIMELINE_DURATION, "undo 未恢复时间轴时长");
    assertAcceptance(stores.history.undo(stores).ok, "dolly-zoom undo 失败");
    assertAcceptance(stores.motion.clip(ZOOM_MOTION_ID) === undefined, "undo 未移除变焦片段");
    assertAcceptance(stores.history.redo(stores).ok, "redo 失败");
    assertAcceptance(stores.motion.clip(ZOOM_MOTION_ID) !== undefined, "redo 未重放变焦片段");

    stores.selection.select(SUBJECT_ID);
}

const meta: Meta<typeof DirectorDesk> = {
    title: "镜头/快速运镜",
    component: DirectorDesk,
};

export default meta;

type Story = StoryObj<typeof DirectorDesk>;

/**
 * 验收:选中模型 → 检查器「运镜」tab → 景别/语汇/转角/方向/环绕半径/时长 → 创建。
 * 播种已断言:围栏拒绝非法参数、360° 环绕键数自适应、固定圆半径、Program 追加、跟拍绑定、滑动变焦 fov、
 * 超轴扩时长与单步撤销/重放。右侧检查器应显示「运镜」tab 可直接再走查一遍 UI 路径。
 */
export const QuickMotionPresets: Story = {
    name: "快速运镜与预设语汇",
    render: () => (
        <div style={{ width: "100vw", height: "100vh" }}>
            <DirectorDesk onReady={seedQuickMotionAcceptance} />
        </div>
    ),
};
