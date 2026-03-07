const WebSocket = require('ws');

const SERVER_URL = 'ws://localhost:8011/ws';
const NUM_CLIENTS = 20;
const TEST_DURATION = 20000;
const OPERATION_INTERVAL = 120;

const clients = [];
const testResults = {
  startTime: Date.now(),
  endTime: null,
  success: true,
  errors: [],
  finalContents: [],
  operationCount: 0
};

function generateUserId() {
  return 'test_user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function generateRandomOperation(content, userId, clientId, totalClients) {
  const totalLen = content.length;
  const segmentSize = Math.max(1, Math.floor(totalLen / totalClients));
  const preferredStart = Math.min(clientId * segmentSize, totalLen);
  const preferredEnd = Math.min(preferredStart + segmentSize + 10, totalLen);
  
  let position;
  if (totalLen === 0) {
    position = 0;
  } else {
    if (Math.random() < 0.7) {
      position = preferredStart + Math.floor(Math.random() * (preferredEnd - preferredStart + 1));
      position = Math.min(position, totalLen);
    } else {
      position = Math.floor(Math.random() * (totalLen + 1));
    }
  }
  
  const operations = [
    {
      type: 'insert',
      position: position,
      content: Array.from({ length: 1 + Math.floor(Math.random() * 3) }, () => 
        String.fromCharCode(65 + Math.floor(Math.random() * 26))
      ).join('')
    },
    content.length > 0 ? {
      type: 'delete',
      position: Math.floor(Math.random() * content.length),
      length: 1 + Math.floor(Math.random() * Math.min(3, content.length))
    } : null
  ].filter(Boolean);
  
  return operations[Math.floor(Math.random() * operations.length)];
}

// OT 转换：将 op1 转换，使其能正确应用于 op2 之后的状态
function transform(op1, op2, op2UserId, currentUserId) {
  const result = { ...op1 };
  
  if (result.type === 'insert') {
    if (op2.type === 'insert') {
      if (op2.position < result.position) {
        result.position += op2.content.length;
      } else if (op2.position === result.position) {
        if (op2UserId < currentUserId) {
          result.position += op2.content.length;
        }
      }
    } else if (op2.type === 'delete') {
      if (op2.position + op2.length <= result.position) {
        result.position -= op2.length;
      } else if (op2.position < result.position) {
        result.position = op2.position;
      }
    }
  } else if (result.type === 'delete') {
    if (op2.type === 'insert') {
      if (op2.position <= result.position) {
        result.position += op2.content.length;
      } else if (op2.position < result.position + result.length) {
        result.length += op2.content.length;
      }
    } else if (op2.type === 'delete') {
      if (op2.position + op2.length <= result.position) {
        result.position -= op2.length;
      } else if (op2.position < result.position) {
        const overlap = op2.position + op2.length - result.position;
        result.position = op2.position;
        result.length -= overlap;
        if (result.length < 0) result.length = 0;
      } else if (op2.position < result.position + result.length) {
        const overlap = Math.min(op2.position + op2.length, result.position + result.length) - op2.position;
        result.length -= overlap;
        if (result.length < 0) result.length = 0;
      }
    }
  }

  return result;
}

function applyOp(content, op) {
  if (op.type === 'insert') {
    const pos = Math.min(Math.max(0, op.position), content.length);
    return content.slice(0, pos) + op.content + content.slice(pos);
  } else if (op.type === 'delete') {
    const pos = Math.min(Math.max(0, op.position), content.length);
    const len = Math.min(op.length || 1, content.length - pos);
    return content.slice(0, pos) + content.slice(pos + len);
  }
  return content;
}

