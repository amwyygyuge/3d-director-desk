import { useFrame, useThree } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import { observer } from "mobx-react-lite";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType } from "react";
import type { Group, Object3D } from "three";
import { Box3, BufferGeometry, Matrix4, SkinnedMesh } from "three";

import type { SceneObject, SceneObjectKind } from "@/core/SceneObject";
import { SELECTION_ROLE } from "@/core/SelectionRole";
import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { SelectionBoxHighlight } from "@/ui/viewport/scene/SelectionHighlight";
import { LightContent, ModelContent } from "@/ui/viewport/scene/contents";
import { useCaptureHelperRegistration } from "@/ui/viewport/scene/useCaptureHelperRegistration";

/** 实体局部包围盒:按内容变化重算一次,渲染循环内不重复 traverse。 */
class LocalBoundsIndex {
    readonly bounds = new Box3();
    private readonly inverseRoot = new Matrix4();
    private readonly relativeChild = new Matrix4();
    private readonly transformedBounds = new Box3();

    updateLocal(root: Group): void {
        root.updateWorldMatrix(true, true);
        this.inverseRoot.copy(root.matrixWorld).invert();
        this.bounds.makeEmpty();
        root.traverse((candidate) => {
            const localBounds = this.contentBounds(candidate);
            if (!localBounds) return;
            this.relativeChild.multiplyMatrices(this.inverseRoot, candidate.matrixWorld);
            this.transformedBounds.copy(localBounds).applyMatrix4(this.relativeChild);
            this.bounds.union(this.transformedBounds);
        });
    }

    /** 蒙皮顶点留在 bind space，必须由 SkinnedMesh 结合骨骼矩阵计算真实包围盒。 */
    private contentBounds(candidate: Object3D): Box3 | null {
        const geometry = (candidate as Object3D & { geometry?: unknown }).geometry;
        const isRenderableContent = geometry instanceof BufferGeometry && candidate.userData.helper !== true;
        if (!isRenderableContent) return null;
        return candidate instanceof SkinnedMesh ? this.skinnedBounds(candidate) : this.geometryBounds(geometry);
    }

    private skinnedBounds(mesh: SkinnedMesh): Box3 | null {
        mesh.computeBoundingBox();
        return mesh.boundingBox;
    }

    private geometryBounds(geometry: BufferGeometry): Box3 | null {
        geometry.computeBoundingBox();
        return geometry.boundingBox;
    }
}

/**
 * 内容签名:实体运行时 group 下「非辅助物」子节点的数量、身份与本地矩阵。
 *
 * 矩阵必须入签名:模型壳层在挂载后第二帧才做归一化(ModelContent),身份与数量都不变,
 * 只比身份会把归一化前的尺寸烙进包围盒——实测狐狸模型框会大 77 倍,等同于没有选中态。
 * 辅助物排除:高亮框自身是 group 的子节点,计入会自我喂食。
 */
class ContentSignature {
    private isCaptured = false;
    private contentCount = 0;
    private content: Object3D | undefined;
    private readonly contentMatrix = new Matrix4();

    /** 变化时更新签名并返回 true;无变化时零成本、零分配。 */
    refresh(root: Group): boolean {
        const content = firstContentChild(root);
        const contentCount = contentChildCount(root);
        const isSame =
            this.isCaptured &&
            this.contentCount === contentCount &&
            this.content === content &&
            (content === undefined || this.contentMatrix.equals(content.matrix));
        if (isSame) return false;
        this.isCaptured = true;
        this.contentCount = contentCount;
        this.content = content;
        if (content) this.contentMatrix.copy(content.matrix);
        return true;
    }

    /** 换了高亮框实例:强制下一帧重算一次包围盒。 */
    invalidate(): void {
        this.isCaptured = false;
    }
}

function firstContentChild(root: Group): Object3D | undefined {
    for (const child of root.children) {
        if (child.userData.helper !== true) return child;
    }
    return undefined;
}

function contentChildCount(root: Group): number {
    return root.children.reduce((count, child) => (child.userData.helper === true ? count : count + 1), 0);
}

/** kind → 渲染内容查表(纪律:禁 if 链)。 */
const KIND_CONTENT: Record<SceneObjectKind, ComponentType<{ entity: SceneObject }>> = {
    model: ModelContent,
    camera: () => null,
    light: LightContent,
};

