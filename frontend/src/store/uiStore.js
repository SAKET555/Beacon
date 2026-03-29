import { create } from 'zustand';

const useUIStore = create((set) => ({
  showMemberPanel: true,
  showServerSettings: false,
  showCreateServer: false,
  showCreateChannel: false,
  showInviteModal: false,
  showSearchModal: false,
  showNotifications: false,
  showUserSettings: false,
  showPinnedMessages: false,
  showFilePreview: null,
  editingMessage: null,
  replyingTo: null,
  mobileMenuOpen: false,
  mobileSidebarOpen: false,

  toggleMemberPanel: () => set(s => ({ showMemberPanel: !s.showMemberPanel })),
  toggleServerSettings: () => set(s => ({ showServerSettings: !s.showServerSettings })),
  toggleCreateServer: () => set(s => ({ showCreateServer: !s.showCreateServer })),
  toggleCreateChannel: () => set(s => ({ showCreateChannel: !s.showCreateChannel })),
  toggleInviteModal: () => set(s => ({ showInviteModal: !s.showInviteModal })),
  toggleSearchModal: () => set(s => ({ showSearchModal: !s.showSearchModal })),
  toggleNotifications: () => set(s => ({ showNotifications: !s.showNotifications })),
  toggleUserSettings: () => set(s => ({ showUserSettings: !s.showUserSettings })),
  togglePinnedMessages: () => set(s => ({ showPinnedMessages: !s.showPinnedMessages })),
  setFilePreview: (file) => set({ showFilePreview: file }),
  setEditingMessage: (msg) => set({ editingMessage: msg }),
  setReplyingTo: (msg) => set({ replyingTo: msg }),
  toggleMobileMenu: () => set(s => ({ mobileMenuOpen: !s.mobileMenuOpen })),
  toggleMobileSidebar: () => set(s => ({ mobileSidebarOpen: !s.mobileSidebarOpen })),
  closeAllModals: () => set({
    showServerSettings: false, showCreateServer: false, showCreateChannel: false,
    showInviteModal: false, showSearchModal: false, showNotifications: false,
    showUserSettings: false, showPinnedMessages: false, showFilePreview: null,
    editingMessage: null
  }),
}));

export default useUIStore;
