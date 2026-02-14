import React, { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import ReactPlayer from 'react-player';
import io from 'socket.io-client';

const SOCKET_URL = 'https://aleanimiec-backend.onrender.com';
const socket = io(SOCKET_URL);

const normalizePixeldrainUrl = (url) => {
  if (/^pixeldrain\.(com|net)\//i.test(url)) {
    return 'https://' + url;
  }
  return url;
};

const isPixeldrainUrl = (url) => /^https?:\/\/pixeldrain\.(com|net)\/api\/file\//.test(url);

const PixeldrainPlayer = forwardRef(({ url, playing, controls, width, height, style, onPlay, onPause }, ref) => {
  const videoRef = useRef(null);

  useImperativeHandle(ref, () => ({
    getCurrentTime: () => videoRef.current ? videoRef.current.currentTime : 0,
    seekTo: (time) => { if (videoRef.current) videoRef.current.currentTime = time; },
  }));

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.load();
    }
  }, [url]);

  useEffect(() => {
    if (!videoRef.current) return;
    if (playing) {
      videoRef.current.play().catch((err) => console.warn('Autoplay failed:', err));
    } else {
      videoRef.current.pause();
    }
  }, [playing]);

  return (
    <video
      ref={videoRef}
      controls={controls}
      crossOrigin="anonymous"
      style={{ ...style, width: width || '100%', height: height || '100%', objectFit: 'contain' }}
      onPlay={onPlay}
      onPause={onPause}
      preload="auto"
    >
      <source src={url} type="video/mp4" />
      <source src={url} type="video/webm" />
    </video>
  );
});

PixeldrainPlayer.displayName = 'PixeldrainPlayer';

function App() {
  const [url, setUrl] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [inputUrl, setInputUrl] = useState('');
  const [user, setUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const playerRef = useRef(null);
  const isRemoteUpdate = useRef(false);
  const hasFetched = useRef(false);

  // --- NOWOŚĆ: KEEP-ALIVE (PING CO 5 MINUT) ---
  useEffect(() => {
    const pingServer = () => {
      fetch(`${SOCKET_URL}/keep-alive`)
        .then(() => console.log("💓 Ping do serwera wysłany (Keep-Alive)"))
        .catch(err => console.error("⚠️ Błąd pingu:", err));
    };

    // Wyślij pierwszy ping od razu
    pingServer();

    // Ustaw interwał co 5 minut (300 000 ms)
    // Render zasypia po 15 min, więc 5 min jest bezpieczne
    const intervalId = setInterval(pingServer, 5 * 60 * 1000);

    return () => clearInterval(intervalId);
  }, []);
  // ---------------------------------------------

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
      if (state.currentUrl) setUrl(normalizePixeldrainUrl(state.currentUrl));
      setIsPlaying(state.isPlaying);
    });
    socket.on('sync_url', (newUrl) => { setUrl(normalizePixeldrainUrl(newUrl)); setIsPlaying(true); });
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

  const convertPixeldrainUrl = async (inputUrl) => {
      // Normalize: add https:// if the URL starts with pixeldrain without a protocol
      inputUrl = normalizePixeldrainUrl(inputUrl);
      // Handle direct API URLs like https://pixeldrain.net/api/file/ID or https://pixeldrain.net/api/list/ID
      const apiMatch = inputUrl.match(/^https?:\/\/pixeldrain\.(com|net)\/api\/(file|list)\/([a-zA-Z0-9]+)/);
      if (apiMatch) {
          const [, domain, apiType, id] = apiMatch;
          if (apiType === 'file') {
              return `https://pixeldrain.${domain}/api/file/${id}`;
          }
          // apiType === 'list'
          try {
              const res = await fetch(`https://pixeldrain.${domain}/api/list/${id}`);
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              const data = await res.json();
              if (Array.isArray(data.files) && data.files.length > 0) {
                  return `https://pixeldrain.${domain}/api/file/${data.files[0].id}`;
              }
          } catch (err) {
              console.error("Błąd pobierania listy pixeldrain:", err);
          }
          return inputUrl;
      }

      const match = inputUrl.match(/^https?:\/\/pixeldrain\.(com|net)\/(u|l)\/([a-zA-Z0-9]+)/);
      if (!match) return inputUrl;

      const [, domain, type, id] = match;

      if (type === 'u') {
          return `https://pixeldrain.${domain}/api/file/${id}`;
      }

      // type === 'l' — fetch list and get first file
      try {
          const res = await fetch(`https://pixeldrain.${domain}/api/list/${id}`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          if (Array.isArray(data.files) && data.files.length > 0) {
              return `https://pixeldrain.${domain}/api/file/${data.files[0].id}`;
          }
      } catch (err) {
          console.error("Błąd pobierania listy pixeldrain:", err);
      }
      return inputUrl;
  };

  const handleUrlSubmit = async (e) => {
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
          const finalUrl = await convertPixeldrainUrl(inputUrl);
          socket.emit('admin_change_url', finalUrl);
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
                placeholder={isAdmin ? "Link wideo..." : "Wpisz '/admin HASŁO' aby odblokować"} 
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
            isPixeldrainUrl(url) ? (
              <PixeldrainPlayer
                  ref={playerRef}
                  url={url}
                  playing={isPlaying}
                  controls={true}
                  width="100%" height="100%"
                  style={{ position: 'absolute', top: 0, left: 0 }}
                  onPlay={handlePlay}
                  onPause={handlePause}
              />
            ) : (
              <ReactPlayer 
                  ref={playerRef} 
                  url={url} 
                  playing={isPlaying} 
                  controls={true} 
                  width="100%" height="100%"
                  style={{ position: 'absolute', top: 0, left: 0 }} 
                  onPlay={handlePlay} 
                  onPause={handlePause} 
                  config={{ file: { forceVideo: true } }}
              />
            )
          ) : (
            <div className="flex w-full h-full items-center justify-center flex-col text-gray-500">
                <span className="text-4xl mb-2">⬆️</span>
                <span>{isAdmin ? "Wklej link na górze" : "Najedź na górę i wpisz /admin HASŁO"}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;