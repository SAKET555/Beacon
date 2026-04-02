import { Plus, Compass } from 'lucide-react';
import useUIStore from '../store/uiStore';
import { getInitials, getStatusColor } from '../utils/helpers';

export default function ServerSidebar({ servers, currentServer, onSelect }) {
  const { toggleCreateServer } = useUIStore();

  return (
    <div className="w-14 sm:w-[72px] h-full bg-beacon-sidebar flex flex-col items-center py-3 gap-2 border-r border-beacon-border overflow-y-auto">
      {/* Home button */}
      <button onClick={() => onSelect(null)}
        className="w-10 h-10 sm:w-12 sm:h-12 rounded-2xl bg-gradient-to-br from-beacon-accent to-emerald-400 flex items-center justify-center text-white font-extrabold text-base sm:text-lg hover:rounded-xl transition-all duration-300 shadow-lg shadow-beacon-accent/25 mb-1">
        B
      </button>

      <div className="w-8 h-0.5 bg-beacon-border rounded-full mb-1" />

      {/* Server list */}
      {servers.map(server => {
        const isActive = currentServer?._id === server._id;
        return (
          <div key={server._id} className="relative group">
            {/* Active indicator */}
            <div className={`absolute left-0 top-1/2 -translate-y-1/2 -translate-x-[22px] w-1 rounded-r-full bg-text-primary transition-all duration-200 ${isActive ? 'h-10' : 'h-0 group-hover:h-5'}`} />

            <button onClick={() => onSelect(server)}
              className={`w-10 h-10 sm:w-12 sm:h-12 flex items-center justify-center transition-all duration-300 ${isActive ? 'rounded-xl bg-beacon-accent text-white' : 'rounded-2xl bg-beacon-hover text-text-secondary hover:rounded-xl hover:bg-beacon-accent hover:text-white'}`}
              title={server.name}>
              {server.icon ? (
                <img src={server.icon} alt={server.name} className="w-full h-full object-cover rounded-[inherit]" />
              ) : (
                <span className="text-sm font-bold">{getInitials(server.name)}</span>
              )}
            </button>
          </div>
        );
      })}

      {/* Join/Create buttons */}
      <button onClick={toggleCreateServer}
        className="w-10 h-10 sm:w-12 sm:h-12 rounded-2xl bg-beacon-hover text-status-online flex items-center justify-center hover:rounded-xl hover:bg-status-online hover:text-white transition-all duration-300 mt-1"
        title="Add a Server">
        <Plus size={22} />
      </button>

      <button className="w-10 h-10 sm:w-12 sm:h-12 rounded-2xl bg-beacon-hover text-status-online flex items-center justify-center hover:rounded-xl hover:bg-status-online hover:text-white transition-all duration-300"
        title="Explore Servers">
        <Compass size={22} />
      </button>
    </div>
  );
}
