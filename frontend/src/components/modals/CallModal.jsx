import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Video, VideoOff, MonitorUp, MonitorX, PhoneOff, Minimize2, Maximize2, WifiOff } from 'lucide-react';
import { getSocket } from '../../services/socket';
import useUIStore from '../../store/uiStore';
import api from '../../services/api';
import toast from 'react-hot-toast';

const FALLBACK_ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];

const formatDuration = (seconds) => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
};

// One remote participant tile. Shows the avatar when there is no live video.
function Tile({ stream, label, avatar, state, muted = false, mirrored = false, videoOn = true }) {
  const videoRef = useRef(null);

  useEffect(() => {
    if (videoRef.current && stream) videoRef.current.srcObject = stream;
  }, [stream]);

  const failed = state === 'failed' || state === 'disconnected';
  return (
    <div className="relative rounded-xl bg-beacon-hover border border-beacon-border overflow-hidden aspect-video">
      <video ref={videoRef} autoPlay playsInline muted={muted}
        className={`w-full h-full object-cover ${videoOn ? '' : 'invisible'} ${mirrored ? 'scale-x-[-1]' : ''}`} />
      {!videoOn && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-beacon-accent to-emerald-400 flex items-center justify-center text-white text-xl font-bold overflow-hidden">
            {avatar ? <img src={avatar} alt="" className="w-full h-full object-cover" /> : (label?.[0] || '?').toUpperCase()}
          </div>
        </div>
      )}
      <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded-md bg-black/60 text-xs text-white flex items-center gap-1">
        {failed && <WifiOff size={12} className="text-red-400" />}
        {label}
        {state && state !== 'connected' && !failed && <span className="text-white/60">· connecting…</span>}
      </div>
    </div>
  );
}

