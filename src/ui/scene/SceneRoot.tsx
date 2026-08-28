import { useThree } from "@react-three/fiber";
import { observer } from "mobx-react";
import { useEffect } from "react";

import { useDirectorDeskStores } from "../DirectorDeskContext";
import { SceneObjectView } from "./SceneObjectView";

/**
 * 场景渲染根:实体列表 → SceneObjectView。
 * 细粒度订阅:只挂 revision 这个 number(MobX),不重渲整个 Canvas 树;
 * 实体变更后显式 invalidate()——frameloop="demand" 下唯一的渲染触发。
 */
export const SceneRoot = observer(function SceneRoot() {
    const { scene } = useDirectorDeskStores();
    const invalidate = useThree((state) => state.invalidate);

    const revision = scene.revision;
    useEffect(() => {
        invalidate();
    }, [revision, invalidate]);

    return (
        <>
            {scene.manager.list().map((entity) => (
                <SceneObjectView key={entity.id} entity={entity} />
            ))}
        </>
    );
});
