import type { MotionPositionSample } from "@/motion/MotionTrajectory";

/**
 * 跟随系(值载体):挂在主体身上的一套「平移 + 仅 yaw」参考系。
 *
 * 只取 yaw 是摄影不变式:主体的俯仰/翻滚(倒地、上坡、被动画甩动)绝不能传导到画面,
 * 地平线必须始终水平。yaw 以 cos/sin 对存放——每帧只解算一次三角函数,
 * 后续的正逆变换退化为乘加,采样期零分配。
 *
 * 正变换 world = origin + R_y(yaw)·local 与逆变换严格互逆,绑定/解绑因此保画面不跳。
 */
export class SubjectFrameSample {
    originX = 0;
    originY = 0;
    originZ = 0;
    yawCos = 1;
    yawSin = 0;

    /** 单位化的 yaw 分量:平滑抽头把 cos/sin 求和后落到这里,避免多一次 atan2 再解回来。 */
    setYawComponents(cos: number, sin: number): void {
        const length = Math.hypot(cos, sin);
        const isDegenerate = length === 0;
        this.yawCos = isDegenerate ? 1 : cos / length;
        this.yawSin = isDegenerate ? 0 : sin / length;
    }

    /**
     * 锚点原点:主体根点 + 跟随系内的锚点偏移(锚点随主体转身,故先旋转再平移)。
     * 必须在 setYawComponents 之后调用。
     */
    setAnchoredOrigin(
        rootX: number,
        rootY: number,
        rootZ: number,
        anchorX: number,
        anchorY: number,
        anchorZ: number,
    ): void {
        this.originX = rootX + this.yawCos * anchorX + this.yawSin * anchorZ;
        this.originY = rootY + anchorY;
        this.originZ = rootZ - this.yawSin * anchorX + this.yawCos * anchorZ;
    }

    /** 跟随系 → 世界。out 可与输入同源:分量先读进局部常量再写回。 */
    toWorld(localX: number, localY: number, localZ: number, out: MotionPositionSample): void {
        const x = localX;
        const z = localZ;
        out.x = this.originX + this.yawCos * x + this.yawSin * z;
        out.y = this.originY + localY;
        out.z = this.originZ - this.yawSin * x + this.yawCos * z;
    }

    /** 世界 → 跟随系:绑定期把世界关键帧搬进主体系,与 toWorld 互为逆。 */
    toLocal(worldX: number, worldY: number, worldZ: number, out: MotionPositionSample): void {
        const x = worldX - this.originX;
        const z = worldZ - this.originZ;
        out.x = this.yawCos * x - this.yawSin * z;
        out.y = worldY - this.originY;
        out.z = this.yawSin * x + this.yawCos * z;
    }

    /**
     * 只旋转不平移:曲线手柄是相对偏移量,套用带平移的变换会把手柄拽成绝对坐标。
     */
    rotateToWorld(localX: number, localY: number, localZ: number, out: MotionPositionSample): void {
        const x = localX;
        const z = localZ;
        out.x = this.yawCos * x + this.yawSin * z;
        out.y = localY;
        out.z = -this.yawSin * x + this.yawCos * z;
    }

    rotateToLocal(worldX: number, worldY: number, worldZ: number, out: MotionPositionSample): void {
        const x = worldX;
        const z = worldZ;
        out.x = this.yawCos * x - this.yawSin * z;
        out.y = worldY;
        out.z = this.yawSin * x + this.yawCos * z;
    }
}
