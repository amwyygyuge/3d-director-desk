import type { CommandResult, DirectorDeskStores, SerializedCommand } from "@/index";
import { waitMs } from "@/core/waitMs";

/** 模型装载轮询上限:与命令层 mountWhenReady 的 10s 口径一致。 */
const LOAD_POLL_LIMIT = 40;
const LOAD_POLL_INTERVAL_MS = 250;

/** scene.describe 的最小读模型:播种只关心装载结局,不读包围盒。 */
interface SeedEntityInspection {
    readonly id: string;
    readonly loadState: "none" | "loading" | "loaded" | "failed";
}

/**
 * 电影级演示场景播种器(playground 首启一次性布景)。
 *
 * 纪律:
 *  - 一切写操作经命令层;播种不是用户编辑,`record: false` 不污染撤销栈;
 *  - 每条 dispatch 检查 `ok`,失败即中止并上报——静默半成品场景比报错更难排查;
 *  - 模型装载用 `scene.describe` 轮询结局,不用固定 sleep 赌加载时长;
 *  - 播种只布景不播放:播放是作者的决策,且常播违反 demand 渲染红线。
 */
export class CinematicSceneSeeder {
    constructor(private readonly stores: DirectorDeskStores) {}

    /** 布景 + 断言;任一环节失败抛错,由调用方决定如何上报。 */
    async seed(): Promise<void> {
        await this.waitForCatalogReady();
        this.seedStudio();
        this.seedScenery();
        this.seedActors();
        await this.waitForActorsLoaded();
        this.seedActorProfiles();
        this.seedPoses();
        this.seedHeroMovementTrack();
        this.seedActionSequence();
        this.seedLighting();
        this.seedCameraTake();
        // 停在 0 帧等待作者,而不是替他按下播放
        this.dispatchChecked({ type: "transport.seek", payload: { time: 0 } });
        this.dispatchChecked({ type: "transport.set-loop", payload: { loop: true } });
    }

    private dispatchChecked(command: SerializedCommand): CommandResult {
        const result = this.stores.dispatcher.dispatch(command, this.stores, { record: false });
        if (!result.ok) {
            throw new Error(
                `[seed] 命令 ${command.type} 失败: ${result.issues?.join(";") ?? result.error ?? "未知原因"}`,
            );
        }
        return result;
    }

    private seedStudio(): void {
        this.dispatchChecked({ type: "studio.set-floor-surface", payload: { enabled: true } });
        this.dispatchChecked({ type: "studio.set-floor-color", payload: { color: "#141518" } });
        this.dispatchChecked({ type: "studio.set-shadows", payload: { enabled: true } });
        this.dispatchChecked({ type: "output.set-format", payload: { formatId: "16:9" } });
        this.dispatchChecked({ type: "timeline.set-duration", payload: { duration: 10 } });
        this.dispatchChecked({
            type: "timeline.set-playback-range",
            payload: { inSeconds: 0, outSeconds: 10 },
        });
    }

    private seedScenery(): void {
        const column = (id: string, position: [number, number, number]): SerializedCommand => ({
            type: "assets.place",
            payload: { id, assetId: "builtin.scenery.column", transform: { position, rotation: [0, 0, 0], scale: [1.3, 4.5, 1.3] } },
        });
        this.dispatchChecked(column("fg-col-left", [-2.4, 3.0, 2.8]));
        this.dispatchChecked(column("fg-col-right", [3.2, 3.0, 1.5]));
        this.dispatchChecked(column("mid-col-left", [-3.8, 3.0, -3.0]));
        this.dispatchChecked(column("mid-col-right", [3.8, 3.0, -3.0]));
        this.dispatchChecked({
            type: "assets.place",
            payload: {
                id: "bg-wall-center",
                assetId: "builtin.scenery.wall",
                transform: { position: [0, 3.5, -14.0], rotation: [0, 0, 0], scale: [8.5, 3.5, 0.5] },
            },
        });
        this.dispatchChecked({
            type: "assets.place",
            payload: {
                id: "bg-pyr-left",
                assetId: "builtin.scenery.pyramid",
                transform: { position: [-6.5, 2.5, -15.0], rotation: [0, 0.4, 0], scale: [2.5, 3.5, 2.5] },
            },
        });
        this.dispatchChecked({
            type: "assets.place",
            payload: {
                id: "bg-pyr-right",
                assetId: "builtin.scenery.pyramid",
                transform: { position: [6.5, 2.5, -15.0], rotation: [0, -0.4, 0], scale: [2.5, 3.5, 2.5] },
            },
        });
    }

