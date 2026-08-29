import { useThree } from "@react-three/fiber";
import { observer } from "mobx-react";
import { useEffect, useMemo, useState } from "react";

import type { SceneObject, Transform } from "../../core/SceneObject";
import { useDirectorDeskStores } from "../DirectorDeskContext";
import { SceneObjectView } from "./SceneObjectView";

interface SceneObjectEntry {
    readonly entity: SceneObject;
    readonly transform: Transform;
}

const AXIS_X = 0;
const AXIS_Y = 1;
const AXIS_Z = 2;

function vectorsEqual(left: Transform["position"], right: Transform["position"]): boolean {
    return left[AXIS_X] === right[AXIS_X] && left[AXIS_Y] === right[AXIS_Y] && left[AXIS_Z] === right[AXIS_Z];
}

function transformsEqual(left: Transform, right: Transform): boolean {
    return (
        vectorsEqual(left.position, right.position) &&
        vectorsEqual(left.rotation, right.rotation) &&
        vectorsEqual(left.scale, right.scale)
    );
}


function snapshotEntries(entities: readonly SceneObject[]): readonly SceneObjectEntry[] {
    return entities.map((entity) => ({ entity, transform: entity.transform }));
}

function reconcileEntries(
    currentEntries: readonly SceneObjectEntry[],
    entities: readonly SceneObject[],
): readonly SceneObjectEntry[] {
    if (currentEntries.length !== entities.length) return snapshotEntries(entities);
    const nextEntries = entities.map((entity, index) => {
        const currentEntry = currentEntries[index];
        const transform = entity.transform;
        return currentEntry?.entity === entity && transformsEqual(currentEntry.transform, transform)
            ? currentEntry
            : { entity, transform };
    });
    return nextEntries.every((entry, index) => entry === currentEntries[index]) ? currentEntries : nextEntries;
}


/**
 * 场景渲染根:实体列表 → SceneObjectView。
 * 版本变更只同步变换或结构已变化的条目，避免动作等无关实体更新重建整个子树。
 */
export const SceneRoot = observer(function SceneRoot() {
    const { scene } = useDirectorDeskStores();
    const invalidate = useThree((state) => state.invalidate);
    const revision = scene.revision;
    const [entries, setEntries] = useState<readonly SceneObjectEntry[]>(() => snapshotEntries(scene.manager.list()));

    useEffect(() => {
        invalidate();
        setEntries((currentEntries) => reconcileEntries(currentEntries, scene.manager.list()));
    }, [invalidate, revision, scene]);

    const sceneObjectList = useMemo(
        () => (
            <>
                {entries.map(({ entity, transform }) => (
                    <SceneObjectView key={entity.id} entity={entity} transform={transform} />
                ))}
            </>
        ),
        [entries],
    );

    return sceneObjectList;
});
