import 'dotenv/config';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { Client, GatewayIntentBits, WebhookClient } from 'discord.js';
import axios from 'axios';

// --- DANE Z PLIKU .ENV (LUB RENDER ENVIRONMENT) ---
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const WEBHOOK_URL = process.env.WEBHOOK_URL;

// Domyślny fallback (dla bezpieczeństwa)
const DEFAULT_REDIRECT_URI = "https://aleanimiec.vercel.app/";

const webhookClient = new WebhookClient({ url: WEBHOOK_URL });

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

// --- ENDPOINT DO LOGOWANIA OAUTH2 ---
app.post('/api/auth/discord', async (req, res) => {
  // ODBIERAMY 'redirect_uri' Z FRONTENDU!
  const { code, redirect_uri } = req.body;
  
  if (!code) return res.status(400).send('Brak kodu');

  try {
    const tokenResponse = await axios.post(
      'https://discord.com/api/oauth2/token',
      new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        // Używamy tego co przysłał frontend, żeby pasowało do tego, gdzie był użytkownik
        redirect_uri: redirect_uri || DEFAULT_REDIRECT_URI,
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const { access_token } = tokenResponse.data;

    const userResponse = await axios.get('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    res.json(userResponse.data);

  } catch (error) {
    console.error('Błąd logowania Discord:', error.response?.data || error.message);
    // Zwracamy szczegóły błędu do frontendu
    res.status(500).json({ error: error.response?.data?.error_description || 'Błąd autoryzacji' });
  }
});

// --- BOT DISCORD ---
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

client.once('ready', () => { console.log(`✅ Bot Discorda gotowy: ${client.user.tag}`); });

client.on('messageCreate', (message) => {
  if (message.author.bot) return;

  if (message.channel.id === DISCORD_CHANNEL_ID) {
    const msgData = {
      user: message.author.username,
      avatar: message.author.displayAvatarURL(),
      text: message.content,
      fromDiscord: true
    };
    io.emit('receive_message', msgData);
  }
});

client.login(DISCORD_TOKEN);

// --- SOCKET.IO ---
let roomState = { currentUrl: null, isPlaying: false, currentTime: 0, lastUpdated: Date.now() };

io.on('connection', (socket) => {
  socket.emit('sync_state', roomState);

  socket.on('admin_change_url', (url) => { roomState.currentUrl = url; roomState.isPlaying = true; io.emit('sync_url', url); });
  socket.on('admin_play', (time) => { roomState.isPlaying = true; io.emit('sync_play', time); });
  socket.on('admin_pause', (time) => { roomState.isPlaying = false; io.emit('sync_pause', time); });
  socket.on('admin_seek', (time) => { io.emit('sync_seek', time); });

  socket.on('chat_message', async (msg) => {
    try {
      await webhookClient.send({
        content: msg.text,
        username: msg.user,
        avatarURL: msg.avatar || "https://cdn.discordapp.com/embed/avatars/0.png"
      });
    } catch (e) {
      console.error("Błąd Webhooka:", e);
    }
    io.emit('receive_message', { ...msg, fromDiscord: false });
  });
});

server.listen(3002, () => console.log('Serwer działa na porcie 3002'));