import { create } from 'zustand';
import api from '../services/api';

const useServerStore = create((set, get) => ({
  servers: [],
  currentServer: null,
  loading: false,

  fetchServers: async () => {
    set({ loading: true });
    try {
      const { data } = await api.get('/servers');
      set({ servers: data.servers, loading: false });
    } catch (error) {
      set({ loading: false });
      console.error('Fetch servers failed:', error);
    }
  },

  fetchServer: async (serverId) => {
    try {
      const { data } = await api.get(`/servers/${serverId}`);
      set({ currentServer: data.server });
      return data.server;
    } catch (error) {
      console.error('Fetch server failed:', error);
      return null;
    }
  },

  createServer: async (name, description) => {
    try {
      const { data } = await api.post('/servers', { name, description });
      set(state => ({ servers: [...state.servers, data.server] }));
      return { success: true, server: data.server };
    } catch (error) {
      return { success: false, error: error.response?.data?.error };
    }
  },

  joinServer: async (serverId) => {
    try {
      const { data } = await api.post(`/servers/${serverId}/join`);
      set(state => ({ servers: [...state.servers, data.server] }));
      return { success: true };
    } catch (error) {
      return { success: false, error: error.response?.data?.error };
    }
  },

  joinByInvite: async (code) => {
    try {
      const { data } = await api.post(`/servers/join/invite/${code}`);
      set(state => ({ servers: [...state.servers, data.server] }));
      return { success: true, server: data.server };
    } catch (error) {
      return { success: false, error: error.response?.data?.error };
    }
  },

  leaveServer: async (serverId) => {
    try {
      await api.post(`/servers/${serverId}/leave`);
      set(state => ({
        servers: state.servers.filter(s => s._id !== serverId),
        currentServer: state.currentServer?._id === serverId ? null : state.currentServer
      }));
      return { success: true };
    } catch (error) {
      return { success: false, error: error.response?.data?.error };
    }
  },

  updateServer: async (serverId, updates) => {
    try {
      const { data } = await api.patch(`/servers/${serverId}`, updates);
      set(state => ({
        currentServer: state.currentServer?._id === serverId ? data.server : state.currentServer,
        servers: state.servers.map(s => (s._id === serverId ? { ...s, ...data.server } : s))
      }));
      return { success: true, server: data.server };
    } catch (error) {
      return { success: false, error: error.response?.data?.error };
    }
  },

  setCurrentServer: (server) => set({ currentServer: server }),
}));

export default useServerStore;
