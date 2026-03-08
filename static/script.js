let currentUser = {
    id: null,
    username: '匿名用户',
    color: '#6366f1'
};
let ws = null;
let isConnecting = false;
let previewEnabled = false;

// 存储其他用户的光标位置
let userCursors = {};

// 光标超时时间（毫秒）
const CURSOR_DIM_TIMEOUT = 5000;  // 5秒后变暗淡
const CURSOR_HIDE_TIMEOUT = 30000; // 30秒后隐藏

// OT 状态管理
let localVersion = 0;           // 本地版本号
let pendingOps = [];            // 待确认的操作队列
let lastContent = '';           // 上次的内容（用于差异计算）
let operationIdCounter = 0;     // 操作ID计数器
let isApplyingRemoteOp = false; // 是否正在应用远程操作

// IME 组合输入状态
let isComposing = false;        // 是否正在输入法组合输入
let contentBeforeCompose = '';  // 组合输入前的内容
let pendingInputTimeout = null; // 延迟处理 input 的定时器

const editor = document.getElementById('editor');
const userList = document.getElementById('user-list');
const displayUsername = document.getElementById('display-username');
const editUserModal = document.getElementById('edit-user-modal');
const inputUsername = document.getElementById('input-username');
const inputColor = document.getElementById('input-color');
const connectionStatus = document.getElementById('connection-status');
const charCount = document.getElementById('char-count');
const onlineCount = document.getElementById('online-count');
const colorPreview = document.getElementById('color-preview');
const previewToggleBtn = document.getElementById('preview-toggle-btn');
const previewContent = document.getElementById('preview-content');
const editorWrapper = document.querySelector('.editor-wrapper');
const cursorLayer = document.getElementById('cursor-layer');

function initApp() {
    loadUserInfoFromStorage();
    updateUserDisplay();
    initPreview();
    connectWebSocket();

    editor.addEventListener('input', function (e) {
        updateCharCount();
        updatePreview();

        // 如果是应用远程操作触发的，跳过
        if (isApplyingRemoteOp) {
            lastContent = editor.value;
            return;
        }

        // 检查是否是 IME 组合输入
        // 使用 inputType 检测组合输入是最可靠的方法
        if (e && e.inputType === 'insertCompositionText') {
            return;
        }

        // 如果正在组合输入，跳过
        if (isComposing) {
            return;
        }

        // 使用延迟处理，等待可能的 compositionstart 事件
        // 如果在短时间内触发了 compositionstart，则取消这次 input 处理
        if (pendingInputTimeout) {
            clearTimeout(pendingInputTimeout);
        }

        pendingInputTimeout = setTimeout(function () {
            pendingInputTimeout = null;
            
            // 再次检查是否正在组合输入
            if (isComposing || isApplyingRemoteOp) {
                return;
            }

            if (ws && ws.readyState === WebSocket.OPEN) {
                const operations = computeDiffOperations(lastContent, editor.value);

                operations.forEach(op => {
                    const adjustedOp = adjustOperationForPending(op);
                    const operationId = 'op_' + (++operationIdCounter);

                    pendingOps.push({
                        id: operationId,
                        operation: adjustedOp
                    });

                    ws.send(JSON.stringify({
                        type: 'operation',
                        operation: adjustedOp,
                        operationId: operationId,
                        userId: currentUser.id,
                        version: localVersion
                    }));
                });

                lastContent = editor.value;

                sendTypingStatus(true);

                if (window.typingTimeout) {
                    clearTimeout(window.typingTimeout);
                }

                window.typingTimeout = setTimeout(() => {
                    sendTypingStatus(false);
                }, 1000);
            }
        }, 10); // 10ms 延迟，足够让 compositionstart 事件触发
    });

    // IME 组合输入开始
    editor.addEventListener('compositionstart', function () {
        // 取消待处理的 input 事件
        if (pendingInputTimeout) {
            clearTimeout(pendingInputTimeout);
            pendingInputTimeout = null;
        }
        isComposing = true;
        contentBeforeCompose = lastContent;
    });

    // IME 组合输入结束
    editor.addEventListener('compositionend', function () {
        // 延迟处理，确保在最终的 input 事件之前完成
        setTimeout(function () {
            isComposing = false;
            
            // 计算组合输入完成后的差异并发送
            if (ws && ws.readyState === WebSocket.OPEN && !isApplyingRemoteOp) {
                const operations = computeDiffOperations(contentBeforeCompose, editor.value);

                operations.forEach(op => {
                    const adjustedOp = adjustOperationForPending(op);
                    const operationId = 'op_' + (++operationIdCounter);

                    pendingOps.push({
                        id: operationId,
                        operation: adjustedOp
                    });

                    ws.send(JSON.stringify({
                        type: 'operation',
                        operation: adjustedOp,
                        operationId: operationId,
                        userId: currentUser.id,
                        version: localVersion
                    }));
                });

                lastContent = editor.value;
            }
        }, 0);
    });

    // 监听光标位置变化
    editor.addEventListener('click', sendCursorPosition);
    editor.addEventListener('keyup', sendCursorPosition);
    editor.addEventListener('select', sendCursorPosition);

    // 监听滚动事件，更新光标位置
    editor.addEventListener('scroll', renderRemoteCursors);

    // 定时检查光标超时，每5秒更新一次
    setInterval(renderRemoteCursors, 5000);

    inputColor.addEventListener('input', function () {
        colorPreview.textContent = this.value.toUpperCase();
    });

    const chatInput = document.getElementById('chat-input');
    if (chatInput) {
        chatInput.addEventListener('keypress', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendChatMessage();
            }
        });

        chatInput.addEventListener('input', function () {
            this.style.height = 'auto';
            this.style.height = Math.min(this.scrollHeight, 120) + 'px';
        });
    }
}

