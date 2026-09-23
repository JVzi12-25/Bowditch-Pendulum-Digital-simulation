# Bowditch-Pendulum-Digital-simulation
This way we can learn Bowditch Pendulum principle easily.

## 在线仿真

网页支持调整 Y 形摆的支点间距、三段绳长、初始振幅、相位差与阻尼；实时显示装置运动、水平李萨如轨迹和两方向位移，也可导出 40 秒的 CSV 数据。

在 [GitHub Pages](https://jvzi12-25.github.io/Bowditch-Pendulum-Digital-simulation/) 使用，或下载仓库后打开 `site/index.html` 离线使用。

## 模型说明

采用质量可忽略的节点和近似解耦的两个阻尼单摆。设节点在支点连线下的垂距为 `h`，两方向的有效摆长为 `Lₓ=l₃`、`Lᵧ=h+l₃`。数值积分 `θ̈ + 2βθ̇ + (g/L)sinθ=0`，以摆球水平投影生成轨迹。模型用于探索趋势，未求解完整绳张力、绳松弛及模态耦合。

注：[IYPT 官方赛题](https://iypt.org/iypt-2027-problems/)将 Y-shaped pendulum 列为 **2027 年第 5 题**。
