# 🏰 Royal Beacon

A fully functional, production-ready, real-time messaging platform combining the best of Discord, WhatsApp, and Element. Built with React, Node.js, Socket.IO, and MongoDB.

![Discord-inspired UI](https://img.shields.io/badge/UI-Discord%20Inspired-5865F2) ![Real-time](https://img.shields.io/badge/Real--time-Socket.IO-010101) ![MongoDB](https://img.shields.io/badge/Database-MongoDB-47A248)

---

## 📁 Folder Structure

```
BEACON/
├── backend/
│   ├── config/
│   │   ├── db.js              # MongoDB connection
│   │   └── cloudinary.js      # Cloudinary config
│   ├── middleware/
│   │   ├── auth.js            # JWT authentication
│   │   ├── roleCheck.js       # Role-based access control
│   │   └── upload.js          # Multer file upload
│   ├── models/
│   │   ├── User.js            # User schema
│   │   ├── Server.js          # Server schema
│   │   ├── Channel.js         # Channel schema
│   │   ├── Message.js         # Message schema
│   │   ├── Notification.js    # Notification schema
│   │   └── AuditLog.js        # Admin audit log
│   ├── routes/
│   │   ├── auth.js            # Register, login, me
│   │   ├── users.js           # Profile, DMs, search
│   │   ├── servers.js         # Server CRUD, join/leave
│   │   ├── channels.js        # Channel CRUD, pins
│   │   ├── messages.js        # Messages, reactions, threads
│   │   ├── upload.js          # File upload to Cloudinary
│   │   ├── admin.js           # Admin dashboard, audit log
│   │   └── notifications.js   # Notification management
│   ├── socket/
│   │   └── index.js           # Socket.IO event handlers
│   ├── utils/
│   │   └── scheduled.js       # Scheduled message cron
│   ├── server.js              # Express entry point
│   ├── .env.example           # Environment variables template
│   └── package.json
├── frontend/
│   ├── public/
│   │   └── beacon.svg         # App favicon
│   ├── src/
│   │   ├── components/
│   │   │   ├── ServerSidebar.jsx   # Server list
│   │   │   ├── ChannelSidebar.jsx  # Channel list + user panel
│   │   │   ├── ChatArea.jsx        # Message display area
│   │   │   ├── MessageInput.jsx    # Rich text input
│   │   │   ├── MessageItem.jsx     # Individual message
│   │   │   ├── MembersPanel.jsx    # Online/offline members
│   │   │   └── modals/
│   │   │       ├── CreateServerModal.jsx
│   │   │       ├── CreateChannelModal.jsx
│   │   │       ├── InviteModal.jsx
│   │   │       ├── SearchModal.jsx
│   │   │       └── UserSettingsModal.jsx
│   │   ├── pages/
│   │   │   ├── LoginPage.jsx
│   │   │   ├── RegisterPage.jsx
│   │   │   └── MainLayout.jsx
│   │   ├── services/
│   │   │   ├── api.js          # Axios HTTP client
│   │   │   └── socket.js       # Socket.IO client
│   │   ├── store/
│   │   │   ├── authStore.js
│   │   │   ├── serverStore.js
│   │   │   ├── channelStore.js
│   │   │   ├── messageStore.js
│   │   │   ├── notificationStore.js
│   │   │   └── uiStore.js
│   │   ├── utils/
│   │   │   └── helpers.js
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   └── index.css
│   ├── index.html
│   ├── vite.config.js
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   └── package.json
└── README.md
```

---

## 🚀 Local Setup

### Prerequisites
- Node.js 18+ installed
- MongoDB Atlas account (free tier)
- Cloudinary account (free tier)

### Step 1: Configure Environment Variables

Copy the example and fill in your values:
```bash
cd backend
cp .env.example .env
```

Required values in `backend/.env`:
| Variable | Description |
|---|---|
| `MONGODB_URI` | MongoDB Atlas connection string |
| `JWT_SECRET` | Any random secret string (e.g. `my-secret-key-123`) |
| `CLOUDINARY_CLOUD_NAME` | From Cloudinary dashboard |
| `CLOUDINARY_API_KEY` | From Cloudinary dashboard |
| `CLOUDINARY_API_SECRET` | From Cloudinary dashboard |
| `CLIENT_URL` | `http://localhost:5173` for local dev |
| `PORT` | `5000` (default) |

### Step 2: Start the Backend
```bash
cd backend
npm install     # already done if you followed setup
npm run dev
```
You should see:
```
🏰 Royal Beacon server running on port 5000
📦 MongoDB connected: cluster0-shard-xxxxx.mongodb.net
```

### Step 3: Start the Frontend
```bash
cd frontend
npm install     # already done if you followed setup
npm run dev
```
Frontend runs at `http://localhost:5173`

### Step 4: Connect Frontend to Backend
The Vite config already proxies `/api` requests to `localhost:5000`. For production or separate hosts, create `frontend/.env`:
```
VITE_API_URL=http://localhost:5000
VITE_SOCKET_URL=http://localhost:5000
```

---

## 🧪 Testing Guide

### Test Real-Time Messaging

1. Open `http://localhost:5173` in **Browser Tab 1**
2. Click "Create one" → Register **User A** (e.g. `alice`, `alice@test.com`, `password123`)
3. Create a server → "My Server"
4. Note the invite code from the server menu → "Invite People"
5. Open `http://localhost:5173` in **Browser Tab 2** (incognito recommended)
6. Register **User B** (e.g. `bob`, `bob@test.com`, `password123`)
7. Click "+" → Join Server → paste invite code
8. Both users are now in the same server
9. Send messages — they appear in real-time on both tabs!

### Test Features
- **Markdown**: Type `**bold**`, `*italic*`, `` `code` ``
- **Reactions**: Hover a message → click emoji
- **Reply**: Hover → click reply icon
- **Edit**: Hover your own message → click pencil
- **Pin**: Hover → click pin icon
- **File Upload**: Click + or drag & drop files
- **Search**: Click search icon in channel header
- **Status**: Click your avatar → change status

---

## 🔧 API Endpoints

### Auth
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/auth/register` | Create account |
| POST | `/api/auth/login` | Sign in |
| GET | `/api/auth/me` | Get current user |

### Servers
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/servers` | Get user's servers |
| POST | `/api/servers` | Create server |
| POST | `/api/servers/:id/join` | Join server |
| POST | `/api/servers/join/invite/:code` | Join by invite code |

### Messages
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/messages/:channelId` | Get messages (paginated) |
| POST | `/api/messages/:channelId` | Send message |
| PATCH | `/api/messages/:id` | Edit message |
| DELETE | `/api/messages/:id` | Delete message |
| POST | `/api/messages/:id/react` | Toggle reaction |
| GET | `/api/messages/search/:channelId` | Search messages |

### Socket.IO Events
| Event | Direction | Description |
|---|---|---|
| `message:new` | Server → Client | New message received |
| `message:edited` | Server → Client | Message was edited |
| `message:deleted` | Server → Client | Message was deleted |
| `typing:start/stop` | Client → Server | Typing indicators |
| `typing:update` | Server → Client | Someone is typing |
| `presence:changed` | Server → Client | User status changed |
| `notification:new` | Server → Client | New notification |

---

## 🌐 Deployment

### Frontend → Vercel
1. Push code to GitHub
2. Go to [vercel.com](https://vercel.com) → Import repository
3. Set root directory: `frontend`
4. Add environment variables:
   - `VITE_API_URL=https://your-backend.onrender.com`
   - `VITE_SOCKET_URL=https://your-backend.onrender.com`
5. Deploy!

### Backend → Render
1. Go to [render.com](https://render.com) → New Web Service
2. Connect GitHub repo
3. Set root directory: `backend`
4. Build command: `npm install`
5. Start command: `npm start`
6. Add all environment variables from `.env`
7. Set `CLIENT_URL` to your Vercel frontend URL
8. Deploy!

### MongoDB Atlas Setup
1. Go to [cloud.mongodb.com](https://cloud.mongodb.com)
2. Create free M0 cluster
3. Create database user with password
4. Whitelist IP `0.0.0.0/0` (all IPs) for cloud hosting
5. Copy connection string → paste in `MONGODB_URI`

### Cloudinary Setup
1. Go to [cloudinary.com](https://cloudinary.com) → Sign up free
2. Dashboard → Copy Cloud name, API Key, API Secret
3. Paste into environment variables

---

## ❗ Common Errors

| Error | Fix |
|---|---|
| `MongoDB connection error` | Check MONGODB_URI, ensure IP whitelisted in Atlas |
| `401 Unauthorized` | Token expired, re-login |
| `CORS error` | Ensure CLIENT_URL matches frontend URL exactly |
| `Upload failed` | Check Cloudinary credentials |
| `Socket connection error` | Ensure VITE_SOCKET_URL points to backend |
| `Cannot find module` | Run `npm install` in the respective directory |

---

## ⚡ Key Features

- ✅ Real-time messaging via Socket.IO
- ✅ JWT authentication with bcrypt
- ✅ Server/channel management with roles
- ✅ Rich text (markdown) with formatting toolbar
- ✅ File uploads via Cloudinary
- ✅ Emoji reactions
- ✅ Message editing with version history
- ✅ Message deletion (soft delete)
- ✅ Reply threading
- ✅ Message pinning
- ✅ Full-text search (MongoDB)
- ✅ Typing indicators
- ✅ Online presence tracking
- ✅ Notifications (mentions, replies, reactions)
- ✅ Admin dashboard with audit log
- ✅ Role-based permissions (owner/admin/mod/member)
- ✅ Invite codes for servers
- ✅ User profiles with avatar, bio, status
- ✅ Draft saving (localStorage)
- ✅ Scheduled messages (cron)
- ✅ Spam filter / word filter
- ✅ Responsive design (mobile + desktop)
- ✅ Discord-inspired dark UI
