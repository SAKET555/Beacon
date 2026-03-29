import { create } from 'zustand';
import api from '../services/api';

const useMessageStore = create((set, get) => ({
  messages: [],
  hasMore: false,
  loading: false,
  searchResults: [],

  fetchMessages: async (channelId, page = 1) => {
    set({ loading: true });
    try {
      const { data } = await api.get(`/messages/${channelId}?page=${page}&limit=50`);
      if (page === 1) {
        set({ messages: data.messages, hasMore: data.hasMore, loading: false });
      } else {
        set(state => ({
          messages: [...data.messages, ...state.messages],
          hasMore: data.hasMore,
          loading: false
        }));
      }
    } catch (error) {
      set({ loading: false });
      console.error('Fetch messages failed:', error);
    }
  },

  sendMessage: async (channelId, content, attachments = [], replyTo = null, mentions = []) => {
    try {
      const { data } = await api.post(`/messages/${channelId}`, {
        content, attachments, replyTo, mentions
      });
      return { success: true, message: data.message };
    } catch (error) {
      return { success: false, error: error.response?.data?.error };
    }
  },

  editMessage: async (messageId, content) => {
    try {
      const { data } = await api.patch(`/messages/${messageId}`, { content });
      set(state => ({
        messages: state.messages.map(m => m._id === messageId ? data.message : m)
      }));
      return { success: true };
    } catch (error) {
      return { success: false, error: error.response?.data?.error };
    }
  },

  deleteMessage: async (messageId) => {
    try {
      await api.delete(`/messages/${messageId}`);
      set(state => ({
        messages: state.messages.map(m =>
          m._id === messageId ? { ...m, isDeleted: true, content: '', attachments: [] } : m
        )
      }));
      return { success: true };
    } catch (error) {
      return { success: false, error: error.response?.data?.error };
    }
  },

  reactToMessage: async (messageId, emoji) => {
    try {
      const { data } = await api.post(`/messages/${messageId}/react`, { emoji });
      set(state => ({
        messages: state.messages.map(m =>
          m._id === messageId ? { ...m, reactions: data.reactions } : m
        )
      }));
      return { success: true };
    } catch (error) {
      return { success: false };
    }
  },

  addMessage: (message) => {
    set(state => {
      const exists = state.messages.some(m => m._id === message._id);
      if (exists) return state;
      return { messages: [...state.messages, message] };
    });
  },

  updateMessage: (message) => {
    set(state => ({
      messages: state.messages.map(m => m._id === message._id ? message : m)
    }));
  },

  removeMessage: (messageId) => {
    set(state => ({
      messages: state.messages.map(m =>
        m._id === messageId ? { ...m, isDeleted: true, content: '', attachments: [] } : m
      )
    }));
  },

  updateReactions: (messageId, reactions) => {
    set(state => ({
      messages: state.messages.map(m =>
        m._id === messageId ? { ...m, reactions } : m
      )
    }));
  },

  searchMessages: async (channelId, query) => {
    try {
      const { data } = await api.get(`/messages/search/${channelId}?q=${encodeURIComponent(query)}`);
      set({ searchResults: data.messages });
      return data.messages;
    } catch (error) {
      return [];
    }
  },

  clearMessages: () => set({ messages: [], hasMore: false }),
  clearSearch: () => set({ searchResults: [] }),
}));

export default useMessageStore;