function updateCharCount() {
    charCount.textContent = editor.value.length;
}

function loadUserInfoFromStorage() {
    const savedUser = localStorage.getItem('sharedNotebookUser');
    if (savedUser) {
        const parsed = JSON.parse(savedUser);
        currentUser.username = parsed.username || '匿名用户';
        currentUser.color = parsed.color || '#6366f1';
        currentUser.id = parsed.id || generateUserId();
    } else {
        currentUser.id = generateUserId();
        saveUserInfoToStorage();
    }
}

function saveUserInfoToStorage() {
    const userToSave = {
        id: currentUser.id,
        username: currentUser.username,
        color: currentUser.color
    };
    localStorage.setItem('sharedNotebookUser', JSON.stringify(userToSave));
}

function generateUserId() {
    return 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function updateUserDisplay() {
    displayUsername.textContent = currentUser.username;

    const avatarElement = document.getElementById('display-avatar');
    if (avatarElement) {
        avatarElement.textContent = currentUser.username.charAt(0).toUpperCase();
        avatarElement.style.backgroundColor = currentUser.color;
        avatarElement.style.color = getContrastColor(currentUser.color);
    }
}

function getContrastColor(hexColor) {
    const r = parseInt(hexColor.substr(1, 2), 16);
    const g = parseInt(hexColor.substr(3, 2), 16);
    const b = parseInt(hexColor.substr(5, 2), 16);

    const brightness = (r * 299 + g * 587 + b * 114) / 1000;

    return brightness < 128 ? '#ffffff' : '#000000';
}

function openEditUserModal() {
    inputUsername.value = currentUser.username;
    inputColor.value = currentUser.color;
    colorPreview.textContent = currentUser.color.toUpperCase();
    updateColorOptions(currentUser.color);
    editUserModal.classList.add('active');
}

function updateColorOptions(currentColor) {
    const options = document.querySelectorAll('.color-option');
    options.forEach(option => {
        option.classList.remove('selected');
        if (option.dataset.color === currentColor.toLowerCase()) {
            option.classList.add('selected');
        }
    });
}

function selectColor(color) {
    inputColor.value = color;
    colorPreview.textContent = color.toUpperCase();

    const options = document.querySelectorAll('.color-option');
    options.forEach(option => {
        option.classList.remove('selected');
        if (option.dataset.color === color.toLowerCase()) {
            option.classList.add('selected');
        }
    });
}

function closeEditUserModal() {
    editUserModal.classList.remove('active');
}

function saveUserInfo() {
    const newUsername = inputUsername.value.trim() || '匿名用户';
    const newColor = inputColor.value || '#6366f1';

    currentUser.username = newUsername;
    currentUser.color = newColor;

    saveUserInfoToStorage();
    updateUserDisplay();
    closeEditUserModal();

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

function connectWebSocket() {
    if (isConnecting) return;

    isConnecting = true;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    try {
        ws = new WebSocket(wsUrl);

        ws.onopen = function (event) {
            console.log('WebSocket连接已建立');
            updateConnectionStatus(true);

            ws.send(JSON.stringify({
                type: 'join',
                user: {
                    id: currentUser.id,
                    username: currentUser.username,
                    color: currentUser.color
                }
            }));
        };

        ws.onmessage = function (event) {
            const data = JSON.parse(event.data);
            handleMessage(data);
        };

        ws.onclose = function (event) {
            console.log('WebSocket连接已关闭');
            updateConnectionStatus(false);

            setTimeout(() => {
                isConnecting = false;
                connectWebSocket();
            }, 3000);
        };

        ws.onerror = function (error) {
            console.error(`WebSocket错误: ${error.message || error}`);
            updateConnectionStatus(false);
        };
    } catch (error) {
        console.error(`WebSocket连接失败: ${error.message || error}`);
        updateConnectionStatus(false);
        isConnecting = false;

        setTimeout(connectWebSocket, 3000);
    }
}

function updateConnectionStatus(connected) {
    const statusText = connectionStatus.querySelector('.status-text');

    if (connected) {
        connectionStatus.classList.remove('disconnected');
        connectionStatus.classList.add('connected');
        statusText.textContent = '已连接';
    } else {
        connectionStatus.classList.remove('connected');
        connectionStatus.classList.add('disconnected');
        statusText.textContent = '已断开';
    }
}

function handleMessage(data) {
    switch (data.type) {
        case 'init':
            editor.value = data.content || '';
            lastContent = editor.value;
            localVersion = data.version || 0;
            pendingOps = [];
            updateCharCount();
            updatePreview();
            updateUserList(data.users || []);
            renderChatHistory(data.chatHistory || []);
            break;

        case 'update':
            if (data.userId !== currentUser.id) {
                isApplyingRemoteOp = true;
                const savedCursor = {
                    start: editor.selectionStart,
                    end: editor.selectionEnd
                };
                editor.value = data.content || '';
                lastContent = editor.value;
                editor.selectionStart = Math.min(savedCursor.start, editor.value.length);
                editor.selectionEnd = Math.min(savedCursor.end, editor.value.length);
                isApplyingRemoteOp = false;
                updateCharCount();
                updatePreview();
                renderRemoteCursors();
            }
            break;

        case 'operation':
            if (data.userId !== currentUser.id) {
                handleRemoteOperation(data.operation, data.userId);
            }
            break;

        case 'ack':
            handleAck(data);
            break;

        case 'users':
            updateUserList(data.users || []);
            break;

        case 'userJoined':
            console.log(`用户 ${data.user.username} 加入`);
            updateUserList(data.users || []);
            break;

        case 'userLeft':
            console.log(`用户 ${data.user.username} 离开`);
            delete userCursors[data.user.id];
            renderRemoteCursors();
            updateUserList(data.users || []);
            break;

        case 'userUpdate':
            updateUserList(data.users || []);
            break;

        case 'typing':
            showTypingStatus(data.userId, data.isTyping);
            break;

        case 'cursor':
            if (data.userId !== currentUser.id) {
                userCursors[data.userId] = {
                    username: data.username,
                    color: data.color,
                    position: data.position,
                    lastActive: Date.now()
                };
                renderRemoteCursors();
            }
            break;

        case 'chat':
            appendChatMessage(data.message);
            break;
    }
}

function updateUserList(users) {
    window.currentUsers = users;
    const otherUsers = users.filter(u => u.id !== currentUser.id);
    onlineCount.textContent = users.length;

    userList.innerHTML = '';

    otherUsers.forEach(user => {
        const li = document.createElement('li');
        li.className = 'user-item';

        const avatar = document.createElement('div');
        avatar.className = 'user-avatar';
        avatar.style.backgroundColor = user.color;
        avatar.style.color = getContrastColor(user.color);
        avatar.textContent = user.username.charAt(0).toUpperCase();

        const info = document.createElement('div');
        info.className = 'user-info';

        const name = document.createElement('span');
        name.className = 'user-name';
        name.textContent = user.username;

        info.appendChild(name);

        if (window.typingUsers && window.typingUsers[user.id]) {
            const typing = document.createElement('span');
            typing.className = 'typing-indicator';
            typing.textContent = '正在输入...';
            info.appendChild(typing);
        }

        li.appendChild(avatar);
        li.appendChild(info);
        userList.appendChild(li);
    });
}

function sendTypingStatus(isTyping) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'typing',
            isTyping: isTyping,
            userId: currentUser.id
        }));
    }
}

