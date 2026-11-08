# 图像驱动的局部参数校准 POC

这是一个**实际运行 Blender 的离线几何测试**，用于验证“观察图像 → 提议局部修改 → 重载同一基模并修改 → 再观察 → 有门禁地接受或停止”。它不是猫照片理解、VLM、照片建模、真实猫身份还原或新 AI 模型，也不改变现有 CLI、Skill、造型室或发布流程。

## 运行

从仓库根执行（需要现有 Node/sharp 和本机 Blender）：

```sh
node cat-modeling/vision-poc/calibrate.mjs --demo
# Mac 示例：本机 Blender 可执行文件路径；默认从 PATH 查找 blender
node cat-modeling/vision-poc/calibrate.mjs --demo \
  --blender /Applications/Blender.app/Contents/MacOS/Blender
node --test cat-modeling/vision-poc/tests/controller.test.mjs
```

可加 `--out NEW_DIRECTORY`、`--max-rounds 1..6`。输出只允许仓库已忽略的 `cat-modeling/jobs/` 后代或系统临时目录的专用新目录；拒绝符号链接及已有目录，不覆盖之前的任务。只接受显式 `--demo`，真实照片／原模型路径和未知参数直接拒绝。无网络、下载、权重、训练或远程模型调用。

## 这次真正编辑了什么

`calibrate.mjs` 仅用既有原创 cuboid fixture GLB 初始化一次 `base.blend`。`worker.py` 在真正的 head 网格创建 Basis 和一对 **有实际非零顶点变化** 的 `Shape_headWidth_low/high`。没有填充 26 个零 morph，也没有每轮生成新网格或用新模型替换旧模型。映射沿用项目的归一化形式：

```text
low  = max(0, (50 - headWidth) / 50)
high = max(0, (headWidth - 50) / 50)
```

本 fixture 的 low/high 分别把头部局部 x 坐标改为 0.65/1.35 倍；这个几何含义只属于测试模型，不能冒称 Norwegian/Sphynx 的真实脸型语义。

保存基模时一次性固定归一化、站姿、前视和三分之四相机、灯光、材质、背景、Cycles CPU、256×256、8 samples、随机种子与色彩设置。每个候选都重新加载**同一份**基模，只设置 headWidth 两个权重，写入新的图片／报告，绝不再次保存 base.blend。

## 图像与规划的边界

参考图由隔离的 reference 步骤使用 worker 内的 teacher 常量 68 实际渲染。规划器没有 teacher 参数输入，不读取其权重；它只读取参考和候选 PNG 的像素。fixture 允许红色头部 ID 和透明背景，因此本地 sharp 能提取头部 mask、全体 alpha silhouette、头宽／全身高度比例和 IoU。**这是受控渲染 ID 分割，不能用于解释真实宠物照片。** 材质是固定 emission ID pass；虽然存在冻结灯光，它不验证写实光照或物理毛发。

目标值定义为：`loss = 1 - headMaskIoU + abs(normalizedHeadWidth - targetNormalizedHeadWidth)`；同时报告整只 fixture 的 silhouette IoU。每轮只提议当前 headWidth 的 ±3（截断到 0..100）并渲染，最多六轮。候选须同时满足：

- 前视 loss 严格降低；三分之四视角 loss 不增加。
- candidateId、round、冻结配置、source/base 前后 SHA-256 对应本次任务，无陈旧结果。
- 拓扑／UV 计数与摘要不变，实际变形坐标有限、三角形不退化、法向方向未翻转。

三分之四视角反复用于接受门禁，是**开发验证视角，不是盲测集**；报告显式记录 `developmentValidationViewIsNotBlindTest:true`。真实实验仍需新增未参与规划的最终测试视角与人工身份评价。

输出包括真实 front/three PNG、提取的 head/silhouette mask PNG、逐候选／逐轮指标与接受／拒绝原因、实际工具版本、图片和源文件摘要、并排 `comparison.png` 以及 `report.json`。相机、光照与 shape key 都来自冻结基模；没有用目标参数直接选择下一个候选。

## 已执行的观察—修改—再观察

2026-11-08 在 Blender 4.3.2 / Cycles CPU / 256×256 / 8 samples 实际执行。参数从 50 到 53，再到 56；第三轮 59 的前视 PNG mask 指标与 56 相同，未满足严格改进，控制器停止，没有跳过平台期、扩大步长或假报收敛到 teacher。

| 实际观察指标 | 基线 50 | 接受后 56 |
| --- | ---: | ---: |
| 前视头部 mask IoU | 0.893084 | 0.945619 |
| 前视全体 silhouette IoU | 0.978003 | 0.988789 |
| 前视归一化头宽 | 0.357895 | 0.378947 |
| 前视 loss | 0.159547 | 0.085960 |
| 三分之四头部 mask IoU | 0.922555 | 0.947003 |
| 三分之四全体 silhouette IoU | 0.990594 | 0.993620 |
| 三分之四 loss | 0.108373 | 0.073615 |

这些数字来自实际渲染 PNG，而非事先写入的目标结果。新运行应检查自己的报告和摘要，不保证量化像素边界在其他 Blender 版本下完全相同。当前测试模型每个部件 36 个顶点，UV 层实际为 0；报告如实记录，未制造 UV 数据。基模和源 GLB 在本次完整循环前后哈希相同。

## 尚未通过的能力

rig、groom、宠物身份、真实照片理解、物理材质及生产兼容性均为 `UNRUN`，最终固定 `approved:false`、`productionReady:false`。局部 ID silhouette 变近不能证明“更像原来的猫”。把流程用到本机真实猫之前，需要授权素材、受支持的母模／groom、可靠参考视角、真实视觉评估器，以及与身份和毛发有关的验收门禁；此 POC 不代替这些工作。
