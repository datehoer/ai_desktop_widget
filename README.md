# Codex Usage Widget

用 ESP32-S3 NANO 和 1.54 英寸 ST7789 TFT 制作的桌面 Codex 状态屏。

屏幕显示：

- Codex 周额度使用比例
- 距离周额度重置的剩余时间
- 可用 reset credits
- 当前正在运行的 Codex 任务数量
- 最多两个真实任务标题，支持常用简体中文
- 当前时间、Wi-Fi 信号强度和数据状态（`LIVE` / `STALE`）
- 内置 Wi-Fi 配网页面，无需为了更换网络或 Mac 地址重新烧录

本文按全新 macOS 环境编写，从硬件接线到首次显示数据均可逐步复现。项目目前在 ESP32-S3 NANO（16MB Flash、8MB PSRAM）和 240×240 ST7789 SPI 屏幕上验证通过。

## 工作原理

ESP32 不直接登录 Codex，也不保存 ChatGPT 凭证。Mac 上的 Node.js 桥接服务启动本机 `codex app-server`，把屏幕需要的信息整理为一个局域网 HTTP 接口；ESP32 每 5 秒获取一次。

```mermaid
flowchart LR
    A["Codex Desktop / CLI"] --> B["codex app-server"]
    B --> C["Mac Node.js bridge :8787"]
    C -->|"Wi-Fi / JSON"| D["ESP32-S3 NANO"]
    D -->|"SPI"| E["ST7789 240×240 TFT"]
```

桥接服务读取：

- `account/rateLimits/read`：额度窗口、重置时间和 reset credits
- `thread/list`：任务标题、更新时间与本地 rollout 文件
- rollout 生命周期事件：判断任务最后处于运行还是完成状态

