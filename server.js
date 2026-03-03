const Koa = require('koa');
const serve = require('koa-static');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { logger } = require('./logger');

// 创建Koa应用
const app = new Koa();

// 提供静态文件服务
app.use(serve(path.join(__dirname, 'static')));

// 创建HTTP服务器
const server = http.createServer(app.callback());

// 创建WebSocket服务器
const wss = new WebSocket.Server({ server, path: '/ws' });

// 共享记事本内容
let sharedContent = '';

// 存储所有连接的用户
const users = new Map();

// 广播消息给所有连接的客户端
function broadcast(message, excludeClient = null) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client !== excludeClient) {
            client.send(JSON.stringify(message));
        }
    });
}

// 广播用户列表给所有连接的客户端
function broadcastUsers(excludeClient = null) {
    const userList = Array.from(users.values());
    broadcast({ type: 'users', users: userList }, excludeClient);
}

// WebSocket连接处理
wss.on('connection', (ws, req) => {
    logger.info(`New client connected: ${req.socket.remoteAddress}`);

    // 发送初始数据给新连接的客户端
    ws.send(JSON.stringify({
        type: 'init',
        content: sharedContent,
        users: Array.from(users.values())
    }));

    // 处理客户端消息
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);

            switch (message.type) {
                case 'join':
                    // 用户加入
                    users.set(ws, message.user);
                    logger.info(`User ${message.user.username} joined`);

                    // 广播用户加入消息
                    broadcast({
                        type: 'userJoined',
                        user: message.user,
                        users: Array.from(users.values())
                    });

                    // 广播更新后的用户列表
                    broadcastUsers();
                    break;

                case 'update':
                    // 内容更新
                    sharedContent = message.content || '';
                    logger.info(`Content updated (${(message.content || '').length} characters)`);

                    // 广播更新给其他所有客户端
                    broadcast({
                        type: 'update',
                        content: sharedContent,
                        userId: message.userId
                    }, ws);
                    break;

                case 'typing':
                    // 正在输入状态
                    broadcast({
                        type: 'typing',
                        userId: message.userId,
                        isTyping: message.isTyping
                    }, ws);
                    break;

                case 'userUpdate':
                    // 用户信息更新
                    if (users.has(ws)) {
                        users.set(ws, message.user);
                        logger.info(`${message.user.username} updated info`);

                        // 广播用户信息更新
                        broadcast({
                            type: 'userUpdate',
                            user: message.user,
                            users: Array.from(users.values())
                        });
                    }
                    break;

                case 'leave':
                    // 用户主动离开（通过消息）
                    if (users.has(ws)) {
                        const user = users.get(ws);
                        logger.info(`${user.username} left connection`);

                        // 删除用户
                        users.delete(ws);

                        // 广播用户离开消息
                        broadcast({
                            type: 'userLeft',
                            user: user,
                            users: Array.from(users.values())
                        });

                        // 广播更新后的用户列表
                        broadcastUsers();
                    }
                    break;

                default:
                    logger.warn(`Unknown message type: ${message.type}`);
            }
        } catch (error) {
            logger.error(`Error parsing message: ${error.message || error}`);
        }
    });

    // 处理连接关闭
    ws.on('close', () => {
        if (users.has(ws)) {
            const user = users.get(ws);
            logger.info(`${user.username} disconnected`);

            // 删除用户
            users.delete(ws);

            // 广播用户离开消息
            broadcast({
                type: 'userLeft',
                user: user,
                users: Array.from(users.values())
            });

            // 广播更新后的用户列表
            broadcastUsers();
        }
    });

    // 处理连接错误
    ws.on('error', (error) => {
        logger.error(`WebSocket error: ${error.message || error}`);
        if (users.has(ws)) {
            const user = users.get(ws);
            logger.error(`User connection error: ${user.username}`);

            // 删除用户
            users.delete(ws);

            // 广播用户离开消息
            broadcast({
                type: 'userLeft',
                user: user,
                users: Array.from(users.values())
            });

            // 广播更新后的用户列表
            broadcastUsers();
        }
    });
});

// 启动服务器
const PORT = process.env.PORT || 8011;
server.listen(PORT, () => {
    logger.info(`Koa server running on port ${PORT}`);
    console.log(`Visit: http://localhost:${PORT}`);
});

module.exports = server;