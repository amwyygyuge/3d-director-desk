import { TransformControls } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { Vector3 } from "three";
import { observer } from "mobx-react";
import { useEffect, useRef } from "react";
import type { ComponentRef } from "react";

import { useDirectorDeskStores } from "../ui/DirectorDeskContext";

const GIZMO_SIZE_SCREEN_FRACTION = 0.18;
const gizmoTargetWorldPosition = new Vector3();

/**
 * gizmo 控制器:封装 drei TransformControls,挂主选对象的运行时。
 *
 * 性能铁律落实(transient 拖拽):
 * - 拖拽逐帧只改 Object3D(TransformControls 内部),onObjectChange 仅 invalidate——零 store 写入;
 * - 松手(onMouseUp)才把最终 pose 收敛为一条 object.move 命令——撤销/回放/AI 的唯一挂点;
 * - drei 侦测 makeDefault 的 OrbitControls,拖拽期自动禁用,免相机互抢。
 */
export const TransformGizmoController = observer(function TransformGizmoController() {
    const stores = useDirectorDeskStores();
    const { scene, selection, ui, dispatcher } = stores;
    const invalidate = useThree((state) => state.invalidate);
    const camera = useThree((state) => state.camera);
    const controlsRef = useRef<ComponentRef<typeof TransformControls> | null>(null);

    const primaryId = selection.primaryId;
    const target = primaryId ? scene.manager.getRuntime(primaryId) : undefined;
    // TransformControls 的 size 是世界单位；按距离同比例缩放才会保持稳定的屏幕占比。
    const gizmoSize = target
        ? camera.position.distanceTo(target.getWorldPosition(gizmoTargetWorldPosition)) * GIZMO_SIZE_SCREEN_FRACTION
        : undefined;

    // gizmo 整体打 helper 标记:截图时摘除(07 帧内取样)
    useEffect(() => {
        if (controlsRef.current) controlsRef.current.userData.helper = true;
    }, [target]);

    // 选中集变化 → 高亮/卸载 gizmo 需要在 demand 模式下补一帧
    const selectionKey = selection.selectedIds.join(",");
    useEffect(() => {
        invalidate();
    }, [selectionKey, invalidate]);

    if (!target || !primaryId || gizmoSize === undefined) return null;

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
            size={gizmoSize}
            onMouseDown={() => ui.noteGizmoInteraction()}
            onObjectChange={() => invalidate()}
            onMouseUp={commitDrag}
        />
    );
});
