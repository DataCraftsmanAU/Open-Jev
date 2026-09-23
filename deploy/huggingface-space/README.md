---
title: Open-Jev Workbench
emoji: 🗂️
colorFrom: blue
colorTo: green
sdk: docker
app_port: 7860
license: mit
---

# Open-Jev CPU 工作台部署包

这个部署包把[普通用户工作台](https://github.com/Zefan-Cai/Open-Jev/blob/main/docs/get-started.md)和 Open-Jev-2B 放在同一个 Docker Space 里。用户粘贴消息或上传 CSV，定义类别，再下载分类结果。

**[Open-Jev Workbench](https://huggingface.co/spaces/ZefanCai/Open-Jev-Workbench) 已上线并通过真实 CPU 分类请求验证。** [项目网站工作台](https://zefan-cai.github.io/open-jev/workbench/)提供操作页面和在线服务入口。服务使用已发布的 2B 模型和 CPU Basic；试用速度较慢，建议先处理几条消息。

工作台一次最多处理 200 条，CSV 不超过 2 MB。导出结果保留原 CSV 列，再追加分类结果。“下载任务配置”只包含分类规则和类别，不包含用户消息或结果。

## 部署验证记录

2026-09-23，16 GB CPU Basic 容器完成模型加载、启动检查和真实请求。一条虚构中文退款消息、4 个类别的 HTTP 请求成功返回“退款”，包含同源 Origin 请求头；客户端用时 **17.21 秒**。无效输入返回 HTTP 422。这是单条部署检查，不是 benchmark 或服务速度承诺。

启动日志记录耗时 28.58 秒、启动阶段进程峰值 RSS 3,250.45 MiB。该内存观测仅截至启动完成，不代表整个服务运行期间的峰值。CPU 结果及概率尚未与已发布 GPU 结果逐条核对。

- 公开源码 commit：[`45d5a0e81ab82b70070f05300afc4e821772b1f1`](https://github.com/Zefan-Cai/Open-Jev/commit/45d5a0e81ab82b70070f05300afc4e821772b1f1)。
- 首次部署并验证的 Space commit：[`ce8278238af1c9658d19356064293b0f65314176`](https://huggingface.co/spaces/ZefanCai/Open-Jev-Workbench/commit/ce8278238af1c9658d19356064293b0f65314176)。

本 Space 使用 CPU Basic，不增加硬件小时费。

## 发布前设置

将本目录的 `Dockerfile`、`app.py`、`README.md` 上传到 Docker Space 根目录。设置构建参数 `OPEN_JEV_COMMIT` 为包含工作台的公开 Open-Jev 仓库的完整 commit SHA。Hugging Face 的同名 Space 变量会传入 Docker 构建；也可以在 Dockerfile 的 `ARG OPEN_JEV_COMMIT` 后写入该 SHA 作为默认值。

构建从公开仓库 `https://github.com/Zefan-Cai/Open-Jev.git` 获取该固定 commit。运行用户为 UID 1000，端口为 7860，公开模型无需访问密钥。

[Hugging Face 官方文档](https://huggingface.co/docs/hub/spaces-overview)列出 CPU Basic 为 2 vCPU、16 GB RAM、50 GB 非持久磁盘、无小时费用；创建 Docker Space 需要账户具备相应方案资格。其他部署者应确认自己的账户条件。缓存丢失后需要重新下载模型。

本地 Docker 验证（将参数替换为已公开的完整 SHA）：

```bash
docker build --build-arg OPEN_JEV_COMMIT=<public-commit-sha> \
  -t open-jev-cpu deploy/huggingface-space
docker run --rm -p 127.0.0.1:7860:7860 --cpus=2 --memory=16g open-jev-cpu
```

打开 <http://127.0.0.1:7860/>。网页先启动，模型在后台下载和加载。`/health` 报告 `loading`、`ready` 或 `error`；固定的两候选启动检查成功后才变为 `ready`，检查结果不会显示为用户结果。网页与 `/health`、`/v1/systemone` 在同一网站下；GitHub Pages 可以链接或嵌入这个 Space。

## 模型与运行设置

- Adapter：`ZefanCai/Open-Jev-2B`，revision `0c7aa498b1627be8da4acf34c863ff0ee0a92785`，目录 `package/checkpoint`。
- 基础模型：`Qwen/Qwen3.5-2B`，revision `15852e8c16360a2fea060d615a32b45270f8a8fc`。启动时核对包内基础模型名称和 revision。
- 使用原 Open-Jev loader、保存的决策头和温度；BF16 基础权重、FP32 决策头，CPU，候选 batch 1，prefix cache 关闭。
- 安装 CPU 版 Torch 2.8.0，并使用公开项目 `.[train]` 中的 Transformers 5.10.2、PEFT 0.19.1、Accelerate 1.13.0、Datasets 5.0.0。不安装 GPU 专用 FLA 或 causal-conv1d，也不启动训练。
- 每条请求只接受一个 choice 问题、2–8 个类别、最多 4,000 个文本字符和 16 KiB 请求体。完整提示每候选最多 1,024 tokens；超限时报错，不截断。
- 一次处理一条推理请求，不排队；忙时返回 HTTP 429。最多 8 个 HTTP 处理线程，连接 backlog 为 8，连接超限返回 503。表格逐条处理。
- 用户停止后，正在计算的一条请求仍会运行到结束。失败请求不会自动重试，也不会用预设答案替代。

2B 的 BF16 权重约 4.55 GB，加载和推理还需要额外内存。Transformers 5.10.2 提供 Qwen3.5 的 PyTorch CPU 路径。上面的启动和单条请求记录不代表长文本、多类别或持续负载下的性能；GPU benchmark 也不代表此部署的延迟或数值一致性。

## 公开试用与数据

这是有容量限制的公开演示服务，Hugging Face 提供 HTTPS 和托管。自建内部业务服务时，应另外配置身份认证。

分类时，文本和类别会发送到 Space 的 CPU 服务。应用不记录用户内容、请求体或用户地址，不保存表格，不加分析追踪；Hugging Face 平台仍适用自己的隐私条款。

更新部署版本后，应重新核验真实分类和错误提示，并记录新的代码、模型版本与性能观测。需要把请求接入自己的后端，可参考 [README 的 Typed decisions](https://github.com/Zefan-Cai/Open-Jev#typed-decisions)。
