import { useFrame, useThree } from "@react-three/fiber";
import { observer } from "mobx-react";
import { useCallback, useEffect, useRef } from "react";
import type { Group, Object3D } from "three";
import { BoxHelper } from "three";

import type { ComponentType } from "react";

import type { SceneObject, SceneObjectKind, Transform } from "../../core/SceneObject";
import { useDirectorDeskStores } from "../DirectorDeskContext";
import { ModelContent, PrimitiveContent } from "./contents";

const HIGHLIGHT_COLOR = "#ffd54f";

interface HelperSnapshot {
    readonly positionX: number;
    readonly positionY: number;
    readonly positionZ: number;
    readonly rotationX: number;
    readonly rotationY: number;
    readonly rotationZ: number;
    readonly scaleX: number;
    readonly scaleY: number;
    readonly scaleZ: number;
    readonly children: readonly Object3D[];
}

function snapshotHelperTarget(object: Group): HelperSnapshot {
    const { position, rotation, scale } = object;
    return {
        positionX: position.x,
        positionY: position.y,
        positionZ: position.z,
        rotationX: rotation.x,
        rotationY: rotation.y,
        rotationZ: rotation.z,
        scaleX: scale.x,
        scaleY: scale.y,
        scaleZ: scale.z,
        children: [...object.children],
    };
}

function helperTargetChanged(object: Group, snapshot: HelperSnapshot | null): boolean {
    if (!snapshot) return true;
    const { position, rotation, scale } = object;
    const transformChanged =
        position.x !== snapshot.positionX ||
        position.y !== snapshot.positionY ||
        position.z !== snapshot.positionZ ||
        rotation.x !== snapshot.rotationX ||
        rotation.y !== snapshot.rotationY ||
        rotation.z !== snapshot.rotationZ ||
        scale.x !== snapshot.scaleX ||
        scale.y !== snapshot.scaleY ||
        scale.z !== snapshot.scaleZ;
    return (
        transformChanged ||
        object.children.length !== snapshot.children.length ||
        object.children.some((child, index) => child !== snapshot.children[index])
    );
}

/** kind → 渲染内容查表(纪律:禁 if 链);camera 占位待 06 任务 */
const KIND_CONTENT: Record<SceneObjectKind, ComponentType<{ entity: SceneObject }>> = {
    primitive: PrimitiveContent,
    model: ModelContent,
    camera: () => null,
};

/**
 * 单个场景实体的渲染体。
 * - 外层 group 承载 transform + 运行时绑定(ref 回调);
 * - ref 回调完成 three 运行时 ↔ SceneManager 的绑定/解绑(运行时永不进 observable);
 * - 渲染体内禁止写场景 store;点选写 SelectionStore(纯 UI 态,不走命令层);
 * - 选中高亮走 BoxHelper(全 kind 通用):仅在目标变换或内容挂载变化时更新包围盒。
 */
export const SceneObjectView = observer(function SceneObjectView({
    entity,
    transform,
}: {
    entity: SceneObject;
    transform: Transform;
}) {
    const { scene, selection } = useDirectorDeskStores();
    const scene3 = useThree((state) => state.scene);
    const invalidate = useThree((state) => state.invalidate);
    const groupRef = useRef<Group | null>(null);
    const helperRef = useRef<BoxHelper | null>(null);
    const helperSnapshotRef = useRef<HelperSnapshot | null>(null);

    const bindRuntime = useCallback(
        (object3d: Group | null) => {
            groupRef.current = object3d;
            if (object3d) {
                scene.manager.bindRuntime(entity.id, object3d);
            } else {
                scene.manager.unbindRuntime(entity.id);
            }
        },
        [scene, entity.id],
    );

    const selected = selection.isSelected(entity.id);
    useEffect(() => {
        const object = groupRef.current;
        if (!selected || !object) return;
        const helper = new BoxHelper(object, HIGHLIGHT_COLOR);
        helper.userData.helper = true; // 截图时摘除(07 帧内取样)
        helperRef.current = helper;
        helperSnapshotRef.current = snapshotHelperTarget(object);
        scene3.add(helper);
        invalidate();
        return () => {
            helperRef.current = null;
            helperSnapshotRef.current = null;
            scene3.remove(helper);
            helper.dispose();
            invalidate();
        };
    }, [selected, scene3, invalidate, transform]);

    // demand 模式下仅在目标变换或直接子内容变化时重算包围盒；gizmo 拖拽会直接改变 group 变换。
    useFrame(() => {
        const helper = helperRef.current;
        const object = groupRef.current;
        if (!helper || !object || !helperTargetChanged(object, helperSnapshotRef.current)) return;
        helper.update();
        helperSnapshotRef.current = snapshotHelperTarget(object);
    });

    const Content = KIND_CONTENT[entity.kind];
    const { position, rotation, scale } = transform;
    return (
        <group
            ref={bindRuntime}
            position={[...position]}
            rotation={[...rotation]}
            scale={[...scale]}
            onClick={(e) => {
                e.stopPropagation();
                selection.select(entity.id, { additive: e.metaKey || e.ctrlKey });
            }}
        >
            <Content entity={entity} />
        </group>
    );
});
