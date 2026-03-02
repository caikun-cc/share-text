# 共享记事本

一个支持多用户实时协作的共享记事本应用，用户可以在同一个记事本上同时编辑内容，并查看其他在线用户的信息。

## 功能特性

- **实时协作编辑**：多个用户可以同时编辑同一个记事本，所有更改会实时同步到所有连接的客户端
- **用户信息管理**：用户可以在右上角编辑自己的用户名和颜色偏好
- **用户信息持久化**：用户信息自动保存在浏览器本地存储中，刷新页面后依然保持
- **在线用户列表**：右侧显示当前在线的所有用户及其状态
- **输入状态指示**：可以看到哪些用户正在输入内容
- **连接状态监控**：实时显示与服务器的连接状态
- **GitHub黑色主题**：采用GitHub风格的黑色主题设计，更加护眼美观

## 技术架构

- **前端**：原生HTML、CSS（GitHub黑色模式）、JavaScript，使用WebSocket进行实时通信
- **后端**：Node.js + Koa.js + WebSocket

## 安装和部署

### 环境要求

- Node.js (版本 >= 14.x)
- npm (随Node.js一起安装)

### 安装步骤

1. **克隆或下载项目代码**
   
   ```bash
   git clone <repository-url>
   # 或者直接下载ZIP文件解压
   ```

2. **进入项目目录**
   
   ```bash
   cd share-text
   ```

3. **安装依赖包**
   
   ```bash
   npm install
   ```
   
   这将安装以下依赖：
   
   - `koa`: 用于创建Web服务器
   - `koa-static`: 用于静态文件服务
   - `ws`: 用于WebSocket实时通信
   - `nodemon`: 用于开发模式下的热重载（可选）

4. **启动服务器**
   
   ```bash
   # 生产模式
   npm start
   
   # 开发模式（自动重载）
   npm run dev
   ```

### Docker部署（可选）

如果您的环境中安装了Docker，也可以使用Docker进行部署：

1. **构建Docker镜像**
   
   ```bash
   docker build -t share-text .
   ```

2. **运行容器**
   
   ```bash
   docker run -p 3000:3000 share-text
   ```

## 使用说明

### 基础使用

1. **启动应用**：按照上述步骤启动服务器
2. **访问应用**：在浏览器中打开 `http://localhost:3000`
3. **编辑内容**：在中央的大编辑区域可以直接输入和编辑内容
4. **查看状态**：右上角显示连接状态，右侧显示在线用户列表

### 用户信息管理

1. **编辑用户信息**：点击右上角的"编辑"按钮
2. **修改用户名**：在弹出的对话框中输入新的用户名
3. **选择颜色**：使用颜色选择器选择代表您的颜色
4. **保存设置**：点击"保存"按钮应用更改
5. **信息持久化**：设置将自动保存到浏览器本地存储

### 协作功能

1. **多人编辑**：多个用户可以同时编辑同一个记事本
2. **实时同步**：所有更改会立即同步到所有连接的客户端
3. **用户状态**：右侧列表显示在线用户及其状态
4. **输入指示**：当其他用户正在输入时会有提示

## 配置选项

### 环境变量

- `PORT`：指定服务器端口（默认为3000）
- `NODE_ENV`：指定环境模式（production/development）

示例：

```bash
PORT=8080 NODE_ENV=production npm start
```

### 自定义配置

您可以在 `package.json` 中修改以下配置：

- `main`：主服务器文件路径
- `scripts.start`：启动命令
- `scripts.dev`：开发模式命令

## 项目结构

```
share-text/
├── server.js         # Koa.js服务器主文件
├── logger.js         # 服务器端日志工具
├── package.json      # 项目配置和依赖
├── package-lock.json # 依赖锁定文件
├── static/           # 静态资源目录
│   ├── index.html    # 前端页面
│   ├── style.css     # 样式文件 (GitHub黑色模式)
│   ├── script.js     # JavaScript文件
│   └── logger.js     # 前端日志工具
└── README.md         # 项目说明文档
```

## API接口

### WebSocket端点

- **URL**: `/ws`
- **协议**: WebSocket
- **功能**: 实时通信

