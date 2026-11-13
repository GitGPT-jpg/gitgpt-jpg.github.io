# 江尘 · 一束光，从智利到北京

> 在线预览：https://gitgpt-jpg.github.io/

科技感个人主页第二版。点状画布世界地图上，一束光从智利飞向北京（真实航线走向：经欧洲上空），点击两端可以进入我在那里的经历。

## 技术

纯 HTML + CSS + JavaScript，无框架、无构建步骤、无外部依赖：

- 开场从圣地亚哥上空拉远，使用 NASA [Blue Marble 陆地、海洋、海冰与云层合成影像](https://visibleearth.nasa.gov/images/57735/the-blue-marble-land-surface-ocean-color-sea-ice-and-clouds) 和仓库中的夜光纹理预渲染。静音短片与首帧随站点分发，支持跳过与减少动态效果。
- Canvas 手绘点状世界地图（Miller 投影 + 点阵采样）
- 光弧航线：三层辉光 + 流光动画，按两地时区实时显示「光行时间」
- 响应式：宽屏展示地图全景，窄屏自动切换为卡片模式
- 磨砂玻璃质感介绍卡、标签防遮挡自适应布局
- 内置测试：`node --test`

## 本地预览

```bash
python3 -m http.server 47613
# 浏览器打开 http://127.0.0.1:47613/
```

## 部署

纯静态文件，由 GitHub Pages 托管 `main` 分支，推送到仓库即自动更新。
