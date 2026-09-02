import { observer } from "mobx-react-lite";

import {
    EntityTransformSection,
    type InspectorSectionProps,
    LightEntitySection,
    modelHasActionContent,
    ShotCameraSection,
} from "@/ui/inspector/Inspector";
import { ModelPoseSection } from "@/ui/pose/BoneTreePanel";
import { CameraMotionSection, MotionClipSection } from "@/ui/inspector/MotionClipInspector";
import { ActorImageSection, hasActorProfile } from "@/ui/actor/ActorImageSection";
import { PoseComposerSection } from "@/ui/pose/PoseComposerSection";
import { QuickMotionSection } from "@/ui/inspector/QuickMotionSection";
import { TabSectionRegistry } from "@/ui/patterns/TabbedSections";
import type { SceneObjectKind } from "@/core/SceneObject";
import type { DirectorDeskStores } from "@/ui/shell/DirectorDeskContext";

/** 右栏检查器的选中上下文类型;新增类型时在 INSPECTOR_SELECTION_LABEL(InspectorSheet)补文案。 */
export type InspectorSelectionKind = SceneObjectKind | "camera-shot" | "motion-clip";

/**
 * tab 内容上下文:primaryId/report 同时是 section 组件的 props;
 * stores 仅供 TabSpec.visible 谓词读取(纯函数,组件仍经 hook 自取)。
 */
export interface InspectorSectionContext extends InspectorSectionProps {
    readonly stores: DirectorDeskStores;
}

const CameraMotionTabContent = observer(function CameraMotionTabContent({ primaryId }: InspectorSectionProps) {
    return <CameraMotionSection cameraId={primaryId} />;
});
const MotionClipTabContent = observer(function MotionClipTabContent({ primaryId }: InspectorSectionProps) {
    return <MotionClipSection clipId={primaryId} />;
});

/**
 * 检查器 tab 注册表:按选中类型装配内容分类。
 * 扩展新分类 = register 一条 TabSpec;单 tab 类型不显示 tab 条(TabbedSections 收敛)。
 */
export const inspectorTabs = new TabSectionRegistry<InspectorSelectionKind, InspectorSectionContext>();

inspectorTabs.register("camera-shot", { id: "shot", label: "机位", content: ShotCameraSection });
inspectorTabs.register("camera-shot", { id: "motion", label: "运镜", content: CameraMotionTabContent });
inspectorTabs.register("motion-clip", { id: "motion", label: "运镜", content: MotionClipTabContent });
inspectorTabs.register("model", { id: "transform", label: "变换", content: EntityTransformSection });
inspectorTabs.register("model", { id: "quick-motion", label: "运镜", content: QuickMotionSection });
inspectorTabs.register("model", {
    id: "image",
    label: "形象",
    content: ActorImageSection,
    visible: ({ stores, primaryId }) => hasActorProfile(stores, primaryId),
});
inspectorTabs.register("model", {
    id: "pose",
    label: "姿势",
    content: PoseComposerSection,
    visible: ({ stores, primaryId }) => hasActorProfile(stores, primaryId) || modelHasActionContent(stores, primaryId),
});
inspectorTabs.register("model", { id: "rig", label: "姿态", content: ModelPoseSection });
inspectorTabs.register("light", { id: "properties", label: "属性", content: LightEntitySection });
inspectorTabs.register("camera", { id: "transform", label: "变换", content: EntityTransformSection });
