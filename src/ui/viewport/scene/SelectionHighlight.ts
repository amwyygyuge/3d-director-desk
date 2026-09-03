import {
    BufferAttribute,
    BufferGeometry,
    Float32BufferAttribute,
    Group,
    LineBasicMaterial,
    LineSegments,
    Vector3,
} from "three";
import type { Box3 } from "three";

import { SELECTION_ROLE } from "@/core/SelectionRole";
import type { SelectionRole } from "@/core/SelectionRole";

interface SelectionAffordance {
    /** 线框颜色(未遮挡实线与穿透虚影同色,只差不透明度) */
    readonly color: number;
    /** 被遮挡处的穿透线不透明度:主选更实,次选更淡 */
    readonly occludedOpacity: number;
}

/** 角色 → 视觉配方查表(纪律:禁 if 链)。 */
const SELECTION_AFFORDANCE: Record<SelectionRole, SelectionAffordance> = {
    [SELECTION_ROLE.PRIMARY]: { color: 0xffd54f, occludedOpacity: 0.45 },
    [SELECTION_ROLE.SECONDARY]: { color: 0x8fa6bd, occludedOpacity: 0.25 },
};

const HALF_EDGE = 0.5;
/** 单位盒八角(边长 1,中心在原点):实例只按包围盒设 position/scale,几何不重建。 */
const UNIT_BOX_CORNERS: readonly number[] = [
    HALF_EDGE,
    HALF_EDGE,
    HALF_EDGE,
    -HALF_EDGE,
    HALF_EDGE,
    HALF_EDGE,
    -HALF_EDGE,
    -HALF_EDGE,
    HALF_EDGE,
    HALF_EDGE,
    -HALF_EDGE,
    HALF_EDGE,
    HALF_EDGE,
    HALF_EDGE,
    -HALF_EDGE,
    -HALF_EDGE,
    HALF_EDGE,
    -HALF_EDGE,
    -HALF_EDGE,
    -HALF_EDGE,
    -HALF_EDGE,
    HALF_EDGE,
    -HALF_EDGE,
    -HALF_EDGE,
];
const UNIT_BOX_EDGES = new Uint16Array([0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7]);
const POSITION_ITEM_SIZE = 3;
const EDGE_INDEX_ITEM_SIZE = 1;
/** 穿透层最后绘制:不写深度、不测深度,压在不透明体之上才能在遮挡处显形 */
const OCCLUDED_RENDER_ORDER = 2;

function createUnitBoxEdges(): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setIndex(new BufferAttribute(UNIT_BOX_EDGES, EDGE_INDEX_ITEM_SIZE));
    geometry.setAttribute("position", new Float32BufferAttribute([...UNIT_BOX_CORNERS], POSITION_ITEM_SIZE));
    return geometry;
}

/**
 * 场景对象的选中包围框(每个选中实体一只)。
 *
 * 归属:实体运行时 group 的子节点——摆位、走位与播放的位移由父级 transform 免费带走,
 * 帧内不做世界矩阵推导;只有内容(壳层挂载/归一化)变化时由调用方重算局部包围盒。
 *
 * 可见性:实线层受深度测试(未被遮挡处亮),穿透层不测深度(被遮挡处留淡影),
 * 两层共用一份几何。截图/导出摘除按 Object3D 判定,故三个节点都打 helper 标记。
 */
export class SelectionBoxHighlight {
    readonly object3d = new Group();
    private readonly geometry = createUnitBoxEdges();
    private readonly solidMaterial: LineBasicMaterial;
    private readonly occludedMaterial: LineBasicMaterial;
    private readonly center = new Vector3();
    private readonly size = new Vector3();

    constructor(role: SelectionRole) {
        const affordance = SELECTION_AFFORDANCE[role];
        this.solidMaterial = new LineBasicMaterial({ color: affordance.color, toneMapped: false });
        this.occludedMaterial = new LineBasicMaterial({
            color: affordance.color,
            toneMapped: false,
            transparent: true,
            opacity: affordance.occludedOpacity,
            depthTest: false,
            depthWrite: false,
        });
        const solid = new LineSegments(this.geometry, this.solidMaterial);
        const occluded = new LineSegments(this.geometry, this.occludedMaterial);
        occluded.renderOrder = OCCLUDED_RENDER_ORDER;
        this.object3d.add(solid, occluded);
        for (const part of [this.object3d, solid, occluded]) part.userData.helper = true;
    }

    /** 对齐到实体局部包围盒;空盒(内容尚未挂载)整体隐藏,不留退化线框。 */
    applyBounds(bounds: Box3): void {
        const isBoundsEmpty = bounds.isEmpty();
        this.object3d.visible = !isBoundsEmpty;
        if (isBoundsEmpty) return;
        bounds.getCenter(this.center);
        bounds.getSize(this.size);
        this.object3d.position.copy(this.center);
        this.object3d.scale.set(this.size.x, this.size.y, this.size.z);
    }

    /** 先离树再释放:避免 React 提交这一帧之间渲染到已释放的几何。 */
    dispose(): void {
        this.object3d.removeFromParent();
        this.object3d.clear();
        this.geometry.dispose();
        this.solidMaterial.dispose();
        this.occludedMaterial.dispose();
    }
}