    private seedActors(): void {
        this.dispatchChecked({
            type: "assets.place",
            payload: {
                id: "actor-hero",
                assetId: "builtin.humanoid-generic",
                transform: { position: [0, 0, 1.2], rotation: [0, 0, 0], scale: [1, 1, 1] },
            },
        });
        this.dispatchChecked({
            type: "assets.place",
            payload: {
                id: "actor-rival",
                assetId: "builtin.humanoid-generic",
                transform: { position: [0, 0, -3.8], rotation: [0, Math.PI, 0], scale: [1.05, 1.05, 1.05] },
            },
        });
    }

    /**
     * 目录就绪闸门:AssetCatalog 在 createDirectorDeskStores 里异步装载(void loadProvider),
     * onReady 触发时条目可能还没回来,assets.place 会以「资源不在目录」校验失败。
     * 轮询 size 而非固定 sleep;目录为空说明 catalog.json 加载失败,按装载故障中止。
     */
    private async waitForCatalogReady(): Promise<void> {
        const countdown = { remaining: LOAD_POLL_LIMIT };
        while (countdown.remaining > 0) {
            countdown.remaining -= 1;
            if (this.stores.catalog.size > 0) return;
            await waitMs(LOAD_POLL_INTERVAL_MS);
        }
        throw new Error("[seed] 资源目录加载超时(catalog.json 未就绪)");
    }

    /** 姿势/体型/情绪打光都依赖运行时骨架与包围盒:先等装载结局,再进依赖步骤。 */
    private async waitForActorsLoaded(): Promise<void> {
        const countdown = { remaining: LOAD_POLL_LIMIT };
        while (countdown.remaining > 0) {
            countdown.remaining -= 1;
            const result = this.stores.dispatcher.query(
                { type: "scene.describe", payload: {} },
                this.stores,
            );
            if (!result.ok) throw new Error(`[seed] scene.describe 失败: ${result.error ?? "未知原因"}`);
            const actors = (result.value as readonly SeedEntityInspection[]).filter(
                (entity) => entity.id === "actor-hero" || entity.id === "actor-rival",
            );
            if (actors.some((entity) => entity.loadState === "failed")) {
                throw new Error("[seed] 人偶模型装载失败,放弃播种");
            }
            if (actors.length === 2 && actors.every((entity) => entity.loadState === "loaded")) return;
            await waitMs(LOAD_POLL_INTERVAL_MS);
        }
        throw new Error("[seed] 等待人偶装载超时");
    }

    private seedActorProfiles(): void {
        this.dispatchChecked({
            type: "scene.set-identity",
            payload: { id: "actor-hero", identity: { role: "protagonist", label: "战术先锋 (Blade)" } },
        });
        this.dispatchChecked({
            type: "scene.set-identity",
            payload: { id: "actor-rival", identity: { role: "antagonist", label: "重装裁决官 (Vanguard)" } },
        });
        this.dispatchChecked({
            type: "actor.appearance.set",
            payload: { objectId: "actor-hero", baseColorHex: "#282c35", surface: "sheen" },
        });
        this.dispatchChecked({
            type: "actor.appearance.set",
            payload: { objectId: "actor-rival", baseColorHex: "#8f2222", surface: "matte" },
        });
        this.dispatchChecked({
            type: "actor.build.set",
            payload: {
                objectId: "actor-hero",
                build: { heightMeters: 1.78, girthScale: 0.95, shoulderScale: 1.05 },
            },
        });
        this.dispatchChecked({
            type: "actor.build.set",
            payload: {
                objectId: "actor-rival",
                build: { heightMeters: 1.95, girthScale: 1.25, shoulderScale: 1.2 },
            },
        });
    }

    private seedPoses(): void {
        for (const objectId of ["actor-hero", "actor-rival"] as const) {
            this.dispatchChecked({
                type: "pose.apply-preset",
                payload: { objectId, presetId: "lower-stand", mode: "merge" },
            });
            this.dispatchChecked({
                type: "pose.apply-preset",
                payload: { objectId, presetId: "upper-stand-natural", mode: "merge" },
            });
        }
    }

    private seedHeroMovementTrack(): void {
        const keyframe = (
            id: string,
            time: number,
            position: [number, number, number],
        ): Record<string, unknown> => ({
            id,
            time,
            value: { position, rotation: [0, 0, 0], scale: [1, 1, 1] },
            easing: "smooth",
            handleMode: "auto",
            inHandle: [0, 0, 0],
            outHandle: [0, 0, 0],
        });
        this.dispatchChecked({
            type: "timeline.set-track",
            payload: {
                trackId: "track-hero-move",
                targetId: "actor-hero",
                kind: "transform",
                policies: {
                    orientation: "keyed",
                    grounding: "ground",
                    locomotion: "sync",
                    strideMeters: 1.4,
                    extrapolation: "hold",
                },
                keyframes: [
                    keyframe("k-hero-0", 0.0, [0, 0, 1.2]),
                    keyframe("k-hero-walk", 3.2, [0, 0, 0.4]),
                    keyframe("k-hero-sprint", 6.6, [0, 0, -2.4]),
                    keyframe("k-hero-end", 10.0, [0, 0, -2.4]),
                ],
            },
        });
    }

