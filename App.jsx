import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactPlayer from 'react-player';
import io from 'socket.io-client';

// ADRES BACKENDU (Render)
// Upewnij się, że ten adres jest poprawny!
const SOCKET_URL = 'https://aleanimiec-backend.onrender.com/';
const socket = io(SOCKET_URL);

function App() {
  const [url, setUrl] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [inputUrl, setInputUrl] = useState('');
  
  // Czat i Użytkownik
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [user, setUser] = useState(null);
  
  // Resizing
  const [chatWidth, setChatWidth] = useState(320);
  const isResizing = useRef(false);

  const playerRef = useRef(null);
  const isRemoteUpdate = useRef(false);
  const chatEndRef = useRef(null);

  // --- KLUCZOWA POPRAWKA: ZABEZPIECZENIE PRZED PODWÓJNYM LOGOWANIEM ---
  const hasFetched = useRef(false);

  // --- LOGOWANIE OAUTH2 ---
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');

    // Sprawdzamy !hasFetched.current, żeby nie wysłać kodu dwa razy
    if (code && !user && !hasFetched.current) {
      hasFetched.current = true; // Blokujemy kolejne próby natychmiast
      
      console.log("Mam kod z Discorda, próbuję logować...");

      // Czyścimy URL z kodu
      window.history.replaceState({}, document.title, "/");

      fetch(`${SOCKET_URL}/api/auth/discord`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            code,
            // Wysyłamy backendowi informację, skąd wracamy (localhost czy vercel)
            redirect_uri: window.location.origin + "/" 
        })
      })
      .then(res => {
          if (!res.ok) {
            // Jeśli serwer zwróci błąd, rzuć wyjątek, żeby trafił do catch
            return res.text().then(text => { throw new Error(text) });
          }
          return res.json();
      })
      .then(userData => {
        if (userData.username) {
          console.log("✅ Zalogowano pomyślnie jako:", userData.username);
          setUser({
            username: userData.username,
            id: userData.id,
            avatar: userData.avatar 
              ? `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.png`
              : "https://cdn.discordapp.com/embed/avatars/0.png"
          });
        }
      })
      .catch(err => {
          console.error("❌ Błąd logowania:", err);
          alert("Błąd logowania: " + err.message);
          hasFetched.current = false; // Odblokuj w razie błędu
      });
    }
  }, []);

  const handleLogin = () => {
    // PODMIEŃ NA SWÓJ CLIENT ID Z PANELU DISCORDA
    const CLIENT_ID = "1464662587466580234"; 
    
    // Dynamicznie ustalamy adres powrotu (działa i na localhost i na Vercel)
    const CURRENT_ORIGIN = window.location.origin + "/";
    const REDIRECT_URI = encodeURIComponent(CURRENT_ORIGIN);
    
    window.location.href = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URI}&response_type=code&scope=identify`;
  };

  // --- SOCKET LISTENERS ---
  useEffect(() => {
    socket.on('sync_state', (state) => {
      if (state.currentUrl) setUrl(state.currentUrl);
      setIsPlaying(state.isPlaying);
    });

    socket.on('sync_url', (newUrl) => { 
        setUrl(newUrl); 
        setIsPlaying(true); 
    });

    socket.on('sync_play', (time) => { 
        isRemoteUpdate.current = true; 
        setIsPlaying(true); 
        if (playerRef.current) {
            const current = playerRef.current.getCurrentTime();
            if (Math.abs(current - time) > 0.5) playerRef.current.seekTo(time, 'seconds');
        }
    });

    socket.on('sync_pause', (time) => { 
        isRemoteUpdate.current = true; 
        setIsPlaying(false);
        if(playerRef.current) playerRef.current.seekTo(time, 'seconds');
    });

    socket.on('sync_seek', (time) => { 
        isRemoteUpdate.current = true; 
        if(playerRef.current) playerRef.current.seekTo(time, 'seconds'); 
    });
    
    socket.on('receive_message', (msg) => setMessages((prev) => [...prev, msg]));

    return () => socket.off();
  }, []);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  // --- HANDLERS ---
  const handlePlay = () => { 
    if (!isRemoteUpdate.current) socket.emit('admin_play', playerRef.current.getCurrentTime());
    setTimeout(() => { isRemoteUpdate.current = false; }, 100); 
  };

  const handlePause = () => { 
    if (!isRemoteUpdate.current) socket.emit('admin_pause', playerRef.current.getCurrentTime());
    setTimeout(() => { isRemoteUpdate.current = false; }, 100); 
  };
  
  const sendMessage = (e) => {
    e.preventDefault();
    if (chatInput.trim() && user) {
      socket.emit('chat_message', { 
        user: user.username, 
        avatar: user.avatar,
        text: chatInput 
      });
      setChatInput('');
    }
  };

  const handleUrlSubmit = (e) => {
      e.preventDefault();
      if(inputUrl) { socket.emit('admin_change_url', inputUrl); setInputUrl(''); }
  };

  // --- RESIZING LOGIC ---
  const startResizing = useCallback(() => {
    isResizing.current = true;
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    document.body.style.cursor = "col-resize"; 
    document.body.style.userSelect = "none"; 
  }, []);

  const handleMouseMove = useCallback((e) => {
    if (!isResizing.current) return;
    const newWidth = document.body.clientWidth - e.clientX;
    if (newWidth > 200 && newWidth < 800) {
      setChatWidth(newWidth);
    }
  }, []);

  const handleMouseUp = useCallback(() => {
    isResizing.current = false;
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", handleMouseUp);
    document.body.style.cursor = "default";
    document.body.style.userSelect = "auto";
  }, []);


  return (
    <div className="flex h-screen bg-gray-900 text-white overflow-hidden font-sans">
      
      {/* LEWA STRONA (Wideo) */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative group">
        
        {/* Pasek Adresu */}
        <div className="absolute top-0 left-0 w-full z-50 p-4 bg-gray-900/90 flex gap-2 border-b border-gray-700 transition-opacity duration-300 opacity-0 hover:opacity-100">
           <form onSubmit={handleUrlSubmit} className="flex w-full gap-2 max-w-4xl mx-auto">
             <input 
                className="flex-1 p-2 bg-gray-800 rounded border border-gray-600 focus:outline-none focus:border-indigo-500" 
                value={inputUrl} 
                onChange={e=>setInputUrl(e.target.value)} 
                placeholder="Link wideo..." 
             />
             <button className="bg-indigo-600 px-4 rounded hover:bg-indigo-500 font-bold">Start</button>
           </form>
        </div>
        
        {/* Kontener Playera */}
        <div className="flex-1 bg-black relative w-full h-full overflow-hidden">
          {url ? (
            <ReactPlayer 
                ref={playerRef} 
                url={url} 
                playing={isPlaying} 
                controls={true} 
                width="100%" 
                height="100%"
                style={{ position: 'absolute', top: 0, left: 0 }} 
                onPlay={handlePlay} 
                onPause={handlePause} 
                config={{
                    file: { forceVideo: true } 
                }}
            />
          ) : (
            <div className="flex w-full h-full items-center justify-center flex-col text-gray-500">
                <span className="text-4xl mb-2">⬆️</span>
                <span>Najedź na górę ekranu, aby wkleić link</span>
            </div>
          )}
        </div>
      </div>

      {/* UCHWYT RESIZER */}
      <div
        onMouseDown={startResizing}
        className="w-1 bg-gray-700 hover:bg-indigo-500 cursor-col-resize z-50 transition-colors shadow-[0_0_10px_rgba(0,0,0,0.5)]"
        title="Przesuń"
      ></div>

      {/* PRAWA STRONA: CZAT */}
      <div 
        className="bg-gray-800 border-l border-gray-700 flex flex-col flex-shrink-0"
        style={{ width: chatWidth }} 
      >
        <div className="p-4 bg-gray-900 border-b border-gray-700 font-bold text-indigo-400 flex justify-between items-center">
            <span className="truncate">💬 Czat</span>
            {user ? (
                <div className="flex items-center gap-2" title="Zalogowany">
                    <img src={user.avatar} className="w-6 h-6 rounded-full" alt="" />
                    <span className="text-xs text-white truncate max-w-[80px]">{user.username}</span>
                </div>
            ) : (
                <button onClick={handleLogin} className="bg-indigo-600 hover:bg-indigo-500 text-xs px-2 py-1 rounded text-white transition">
                    Zaloguj
                </button>
            )}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((msg, index) => (
            <div key={index} className={`flex gap-3 ${msg.fromDiscord ? '' : 'flex-row-reverse'}`}>
                <img 
                    src={msg.avatar || "https://cdn.discordapp.com/embed/avatars/0.png"} 
                    className="w-8 h-8 rounded-full mt-1 border border-gray-600 flex-shrink-0"
                    alt={msg.user}
                />
                <div className={`flex flex-col max-w-[80%] ${msg.fromDiscord ? 'items-start' : 'items-end'}`}>
                    <span className="text-[10px] text-gray-400 mb-0.5">{msg.user}</span>
                    <div className={`p-2 rounded-lg text-sm shadow-sm break-words ${msg.fromDiscord ? 'bg-gray-700 text-gray-200 rounded-tl-none' : 'bg-indigo-600 text-white rounded-tr-none'}`}>
                        {msg.text}
                    </div>
                </div>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>

        <div className="p-3 bg-gray-900 border-t border-gray-700">
           {user ? (
             <form onSubmit={sendMessage} className="flex gap-2">
               <input type="text" className="flex-1 p-2 rounded bg-gray-700 text-white text-sm min-w-0" placeholder="Napisz..." value={chatInput} onChange={(e) => setChatInput(e.target.value)} />
               <button type="submit" className="text-indigo-400 font-bold hover:text-white px-2">➤</button>
             </form>
           ) : (
             <div className="text-center">
                 <button onClick={handleLogin} className="w-full bg-indigo-600 py-2 rounded text-sm hover:bg-indigo-500 font-bold">
                     Zaloguj się
                 </button>
             </div>
           )}
        </div>
      </div>
    </div>
  );
}

export default App;