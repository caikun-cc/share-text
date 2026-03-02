// 全局变量
let currentUser = {
    id: null,
    username: '匿名用户',
    color: '#238636'
};
let ws = null;
let isConnecting = false;

// DOM元素
const editor = document.getElementById('editor');
const userList = document.getElementById('user-list');
const displayUsername = document.getElementById('display-username');
const displayColor = document.getElementById('display-color');
const editUserModal = document.getElementById('edit-user-modal');
const inputUsername = document.getElementById('input-username');
const inputColor = document.getElementById('input-color');
const connectionStatus = document.getElementById('connection-status');

// 初始化应用
function initApp() {
    loadUserInfoFromStorage();
    updateUserDisplay();
    connectWebSocket();
    
    // 监听编辑器变化
    editor.addEventListener('input', function() {
        if (ws && ws.readyState === WebSocket.OPEN) {
            // 发送内容更新
            ws.send(JSON.stringify({
                type: 'update',
                content: editor.value,
                userId: currentUser.id
            }));
            
            // 发送正在输入状态
            sendTypingStatus(true);
            
            // 清除之前的定时器
            if (window.typingTimeout) {
                clearTimeout(window.typingTimeout);
            }
            
            // 设置新的定时器停止输入状态
            window.typingTimeout = setTimeout(() => {
                sendTypingStatus(false);
            }, 1000);
        }
    });
}

// 从本地存储加载用户信息
function loadUserInfoFromStorage() {
    const savedUser = localStorage.getItem('sharedNotebookUser');
    if (savedUser) {
        const parsed = JSON.parse(savedUser);
        currentUser.username = parsed.username || '匿名用户';
        currentUser.color = parsed.color || '#238636'; // GitHub绿色
        currentUser.id = parsed.id || generateUserId();
    } else {
        currentUser.id = generateUserId();
        saveUserInfoToStorage();
    }
}

// 保存用户信息到本地存储
function saveUserInfoToStorage() {
    const userToSave = {
        id: currentUser.id,
        username: currentUser.username,
        color: currentUser.color
    };
    localStorage.setItem('sharedNotebookUser', JSON.stringify(userToSave));
}

// 生成用户ID
function generateUserId() {
    return 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// 更新用户信息显示
function updateUserDisplay() {
    displayUsername.textContent = currentUser.username;
    
    // 更新头像显示
    const avatarElement = document.getElementById('display-avatar');
    if (avatarElement) {
        avatarElement.textContent = currentUser.username.charAt(0).toUpperCase();
        avatarElement.style.backgroundColor = currentUser.color;
        avatarElement.style.color = getContrastColor(currentUser.color);
    }
}

// 获取对比色（用于文字颜色）
function getContrastColor(hexColor) {
    // 将十六进制颜色转换为RGB
    const r = parseInt(hexColor.substr(1, 2), 16);
    const g = parseInt(hexColor.substr(3, 2), 16);
    const b = parseInt(hexColor.substr(5, 2), 16);
    
    // 计算亮度
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    
    // 如果亮度小于128，则返回白色，否则返回黑色
    return brightness < 128 ? '#ffffff' : '#000000';
}

// 打开编辑用户信息模态框
function openEditUserModal() {
    inputUsername.value = currentUser.username;
    inputColor.value = currentUser.color;
    editUserModal.style.display = 'flex';
}

// 关闭编辑用户信息模态框
function closeEditUserModal() {
    editUserModal.style.display = 'none';
}

// 保存用户信息
function saveUserInfo() {
    const newUsername = inputUsername.value.trim() || '匿名用户';
    const newColor = inputColor.value || '#238636';
    
    // 更新当前用户信息
    currentUser.username = newUsername;
    currentUser.color = newColor;
    
    // 保存到本地存储
    saveUserInfoToStorage();
    
    // 更新显示
    updateUserDisplay();
    
    // 关闭模态框
    closeEditUserModal();
    
    // 通知服务器用户信息已更新
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'userUpdate',
            user: {
                id: currentUser.id,
                username: currentUser.username,
                color: currentUser.color
            }
        }));
    }
}

