# 原有被毛与原生梳理：后续对照

当前工作室仍使用已经恢复 342 簇原耳毛的挪威森林猫，现已按用户要求恢复完整程序被毛并精修其生成方式（见 [程序毛修复](CAT-PROCEDURAL-GROOM-REPAIR.md)）。**本页的光学候选、包络候选及其他来源的 groom，没有替换正式模型。写实短毛和长毛目标仍未完成。**

## 先排除无效的修整方向

### 原毛面光学

新增可撤销的 `lib/cat-native-coat-optics.ts` 研究适配器，借原纹理做方向性反射与弱 sheen；眼睛排除，不增加顶点、毛束或灯光。`lib/cat-native-coat-moments.ts` 在纹理缩小时平均置信加权双角度，防止方向符号翻转；片元通过真实 UV Jacobian 转换方向，不把 UV 的二维角度当世界角度。

真实网页对照为 `artifacts/native-coat-optics/round01/`：原材质、零强度控制、顺毛／跨毛粗糙轴、单独 sheen、组合，以及置信场诊断。各向异性 0.45、sheen 0.06 是实验数值，不是猫毛实测参数。十四张实际画面着色器均能运行，恢复材质后原资源未被释放；九项真实 GLTF 材质所有权检查通过，moment 转换另有十九项检查。

独立 QA 未建议采用：顺毛轴的变化较可见，但没有足够证据说明更真实；其他候选差别很小，胸口硬沟没有解决。表面 GGX／Charlie sheen 不具备真实纤维的髓质散射、透射和毛层体积，不能把它称作物理猫毛模型。

### 原表面短／长包络

`artifacts/native-envelope-study/` 的九张同灯同镜 Blender 图仅修改原有顶点的局部体积，不增加碎毛。短毛最大改动约 3 mm，长毛约 7.18 mm，单位采用模型标定假设；原耳毛、脸和眼睛保持。结果仍主要是平滑实体增厚，胸口出现硬围兜，长尾没有自然长毛边缘。保留为低频毛型研究，未采用为正式短／长毛。

### 硬纹的归因

`artifacts/native-coat-optics/form-diagnostic-gpu/` 对照原图、关闭 normal、再以 18% 线性灰替换身体 albedo。实际 GPU 读数确认 normalScale 为零；灰模 diffuse 为约 `[0.18,0.18,0.18]`、颜色贴图不参与。三组几何、相机和灯光保持。

关闭 normal 后胸部大量毛纹仍在，去颜色贴图后才大幅消失，说明原毛纹很大部分已经在 albedo 中；下巴团块及胸部低频边界仍属于形体问题。不能把它们全归为 normal，也不能通过统一降低 normal 强度解决；那样反而会损失鼻梁和嘴垫细节。本轮没有实施粗细 normal 滤波。

## 核实真正已有的 groom

以下是此前取得的其他 Blender 候选，不是当前挪威森林猫 GLB 中隐藏着的全身体毛。

| 来源 | 实际已有内容 | 本轮结论 |
| --- | --- | --- |
| Kitten | 9,470 条已编辑体毛导引，渲染 children 设置 250；另 233 条须，原密度／长度／成束权重和 Hair BSDF | 完整原稿可作为梳理、覆盖及转换保真的本地参考。设置数量不能直接当作实测最终发丝数。 |
| Ginger | 身体 5,000、腿 1,914、头 1,811 条导引；children 设置分别 50／20／100，另有独立胡须 | 旧转换只保留父毛并压成四点交叉条带，不足以代表原稿质量。 |
| Fishy Cat | 548 条已编辑短毛导引，children 设置 888；39 条长须 | 官方 CC0，但实际是卡通猫头和细颈，没有四肢身体、骨架和形态键，不能作为完整写实母模。 |

Kitten 的 `artifacts/native-groom-reference/kitten-groom-close-on.png` 和 `...close-off.png` 是同光同镜的 512px／32 样本近景，景深、降噪、运动模糊和合成均关闭；只切换原体毛系统的渲染可见性。开启时有连续贴体毛层，关闭时露出光滑皮面，证明原生 groom 确实参与渲染。开启图仍有明显采样噪声及较暗区域，不能当作真实猫毛的绝对真值。

Kitten 兼容副本的渲染 children 也仍为 250。旧脚本试图设置另一个属性名为 40 并未命中实际设置，不能把它写成已经降低渲染密度；只有其视口 children 设置发生过变化。Ginger 的父毛条带转换损失则有独立数据支持。这两件事应区分。

Kitten／Ginger 维持本地离线参考范围，不把 Royalty Free 当作 CC0。Fishy 原文件保存在 `assets/source/fishy-cat/`，官方许可、ZIP CRC、原始 SHA 和只读检查已记录；未改写原 `.blend`、未替换应用模型。参考渲染主动关闭了旧场景的合成／FileOutput。

## 论文采用边界

