import 'dotenv/config';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
// Dodaliśmy WebhookClient do importów
import { Client, GatewayIntentBits, WebhookClient } from 'discord.js';
import axios from 'axios';

// --- TWOJE DANE KONFIGURACYJNE ---
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;

// Dane do logowania OAuth2
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = "https://aleanimiec.vercel.app/";

// Webhook do wysyłania ładnych wiadomości
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const webhookClient = new WebhookClient({ url: WEBHOOK_URL });
// ---------------------------------

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

// --- ENDPOINT DO LOGOWANIA OAUTH2 ---
app.post('/api/auth/discord', async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).send('Brak kodu');

  try {
    // 1. Wymień kod na token dostępu
    const tokenResponse = await axios.post(
      'https://discord.com/api/oauth2/token',
      new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: REDIRECT_URI,
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const { access_token } = tokenResponse.data;

    // 2. Pobierz dane użytkownika przy użyciu tokenu
    const userResponse = await axios.get('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    res.json(userResponse.data);

  } catch (error) {
    console.error('Błąd logowania Discord:', error.response?.data || error.message);
    res.status(500).json({ error: 'Błąd autoryzacji' });
  }
});

// --- BOT DISCORD (Służy do ODBIERANIA wiadomości z Discorda) ---
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

client.once('ready', () => { console.log(`✅ Bot Discorda gotowy: ${client.user.tag}`); });

client.on('messageCreate', (message) => {
  // Ignorujemy wiadomości od botów (W TYM OD NASZEGO WEBHOOKA!)
  // To zapobiega dublowaniu wiadomości na stronie
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

  // Wideo
  socket.on('admin_change_url', (url) => { roomState.currentUrl = url; roomState.isPlaying = true; io.emit('sync_url', url); });
  socket.on('admin_play', (time) => { roomState.isPlaying = true; io.emit('sync_play', time); });
  socket.on('admin_pause', (time) => { roomState.isPlaying = false; io.emit('sync_pause', time); });
  socket.on('admin_seek', (time) => { io.emit('sync_seek', time); });

  // --- CZAT (Wysyłanie przez Webhooka) ---
  socket.on('chat_message', async (msg) => {
    // msg = { user, text, avatar }

    // 1. Wyślij na Discorda używając Webhooka (Podstawiamy nick i avatar!)
    try {
      await webhookClient.send({
        content: msg.text,
        username: msg.user, // Tu wstawiamy nick użytkownika ze strony
        avatarURL: msg.avatar || "https://cdn.discordapp.com/embed/avatars/0.png" // Tu wstawiamy jego avatar
      });
    } catch (e) {
      console.error("Błąd Webhooka:", e);
    }

    // 2. Wyślij z powrotem do Reacta (żeby użytkownik widział co napisał od razu)
    io.emit('receive_message', { ...msg, fromDiscord: false });
  });
});

server.listen(3002, () => console.log('Serwer działa na porcie 3002'));