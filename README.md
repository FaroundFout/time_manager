# 时间管理程序

一个基于每日 Markdown 作息表的 Windows 本地时间管理桌面程序。

它可以把一份简单的 Markdown 日程解析成每日作息时间线，并在阶段开始、阶段结束时提醒用户确认。程序支持托盘隐藏、提醒窗口、系统通知、SQLite 本地持久化和历史作息归档。

## 下载安装

最新版本：

- [时间管理程序 0.2.0 Release](https://github.com/FaroundFout/time_manager/releases/tag/v0.2.0)
- Windows x64 安装包：`time-manager_0.2.0_x64-setup.exe`

安装后直接运行即可。

> 当前版本未做代码签名，Windows 可能会提示未知发布者。

## 主要功能

- Markdown 作息表解析
- 每日作息日自动定位
- 跨午夜作息支持
- 阶段开始 / 阶段结束确认
- 提前结束当前阶段
- 立即进入下一阶段
- 突发事件记录
- 自动生成空档时间段
- 今日时间线展示
- 多作息日历史归档
- 设置页管理提醒参数
- 独立置顶提醒窗口
- Windows 系统通知
- 系统提示音提醒
- 系统托盘
- 关闭窗口时隐藏到托盘
- 单实例运行
- SQLite 本地持久化

## 作息表格式

示例：

~~~md
日程起点: 08:00

- 08:00-08:30 起床
- 08:30-09:00 早餐
- 09:00-11:30 学习 # 备注：数学
- 11:30-13:00 午饭
- 13:00-14:30 学习
- 14:30-15:00 休息
~~~

支持：

- 中文冒号：`日程起点：08:00`
- 英文冒号：`日程起点: 08:00`
- 阶段备注
- 跨午夜时间段
- 重复阶段名称

## 使用方式

1. 首次启动时选择 Markdown 作息文件
2. 解析成功后确认启用
3. 在“今日”页面查看当前作息日和时间线
4. 到达阶段开始或结束时间后，根据提醒进行确认
5. 在“历史”页面查看已归档的作息日
6. 在“设置”页面调整提醒间隔、声音模式等选项

## 数据存储

程序使用 SQLite 进行本地持久化。

用户数据目录：

~~~text
%APPDATA%/com.wang.time-manager
~~~

主要数据文件：

~~~text
time-manager.db
~~~

卸载程序不会主动删除用户数据目录。

## 开发环境

需要安装：

- Node.js
- npm
- Rust
- Cargo
- Windows WebView2 Runtime

安装依赖：

~~~bash
npm install
~~~

运行前端开发模式：

~~~bash
npm run dev
~~~

运行 Tauri 桌面开发模式：

~~~bash
npm run desktop:dev
~~~

运行测试：

~~~bash
npm test
cargo test --manifest-path src-tauri/Cargo.toml
~~~

构建前端：

~~~bash
npm run build
~~~

构建 Windows 安装包：

~~~bash
npm run desktop:build
~~~

安装包输出位置：

~~~text
src-tauri/target/release/bundle/nsis/
~~~

## 当前版本

版本：`0.2.0`

发布者：`WANG`

平台：Windows x64

## 已知限制

- 暂未代码签名
- 暂未实现自动更新
- 暂未实现数据导出
- 暂未实现数据加密
- 暂未实现云同步
- 当前主要面向 Windows 桌面环境

## 技术栈

- React
- TypeScript
- Vite
- Tauri 2
- Rust
- SQLite
- Vitest

## License

当前项目暂未指定开源协议。