[NeuralFur](https://neuralfur.is.tue.mpg.de/) 的脱毛体、贴附毛根和方向约束有助于解释为什么不能在已有厚毛包络外继续堆高散毛。[AnimalLift](https://arxiv.org/html/2609.09513v1) 的同源拓扑、UV 局部表示和形变绑定支持保留原导引结构；本项目没有因此声称已训练或复现这两个系统。

作者实际发布情况已单独核对：`artifacts/paper-groom-release-check/`。AnimalLift 有可单项读取的猫毛 UV 数据，但不是 CC0 可修改母模；NeuralFur 的完整重建结果目录和授权尚未确认。没有安装 CUDA 环境、下载大型权重或以论文截图冒充本地三维结果。

## 已实现直接编辑原生导引

先在 Kitten 原稿中只延长一束已有毛 20%，保存独立副本并重新打开：该束弧长比约 1.2，原根键不动，其余 9,469 束、胡须及参数均保持。Blender 3.6 实际支持写入 `co_local` 与 `co_object_set`；未评估状态的根局部坐标不能当作世界坐标。

随后制作了两个独立、可继续用 Blender 编辑的副本，原文件不改：

- `assets/authored/native-groom-kitten-short.blend`：把原有 9,470 束体毛的弧长缩为约 0.6 倍，保留原方向和归一化曲形。
- `assets/authored/native-groom-kitten-long.blend`：仅调整 1,068 束原导引，包括胸、颈、尾以及少量躯干；其余 8,402 束保持，保护头脸、脚掌、腿和两条原有根分析异常导引。延长比最高约 1.85。

供直接打开查看的版本是 `native-groom-kitten-short-editor.blend` 和 `native-groom-kitten-long-editor.blend`，建议使用本项目的 Blender 3.6。它们开启原毛发／胡须的视口显示、选中身体并整理取景；视口 children 设为 8 以便查看，渲染参数仍为 250。保存重开核验确认毛发、根、骨架、形变、材质和所有权重与对应研究版一致。这是视图可用性调整，不是又一轮毛发美术改动。

两副本保存后重新打开，56,383 个原导引键的数量保持，所有原根键、胡须、几何、UV、权重、24 个原 shape key blocks、167 根骨骼及姿态保持。原渲染 children 参数仍为 250；这只是配置保持，不能冒充已经测量过最终渲染纤维数。最初根分析的两条高距离样本只保护未修改，并未用最近点偷偷重绑，也不宣称全体毛根与世界皮肤距离为零。

`artifacts/native-groom-edit/renders/` 保存原稿、短版、长版的胸／躯干近景／尾部九张同灯同镜真实图。短尾的毛轮廓收紧，长尾和胸部是原纤维延长，而非不透明网格膨胀；原始成束重复感、较暗反射和低样本噪声仍可见。这是有效的原生毛发编辑与保真基准，尚不是已经接入网页或达到 C 的成品。

随后只对长毛副本尾域的 53 个原成束权重作连续衰减，其余导引、骨蒙皮和密度组保持，并做 128 样本的固定尾部配对。改动真实存在，但重复斜向羽束与尾端分束仍在，独立 QA 未建议替换长毛研究基准。`long-refined` 另存保留，不能把它写成已解决长尾问题。

## 网页数据保真准备

新增 `lib/cat-native-curve-renderer.ts`，只显示输入中已经存在的曲线，不重新种毛。它用二维浮点纹理保存原点，在 GPU 求曲线位置、切线和物理横向宽度，复用原毛发合成器。保留旧 9 点格式，并增加 17 点有效前缀格式：每条分别记录有效点数，短曲线重复真正末端补齐存储，不连接错误的零点。旧打包／资源检查保持，新前缀另有 17 项 CPU 检查。

`artifacts/native-curve-renderer/gpu-probe/` 与 `gpu-probe-native17/` 对两种布局分别做实际位置、颜色、MRT、前景深度遮挡及相机转动检查，8 点／17 点混合输入也通过。独立 CPU 曲线几何与 GPU 显示的前视图逐像素一致。它们只是合成技术探针，不是实际猫毛美术或变形验收。

首次真实 GPU 检查捕获了 Three 0.186 的颜色 varying 类型变化；已修正，并保留首次失败记录。尚未实现真实 groom 的网页保真验收、骨骼／捏脸输运或真实毛发 GLB 导出，不能把几十个着色器模板顶点作为完整毛发导出。

真实 `co_hair` 小探针已确认必须读取同一评估场景中的 particle system，返回值为世界坐标；读取未评估原对象会得到无效全零，再乘一次物体矩阵也会产生偏差。父毛观察到 17 个有效点，子毛的有效前缀各不相同，越界返回零；因此不能盲采固定长度，把尾端接向原点。实际缓存数、原生前缀和坐标检查记录在 `artifacts/native-groom-edit/co-hair-cache-probe.json`；完整捕捉协议在 `artifacts/native-curve-renderer/CAPTURE-PROTOCOL.md`。

本轮已私下捕捉原稿视口中的 18,940 条真实缓存曲线（9,470 父毛与 9,470 视口子毛），原始世界坐标、每条 4–17 个有效点原样保存；余槽只重复真实末端，无重采样。独立读取二进制确认有限值、数量、哈希与末端补齐正确。此数据属于原视口参数 1 的缓存，不能当作原渲染参数 250 的全量毛。初次捕捉时尚无颜色、物理半径与静态皮肤，后续已逐项补齐并开始实际网页验证，见下节；数据仍仅用于本地保真研究，未放入网页默认或公开模型目录。

后续重点是保留已有 groom 的完整层级，检验转换前后的覆盖、方向、半径、毛色和体积。先在原生三维文件中通过，再处理网页显示预算；不再把增加碎毛数量当成主要优化手段。

独立 QA 位于 `artifacts/native-coat-study/qa-native-surface-envelope/`，包含 `SURFACE-QA.md`、`ENVELOPE-QA.md` 和 `FORM-GROOM-QA.md`。功能、数学及资源检查均不替代写实外观验收。

原生编辑本轮的汇总入口为 `artifacts/native-groom-edit/final-validation.json`，原稿长短对照与尾部候选的独立判断分别在同目录 `QA.md`、`REFINED-TAIL-QA.md`。正式网页仍是上一轮恢复耳毛的版本，不能把这些离线研究成果描述成网页已经换好完整短／长毛。


## 原始毛发进入网页的静态基准

本轮沿用同一批原始毛根和缓存路径，没有另种根或复制毛束。已补同帧、同 VIEWPORT 评估的静态身体、眼和牙快照；世界位置和法线经独立 GLB 解码核对。快照不带可用的骨架／捏脸输运，不能冒充另一个已经能捏脸的完整角色。

半径依据 Blender 3.6.23 实际导出公式，而非看图调粗细：RNA 的 root/tip/scale 是直径，Cycles 除二；弧长与缩放各只计算一次。Kitten 根半径约 0.02735 mm，源码及 15 项验证在 `artifacts/native-curve-radii/`。原有 children 开启时 Cycles 只画 children，因此本基准只画 9,470 条真实子毛，保留父毛作为来源记录，不把父子叠加提高密度。

原颜色图也不能用单一毛根色替代：根部 ColorRamp 约 0.06016，沿 Intercept 升到 1。按真实 object 弧长在每个原缓存点执行原颜色链，保存 `[18940,17,3]` scene-linear RGB；HDR 超过 1 的值保持，不做重复 sRGB 转换，61,373 个余槽精确复制真实毛尖。独立 shader 小样最大线性误差约 0.000036，来源是高频 UV Noise 在不同烘焙图布局中的浮点差。数据与限制在 `artifacts/native-groom-capture/kitten-original-viewport/per-point-color-metadata.json`。

新增可选逐点颜色布局，旧 9 点、17 点固定颜色格式逐字节兼容。76 项 CPU 检查、类型检查和生产构建通过；逐点颜色、旧 9 点、旧 17 点三组实际 WebGL 探针各 5 帧通过，独立 CPU 几何参考的前视图 RGB 差均为零。这些证明数据消费路径，不是写实外观通过。

首批真实 6 帧位于 `artifacts/native-groom-capture/web-native-original-child1/`，独立 QA 拒绝外观采用。GLB 导出把原皮肤的透明粉色叠加图误当完整不透明底色，又把灰度 displacement 误当 tangent normal；眼睛的原闭包未转为有效材质，呈白色。不能把这些失败归因于原稿缺毛，也不能靠加毛遮住。原始帧与报告保留，后续修正使用独立快照与输出目录。

新的对照脚本 `scripts/probe-real-native-groom.mjs` 在私有路由内读取文件，原 RF 资产不放入 public。身体和原曲线只做一次 `[x,z,-y]` 转换后共享归一化；body-only 与开启毛发保持同一 MRT 路径，用实例数 0／9470 控制。物理半径不放大、LOD 宽度倍率为 1；抗锯齿仍有 0.45 像素最低光栅支撑并用 coverage 抵偿，需明确视为采样近似。VIEWPORT children=1 不代表原 render children=250 的完整覆盖。原两 Hair BSDF、连续渐变、毛发阴影与变形绑定仍需独立处理，当前正式模型不变。


修正版 `body-pbr-static.glb` 只补原节点图烘焙后的材质与图片引用；旧 BIN 前缀、mesh/accessor/node/scene 和原 bufferView 逐字节保持，原文件未改。原底色混合、粗糙度对比度及原 Bump 到 tangent normal 的转换已补回；眼睛沿用原图与可映射的 Glass 参数，不手配新颜色。原 Subsurface=1 与依赖光线路径的眼部透明仍是明确缺项，RGBA8 量化误差分别记录。

修正后的 6 张实际网页图在 `artifacts/native-groom-capture/web-native-original-child1-pbr/`：body-only 与 ON 均为同一 weighted MRT，实际曲线实例数分别 0 与 9,470。原灰白虎斑与眼图恢复；原低密度毛参与显示，但胸腹散线、黑亮眼反射与完整覆盖仍不合格，未接入默认。汇总入口 `artifacts/native-groom-capture/native-transport-progress.json`，不得据类型／构建或 GPU 技术通过将写实目标标为完成。
