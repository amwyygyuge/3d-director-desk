/**
 * AI 工具描述登记表(AI 接入桥的文案层)。
 *
 * 独立登记的理由(纪律:AI 桥不入侵功能模块):描述是 agent 视角的文案,不属于命令的领域语义,
 * 功能模块只登记契约(type/permissions/payload),描述集中在此处按 type 字符串键控。
 * 漂移围栏在 AgentBridge.listToolSchemas():能力清单与描述表对账,缺描述 dev 即抛。
 *
 * 文案口径:动宾短句,写给 LLM 做工具选择;字段级细节不重复——契约 payload 已携带。
 */
export const AGENT_TOOL_DESCRIPTIONS: Record<string, string> = {
    // 布景
    "object.place": "放置场景对象(模型/机位对象/灯光)到指定 transform;模型优先改用 assets.place",
    "object.move": "更新对象 transform(位移/旋转/缩放,全字段覆盖式写入)",
    "object.remove": "删除对象;被运镜注视引用时会返回结构化选项",
    "scene.clear": "一次清空场景全部对象:连带撤掉引用它们的运镜与 Program 排期,一步可撤销;场景已空时结构化拒绝",
    "object.place-relative": "语义摆位:以导演相机视线为参考系,把对象放到锚点的左/右/前/后(包围球表面间距)或面朝锚点",
    // 机位
    "output.set-format": "设置项目最终输出画幅；预览安全框、PNG、MP4 与同框断言共用该中心裁切口径",
    // 演播室档位(工程级,随文档往返)
    "studio.set-grid-size": "设参考地板边长(2 至 100 米);地板是空间基准,会出现在截图与成片里",
    "studio.set-render-quality": "设渲染画质档:high 满像素比+抗锯齿 / performance 限像素比换帧率;截图与 MP4 同受影响",
    "studio.set-frame-rate-visible": "开关视口右上角的真实渲染帧率读数(观测用,不入成片)",
    "studio.set-output-grid-visible": "开关成片安全框内的九宫格构图辅助线(编排辅助,不入成片)",
    "studio.set-exposure":
        "设成像曝光倍率(0.2 至 3,缺省 1):压暗做低调、提亮做柔和;" +
        "偏了先用 capture.measure-frame 读裁切占比再调,别靠截图目测",
    "studio.set-environment-lighting":
        "开关环境光照(IBL,程序化环境无外部资源):开启后金属度/粗糙度才参与成像,材质质感与反射靠它",
    "studio.set-shadows": "开关实时投影(shadow map):接地感的主要来源,有每帧深度图成本故缺省关",
    "studio.set-floor-color":
        "设地板颜色(6 位十六进制):画面面积最大的一块,决定人物反差与整体影调;" +
        "按影调排布的色名词表查 studio.get,需要它可见时同时开 studio.set-floor-surface",
    "studio.set-floor-surface":
        "开关实心地面:承载地板颜色与投影接收面,消掉「人偶悬在网格虚空里」的观感;有全屏着色成本故缺省关",
    "camera.set-shot":
        "保存或覆盖静态机位(position/target/fov);不给 lens 则保持原镜头(光圈/对焦距离不会被重置)," +
        "改镜头走 camera.set-lens;景别构图优先改用 camera.frame-subject",
    "camera.activate": "切入指定机位视角(机位须已存在)",
    "camera.deactivate": "退出机位视角,回导演自由视角",
    "camera.remove-shot": "删除机位,连带清理其运镜片段与 Program 排期",
    "camera.frame-subject": "按景别(大远景~大特写七档)为一个或多个被摄体生成同框机位(联合包围球定距)",
    "camera.check-framing": "视锥同框断言:逐被摄体返回 inFrame 与 NDC 边距,负值即出画——布景验收不截图",
    "camera.set-lens":
        "按摄影语言设镜头:focalLengthMm 焦距(24 广角/50 标准/85 人像特写,写入即换算 fov,不另存)、" +
        "apertureFStop 光圈 f 值(越小景深越浅)、focusDistanceMeters 对焦距离(null=自动对焦到注视点)。" +
        "只改给出的字段;焦距围栏由 fov 围栏按输出画幅换算,读回见 camera.get-pose 的 liveFocalLengthMm",
    "scene.stage": "布景配方一键成组:对峙/并肩/三角/纵深,槽位绑定实体即可,距离按包围球半径自适应尺度",
    "scene.set-identity": "为场景实体设或清除叙事身份(主角/反派/配角/道具/布景 + 稳定标签)，让后续自然语言引用可消歧",
    // 运镜
    "motion.create-clip": "创建运镜片段(完整 CameraKey 序列,不落 Program)；时间落点按工程帧率量化",
    "motion.create-take":
        "推荐入口:一次创建运镜片段并落 Program 输出;时段冲突返回结构化 options；时间落点按工程帧率量化",
    "motion.set-clip-range":
        "重定时运镜片段(起止/时长),轨迹形状不变;跟随态 Program 片段一并移动；时间落点按工程帧率量化",
    "motion.set-key": "落一枚镜头关键帧(同 id 覆盖);视口摆位/时间轴打点/AI 共用写入口",
    "motion.move-key": "移动关键帧的 progress,调整段间节奏(不改变轨迹形状)；时间落点按工程帧率量化",
    "motion.remove-key": "删除一枚镜头关键帧",
    "motion.set-key-handle": "调整关键帧贝塞尔手柄(需先把 handleMode 切到 manual)",
    "motion.reset-key-handles": "重置关键帧手柄为自动求解",
    "motion.set-clip-easing": "设整段运镜缓动:linear 匀速 / smooth 起落加减速",
    "motion.set-focus": "设片段注视目标(世界点或场景对象),非空时接管各 key 的 target",
    "motion.replace-clip": "整片段覆盖写入(片段须已存在);重写全部关键帧的聚合操作以它回滚",
    "motion.bind-follow":
        "把片段绑到模型上跟拍:关键帧改为相对主体的坐标,主体走到哪镜头跟到哪;frame=world 只跟位移、heading 随主体转身;绑定在关键帧时刻不改变画面",
    "motion.unbind-follow": "解除跟拍:关键帧烘回世界坐标,画面同样不跳",
    "motion.set-follow-params": "调跟拍参数(参考系/锚点/滞后/平滑);换主体请重新绑定",
    "motion.remove-clip": "删除运镜片段及其 Program 排期",
    "motion.author":
        "语义运镜编译:推近/拉远/摇/俯仰/横移/升降/环绕/定镜,产物为可再编辑关键帧;环绕/螺旋可传 orbit.degrees、direction 与 radiusMeters(固定圆半径,米)；时间落点按工程帧率量化",
    "motion.quick-author":
        "按被摄体+景别+运动一步生成运镜(机位定距与关键帧一次到位);带 follow.approach(back/front/left/right)时直接产出跟拍片段;环绕/螺旋可传 orbit.degrees、direction 与 radiusMeters(固定圆半径,米)；时间落点按工程帧率量化",
    "program.set-clip": "把运镜片段排入 Program 时段(同一时段只允许一个机位输出)；时间落点按工程帧率量化",
    "program.remove-clip": "从 Program 移除片段(运镜片段本身保留)",
    "motion.preview.enter": "进入片段预览,playhead 不在片段内时自动 seek 到片段起点；时间落点按工程帧率量化",
    "motion.preview.exit": "退出片段预览",
    // 视图
    "view.set-mode": "切换导演视角/镜头视角",
    "view.set-sweep-path": "开关跟拍片段的世界扫掠路径预览(排查用,默认关)",
    "view.frame": "导演视角取景到场景内容(无内容时回默认位姿)",
    "view.set-shell-mode": "切换导演台壳层显示模式(编辑/演示等瞬态视图状态)",
    "view.set-shell-hidden": "显隐导演台编辑壳层,不改变场景或成片数据",
    "view.reset": "复位导演视角到初始位姿",
    // 时间轴
    "timeline.add-key": "时间轴加走位关键帧(轨道不存在则按 targetId 创建)；时间落点按工程帧率量化",
    "timeline.move-key": "移动时间轴关键帧的时刻；时间落点按工程帧率量化",
    "timeline.remove-key": "删除时间轴关键帧;轨道清空后保留",
    "timeline.set-key": "整体替换时间轴关键帧；时间落点按工程帧率量化",
    "timeline.set-track": "整体替换对象走位轨；时间落点按工程帧率量化",
    "timeline.retime-track": "仿射重定时整条走位轨；时间落点按工程帧率量化",
    "timeline.set-key-easing": "设时间轴关键帧缓动(linear/smooth)；时间落点按工程帧率量化",
    "timeline.set-duration":
        "严格设时间轴总时长(秒),不截断已有内容；受阻时返回贴合内容/整轴缩放选项；时间落点按工程帧率量化",
    "timeline.fit-duration": "把工程时长收紧到最后内容末端(空工程保留一帧)；不改轨道、运镜或 Program",
    "timeline.scale":
        "按比例整体重定时走位关键帧、运镜片段、Program 片段、标记、时长与播放范围；时间落点按工程帧率量化",
    "timeline.restore-scale": "恢复整轴缩放前的内部快照，仅供撤销回放使用",
    "timeline.set-playback-range":
        "设播放/循环/缺省导出的入出点，必须在工程时长内且至少覆盖一帧；时间落点按工程帧率量化",
    "timeline.set-frame-rate": "设工程帧率(1 至 240 fps),只影响后续时间落点，不重排既有节奏",
    "timeline.restore-tracks": "整体恢复时间轴轨道(撤销删除/文档导入的配套回放)；时间落点按工程帧率量化",
    "timeline.add-marker": "在时间轴新增章节或注释标记；时间落点按工程帧率量化",
    "timeline.move-marker": "移动时间轴标记时刻；时间落点按工程帧率量化",
    "timeline.remove-marker": "删除时间轴标记",
    "timeline.set-track-policies":
        "设走位轨朝向、贴地、步频与跨度外取值策略;extrapolation: hold(默认,走完停在终点、开演前站在起点)/ rest(时段外回到对象自身变换)",
    // 动作与播放
    "action.mount":
        "给对象挂载动作并按时间轴排期;startTimeSeconds/durationSeconds/attackSeconds/releaseSeconds/fillPolicy 可选。" +
        "省略起点时:播放头处已被某段占用则**接到那一段的演出末端**(连续占用一路顺延),空着才落在播放头;" +
        "若 clip 放不入剩余时间轴则向前贴合。重叠只按演出段判定——回收段(release)可被下一段抢占," +
        "故「走完立刻倒地」这类紧贴排期合法;骨骼兼容性预检不过返回结构化诊断与可用动作",
    "action.set-range":
        "调整对象某段动作排期的开始时间、演出时长、进入时长与回收时长;多段序列下传 performanceId 定位改哪一段(缺省改首段),段 id 见 scene.describe 的 actionSequence.performanceId;显式改时段会解除走位轨对齐。时段与 clip 时长不等时如何铺满由 fillPolicy 决定(见 action.set-fill-policy),改时段不改该策略",
    "action.set-fill-policy":
        "设某段动作排期的时段填充策略:repeat(按原速重复,拉长时段=演更久)/ hold(按原速播一次后停末帧,拉长=保持终态更久)/ stretch(拉伸铺满,拉长=慢放);传 null 则跟随资产循环语义(可循环→repeat,单次→hold)。多段序列下传 performanceId 定位(缺省改首段);只改填充方式,不动段的起止",
    "action.unmount":
        "卸载对象**全部**动作,骨骼回常驻基础姿势(未设置则回绑定姿态);只删一段请用 action.unmount-performance",
    "action.unmount-performance":
        "卸载对象的**一段**动作排期(按 performanceId 定位),其余段不受影响;段 id 见 scene.describe 的 actionSequence.performanceId",
    "action.preview.play": "局部预览指定对象的已挂载动作,不驱动全局 playhead",
    "action.preview.pause": "暂停局部动作预览",
    "action.preview.seek": "定位指定对象局部动作到指定秒",
    "transport.play": "播放全局时间轴",
    "transport.pause": "暂停播放,playhead 停驻当前时刻",
    "transport.stop": "停止并回播放入点,清除时间轴采样、恢复实体权威变换",
    "transport.seek": "定位 playhead 到指定秒(双端钳入播放范围)；时间落点按工程帧率量化",
    "transport.set-loop": "播放范围循环开关(编排期反复评估节奏用)",
    // 人偶
    "actor.appearance.set": "设人偶外观(肤色/各表面材质参数)",
    "actor.build.set": "设人偶体型参数(身高/肩宽/围度等,范围由命令校验)",
    "actor.build.apply-preset": "套用体型预设;预设目录先查 actor.presets.list",
    // 姿势
    "pose.set-bone": "设常驻基础姿势的单根骨骼旋转;骨骼名先查 pose.bones.discover",
    "pose.replace": "整体替换常驻基础姿势快照(多骨骼一次到位)",
    "pose.apply-preset": "套常驻基础姿势预设;目录先查 pose.presets.list,动作播放时仍会保留未覆盖骨骼",
    "pose.preset.save": "把当前姿势存为自定义预设",
    "pose.preset.remove": "删除自定义姿势预设",
    "pose.preset.restore": "恢复内置姿势预设(撤销对它的覆盖/删除)",
    "pose.clear": "清除常驻基础姿势,回绑定姿态",
    // 灯光
    "scene.set-lighting-mode": "切灯光模式:studio 兜底布光 / custom 自定义",
    "lighting.author":
        "打光情绪一步落地(聚合命令,一步撤销):neutral 中性均匀 / low-key 低调暗部 / " +
        "silhouette 逆光剪影 / golden-hour 黄金时刻 / night 夜景冷调。" +
        "灯位按被摄体包围球定尺(给 subjectId 更准,缺省取全场景模型),同时设好配套曝光与投影。" +
        "只接管自己产出的灯,作者手放的灯不动;效果用 capture.measure-frame 断言",
    "light.adjust":
        "更新自定义灯光的可序列化参数;先用 lighting.get/list 读取对象和灯型," +
        "可说的灯色词表查 lighting.presets.list(色温轴:钨丝灯/日光/月光…)",
    // 采集
    "capture.frame": "截图当前预演画面(保留地板网格，编辑辅助物不入镜);异步产物按 requestId 对账",
    "capture.measure-frame":
        "画面度量断言(不截图):平均亮度/影调层次/高光与暗部裁切占比/主体与背景亮度分离度。" +
        "曝光偏了调 studio.set-exposure;层次太平开 studio.set-shadows 或换地板色;" +
        "分离度接近 0 说明主体没从背景跳出来(负值是剪影/逆光,属有效电影语言)",
    "capture.video":
        "按工程帧率导出 MP4 参考视频(缺省当前播放范围，起点/时长可显式覆盖；source=viewport 明确导出当前编辑视角);异步产物按 requestId 对账",
    "capture.video-stop": "在当前帧边界结束 MP4 导出并交付产物",
    "capture.video-cancel": "放弃正在导出的 MP4 参考视频",
    // 演示与文档
    "desk.enter-presentation": "进入演示模式(纯净画布)",
    "desk.exit-presentation": "退出演示模式",
    "desk.import-document": "导入整桌文档(替换式清空重建,动作按 URL 异步恢复,可撤销)",
    "assets.place": "按资产目录条目放置模型(格式/URL 由条目携带,AI 不猜)",
    "assets.mount":
        "按资产目录条目挂载动作(clip 置备 + 骨骼预检一体);目录条目带 loopMode,可用 startTimeSeconds/durationSeconds/attackSeconds/releaseSeconds 指定时间轴排期",
    // 查询
    "scene.describe": "场景全貌:每实体的 transform/装载态/世界包围盒/已挂载动作",
    "assets.list": "资产目录发现,可按 kind/category 过滤;条目带许可与骨骼家族",
    "camera.get-pose": "生效相机位姿:live 实际值与 motionSampled 运镜期望值并排,运镜断言用",
    "output.get-format": "当前项目最终输出画幅比例",
    "studio.get":
        "当前演播室档位:地板边长(含合法区间)、渲染画质档、帧率读数与九宫格显隐," +
        "并给出按影调排布的地板色词表(吸光黑→高调白)",
    "camera.list-shots": "机位表与当前激活机位",
    "motion.get": "运镜编排全量:片段/关键帧/Program 排期/视图模式/预览态",
    "timeline.get-document": "时间轴文档:时长/轨道/关键帧全量",
    "transport.get-state": "播放态:当前时刻/是否播放/循环/时长",
    "lighting.list": "灯光清单(快照)",
    "lighting.get": "单个灯光详情",
    "lighting.presets.list": "灯光发现面:按色温排布的灯色词表 + 打光情绪配方清单",
    "pose.bones.discover": "骨骼发现:姿态编辑前必查,确认骨骼家族与可动骨骼",
    "pose.get": "当前姿势快照(全骨骼旋转)",
    "pose.presets.list": "姿势预设目录(内置+自定义)",
    "actor.get": "人偶画像:外观与体型参数",
    "actor.presets.list": "体型预设目录",
    "desk.export-document": "导出整桌 JSON 文档(存档/接管/全量感知兜底)",
    "desk.inspect":
        "低上下文导演台感知：brief 返回角色/量纲索引，focused 返回指定对象的几何状态，full 才返回完整工程；度量默认不用截图",
    "program.review": "成片巡检与镜头单:返回播放范围内的 Program 空档、缺失机位/运镜来源及可定位镜头列表",
};
