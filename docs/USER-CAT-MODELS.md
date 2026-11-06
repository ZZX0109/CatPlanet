# 用户提供的四套猫素材：本地检查

2026-11-04，已通过本机登录的百度网盘客户端下载分享包中的四套猫及贴图。原始下载仍保留在 `~/Downloads`，项目副本位于 `assets/source/user-animal-pack-2026-11-04/`。后续已采用挪威森林猫副本制作脸部形变并接入 `/studio/base`；其他三套仍为检查素材。

| 素材 | 下载格式 | 骨骼数 | 面部形状键 | 原生毛发系统 |
| --- | --- | ---: | --- | --- |
| 小猫 | `Kitten.glb` | 72 | 无 | 未发现 |
| 波斯猫 | `Persian.glb` | 57 | 无 | 未发现 |
| 挪威森林猫 | `Norwegianforest.glb` | 49 | 无 | 未发现 |
| 斯芬克斯猫 | `Sphynx.blend` | 85 | 无 | 未发现 |

四套均含动画数据、眼球及眼睑相关骨骼。以上说明的是文件中存在的数据，尚未逐段验收走路、休息和闭眼，也不代表已经接入捏脸。小猫、波斯猫和挪威森林猫的皮毛主要由表面形体与毛色、法线贴图表现；本轮没有新增或伪装可调毛量、毛长。

## 实际打开结果

四套文件均由 Blender 成功导入，分别生成全身、正面、侧面、斜侧面及灰模检查图。原文件的 SHA-256 在处理前后保持一致，纹理保留。

![下载素材的实际 Blender 渲染](../artifacts/user-cat-pack-review/overview.png)

检查副本保留骨架、动画、材质，并添加相机和中性灯光，可在 Blender 中继续编辑：

- [小猫](../assets/source/user-animal-pack-2026-11-04/reviews/kitten.blend)
- [波斯猫](../assets/source/user-animal-pack-2026-11-04/reviews/persian.blend)
- [挪威森林猫](../assets/source/user-animal-pack-2026-11-04/reviews/norwegian-forest.blend)
- [斯芬克斯猫](../assets/source/user-animal-pack-2026-11-04/reviews/sphynx.blend)

三个 GLB 使用 Blender 4.5.15 导入；斯芬克斯猫原文件版本为 2.92，本轮使用 Blender 3.6.23 读取并保存检查副本。挪威森林猫和斯芬克斯猫副本还经过重新打开检查。

本机首次图形界面的文件选择器停在 Loading；未把该界面操作计为成功。本页的导入成功、渲染和副本重新打开均由实际后台 Blender 完成。

## 作为新母模的判断

从这组实际灰模看，挪威森林猫的眼眶、口鼻与耳朵比当前程序重建猫头更自然，值得优先用于成年猫母模的后续制作。小猫适合幼态模板，波斯猫适合保留其特定脸型，斯芬克斯猫可供无毛形体与面部结构检查。

还需要制作脸型、眼裂、口鼻和耳朵的可控形变，并整理与眼球、眼睑及骨架的联动；毛量、毛长则需要单独的分区毛发资产。现成的骨架和动画不能代替这些工作。

来源为用户提供的分享包，包内模型作者和项目分发授权尚未确认。四套原始文件保存在本地源目录；后续挪威森林猫的加工副本已用于本地网页与本地导出，见下方接入状态。

原始文件清单和摘要见 [manifest.json](../assets/source/user-animal-pack-2026-11-04/manifest.json)，每套实际检查记录位于 `artifacts/user-cat-pack-review/<名称>/review.json`。

复查示例：

```sh
.tools/Blender.app/Contents/MacOS/Blender \
  --background --factory-startup --disable-autoexec --python-exit-code 1 \
  --python scripts/review-imported-cat.py -- \
  assets/source/user-animal-pack-2026-11-04/norwegian-forest/source/Norwegianforest.glb \
  norwegian-forest
```

## 后续接入状态

挪威森林猫已制作独立母模 `norwegian-cat-v1`，原始文件保持不变。新版制作副本为 `assets/authored/norwegian-creator.blend`，网页模型为 `public/models/creator/norwegian-cat.glb`。新增 14 项结构控制对应 26 个形状目标，保留身体、毛色、49 根骨骼与动画数据。后续已接入头部、胸颈、身体三组网页三维毛束与默认正面站姿；闭眼和趴卧尚未制作。详见 [当前造型室说明](./CAT-CREATOR.md)。

## 三类基础模板

后续斯芬克斯也已加工为独立无毛母模，接入 `/studio/base`；短毛与长毛继续共用挪威森林猫网格，并使用独立被毛构造。两套均有 26 个形状目标和 14 项脸部控制。详见 [三类基础模板](./CAT-COAT-TEMPLATES.md)。