function sendCursorPosition() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        const position = {
            start: editor.selectionStart,
            end: editor.selectionEnd
        };
        ws.send(JSON.stringify({
            type: 'cursor',
            userId: currentUser.id,
            position: position
        }));
    }
}

/**
 * 根据字符位置计算像素坐标
 */
function getCursorPixelPosition(charIndex) {
    const text = editor.value;
    const lines = text.substring(0, charIndex).split('\n');
    const lineIndex = lines.length - 1;
    const colIndex = lines[lines.length - 1].length;

    // 获取编辑器样式
    const style = window.getComputedStyle(editor);
    const lineHeight = parseFloat(style.lineHeight) || 22.4; // 14px * 1.6
    const fontSize = parseFloat(style.fontSize) || 14;
    const fontFamily = style.fontFamily;
    const paddingLeft = parseFloat(style.paddingLeft) || 14;
    const paddingTop = parseFloat(style.paddingTop) || 14;

    // 计算字符宽度（使用 canvas 测量）
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = `${fontSize}px ${fontFamily}`;

    const currentLineText = lines[lines.length - 1];
    const charWidth = ctx.measureText(currentLineText).width;

    return {
        left: paddingLeft + charWidth,
        top: paddingTop + (lineIndex * lineHeight),
        lineHeight: lineHeight
    };
}

