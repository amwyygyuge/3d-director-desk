import js from "@eslint/js";
import prettier from "eslint-config-prettier/flat";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

/**
 * 分层边界(扁平目录版,架构讨论结论):
 * - three/@react-three 只允许出现在下方 THREE_ADAPTER_FILES 白名单与 src/ui;
 *   值对象/领域模型/store 禁碰 three(性能铁律「three 永不进 observable」的机检兜底);
 * - 非 ui 代码禁 import ui/(React 组件归属 src/ui;ui 是组合消费端,方向不可逆)。
 * 新增 three 触点 = 显式把文件加进白名单,让耦合成为可见决策。
 */
const UI_IMPORT_BAN = {
    group: ["../ui/**", "../../ui/**"],
    message: "分层边界:领域/内核代码禁 import src/ui;React 组件应归属 src/ui",
};
const THREE_IMPORT_BAN = {
    group: ["three", "three/**", "@react-three/**"],
    message: "分层边界:three 只允许在适配器白名单(eslint.config.js THREE_ADAPTER_FILES)与 src/ui 中出现",
};
const THREE_ADAPTER_FILES = [
    "src/ui/**",
    "src/loaders/**",
    "src/animation/**",
    "src/capture/**",
    "src/command/**",
    "src/navigation/**",
    "src/core/SceneManager.ts",
    "src/core/measureModelBox.ts",
    "src/pose/PoseLayer.ts",
    "src/pose/SkeletonRuntimeRegistry.ts",
    "src/pose/StaticPoseClip.ts",
    "src/pose/PoseGroundingService.ts",
    "src/assets/AnimationLibrary.ts",
    "src/store/CameraStore.ts",
    "src/timeline/TimelineSampler.ts",
];

export default tseslint.config(
    { ignores: ["dist", "storybook-static", "node_modules"] },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ["**/*.{ts,tsx}"],
        plugins: {
            "react-hooks": reactHooks,
            "react-refresh": reactRefresh,
        },
        rules: {
            ...reactHooks.configs.flat.recommended.rules,
            "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
            "@typescript-eslint/no-explicit-any": "error",
            "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
        },
    },
    {
        files: ["src/**/*.{ts,tsx}"],
        rules: {
            "no-restricted-imports": ["error", { patterns: [THREE_IMPORT_BAN, UI_IMPORT_BAN] }],
        },
    },
    {
        files: [...THREE_ADAPTER_FILES],
        rules: {
            "no-restricted-imports": ["error", { patterns: [UI_IMPORT_BAN] }],
        },
    },
    {
        // 快捷键是装配层(wiring):绑定快捷键 → stores/命令,需要 DirectorDeskStores 类型;
        // 豁免 ui 禁令(类型级依赖),three 禁令保留
        files: ["src/shortcuts/**"],
        rules: {
            "no-restricted-imports": ["error", { patterns: [THREE_IMPORT_BAN] }],
        },
    },
    prettier,
);
