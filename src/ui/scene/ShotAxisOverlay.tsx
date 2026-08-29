import { useThree } from "@react-three/fiber";
import { observer } from "mobx-react-lite";
import { useEffect, useMemo } from "react";
import { BufferAttribute, BufferGeometry } from "three";

import type { ContinuityAxis } from "../../camera/ContinuityChecker";
import { useDirectorDeskStores } from "../DirectorDeskContext";

const AXIS_COLOR = "#ef5350";
const AXIS_REFERENCE_COLOR = "#ffca28";
const AXIS_REFERENCE_HALF_LENGTH = 0.75;

interface AxisGeometry {
    readonly axes: BufferGeometry;
    readonly references: BufferGeometry;
}

function geometryFor(axes: readonly ContinuityAxis[]): AxisGeometry | null {
    if (axes.length === 0) return null;
    const axisPositions = new Float32Array(axes.length * 6);
    const referencePositions = new Float32Array(axes.length * 6);
    axes.forEach((axis, index) => {
        const axisOffset = index * 6;
        const start = axis.start;
        const end = axis.end;
        const directionX = end[0] - start[0];
        const directionZ = end[2] - start[2];
        const length = Math.hypot(directionX, directionZ);
        const normalX = length === 0 ? 0 : -directionZ / length * AXIS_REFERENCE_HALF_LENGTH;
        const normalZ = length === 0 ? 0 : directionX / length * AXIS_REFERENCE_HALF_LENGTH;
        axisPositions[axisOffset] = start[0];
        axisPositions[axisOffset + 1] = start[1];
        axisPositions[axisOffset + 2] = start[2];
        axisPositions[axisOffset + 3] = end[0];
        axisPositions[axisOffset + 4] = end[1];
        axisPositions[axisOffset + 5] = end[2];
        referencePositions[axisOffset] = start[0] - normalX;
        referencePositions[axisOffset + 1] = start[1];
        referencePositions[axisOffset + 2] = start[2] - normalZ;
        referencePositions[axisOffset + 3] = start[0] + normalX;
        referencePositions[axisOffset + 4] = start[1];
        referencePositions[axisOffset + 5] = start[2] + normalZ;
    });
    const axisGeometry = new BufferGeometry();
    axisGeometry.setAttribute("position", new BufferAttribute(axisPositions, 3));
    const referenceGeometry = new BufferGeometry();
    referenceGeometry.setAttribute("position", new BufferAttribute(referencePositions, 3));
    return { axes: axisGeometry, references: referenceGeometry };
}

/** Transient 180°-axis helper. Its geometry is disposed on replacement/unmount and excluded from capture. */
export const ShotAxisOverlay = observer(function ShotAxisOverlay() {
    const { continuity } = useDirectorDeskStores();
    const invalidate = useThree((state) => state.invalidate);
    const geometry = useMemo(
        () => geometryFor(continuity.issues.flatMap((current) => current.axis ? [current.axis] : [])),
        [continuity.issues],
    );

    useEffect(() => {
        invalidate();
        return () => {
            geometry?.axes.dispose();
            geometry?.references.dispose();
        };
    }, [geometry, invalidate]);

    if (!geometry) return null;
    return (
        <group userData={{ helper: true }}>
            <lineSegments geometry={geometry.axes}>
                <lineBasicMaterial color={AXIS_COLOR} toneMapped={false} />
            </lineSegments>
            <lineSegments geometry={geometry.references}>
                <lineBasicMaterial color={AXIS_REFERENCE_COLOR} toneMapped={false} />
            </lineSegments>
        </group>
    );
});