    private seedActionSequence(): void {
        const mount = (
            objectId: string,
            assetId: string,
            startTimeSeconds: number,
            durationSeconds: number,
        ): SerializedCommand => ({
            type: "assets.mount",
            payload: { objectId, assetId, startTimeSeconds, durationSeconds },
        });
        // 主角:走 → 冲刺 → 交互(首尾相接)
        this.dispatchChecked(mount("actor-hero", "builtin.action.walk", 0, 3.2));
        this.dispatchChecked(mount("actor-hero", "builtin.action.sprint", 3.2, 3.4));
        this.dispatchChecked(mount("actor-hero", "builtin.action.interact", 6.6, 3.2));
        // 对手:待机 → 受击 → 待机
        this.dispatchChecked(mount("actor-rival", "builtin.action.idle", 0, 3.8));
        this.dispatchChecked(mount("actor-rival", "builtin.action.hit-chest", 3.8, 3.0));
        this.dispatchChecked(mount("actor-rival", "builtin.action.idle", 6.8, 3.2));
    }

    private seedLighting(): void {
        // 情绪编排自带曝光与投影,不必再单独 set-exposure
        this.dispatchChecked({
            type: "lighting.author",
            payload: { mood: "night", subjectId: "actor-hero" },
        });
        this.dispatchChecked({
            type: "object.place",
            payload: {
                id: "light-key-cyan",
                kind: "light",
                transform: { position: [-3.5, 4.2, 2.0], rotation: [0, 0, 0], scale: [1, 1, 1] },
                light: {
                    type: "spot",
                    color: "#6ae2ec",
                    intensity: 18,
                    distance: 30,
                    decay: 1.0,
                    angleDegrees: 60,
                    penumbra: 0.5,
                },
            },
        });
        this.dispatchChecked({
            type: "object.place",
            payload: {
                id: "light-rim-amber",
                kind: "light",
                transform: { position: [2.8, 3.2, -6.5], rotation: [0, 0, 0], scale: [1, 1, 1] },
                light: {
                    type: "spot",
                    color: "#ffa44a",
                    intensity: 28,
                    distance: 30,
                    decay: 1.0,
                    angleDegrees: 55,
                    penumbra: 0.4,
                },
            },
        });
    }

    private seedCameraTake(): void {
        this.dispatchChecked({
            type: "camera.set-shot",
            payload: {
                id: "cam-cinema",
                shot: {
                    position: [-2.0, 0.95, 4.2],
                    target: [0, 0.95, 0.4],
                    fov: 52,
                    lens: { apertureFStop: 2.8, focusDistanceMeters: 3.5 },
                },
            },
        });
        this.dispatchChecked({ type: "camera.activate", payload: { id: "cam-cinema" } });
        const takeKey = (
            id: string,
            progress: number,
            position: [number, number, number],
            target: [number, number, number],
            fov: number,
        ): Record<string, unknown> => ({
            id,
            progress,
            position,
            target,
            fov,
            handleMode: "auto",
            inHandle: [0, 0, 0],
            outHandle: [0, 0, 0],
        });
        this.dispatchChecked({
            type: "motion.create-take",
            payload: {
                id: "take-10s-cinematic",
                startTimeSeconds: 0,
                durationSeconds: 10,
                easing: "smooth",
                program: "replace",
                keys: [
                    takeKey("k0", 0.0, [-2.0, 0.95, 4.2], [0, 0.95, 0.4], 52),
                    takeKey("k1", 0.3, [-1.2, 1.15, 2.6], [0, 1.0, -1.0], 48),
                    takeKey("k2", 0.58, [4.2, 1.65, -0.2], [0, 0.95, -1.2], 58),
                    takeKey("k3", 0.8, [2.8, 2.2, 2.0], [0, 0.9, -1.6], 54),
                    takeKey("k4", 1.0, [1.8, 2.6, 3.4], [0, 0.85, -1.8], 54),
                ],
            },
        });
        this.dispatchChecked({ type: "view.set-mode", payload: { mode: "lens" } });
    }
}

/** playground 入口兼容包装:失败转为用户可见的壳层通知。 */
export async function seedCinematicScene(stores: DirectorDeskStores): Promise<void> {
    try {
        await new CinematicSceneSeeder(stores).seed();
        stores.ui.setSuccessNotice("演示场景已就绪(停在 0 帧,按播放预览)");
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[seed] 播种失败:", message);
        stores.ui.setApplicationNotice(message);
    }
}
