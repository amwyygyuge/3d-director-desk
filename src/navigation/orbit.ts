import { useThree } from "@react-three/fiber";

/**
 * OrbitControls 的最小结构接口:避免深引 three-stdlib 类型(非直接依赖)。
 * 三处消费(ShotCameraRig/FlyDrive/ShotNavigation)共享,Rule of Two 收口。
 */
export interface OrbitLike {
    target: { x: number; y: number; z: number; set: (x: number, y: number, z: number) => void };
    enabled: boolean;
    /** 阻尼开关:唯一合法写方是 ViewportOrbitController(真正排空残量需临时关掉它) */
    enableDamping: boolean;
    update: () => void;
    addEventListener: (type: string, listener: () => void) => void;
    removeEventListener: (type: string, listener: () => void) => void;
}

/** 读取 makeDefault 注册的轨道控制器;未就绪返回 null */
export function useOrbitControls(): OrbitLike | null {
    return useThree((state) => state.controls) as unknown as OrbitLike | null;
}
