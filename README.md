<h1 align="center">大威天龙画布</h1>

<p align="center">属于你自己的桌面 AI 视觉创作工作台</p>

基于 Infinite Atelier 底座定制，并整合了桥豆麻衣酱的核心思路：在成熟的无限画布上，新增 **Agent 操控画布** 与 **分镜节点** 能力。

## 功能

- 无限创作画布：组织图片、文字、音频、视频和生成结果，节点连线驱动生成。
- 多渠道模型：配置 OpenAI 兼容接口及自定义中转 API（支持 Gemini 格式）。
- 图片生成：文生图、图生图与多图参考；支持裁剪、局部重绘、拆分、放大等图片操作。
- **分镜视表（对齐桥豆麻衣酱分镜表）**：手动添加空白镜头，为每个镜头挑选参考图（从画布图片节点选择或本地上传），编写视频提示词（可用 @1/@2 引用参考图），逐镜头或一键用视频模型生成分镜视频；时长/比例/模型可编辑。
- **分镜图表（对齐桥豆麻衣酱分镜图表）**：宫格编排分镜提示词，宫格列数、分辨率（Auto/1K/2K/4K）、画面比例、模型自由选择；每格可单独生成，一键生成全部分镜图并按宫格排布到画布；每格显示生成预览（点击定位节点）。
- **画布导演 Agent**：右侧任务面板，支持资产规划、稳定 ID 分镜编辑、镜头媒体准备、图片/视频生成和实际图片读取。可增量编排导演台人物、布景、机位、相机路径及物体动画；任务步骤、执行结果与待验收项随项目保存，支持显式继续。
- **执行确认与验收**：已有节点的修改范围、删除、全画布重排及媒体预算由用户确认。图片初始预算为 4 张，首次提交、变更参数、再次生成同一节点或超额均需确认；视频逐次确认。生成返回实际结果节点与成功/失败数量，结束前检查画布与图片验收状态。
- **Skill 库**：可上传 Markdown/文本文件，或让导演把方法沉淀成 Skill。启用技能以目录形式提供、按需读取；Agent 新建的 Skill 默认停用，待用户审核启用。
- **涂鸦节点（新增，来自桥豆麻衣酱 doodle-canvas）**：内置画板（画笔/橡皮/多色/撤销），手绘草图或构图参考，连接到图片节点后作为参考图参与生成。
- **AI 超分（新增，来自桥豆麻衣酱 super-resolution）**：图片工具栏「AI 超分」将图片送编辑模型做仅增强清晰度的超分辨率处理，结果生成到新的已连线节点。
- 导演台：内置 MONOFORM 3D 白模预演工作台（对齐桥豆麻衣酱 director-3d「3D Director」），摆机位、调动作，导出 PNG/MP4 直接回到画布。支持：人物 WASD 游戏式行走（自动转向 + 行走/奔跑循环动画，Shift 奔跑，松键回站立），机位 WASD 观察者式飞行（沿视线方向，Q/E 升降），14 种预设机位（自动识别人物正反面朝向），场景道具白模库（椅/桌/沙发/拱门/楼梯/门/窗/树/车辆/屋顶/植物/建筑/道路），动作预设选中即实时循环预演，关键帧时间轴。工具切换快捷键 1/2/3/4。
- 提示词库与视觉资产：内置提示词卡片、生成记录与本地备份。

## Windows 启动

双击仓库根目录的 `start.vbs`，服务会在后台启动，页面就绪后直接打开默认浏览器，全程不显示命令窗口。`start.bat` 保留为兼容入口，会转交同一启动流程，但 Windows 可能短暂显示初始命令窗口。需要已安装 Node.js LTS，脚本会自动寻找常见安装位置；首次启动会自动安装前端依赖（需要网络），然后打开：

```text
http://localhost:3001/
```

也可以手动运行：

```powershell
cd web
npm install --legacy-peer-deps --include=optional
npm run dev
```

默认端口为 `3001`，开发服务器和预览服务器共用同一端口。需要临时更换端口时，可设置 `APP_PORT`，启动脚本和 Vite 会同步读取。

重复启动会复用已有的画布服务。后台日志位于 `web/launcher.log`、`web/server.log` 和 `web/server-error.log`；启动失败时会显示错误提示。

## 使用说明

1. 右上角配置：添加 API 地址和 Key，为渠道拉取模型，分别选择图片模型和文本模型（Agent 用）。
2. 工具栏「分镜」按钮创建分镜节点，点击节点打开编排面板，填主题和镜头后点「生成分镜画面」。
3. 右下角机器人按钮打开画布导演，直接下指令，例如："把这份剧本编成 4 个分镜，先准备画面节点"；检查规划后再要求生成并确认预算。
4. 配置、画布、资产默认保存在当前浏览器本地。执行模型请求时，相关文本、图像及 API 鉴权信息会发送到用户配置的接口。