export default function CallModal({ channel, user, mode = 'video' }) {
  const { closeCall } = useUIStore();
  const localStreamRef = useRef(null);
  const screenTrackRef = useRef(null);
  const peersRef = useRef(new Map());
  const pendingIceRef = useRef(new Map());
  const iceServersRef = useRef(FALLBACK_ICE);
  const [participants, setParticipants] = useState({}); // userId -> { stream, user, state }
  const [localStream, setLocalStream] = useState(null);
  const [micEnabled, setMicEnabled] = useState(true);
  const [camEnabled, setCamEnabled] = useState(mode === 'video');
  const [sharing, setSharing] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [seconds, setSeconds] = useState(0);

  const patchParticipant = (userId, patch) => {
    setParticipants(prev => ({ ...prev, [userId]: { ...(prev[userId] || {}), ...patch } }));
  };

  const removeParticipant = (userId) => {
    setParticipants(prev => {
      const next = { ...prev };
      delete next[userId];
      return next;
    });
  };

  const createPeerConnection = (targetUserId) => {
    const pc = new RTCPeerConnection({ iceServers: iceServersRef.current });
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        getSocket()?.emit('call:ice', { channelId: channel._id, targetUserId, candidate: event.candidate });
      }
    };
    pc.ontrack = (event) => patchParticipant(targetUserId, { stream: event.streams[0] });
    pc.onconnectionstatechange = () => {
      patchParticipant(targetUserId, { state: pc.connectionState });
      if (pc.connectionState === 'failed') {
        toast.error('Could not connect to a participant. Their network may need a TURN relay.');
      }
    };
    const stream = localStreamRef.current;
    stream?.getTracks().forEach(track => pc.addTrack(track, stream));
    if (screenTrackRef.current) {
      const sender = pc.getSenders().find(s => s.track?.kind === 'video');
      sender?.replaceTrack(screenTrackRef.current);
    }
    peersRef.current.set(targetUserId, pc);
    patchParticipant(targetUserId, { state: 'connecting' });
    return pc;
  };

  const flushPendingIce = async (userId, pc) => {
    const pending = pendingIceRef.current.get(userId) || [];
    for (const candidate of pending) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (error) {
        console.error('ICE flush error', error);
      }
    }
    pendingIceRef.current.delete(userId);
  };

  const cleanup = () => {
    peersRef.current.forEach(pc => pc.close());
    peersRef.current.clear();
    pendingIceRef.current.clear();
    screenTrackRef.current?.stop();
    screenTrackRef.current = null;
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    localStreamRef.current = null;
  };

  const handleLeave = () => {
    getSocket()?.emit('call:leave', { channelId: channel._id });
    cleanup();
    closeCall();
  };

  useEffect(() => {
    const socket = getSocket();
    if (!socket || !channel?._id) return;
    let cancelled = false;

    const init = async () => {
      try {
        // TURN servers come from the backend when configured (needed on strict networks)
        const { data } = await api.get('/calls/ice-servers');
        if (data?.iceServers?.length) iceServersRef.current = data.iceServers;
      } catch (error) {
        console.warn('Using fallback ICE servers', error);
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: mode === 'video' });
        if (cancelled) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        localStreamRef.current = stream;
        setLocalStream(stream);
        socket.emit('call:join', { channelId: channel._id, mode });
      } catch (error) {
        console.error('Failed to start media stream', error);
        toast.error(mode === 'video'
          ? 'Camera or microphone permission was denied'
          : 'Microphone permission was denied');
        closeCall();
      }
    };

    init();

    socket.on('call:user-joined', async ({ userId, user: peer }) => {
      if (userId === user?._id) return;
      patchParticipant(userId, { user: peer });
      const pc = createPeerConnection(userId);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('call:offer', { channelId: channel._id, targetUserId: userId, sdp: offer });
    });

    socket.on('call:offer', async ({ userId, sdp, targetUserId, user: peer }) => {
      if (userId === user?._id) return;
      if (targetUserId && targetUserId !== user?._id) return;
      if (peer) patchParticipant(userId, { user: peer });
      const pc = peersRef.current.get(userId) || createPeerConnection(userId);
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      await flushPendingIce(userId, pc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('call:answer', { channelId: channel._id, targetUserId: userId, sdp: answer });
    });

    socket.on('call:answer', async ({ userId, sdp, targetUserId }) => {
      if (targetUserId && targetUserId !== user?._id) return;
      const pc = peersRef.current.get(userId);
      if (!pc) return;
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      await flushPendingIce(userId, pc);
    });

    socket.on('call:ice', async ({ userId, candidate, targetUserId }) => {
      if (targetUserId && targetUserId !== user?._id) return;
      const pc = peersRef.current.get(userId);
      if (!pc || !pc.remoteDescription) {
        const pending = pendingIceRef.current.get(userId) || [];
        pending.push(candidate);
        pendingIceRef.current.set(userId, pending);
        return;
      }
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (error) {
        console.error('ICE error', error);
      }
    });

    socket.on('call:state', ({ userId, state }) => patchParticipant(userId, { remoteState: state }));

    socket.on('call:user-left', ({ userId }) => {
      peersRef.current.get(userId)?.close();
      peersRef.current.delete(userId);
      removeParticipant(userId);
    });

    const timer = setInterval(() => setSeconds(s => s + 1), 1000);
    const onUnload = () => socket.emit('call:leave', { channelId: channel._id });
    window.addEventListener('beforeunload', onUnload);

    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener('beforeunload', onUnload);
      ['call:user-joined', 'call:offer', 'call:answer', 'call:ice', 'call:state', 'call:user-left']
        .forEach(evt => socket.off(evt));
      socket.emit('call:leave', { channelId: channel._id });
      cleanup();
    };
  }, [channel?._id]);

  const broadcastState = (patch) => {
    getSocket()?.emit('call:state', { channelId: channel._id, state: { mic: micEnabled, cam: camEnabled, sharing, ...patch } });
  };

  const toggleMic = () => {
    const tracks = localStreamRef.current?.getAudioTracks() || [];
    const next = !micEnabled;
    tracks.forEach(track => { track.enabled = next; });
    setMicEnabled(next);
    broadcastState({ mic: next });
  };

  const toggleCam = () => {
    const tracks = localStreamRef.current?.getVideoTracks() || [];
    const next = !camEnabled;
    tracks.forEach(track => { track.enabled = next; });
    setCamEnabled(next);
    broadcastState({ cam: next });
  };

  const replaceOutgoingVideo = (track) => {
    peersRef.current.forEach(pc => {
      const sender = pc.getSenders().find(s => s.track?.kind === 'video');
      sender?.replaceTrack(track);
    });
  };

  const stopSharing = () => {
    screenTrackRef.current?.stop();
    screenTrackRef.current = null;
    const camTrack = localStreamRef.current?.getVideoTracks()[0] || null;
    replaceOutgoingVideo(camTrack);
    setSharing(false);
    broadcastState({ sharing: false });
  };

  const toggleShare = async () => {
    if (sharing) return stopSharing();
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const track = display.getVideoTracks()[0];
      screenTrackRef.current = track;
      track.onended = stopSharing; // user pressed the browser's "Stop sharing"
      replaceOutgoingVideo(track);
      setSharing(true);
      broadcastState({ sharing: true });
    } catch (error) {
      if (error?.name !== 'NotAllowedError') toast.error('Screen sharing is not available');
    }
  };

  const entries = Object.entries(participants);
  const title = `${mode === 'video' ? 'Video' : 'Voice'} call · #${channel?.name || 'channel'}`;

  if (minimized) {
    return (
      <div className="fixed bottom-4 right-4 z-50 glass rounded-2xl border border-beacon-border shadow-2xl p-3 flex items-center gap-3">
        <div className="text-sm">
          <p className="font-semibold text-text-primary">{title}</p>
          <p className="text-xs text-text-muted">{entries.length + 1} in call · {formatDuration(seconds)}</p>
        </div>
        <button onClick={toggleMic} className="btn-secondary p-2" title={micEnabled ? 'Mute' : 'Unmute'}>
          {micEnabled ? <Mic size={16} /> : <MicOff size={16} />}
        </button>
        <button onClick={() => setMinimized(false)} className="btn-secondary p-2" title="Expand"><Maximize2 size={16} /></button>
        <button onClick={handleLeave} className="btn-danger p-2" title="Leave"><PhoneOff size={16} /></button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="glass rounded-2xl w-full max-w-5xl shadow-2xl border border-beacon-border animate-slide-up max-h-[95vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-beacon-border">
          <div>
            <h2 className="text-lg font-bold text-text-primary">{title}</h2>
            <p className="text-xs text-text-muted">
              {entries.length === 0 ? 'Waiting for others to join…' : `${entries.length + 1} people`} · {formatDuration(seconds)}
            </p>
          </div>
          <button onClick={() => setMinimized(true)} className="text-text-muted hover:text-text-primary" title="Minimize">
            <Minimize2 size={20} />
          </button>
        </div>

        <div className={`p-4 grid gap-3 overflow-y-auto ${entries.length === 0 ? 'grid-cols-1 max-w-2xl mx-auto w-full' : entries.length < 4 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-2 md:grid-cols-3'}`}>
          <Tile stream={localStream} label={`${user?.displayName || user?.username} (you)`} avatar={user?.avatar}
            muted mirrored={!sharing} videoOn={mode === 'video' && (camEnabled || sharing)} state="connected" />
          {entries.map(([userId, p]) => (
            <Tile key={userId} stream={p.stream} state={p.state}
              label={p.user?.displayName || p.user?.username || 'Participant'} avatar={p.user?.avatar}
              videoOn={mode === 'video' && p.remoteState?.cam !== false || !!p.remoteState?.sharing} />
          ))}
        </div>

        <div className="p-4 border-t border-beacon-border flex items-center justify-center gap-3">
          <button onClick={toggleMic} className={micEnabled ? 'btn-secondary' : 'btn-danger'} title={micEnabled ? 'Mute' : 'Unmute'}>
            {micEnabled ? <Mic size={18} /> : <MicOff size={18} />}
          </button>
          {mode === 'video' && (
            <>
              <button onClick={toggleCam} className={camEnabled ? 'btn-secondary' : 'btn-danger'} title={camEnabled ? 'Turn camera off' : 'Turn camera on'}>
                {camEnabled ? <Video size={18} /> : <VideoOff size={18} />}
              </button>
              {navigator.mediaDevices?.getDisplayMedia && (
                <button onClick={toggleShare} className={sharing ? 'btn-primary' : 'btn-secondary'} title={sharing ? 'Stop sharing' : 'Share screen'}>
                  {sharing ? <MonitorX size={18} /> : <MonitorUp size={18} />}
                </button>
              )}
            </>
          )}
          <button onClick={handleLeave} className="btn-danger flex items-center gap-2"><PhoneOff size={18} /> Leave</button>
        </div>
      </div>
    </div>
  );
}
