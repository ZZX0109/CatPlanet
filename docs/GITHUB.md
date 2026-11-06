# GitHub 源码与部署

对应仓库：https://github.com/ZZX0109/CatPlanet

主分支 `main` 保存应用代码、建模脚本、数据库迁移和 Docker 部署配置。推送后，GitHub Actions 使用 Node.js 22 执行依赖安装、类型检查及生产构建，通过后构建并发布两个镜像：

- 应用：`ghcr.io/zzx0109/catplanet:main`
- 数据迁移/维护：`ghcr.io/zzx0109/catplanet:maintenance-main`

每次同时发布 `sha-完整提交号` 与 `maintenance-sha-完整提交号` 标签，正式环境应固定到经过验证的提交标签。两个构建目标使用同一镜像仓库，继承同一项目的访问权限。镜像发布成功不代表网站已经上线；GitHub Actions 和 Container Registry 不持续运行应用服务。

## 运行完整应用

应用需要 Node.js、PostgreSQL、验证码邮件和私有照片存储。生产部署使用 [deploy/compose.yaml](../deploy/compose.yaml) 与 Caddy，配置及启动步骤见 [DEPLOYMENT.md](./DEPLOYMENT.md)。需要另行提供服务器/托管平台以及域名。GitHub Pages 只托管静态文件，不能直接运行本应用的登录、数据库及上传接口。

从源码部署：

```sh
git clone https://github.com/ZZX0109/CatPlanet.git
cd CatPlanet
cp deploy/.env.example deploy/.env.production
# 在服务器私有环境文件中填写域名、数据库、邮件及 COS 配置。
chmod 600 deploy/.env.production
docker compose --env-file deploy/.env.production -f deploy/compose.yaml up -d --build
```

使用 GitHub 构建的镜像时，在环境文件增加 `CATPLANET_RELEASE=sha-完整提交号`，再叠加 [compose.github.yaml](../deploy/compose.github.yaml)：

```sh
docker compose --env-file deploy/.env.production -f deploy/compose.yaml -f deploy/compose.github.yaml pull
docker compose --env-file deploy/.env.production -f deploy/compose.yaml -f deploy/compose.github.yaml run --rm --no-deps migrate
docker compose --env-file deploy/.env.production -f deploy/compose.yaml -f deploy/compose.github.yaml up -d --no-build
```

首次迁移应让 Compose 启动数据库依赖，可省略 `--no-deps`；升级时先按部署说明完成备份。若镜像仓库为私有，服务器需先使用有镜像读取权限的 GitHub 凭据登录 `ghcr.io`。

## 模型和本机文件

公开仓库包含有明确许可的两只基础猫及其署名信息。用户提供的挪威森林猫、斯芬克斯及房间版本文件标记为 `local-only-unverified`，不随公开仓库和镜像分发；造型室相关源码与模型元数据保留。需要这些功能的私有部署应在确认素材许可后，单独注入对应模型，随后执行 `npm run models:check-room` 验证。缺少模型时，基础猫房间可运行，涉及这些素材的造型室及外观导入不可用。

以下内容保留在本机：环境密钥、账号/照片数据、Blender 母模与大文件、原始及加工素材、模型研究图片和调试输出。部分研究文档指向这些本机产物，克隆公开仓库不会获得相应二进制文件。

完整模型的端到端测试需要额外补齐本地素材、PostgreSQL 和 Mailpit；公开 CI 的构建通过不代表这些外观、动画、真机性能或生产邮件/存储已经验收。
