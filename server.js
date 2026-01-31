const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

// Bot API URL (bot.js ayrı çalışacak)
const BOT_API_URL = process.env.BOT_API_URL || 'http://localhost:3002';

// Kullanıcı veritabanı (basit, genişletilebilir)
const users = [
  { username: 'ducks', password: 'ducks1234' },
  { username: 'valyre', password: 'valyre1234' },
  { username: 'lade', password: 'lade1234' }
];

// Aktif çağrılar
let activeCalls = [];
let callIdCounter = 1;

// Chat mesajları (geçici)
let chatMessages = [];

// Discord Webhook URLs
const DISCORD_WEBHOOKS = {
  chat: 'YOUR_CHAT_WEBHOOK_URL',
  pager: 'YOUR_PAGER_WEBHOOK_URL'
};

//
// 🔒 DISCORD RATE-LIMIT QUEUE (YENİ)
//
const discordQueue = [];
let discordSending = false;

// Discord'a mesaj gönderme (QUEUE + DELAY)
async function sendToDiscord(webhookUrl, content) {
  discordQueue.push({ webhookUrl, content });

  if (discordSending) return;
  discordSending = true;

  while (discordQueue.length > 0) {
    const { webhookUrl, content } = discordQueue.shift();

    try {
      await axios.post(webhookUrl, { content });
    } catch (error) {
      console.error(
        'Discord webhook error:',
        error.response?.status,
        error.message
      );
    }

    // ⏱️ 429 FIX
    await new Promise(resolve => setTimeout(resolve, 1200));
  }

  discordSending = false;
}

// Login endpoint
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = users.find(u => u.username === username && u.password === password);

  if (user) {
    res.json({
      success: true,
      user: { username: user.username }
    });
  } else {
    res.status(401).json({ success: false, message: 'Geçersiz kullanıcı adı veya şifre' });
  }
});

// Kullanıcıları getir
app.get('/api/users', (req, res) => {
  res.json(users.map(u => ({ username: u.username })));
});

// Yeni kullanıcı ekle
app.post('/api/users', (req, res) => {
  const { username, password } = req.body;

  if (users.find(u => u.username === username)) {
    return res.status(400).json({ success: false, message: 'Kullanıcı zaten mevcut' });
  }

  users.push({ username, password });
  res.json({ success: true, message: 'Kullanıcı eklendi' });
});

// Socket.IO
io.on('connection', (socket) => {
  console.log('Yeni kullanıcı bağlandı:', socket.id);

  socket.on('user-connected', (user) => {
    socket.username = user.username;
    socket.deviceType = user.deviceType;

    socket.emit('initial-calls', activeCalls);
    socket.emit('initial-messages', chatMessages);
  });

  // Yeni çağrı
  socket.on('new-call', async (callData) => {
    const newCall = {
      id: callIdCounter++,
      ...callData,
      timestamp: new Date().toISOString(),
      status: 'pending',
      caller: socket.username
    };

    activeCalls.push(newCall);
    io.emit('call-created', newCall);

    let discordMessage =
      `**YENİ ÇAĞRI**\n` +
      `**Çağrı Sahibi:** ${newCall.caller}\n` +
      `**Başlık:** ${newCall.title}\n` +
      `**Detay:** ${newCall.details}\n` +
      `**Konum:** ${newCall.location}\n` +
      `**Aciliyet:** ${newCall.priority}\n` +
      `**Zaman:** ${new Date(newCall.timestamp).toLocaleString('tr-TR')}`;

    if (newCall.priority === 'Acil') {
      discordMessage = `@everyone\n🚨 **ACİL ÇAĞRI** 🚨\n\n${discordMessage}`;

      try {
        await axios.post(`${BOT_API_URL}/api/emergency-alert`, {
          callData: newCall
        });
      } catch (error) {
        console.error('Bot API hatası:', error.message);
      }
    }

    await sendToDiscord(DISCORD_WEBHOOKS.pager, discordMessage);
  });

  // Çağrı alındı
  socket.on('mark-call-received', (callId) => {
    const call = activeCalls.find(c => c.id === callId);
    if (call) {
      call.status = 'received';
      call.receivedBy = socket.username;
      io.emit('call-updated', call);
    }
  });

  // Tüm çağrıları temizle
  socket.on('clear-all-calls', () => {
    activeCalls = [];
    io.emit('calls-cleared');
  });

  // Chat mesajı
  socket.on('send-message', async (message) => {
    const chatMessage = {
      id: Date.now(),
      username: socket.username,
      deviceType: socket.deviceType,
      message,
      timestamp: new Date().toISOString()
    };

    chatMessages.push(chatMessage);
    io.emit('new-message', chatMessage);

    const displayName =
      socket.deviceType === 'dispatch'
        ? `${socket.username} (dispatch)`
        : socket.username;

    await sendToDiscord(
      DISCORD_WEBHOOKS.chat,
      `**${displayName}:** ${message}`
    );
  });

  // Chat temizle
  socket.on('clear-chat', () => {
    chatMessages = [];
    io.emit('chat-cleared');
  });

  // Bildirim gönder
  socket.on('send-notification', async () => {
    const notificationMessage =
      `**${socket.username} (dispatch)** bir bildirim gönderdi.`;

    await sendToDiscord(DISCORD_WEBHOOKS.pager, notificationMessage);

    io.emit('notification-sent', {
      sender: socket.username,
      timestamp: new Date().toISOString()
    });
  });

  socket.on('disconnect', () => {
    console.log('Kullanıcı ayrıldı:', socket.username || socket.id);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`OCST Dispatch Backend çalışıyor: ${PORT}`);
});