/**
 * 单个场景实体的渲染体。
 * - 外层 group 承载 transform + 运行时绑定(ref 回调);
 * - ref 回调完成 three 运行时 ↔ SceneManager 的绑定/解绑(运行时永不进 observable);
 * - 渲染体内禁止写场景 store;点选写 SelectionStore(纯 UI 态,不走命令层);
 * - 锁定实体不挂 onClick:R3F 无 handler 即 eventCount 归零、退出交互列表,射线直接穿透,
 *   点布景等同点空,由 Canvas onPointerMissed 的取消选中路径接管(handler 内早退不行,
 *   那样实体仍在交互列表里、仍会命中并 stopPropagation,把背后的实体和"点空"一起吞掉);
 * - 选中模型一律显示包围框:Outliner 选中锁定实体也要出包围框,故高亮与点选守卫互不相干;
 * - 帧内仅在内容签名变化时重算一次局部包围盒;
 * - 灯光的选中态由灯光 helper 表达,不叠包围框。
 */
export const SceneObjectView = observer(function SceneObjectView({ entity }: { entity: SceneObject }) {
    const { capture, scene, selection, playback } = useDirectorDeskStores();
    const invalidate = useThree((state) => state.invalidate);
    const groupRef = useRef<Group | null>(null);
    const registerCaptureHelper = useCaptureHelperRegistration<Group>(capture.helpers);
    const boundsIndex = useMemo(() => new LocalBoundsIndex(), []);
    const signature = useMemo(() => new ContentSignature(), []);
    const [highlight, setHighlight] = useState<SelectionBoxHighlight | null>(null);

    // 依赖实体实例而非 id:文档导入用同 id 的新实体整体替换,只有回调标识变化才能让 React 重新绑定运行时
    const bindRuntime = useCallback(
        (object3d: Group | null) => {
            groupRef.current = object3d;
            if (object3d) {
                scene.manager.bindRuntime(entity.id, object3d);
                playback.sampleObject(entity.id);
            } else {
                playback.restoreObject(entity.id);
                scene.manager.unbindRuntime(entity.id);
            }
        },
        [scene, entity, playback],
    );

    const hasHighlight = selection.isSelected(entity.id) && entity.kind !== "light";
    const role = selection.primaryId === entity.id ? SELECTION_ROLE.PRIMARY : SELECTION_ROLE.SECONDARY;
    // 模型选中始终走包围框；生命周期全在 effect 内，StrictMode 重放不会漏掉 GL 资源。
    useEffect(() => {
        if (!hasHighlight) return;
        const created = new SelectionBoxHighlight(role);
        setHighlight(created);
        return () => {
            setHighlight(null);
            created.dispose();
            invalidate();
        };
    }, [hasHighlight, role, invalidate]);

    // demand 模式下，线框 primitive 提交后再补帧，保证首帧已挂载才消费内容签名。
    useEffect(() => {
        if (!highlight) return;
        signature.invalidate();
        invalidate();
    }, [highlight, signature, invalidate]);

    // 渲染期直读实体 transform(observer 细粒度订阅);applyTransform 整体替换,引用变化即触发
    const transform = entity.transform;
    // transform 引用替换 → 补帧(demand 模式立即成像)
    useEffect(() => invalidate(), [invalidate, transform]);

    useFrame(() => {
        const object = groupRef.current;
        if (!hasHighlight || !object) return;
        if (!highlight || !signature.refresh(object)) return;
        boundsIndex.updateLocal(object);
        highlight.applyBounds(boundsIndex.bounds);
    });

    const Content = KIND_CONTENT[entity.kind];
    const { position, rotation, scale } = transform;
    // 渲染期直读 locked(observer 自动订阅):锁定即整个 onClick 属性缺席,而非 handler 内早退。
    // 走条件展开而非 onClick={undefined}:exactOptionalPropertyTypes 下显式 undefined 不合法;
    // handler 与展开结果都 memo 住,渲染期零新增分配。
    const locked = entity.locked;
    const selectSelf = useCallback(
        (event: ThreeEvent<MouseEvent>) => {
            event.stopPropagation();
            selection.select(entity.id, { additive: event.metaKey || event.ctrlKey });
        },
        [selection, entity],
    );
    const pickHandlers = useMemo(() => (locked ? {} : { onClick: selectSelf }), [locked, selectSelf]);
    return (
        <group ref={bindRuntime} position={[...position]} rotation={[...rotation]} scale={[...scale]} {...pickHandlers}>
            <Content entity={entity} />
            {highlight ? <primitive object={highlight.object3d} ref={registerCaptureHelper} /> : null}
        </group>
    );
});
