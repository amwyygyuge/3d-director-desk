import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { Vector3 } from "three";

import { isEditingText } from "../../shortcuts/ShortcutRegistry";
import { useDirectorDeskStores } from "../DirectorDeskContext";
import { useOrbitControls } from "../../navigation/orbit";

/** 飞行速度(单位/秒) */
const FLY_SPEED = 5;
/** 飞行键集:W/A/S/D 前后左右 + Space 升 + Shift 降(规格表) */
const FLY_KEYS: ReadonlySet<string> = new Set(["w", "a", "s", "d", " ", "shift"]);

const TMP_FORWARD = new Vector3();
const TMP_RIGHT = new Vector3();
const TMP_MOVE = new Vector3();
const WORLD_UP = new Vector3(0, 1, 0);

/** 键 → 位移方向查表(纪律:禁并列 if);forward 取相机视线,right 取视线叉乘世界上方向 */
const FLY_DIRECTIONS: Record<string, (move: Vector3, forward: Vector3, right: Vector3) => void> = {
    w: (move, forward) => move.add(forward),
    s: (move, forward) => move.sub(forward),
    d: (move, _forward, right) => move.add(right),
    a: (move, _forward, right) => move.sub(right),
    " ": (move) => move.add(WORLD_UP),
    shift: (move) => move.sub(WORLD_UP),
};

export interface FlyNavigationOptions {
    /** 是否接管飞行输入(导演视角/掌镜各自决定激活条件) */
    readonly active: boolean;
    /** 全部按键松开/失焦清空后回调一次——落 pose 或落命令由调用方决定 */
    readonly onSettled: () => void;
}

/**
 * 飞行导航共享状态机:WASD+Space/Shift 持续位移相机与轨道中心。
 *
 * 边界声明:持续按键语义不属于 ShortcutRegistry(离散和弦),由本模块自持按键状态;
 * W/E/R 已不再是 gizmo 快捷键(规格决策),无冲突。
 * 性能:飞行期 ui.flying=true → DirectorDesk 把 frameloop 切 "always",松开即回 "demand";
 * useFrame 体内零分配(模块级临时向量),delta 由渲染循环供给。
 * Rule of Two:FlyDrive(导演视角)与 ShotNavigation(掌镜)共用本 hook,settle 语义各自注入。
 */
export function useFlyNavigation({ active, onSettled }: FlyNavigationOptions): void {
    const stores = useDirectorDeskStores();
    const camera = useThree((state) => state.camera);
    const controls = useOrbitControls();
    const pressed = useRef(new Set<string>());
    const settledRef = useRef(onSettled);

    // settle 回调随渲染刷新,但不重建按键监听(ref 桥接,lint 纪律:渲染期不写 ref)
    useEffect(() => {
        settledRef.current = onSettled;
    });

    // 按键状态机:进飞行置 flying(切 always),全松开回调 settle(记 pose / 落命令)
    useEffect(() => {
        if (!active) {
            pressed.current.clear();
            return;
        }
        const onKeyDown = (event: KeyboardEvent) => {
            if (isEditingText() || event.metaKey || event.ctrlKey || event.altKey) return;
            const key = event.key.toLowerCase();
            if (!FLY_KEYS.has(key) || event.repeat) return;
            pressed.current.add(key);
            stores.ui.setFlying(true);
        };
        const onKeyUp = (event: KeyboardEvent) => {
            if (!pressed.current.delete(event.key.toLowerCase())) return;
            if (pressed.current.size === 0) {
                stores.ui.setFlying(false);
                settledRef.current();
            }
        };
        const clearAll = () => {
            if (pressed.current.size === 0) return;
            pressed.current.clear();
            stores.ui.setFlying(false);
            settledRef.current();
        };
        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("keyup", onKeyUp);
        window.addEventListener("blur", clearAll);
        return () => {
            window.removeEventListener("keydown", onKeyDown);
            window.removeEventListener("keyup", onKeyUp);
            window.removeEventListener("blur", clearAll);
            clearAll();
        };
    }, [active, stores]);

    useFrame((_, delta) => {
        const keys = pressed.current;
        if (!active || keys.size === 0 || !controls) return;
        camera.getWorldDirection(TMP_FORWARD);
        TMP_RIGHT.crossVectors(TMP_FORWARD, WORLD_UP).normalize();
        TMP_MOVE.set(0, 0, 0);
        for (const key of keys) FLY_DIRECTIONS[key]?.(TMP_MOVE, TMP_FORWARD, TMP_RIGHT);
        if (TMP_MOVE.lengthSq() === 0) return;
        TMP_MOVE.normalize().multiplyScalar(FLY_SPEED * delta);
        camera.position.add(TMP_MOVE);
        // 轨道中心跟随平移,飞行结束后环绕/聚焦不跳变
        controls.target.set(
            controls.target.x + TMP_MOVE.x,
            controls.target.y + TMP_MOVE.y,
            controls.target.z + TMP_MOVE.z,
        );
        controls.update();
    });
}
