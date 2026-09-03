import { TransformControls } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { reaction } from "mobx";
import { observer } from "mobx-react-lite";
import { useEffect, useRef } from "react";
import type { ComponentRef } from "react";

import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { useOrbitSuspension } from "@/ui/viewport/scene/useOrbitSuspension";

/**
 * gizmo 手柄本体:轨道让位守卫与手柄同生命周期。
 *
 * 这条绑定是硬要求(视口卡死的根因):suspend 在 onMouseDown 发出,release 只在 onMouseUp 发出;
 * 若拖拽中途手柄被卸载(重叠的走位把手抢走选中 → 主选变更 → disarm),onMouseUp 永不触发,
 * 让位计数就永久停在 1,OrbitControls 再也不会被启用——表现为视口不响应而 DOM 面板照常。
 * 守卫住在手柄组件内,卸载即归还;守卫若挂在外层控制器上,控制器只是渲染 null 并不卸载,救不回来。
 */
const GizmoHandle = observer(function GizmoHandle({ targetId }: { readonly targetId: string }) {
    const stores = useDirectorDeskStores();
    const { scene, ui, dispatcher } = stores;
    const orbitSuspension = useOrbitSuspension();
    const invalidate = useThree((state) => state.invalidate);
    const controlsRef = useRef<ComponentRef<typeof TransformControls> | null>(null);
    const target = scene.manager.getRuntime(targetId);

    // gizmo 整体打 helper 标记:截图时摘除(07 帧内取样)
    useEffect(() => {
        if (controlsRef.current) controlsRef.current.userData.helper = true;
    }, [target]);

    if (!target) return null;

    const commitDrag = () => {
        ui.noteGizmoInteraction();
        orbitSuspension.release();
        dispatcher.dispatch(
            {
                type: "object.move",
                payload: {
                    id: targetId,
                    transform: {
                        position: [target.position.x, target.position.y, target.position.z],
                        rotation: [target.rotation.x, target.rotation.y, target.rotation.z],
                        scale: [target.scale.x, target.scale.y, target.scale.z],
                    },
                },
            },
            stores,
        );
    };

    return (
        <TransformControls
            object={target}
            ref={controlsRef}
            mode={ui.gizmoMode}
            showX={ui.gizmoAxes.x}
            showY={ui.gizmoAxes.y}
            showZ={ui.gizmoAxes.z}
            onMouseDown={() => {
                ui.noteGizmoInteraction();
                orbitSuspension.suspend();
            }}
            onObjectChange={() => invalidate()}
            onMouseUp={commitDrag}
        />
    );
});

/** gizmo 控制器:只挂主选场景对象的运行时(点击选中不再直接出坐标轴,G 进入变换才挂载)。
 *
 * 机位属于 CameraDirector 管理的独立领域实体:选择机位只用于 Enter 进入掌镜,
 * 不把 marker 交给 TransformControls,避免出现坐标轴与直接拖改机位数据。
 *
 * 性能铁律落实(transient 拖拽):
 * - 拖拽逐帧只改 Object3D(TransformControls 内部),onObjectChange 仅 invalidate——零 store 写入;
 * - 松手(onMouseUp)才把最终 pose 收敛为一条 object.move 命令——撤销/回放/AI 的唯一挂点;
 * - gizmo 拖拽期经 ViewportCameraAuthority 申请轨道让位:drei 在 dragging-changed 时会把默认
 *   控制器无条件置回 enabled=true,掌镜/镜头视角下必须由 OrbitAuthorityRig 重新拨正;
 * - size 不传走默认 1:three 的 TransformControls 内部已按相机距离做恒屏占补偿,
 *   再乘距离系数是双重补偿(远景 gizmo 暴涨的回退教训)。
 */
export const TransformGizmoController = observer(function TransformGizmoController() {
    const { camera, selection, ui } = useDirectorDeskStores();
    const invalidate = useThree((state) => state.invalidate);

    const primaryId = selection.primaryId;
    const isShotSelected = primaryId !== null && camera.director.getShot(primaryId) !== undefined;
    const editingSelectedPose = primaryId !== null && ui.posePickingObjectId === primaryId;
    const armed = ui.isGizmoArmed(primaryId);

    // arm 绑定选中身份:主选变更(点选/取消/切对象)即解除,不残留到下一次选中
    useEffect(
        () =>
            reaction(
                () => selection.primaryId,
                (id) => {
                    if (id !== ui.gizmoArmedId) ui.disarmGizmo();
                },
            ),
        [selection, ui],
    );

    // 选中集/arm 变化 → 高亮与 gizmo 挂载/卸载需要在 demand 模式下补一帧
    const selectionKey = selection.selectedIds.join(",");
    useEffect(() => {
        invalidate();
    }, [selectionKey, armed, invalidate]);

    if (!armed || isShotSelected || editingSelectedPose || primaryId === null) return null;
    return <GizmoHandle targetId={primaryId} />;
});
