import { useEffect, useMemo } from "react";
import { BufferAttribute, BufferGeometry } from "three";

import type { CameraMotionClip } from "../../../camera/CameraMotionClip";
import { sampleCameraMotionPath } from "../../../camera/CameraMotionPath";
import type { PathPositionSample } from "../../../camera/CameraMotionPath";

const PATH_SAMPLES_PER_SEGMENT = 24;

interface PreviewGeometry {
    readonly path: BufferGeometry;
    readonly anchors: BufferGeometry;
}

function createPreviewGeometry(clip: CameraMotionClip): PreviewGeometry {
    const anchors = clip.path.anchors;
    const anchorPositions = new Float32Array(anchors.length * 3);
    anchors.forEach((anchor, index) => {
        const offset = index * 3;
        anchorPositions[offset] = anchor.position[0];
        anchorPositions[offset + 1] = anchor.position[1];
        anchorPositions[offset + 2] = anchor.position[2];
    });
    const anchorGeometry = new BufferGeometry();
    anchorGeometry.setAttribute("position", new BufferAttribute(anchorPositions, 3));

    const segmentCount = anchors.length - 1;
    const positions = new Float32Array((segmentCount * PATH_SAMPLES_PER_SEGMENT + 1) * 3);
    const sample: PathPositionSample = { x: 0, y: 0, z: 0 };
    const sampleCount = segmentCount * PATH_SAMPLES_PER_SEGMENT;
    for (const step of Array.from({ length: sampleCount + 1 }, (_, index) => index)) {
        sampleCameraMotionPath(clip.path, step / sampleCount, sample);
        const offset = step * 3;
        positions[offset] = sample.x;
        positions[offset + 1] = sample.y;
        positions[offset + 2] = sample.z;
    }
    const pathGeometry = new BufferGeometry();
    pathGeometry.setAttribute("position", new BufferAttribute(positions, 3));
    return { path: pathGeometry, anchors: anchorGeometry };
}

/** Owns one immutable clip helper; geometry changes only with authored path data and disposes on replacement. */
export function MotionClipPathPreview({ clip, color }: { readonly clip: CameraMotionClip; readonly color: string }) {
    const geometry = useMemo(() => createPreviewGeometry(clip), [clip]);

    useEffect(
        () => () => {
            geometry.path.dispose();
            geometry.anchors.dispose();
        },
        [geometry],
    );

    return (
        <group userData={{ helper: true, motionClipId: clip.id }}>
            <line>
                <primitive object={geometry.path} attach="geometry" />
                <lineBasicMaterial color={color} toneMapped={false} />
            </line>
            <points>
                <primitive object={geometry.anchors} attach="geometry" />
                <pointsMaterial color={color} size={0.12} sizeAttenuation toneMapped={false} />
            </points>
        </group>
    );
}