### 消息类型

#### 客户端发送消息

1. **join** - 用户加入
   
   ```json
   {
     "type": "join",
     "user": {
       "id": "user_id",
       "username": "用户名",
       "color": "#颜色代码"
     }
   }
   ```

2. **update** - 内容更新
   
   ```json
   {
     "type": "update",
     "content": "记事本内容",
     "userId": "用户ID"
   }
   ```

3. **typing** - 正在输入状态
   
   ```json
   {
     "type": "typing",
     "isTyping": true,
     "userId": "用户ID"
   }
   ```

4. **userUpdate** - 用户信息更新
   
   ```json
   {
     "type": "userUpdate",
     "user": {
       "id": "user_id",
       "username": "新用户名",
       "color": "#新颜色代码"
     }
   }
   ```

5. **leave** - 用户离开
   
   ```json
   {
     "type": "leave",
     "userId": "用户ID"
   }
   ```

#### 服务器发送消息

1. **init** - 初始化数据
   
   ```json
   {
     "type": "init",
     "content": "当前记事本内容",
     "users": [用户列表]
   }
   ```

2. **update** - 内容更新通知
   
   ```json
   {
     "type": "update",
     "content": "新内容",
     "userId": "发送者ID"
   }
   ```

3. **users** - 用户列表更新
   
   ```json
   {
     "type": "users",
     "users": [当前在线用户列表]
   }
   ```

4. **userJoined** - 用户加入通知
   
   ```json
   {
     "type": "userJoined",
     "user": {用户信息},
     "users": [更新后的用户列表]
   }
   ```

5. **userLeft** - 用户离开通知
   
   ```json
   {
     "type": "userLeft",
     "user": {用户信息},
     "users": [更新后的用户列表]
   }
   ```

6. **userUpdate** - 用户信息更新通知
   
   ```json
   {
     "type": "userUpdate",
     "user": {更新后的用户信息},
     "users": [更新后的用户列表]
   }
   ```

7. **typing** - 正在输入状态通知
   
   ```json
   {
     "type": "typing",
     "userId": "用户ID",
     "isTyping": true
   }
   ```

## 故障排除

### 常见问题

1. **无法连接到服务器**
   
   - 检查服务器是否已启动
   - 确认端口未被其他程序占用
   - 检查防火墙设置

2. **连接状态显示"已断开连接"**
   
   - 确保通过HTTP协议访问（不是file://）
   - 检查浏览器控制台是否有错误信息
   - 确认WebSocket连接未被代理或防火墙阻止

3. **内容不同步**
   
   - 确认所有客户端都连接到同一服务器
   - 检查网络连接是否稳定
   - 查看服务器日志是否有错误

4. **用户信息不保存**
   
   - 确认浏览器启用了localStorage
   - 检查浏览器隐私设置
   - 尝试清除缓存后重新加载

### 开发调试

1. **服务器日志**：服务器启动后会显示连接信息和各种操作日志
2. **浏览器控制台**：按F12打开开发者工具查看前端日志
3. **网络面板**：检查WebSocket连接状态和消息传输

## 依赖项

- `koa`: 用于创建Web服务器
- `koa-static`: 用于静态文件服务
- `ws`: 用于WebSocket实时通信
- `nodemon`: 用于开发模式下的热重载

## 数据持久化

- **用户信息**：通过浏览器的 localStorage API 保存在本地
- **记事本内容**：保存在服务器内存中，重启后会丢失
- **连接状态**：每次连接时重新初始化

## 浏览器兼容性

支持现代浏览器，包括：

- Chrome (版本 >= 60)
- Firefox (版本 >= 55)
- Safari (版本 >= 12)
- Edge (版本 >= 79)

## 开发模式

如果需要实时重载功能，可以使用以下命令启动开发模式：

```bash
npm run dev
```

（需要先安装 nodemon: `npm install -g nodemon`）

## 贡献指南

1. Fork 项目
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

## 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。

## 致谢

- 感谢所有贡献者的努力
- 感谢开源社区的支持
- 特别感谢 Koa.js 和 ws 库的开发者