import { useFrame, useThree } from "@react-three/fiber";
import { observer } from "mobx-react";
import { useCallback, useEffect, useRef } from "react";
import type { Group } from "three";
import { BoxHelper } from "three";

import type { ComponentType } from "react";

import type { SceneObject, SceneObjectKind, Transform } from "../../core/SceneObject";
import { useDirectorDeskStores } from "../DirectorDeskContext";
import { ModelContent, PrimitiveContent } from "./contents";

const HIGHLIGHT_COLOR = "#ffd54f";

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
 * - 选中高亮走 BoxHelper(全 kind 通用):transform 提交后重建,拖拽 transient 期逐帧 update。
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
        scene3.add(helper);
        invalidate();
        return () => {
            helperRef.current = null;
            scene3.remove(helper);
            helper.dispose();
            invalidate();
        };
        // transform 提交后重建包围盒;拖拽 transient 期由下方 useFrame 逐帧 update
    }, [selected, scene3, invalidate, transform]);

    // demand 模式下 useFrame 只在 invalidated 帧执行,gizmo 拖拽逐帧 invalidate → 高亮框跟随
    useFrame(() => {
        helperRef.current?.update();
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
