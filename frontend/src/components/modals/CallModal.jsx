import { useEffect, useRef, useState } from 'react';
import { X, Mic, MicOff, Video, VideoOff } from 'lucide-react';
import { getSocket } from '../../services/socket';
import useUIStore from '../../store/uiStore';

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

export default function CallModal({ channel, user, mode = 'video' }) {
  const { closeCall } = useUIStore();
  const localVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const peersRef = useRef(new Map());
  const [remoteStreams, setRemoteStreams] = useState([]);
  const [micEnabled, setMicEnabled] = useState(true);
  const [camEnabled, setCamEnabled] = useState(mode === 'video');

  const updateRemoteStream = (userId, stream) => {
    setRemoteStreams(prev => {
      const filtered = prev.filter(s => s.userId !== userId);
      return [...filtered, { userId, stream }];
    });
  };

  const removeRemoteStream = (userId) => {
    setRemoteStreams(prev => prev.filter(s => s.userId !== userId));
  };

  const createPeerConnection = (targetUserId) => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        getSocket()?.emit('call:ice', {
          channelId: channel._id,
          targetUserId,
          candidate: event.candidate
        });
      }
    };
    pc.ontrack = (event) => {
      const [remoteStream] = event.streams;
      updateRemoteStream(targetUserId, remoteStream);
    };

    localStreamRef.current?.getTracks().forEach(track => pc.addTrack(track, localStreamRef.current));
    peersRef.current.set(targetUserId, pc);
    return pc;
  };

  const handleLeave = () => {
    const socket = getSocket();
    socket?.emit('call:leave', { channelId: channel._id });
    peersRef.current.forEach(pc => pc.close());
    peersRef.current.clear();
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    localStreamRef.current = null;
    setRemoteStreams([]);
    setParticipants(new Map());
    closeCall();
  };

  useEffect(() => {
    const socket = getSocket();
    if (!socket || !channel?._id) return;

    const init = async () => {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: mode === 'video'
      });
      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      socket.emit('call:join', { channelId: channel._id, mode });
    };

    init();

    socket.on('call:user-joined', async ({ userId }) => {
      if (userId === user?._id) return;
      const pc = createPeerConnection(userId);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('call:offer', { channelId: channel._id, targetUserId: userId, sdp: offer });
    });

    socket.on('call:offer', async ({ userId, sdp, targetUserId }) => {
      if (userId === user?._id) return;
      if (targetUserId && targetUserId !== user?._id) return;
      const pc = peersRef.current.get(userId) || createPeerConnection(userId);
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('call:answer', { channelId: channel._id, targetUserId: userId, sdp: answer });
    });

    socket.on('call:answer', async ({ userId, sdp, targetUserId }) => {
      if (targetUserId && targetUserId !== user?._id) return;
      const pc = peersRef.current.get(userId);
      if (!pc) return;
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    });

    socket.on('call:ice', async ({ userId, candidate, targetUserId }) => {
      if (targetUserId && targetUserId !== user?._id) return;
      const pc = peersRef.current.get(userId);
      if (!pc) return;
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (error) {
        console.error('ICE error', error);
      }
    });

    socket.on('call:user-left', ({ userId }) => {
      const pc = peersRef.current.get(userId);
      if (pc) pc.close();
      peersRef.current.delete(userId);
      removeRemoteStream(userId);
    });

    return () => {
      socket.off('call:user-joined');
      socket.off('call:offer');
      socket.off('call:answer');
      socket.off('call:ice');
      socket.off('call:user-left');
      handleLeave();
    };
  }, [channel?._id]);

  const toggleMic = () => {
    localStreamRef.current?.getAudioTracks().forEach(track => {
      track.enabled = !track.enabled;
      setMicEnabled(track.enabled);
    });
  };

  const toggleCam = () => {
    localStreamRef.current?.getVideoTracks().forEach(track => {
      track.enabled = !track.enabled;
      setCamEnabled(track.enabled);
    });
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={handleLeave}>
      <div className="glass rounded-2xl w-full max-w-4xl shadow-2xl border border-beacon-border animate-slide-up" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-beacon-border">
          <h2 className="text-lg font-bold text-text-primary">{mode === 'video' ? 'Video Call' : 'Voice Call'}</h2>
          <button onClick={handleLeave} className="text-text-muted hover:text-text-primary">
            <X size={20} />
          </button>
        </div>

        <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="rounded-xl bg-beacon-hover border border-beacon-border overflow-hidden">
            {mode === 'video' ? (
              <video ref={localVideoRef} autoPlay muted playsInline className="w-full h-64 object-cover" />
            ) : (
              <div className="h-64 flex items-center justify-center text-text-muted">Audio only</div>
            )}
          </div>
          {remoteStreams.map(({ userId, stream }) => (
            <div key={userId} className="rounded-xl bg-beacon-hover border border-beacon-border overflow-hidden">
              <video
                autoPlay
                playsInline
                className="w-full h-64 object-cover"
                ref={el => {
                  if (el) el.srcObject = stream;
                }}
              />
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-beacon-border flex items-center justify-center gap-3">
          <button onClick={toggleMic} className="btn-secondary">
            {micEnabled ? <Mic size={18} /> : <MicOff size={18} />}
          </button>
          {mode === 'video' && (
            <button onClick={toggleCam} className="btn-secondary">
              {camEnabled ? <Video size={18} /> : <VideoOff size={18} />}
            </button>
          )}
          <button onClick={handleLeave} className="btn-danger">Leave</button>
        </div>
      </div>
    </div>
  );
}
