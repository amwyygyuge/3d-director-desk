import { useThree } from "@react-three/fiber";
import { observer } from "mobx-react-lite";
import { useEffect, useRef } from "react";
import { PerspectiveCamera } from "three";

import type { CameraMotionSink } from "@/camera/CameraMotionSampler";
import type { ViewportPoseSource } from "@/camera/ViewportPoseSource";
import type { CameraMotionSample } from "@/camera/CameraMotionClip";
import type { OrbitLike } from "@/navigation/orbit";
import { useOrbitControls } from "@/navigation/orbit";
import type { ViewportOrbitController } from "@/camera/ViewportOrbitController";
import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";

/** Runtime owner for temporary Program output poses. Editor camera values are restored on output exit. */
class CameraMotionRuntimeSink implements CameraMotionSink, ViewportPoseSource {
    private camera: PerspectiveCamera | null = null;
    private controls: OrbitLike | null = null;
    private viewportOrbit: ViewportOrbitController | null = null;
    private saved = false;
    private positionX = 0;
    private positionY = 0;
    private positionZ = 0;
    private targetX = 0;
    private targetY = 0;
    private targetZ = 0;
    private fov = 45;

    attach(camera: PerspectiveCamera, controls: OrbitLike, viewportOrbit: ViewportOrbitController): void {
        this.camera = camera;
        this.controls = controls;
        this.viewportOrbit = viewportOrbit;
    }

    detach(): void {
        this.restoreFreeDirectorPose();
        this.camera = null;
        this.controls = null;
        this.viewportOrbit = null;
    }

    applyMotion(sample: CameraMotionSample): void {
        const camera = this.camera;
        const controls = this.controls;
        const viewportOrbit = this.viewportOrbit;
        if (!camera || !controls || !viewportOrbit) return;
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
        viewportOrbit.drainDampingResidual();
        camera.position.set(sample.positionX, sample.positionY, sample.positionZ);
        if (camera.fov !== sample.fov) {
            camera.fov = sample.fov;
            camera.updateProjectionMatrix();
        }
        controls.target.set(sample.targetX, sample.targetY, sample.targetZ);
        camera.lookAt(sample.targetX, sample.targetY, sample.targetZ);
    }

    /** 当前 R3F 相机的标量姿态反向提供给关键帧编排服务,不创建 Three/JSON 对象。 */
    readPose(sample: CameraMotionSample): boolean {
        const camera = this.camera;
        const controls = this.controls;
        if (!camera || !controls) return false;
        sample.positionX = camera.position.x;
        sample.positionY = camera.position.y;
        sample.positionZ = camera.position.z;
        sample.targetX = controls.target.x;
        sample.targetY = controls.target.y;
        sample.targetZ = controls.target.z;
        sample.fov = camera.fov;
        return true;
    }

    restoreFreeDirectorPose(): void {
        const camera = this.camera;
        const controls = this.controls;
        const viewportOrbit = this.viewportOrbit;
        if (!this.saved || !camera || !controls || !viewportOrbit) return;
        // 顺序铁律:先 drain 后写。drain 会把全部阻尼残量一次性施加到当前(即将丢弃的)
        // 姿态上并归零;若先写后 drain,残量会转到刚恢复的导演姿态上——复原就不精确了。
        viewportOrbit.drainDampingResidual();
        camera.position.set(this.positionX, this.positionY, this.positionZ);
        if (camera.fov !== this.fov) {
            camera.fov = this.fov;
            camera.updateProjectionMatrix();
        }
        controls.target.set(this.targetX, this.targetY, this.targetZ);
        camera.lookAt(this.targetX, this.targetY, this.targetZ);
        this.saved = false;
    }
}

/** Program 输出在全屏预览与镜头视角中接管视口相机;退出时精确复原导演姿态。 */
export const CameraMotionRig = observer(function CameraMotionRig() {
    const { motionAuthoring, playback, viewportOrbit } = useDirectorDeskStores();
    const isProgramOutput = motionAuthoring.programOutputActive;
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
        sink.attach(camera, controls, viewportOrbit);
        playback.bindMotionSink(sink);
        playback.bindPoseSource(sink);
        playback.sampleCurrent();
        return () => {
            playback.unbindPoseSource(sink);
            playback.unbindMotionSink(sink);
            sink.detach();
        };
    }, [camera, controls, isProgramOutput, playback, viewportOrbit]);

    return null;
});
