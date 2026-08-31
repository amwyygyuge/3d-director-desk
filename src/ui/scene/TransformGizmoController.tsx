import { TransformControls } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { observer } from "mobx-react-lite";
import { useEffect, useRef } from "react";
import type { ComponentRef } from "react";

import { useDirectorDeskStores } from "../DirectorDeskContext";

/** gizmo 控制器:只挂主选场景对象的运行时。
 *
 * 机位属于 CameraDirector 管理的独立领域实体:选择机位只用于 Enter 进入掌镜,
 * 不把 marker 交给 TransformControls,避免出现坐标轴与直接拖改机位数据。
 *
 * 性能铁律落实(transient 拖拽):
 * - 拖拽逐帧只改 Object3D(TransformControls 内部),onObjectChange 仅 invalidate——零 store 写入;
 * - 松手(onMouseUp)才把最终 pose 收敛为一条 object.move 命令——撤销/回放/AI 的唯一挂点;
 * - drei 侦测 makeDefault 的 OrbitControls,拖拽期自动禁用,免相机互抢;
 * - size 不传走默认 1:three 的 TransformControls 内部已按相机距离做恒屏占补偿,
 *   再乘距离系数是双重补偿(远景 gizmo 暴涨的回退教训)。
 */
export const TransformGizmoController = observer(function TransformGizmoController() {
    const stores = useDirectorDeskStores();
    const { scene, camera, selection, ui, dispatcher } = stores;
    const invalidate = useThree((state) => state.invalidate);
    const controlsRef = useRef<ComponentRef<typeof TransformControls> | null>(null);

    const primaryId = selection.primaryId;
    const isShotSelected = primaryId !== null && camera.director.getShot(primaryId) !== undefined;
    const editingSelectedPose = primaryId !== null && ui.posePickingObjectId === primaryId;
    const target =
        !isShotSelected && !editingSelectedPose && primaryId ? scene.manager.getRuntime(primaryId) : undefined;

    // gizmo 整体打 helper 标记:截图时摘除(07 帧内取样)
    useEffect(() => {
        if (controlsRef.current) controlsRef.current.userData.helper = true;
    }, [target]);

    // 选中集变化 → 高亮/卸载 gizmo 需要在 demand 模式下补一帧
    const selectionKey = selection.selectedIds.join(",");
    useEffect(() => {
        invalidate();
    }, [selectionKey, invalidate]);

    if (!target || !primaryId) return null;

    const commitDrag = () => {
        ui.noteGizmoInteraction();
        dispatcher.dispatch(
            {
                type: "object.move",
                payload: {
                    id: primaryId,
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
            onMouseDown={() => ui.noteGizmoInteraction()}
            onObjectChange={() => invalidate()}
            onMouseUp={commitDrag}
        />
    );
});
