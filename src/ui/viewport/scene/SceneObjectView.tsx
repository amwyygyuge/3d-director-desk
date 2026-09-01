import { useFrame, useThree } from "@react-three/fiber";
import { observer } from "mobx-react-lite";
import { useCallback, useEffect, useRef } from "react";
import type { ComponentType } from "react";
import type { Group, Object3D } from "three";
import { Box3, Box3Helper, BufferGeometry, Matrix4 } from "three";

import type { SceneObject, SceneObjectKind } from "../../../core/SceneObject";
import { useDirectorDeskStores } from "../../shell/DirectorDeskContext";
import { LightContent, ModelContent } from "./contents";

const HIGHLIGHT_COLOR = "#ffd54f";

class LocalBoundsIndex {
    private readonly inverseRoot = new Matrix4();
    private readonly relativeChild = new Matrix4();
    private readonly transformedBounds = new Box3();
    private readonly localBounds = new Box3();
    private readonly worldRoot = new Matrix4();

    updateLocal(root: Group): void {
        root.updateWorldMatrix(true, true);
        this.inverseRoot.copy(root.matrixWorld).invert();
        this.localBounds.makeEmpty();
        root.traverse((candidate) => {
            const geometry = (candidate as Object3D & { geometry?: unknown }).geometry;
            if (!(geometry instanceof BufferGeometry) || candidate.userData.helper) return;
            geometry.computeBoundingBox();
            if (!geometry.boundingBox) return;
            this.relativeChild.multiplyMatrices(this.inverseRoot, candidate.matrixWorld);
            this.transformedBounds.copy(geometry.boundingBox).applyMatrix4(this.relativeChild);
            this.localBounds.union(this.transformedBounds);
        });
    }

    updateWorld(root: Group, worldBounds: Box3): void {
        root.updateMatrix();
        if (root.parent) this.worldRoot.multiplyMatrices(root.parent.matrixWorld, root.matrix);
        else this.worldRoot.copy(root.matrix);
        worldBounds.copy(this.localBounds).applyMatrix4(this.worldRoot);
    }
}

interface HelperSnapshot {
    positionX: number;
    positionY: number;
    positionZ: number;
    rotationX: number;
    rotationY: number;
    rotationZ: number;
    scaleX: number;
    scaleY: number;
    scaleZ: number;
    childCount: number;
    childAtZero: Object3D | undefined;
    readonly boundsIndex: LocalBoundsIndex;
}

function updateHelperSnapshot(object: Group, snapshot: HelperSnapshot): void {
    const { position, rotation, scale } = object;
    snapshot.positionX = position.x;
    snapshot.positionY = position.y;
    snapshot.positionZ = position.z;
    snapshot.rotationX = rotation.x;
    snapshot.rotationY = rotation.y;
    snapshot.rotationZ = rotation.z;
    snapshot.scaleX = scale.x;
    snapshot.scaleY = scale.y;
    snapshot.scaleZ = scale.z;
    snapshot.childCount = object.children.length;
    snapshot.childAtZero = object.children[0];
}

function helperTransformChanged(object: Group, snapshot: HelperSnapshot): boolean {
    const { position, rotation, scale } = object;
    return (
        position.x !== snapshot.positionX ||
        position.y !== snapshot.positionY ||
        position.z !== snapshot.positionZ ||
        rotation.x !== snapshot.rotationX ||
        rotation.y !== snapshot.rotationY ||
        rotation.z !== snapshot.rotationZ ||
        scale.x !== snapshot.scaleX ||
        scale.y !== snapshot.scaleY ||
        scale.z !== snapshot.scaleZ
    );
}

function helperContentChanged(object: Group, snapshot: HelperSnapshot): boolean {
    return object.children.length !== snapshot.childCount || object.children[0] !== snapshot.childAtZero;
}

function updateWorldBounds(index: LocalBoundsIndex, object: Group, helper: Box3Helper): void {
    index.updateWorld(object, helper.box);
}

