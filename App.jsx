import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactPlayer from 'react-player';
import io from 'socket.io-client';

// Upewnij się, że adres jest poprawny!
const SOCKET_URL = 'https://aleanimiec-backend.onrender.com';
const socket = io(SOCKET_URL);

function App() {
  const [url, setUrl] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [inputUrl, setInputUrl] = useState('');
  
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [user, setUser] = useState(null);
  
  // NOWOŚĆ: Czy użytkownik jest adminem?
  const [isAdmin, setIsAdmin] = useState(false);

  const [chatWidth, setChatWidth] = useState(320);
  const isResizing = useRef(false);

  const playerRef = useRef(null);
  const isRemoteUpdate = useRef(false);
  const chatEndRef = useRef(null);
  const hasFetched = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');

    if (code && !user && !hasFetched.current) {
      hasFetched.current = true;
      window.history.replaceState({}, document.title, "/");

      fetch(`${SOCKET_URL}/api/auth/discord`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, redirect_uri: window.location.origin + "/" })
      })
      .then(res => { if(!res.ok) throw new Error("Błąd"); return res.json(); })
      .then(userData => {
        if (userData.username) {
          setUser({
            username: userData.username,
            id: userData.id,
            avatar: userData.avatar ? `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.png` : "https://cdn.discordapp.com/embed/avatars/0.png"
          });
        }
      })
      .catch(err => { console.error(err); hasFetched.current = false; });
    }
  }, []);

  const handleLogin = () => {
    const CLIENT_ID = "1464662587466580234"; 
    const REDIRECT_URI = encodeURIComponent(window.location.origin + "/");
    window.location.href = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URI}&response_type=code&scope=identify`;
  };

  useEffect(() => {
    socket.on('sync_state', (state) => {
      if (state.currentUrl) setUrl(state.currentUrl);
      setIsPlaying(state.isPlaying);
    });
    socket.on('sync_url', (newUrl) => { setUrl(newUrl); setIsPlaying(true); });
    socket.on('sync_play', (time) => { 
        isRemoteUpdate.current = true; setIsPlaying(true); 
        if (playerRef.current && Math.abs(playerRef.current.getCurrentTime() - time) > 0.5) playerRef.current.seekTo(time, 'seconds');
    });
    socket.on('sync_pause', (time) => { 
        isRemoteUpdate.current = true; setIsPlaying(false);
        if(playerRef.current) playerRef.current.seekTo(time, 'seconds');
    });
    socket.on('sync_seek', (time) => { 
        isRemoteUpdate.current = true; 
        if(playerRef.current) playerRef.current.seekTo(time, 'seconds'); 
    });
    socket.on('receive_message', (msg) => setMessages((prev) => [...prev, msg]));

    // Potwierdzenie admina
    socket.on('admin_success', (success) => {
        if (success) {
            setIsAdmin(true);
            alert("✅ Jesteś teraz administratorem! Możesz sterować wideo.");
        } else {
            alert("❌ Złe hasło!");
        }
    });

    return () => socket.off();
  }, []);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  // --- HANDLERS (Teraz wysyłają tylko jeśli isAdmin = true) ---
  const handlePlay = () => { 
    if (!isAdmin) return; // Zablokuj jeśli nie admin
    if (!isRemoteUpdate.current) socket.emit('admin_play', playerRef.current.getCurrentTime());
    setTimeout(() => { isRemoteUpdate.current = false; }, 100); 
  };

  const handlePause = () => { 
    if (!isAdmin) return; // Zablokuj jeśli nie admin
    if (!isRemoteUpdate.current) socket.emit('admin_pause', playerRef.current.getCurrentTime());
    setTimeout(() => { isRemoteUpdate.current = false; }, 100); 
  };
  
  const sendMessage = (e) => {
    e.preventDefault();
    if (!chatInput.trim() || !user) return;

    // --- SYSTEM KOMEND ---
    if (chatInput.startsWith('/admin ')) {
        const password = chatInput.split(' ')[1];
        socket.emit('auth_admin', password); // Wysyłamy hasło do serwera
        setChatInput('');
        return; // Nie wysyłaj tego na czat publiczny!
    }
    // ---------------------

    socket.emit('chat_message', { 
      user: user.username, 
      avatar: user.avatar,
      text: chatInput 
    });
    setChatInput('');
  };

  const handleUrlSubmit = (e) => {
      e.preventDefault();
      if (!isAdmin) {
          alert("🔒 Musisz wpisać komendę /admin HASŁO na czacie, aby zmieniać filmy!");
          return;
      }
      if(inputUrl) { socket.emit('admin_change_url', inputUrl); setInputUrl(''); }
  };

  // Resizing logic (skrócone dla czytelności, wklej to co miałeś)
  const startResizing = useCallback(() => { isResizing.current = true; document.addEventListener("mousemove", handleMouseMove); document.addEventListener("mouseup", handleMouseUp); }, []);
  const handleMouseMove = useCallback((e) => { if(isResizing.current) setChatWidth(Math.max(200, Math.min(800, document.body.clientWidth - e.clientX))); }, []);
  const handleMouseUp = useCallback(() => { isResizing.current = false; document.removeEventListener("mousemove", handleMouseMove); document.removeEventListener("mouseup", handleMouseUp); }, []);

  return (
    <div className="flex h-screen bg-gray-900 text-white overflow-hidden font-sans">
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative group">
        
        {/* Pasek Adresu - Pokazujemy kłódkę jeśli nie admin */}
        <div className="absolute top-0 left-0 w-full z-50 p-4 bg-gray-900/90 flex gap-2 border-b border-gray-700 transition-opacity duration-300 opacity-0 hover:opacity-100">
           <form onSubmit={handleUrlSubmit} className="flex w-full gap-2 max-w-4xl mx-auto items-center">
             {!isAdmin && <span className="text-xl" title="Brak uprawnień">🔒</span>}
             <input 
                className={`flex-1 p-2 bg-gray-800 rounded border focus:outline-none ${isAdmin ? 'border-gray-600 focus:border-indigo-500' : 'border-red-900 text-gray-500 cursor-not-allowed'}`}
                value={inputUrl} 
                onChange={e=>setInputUrl(e.target.value)} 
                placeholder={isAdmin ? "Link wideo..." : "Wpisz /admin HASŁO na czacie, aby odblokować"} 
                readOnly={!isAdmin}
             />
             <button disabled={!isAdmin} className={`px-4 py-2 rounded font-bold ${isAdmin ? 'bg-indigo-600 hover:bg-indigo-500' : 'bg-gray-700 cursor-not-allowed text-gray-500'}`}>Start</button>
           </form>
        </div>
        
        <div className="flex-1 bg-black relative w-full h-full overflow-hidden">
          {url ? (
            <ReactPlayer 
                ref={playerRef} 
                url={url} 
                playing={isPlaying} 
                controls={true} // Controls muszą być true, żebyś Ty mógł sterować
                width="100%" height="100%"
                style={{ position: 'absolute', top: 0, left: 0 }} 
                onPlay={handlePlay} 
                onPause={handlePause} 
                config={{ file: { forceVideo: true } }}
            />
          ) : (
            <div className="flex w-full h-full items-center justify-center flex-col text-gray-500">
                <span className="text-4xl mb-2">⬆️</span>
                <span>{isAdmin ? "Wklej link" : "Zaloguj się jako Admin"}</span>
            </div>
          )}
        </div>
      </div>
      <div onMouseDown={startResizing} className="w-1 bg-gray-700 hover:bg-indigo-500 cursor-col-resize z-50"></div>
      <div className="bg-gray-800 border-l border-gray-700 flex flex-col flex-shrink-0" style={{ width: chatWidth }}>
        <div className="p-4 bg-gray-900 border-b border-gray-700 font-bold text-indigo-400 flex justify-between items-center">
            <span className="truncate">💬 Czat {isAdmin && <span className="text-xs bg-red-600 text-white px-1 rounded ml-2">ADMIN</span>}</span>
            {user ? <img src={user.avatar} className="w-6 h-6 rounded-full" alt="" /> : <button onClick={handleLogin} className="bg-indigo-600 text-xs px-2 py-1 rounded">Zaloguj</button>}
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((msg, index) => (
            <div key={index} className={`flex gap-3 ${msg.fromDiscord ? '' : 'flex-row-reverse'}`}><img src={msg.avatar || "https://cdn.discordapp.com/embed/avatars/0.png"} className="w-8 h-8 rounded-full" /><div className={`p-2 rounded-lg text-sm ${msg.fromDiscord ? 'bg-gray-700' : 'bg-indigo-600'}`}>{msg.text}</div></div>
          ))}
          <div ref={chatEndRef} />
        </div>
        <div className="p-3 bg-gray-900 border-t border-gray-700">
           {user ? (
             <form onSubmit={sendMessage} className="flex gap-2">
               <input type="text" className="flex-1 p-2 rounded bg-gray-700 text-white text-sm" placeholder={isAdmin ? "Napisz..." : "Wpisz /admin HASŁO aby przejąć ster"} value={chatInput} onChange={(e) => setChatInput(e.target.value)} />
               <button className="text-indigo-400 font-bold">➤</button>
             </form>
           ) : <button onClick={handleLogin} className="w-full bg-indigo-600 py-2 rounded text-sm">Zaloguj się</button>}
        </div>
      </div>
    </div>
  );
}

export default App;