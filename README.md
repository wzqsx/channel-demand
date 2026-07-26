# 渠道要货

临时前端记账工具（单人使用）：渠道要货、库存导入、销货核对、缺货与预警（按公司主体隔离）。

- 技术栈：Vue 3 · TypeScript · Vite · Pinia · Element Plus
- 数据：保存在本机浏览器 `localStorage`（**无后端**；换电脑不会自动同步）

---

## 在另一台 Mac 上从零跑起来（按顺序做）

### 1. 安装必备工具

#### 1.1 安装 Homebrew（没有的话）

打开「终端」（Terminal），粘贴执行：

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

安装结束后，按终端提示把 `brew` 加入 PATH（Apple Silicon 常见是再执行两行提示里的 `echo` / `eval` 命令）。验证：

```bash
brew -v
```

#### 1.2 安装 Node.js（LTS）

```bash
brew install node
```

验证（应能看到版本号，Node 建议 18+）：

```bash
node -v
npm -v
```

#### 1.3 安装 Git（一般 Mac 自带；没有再装）

```bash
git --version
```

若提示未安装，按系统弹窗装「命令行开发者工具」，或：

```bash
brew install git
```

---

### 2. 下载本仓库代码

```bash
cd ~
git clone https://github.com/wzqsx/channel-demand.git
cd channel-demand
```

已有目录、只想更新到最新：

```bash
cd ~/channel-demand
git pull
```

---

### 3. 安装项目依赖

在 `channel-demand` 目录里执行：

```bash
npm install
```

等它跑完（首次可能较慢）。

---

### 4. 启动本地服务

```bash
npm run dev
```

终端里会出现类似：

```text
  ➜  Local:   http://localhost:5173/
```

**不要关这个终端窗口**，关掉服务就停了。

---

### 5. 打开网页

用 Safari / Chrome 打开：

**http://localhost:5173/**

若端口被占用，以终端打印的实际地址为准。

---

### 6. 下次再使用

```bash
cd ~/channel-demand
npm run dev
```

再浏览器打开 `http://localhost:5173/`。

换电脑后是空数据，需要重新维护主体/仓库/商品，或自行导入 Excel。

---

## 业务使用顺序

详见 [使用说明.md](./使用说明.md)。摘要：

公司主体 → 仓库 → 渠道 → 商品（箱规要挂瓶规映射）→ 库存导入 → 渠道要货 → 销货核对 / 缺货预警

## 其他命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 日常使用：启动本地网页 |
| `npm run build` | 构建生产包 |
| `npm run preview` | 预览构建结果 |
| `npm run selfcheck` | 逻辑自检 |

## 说明

- 这是**本机网页工具**，不是双击即开的 App，也不用部署服务器。
- 库存按周初参考数记账，不扣减、不占用释放。
- 仅个人临时使用即可。
