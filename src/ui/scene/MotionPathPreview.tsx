import { useEffect, useMemo } from "react";
import { observer } from "mobx-react-lite";
import { BufferAttribute, BufferGeometry } from "three";

import { sampleCameraMotionPath } from "../../camera/CameraMotionPath";
import type { CameraMotionPath, CameraMotionSample } from "../../camera/CameraMotionPath";
import { useDirectorDeskStores } from "../DirectorDeskContext";

const SUBSEGMENTS_PER_SEGMENT = 16;

interface PreviewGeometry {
    readonly path: BufferGeometry;
    readonly keys: BufferGeometry;
}

function createPreviewGeometry(path: CameraMotionPath | null): PreviewGeometry | null {
    if (!path || path.keys.length === 0) return null;
    const keyPositions = new Float32Array(path.keys.length * 3);
    path.keys.forEach((key, index) => {
        const offset = index * 3;
        keyPositions[offset] = key.shot.position[0];
        keyPositions[offset + 1] = key.shot.position[1];
        keyPositions[offset + 2] = key.shot.position[2];
    });
    const keys = new BufferGeometry();
    keys.setAttribute("position", new BufferAttribute(keyPositions, 3));

    const segmentCount = Math.max(path.keys.length - 1, 0);
    const positions = new Float32Array((segmentCount * SUBSEGMENTS_PER_SEGMENT + 1) * 3);
    const sample: CameraMotionSample = {
        positionX: 0,
        positionY: 0,
        positionZ: 0,
        targetX: 0,
        targetY: 0,
        targetZ: 0,
        fov: 45,
    };
    if (segmentCount === 0) {
        positions[0] = path.keys[0]?.shot.position[0] ?? 0;
        positions[1] = path.keys[0]?.shot.position[1] ?? 0;
        positions[2] = path.keys[0]?.shot.position[2] ?? 0;
    } else {
        let vertex = 0;
        for (let segment = 0; segment < segmentCount; segment += 1) {
            const start = path.keys[segment];
            const end = path.keys[segment + 1];
            if (!start || !end) continue;
            for (let step = 0; step <= SUBSEGMENTS_PER_SEGMENT; step += 1) {
                if (segment > 0 && step === 0) continue;
                sampleCameraMotionPath(
                    path,
                    start.timeSeconds + ((end.timeSeconds - start.timeSeconds) * step) / SUBSEGMENTS_PER_SEGMENT,
                    sample,
                );
                const offset = vertex * 3;
                positions[offset] = sample.positionX;
                positions[offset + 1] = sample.positionY;
                positions[offset + 2] = sample.positionZ;
                vertex += 1;
            }
        }
    }
    const trajectory = new BufferGeometry();
    trajectory.setAttribute("position", new BufferAttribute(positions, 3));
    return { path: trajectory, keys };
}

/** Static helper geometry recomputed only when the immutable path reference changes. */
export const MotionPathPreview = observer(function MotionPathPreview({ visible }: { readonly visible: boolean }) {
    const { motion } = useDirectorDeskStores();
    const geometry = useMemo(() => createPreviewGeometry(visible ? motion.path : null), [motion.path, visible]);

    useEffect(
        () => () => {
            geometry?.path.dispose();
            geometry?.keys.dispose();
        },
        [geometry],
    );

    if (!geometry) return null;
    return (
        <group userData={{ helper: true }}>
            <line>
                <primitive object={geometry.path} attach="geometry" />
                <lineBasicMaterial color="#80deea" toneMapped={false} />
            </line>
            <points>
                <primitive object={geometry.keys} attach="geometry" />
                <pointsMaterial color="#ffca28" size={0.12} sizeAttenuation toneMapped={false} />
            </points>
        </group>
    );
});