/**
 * 渲染其他用户的光标
 */
function renderRemoteCursors() {
    if (!cursorLayer) return;

    // 清空现有光标
    cursorLayer.innerHTML = '';

    const scrollLeft = editor.scrollLeft;
    const scrollTop = editor.scrollTop;
    const now = Date.now();

    // 渲染每个用户的光标
    Object.keys(userCursors).forEach(userId => {
        const cursorData = userCursors[userId];
        if (!cursorData.position) return;

        const inactiveTime = now - (cursorData.lastActive || 0);

        // 检查是否超时，超过30秒不渲染
        if (inactiveTime > CURSOR_HIDE_TIMEOUT) {
            return;
        }

        // 判断是否需要暗淡（5-30秒之间）
        const isDimmed = inactiveTime > CURSOR_DIM_TIMEOUT;

        const pos = cursorData.position;
        const color = cursorData.color || '#6366f1';
        const username = cursorData.username || '用户';

        // 渲染光标
        const startPixel = getCursorPixelPosition(pos.start);

        const cursorEl = document.createElement('div');
        cursorEl.className = 'remote-cursor' + (isDimmed ? ' dimmed' : '');
        cursorEl.style.left = `${startPixel.left - scrollLeft}px`;
        cursorEl.style.top = `${startPixel.top - scrollTop}px`;

        // 光标线
        const cursorLine = document.createElement('div');
        cursorLine.className = 'remote-cursor-line';
        cursorLine.style.backgroundColor = color;
        cursorLine.style.height = `${startPixel.lineHeight}px`;

        // 用户名标签
        const cursorLabel = document.createElement('div');
        cursorLabel.className = 'remote-cursor-label';
        cursorLabel.style.backgroundColor = color;
        cursorLabel.textContent = username;

        cursorEl.appendChild(cursorLine);
        cursorEl.appendChild(cursorLabel);

        // 如果有选区，渲染选区背景
        if (pos.start !== pos.end) {
            const endPixel = getCursorPixelPosition(pos.end);

            const selectionEl = document.createElement('div');
            selectionEl.className = 'remote-selection' + (isDimmed ? ' dimmed' : '');
            selectionEl.style.backgroundColor = color;
            selectionEl.style.left = `${startPixel.left - scrollLeft}px`;
            selectionEl.style.top = `${startPixel.top - scrollTop}px`;
            selectionEl.style.width = `${Math.abs(endPixel.left - startPixel.left)}px`;
            selectionEl.style.height = `${startPixel.lineHeight}px`;

            cursorLayer.appendChild(selectionEl);
        }

        cursorLayer.appendChild(cursorEl);
    });
}

function showTypingStatus(userId, isTyping) {
    if (!window.typingUsers) {
        window.typingUsers = {};
    }

    window.typingUsers[userId] = isTyping;
    if (window.currentUsers) {
        updateUserList(window.currentUsers);
    }
}

document.addEventListener('DOMContentLoaded', initApp);

window.addEventListener('beforeunload', function () {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'leave',
            userId: currentUser.id
        }));
    }
});

document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && editUserModal.classList.contains('active')) {
        closeEditUserModal();
    }
});

