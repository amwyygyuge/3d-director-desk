import { useThree } from "@react-three/fiber";
import { observer } from "mobx-react-lite";
import { useEffect, useRef } from "react";
import { PerspectiveCamera } from "three";

import type { CameraMotionSink } from "../../../camera/CameraMotionSampler";
import type { CameraMotionSample } from "../../../camera/CameraMotionClip";
import type { OrbitLike } from "../../../navigation/orbit";
import { useOrbitControls } from "../../../navigation/orbit";
import { useDirectorDeskStores } from "../../shell/DirectorDeskContext";

/** Runtime owner for temporary Program output poses. Editor camera values are restored on output exit. */
class CameraMotionRuntimeSink implements CameraMotionSink {
    private camera: PerspectiveCamera | null = null;
    private controls: OrbitLike | null = null;
    private saved = false;
    private positionX = 0;
    private positionY = 0;
    private positionZ = 0;
    private targetX = 0;
    private targetY = 0;
    private targetZ = 0;
    private fov = 45;

    attach(camera: PerspectiveCamera, controls: OrbitLike): void {
        this.camera = camera;
        this.controls = controls;
    }

    detach(): void {
        this.restoreFreeDirectorPose();
        this.camera = null;
        this.controls = null;
    }

    applyMotion(sample: CameraMotionSample): void {
        const camera = this.camera;
        const controls = this.controls;
        if (!camera || !controls) return;
        if (!this.saved) {
            this.positionX = camera.position.x;
            this.positionY = camera.position.y;
            this.positionZ = camera.position.z;
            this.targetX = controls.target.x;
            this.targetY = controls.target.y;
            this.targetZ = controls.target.z;
            this.fov = camera.fov;
            this.saved = true;
        }
        camera.position.set(sample.positionX, sample.positionY, sample.positionZ);
        if (camera.fov !== sample.fov) {
            camera.fov = sample.fov;
            camera.updateProjectionMatrix();
        }
        controls.target.set(sample.targetX, sample.targetY, sample.targetZ);
        camera.lookAt(sample.targetX, sample.targetY, sample.targetZ);
        controls.update();
    }

    restoreFreeDirectorPose(): void {
        const camera = this.camera;
        const controls = this.controls;
        if (!this.saved || !camera || !controls) return;
        camera.position.set(this.positionX, this.positionY, this.positionZ);
        if (camera.fov !== this.fov) {
            camera.fov = this.fov;
            camera.updateProjectionMatrix();
        }
        controls.target.set(this.targetX, this.targetY, this.targetZ);
        camera.lookAt(this.targetX, this.targetY, this.targetZ);
        controls.update();
        this.saved = false;
    }
}

/**
 * Program 输出只在全屏预览期接管视口相机;编辑期(含运镜编排)始终保留自由编辑视角。
 * 预览退出时 restoreCameraMotion 把编辑相机的位姿放回去。
 */
export const CameraMotionRig = observer(function CameraMotionRig() {
    const { layout, playback } = useDirectorDeskStores();
    const isProgramOutput = layout.presentationMode;
    const camera = useThree((state) => state.camera);
    const controls = useOrbitControls();
    const sinkRef = useRef<CameraMotionRuntimeSink | null>(null);
    sinkRef.current ??= new CameraMotionRuntimeSink();

    useEffect(() => {
        const sink = sinkRef.current;
        if (!sink || !controls || !(camera instanceof PerspectiveCamera) || !isProgramOutput) {
            playback.restoreCameraMotion();
            return;
        }
        sink.attach(camera, controls);
        playback.bindMotionSink(sink);
        playback.sampleCurrent();
        return () => {
            playback.unbindMotionSink(sink);
            sink.detach();
        };
    }, [camera, controls, isProgramOutput, playback]);

    return null;
});
