import { TransformControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { observer } from "mobx-react-lite";
import { useEffect, useMemo, useRef } from "react";
import type { ComponentRef } from "react";
import type { InstancedMesh } from "three";
import { Matrix4, MeshBasicMaterial, SphereGeometry } from "three";

import type { BoneKey } from "@/pose/PoseSnapshot";
import type { BoneTreeNodeDto } from "@/pose/SkeletonRuntimeRegistry";
import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { useOrbitSuspension } from "@/ui/viewport/scene/useOrbitSuspension";
import { isEditingText } from "@/shortcuts/ShortcutRegistry";

const HIT_RADIUS = 0.055;
const HIT_COLOR = "#ffca28";
const TMP_MATRIX = new Matrix4();

/**
 * Runtime-only bone interaction surface. Skeleton and instanced hit markers are helper-tagged and
 * locally disposed; drag mutates only Bone rotation until mouse-up emits exactly one command.
 */
export const BonePicker = observer(function BonePicker() {
    const stores = useDirectorDeskStores();
    const { clock, dispatcher, playback, skeletons, ui } = stores;
    const invalidate = useThree((state) => state.invalidate);
    // 骨骼旋转 gizmo 与主 gizmo 同纪律:拖拽期必须经所有权裁决让位轨道。
    // 此前这里漏接,靠 drei 内部直写 defaultControls.enabled 兜底——那条越权写
    // 已被 ViewportOrbitController 的访问器守卫物理无效化(它在掌镜/镜头视角下
    // 是「拖着拖着晃动越来越大」的泄漏源),所以让位必须显式走这条链。
    const orbitSuspension = useOrbitSuspension();
    const controlsRef = useRef<ComponentRef<typeof TransformControls> | null>(null);
    const meshRef = useRef<InstancedMesh | null>(null);
    const objectId = ui.posePickingObjectId;
    const selectedBoneKey = ui.posePickingBoneKey;
    const discovery = objectId ? skeletons.discover(objectId) : null;
    const boneKeys = useMemo(() => {
        if (!discovery) return [];
        const keys: BoneKey[] = [];
        const collect = (node: BoneTreeNodeDto): void => {
            keys.push(node.key);
            for (const child of node.children) collect(child);
        };
        for (const root of discovery.roots) collect(root);
        return keys;
    }, [discovery]);
    const helpers = useMemo(() => {
        if (!objectId || !discovery?.ready) return [];
        return skeletons.createHelpers(objectId);
    }, [skeletons, objectId, discovery]);
    const hitGeometry = useMemo(() => new SphereGeometry(HIT_RADIUS, 10, 8), []);
    const hitMaterial = useMemo(() => new MeshBasicMaterial({ color: HIT_COLOR, depthTest: false }), []);
    const selectedBone = objectId && selectedBoneKey ? skeletons.getBone(objectId, selectedBoneKey) : undefined;

    useEffect(() => {
        if (controlsRef.current) {
            controlsRef.current.userData.helper = true;
            controlsRef.current.userData.poseHelper = true;
        }
    }, [selectedBone]);

    useEffect(() => {
        for (let index = 0; index < helpers.length; index += 1) {
            const helper = helpers[index];
            if (helper) helper.userData.helper = true;
        }
        return () => {
            for (let index = 0; index < helpers.length; index += 1) {
                const helper = helpers[index];
                if (!helper) continue;
                helper.removeFromParent();
                helper.geometry.dispose();
                const material = helper.material;
                if (Array.isArray(material)) material.forEach((item) => item.dispose());
                else material.dispose();
            }
        };
    }, [helpers]);

    useEffect(() => {
        if (!meshRef.current) return;
        meshRef.current.userData.helper = true;
        meshRef.current.userData.poseHelper = true;
        return () => {
            hitGeometry.dispose();
            hitMaterial.dispose();
        };
    }, [hitGeometry, hitMaterial]);

    // Esc 撤销骨骼拖拽的瞬时姿态:只在骨骼拾取激活时挂监听,
    // 否则它是常驻的全局副作用——文本框/预览/帮助里的 Esc 都会触发全场景重采样
    useEffect(() => {
        if (!objectId) return undefined;
        const restore = (event: KeyboardEvent) => {
            if (event.key !== "Escape" || isEditingText()) return;
            playback.sampleCurrent();
            invalidate();
        };
        window.addEventListener("keydown", restore);
        return () => window.removeEventListener("keydown", restore);
    }, [playback, invalidate, objectId]);

    useFrame(() => {
        const mesh = meshRef.current;
        if (!mesh || !objectId) return;
        for (let index = 0; index < boneKeys.length; index += 1) {
            const bone = skeletons.getBone(objectId, boneKeys[index]!);
            if (!bone) continue;
            TMP_MATRIX.copy(bone.matrixWorld);
            mesh.setMatrixAt(index, TMP_MATRIX);
        }
        mesh.instanceMatrix.needsUpdate = true;
    });

    if (!objectId || !discovery?.ready) return null;
    const editing = !clock.isPlaying;
    const commitRotation = () => {
        // 让位归还必须先于任何提前 return:suspend 在 onMouseDown 已发出,
        // 这里一旦跳过 release,计数永久停在 1,轨道再也不会被启用(视口卡死)。
        orbitSuspension.release();
        if (!editing || !selectedBone || !selectedBoneKey) return;
        ui.noteGizmoInteraction();
        dispatcher.dispatch(
            {
                type: "pose.set-bone",
                payload: {
                    objectId,
                    boneKey: selectedBoneKey,
                    quaternion: [
                        selectedBone.quaternion.x,
                        selectedBone.quaternion.y,
                        selectedBone.quaternion.z,
                        selectedBone.quaternion.w,
                    ],
                },
            },
            stores,
        );
        invalidate();
    };

    return (
        <>
            {helpers.map((helper) => (
                <primitive key={helper.uuid} object={helper} />
            ))}
            {editing && boneKeys.length > 0 && (
                <instancedMesh
                    ref={meshRef}
                    args={[hitGeometry, hitMaterial, boneKeys.length]}
                    userData={{ helper: true, poseHelper: true }}
                    onClick={(event) => {
                        const key = event.instanceId === undefined ? undefined : boneKeys[event.instanceId];
                        if (key) ui.setPosePicking(objectId, key);
                    }}
                />
            )}
            {editing && selectedBone && (
                <TransformControls
                    object={selectedBone}
                    ref={controlsRef}
                    mode="rotate"
                    showX
                    showY
                    showZ
                    onMouseDown={() => {
                        ui.noteGizmoInteraction();
                        orbitSuspension.suspend();
                    }}
                    onObjectChange={() => invalidate()}
                    onMouseUp={commitRotation}
                />
            )}
        </>
    );
});