function connectClient(clientId) {
  return new Promise((resolve) => {
    const ws = new WebSocket(SERVER_URL);
    const userId = generateUserId();
    
    let content = '';  // 当前内容
    let pendingOps = [];  // 待确认操作
    let version = 0;
    
    ws.on('open', () => {
      console.log(`Client ${clientId} connected: ${userId}`);
      
      ws.send(JSON.stringify({
        type: 'join',
        user: {
          id: userId,
          username: `TestUser${clientId}`,
          color: `#${Math.floor(Math.random()*16777215).toString(16)}`
        }
      }));
      
      clients.push({ 
        id: clientId, 
        ws, 
        userId,
        getContent: () => content,
        getPendingOps: () => pendingOps,
        getVersion: () => version,
        applyLocalOp: (op) => { content = applyOp(content, op); },
        addPendingOp: (op) => { pendingOps.push(op); },
        clearPendingOps: () => { pendingOps = []; },
        setVersion: (v) => { version = v; }
      });
      resolve();
    });
    
    const messageQueue = [];
    let isProcessing = false;
    
    function processQueue() {
      if (isProcessing || messageQueue.length === 0) return;
      isProcessing = true;
      
      while (messageQueue.length > 0) {
        const msg = messageQueue.shift();
        
        switch (msg.type) {
          case 'init':
            content = msg.content || '';
            version = msg.version || 0;
            pendingOps = [];
            console.log(`Client ${clientId} init: "${content}", v${version}`);
            break;
            
          case 'operation':
            if (msg.userId !== userId) {
              // 收到服务器广播的转换后操作
              // 只需要转换待确认操作，然后应用远程操作
              const remoteOp = msg.operation;
              
              console.log(`Client ${clientId} BEFORE: content="${content}", pending=${pendingOps.length}, remote=${remoteOp.type} at ${remoteOp.position}`);
              
              // 转换待确认操作
              pendingOps = pendingOps.map(p => ({
                ...p,
                op: transform(p.op, remoteOp, msg.userId, userId)
              }));
              
              // 应用远程操作
              content = applyOp(content, remoteOp);
              
              console.log(`Client ${clientId} AFTER: content="${content}"`);
            }
            break;
            
          case 'ack':
            // 操作被服务器确认
            // 使用服务器的内容更新本地内容
            if (msg.content !== undefined) {
              content = msg.content;
            }
            version = msg.version;
            console.log(`Client ${clientId} ack: v${version}, content="${content}"`);
            break;
        }
      }
      
      isProcessing = false;
    }
    
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        messageQueue.push(msg);
        processQueue();
      } catch (e) {
        console.error(`Client ${clientId} error:`, e);
        testResults.success = false;
        testResults.errors.push(`Client ${clientId}: ${e.message}`);
      }
    });
    
    ws.on('error', (e) => {
      console.error(`Client ${clientId} error:`, e);
      testResults.success = false;
    });
    
    ws.on('close', () => console.log(`Client ${clientId} disconnected`));
  });
}

function simulateEditing() {
  clients.forEach((client, idx) => {
    if (client.ws.readyState === WebSocket.OPEN) {
      const content = client.getContent();
      const version = client.getVersion();
      
      const op = generateRandomOperation(content, client.userId, client.id, NUM_CLIENTS);
      const opId = `op_${Date.now()}_${idx}_${++testResults.operationCount}`;
      
      // 不做乐观更新，等待服务器确认
      
      // 发送操作到服务器
      client.ws.send(JSON.stringify({
        type: 'operation',
        operation: op,
        operationId: opId,
        userId: client.userId,
        version: version
      }));
      
      console.log(`Client ${client.id} send: ${op.type} at ${op.position}, v${version}`);
    }
  });
}

function validate() {
  const contents = clients.map(c => c.getContent());
  const versions = clients.map(c => c.getVersion());
  const unique = new Set(contents);
  
  console.log('\n=== Validation ===');
  console.log(`Unique contents: ${unique.size}`);
  console.log(`Version range: ${Math.min(...versions)} - ${Math.max(...versions)}`);
  
  if (unique.size !== 1) {
    testResults.success = false;
    testResults.errors.push('Content mismatch');
    contents.forEach((c, i) => {
      console.log(`Client ${i}: "${c.substring(0, 50)}..." (v${versions[i]}, pending: ${clients[i].getPendingOps().length})`);
    });
  } else {
    console.log(`All clients: "${contents[0].substring(0, 50)}..." (len: ${contents[0].length})`);
  }
  
  testResults.finalContents = contents;
  testResults.endTime = Date.now();
  
  console.log('\n=== Results ===');
  console.log(`Duration: ${testResults.endTime - testResults.startTime}ms`);
  console.log(`Operations: ${testResults.operationCount}`);
  console.log(`Success: ${testResults.success}`);
  if (testResults.errors.length) {
    console.log('Errors:', testResults.errors);
  }
}

async function runTest() {
  console.log('Starting OT test...\n');
  
  for (let i = 0; i < NUM_CLIENTS; i++) {
    await connectClient(i);
    await new Promise(r => setTimeout(r, 500));
  }
  
  console.log('\nClients connected. Starting simulation...\n');
  
  const interval = setInterval(simulateEditing, OPERATION_INTERVAL);
  
  setTimeout(async () => {
    clearInterval(interval);
    console.log('\nSimulation done. Waiting for sync...\n');
    await new Promise(r => setTimeout(r, 5000));
    validate();
    await new Promise(r => setTimeout(r, 500));
    clients.forEach(c => c.ws.readyState === WebSocket.OPEN && c.ws.close());
  }, TEST_DURATION);
}

runTest().catch(console.error);
