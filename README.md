# 🏰 Royal Beacon

A fully functional, production-ready, real-time messaging platform combining the best of Discord, WhatsApp, and Element. Built with React, Python (FastAPI + python-socketio), Socket.IO, and MongoDB.

![Discord-inspired UI](https://img.shields.io/badge/UI-Discord%20Inspired-5865F2) ![Real-time](https://img.shields.io/badge/Real--time-Socket.IO-010101) ![MongoDB](https://img.shields.io/badge/Database-MongoDB-47A248)

---

## 📁 Folder Structure

```
BEACON/
├── backend/                     # Python (FastAPI + python-socketio)
│   ├── app/
│   │   ├── main.py                # App entry: middleware, rate limits, routers, Socket.IO
│   │   ├── config.py              # Env loading + validation, CORS origins
│   │   ├── db.py                  # MongoDB (Motor) + indexes
│   │   ├── security.py            # bcrypt passwords, JWT auth
│   │   ├── permissions.py         # Roles and permissions
│   │   ├── access.py              # Membership / DM access checks
│   │   ├── sockets.py             # Socket.IO events (presence, typing, calls)
│   │   ├── calls.py               # Call ringing + call history
│   │   ├── link_preview.py        # SSRF-safe link previews
│   │   ├── scheduled.py           # Scheduled message delivery
│   │   └── routes/                # auth, users, servers, channels, messages,
│   │                              # upload, admin, notifications, calls
│   ├── tests/                     # pytest security tests
│   ├── requirements.txt
│   └── .env.example               # Environment variables template
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
- Python 3.12+ (backend) and Node.js 18+ (frontend only)
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
| `JWT_SECRET` | At least 32 random characters. Generate one with `python -c "import secrets; print(secrets.token_hex(48))"` |
| `CLOUDINARY_CLOUD_NAME` | From Cloudinary dashboard |
| `CLOUDINARY_API_KEY` | From Cloudinary dashboard |
| `CLOUDINARY_API_SECRET` | From Cloudinary dashboard |
| `CLIENT_URL` | Frontend origin allowed by CORS. `http://localhost:5173` for local dev; required in production. Separate several with commas |
| `PORT` | `5000` (default) |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Optional, for push notifications (`npx web-push generate-vapid-keys`) |
| `TURN_URLS` + `TURN_SECRET` (or `TURN_USERNAME`/`TURN_CREDENTIAL`) | Optional but recommended: a TURN relay so calls connect on strict networks (mobile data, office Wi-Fi) |

### Step 2: Start the Backend
```bash
cd backend
python -m venv .venv
.venv/Scripts/activate        # macOS/Linux: source .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload --port 5000
```
You should see:
```
INFO MongoDB connected
INFO Beacon (Python) running on port 5000
```
Run the tests with `pytest`.

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
2. Click "Create one" → Register **User A** (e.g. `alice`, `alice@test.com`, `password1234`)
3. Create a server → "My Server"
4. Note the invite code from the server menu → "Invite People"
5. Open `http://localhost:5173` in **Browser Tab 2** (incognito recommended)
6. Register **User B** (e.g. `bob`, `bob@test.com`, `password1234`)
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
   - `VITE_VAPID_PUBLIC_KEY=<same as the backend VAPID_PUBLIC_KEY>` (optional, for push notifications)
5. Deploy! (`frontend/vercel.json` already handles page routing, so refreshing `/app` works)

> The backend cannot run on Vercel: it needs a long-running server for Socket.IO (chat, presence, calls) and the scheduled-message loop. Host it on Render (below), Railway or Fly.io.

### Backend → Render
**Easiest:** Render dashboard → **New → Blueprint** → pick this repo. `render.yaml` sets up the service (Python, build/start commands, health check) and asks for your secrets once. Then set `CLIENT_URL` to your Vercel URL.

**Or manually:**
1. Go to [render.com](https://render.com) → New Web Service
2. Connect GitHub repo
3. Set root directory: `backend`
4. Runtime: **Python 3** (the `backend/.python-version` file pins 3.12)
5. Build command: `pip install -r requirements.txt`
6. Start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT --proxy-headers` (and env var `FORWARDED_ALLOW_IPS=*`)
7. Add all environment variables from `.env`
8. Set `CLIENT_URL` to your Vercel frontend URL (required: the server refuses to start in production without it)
9. Also set `NODE_ENV=production`
10. Deploy!

> Render's free plan sleeps after 15 minutes without traffic, so the first request after a pause can take ~50 seconds. A paid instance stays awake.

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
| `CORS error` | Ensure CLIENT_URL matches frontend URL exactly (no trailing slash; comma-separate multiple URLs) |
| `Upload failed` | Check Cloudinary credentials |
| `Socket connection error` | Ensure VITE_SOCKET_URL points to backend |
| `Cannot find module` | Run `npm install` in `frontend` |
| `ModuleNotFoundError` | Activate the venv and run `pip install -r requirements.txt` in `backend` |

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
