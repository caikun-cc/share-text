let currentUser = {
    id: null,
    username: '匿名用户',
    color: '#6366f1'
};
let ws = null;
let isConnecting = false;
let previewEnabled = false;

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

function initApp() {
    loadUserInfoFromStorage();
    updateUserDisplay();
    initPreview();
    connectWebSocket();

    editor.addEventListener('input', function () {
        updateCharCount();
        updatePreview();

        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'update',
                content: editor.value,
                userId: currentUser.id
            }));

            sendTypingStatus(true);

            if (window.typingTimeout) {
                clearTimeout(window.typingTimeout);
            }

            window.typingTimeout = setTimeout(() => {
                sendTypingStatus(false);
            }, 1000);
        }
    });

    inputColor.addEventListener('input', function () {
        colorPreview.textContent = this.value.toUpperCase();
    });
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
            updateCharCount();
            updatePreview();
            updateUserList(data.users || []);
            break;

        case 'update':
            if (data.userId !== currentUser.id) {
                editor.value = data.content || '';
                updateCharCount();
                updatePreview();
            }
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
            updateUserList(data.users || []);
            break;

        case 'userUpdate':
            updateUserList(data.users || []);
            break;

        case 'typing':
            showTypingStatus(data.userId, data.isTyping);
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
