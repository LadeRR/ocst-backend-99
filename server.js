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

// Discord Webhook URLs (Bunları kendi webhook URL'lerinizle değiştirin)
const DISCORD_WEBHOOKS = {
  chat: 'YOUR_CHAT_WEBHOOK_URL', // Chat log kanalı
  pager: 'YOUR_PAGER_WEBHOOK_URL' // Pager kanalı
};

// Discord'a mesaj gönderme fonksiyonu
async function sendToDiscord(webhookUrl, content) {
  try {
    await axios.post(webhookUrl, { content });
  } catch (error) {
    console.error('Discord webhook error:', error.message);
  }
}

// Login endpoint
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = users.find(u => u.username === username && u.password === password);
  
  if (user) {
    res.json({ 
      success: true, 
      user: { 
        username: user.username
      } 
    });
  } else {
    res.status(401).json({ success: false, message: 'Geçersiz kullanıcı adı veya şifre' });
  }
});

// Kullanıcıları getir (yönetim için)
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

// Socket.IO bağlantıları
io.on('connection', (socket) => {
  console.log('Yeni kullanıcı bağlandı:', socket.id);
  
  // Kullanıcı bilgilerini kaydet
  socket.on('user-connected', (user) => {
    socket.username = user.username;
    socket.deviceType = user.deviceType; // 'mobile' veya 'dispatch'
    console.log(`${user.username} bağlandı (${user.deviceType})`);
    
    // Mevcut çağrıları gönder
    socket.emit('initial-calls', activeCalls);
    
    // Mevcut chat mesajlarını gönder
    socket.emit('initial-messages', chatMessages);
  });
  
  // Yeni çağrı oluşturma
  socket.on('new-call', async (callData) => {
    const newCall = {
      id: callIdCounter++,
      ...callData,
      timestamp: new Date().toISOString(),
      status: 'pending',
      caller: socket.username
    };
    
    activeCalls.push(newCall);
    
    // Tüm kullanıcılara gönder
    io.emit('call-created', newCall);
    
    // Discord pager'a gönder
    let discordMessage = `**YENİ ÇAĞRI**\n`;
    discordMessage += `**Çağrı Sahibi:** ${newCall.caller}\n`;
    discordMessage += `**Başlık:** ${newCall.title}\n`;
    discordMessage += `**Detay:** ${newCall.details}\n`;
    discordMessage += `**Konum:** ${newCall.location}\n`;
    discordMessage += `**Aciliyet:** ${newCall.priority}\n`;
    discordMessage += `**Zaman:** ${new Date(newCall.timestamp).toLocaleString('tr-TR')}`;
    
    // ACİL çağrı ise @everyone ekle
    if (newCall.priority === 'Acil') {
      discordMessage = `@everyone\n🚨 **ACİL ÇAĞRI** 🚨\n\n${discordMessage}`;
      
      // Bot API'ye acil bildirim gönder (tüm kullanıcılara DM)
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
  
  // Çağrıyı alındı olarak işaretle
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
  
  // Chat mesajı gönderme
  socket.on('send-message', async (message) => {
    const chatMessage = {
      id: Date.now(),
      username: socket.username,
      deviceType: socket.deviceType, // 'mobile' veya 'dispatch'
      message: message,
      timestamp: new Date().toISOString()
    };
    
    chatMessages.push(chatMessage);
    
    // Tüm kullanıcılara gönder
    io.emit('new-message', chatMessage);
    
    // Discord'a gönder
    const displayName = socket.deviceType === 'dispatch' 
      ? `${socket.username} (dispatch)` 
      : socket.username;
    
    await sendToDiscord(DISCORD_WEBHOOKS.chat, `**${displayName}:** ${message}`);
  });
  
  // Chat'i temizle
  socket.on('clear-chat', () => {
    chatMessages = [];
    io.emit('chat-cleared');
  });
  
  // Bildirim gönder (PC'den)
  socket.on('send-notification', async () => {
    const notificationMessage = `**${socket.username} (dispatch)** bir bildirim gönderdi.`;
    await sendToDiscord(DISCORD_WEBHOOKS.pager, notificationMessage);
    
    // Tüm kullanıcılara bildirim gönderildiğini bildir
    io.emit('notification-sent', { 
      sender: socket.username,
      timestamp: new Date().toISOString()
    });
  });
  
  // Bağlantı koptuğunda
  socket.on('disconnect', () => {
    console.log('Kullanıcı ayrıldı:', socket.username || socket.id);
  });
});

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`OCST Dispatch Backend çalışıyor: ${PORT}`);
});