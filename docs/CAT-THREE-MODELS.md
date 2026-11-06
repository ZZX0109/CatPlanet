# 三只猫的 Blender 造型初版

2026-11-06，按用户要求制作三只可打开的实际三维模型：更胖的纯色猫、布偶猫、暹罗猫。采用原 Grey Tabby 拓扑与原生毛发制作独立副本，新增形体形变和毛色分区；不是对渲染图片换色。

## 查看结果

| 造型 | Blender 文件 | 全身 | 脸部 |
| --- | --- | --- | --- |
| 蓝灰纯色胖猫 | `assets/authored/cat-solid.blend` | `artifacts/three-cat-models/final/solid-three.png` | `artifacts/three-cat-models/final/solid-face.png` |
| 双色布偶 | `assets/authored/cat-ragdoll.blend` | `artifacts/three-cat-models/final/ragdoll-three.png` | `artifacts/three-cat-models/final/ragdoll-face.png` |
| 海豹重点色暹罗 | `assets/authored/cat-siamese.blend` | `artifacts/three-cat-models/final/siamese-three.png` | `artifacts/three-cat-models/final/siamese-face.png` |

全身对照图为同目录 `comparison.png`，脸部对照为 `faces.png`。每幅源图为实际 Cycles 渲染，1000×1000、64 样本，同相机、同灯光。模型里已保存预览地面、相机和灯光，使用 Blender 4.5 打开后可直接渲染。

## 三只模型的区别

- **纯色胖猫：** 蓝灰体毛，琥珀色眼睛；胸腹横向体积增加、腹线下移，头脸和下颌更圆，腿部比例略紧凑。基础网格胸腹半宽从约 0.04694 增至 0.07410 场景单位，约增加 58%；这是本模型相同局部范围的几何尺寸比较，不是体重估算。新毛色图仅含约 ±1.2% 的微小变化，没有虎斑色带。
- **双色布偶：** 使用 R3 原生长毛母模，体型略加宽，原外层毛与尾毛适度延长；新制作白色倒 V 脸、白胸腹与白腿、深色耳尾及蓝眼睛。体型与分区参考 [CFA Ragdoll](https://cfa.org/breed/ragdoll/)。
- **暹罗：** 胸腹收窄，脸部呈更明显的楔形，耳朵略放大；毛发更短，四肢、耳、脸与尾巴采用深褐重点色，身体为奶油色，蓝眼睛。形体与重点色参考 [CFA Siamese](https://cfa.org/breed/siamese/)。

三种体毛不再使用原灰虎斑的颜色贴图。新的双 UV 区毛色合并为 4096×2048 图集，依据原身体坐标生成，包含纯色或新的重点色／白色区域。原 UV、法线细节与毛囊归属保留，鼻头和脚垫的皮肤颜色独立控制。原胡须及眼部纹理细节保留；虹膜重新配色。

新增形体以 `Miaoxing ...` 命名的形态键保存，默认为 1，可在 Blender 中调整。原骨架和动作曲线保留；眼球、眼睑、口腔、牙齿等相邻部位已按对应形体调整，避免暹罗瘦脸后的口腔露出。

## 检查与范围

- 保存后重新打开三份文件，核对基础顶点与面数、原 Basis、UV、蒙皮权重、骨架和动作曲线、19 个毛发系统的毛根与导引数量。原始两份源文件 SHA-256 保持，三只模型检查均通过。
- 核对新毛色图存在且体毛着色器不再读取原虎斑颜色。纯色图的颜色范围与胸腹增宽、暹罗胸腹收窄另有数值检查。
- 对纯色猫抽查 BodyBase 的 96 个毛根：增胖前后平均离皮距离约 2.7×10⁻⁵ 场景单位、最大约 2.65×10⁻⁴ 场景单位；毛根随新形体移动，平均移动约 0.0128 场景单位。抽查不代表所有毛束、子毛或所有动画姿势完成穿插验收。

检查报告为 `artifacts/three-cat-models/verification.json`、`roots-solid.json`；制作参数分别记录在 `solid-build.json`、`ragdoll-build.json`、`siamese-build.json`。早期预览中发现的暹罗口腔露出已在最终版本修正。

当前为本地造型初版，用于比较外形与毛色，不作为血统鉴定或已完成全部品种美术验收的模型。还没有完成网页简化、手机性能和所有动画姿势验收。原始用户素材与已有橘猫副本保持。

## 制作与复现

```sh
.tools/Blender.app/Contents/MacOS/Blender --background --factory-startup --disable-autoexec --python-exit-code 1 --python scripts/build-three-cat-models.py -- --texture-size 2048
.tools/Blender.app/Contents/MacOS/Blender --background --factory-startup --disable-autoexec --python-exit-code 1 --python scripts/render-three-cat-models.py -- --views three,face --samples 64 --resolution 1000 --output artifacts/three-cat-models/final --save-stage
.tools/Blender.app/Contents/MacOS/Blender --background --factory-startup --disable-autoexec --python-exit-code 1 --python scripts/verify-three-cat-models.py
python3 scripts/compose-three-cat-preview.py
```
