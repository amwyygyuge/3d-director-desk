import { Box3 } from "three";

import { measureModelBox } from "../core/measureModelBox";
import type { SceneManager } from "../core/SceneManager";
import type { Transform } from "../core/SceneObject";

const GROUND_Y = 0;
const GROUND_ALIGNMENT_EPSILON_METERS = 0.0001;

/**
 * Runtime adapter that converts an evaluated pose's visual bounds into a serializable scene transform.
 *
 * It is invoked only by an explicit preset command, never by the render loop: pose switching therefore
 * remains grounded without turning per-frame bounds measurement into a performance cost.
 */
export class PoseGroundingService {
    private readonly bounds = new Box3();

    constructor(private readonly scene: SceneManager) {}

    alignObjectToGround(objectId: string): Transform | null {
        const entity = this.scene.getEntity(objectId);
        const runtime = this.scene.getRuntime(objectId);
        if (!entity || !runtime) return null;
        measureModelBox(runtime, this.bounds);
        if (this.bounds.isEmpty() || !Number.isFinite(this.bounds.min.y)) return null;
        const deltaY = GROUND_Y - this.bounds.min.y;
        if (Math.abs(deltaY) < GROUND_ALIGNMENT_EPSILON_METERS) return null;
        const transform = entity.transform;
        return {
            position: [transform.position[0], transform.position[1] + deltaY, transform.position[2]],
            rotation: transform.rotation,
            scale: transform.scale,
        };
    }
}
