import { X } from 'lucide-react';
import useUIStore from '../../store/uiStore';

export default function FilePreviewModal() {
  const { showFilePreview, setFilePreview } = useUIStore();

  if (!showFilePreview) return null;

  const isVideo = showFilePreview.type?.startsWith('video/');

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setFilePreview(null)}>
      <div className="relative max-w-4xl w-full" onClick={e => e.stopPropagation()}>
        <button
          onClick={() => setFilePreview(null)}
          className="absolute -top-10 right-0 text-text-muted hover:text-text-primary"
        >
          <X size={24} />
        </button>
        {isVideo ? (
          <video src={showFilePreview.url} controls className="w-full rounded-2xl border border-beacon-border" />
        ) : (
          <img src={showFilePreview.url} alt={showFilePreview.name || ''} className="w-full rounded-2xl border border-beacon-border" />
        )}
      </div>
    </div>
  );
}
