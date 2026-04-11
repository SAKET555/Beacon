import { create } from 'zustand';
import api from '../services/api';

const useServerStore = create((set, get) => ({
  servers: [],
  currentServer: null,
  serverRoles: [],
  serverMembers: [],
  permissionKeys: [],
  myPermissions: {},
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

  fetchServerMembers: async (serverId) => {
    try {
      const { data } = await api.get(`/servers/${serverId}/members`);
      set({ serverMembers: data.members || [] });
      return { success: true, members: data.members || [] };
    } catch (error) {
      return { success: false, error: error.response?.data?.error };
    }
  },

  fetchServerRoles: async (serverId) => {
    try {
      const { data } = await api.get(`/servers/${serverId}/roles`);
      set({
        serverRoles: data.roles || [],
        permissionKeys: data.permissionKeys || [],
        myPermissions: data.permissions || {}
      });
      return { success: true, roles: data.roles || [] };
    } catch (error) {
      return { success: false, error: error.response?.data?.error };
    }
  },

  createServerRole: async (serverId, name) => {
    try {
      const { data } = await api.post(`/servers/${serverId}/roles`, { name });
      set({ serverRoles: data.roles || [] });
      return { success: true };
    } catch (error) {
      return { success: false, error: error.response?.data?.error };
    }
  },

  updateServerRole: async (serverId, roleId, updates) => {
    try {
      const { data } = await api.patch(`/servers/${serverId}/roles/${roleId}`, updates);
      set({ serverRoles: data.roles || [] });
      return { success: true };
    } catch (error) {
      return { success: false, error: error.response?.data?.error };
    }
  },

  deleteServerRole: async (serverId, roleId) => {
    try {
      const { data } = await api.delete(`/servers/${serverId}/roles/${roleId}`);
      set({ serverRoles: data.roles || [] });
      return { success: true };
    } catch (error) {
      return { success: false, error: error.response?.data?.error };
    }
  },

  updateMemberRoles: async (serverId, memberId, roleIds) => {
    try {
      const { data } = await api.patch(`/servers/${serverId}/members/${memberId}/roles`, { roleIds });
      set(state => ({
        serverMembers: state.serverMembers.map(m =>
          m.user?._id === memberId
            ? { ...m, role: data.member?.role ?? m.role, roleIds: data.member?.roleIds ?? m.roleIds }
            : m
        )
      }));
      return { success: true };
    } catch (error) {
      return { success: false, error: error.response?.data?.error };
    }
  },

  setCurrentServer: (server) => set({ currentServer: server }),
}));

export default useServerStore;
