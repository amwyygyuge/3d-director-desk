import { useThree } from "@react-three/fiber";
import { observer } from "mobx-react-lite";
import { useEffect } from "react";

import { useDirectorDeskStores } from "../../shell/DirectorDeskContext";
import { SceneObjectView } from "./SceneObjectView";

/**
 * 场景渲染根:实体列表 → SceneObjectView(纯映射组件)。
 * list() 只追踪实体表 key 集:增删触发本组件重渲;单实体 transform 变更由 SceneObjectView 自订阅,不经此处。
 */
export const SceneRoot = observer(function SceneRoot() {
    const { scene } = useDirectorDeskStores();
    const invalidate = useThree((state) => state.invalidate);

    // 本组件仅在实体增删时重渲——此时必须补帧,demand 模式下新结构才立即成像
    useEffect(() => invalidate());

    return (
        <>
            {scene.manager.list().map((entity) => (
                <SceneObjectView key={entity.id} entity={entity} />
            ))}
        </>
    );
});