首次使用时渠道和默认模型为空，请添加自己的渠道、API Key 和模型。渠道设置使用本应用独立的浏览器存储；删除全部渠道后，关联的 API Key 和默认模型也会清空。自定义协议可通过模型脚本配置。

### 图片自动尺寸

- OpenAI 格式适配采用像素尺寸提交。尺寸为 Auto 且明确选择分辨率时，1K / 2K / 4K 分别提交 `1024x1024` / `2048x2048` / `3840x2160`；4K Auto 的回退构图为横屏，面板显示对应像素值。分辨率也为 Auto 时才采用服务端默认尺寸。
- Gemini 原生适配对支持分辨率的模型保留自动比例，并独立提交 `imageSize`。手动填写的像素尺寸保留原值。
- 内置图片脚本模板转发尺寸、质量及对应接口参数；已有用户脚本不会被覆盖。自定义脚本可使用 `params.resolution`、`params.ratio` 和 `params.geminiImageConfig`。
- `npm run test:image-settings` 覆盖节点和渠道配置、文生图、参考图编辑及脚本模板的实际请求体，所有请求均为模拟。

### Agent 边界

- 工具调用接口支持 Responses 与 Gemini 格式；视觉验收需要当前文本模型同时支持图像输入。
- 普通对话模式不提供工具。附件最多 8 个，单文件 200 KiB / 24,000 字符，总正文 96,000 字符；附件正文是数据，不是操作授权。
- 每轮任务最多 24 次模型调用、80 次工具调用。失败媒体请求也计入本轮额度；停止等待不保证已提交的远端请求停止处理或计费。
- 继续任务会重新读取画布，保留步骤和待验收项，重新申请修改权限与媒体预算。现有画布撤销仍按画布历史工作，不是跨画布、导演台与远端生成的原子回滚。
- RunningHub 当前支持入口和状态读取，远端执行需使用工作流节点面板；导演台录制、导出仍在导演台界面操作。
- 自动验收检查结构、生成状态和图片是否送入视觉模型；构图、连续性及创作质量仍需要模型判断和用户复核。

### Agent 回归测试

```powershell
cd web
npm run test:agent
npm run typecheck
```

测试使用隔离存储、模拟模型和媒体结果，不提交真实媒体请求。浏览器测试页为 `scripts/fixtures/agent-director.html`，仅允许在独立的本地端口 `3011` 运行，以隔离测试配置。

## 新增代码位置

```text
web/src/components/canvas/canvas-agent-panel.tsx    任务面板、审批、文件附件与显式继续
web/src/components/canvas/skill-library-dialog.tsx  Skill 库管理弹窗（上传/新建/编辑/启停）
web/src/stores/use-skill-store.ts                   Skill 库存储（localStorage）
web/src/lib/canvas/agent-tools.ts                   Agent 工具定义与执行器（含 skill/读节点工具）
web/src/lib/canvas/agent-run.ts                     任务状态、修改范围与媒体预算
web/src/lib/canvas/agent-execution.ts               工具循环、去重、停止与结束验收
web/src/lib/canvas/agent-context.ts                 历史、附件、技能目录与上下文边界
web/src/lib/canvas/director-agent.ts                导演台增量场景与动画编辑
web/src/stores/use-agent-panel-store.ts             Agent 面板状态
web/src/components/canvas/nodes/storyboard-node.tsx 分镜节点（注册/卡片/面板）
web/src/components/canvas/nodes/doodle-node.tsx     涂鸦节点（注册/卡片/画板弹窗）
web/src/services/api/image.ts                       新增 requestToolChat 工具调用出口
```

## 发布到 GitHub 前

在项目根目录运行（需要 Node.js 22 或更新版本、Git）：

```text
node web/scripts/prepare-github.mjs --audit-only
node web/scripts/prepare-github.mjs
```

第一条命令检查待上传文件；第二条在项目旁生成带时间戳的独立源码目录，并输出 `UPLOAD_DIRECTORY`。检查报告放在该目录旁，不会上传或修改原项目的 Git 状态。发布时使用这个新目录，不要直接压缩整个开发目录。

- `.env.local`、日志、依赖、测试截图、配置导出和完整备份会按 `.gitignore` 排除。API Key 在软件的渠道设置中填写。
- `infinite-canvas-config.json` 和 `infinite-canvas-backup-*.zip` 包含 API 配置，应作为私密文件保管。
- 浏览器中的画布、历史记录和已填写的渠道配置不会随源码目录复制；自行导出的文件需另行检查。
- 自动检查会查找本机环境密钥值、常见凭据格式、个人路径和邮箱，但不能代替人工审核。公开前检查图片、模型、提示词和素材授权。
- 此工具不检查已有 Git 提交历史；上传副本不包含 `.git`。后续提交时也需检查提交内容和作者姓名、邮箱。

工具自测：`node web/scripts/test-prepare-github.mjs`。

## License

代码许可见 [LICENSE](LICENSE)，基于 GuiYi-Xi 的 infinite-atelier 项目定制。
