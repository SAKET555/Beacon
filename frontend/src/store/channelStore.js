import { create } from 'zustand';
import api from '../services/api';

const useChannelStore = create((set, get) => ({
  channels: [],
  currentChannel: null,
  pinnedMessages: [],
  readBy: [],
  loading: false,

  fetchChannels: async (serverId) => {
    try {
      const { data } = await api.get(`/channels/${serverId}`);
      set({ channels: data.channels });
      return data.channels;
    } catch (error) {
      console.error('Fetch channels failed:', error);
      return [];
    }
  },

  createChannel: async (serverId, name, type = 'text', topic = '') => {
    try {
      const { data } = await api.post(`/channels/${serverId}`, { name, type, topic });
      set(state => ({ channels: [...state.channels, data.channel] }));
      return { success: true, channel: data.channel };
    } catch (error) {
      return { success: false, error: error.response?.data?.error };
    }
  },

  deleteChannel: async (channelId) => {
    try {
      await api.delete(`/channels/${channelId}`);
      set(state => ({
        channels: state.channels.filter(c => c._id !== channelId),
        currentChannel: state.currentChannel?._id === channelId ? null : state.currentChannel
      }));
      return { success: true };
    } catch (error) {
      return { success: false, error: error.response?.data?.error };
    }
  },

  setCurrentChannel: (channel) => set({ currentChannel: channel }),

  fetchPins: async (channelId) => {
    try {
      const { data } = await api.get(`/channels/${channelId}/pins`);
      set({ pinnedMessages: data.pinnedMessages });
    } catch (error) {
      console.error('Fetch pins failed:', error);
    }
  },

  togglePin: async (channelId, messageId) => {
    try {
      const { data } = await api.post(`/channels/${channelId}/pin/${messageId}`);
      return { success: true, pinned: data.pinned };
    } catch (error) {
      return { success: false, error: error.response?.data?.error };
    }
  },

  markAsRead: async (channelId) => {
    try {
      await api.post(`/channels/${channelId}/read`);
    } catch (error) {
      console.error('Mark read failed:', error);
    }
  },

  fetchReadState: async (channelId) => {
    try {
      const { data } = await api.get(`/channels/${channelId}/readers`);
      set({ readBy: data.readBy || [] });
    } catch (error) {
      console.error('Fetch read receipts failed:', error);
    }
  },

  updateReadState: ({ userId, user, lastRead }) => set(state => {
    const existing = state.readBy.find(r => r.user?._id === userId || r.user === userId);
    if (existing) {
      const updated = state.readBy.map(r => {
        if ((r.user?._id || r.user) === userId) {
          return { ...r, lastRead, user: r.user && typeof r.user === 'object' ? r.user : user || r.user };
        }
        return r;
      });
      return { readBy: updated };
    }
    return { readBy: [...state.readBy, { user: user || userId, lastRead }] };
  }),

  addChannel: (channel) => set(state => ({ channels: [...state.channels, channel] })),
  removeChannel: (channelId) => set(state => ({
    channels: state.channels.filter(c => c._id !== channelId)
  })),
}));

export default useChannelStore;