function initPreview() {
    const savedPreview = localStorage.getItem('sharedNotebookPreview');
    if (savedPreview === 'true') {
        previewEnabled = true;
        previewToggleBtn.classList.add('active');
        editorWrapper.classList.add('preview-active');
    }
}

function togglePreview() {
    previewEnabled = !previewEnabled;
    previewToggleBtn.classList.toggle('active', previewEnabled);
    editorWrapper.classList.toggle('preview-active', previewEnabled);
    localStorage.setItem('sharedNotebookPreview', previewEnabled);
    if (previewEnabled) {
        updatePreview();
    }
}

function updatePreview() {
    if (!previewEnabled) return;
    previewContent.innerHTML = parseMarkdown(editor.value);
}

function parseMarkdown(text) {
    if (!text) return '';

    let html = text;
    html = escapeHtml(html);
    html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
    html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
    html = html.replace(/\*\*\*(.*?)\*\*\*/gim, '<strong><em>$1</em></strong>');
    html = html.replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/gim, '<em>$1</em>');
    html = html.replace(/~~(.*?)~~/gim, '<del>$1</del>');
    html = html.replace(/`{3}([\s\S]*?)`{3}/gim, '<pre><code>$1</code></pre>');
    html = html.replace(/`(.*?)`/gim, '<code>$1</code>');
    html = html.replace(/^\s*[-*+]\s+(.*)$/gim, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');
    html = html.replace(/^\s*\d+\.\s+(.*)$/gim, '<li>$1</li>');
    html = html.replace(/^>\s+(.*)$/gim, '<blockquote>$1</blockquote>');
    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/gim, '<img src="$2" alt="$1">');
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/gim, '<a href="$2" target="_blank">$1</a>');
    html = html.replace(/^\|(.+)\|$/gim, function (match, content) {
        const cells = content.split('|').map(cell => cell.trim());
        const rowType = cells.every(cell => /^[-:]+$/.test(cell)) ? 'thead' : 'tbody';
        if (rowType === 'thead') {
            return '<tr>' + cells.map(cell => `<th>${cell.replace(/^[-:]+$/, '---')}</th>`).join('') + '</tr>';
        } else {
            return '<tr>' + cells.map(cell => `<td>${cell}</td>`).join('') + '</tr>';
        }
    });

    html = html.replace(/<\/tr>\s*<tr>/g, '</tr><tr>');
    html = html.replace(/(<tr>(?:<th>.*<\/th>)+<\/tr>)/s, '<thead>$1</thead>');
    html = html.replace(/(<tbody>.*<\/thead>)/s, function (match) {
        return match.replace('<tbody>', '').replace('</thead>', '</thead><tbody>');
    });
    html = html.replace(/(<tr>.*<\/tr>)/s, function (match) {
        if (!match.includes('<thead>') && !match.includes('<tbody>') && !match.includes('</thead>') && !match.includes('</tbody>')) {
            if (match.includes('<th>')) {
                return '<thead>' + match + '</thead><tbody>';
            }
            return '<tbody>' + match + '</tbody>';
        }
        return match;
    });
    html = html.replace(/<\/tbody>\s*<tbody>/g, '');
    html = html.replace(/<thead>/g, '<table><thead>');
    html = html.replace(/<\/tbody>/g, '</tbody></table>');
    html = html.replace(/^(-{3,}|_{3,}|\*{3,})$/gim, '<hr>');
    html = html.replace(/\n\n/g, '</p><p>');
    html = html.replace(/\n/g, '<br>');
    html = html.replace(/<h([1-6])><br>/g, '<h$1>');
    html = html.replace(/<h([1-6])><\/p><p>/g, '<h$1>');
    html = html.replace(/<ul><br>/g, '<ul>');
    html = html.replace(/<li><br>/g, '<li>');
    html = html.replace(/<blockquote><br>/g, '<blockquote>');
    html = html.replace(/<pre><code><br>/g, '<pre><code>');
    html = html.replace(/<\/code><\/pre><br>/g, '</code></pre>');
    html = html.replace(/<table><br>/g, '<table>');
    html = html.replace(/<thead><br>/g, '<thead>');
    html = html.replace(/<\/tbody><br>/g, '</tbody>');
    html = html.replace(/<\/table><br>/g, '</table>');
    html = html.replace(/<tr><br>/g, '<tr>');
    html = html.replace(/<\/tr><br>/g, '</tr>');
    html = html.replace(/<th><br>/g, '<th>');
    html = html.replace(/<\/th><br>/g, '</th>');
    html = html.replace(/<td><br>/g, '<td>');
    html = html.replace(/<\/td><br>/g, '</td>');
    html = '<p>' + html + '</p>';
    html = html.replace(/<p><\/p>/g, '');
    html = html.replace(/<p>(<h[1-6]>)/g, '$1');
    html = html.replace(/(<\/h[1-6]>)<\/p>/g, '$1');
    html = html.replace(/<p>(<ul>)/g, '$1');
    html = html.replace(/(<\/ul>)<\/p>/g, '$1');
    html = html.replace(/<p>(<blockquote>)/g, '$1');
    html = html.replace(/(<\/blockquote>)<\/p>/g, '$1');
    html = html.replace(/<p>(<pre>)/g, '$1');
    html = html.replace(/(<\/pre>)<\/p>/g, '$1');
    html = html.replace(/<p>(<hr>)<\/p>/g, '$1');
    html = html.replace(/<p>(<img[^>]*>)/g, '$1');
    html = html.replace(/(<img[^>]*>)<\/p>/g, '$1');
    html = html.replace(/<p>(<table>)/g, '$1');
    html = html.replace(/(<\/table>)<\/p>/g, '$1');
    return html;
}

