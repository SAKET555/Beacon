import { create } from 'zustand';
import api from '../services/api';
import { connectSocket, disconnectSocket } from '../services/socket';

const useAuthStore = create((set, get) => ({
  user: JSON.parse(localStorage.getItem('beacon_user') || 'null'),
  token: localStorage.getItem('beacon_token') || null,
  isAuthenticated: !!localStorage.getItem('beacon_token'),
  loading: false,

  login: async (email, password) => {
    set({ loading: true });
    try {
      const { data } = await api.post('/auth/login', { email, password });
      localStorage.setItem('beacon_token', data.token);
      localStorage.setItem('beacon_user', JSON.stringify(data.user));
      connectSocket(data.token);
      set({ user: data.user, token: data.token, isAuthenticated: true, loading: false });
      return { success: true };
    } catch (error) {
      set({ loading: false });
      return { success: false, error: error.response?.data?.error || 'Login failed' };
    }
  },

  register: async (username, email, password) => {
    set({ loading: true });
    try {
      const { data } = await api.post('/auth/register', { username, email, password });
      localStorage.setItem('beacon_token', data.token);
      localStorage.setItem('beacon_user', JSON.stringify(data.user));
      connectSocket(data.token);
      set({ user: data.user, token: data.token, isAuthenticated: true, loading: false });
      return { success: true };
    } catch (error) {
      set({ loading: false });
      return { success: false, error: error.response?.data?.error || error.response?.data?.errors?.[0]?.msg || 'Registration failed' };
    }
  },

  logout: () => {
    localStorage.removeItem('beacon_token');
    localStorage.removeItem('beacon_user');
    disconnectSocket();
    set({ user: null, token: null, isAuthenticated: false });
  },

  fetchMe: async () => {
    try {
      const { data } = await api.get('/auth/me');
      localStorage.setItem('beacon_user', JSON.stringify(data.user));
      set({ user: data.user });
    } catch (error) {
      if (error.response?.status === 401) get().logout();
    }
  },

  updateProfile: async (updates) => {
    try {
      const { data } = await api.patch('/users/profile', updates);
      localStorage.setItem('beacon_user', JSON.stringify(data.user));
      set({ user: data.user });
      return { success: true };
    } catch (error) {
      return { success: false, error: error.response?.data?.error };
    }
  },

  updateStatus: async (status) => {
    try {
      const { data } = await api.patch('/users/status', { status });
      set({ user: data.user });
    } catch (error) {
      console.error('Status update failed:', error);
    }
  },

  setLocalStatus: (status) => {
    const current = get().user;
    if (!current) return;
    const updated = { ...current, status };
    localStorage.setItem('beacon_user', JSON.stringify(updated));
    set({ user: updated });
  },

  initSocket: () => {
    const token = get().token;
    if (token) connectSocket(token);
  }
}));

export default useAuthStore;
