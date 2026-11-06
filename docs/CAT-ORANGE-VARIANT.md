# 灰虎斑母模的橘猫配色副本

2026-11-06，按最近使用的 Grey Tabby Blender 母模制作短毛橘色虎斑。当前母模的条纹位置和形状来自 UDIM 贴图；本次保留条纹布局，调整身体和原生毛发的色素范围，制作深橘条纹、金橘底毛和奶油色浅毛。改变条纹布局仍需要重绘贴图或新的花纹遮罩。

## 可打开的结果

- 模型：`assets/authored/orange-tabby-short.blend`，Blender 4.5.15 LTS，含原骨架、原步行动作与 19 个毛发系统，另有预览灯光、地面和相机。
- 全身：`artifacts/orange-cat-study/final/orange-three.png`。
- 脸部：`artifacts/orange-cat-study/final/orange-face.png`。
- 同光同镜的灰虎斑控制图：同目录 `grey-control-three.png` 与 `grey-control-face.png`。

图片为实际 Blender Cycles 渲染，1000×1000、64 样本。使用相同相机和灯光，只切换共享颜色节点组的强度；不是图片换色。

## 可继续调整的颜色

新增的 `Miaoxing Orange Tabby Palette` 节点组接在身体和毛发着色器的颜色输入之前，原 UV、颜色纹理、毛根变化、密度遮罩和原 BSDF 混合仍保留。节点组内 `Orange amount` 为 1 时显示橘色，为 0 时恢复原色；`Ginger pigments` 可编辑深条纹至浅色毛区的色阶。身体皮肤增加红色区域保护，眼睛、胡须和其他非毛色材质保持。

这是同一猫形体的配色版本，不是另造品种或重新梳毛。原始 `/Users/afa/Downloads/JC0L219A2_GreyTabbyCat_Walk_3.1.blend` 及其贴图文件未改动。此副本仍为本地 Blender 资产，尚未转换或替换网页造型室；沿用原素材的使用范围。

## 重建与核验

```sh
.tools/Blender.app/Contents/MacOS/Blender --background --disable-autoexec /Users/afa/Downloads/JC0L219A2_GreyTabbyCat_Walk_3.1.blend --python-exit-code 1 --python scripts/build-orange-tabby.py
.tools/Blender.app/Contents/MacOS/Blender --background --disable-autoexec assets/authored/orange-tabby-short.blend --python-exit-code 1 --python scripts/render-orange-tabby.py -- --output artifacts/orange-cat-study/final --resolution 1000 --samples 64 --views three,face --compare --save-stage
.tools/Blender.app/Contents/MacOS/Blender --background --factory-startup --disable-autoexec --python-exit-code 1 --python scripts/verify-orange-tabby.py
```

实际保存并重新打开后，核对了原猫 68 个网格、UV、顶点权重、捏脸形变、骨架静置矩阵、动作曲线、19 个原生毛发系统，以及 10 个非毛色材质。所有检查通过，原始文件 SHA-256 保持，副本以橘色启用，纹理依赖可用。记录见 `artifacts/orange-cat-study/verification.json`。

原素材的自定义控制器形状驱动在关闭自动执行时会出现旧版属性警告；本次保持原绑定，核验的骨架和动作数据没有因此改变。该检查不代表已完成所有动画姿势的穿插验收。