function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;'
    };
    return text.replace(/[&<>]/g, m => map[m]);
}

// ==================== OT 核心函数 ====================

/**
 * 计算差异操作（将内容变化转换为insert/delete操作）
 */
function computeDiffOperations(oldText, newText) {
    const operations = [];

    // 使用简单的差异算法
    let oldPos = 0;
    let newPos = 0;

    while (oldPos < oldText.length || newPos < newText.length) {
        if (oldPos >= oldText.length) {
            // 只有新文本有内容 - 插入
            operations.push({
                type: 'insert',
                position: oldPos,
                content: newText.slice(newPos)
            });
            break;
        } else if (newPos >= newText.length) {
            // 只有旧文本有内容 - 删除
            operations.push({
                type: 'delete',
                position: oldPos,
                length: oldText.length - oldPos
            });
            break;
        } else if (oldText[oldPos] === newText[newPos]) {
            // 相同字符，继续
            oldPos++;
            newPos++;
        } else {
            // 找到差异点
            // 检查是否是插入
            let insertEnd = newPos;
            while (insertEnd < newText.length &&
                (oldPos >= oldText.length || newText[insertEnd] !== oldText[oldPos])) {
                insertEnd++;
            }

            // 检查是否是删除
            let deleteEnd = oldPos;
            while (deleteEnd < oldText.length &&
                (newPos >= newText.length || oldText[deleteEnd] !== newText[newPos])) {
                deleteEnd++;
            }

            const insertLen = insertEnd - newPos;
            const deleteLen = deleteEnd - oldPos;

            if (deleteLen > 0 && insertLen === 0) {
                // 纯删除
                operations.push({
                    type: 'delete',
                    position: oldPos,
                    length: deleteLen
                });
                oldPos = deleteEnd;
            } else if (insertLen > 0 && deleteLen === 0) {
                // 纯插入
                operations.push({
                    type: 'insert',
                    position: oldPos,
                    content: newText.slice(newPos, insertEnd)
                });
                newPos = insertEnd;
            } else if (deleteLen > 0 && insertLen > 0) {
                // 替换 = 先删除后插入
                operations.push({
                    type: 'delete',
                    position: oldPos,
                    length: deleteLen
                });
                operations.push({
                    type: 'insert',
                    position: oldPos,
                    content: newText.slice(newPos, insertEnd)
                });
                oldPos = deleteEnd;
                newPos = insertEnd;
            } else {
                // 无法处理，跳过一个字符
                oldPos++;
                newPos++;
            }
        }
    }

    return operations;
}

/**
 * 调整操作位置（考虑待确认操作）
 */
function adjustOperationForPending(op) {
    let adjustedPos = op.position;

    for (const pending of pendingOps) {
        const pendingOp = pending.operation;
        if (pendingOp.type === 'insert' && pendingOp.position <= adjustedPos) {
            adjustedPos += pendingOp.content.length;
        } else if (pendingOp.type === 'delete' && pendingOp.position < adjustedPos) {
            adjustedPos = Math.max(pendingOp.position, adjustedPos - pendingOp.length);
        }
    }

    return { ...op, position: adjustedPos };
}

/**
 * 操作转换函数（OT核心）
 * 将本地操作转换，使其能正确应用于远程操作之后的状态
 */
