import { useFrame, useThree } from "@react-three/fiber";
import { observer } from "mobx-react-lite";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType } from "react";
import type { Group, Object3D } from "three";
import { Box3, BufferGeometry, Matrix4 } from "three";

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
            const geometry = (candidate as Object3D & { geometry?: unknown }).geometry;
            if (!(geometry instanceof BufferGeometry) || candidate.userData.helper) return;
            geometry.computeBoundingBox();
            if (!geometry.boundingBox) return;
            this.relativeChild.multiplyMatrices(this.inverseRoot, candidate.matrixWorld);
            this.transformedBounds.copy(geometry.boundingBox).applyMatrix4(this.relativeChild);
            this.bounds.union(this.transformedBounds);
        });
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
 * - 选中态优先走辉光(SelectionTintBinder 写 emissive):模型本体发亮,人偶远近都可辨;
 *   材质不可着色(OBJ/FBX 的共享 Phong/Basic)时回退包围框,两者互斥不并存;
 *   包围框挂在 group 之下,位移随父级免费更新,帧内仅在内容签名变化时重算一次局部包围盒;
 *   灯光的选中态由灯光 helper 表达,既不着色也不叠框。
 */
export const SceneObjectView = observer(function SceneObjectView({ entity }: { entity: SceneObject }) {
    const { capture, scene, selection, playback, selectionTint } = useDirectorDeskStores();
    const invalidate = useThree((state) => state.invalidate);
    const groupRef = useRef<Group | null>(null);
    const registerCaptureHelper = useCaptureHelperRegistration<Group>(capture.helpers);
    const boundsIndex = useMemo(() => new LocalBoundsIndex(), []);
    const signature = useMemo(() => new ContentSignature(), []);
    const [highlight, setHighlight] = useState<SelectionBoxHighlight | null>(null);
    const [isTinted, setIsTinted] = useState(false);

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
    // 着色成功即不挂框;模型尚未加载完时材质未就位,先落框,加载后由帧内重试切换
    useEffect(() => {
        if (!hasHighlight) return;
        setIsTinted(selectionTint.apply(entity.id, role));
        signature.invalidate();
        invalidate();
        return () => {
            selectionTint.clear(entity.id);
            setIsTinted(false);
            invalidate();
        };
    }, [hasHighlight, role, entity.id, selectionTint, signature, invalidate]);

    // 生命周期全在 effect 内:StrictMode 重放不会漏掉一份未释放的 GL 资源
    useEffect(() => {
        if (!hasHighlight || isTinted) return;
        const created = new SelectionBoxHighlight(role);
        signature.invalidate();
        setHighlight(created);
        invalidate();
        return () => {
            setHighlight(null);
            created.dispose();
            invalidate();
        };
    }, [hasHighlight, isTinted, role, signature, invalidate]);

    // 渲染期直读实体 transform(observer 细粒度订阅);applyTransform 整体替换,引用变化即触发
    const transform = entity.transform;
    // transform 引用替换 → 补帧(demand 模式立即成像)
    useEffect(() => invalidate(), [invalidate, transform]);

    useFrame(() => {
        const object = groupRef.current;
        if (!hasHighlight || !object) return;
        if (!signature.refresh(object)) return;
        // 内容换过(壳层挂载、归一化、换模型重挂):旧克隆材质已作废,必须重绑辉光目标再判定回退
        selectionTint.clear(entity.id);
        setIsTinted(selectionTint.apply(entity.id, role));
        if (!highlight) return;
        boundsIndex.updateLocal(object);
        highlight.applyBounds(boundsIndex.bounds);
    });

    const Content = KIND_CONTENT[entity.kind];
    const { position, rotation, scale } = transform;
    return (
        <group
            ref={bindRuntime}
            position={[...position]}
            rotation={[...rotation]}
            scale={[...scale]}
            onClick={(e) => {
                e.stopPropagation();
                selection.select(entity.id, { additive: e.metaKey || e.ctrlKey });
            }}
        >
            <Content entity={entity} />
            {highlight ? <primitive object={highlight.object3d} ref={registerCaptureHelper} /> : null}
        </group>
    );
});
