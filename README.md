# 共享记事本

一个支持多用户实时协作编辑的在线共享记事本应用。基于 WebSocket 实现即时通讯，多个用户可以同时编辑同一份文档，所有更改会实时同步到每个用户的屏幕上

## 使用

```bash
npm install
npm start
```

访问 http://localhost:8011

## 功能

- 实时协作编辑
- Markdown 预览
- 用户状态管理

## 技术栈

- 前端：原生 HTML + CSS + JavaScript
- 后端：Node.js + Koa.js + WebSocket