function transformOperation(localOp, remoteOp, remoteUserId) {
    const transformedOp = { ...localOp };
    
    if (transformedOp.type === 'insert') {
        if (remoteOp.type === 'insert') {
            // 两个插入操作：如果远程插入在本地插入之前，本地插入位置后移
            if (remoteOp.position < transformedOp.position) {
                transformedOp.position += remoteOp.content.length;
            } else if (remoteOp.position === transformedOp.position) {
                // 相同位置，使用用户ID作为决胜，确保一致性
                if (remoteUserId && remoteUserId < currentUser.id) {
                    transformedOp.position += remoteOp.content.length;
                }
            }
        } else if (remoteOp.type === 'delete') {
            // 远程删除：如果删除范围在本地插入位置之前，本地插入位置前移
            if (remoteOp.position + remoteOp.length <= transformedOp.position) {
                transformedOp.position -= remoteOp.length;
            } else if (remoteOp.position < transformedOp.position) {
                // 如果删除范围包含本地插入位置，本地插入位置移到删除开始位置
                transformedOp.position = remoteOp.position;
            }
        }
    } else if (transformedOp.type === 'delete') {
        if (remoteOp.type === 'insert') {
            // 远程插入：如果插入在本地删除范围之前，本地删除位置后移
            if (remoteOp.position <= transformedOp.position) {
                transformedOp.position += remoteOp.content.length;
            } else if (remoteOp.position < transformedOp.position + transformedOp.length) {
                // 如果插入在本地删除范围内，本地删除长度增加
                transformedOp.length += remoteOp.content.length;
            }
        } else if (remoteOp.type === 'delete') {
            // 两个删除操作：调整本地删除位置和长度
            if (remoteOp.position + remoteOp.length <= transformedOp.position) {
                // 远程删除在本地删除之前，本地删除位置前移
                transformedOp.position -= remoteOp.length;
            } else if (remoteOp.position < transformedOp.position) {
                // 远程删除覆盖了本地删除的开始部分
                const overlapLen = remoteOp.position + remoteOp.length - transformedOp.position;
                transformedOp.position = remoteOp.position;
                transformedOp.length -= overlapLen;
                if (transformedOp.length < 0) {
                    transformedOp.length = 0;
                }
            } else if (remoteOp.position < transformedOp.position + transformedOp.length) {
                // 远程删除与本地删除有重叠
                const overlapLen = Math.min(remoteOp.position + remoteOp.length, transformedOp.position + transformedOp.length) - remoteOp.position;
                transformedOp.length -= overlapLen;
                if (transformedOp.length < 0) {
                    transformedOp.length = 0;
                }
            }
        }
    }

    return transformedOp;
}

/**
 * 应用操作到编辑器内容
 */
function applyOperationToLocal(op) {
    const content = editor.value;
    let newContent;

    if (op.type === 'insert') {
        newContent = content.slice(0, op.position) + op.content + content.slice(op.position);
    } else if (op.type === 'delete') {
        newContent = content.slice(0, op.position) + content.slice(op.position + op.length);
    } else {
        return content;
    }

    return newContent;
}

function applyOperationToContent(content, op) {
    if (op.type === 'insert') {
        return content.slice(0, op.position) + op.content + content.slice(op.position);
    } else if (op.type === 'delete') {
        return content.slice(0, op.position) + content.slice(op.position + op.length);
    }
    return content;
}

/**
 * 处理远程操作
 * 服务器已经对操作进行了 OT 转换，客户端只需要处理待确认操作
 */