// 连接WebSocket
function connectWebSocket() {
    if (isConnecting) return;
    
    isConnecting = true;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    try {
        ws = new WebSocket(wsUrl);
        
        ws.onopen = function(event) {
            console.log('WebSocket连接已建立');
            connectionStatus.textContent = '已连接';
            connectionStatus.className = 'connection-status connected';
            
            // 发送加入消息
            ws.send(JSON.stringify({
                type: 'join',
                user: {
                    id: currentUser.id,
                    username: currentUser.username,
                    color: currentUser.color
                }
            }));
        };
        
        ws.onmessage = function(event) {
            const data = JSON.parse(event.data);
            handleMessage(data);
        };
        
        ws.onclose = function(event) {
            console.log('WebSocket连接已关闭');
            connectionStatus.textContent = '已断开连接';
            connectionStatus.className = 'connection-status disconnected';
            
            // 尝试重连
            setTimeout(() => {
                isConnecting = false;
                connectWebSocket();
            }, 3000);
        };
        
        ws.onerror = function(error) {
            console.error(`WebSocket错误: ${error.message || error}`);
            connectionStatus.textContent = '连接错误';
            connectionStatus.className = 'connection-status disconnected';
        };
    } catch (error) {
        console.error(`WebSocket连接失败: ${error.message || error}`);
        connectionStatus.textContent = '连接失败';
        connectionStatus.className = 'connection-status disconnected';
        isConnecting = false;
        
        // 尝试重连
        setTimeout(connectWebSocket, 3000);
    }
}

// 处理WebSocket消息
function handleMessage(data) {
    switch (data.type) {
        case 'init':
            // 初始化内容
            editor.value = data.content || '';
            updateUserList(data.users || []);
            break;
            
        case 'update':
            // 更新内容（如果不是自己发送的）
            if (data.userId !== currentUser.id) {
                editor.value = data.content || '';
            }
            break;
            
        case 'users':
            // 更新用户列表
            updateUserList(data.users || []);
            break;
            
        case 'userJoined':
            // 用户加入
            console.log(`用户 ${data.user.username} 加入`);
            updateUserList(data.users || []);
            break;
            
        case 'userLeft':
            // 用户离开
            console.log(`用户 ${data.user.username} 离开`);
            updateUserList(data.users || []);
            break;
            
        case 'userUpdate':
            // 用户信息更新
            updateUserList(data.users || []);
            break;
            
        case 'typing':
            // 显示正在输入状态
            showTypingStatus(data.userId, data.isTyping);
            break;
    }
}

// 更新用户列表
function updateUserList(users) {
    userList.innerHTML = '';
    
    users.forEach(user => {
        const li = document.createElement('li');
        li.className = 'user-item';
        
        const avatar = document.createElement('div');
        avatar.className = 'user-avatar';
        avatar.style.backgroundColor = user.color;
        avatar.style.color = getContrastColor(user.color);
        avatar.textContent = user.username.charAt(0).toUpperCase();
        
        const name = document.createElement('div');
        name.className = 'user-name';
        name.textContent = user.username;
        
        li.appendChild(avatar);
        li.appendChild(name);
        
        // 添加输入状态指示器
        if (window.typingUsers && window.typingUsers[user.id]) {
            const typingIndicator = document.createElement('div');
            typingIndicator.className = 'typing-indicator';
            typingIndicator.id = `typing-${user.id}`;
            typingIndicator.textContent = '正在输入...';
            li.appendChild(typingIndicator);
        }
        
        userList.appendChild(li);
    });
}

// 发送正在输入状态
function sendTypingStatus(isTyping) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'typing',
            isTyping: isTyping,
            userId: currentUser.id
        }));
    }
}

// 显示正在输入状态
function showTypingStatus(userId, isTyping) {
    if (!window.typingUsers) {
        window.typingUsers = {};
    }
    
    window.typingUsers[userId] = isTyping;
    
    // 更新用户列表中的输入状态
    updateUserList(Array.from(userList.children).map(li => {
        // 这里我们重新获取完整的用户列表而不是从DOM中提取
        // 因此我们将在收到users消息时更新整个列表
    }));
    
    // 临时更新特定用户的输入状态显示
    const typingElement = document.getElementById(`typing-${userId}`);
    if (typingElement) {
        typingElement.style.display = isTyping ? 'block' : 'none';
    }
}

// 页面加载完成后的初始化
document.addEventListener('DOMContentLoaded', initApp);

// 监听窗口关闭事件，发送离开消息
window.addEventListener('beforeunload', function() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'leave',
            userId: currentUser.id
        }));
    }
});

// 模态框外部点击关闭
window.onclick = function(event) {
    if (event.target === editUserModal) {
        closeEditUserModal();
    }
}