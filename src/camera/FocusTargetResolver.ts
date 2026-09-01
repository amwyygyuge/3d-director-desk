import { FOCUS_TARGET_KIND } from "@/camera/CameraFocusTrack";
import type { CameraFocusTrack, FocusTargetSample } from "@/camera/CameraFocusTrack";
import type { SceneManager } from "@/core/SceneManager";

export class FocusTargetResolver {
    constructor(private readonly scene: SceneManager) {}

    resolve(track: CameraFocusTrack, sample: FocusTargetSample): boolean {
        const target = track.target;
        if (target.kind === FOCUS_TARGET_KIND.WORLD_POINT) {
            sample.x = target.position[0];
            sample.y = target.position[1];
            sample.z = target.position[2];
            return true;
        }
        const entity = this.scene.getEntity(target.objectId);
        if (!entity) return false;
        const runtime = this.scene.getRuntime(target.objectId);
        if (!runtime) {
            sample.x = entity.transform.position[0] + target.worldOffset[0];
            sample.y = entity.transform.position[1] + target.worldOffset[1];
            sample.z = entity.transform.position[2] + target.worldOffset[2];
            return true;
        }
        runtime.updateWorldMatrix(true, false);
        const elements = runtime.matrixWorld.elements;
        sample.x = (elements[12] ?? 0) + target.worldOffset[0];
        sample.y = (elements[13] ?? 0) + target.worldOffset[1];
        sample.z = (elements[14] ?? 0) + target.worldOffset[2];
        return true;
    }
}
