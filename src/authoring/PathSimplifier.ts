import type { Vec3 } from "@/core/SceneObject";

interface FarthestPoint {
    readonly index: number;
    readonly distance: number;
}

const NO_FARTHEST: FarthestPoint = { index: -1, distance: 0 };
const MINIMUM_SIMPLIFIABLE_POINTS = 3;

function squaredLength(x: number, y: number, z: number): number {
    return x * x + y * y + z * z;
}

/** 点到线段所在直线的垂距;退化线段(首末重合)时退化为点距。 */
function perpendicularDistance(point: Vec3, from: Vec3, to: Vec3): number {
    const lineX = to[0] - from[0];
    const lineY = to[1] - from[1];
    const lineZ = to[2] - from[2];
    const pointX = point[0] - from[0];
    const pointY = point[1] - from[1];
    const pointZ = point[2] - from[2];
    const lineLengthSquared = squaredLength(lineX, lineY, lineZ);
    if (lineLengthSquared === 0) return Math.sqrt(squaredLength(pointX, pointY, pointZ));
    const crossX = pointY * lineZ - pointZ * lineY;
    const crossY = pointZ * lineX - pointX * lineZ;
    const crossZ = pointX * lineY - pointY * lineX;
    return Math.sqrt(squaredLength(crossX, crossY, crossZ) / lineLengthSquared);
}

function farthestFromChord(points: readonly Vec3[], from: Vec3, to: Vec3): FarthestPoint {
    return points.reduce<FarthestPoint>((farthest, point, index) => {
        const distance = perpendicularDistance(point, from, to);
        return distance > farthest.distance ? { index, distance } : farthest;
    }, NO_FARTHEST);
}

/**
 * 轨迹抽稀(领域服务,无状态)。
 *
 * Ramer–Douglas–Peucker:手绘产生的几百个原始点直接入库就是不可编辑的死数据,
 * 抽稀后每个留下的点都是作者意图上的转折,可以逐点拖动重编。
 * epsilon 由调用方按场景/路径尺度换算,本服务不认识世界单位。
 */
export class PathSimplifier {
    simplify(points: readonly Vec3[], epsilon: number): readonly Vec3[] {
        if (points.length < MINIMUM_SIMPLIFIABLE_POINTS) return points;
        const first = points[0];
        const last = points[points.length - 1];
        if (!first || !last) return points;
        const interior = points.slice(1, -1);
        const farthest = farthestFromChord(interior, first, last);
        if (farthest.index < 0 || farthest.distance <= epsilon) return [first, last];
        // interior 相对原数组偏移 1
        const splitIndex = farthest.index + 1;
        const head = this.simplify(points.slice(0, splitIndex + 1), epsilon);
        const tail = this.simplify(points.slice(splitIndex), epsilon);
        return [...head.slice(0, -1), ...tail];
    }
}