function handleRemoteOperation(remoteOp, remoteUserId) {
    isApplyingRemoteOp = true;

    // 保存当前光标位置
    const cursorPos = {
        start: editor.selectionStart,
        end: editor.selectionEnd
    };

    // 步骤1：将远程操作转换到包含待确认操作的状态
    let adjustedRemoteOp = { ...remoteOp };
    for (const pending of pendingOps) {
        const pendingOp = pending.operation;
        if (pendingOp.type === 'insert' && pendingOp.position <= adjustedRemoteOp.position) {
            adjustedRemoteOp.position += pendingOp.content.length;
        } else if (pendingOp.type === 'delete' && pendingOp.position < adjustedRemoteOp.position) {
            adjustedRemoteOp.position = Math.max(pendingOp.position, adjustedRemoteOp.position - pendingOp.length);
        }
    }

    // 步骤2：将待确认操作转换到包含远程操作的状态
    for (let i = 0; i < pendingOps.length; i++) {
        pendingOps[i].operation = transformOperation(
            { ...pendingOps[i].operation },
            remoteOp,
            remoteUserId
        );
    }

    // 步骤3：应用调整后的远程操作到本地
    const newContent = applyOperationToLocal(adjustedRemoteOp);
    editor.value = newContent;
    lastContent = newContent;

    // 如果正在 IME 组合输入，同步更新 contentBeforeCompose
    if (isComposing) {
        contentBeforeCompose = applyOperationToContent(contentBeforeCompose, adjustedRemoteOp);
    }

    // 调整光标位置
    let newStart = cursorPos.start;
    let newEnd = cursorPos.end;

    if (adjustedRemoteOp.type === 'insert') {
        if (adjustedRemoteOp.position <= cursorPos.start) {
            newStart += adjustedRemoteOp.content.length;
            newEnd += adjustedRemoteOp.content.length;
        }
    } else if (adjustedRemoteOp.type === 'delete') {
        if (adjustedRemoteOp.position + adjustedRemoteOp.length <= cursorPos.start) {
            newStart -= adjustedRemoteOp.length;
            newEnd -= adjustedRemoteOp.length;
        } else if (adjustedRemoteOp.position < cursorPos.start) {
            newStart = adjustedRemoteOp.position;
            newEnd = Math.max(adjustedRemoteOp.position, newEnd - adjustedRemoteOp.length);
        }
    }

    editor.selectionStart = Math.min(newStart, newContent.length);
    editor.selectionEnd = Math.min(newEnd, newContent.length);

    updateCharCount();
    updatePreview();
    renderRemoteCursors();

    isApplyingRemoteOp = false;
}

/**
 * 处理操作确认
 */
function handleAck(data) {
    // 移除已确认的操作
    const opIndex = pendingOps.findIndex(op => op.id === data.operationId);
    if (opIndex !== -1) {
        pendingOps.splice(opIndex, 1);
    }
    localVersion = data.version;
}

function renderChatHistory(messages) {
    const chatMessagesEl = document.getElementById('chat-messages');
    if (!chatMessagesEl) return;

    chatMessagesEl.innerHTML = '';

    if (messages.length === 0) {
        chatMessagesEl.innerHTML = '<div class="chat-empty">暂无消息</div>';
        return;
    }

    messages.forEach(msg => {
        appendChatMessage(msg, false);
    });

    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}

function appendChatMessage(message, scroll = true) {
    const chatMessagesEl = document.getElementById('chat-messages');
    if (!chatMessagesEl) return;

    const emptyEl = chatMessagesEl.querySelector('.chat-empty');
    if (emptyEl) {
        emptyEl.remove();
    }

    const isOwn = message.user.id === currentUser.id;

    const msgEl = document.createElement('div');
    msgEl.className = 'chat-message' + (isOwn ? ' own-message' : '');

    const headerEl = document.createElement('div');
    headerEl.className = 'chat-message-header';

    const avatarEl = document.createElement('div');
    avatarEl.className = 'chat-message-avatar';
    avatarEl.style.backgroundColor = message.user.color;
    avatarEl.style.color = getContrastColor(message.user.color);
    avatarEl.textContent = message.user.username.charAt(0).toUpperCase();

    const usernameEl = document.createElement('span');
    usernameEl.className = 'chat-message-username';
    usernameEl.textContent = message.user.username;

    const timeEl = document.createElement('span');
    timeEl.className = 'chat-message-time';
    timeEl.textContent = formatChatTime(message.timestamp);

    headerEl.appendChild(avatarEl);
    headerEl.appendChild(usernameEl);
    headerEl.appendChild(timeEl);

    const bubbleEl = document.createElement('div');
    bubbleEl.className = 'chat-message-bubble';
    bubbleEl.textContent = message.content;

    msgEl.appendChild(headerEl);
    msgEl.appendChild(bubbleEl);

    chatMessagesEl.appendChild(msgEl);

    if (scroll) {
        chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
    }
}

function formatChatTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');

    if (isToday) {
        return `${hours}:${minutes}`;
    }

    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${month}/${day} ${hours}:${minutes}`;
}

function sendChatMessage() {
    const chatInput = document.getElementById('chat-input');
    if (!chatInput) return;

    const content = chatInput.value.trim();
    if (!content) return;

    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'chat',
            userId: currentUser.id,
            content: content
        }));

        chatInput.value = '';
        chatInput.style.height = 'auto';
    }
}
