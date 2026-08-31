import { TransformControls } from "@react-three/drei";
import { observer } from "mobx-react-lite";
import { useRef } from "react";
import type { Mesh } from "three";

import type { CameraMotionClip } from "../../camera/CameraMotionClip";
import { appendCameraMotionPathAnchor } from "../../camera/CameraMotionPath";
import type { Vec3 } from "../../core/SceneObject";
import { PATH_EDIT_STATE } from "../../store/CameraAuthoringStore";
import { useDirectorDeskStores } from "../DirectorDeskContext";

const ANCHOR_RADIUS = 0.12;
const ANCHOR_SEGMENTS = 12;
const EDITOR_GROUND_SIZE = 100;
const SELECTED_ANCHOR_COLOR = "#ffd54f";
const ANCHOR_COLOR = "#00bcd4";

function replaceAnchorPosition(clip: CameraMotionClip, anchorId: string, position: Vec3) {
    return {
        anchors: clip.path.anchors.map((anchor) => {
            const json = anchor.toJSON();
            return anchor.id === anchorId ? { ...json, position } : json;
        }),
    };
}

/** Direct viewport path authoring. Drag stays in Three runtime state; pointer release commits one immutable path command. */
export const MotionPathEditor = observer(function MotionPathEditor() {
    const stores = useDirectorDeskStores();
    const { authoring, dispatcher, motion } = stores;
    const clip = authoring.selectedMotionClipId ? motion.clip(authoring.selectedMotionClipId) : undefined;
    const anchorId = authoring.selectedPathAnchorId;
    const selectedAnchor = clip && anchorId ? clip.path.anchor(anchorId) : undefined;
    const anchorRef = useRef<Mesh | null>(null);
    const draftPosition = useRef<Vec3 | null>(null);

    if (!clip || authoring.pathEditState !== PATH_EDIT_STATE.EDITING_PATH) return null;
    const commitAnchorPosition = (): void => {
        const position = draftPosition.current;
        if (!position || !anchorId) return;
        dispatcher.dispatch(
            { type: "motion.set-clip-path", payload: { id: clip.id, path: replaceAnchorPosition(clip, anchorId, position) } },
            stores,
        );
        draftPosition.current = null;
    };

    return (
        <group userData={{ helper: true }}>
            <mesh
                rotation={[-Math.PI / 2, 0, 0]}
                onDoubleClick={(event) => {
                    event.stopPropagation();
                    const point: Vec3 = [event.point.x, event.point.y, event.point.z];
                    dispatcher.dispatch(
                        {
                            type: "motion.set-clip-path",
                            payload: {
                                id: clip.id,
                                path: appendCameraMotionPathAnchor(clip.path.toJSON(), point, crypto.randomUUID()),
                            },
                        },
                        stores,
                    );
                }}
            >
                <planeGeometry args={[EDITOR_GROUND_SIZE, EDITOR_GROUND_SIZE]} />
                <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>
            {clip.path.anchors.map((anchor) => {
                if (anchor.id === selectedAnchor?.id) {
                    return (
                        <TransformControls
                            key={anchor.id}
                            mode="translate"
                            onObjectChange={() => {
                                const object = anchorRef.current;
                                if (!object) return;
                                draftPosition.current = [object.position.x, object.position.y, object.position.z];
                            }}
                            onMouseUp={commitAnchorPosition}
                        >
                            <mesh ref={anchorRef} position={anchor.position}>
                                <sphereGeometry args={[ANCHOR_RADIUS, ANCHOR_SEGMENTS, ANCHOR_SEGMENTS]} />
                                <meshBasicMaterial color={SELECTED_ANCHOR_COLOR} toneMapped={false} />
                            </mesh>
                        </TransformControls>
                    );
                }
                return (
                    <mesh
                        key={anchor.id}
                        position={anchor.position}
                        onClick={(event) => {
                            event.stopPropagation();
                            authoring.selectPathAnchor(anchor.id);
                        }}
                    >
                        <sphereGeometry args={[ANCHOR_RADIUS, ANCHOR_SEGMENTS, ANCHOR_SEGMENTS]} />
                        <meshBasicMaterial color={ANCHOR_COLOR} toneMapped={false} />
                    </mesh>
                );
            })}
        </group>
    );
});
