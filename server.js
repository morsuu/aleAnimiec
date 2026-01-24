import 'dotenv/config';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { Client, GatewayIntentBits, WebhookClient } from 'discord.js';
import axios from 'axios';

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin";

const DEFAULT_REDIRECT_URI = "https://aleanimiec.vercel.app/";

const webhookClient = new WebhookClient({ url: WEBHOOK_URL });

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

// --- AUTH ---
app.post('/api/auth/discord', async (req, res) => {
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
    console.error('Błąd logowania:', error.message);
    res.status(500).json({ error: 'Błąd autoryzacji' });
  }
});

// --- BOT ---
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});
client.once('ready', () => { console.log(`✅ Bot gotowy`); });
client.on('messageCreate', (message) => {
  if (message.author.bot) return;
  if (message.channel.id === DISCORD_CHANNEL_ID) {
    io.emit('receive_message', {
      user: message.author.username,
      avatar: message.author.displayAvatarURL(),
      text: message.content,
      fromDiscord: true
    });
  }
});
client.login(DISCORD_TOKEN);

// --- SOCKET LOGIC ---
let roomState = { currentUrl: null, isPlaying: false, currentTime: 0 };

io.on('connection', (socket) => {
  socket.isAdmin = false;
  socket.lastMessageTime = 0;

  socket.emit('sync_state', roomState);

  socket.on('auth_admin', (password) => {
    if (password === ADMIN_PASSWORD) {
      socket.isAdmin = true;
      socket.emit('admin_success', true);
    } else {
      socket.emit('admin_success', false);
    }
  });

  // --- FUNKCJE ADMINA ---
  socket.on('admin_change_url', (url) => {
    if (!socket.isAdmin) return; 
    roomState.currentUrl = url; 
    roomState.isPlaying = true; 
    io.emit('sync_url', url);
  });

  socket.on('admin_play', (time) => {
    if (!socket.isAdmin) return;
    roomState.isPlaying = true; 
    io.emit('sync_play', time);
  });

  socket.on('admin_pause', (time) => {
    if (!socket.isAdmin) return;
    roomState.isPlaying = false; 
    io.emit('sync_pause', time);
  });

  socket.on('admin_seek', (time) => {
    if (!socket.isAdmin) return;
    io.emit('sync_seek', time);
  });

  // --- CZAT (WYŁĄCZONY) ---
  /*
  socket.on('chat_message', async (msg) => {
    if (!msg.text || msg.text.length > 500) return;
    const now = Date.now();
    if (now - socket.lastMessageTime < 1000) return; 
    socket.lastMessageTime = now;

    try {
      await webhookClient.send({
        content: msg.text,
        username: msg.user,
        avatarURL: msg.avatar || "https://cdn.discordapp.com/embed/avatars/0.png"
      });
    } catch (e) { console.error("Błąd Webhooka:", e); }
    
    io.emit('receive_message', { ...msg, fromDiscord: false });
  });
  */
});

server.listen(3002, () => console.log('Serwer działa na porcie 3002'));