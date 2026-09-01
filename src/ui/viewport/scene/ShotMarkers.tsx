import { useThree } from "@react-three/fiber";
import { observer } from "mobx-react-lite";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { Group } from "three";
import { BufferGeometry, Float32BufferAttribute, Quaternion, Vector3 } from "three";

import type { CameraShot } from "@/camera/CameraShot";
import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";

const BODY_WIDTH = 0.3;
const BODY_HEIGHT = 0.2;
const BODY_DEPTH = 0.2;
const BODY_HALF_DEPTH = BODY_DEPTH / 2;
const LENS_RADIUS = 0.1;
const LENS_LENGTH = 0.18;
const LENS_CENTER_Z = -BODY_HALF_DEPTH - LENS_LENGTH / 2;
const LENS_SEGMENTS = 16;
const HALF_TURN = Math.PI / 2;
const CAMERA_BODY_COLOR = "#546e7a";
const SELECTED_CAMERA_BODY_COLOR = "#ffb300";
const LENS_COLOR = "#263238";
const FRUSTUM_COLOR = "#42a5f5";
/** 机身恒屏占系数:机身尺寸 = 相机距离 × 此系数(onBeforeRender 逐帧应用,渲染期零分配) */
const BODY_SCREEN_FRACTION = 0.15;
/** 近处像平面框:机身本地单位(随机身恒屏占缩放),只表达朝向与张角——Blender 式 */
const NEAR_FRAME_LENGTH = 0.9;
const FRUSTUM_ASPECT_RATIO = 16 / 9;
const DEGREES_PER_TURN = 360;
const POSITION_ATTRIBUTE = "position";
const CAMERA_FORWARD = new Vector3(0, 0, -1);
const TMP_BODY_POS = new Vector3();

function shotRotation(shot: CameraShot): Quaternion {
    const position = new Vector3(...shot.position);
    const direction = new Vector3(...shot.target).sub(position);
    if (direction.lengthSq() === 0) return new Quaternion();
    return new Quaternion().setFromUnitVectors(CAMERA_FORWARD, direction.normalize());
}

/** 矩形框顶点(局部空间,-Z 前向):4 条原点射线 + 像平面矩形 */
function frameVertices(halfWidth: number, halfHeight: number, z: number): readonly number[] {
    const topLeft = [-halfWidth, halfHeight, z] as const;
    const topRight = [halfWidth, halfHeight, z] as const;
    const bottomRight = [halfWidth, -halfHeight, z] as const;
    const bottomLeft = [-halfWidth, -halfHeight, z] as const;
    return [
        0,
        0,
        0,
        ...topLeft,
        0,
        0,
        0,
        ...topRight,
        0,
        0,
        0,
        ...bottomRight,
        0,
        0,
        0,
        ...bottomLeft,
        ...topLeft,
        ...topRight,
        ...topRight,
        ...bottomRight,
        ...bottomRight,
        ...bottomLeft,
        ...bottomLeft,
        ...topLeft,
    ];
}

function frameDims(shot: CameraShot, length: number): { halfWidth: number; halfHeight: number } {
    const halfHeight = length * Math.tan((shot.fov * Math.PI) / (DEGREES_PER_TURN * 2));
    return { halfHeight, halfWidth: halfHeight * FRUSTUM_ASPECT_RATIO };
}

/** 近处像平面框(随机身缩放) */
function createNearFrameGeometry(shot: CameraShot): BufferGeometry {
    const { halfWidth, halfHeight } = frameDims(shot, NEAR_FRAME_LENGTH);
    const geometry = new BufferGeometry();
    geometry.setAttribute(
        POSITION_ATTRIBUTE,
        new Float32BufferAttribute(frameVertices(halfWidth, halfHeight, -NEAR_FRAME_LENGTH), 3),
    );
    return geometry;
}

export const ShotMarker = observer(function ShotMarker({ id, shot }: { id: string; shot: CameraShot }) {
    const stores = useDirectorDeskStores();
    const { camera: cameraStore, selection, dispatcher } = stores;
    const invalidate = useThree((state) => state.invalidate);
    const selected = selection.isSelected(id);
    const mainCamera = useThree((state) => state.camera);
    const bodyRef = useRef<Group | null>(null);
    const rotation = useMemo(() => shotRotation(shot), [shot]);
    const nearFrameGeometry = useMemo(() => createNearFrameGeometry(shot), [shot]);

    /** 机身恒屏占:渲染前按相机距离缩放(demand 下只在渲染帧执行,零分配) */
    const keepBodyScreenSize = useCallback(() => {
        const body = bodyRef.current;
        if (!body) return;
        body.scale.setScalar(
            mainCamera.position.distanceTo(body.getWorldPosition(TMP_BODY_POS)) * BODY_SCREEN_FRACTION,
        );
    }, [mainCamera]);

    useEffect(() => {
        invalidate();
        return () => nearFrameGeometry.dispose();
    }, [nearFrameGeometry, invalidate]);

    const bindMarker = useCallback(
        (object3d: Group | null) => {
            if (!object3d) {
                cameraStore.unregisterShotMarker(id);
                invalidate();
                return;
            }
            object3d.userData.helper = true;
            cameraStore.registerShotMarker(id, object3d);
            invalidate();
        },
        [cameraStore, id, invalidate],
    );

    return (
        <group
            ref={bindMarker}
            position={[...shot.position]}
            quaternion={rotation}
            onClick={(event) => {
                event.stopPropagation();
                selection.select(id, { additive: event.metaKey || event.ctrlKey });
            }}
            onDoubleClick={() => {
                dispatcher.dispatch({ type: "camera.activate", payload: { id } }, stores);
            }}
        >
            <group ref={bodyRef}>
                <mesh onBeforeRender={keepBodyScreenSize}>
                    <boxGeometry args={[BODY_WIDTH, BODY_HEIGHT, BODY_DEPTH]} />
                    <meshStandardMaterial color={selected ? SELECTED_CAMERA_BODY_COLOR : CAMERA_BODY_COLOR} />
                </mesh>
                <mesh position={[0, 0, LENS_CENTER_Z]} rotation={[-HALF_TURN, 0, 0]}>
                    <coneGeometry args={[LENS_RADIUS, LENS_LENGTH, LENS_SEGMENTS]} />
                    <meshStandardMaterial color={LENS_COLOR} />
                </mesh>
                {/* 近处像平面框:随机身缩放,表达朝向与张角 */}
                <lineSegments geometry={nearFrameGeometry}>
                    <lineBasicMaterial color={FRUSTUM_COLOR} />
                </lineSegments>
            </group>
        </group>
    );
});

/** 场景内机位实体:可点选、双击切入，并以相机模型和视锥呈现机位构图。 */
export const ShotMarkers = observer(function ShotMarkers() {
    const stores = useDirectorDeskStores();
    const { camera: cameraStore } = stores;
    const activeShotId = cameraStore.activeShotId;
    const shots = cameraStore.director.listShots();

    // 机位标记属编辑期辅助物:全屏预览时画面只留成片内容
    if (!stores.layout.authoringVisible) return null;
    if (activeShotId !== null) return null;
    return (
        <>
            {shots.map(([id, shot]) => (
                <ShotMarker key={id} id={id} shot={shot} />
            ))}
        </>
    );
});
