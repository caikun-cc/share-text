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

// 全局版本号
let globalVersion = 0;

// 存储所有连接的用户（包含光标位置）
const users = new Map();

// 操作历史（保留最近100条用于新用户同步）
const operationHistory = [];
const MAX_HISTORY = 100;

// 服务器端 OT 转换函数
// 将 clientOp 转换，使其能正确应用于 serverOp 之后的状态
function transformOperation(clientOp, serverOp, serverUserId, clientUserId) {
    const transformedOp = { ...clientOp };
    
    if (transformedOp.type === 'insert') {
        if (serverOp.type === 'insert') {
            if (serverOp.position < transformedOp.position) {
                transformedOp.position += serverOp.content.length;
            } else if (serverOp.position === transformedOp.position) {
                if (serverUserId < clientUserId) {
                    transformedOp.position += serverOp.content.length;
                }
            }
        } else if (serverOp.type === 'delete') {
            if (serverOp.position + serverOp.length <= transformedOp.position) {
                transformedOp.position -= serverOp.length;
            } else if (serverOp.position < transformedOp.position) {
                transformedOp.position = serverOp.position;
            }
        }
    } else if (transformedOp.type === 'delete') {
        if (serverOp.type === 'insert') {
            if (serverOp.position <= transformedOp.position) {
                transformedOp.position += serverOp.content.length;
            } else if (serverOp.position < transformedOp.position + transformedOp.length) {
                transformedOp.length += serverOp.content.length;
            }
        } else if (serverOp.type === 'delete') {
            if (serverOp.position + serverOp.length <= transformedOp.position) {
                transformedOp.position -= serverOp.length;
            } else if (serverOp.position < transformedOp.position) {
                const overlapLen = Math.min(serverOp.position + serverOp.length, transformedOp.position + transformedOp.length) - transformedOp.position;
                transformedOp.position = serverOp.position;
                transformedOp.length -= overlapLen;
                if (transformedOp.length < 0) {
                    transformedOp.length = 0;
                }
            } else if (serverOp.position < transformedOp.position + transformedOp.length) {
                const overlapLen = Math.min(serverOp.position + serverOp.length, transformedOp.position + transformedOp.length) - serverOp.position;
                transformedOp.length -= overlapLen;
                if (transformedOp.length < 0) {
                    transformedOp.length = 0;
                }
            }
        }
    }

    return transformedOp;
}

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

// 应用操作到内容
function applyOperation(content, operation) {
    if (operation.type === 'insert') {
        return content.slice(0, operation.position) + operation.content + content.slice(operation.position);
    } else if (operation.type === 'delete') {
        return content.slice(0, operation.position) + content.slice(operation.position + operation.length);
    }
    return content;
}

// 记录操作到历史
function recordOperation(operation) {
    operationHistory.push(operation);
    if (operationHistory.length > MAX_HISTORY) {
        operationHistory.shift();
    }
}

// WebSocket连接处理
wss.on('connection', (ws, req) => {
    logger.info(`New client connected: ${req.socket.remoteAddress}`);

    // 发送初始数据给新连接的客户端
    ws.send(JSON.stringify({
        type: 'init',
        content: sharedContent,
        version: globalVersion,
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
                    // 内容更新（兼容旧版本，仍保留）
                    sharedContent = message.content || '';
                    logger.info(`Content updated (${(message.content || '').length} characters)`);

                    // 广播更新给其他所有客户端
                    broadcast({
                        type: 'update',
                        content: sharedContent,
                        userId: message.userId
                    }, ws);
                    break;

                case 'operation':
                    // OT操作更新
                    const op = message.operation;
                    if (!op || !op.type) {
                        logger.warn('Invalid operation received');
                        break;
                    }

                    // 对操作进行 OT 转换（基于历史操作）
                    let transformedOp = { ...op };
                    const clientVersion = message.version || 0;
                    
                    // 如果操作版本落后，需要基于历史操作进行转换
                    // 历史操作记录的是服务器实际应用的操作（转换后的操作）
                    if (clientVersion < globalVersion) {
                        const opsToTransform = operationHistory.filter(h => h.version > clientVersion);
                        for (const historyOp of opsToTransform) {
                            transformedOp = transformOperation(
                                transformedOp, 
                                historyOp, 
                                historyOp.userId, 
                                message.userId
                            );
                        }
                        if (op.position !== transformedOp.position) {
                            logger.info(`Operation transformed: ${op.type} at ${op.position} -> at ${transformedOp.position}`);
                        }
                    }

                    // 应用转换后的操作
                    sharedContent = applyOperation(sharedContent, transformedOp);
                    globalVersion++;

                    // 记录转换后的操作（用于后续OT转换）
                    const recordedOp = {
                        ...transformedOp,
                        version: globalVersion,
                        userId: message.userId,
                        timestamp: Date.now()
                    };
                    recordOperation(recordedOp);

                    logger.info(`Operation applied: ${transformedOp.type} at ${transformedOp.position}, version: ${globalVersion}`);

                    // 广播转换后的操作给其他客户端
                    broadcast({
                        type: 'operation',
                        operation: {
                            type: transformedOp.type,
                            position: transformedOp.position,
                            content: transformedOp.content,
                            length: transformedOp.length
                        },
                        userId: message.userId,
                        version: globalVersion
                    }, ws);

                    // 发送确认给操作者
                    ws.send(JSON.stringify({
                        type: 'ack',
                        version: globalVersion,
                        operationId: message.operationId,
                        content: sharedContent  // 发送当前内容
                    }));
                    break;

                case 'typing':
                    // 正在输入状态
                    broadcast({
                        type: 'typing',
                        userId: message.userId,
                        isTyping: message.isTyping
                    }, ws);
                    break;

                case 'cursor':
                    // 光标位置更新
                    if (users.has(ws)) {
                        const user = users.get(ws);
                        user.cursorPosition = message.position;
                        users.set(ws, user);

                        // 广播光标位置给其他客户端
                        broadcast({
                            type: 'cursor',
                            userId: message.userId,
                            username: user.username,
                            color: user.color,
                            position: message.position
                        }, ws);
                    }
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