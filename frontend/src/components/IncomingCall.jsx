import { useEffect, useRef } from 'react';
import { Phone, PhoneOff, Video } from 'lucide-react';

const RING_TIMEOUT_MS = 30000;

// Soft two-tone ring generated with Web Audio (no audio file needed).
const startRinging = () => {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return () => {};
  const ctx = new AudioCtx();
  const ring = () => {
    [0, 0.25].forEach((offset, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = i === 0 ? 880 : 660;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + offset);
      gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + offset + 0.22);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + offset);
      osc.stop(ctx.currentTime + offset + 0.25);
    });
  };
  ring();
  const interval = setInterval(ring, 2000);
  return () => {
    clearInterval(interval);
    ctx.close();
  };
};

export default function IncomingCall({ call, onAccept, onDecline }) {
  const declineRef = useRef(onDecline);
  declineRef.current = onDecline;

  useEffect(() => {
    const stop = startRinging();
    const timeout = setTimeout(() => declineRef.current(), RING_TIMEOUT_MS);
    return () => {
      stop();
      clearTimeout(timeout);
    };
  }, [call.channelId]);

  const name = call.caller?.displayName || call.caller?.username || 'Someone';
  const isVideo = call.mode === 'video';

  return (
    <div className="fixed top-4 right-4 z-[60] glass rounded-2xl border border-beacon-border shadow-2xl p-4 w-80 animate-slide-up">
      <div className="flex items-center gap-3">
        <div className="relative">
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-beacon-accent to-emerald-400 flex items-center justify-center text-white font-bold overflow-hidden">
            {call.caller?.avatar ? <img src={call.caller.avatar} alt="" className="w-full h-full object-cover" /> : name[0].toUpperCase()}
          </div>
          <span className="absolute inset-0 rounded-full border-2 border-status-online animate-ping" />
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-text-primary truncate">{name}</p>
          <p className="text-xs text-text-muted truncate">
            {isVideo ? 'Video' : 'Voice'} call in #{call.channelName}
          </p>
        </div>
      </div>
      <div className="flex gap-2 mt-4">
        <button onClick={onDecline} className="btn-secondary flex-1 flex items-center justify-center gap-2">
          <PhoneOff size={16} /> Decline
        </button>
        <button onClick={onAccept} className="btn-primary flex-1 flex items-center justify-center gap-2">
          {isVideo ? <Video size={16} /> : <Phone size={16} />} Join
        </button>
      </div>
    </div>
  );
}
