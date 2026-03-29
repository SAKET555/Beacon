import { create } from 'zustand';
import api from '../services/api';

const useChannelStore = create((set, get) => ({
  channels: [],
  currentChannel: null,
  pinnedMessages: [],
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

  addChannel: (channel) => set(state => ({ channels: [...state.channels, channel] })),
  removeChannel: (channelId) => set(state => ({
    channels: state.channels.filter(c => c._id !== channelId)
  })),
}));

export default useChannelStore;
