import React, { useState, useEffect, useRef } from 'react';
import ReactPlayer from 'react-player';
import io from 'socket.io-client';

const SOCKET_URL = 'https://aleanimiec-backend.onrender.com';
const socket = io(SOCKET_URL);

// Funkcja do konwersji linków Pixeldrain na bezpośredni URL do MP4
function convertPixeldrainUrl(url) {
  try {
    // Pixeldrain list: https://pixeldrain.net/l/xxxxx
    if (url.includes('pixeldrain.net/l/')) {
      // Dla list nie możemy bezpośrednio odtworzyć - informujemy użytkownika
      console.warn('⚠️ Link do listy Pixeldrain - użyj linku do konkretnego pliku');
      return url; // Zwracamy oryginalny, może ReactPlayer jakoś obsłuży
    }
    
    // Pixeldrain single file: https://pixeldrain.net/u/xxxxx
    const pixeldrainMatch = url.match(/pixeldrain\.net\/u\/([a-zA-Z0-9_-]+)/);
    if (pixeldrainMatch) {
      const fileId = pixeldrainMatch[1];
      // Konwertujemy na bezpośredni link do API
      return `https://pixeldrain.com/api/file/${fileId}`;
    }
    
    // Jeśli to już jest link API, zostawiamy bez zmian
    if (url.includes('pixeldrain.com/api/file/')) {
      return url;
    }
    
    // Jeśli to inny link (YouTube, etc.), zwracamy bez zmian
    return url;
  } catch (error) {
    console.error('Błąd parsowania URL:', error);
    return url;
  }
}

function App() {
  const [url, setUrl] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [inputUrl, setInputUrl] = useState('');
  const [user, setUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const playerRef = useRef(null);
  const isRemoteUpdate = useRef(false);
  const hasFetched = useRef(false);

  // --- KEEP-ALIVE (PING CO 5 MINUT) ---
  useEffect(() => {
    const pingServer = () => {
      fetch(`${SOCKET_URL}/keep-alive`)
        .then(() => console.log("💓 Ping do serwera wysłany (Keep-Alive)"))
        .catch(err => console.error("⚠️ Błąd pingu:", err));
    };

    pingServer();
    const intervalId = setInterval(pingServer, 5 * 60 * 1000);

    return () => clearInterval(intervalId);
  }, []);

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
      .then(res => { 
        if(!res.ok) return res.text().then(text => { throw new Error(text) });
        return res.json(); 
      })
      .then(userData => {
        if (userData.username) {
          setUser({
            username: userData.username,
            id: userData.id,
            avatar: userData.avatar ? `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.png` : "https://cdn.discordapp.com/embed/avatars/0.png"
          });
        }
      })
      .catch(err => { 
          console.error("Błąd logowania:", err); 
          hasFetched.current = false; 
      });
    }
  }, []);

  const handleLogin = () => {
    const CLIENT_ID = "1464662587466580234"; 
    const REDIRECT_URI = encodeURIComponent(window.location.origin + "/");
    window.location.href = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URI}&response_type=code&scope=identify`;
  };

  useEffect(() => {
    socket.on('sync_state', (state) => {
      if (state.currentUrl) {
        const convertedUrl = convertPixeldrainUrl(state.currentUrl);
        setUrl(convertedUrl);
      }
      setIsPlaying(state.isPlaying);
    });
    
    socket.on('sync_url', (newUrl) => { 
      const convertedUrl = convertPixeldrainUrl(newUrl);
      setUrl(convertedUrl); 
      setIsPlaying(true); 
    });
    
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
    
    socket.on('admin_success', (success) => {
        if (success) {
            setIsAdmin(true);
            alert("✅ Jesteś administratorem!");
        } else {
            alert("❌ Złe hasło!");
        }
    });

    return () => socket.off();
  }, []);

  const handlePlay = () => { 
    if (!isAdmin) return; 
    if (!isRemoteUpdate.current) socket.emit('admin_play', playerRef.current.getCurrentTime());
    setTimeout(() => { isRemoteUpdate.current = false; }, 100); 
  };

  const handlePause = () => { 
    if (!isAdmin) return; 
    if (!isRemoteUpdate.current) socket.emit('admin_pause', playerRef.current.getCurrentTime());
    setTimeout(() => { isRemoteUpdate.current = false; }, 100); 
  };

  const handleUrlSubmit = (e) => {
      e.preventDefault();
      
      if (inputUrl.startsWith('/admin ')) {
          const password = inputUrl.split(' ')[1];
          socket.emit('auth_admin', password);
          setInputUrl('');
          return;
      }

      if (!isAdmin) {
          alert("🔒 Najedź na górę i wpisz: /admin HASŁO");
          return;
      }
      
      if(inputUrl) { 
          const convertedUrl = convertPixeldrainUrl(inputUrl);
          console.log('📺 Oryginalny URL:', inputUrl);
          console.log('🔄 Przekonwertowany URL:', convertedUrl);
          socket.emit('admin_change_url', convertedUrl); 
          setInputUrl(''); 
      }
  };

  return (
    <div className="flex h-screen bg-gray-900 text-white overflow-hidden font-sans">
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative group">
        
        <div className="absolute top-0 left-0 w-full z-50 p-4 bg-gray-900/90 flex gap-2 border-b border-gray-700 transition-opacity duration-300 opacity-0 hover:opacity-100 items-center justify-center">
           <form onSubmit={handleUrlSubmit} className="flex w-full gap-2 max-w-4xl items-center">
             {!isAdmin && <span className="text-xl" title="Brak uprawnień">🔒</span>}
             
             <input 
                className={`flex-1 p-2 bg-gray-800 rounded border focus:outline-none ${isAdmin ? 'border-gray-600 focus:border-indigo-500' : 'border-red-900 text-gray-300'}`}
                value={inputUrl} 
                onChange={e=>setInputUrl(e.target.value)} 
                placeholder={isAdmin ? "Link wideo (YouTube, Pixeldrain /u/xxxxx)..." : "Wpisz '/admin HASŁO' aby odblokować"} 
             />
             
             {isAdmin ? (
                 <button className="bg-indigo-600 hover:bg-indigo-500 px-4 py-2 rounded font-bold">Start</button>
             ) : (
                 <button className="bg-gray-700 cursor-not-allowed text-gray-500 px-4 py-2 rounded font-bold">Start</button>
             )}

             {user ? (
                 <img src={user.avatar} className="w-10 h-10 rounded-full border border-gray-500 ml-2" title={user.username} />
             ) : (
                 <button type="button" onClick={handleLogin} className="bg-green-600 hover:bg-green-500 text-xs px-3 py-2 rounded text-white ml-2 font-bold">
                    Zaloguj
                 </button>
             )}

           </form>
        </div>
        
        <div className="flex-1 bg-black relative w-full h-full overflow-hidden">
          {url ? (
            <ReactPlayer 
                ref={playerRef} 
                url={url} 
                playing={isPlaying} 
                controls={true} 
                width="100%" height="100%"
                style={{ position: 'absolute', top: 0, left: 0 }} 
                onPlay={handlePlay} 
                onPause={handlePause} 
                config={{ 
                  file: { 
                    forceVideo: true,
                    attributes: {
                      crossOrigin: 'anonymous'
                    }
                  } 
                }}
            />
          ) : (
            <div className="flex w-full h-full items-center justify-center flex-col text-gray-500">
                <span className="text-4xl mb-2">⬆️</span>
                <span>{isAdmin ? "Wklej link na górze (Pixeldrain: /u/xxxxx)" : "Najedź na górę i wpisz /admin HASŁO"}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
