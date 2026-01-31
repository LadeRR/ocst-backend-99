const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages
  ]
});

const app = express();
app.use(express.json());

// Discord bot token (buraya kendi bot tokeninizi yazın)
const DISCORD_BOT_TOKEN = 'process.env.DISCORD_BOT_TOKEN';

// Acil çağrı bildirimi için kullanıcı ID'leri (örnek)
// Sunucunuzdaki kullanıcıların ID'lerini buraya ekleyin
const ALERT_USERS = [
  // 'USER_ID_1',
  // 'USER_ID_2',
  // 'USER_ID_3'
];

client.once('ready', () => {
  console.log(`Discord bot aktif: ${client.user.tag}`);
});

// Acil çağrı bildirimi endpoint'i
app.post('/api/emergency-alert', async (req, res) => {
  const { callData } = req.body;

  if (!callData) {
    return res.status(400).json({ success: false, message: 'Çağrı verisi bulunamadı' });
  }

  try {
    const alertMessage = `🚨 **ACİL ÇAĞRI** 🚨\n\n` +
      `**Çağrı Sahibi:** ${callData.caller}\n` +
      `**Başlık:** ${callData.title}\n` +
      `**Detay:** ${callData.details}\n` +
      `**Konum:** ${callData.location}\n` +
      `**Zaman:** ${new Date(callData.timestamp).toLocaleString('tr-TR')}`;

    // Her kullanıcıya özel mesaj gönder
    for (const userId of ALERT_USERS) {
      try {
        const user = await client.users.fetch(userId);
        await user.send(alertMessage);
      } catch (error) {
        console.error(`Kullanıcıya mesaj gönderilemedi (${userId}):`, error.message);
      }
    }

    res.json({ success: true, message: 'Bildirimler gönderildi' });
  } catch (error) {
    console.error('Acil bildirim hatası:', error);
    res.status(500).json({ success: false, message: 'Bildirim gönderilemedi' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', bot: client.user?.tag || 'Offline' });
});

const PORT = process.env.BOT_PORT || 3002;

app.listen(PORT, () => {
  console.log(`Discord bot API çalışıyor: ${PORT}`);
});

client.login(DISCORD_BOT_TOKEN); process.env.DISCORD_BOT_TOKEN;

// Hata yakalama
client.on('error', (error) => {
  console.error('Discord bot hatası:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
});