Codex CLI 安装和登录方式请参考 [OpenAI Codex CLI 官方说明](https://learn.chatgpt.com/docs/codex/cli)；本项目使用的本地协议见 [Codex App Server 官方说明](https://learn.chatgpt.com/docs/app-server)。

## 一、准备材料

### 硬件

- ESP32-S3 NANO 开发板，已焊接排针
- 1.54 英寸彩色 TFT
  - 驱动芯片：ST7789
  - 接口：SPI
  - 分辨率：240×240
  - 已焊接排针
- 母对母杜邦线 8 根
- 支持数据传输的 USB Type-C 线
- 400 孔面包板，可选；首轮测试可以直接用母对母线连接

> 本项目的引脚和 Flash 设置是针对上述已验证硬件。若屏幕驱动、分辨率、ESP32 型号或 Flash 容量不同，需要调整 `firmware/platformio.ini`。

### 软件

- macOS
- Git
- Node.js 20 或更高版本；项目 `.nvmrc` 推荐 Node.js 22
- npm
- Python 3.12
- [uv](https://docs.astral.sh/uv/)
- Codex CLI，并已完成 ChatGPT 登录
- 一个 2.4 GHz Wi-Fi；Mac 和 ESP32 必须能够在局域网内互相访问

## 二、断电接线

接线时不要连接 USB。确认全部线序后，再把 ESP32 接到电脑。

![ESP32-S3 NANO 与 ST7789 接线图](output/wiring/esp32-st7789-wiring-final.png)

| ST7789 TFT | ESP32-S3 NANO | 功能 |
| --- | --- | --- |
| `BLK` | `GPIO7` | 背光控制 |
| `CS` | `GPIO10` | SPI 片选 |
| `DC` | `GPIO9` | 数据/命令选择；板上印作 `09` |
| `RES` | `GPIO8` | 屏幕复位；板上印作 `08` |
| `SDA` | `GPIO11` | SPI MOSI，不是 I²C SDA |
| `SCL` | `GPIO12` | SPI 时钟 |
| `VCC` | `3V3` | 3.3V 供电 |
| `GND` | `GND` | 地 |

接线注意事项：

- `VCC` 只接 `3V3`，首轮测试不要接 `5V`。
- 所有线插到底，轻拉确认没有松动。
- TFT 背面标记顺序可能与观看方向相反，按丝印文字逐个确认。
- `SDA` 和 `SCL` 在这块屏幕上属于 SPI，不代表必须使用 I²C 引脚。
- 杜邦线颜色没有电气意义，只需保证两端对应正确。

## 三、取得项目代码

如果项目已经发布到 Git 仓库：

```bash
git clone <repository-url>
cd ai_desktop_usage_widget
```

如果拿到的是压缩包，解压后在终端进入包含 `README.md`、`package.json` 和 `firmware` 的目录。

项目主要结构：

```text
ai_desktop_usage_widget/
├── bridge/
│   ├── src/                    # Mac 数据桥
│   └── test/                   # Node.js 测试
├── firmware/
│   ├── include/
│   │   └── secrets.example.h  # 旧固件配置的可选迁移模板
│   ├── src/
│   │   ├── main.cpp            # ESP32 界面与 Codex 数据请求
│   │   ├── device_config.cpp   # NVS 配置持久化
│   │   └── config_portal.cpp   # 内置配网页面
│   └── platformio.ini          # 开发板、引脚和依赖配置
├── viewer/                      # STL/3MF/G-code 本地 3D 预览器
│   └── src/                     # 预览界面、物理和示例路径
├── output/wiring/              # 接线图
├── package.json
├── pyproject.toml
└── uv.lock
```

## 四、安装和验证 Codex CLI

先确认命令存在：

```bash
codex --version
```

如果尚未安装，可按照官方说明安装。在 macOS/Linux 上，官方提供的安装命令是：

```bash
curl -fsSL https://chatgpt.com/codex/install.sh | sh
```

首次运行：

```bash
codex
```

按提示选择使用 ChatGPT 登录。完成后退出交互界面，再验证 App Server 能启动：

```bash
codex app-server
```

看到进程保持运行、没有立即报错即可按 `Ctrl+C` 退出。桥接服务稍后会自动启动它，不需要长期手动运行两份。

## 五、准备 Node.js

如果使用 nvm：

```bash
nvm install
nvm use
node --version
npm --version
```

`.nvmrc` 当前固定为 Node.js `22.22.1`。只要 Node.js 版本不低于 20，桥接服务原则上也可运行。

项目的 Node.js 部分只使用内置模块，没有第三方 npm 运行依赖。先执行测试：

```bash
npm test
```

预期所有测试通过。

## 六、启动 Mac 数据桥

在项目根目录运行：

```bash
npm start
```

终端应输出类似：

```text
Codex Usage Bridge listening on http://0.0.0.0:8787
ESP32 URL: http://192.168.1.100:8787/api/status
```

这里必须使用输出中的局域网 IPv4 地址，实际地址因路由器而异。不要把 `localhost` 或 `127.0.0.1` 填给 ESP32，因为它们在 ESP32 上代表开发板自己。

保持桥接终端运行，并在另一个终端验证：

```bash
curl http://127.0.0.1:8787/healthz
curl http://127.0.0.1:8787/api/status
```

健康检查应返回 JSON；状态接口在首次刷新后应返回包含以下字段的数据：

```json
{
  "ok": true,
  "stale": false,
  "quota": {
    "weekly": {
      "usedPercent": 7,
      "resetsAt": 1780000000
    }
  },
  "resetCredits": 0,
  "runningCount": 1,
  "running": [
    {
      "title": "开发 Codex Usage 桌面面板"
    }
  ]
}
```

数值只是示例，以实际账户返回为准。

### 桥接服务环境变量

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `PORT` | `8787` | HTTP 监听端口 |
| `HOST` | `0.0.0.0` | HTTP 监听地址 |
| `REFRESH_MS` | `5000` | 后台刷新间隔，毫秒 |
| `CODEX_BIN` | `codex` | 自定义 Codex CLI 绝对路径 |
| `DEBUG_CODEX_BRIDGE` | 未启用 | 设为 `1` 后显示 App Server 日志 |

## 七、准备 Python 与 PlatformIO

项目使用 uv 管理 Python 3.12 和固定版本的 PlatformIO：

```bash
uv sync
uv run platformio --version
```

不需要另外创建 Conda 环境；uv 会在项目中创建 `.venv`。

如果首次下载依赖需要本地代理，可以只在当前终端设置：

```bash
export https_proxy=http://127.0.0.1:7890
export http_proxy=http://127.0.0.1:7890
export all_proxy=http://127.0.0.1:7890
export no_proxy=
uv sync
uv run platformio run -d firmware
```

代理地址要改成自己实际运行的代理。依赖下载完成后，局域网访问通常不应经过代理；如遇到 ESP32 接口访问异常，可在新终端重新启动桥接服务。

## 八、准备首次配网信息

Wi-Fi 不再编译进固件。首次烧录后，ESP32 会自动进入内置配网模式。先准备：

- 2.4 GHz Wi-Fi 名称和密码
- `npm start` 打印的 Mac 局域网 URL，例如 `http://192.168.1.100:8787/api/status`
- 所在时区；中国选择“中国标准时间 · 上海（UTC+8）”
- 刷新间隔，允许 2–60 秒，默认 5 秒

配网模式下屏幕会显示：

```text
SETUP MODE
Codex-Widget-XXXX
Password: codexsetup
192.168.4.1
```

首次使用时设备还不知道家中 Wi-Fi 的名称和密码，因此需要临时连接这个热点。系统一般会自动弹出页面；如果没有，手动打开 `http://192.168.4.1/`。填写并保存后设备自动重启，配置保存在 NVS。这个步骤只用于首次配置或原 Wi-Fi 已经无法连接的恢复场景。

已使用旧版 `secrets.h` 的设备会在升级后自动连接一次，并把旧配置迁移进 NVS。全新安装不需要创建 `secrets.h`。

## 九、连接 ESP32 并确认串口

确认接线无误后，用支持数据的 Type-C 线连接电脑。板上亮红灯或绿灯通常只代表供电状态，不代表固件已经正确运行。

列出串口：

```bash
uv run platformio device list
```

macOS 上常见名称：

```text
/dev/cu.usbmodem11201
```

每台电脑和每次插拔后的编号都可能不同，后续命令用自己看到的端口替换示例值。

## 十、编译固件

```bash
uv run platformio run -d firmware
```

首次构建会下载：

- TFT_eSPI
- ArduinoJson
- U8g2_for_TFT_eSPI
- 文泉驿 GB2312 中文字体数据

当前验证构建大约使用：

- RAM：14.3%
- Flash：17.1%

中文字体已经编译进固件，不需要在 ESP32 上单独安装字体文件。

## 十一、烧录固件

推荐明确指定串口：

```bash
uv run platformio run -d firmware \
  --target upload \
  --upload-port /dev/cu.usbmodem11201
```

正常情况下不需要按 `RST` 或 `BOOT`。看到以下信息代表烧录完成：

```text
Hash of data verified.
Hard resetting via RTS pin...
[SUCCESS]
```

如果一直停在 `Connecting...`：

1. 按住 `BOOT`。
2. 短按一次 `RST`。
3. 松开 `BOOT`。
4. 重新执行 upload 命令。

项目还保留了 USB-JTAG 恢复环境。普通方式无法烧录时可以尝试：

```bash
uv run platformio run -d firmware \
  -e esp32-s3-nano-jtag \
  --target upload
```

## 十二、查看串口日志

烧录后执行：

```bash
uv run platformio device monitor \
  --port /dev/cu.usbmodem11201 \
  --baud 115200
```

正常日志类似：

```text
[boot] Codex Usage Widget
[boot] initialising TFT on SPI3/HSPI
[boot] TFT ready
[config] loaded from NVS
[wifi] configured SSID found: your-wifi (-42 dBm)
[wifi] connected: 192.168.1.155
[config] bridge: http://192.168.1.100:8787/api/status
[config] hold BOOT for 4s to reconfigure
[task] title: 开发 Codex Usage 桌面面板
```

按 `Ctrl+C` 退出串口监控。退出监控不会停止 ESP32。

## 十三、检查屏幕

首次启动流程通常是：

1. 屏幕背光亮起。
2. 没有有效配置时显示 `SETUP MODE` 并创建临时热点。
3. 在手机/电脑配网页面保存 Wi-Fi 和 Bridge URL。
4. ESP32 重启并连接 Wi-Fi。
5. NTP 同步后顶部时间从 `--:--` 变为当前时间。
6. 获取桥接数据后显示额度与任务。

界面含义：

| 区域 | 内容 |
| --- | --- |
| 顶部 | `CODEX`、桥接状态点、当前时间 |
| `WEEKLY` | 周额度已使用百分比和进度条 |
| `RESET` | 距离周额度重置的剩余时间 |
| `CREDITS` | 可用 reset credits；接口未提供时显示 `--` |
| `RUNNING` | 当前未完成的 Codex 任务数量 |
| 任务列表 | 最多两个真实任务标题，过长时显示 `...` |
| 底部 | Wi-Fi RSSI 和 `LIVE` / `STALE` |

`LIVE` 表示最近一次桥接数据有效。`STALE` 表示当前请求失败，但屏幕仍保留上一次成功数据。只有设备启动后从未成功取得数据时才显示 `NO DATA`。

## 十四、日常启动顺序

完成首次烧录后，ESP32 会记住固件和 Wi-Fi 配置。日常使用只需要：

1. 给 ESP32 供电。
2. 确保 Mac 和 ESP32 在同一局域网。
3. 在项目目录运行：

   ```bash
   nvm use
   npm start
   ```

4. 保持这个终端和 Mac 处于运行状态。

ESP32 正常联网后会一直在局域网开放配置页。连接同一 Wi-Fi 的电脑或手机可以直接访问：

```text
http://codex-widget.local/
```

如果当前网络不支持 mDNS，也可以使用串口启动日志中 `[config] LAN page:` 后显示的设备 IP，例如 `http://192.168.1.155/`。从局域网页面保存后设备会自动重启。

ESP32 不需要每天重新烧录。正常联网时直接使用上述局域网页面修改 Wi-Fi、密码、Mac 地址、时区或刷新间隔。只有当前 Wi-Fi 已失效、局域网页面无法访问时，才长按 `BOOT` 4 秒进入临时热点恢复模式。修改接线引脚、界面或固件代码时才需要重新烧录。

如果 Mac 的局域网 IP 因 DHCP 发生变化，可直接打开设备的局域网页面更新 Bridge URL。更稳定的做法仍是在路由器中为 Mac 设置 DHCP 地址保留。

### macOS 后台自启动（推荐）

项目提供一个用户级 `launchd` 服务。它会在登录后自动启动 Bridge，进程异常退出时自动重启，不需要一直保留终端窗口。默认把 `http://127.0.0.1:7890` 同时配置为 HTTP、HTTPS 和 ALL proxy，并让 localhost、局域网与 `.local` 地址绕过代理。

安装脚本会把一个很小的启动器复制到 Mac 系统盘。登录后它会等待项目所在磁盘和本地代理就绪，再启动 Bridge。这一点对放在 `/Volumes/...` 外置磁盘中的项目尤其重要，可以避免 launchd 早于磁盘挂载而卡在入口脚本之前。

安装并启动：

```bash
nvm use
npm run service:install
```

如果代理地址不同，可在安装时覆盖：

```bash
CODEX_WIDGET_PROXY='http://127.0.0.1:7891' npm run service:install
```

查看服务与接口状态：

```bash
npm run service:status
```

日志位置：

```text
~/Library/Logs/CodexUsageWidget/bridge.log
~/Library/Logs/CodexUsageWidget/bridge.error.log
```

卸载后台服务：

```bash
npm run service:uninstall
```

安装后台服务后不要再同时运行 `npm start`，否则两者会争用 8787 端口。该服务使用安装时解析到的 Node 和 Codex 绝对路径；以后切换 Node 版本或移动项目目录后，重新执行一次安装命令即可更新。

## 十五、常见问题

### 1. 屏幕完全不亮

- 检查 `VCC -> 3V3` 和 `GND -> GND`。
- 检查 `BLK -> GPIO7`。
- 确认 USB 线能够供电。
- 用万用表检查时避免让表笔短接相邻引脚。

### 2. 背光亮，但没有画面

- 核对 `CS/DC/RES/SDA/SCL` 五根信号线。
- 确认屏幕驱动是 ST7789、分辨率是 240×240、接口是 SPI。
- 确认使用本项目的 `firmware/platformio.ini`。
- 该硬件需要 `USE_HSPI_PORT=1`，否则 TFT 初始化可能在 ESP32-S3 上崩溃。

### 3. TFT 初始化后重启或出现 `StoreProhibited`

本项目已通过以下编译参数固定使用 SPI3/HSPI：

```ini
-D USE_HSPI_PORT=1
```

不要删除该参数。如果修改了 PlatformIO 环境，确认它仍然生效。

### 4. 找不到串口

- 换一根确定支持数据传输的 USB-C 线。
- 换电脑 USB 端口，避免仅供电 Hub。
- 重新运行 `uv run platformio device list`。
- 尝试 BOOT/RST 下载模式。
- macOS 上选择 `/dev/cu.*` 端口，而不是盲目复用别人的编号。

### 5. Wi-Fi 一直连接失败

- 启动时连接失败后，设备会自动进入 `SETUP MODE`。
- 正常运行时长按 `BOOT` 4 秒也可进入配网页面。
- 核对 SSID 的每一个字符。
- 使用 2.4 GHz 网络。
- 检查密码和大小写。
- 检查路由器是否启用了 AP/client isolation。
- 检查设备数量限制、MAC 过滤和访客网络限制。
- 从串口查看是否出现 `configured SSID found`。

正常联网时优先访问 `http://codex-widget.local/` 或设备的局域网 IP。配网热点密码固定为 `codexsetup`，地址是 `http://192.168.4.1/`；该热点仅在首次配置或恢复模式中开放。

### 6. Wi-Fi 已连接，但显示 `NO DATA`

- 如果已安装后台服务，运行 `npm run service:status`；否则确认 Mac 上的 `npm start` 仍在运行。
- 打开 `http://codex-widget.local/`（或设备 IP）确认 Bridge URL 不是 `localhost` 或 `127.0.0.1`。
- 在 Mac 上打开 `http://<Mac-IP>:8787/api/status`。
- 检查 macOS 防火墙是否阻止 Node.js 接收入站连接。
- 确认 Mac 和 ESP32 不在互相隔离的访客网络。
- 若接口刚启动返回 503，等待首次 Codex 数据刷新后重试。

### 7. 偶尔显示 `STALE`

短暂网络抖动或 Codex App Server 查询变慢时会显示 `STALE`。屏幕会保留最近一次数据并自动重试。桥接接口使用缓存优先，不会让 ESP32 等待慢查询。

如果频繁出现，可查看串口：

```text
[bridge] HTTP -11
```

这通常表示 HTTP 超时。检查 Mac 是否休眠、Wi-Fi 信号、桥接进程和防火墙。

### 8. 显示项目名而不是真实任务名

确认使用最新版固件。最新版直接读取 JSON 的 `title` 字段，不再用项目名回退。串口应输出：

```text
[task] title: 真实任务标题
```

如果接口中的 `title` 正确而串口不正确，重新构建并烧录固件，不要只重启旧固件。

### 9. 中文不显示、乱码或方框

- 确认 PlatformIO 依赖中包含 `U8g2_for_TFT_eSPI`。
- 确认固件使用 `u8g2_font_wqy14_t_gb2312b`。
- 重新执行完整构建和烧录。
- 当前字库覆盖常用 GB2312 简体中文；emoji、繁体和生僻 Unicode 字符可能缺字。

### 10. 时间一直是 `--:--`

时间来自 NTP。检查 Wi-Fi 是否能访问互联网，以及网络是否屏蔽 `pool.ntp.org` 或 `time.cloudflare.com`。时区可在配置页直接选择；中国选择“中国标准时间 · 上海（UTC+8）”。采用夏令时的选项会自动切换。

### 11. `RUNNING` 数量和肉眼观察不一致

桥接服务根据本地 rollout 文件最后一个 `task_started`、`task_complete` 或 `task_cancelled` 事件判断。异常退出、文件损坏或 Codex 内部格式变化可能导致短时不一致。先等待一个刷新周期，再重启桥接服务确认。

### 12. PlatformIO 下载失败

按“准备 Python 与 PlatformIO”一节临时设置代理。若代理端口不是 `7890`，使用自己的端口。依赖已经下载后，可取消代理再编译。

## 十六、安全说明

- Wi-Fi 密码保存在 ESP32 的 NVS；默认没有启用 Flash Encryption，因此能物理读取设备 Flash 的人理论上可以取得密码。
- 配置页面不会回显已保存的 Wi-Fi 密码。
- 旧设备可通过被 Git 忽略的 `firmware/include/secrets.h` 完成一次迁移；不要提交真实 `secrets.h`。
- 不要把串口日志中的敏感内容或 ChatGPT 登录文件提交到公开仓库。
- ESP32 不保存 ChatGPT 登录令牌；登录状态只存在于运行 Codex 的 Mac。
- 桥接服务监听局域网所有网卡且没有登录验证，只应在可信家庭网络中使用。
- 不要把 8787 端口映射到公网。

## 十七、开发与验证

修改桥接代码后：

```bash
npm test
```

修改固件后：

```bash
uv run platformio run -d firmware
uv run platformio run -d firmware \
  --target upload \
  --upload-port /dev/cu.usbmodem11201
```

修改桥接代码后，后台服务用户可重新运行 `npm run service:install` 以重启并更新配置；手动运行用户需重启 `npm start`。修改固件代码后必须重新烧录。

## 当前限制

- 已针对 macOS 和一块具体的 ESP32-S3 NANO 验证；Windows/Linux 的串口名和自启动方式不同。
- Mac 必须开机并运行桥接服务。
- Mac IP 改变后需要通过配网页面更新 Bridge URL；当前版本尚未实现 mDNS 自动发现。
- 屏幕只显示前两个运行任务，但 `RUNNING` 数字表示全部运行任务数量。
- 中文字体覆盖 GB2312 常用简体字，不覆盖所有 Unicode。
- Codex App Server 或本地 rollout 格式如果将来改变，桥接解析可能需要同步更新。

## 十八、3D 打印文件预览器

`viewer/` 是独立的浏览器端预览器，文件只在本机解析，不会上传。当前支持：

- STL、3MF、OBJ、AMF、PLY、STEP/STP 模型导入
- 多个独立零件连续添加、自动平铺和零件列表选择
- 在 3D 画布直接点击选择零件，并用三轴操纵器移动、旋转和缩放
- 世界/局部坐标切换，1 mm、15°、0.1 倍变换吸附，以及 W / E / R / Q 快捷键
- XYZ 精确数值编辑，零件居中、贴合热床、复制、复位、删除和清空装配
- G-code 打印路径和逐层查看
- 尺寸、三角面数和网格数量统计
- 哑光塑料、半透明 PETG 和金属外观
- Rapier 重力、摩擦、打印床及其他装配零件碰撞演示
- 仓库现有前壳、后壳、支架及 G-code 内置示例

首次安装依赖：

```bash
npm run viewer:install
```

启动开发服务器：

```bash
npm run viewer:dev
```

然后打开 `http://localhost:4173/`。生产构建和本地预览分别使用：

```bash
npm run viewer:build
npm run viewer:preview
```

预览器基于 Online3DViewer、GCode Preview、Three.js 和 Rapier。生产构建会把三个内置 STL 示例复制进 `viewer/dist/assets/`，因此构建产物体积会包含这些模型。

完成以上步骤后，任何拥有相同硬件、Codex 登录环境和同一局域网的人，都可以从零复现这块桌面状态屏。
