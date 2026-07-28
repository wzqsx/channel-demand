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

验证（必须能看到版本号，Node 建议 18+）：

```bash
node -v
npm -v
```

若出现 `command not found: npm`（或 `node`），说明 Node 还没装好，**先不要跑 autostart**，在本机终端按顺序执行：

```bash
# 1）确认有 Homebrew
brew -v

# 2）安装 Node
brew install node

# 3）Apple Silicon 常见：把 brew 加入 PATH，然后重开终端或执行下一行
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
eval "$(/opt/homebrew/bin/brew shellenv)"

# 4）再验证（要有版本号）
node -v
npm -v
```

仍不行：关闭终端重开，或打开 https://nodejs.org 安装 LTS，装完再开新终端验证。

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

### 6. 下次再使用（不更新代码，只打开）

```bash
cd ~/channel-demand
npm run dev
```

再浏览器打开 `http://localhost:5173/`。

换电脑后是空数据，需要重新维护主体/仓库/商品，或自行导入 Excel。

---

## 开机自动启动（不用一直开着终端）

在 **要开机自启的那台 Mac** 上，进入项目目录执行一次：

```bash
cd ~/channel-demand
npm run autostart:on
```

之后：

- 登录/开机后会在后台自动跑服务，**不用开终端**
- 浏览器直接打开：**http://localhost:5173/**（请固定用 `localhost`，不要用 `127.0.0.1`，二者是两套独立本地数据）
- 日志在项目里的 `logs/autostart.*.log`（出问题可看这里）

取消自启：

```bash
cd ~/channel-demand
npm run autostart:off
```

说明：

- 用的是 macOS「登录项 / LaunchAgent」，不是一直挂着一个终端窗口
- 你 `git pull` 更新代码后，一般重启一下电脑，或再执行一次 `npm run autostart:on` 即可加载新代码
- 若依赖变了：先 `npm install`，再 `npm run autostart:on`

---

## 另一台电脑：代码更新了怎么同步？

你在本机改完并上传到 GitHub 之后，**另外那台 Mac 不会自动更新**，需要手动拉一次：

```bash
# 1. 进入项目目录（路径按你实际安装位置）
cd ~/channel-demand

# 2. 拉取 GitHub 上的最新代码
git pull

# 3. 若依赖有变化（package.json 变了），再装一次；没变可跳过
npm install

# 4. 重新启动
npm run dev
```

然后浏览器打开（或刷新）**http://localhost:5173/**。

说明：

- `git pull` = 更新命令（把 GitHub 最新代码拉到这台电脑）
- 若启动时报依赖相关错误，再执行一次 `npm install`
- **网页里的业务数据不会被 `git pull` 覆盖或同步**（数据在浏览器本地）；只更新程序代码
- **请固定用同一个地址打开**：`http://localhost:5173/`。若有时用 `localhost`、有时用 `127.0.0.1`，浏览器会当成两套网站，看起来像「更新把数据删了」——其实数据还在另一个地址里
- 右上角有 **导出备份 / 导入备份**：更新前、换电脑前建议先导出一份 JSON

### 若更新后页面变成空的 / 演示数据

1. 先试打开：**http://localhost:5173/**（不要用 127.0.0.1）
2. 若仍不对，再试：**http://127.0.0.1:5173/**
3. 找到有数据的那个地址后，点右上角「导出备份」，再到你平时用的地址「导入备份」
4. 以后只固定用其中一个地址（推荐 localhost），并重新执行一次 `npm run autostart:on` 以刷新开机自启配置

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