/** kind → 渲染内容查表(纪律:禁 if 链)。 */
const KIND_CONTENT: Record<SceneObjectKind, ComponentType<{ entity: SceneObject }>> = {
    model: ModelContent,
    camera: () => null,
    light: LightContent,
};

/**
 * 单个场景实体的渲染体。
 * - 外层 group 承载 transform + 运行时绑定(ref 回调);
 * - ref 回调完成 three 运行时 ↔ SceneManager 的绑定/解绑(运行时永不进 observable);
 * - 渲染体内禁止写场景 store;点选写 SelectionStore(纯 UI 态,不走命令层);
 * - 选中高亮走 Box3Helper(缓存局部 bounds):播放仅变换包围盒,内容挂载变化才重建局部 bounds。
 */
export const SceneObjectView = observer(function SceneObjectView({ entity }: { entity: SceneObject }) {
    const { scene, selection, playback } = useDirectorDeskStores();
    const scene3 = useThree((state) => state.scene);
    const invalidate = useThree((state) => state.invalidate);
    const groupRef = useRef<Group | null>(null);
    const helperRef = useRef<Box3Helper | null>(null);
    const helperSnapshotRef = useRef<HelperSnapshot | null>(null);

    const bindRuntime = useCallback(
        (object3d: Group | null) => {
            groupRef.current = object3d;
            if (object3d) {
                scene.manager.bindRuntime(entity.id, object3d);
                playback.sampleObject(entity.id);
            } else {
                playback.restoreObject(entity.id);
                scene.manager.unbindRuntime(entity.id);
            }
        },
        [scene, entity.id, playback],
    );

    const selected = selection.isSelected(entity.id);
    // 渲染期直读实体 transform(observer 细粒度订阅);applyTransform 整体替换,引用变化即触发
    const transform = entity.transform;
    // transform 引用替换 → 补帧(demand 模式立即成像)
    useEffect(() => invalidate(), [invalidate, transform]);
    useEffect(() => {
        const object = groupRef.current;
        if (!selected || !object || entity.kind === "light") return;
        const boundsIndex = new LocalBoundsIndex();
        boundsIndex.updateLocal(object);
        const bounds = new Box3();
        boundsIndex.updateWorld(object, bounds);
        const helper = new Box3Helper(bounds, HIGHLIGHT_COLOR);
        helper.userData.helper = true; // 截图时摘除(07 帧内取样)
        helperRef.current = helper;
        const snapshot: HelperSnapshot = {
            positionX: 0,
            positionY: 0,
            positionZ: 0,
            rotationX: 0,
            rotationY: 0,
            rotationZ: 0,
            scaleX: 0,
            scaleY: 0,
            scaleZ: 0,
            childCount: 0,
            childAtZero: undefined,
            boundsIndex,
        };
        updateHelperSnapshot(object, snapshot);
        helperSnapshotRef.current = snapshot;
        scene3.add(helper);
        invalidate();
        return () => {
            helperRef.current = null;
            helperSnapshotRef.current = null;
            scene3.remove(helper);
            helper.geometry.dispose();
            invalidate();
        };
    }, [selected, scene3, invalidate, transform, entity.kind]);

    // 播放仅把缓存的局部 bounds 变换到世界坐标；子内容变化才重建索引并 traverse 一次。
    useFrame(() => {
        const helper = helperRef.current;
        const object = groupRef.current;
        const snapshot = helperSnapshotRef.current;
        if (!helper || !object || !snapshot) return;
        const contentChanged = helperContentChanged(object, snapshot);
        const transformChanged = helperTransformChanged(object, snapshot);
        if (!contentChanged && !transformChanged) return;
        if (contentChanged) snapshot.boundsIndex.updateLocal(object);
        updateWorldBounds(snapshot.boundsIndex, object, helper);
        updateHelperSnapshot(object, snapshot);
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
