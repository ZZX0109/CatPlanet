# 猫模型清单与验证

| 项目 | 小橘 | 团团 |
| --- | --- | --- |
| 文件 | public/models/toon_cat_free.glb | public/models/vuena_cat.glb |
| 作者 | Omabuarts Studio | Vuena / Popyca |
| 来源 | [Sketchfab 原作](https://sketchfab.com/3d-models/toon-cat-free-b2bd1ee7858444bda366110a2d960386) | [作者免费样本页](https://vuena.itch.io/blocky-pets-free) |
| 授权 | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | [CC0](https://creativecommons.org/publicdomain/zero/1.0/)，原始授权保存在 public/models/vuena-LICENSE.txt |
| 外形 | 修长四肢、橘白色 | 独立圆润大头模型、银灰虎斑 |
| 骨骼/动作 | 单一 Scene 行走片段 | 19 骨骼，12 个原生片段：idle、idle_alt、walk、run、jump、eat、sit、sleep、attack、call、hit、death |
| 休息 | 冻结步行动作，程序侧卧与呼吸 | 作者 sleep 动作 |
| 本项目修改 | 归一化尺寸、侧卧/回应 | 使用 LOD1；材质着色器把橘色毛发转换为银灰，保留粉色部位；回应 |

两只猫使用不同网格、骨架和体型。团团的毛色调整用于加强辨识度，不是用一套网格换色冒充两种体型。下载的新版样本原本也是橘色，不能直接沿用“奶油色”的文字描述。

模型清单与动作映射在 `lib/models.ts`。显示前更新世界矩阵，再计算包围盒，最长边归一化为 1.5 场景单位，脚底对齐地面。统一正面为 +Z，默认略偏转，轻触短暂面向用户后回到原模式。睡眠回应只轻微摇动，不切换到站立动作。减弱动态设置下冻结片段并停用呼吸/摇动。

Vuena 免费档案名为 `Cute-Pets-Wildlife-FREE-Sample-CC0.zip`，上传编号 20199366，2026-11-02 下载。原始档案同时带 LOD0 和 LOD1；本项目只显示 LOD1，避免两套重叠。当前授权只覆盖免费样本，不覆盖作者付费完整包。

授权署名也可从页面“隐私与素材说明”查看。没有将这些模型描述成用户宠物的真实复原；照片只进入头像和相框。
