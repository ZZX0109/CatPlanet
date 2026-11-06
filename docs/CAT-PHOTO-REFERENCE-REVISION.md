# 三猫照片参考与第二版模型

2026-11-06。对应本次“先看真实猫照片，再优化模型”的修改。第一版文件和渲染保留，本次输出使用 `-v2.blend` 文件名。

## 已实际查看的参考

| 目标 | 保留照片数 | 来源与观察记录 |
|---|---:|---|
| 蓝灰纯色胖猫，以成年英短为主要体型参考 | 59 | [逐张来源](../artifacts/cat-reference-study/solid/README.md) |
| 双色布偶猫 | 50 | [逐张来源与截图对应](../artifacts/cat-reference-study/ragdoll/references-50.md) |
| 海豹重点色暹罗猫，另用其他重点色观察结构 | 50 | [逐张来源](../artifacts/cat-reference-study/siamese/source-links.txt)、[查看方法与结论](../artifacts/cat-reference-study/siamese/inspection-notes.txt) |

合计 159 张。通过浏览器实际查看照片内容，图库缩略图用于体型/姿态的广泛比较，另放大关键脸部和体态照片。没有把搜索结果标题计作看过图。筛掉明显同图裁切、近似连拍、插画、视频和可疑 AI 图；同名猫的不同姿态可能重复出现，因此照片数量不代表已经核验相同数量的独立猫个体。照片未用作模型贴图，也没有打包为产品素材。

主要在线图库：[纯蓝英短](https://commons.wikimedia.org/wiki/Category:Solid_blue_British_Shorthair_cats)、[布偶猫](https://commons.wikimedia.org/wiki/Category:Ragdoll_cats)、[海豹重点色暹罗](https://commons.wikimedia.org/wiki/Category:Black_point_Siamese_cats)。其他品种结构依据参见 [CFA 暹罗](https://cfa.org/breed/siamese/)。

## 本次实际修改

- **纯色胖猫**：减少第一版上肩/背部的横向膨胀，把体积放在胸腹、圆颊和下颌；放大头颅、缩短下脸、加宽胡须垫；腿脚缩短增厚，身体略缩短。纯蓝灰色素独立于原虎斑条纹。
- **布偶**：宽而柔和的中等楔形脸，扩大下脸与胡须垫，缩短耳朵；白色倒 V 从鼻口延伸到眉间，减少粉红裸耳；身体略拉长；背毛较贴，颈侧、腿外侧和尾中段保留更长毛量，避免中央胸毛成为整片帘子。
- **暹罗**：温暖奶油身体与深海豹重点色；重点色按尾部骨骼权重覆盖尾根到尾尖，四肢采用软梯度；额头不再形成横向浅色带；耳根外展，颈部、上肢与脚掌更细，躯干略拉长、尾部渐细。
- **眼睛**：保留原始虹膜纹理与角膜材质，再调整色相；纯色猫琥珀眼，布偶/暹罗蓝眼。上眼睑使用经过顶点位移检查的原生修正形态键；展示瞳孔固定到可重复的中性开度。
- **毛发材质**：保留原始分层的反射/透射/漫反射 closure，替换其上游色素和旧虎斑遮罩；收窄每根毛的随机明暗，避免纯色被毛出现类似杂色的强烈明暗颗粒。
- **毛发结构**：缩短导引毛时同步降低子毛绝对扰动、卷曲、束化及粗细；纯色短毛和暹罗关闭卷曲，布偶按区域保留层次。毛囊根、导引数量及原有 UV/权重保留。
- **展示**：统一四脚着地的原生 REST 站姿、无缝地面、相同柔光和相机，输出全身与脸部实际 Blender 渲染。

## 模型与预览

| 模型 | 原生文件 | 全身 | 脸部 |
|---|---|---|---|
| 纯色胖猫 | [cat-solid-v2.blend](../assets/authored/cat-solid-v2.blend) | [渲染](../artifacts/cat-reference-study/final/solid-three.png) | [渲染](../artifacts/cat-reference-study/final/solid-face.png) |
| 布偶猫 | [cat-ragdoll-v2.blend](../assets/authored/cat-ragdoll-v2.blend) | [渲染](../artifacts/cat-reference-study/final/ragdoll-three.png) | [渲染](../artifacts/cat-reference-study/final/ragdoll-face.png) |
| 暹罗猫 | [cat-siamese-v2.blend](../assets/authored/cat-siamese-v2.blend) | [渲染](../artifacts/cat-reference-study/final/siamese-three.png) | [渲染](../artifacts/cat-reference-study/final/siamese-face.png) |

对照排版：[全身](../artifacts/cat-reference-study/final/comparison.png)、[脸部](../artifacts/cat-reference-study/final/faces.png)。排版只在未修改的 Blender 渲染外加文字，没有图像生成或后期修脸。

## 复现与边界

使用项目内 Blender 4.5.15 LTS，`--disable-autoexec`。制作脚本 [build-reference-cats.py](../scripts/build-reference-cats.py)，渲染脚本 [render-reference-cats.py](../scripts/render-reference-cats.py)，完整性检查 [verify-reference-cats.py](../scripts/verify-reference-cats.py)。检查报告位于 [verification.json](../artifacts/cat-reference-study/verification.json)，制作报告位于 `artifacts/cat-reference-study/build/`。

最终六张单独渲染均为 1000×1000、Cycles Metal、64 samples，三只各 34 项技术检查通过，共 102 项。实际图片评审仍看到：纯色猫体毛偏颗粒，布偶白 V 顶端略细；这些是下一轮外观精修项，不应把技术检查通过宣传成照片级质量。

源 `.blend` 未覆盖；原网格基础、UV、身体权重、骨骼和行走动作关键帧保留。外观变化通过新形态键、辅助面部网格变形、独立色素图、毛发导引及子毛设置完成。

这是供外观评审的原生模型副本。静态展示采用 REST 骨架，暂停与行走相关的动态修正，保留静态 `repair_face=1`；眼部瞳孔驱动也为展示冻结。原行走动作保留不代表新比例已通过动作重定向验收，网页轻量化与完整动画检查仍需单独完成。文件/绑定完整性通过也不等于外观已获用户确认。
