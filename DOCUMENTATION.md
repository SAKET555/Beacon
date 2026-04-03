# Royal Beacon Documentation

This document explains how the current codebase works in plain language. It focuses on features, architecture, computer network concepts, data structures and algorithms (DSA), and the tools and libraries used. It is based strictly on the present repository.

## 1) What this app is
Royal Beacon is a real-time messaging platform with servers, channels, direct messages, reactions, pins, threads, file uploads, push notifications, and voice/video calls. It has a React frontend and a Node.js/Express backend with Socket.IO and MongoDB.

## 2) Architecture overview
High-level view:

- Frontend: React + Vite + Tailwind CSS, state managed with Zustand.
- Backend: Express API + Socket.IO server.
- Database: MongoDB using Mongoose models.
- Real-time: Socket.IO for chat events, presence, and call signaling.
- Media: WebRTC peer-to-peer for calls (audio/video).
- Storage: Cloudinary for uploads (attachments, avatars, server icons).
- Push: Web Push (VAPID keys) for notifications.
- Background tasks: node-cron for scheduled messages.

### 2.1) Basic diagram

```
Browser (React)
  |  HTTP (REST) /api/*
  |  WebSocket (Socket.IO) events
  v
Node.js (Express + Socket.IO)
  |  Mongoose
  v
MongoDB (royal-beacon database)

Uploads -> Cloudinary
Push -> Web Push service worker (sw.js)
Calls -> WebRTC peer-to-peer (STUN only)
```

### 2.2) Key runtime roles
- REST endpoints: CRUD, login/register, search, uploads, admin operations.
- Socket.IO: real-time events (messages, typing, presence, call signaling).
- WebRTC: direct media stream between peers.
- Cron: scheduled messages every minute.

## 3) Core flows (plain language)

### 3.1) Auth and session
1) User registers or logs in.
2) Server returns a JWT token.
3) Frontend stores token in localStorage.
4) Every API request includes `Authorization: Bearer <token>`.
5) Socket.IO connects using the same token in the auth payload.

### 3.2) Server and channel lifecycle
- Create server -> server is stored in MongoDB.
- Backend creates default channels (general + announcements).
- Server members are stored as an array with roles.
- When switching servers, the frontend joins the server room via Socket.IO.

### 3.3) Messaging lifecycle
- User types a message in the UI.
- Frontend sends a POST to `/api/messages/:channelId`.
- Backend validates content, spam filter, schedule time.
- Message stored in MongoDB.
- If immediate, backend emits `message:new` to channel room.
- Other clients receive and render instantly.

### 3.4) Typing indicators
- Frontend emits `typing:start` and `typing:stop`.
- Server relays updates to the channel room.
- UI shows names in the typing bar.

### 3.5) Reactions, edits, deletes
- Reactions: stored as arrays of user IDs per emoji.
- Edits: content saved and previous content stored in edit history.
- Deletes: soft delete (content blanked, `isDeleted` set).
- All actions emit events so others update immediately.

### 3.6) Pins and starred messages
- Pins are stored on the Channel document.
- Starred messages are stored on the User document.
- Both are toggled via REST and shown with modals.

### 3.7) Threads
- Replies store `replyTo` and increment `threadCount`.
- Thread modal fetches the parent + replies via a dedicated endpoint.

### 3.8) File uploads
- Files are uploaded via `/api/upload` (or avatar/server icon endpoints).
- Server validates mime types and size via multer.
- Files are stored in Cloudinary and URLs are returned.
- Messages reference attachment URLs.

### 3.9) Notifications
- Backend creates notification documents for mentions, replies, and reactions.
- Socket.IO emits `notification:new` to the target user room.
- Optional push notifications are sent using Web Push.

### 3.10) Scheduled messages
- Messages can include a future `scheduledFor` time.
- Scheduled messages are saved with `isScheduled: true`.
- A cron job runs every minute to publish due messages.

### 3.11) Calls (voice/video)
- Calls use WebRTC, but signaling is done with Socket.IO.
- When a user joins a call, the server announces it to the room.
- Peers exchange SDP offers/answers and ICE candidates.
- Media flows directly between peers (no media server).
- A public STUN server is used. There is no TURN, so some networks may fail.

## 4) Backend structure and responsibilities

### 4.1) Entry point: server.js
- Sets up Express, security middleware, JSON parsing, and CORS.
- Attaches Socket.IO to the HTTP server.
- Mounts all API routes.
- Starts cron job for scheduled messages.

### 4.2) Routes
- `/api/auth`: register, login, get current user, refresh token.
- `/api/users`: profile updates, status, blocking, DMs, search, starred, delete.
- `/api/servers`: CRUD, join/leave, members.
- `/api/channels`: CRUD, pins, read receipts.
- `/api/messages`: CRUD, search, threads.
- `/api/upload`: attachments, avatars, server icons.
- `/api/admin`: stats, roles, audit log, settings.
- `/api/notifications`: list, read, subscribe/unsubscribe push.

### 4.3) Middleware
- `auth`: checks JWT, loads user.
- `roleCheck`: enforces role-based permissions for server actions.
- `upload`: multer in-memory storage with allowed MIME types and size limit.

### 4.4) Models
- User: auth fields, profile, status, preferences, starred messages.
- Server: members, roles, channels, invite code, settings.
- Channel: type, topic, participants, pins, read receipts, settings.
- Message: content, attachments, mentions, reactions, replies, edits, schedule.
- Notification: type, sender, read state, message references.
- PushSubscription: Web Push endpoints per user.
- AuditLog: admin actions and metadata.

### 4.5) Utilities
- `push.js`: Web Push setup and delivery.
- `scheduled.js`: cron publishing of scheduled messages.
- `linkPreview.js`: safe URL extraction and metadata parsing.

## 5) Frontend structure and responsibilities

### 5.1) App entry and routing
- `main.jsx` bootstraps React with router and toast system.
- `App.jsx` defines public and private routes.
- Unauthenticated users are redirected to `/login`.

### 5.2) State management (Zustand)
- `authStore`: user session, token, socket init.
- `serverStore`: list, create, join/leave.
- `channelStore`: list, create/delete, pins, read receipts.
- `messageStore`: messages, search, thread, starred.
- `notificationStore`: list, read state.
- `uiStore`: modal visibility, call state, editing/replying state.

### 5.3) Core screens
- Login and Register pages handle auth.
- Main layout hosts server list, channel list, chat, member panel.
- Modals provide features like invites, search, pinned, settings, threads.

### 5.4) Realtime wiring
- When authenticated, the app connects Socket.IO.
- Socket listeners update local stores for messages, channels, notifications.
- Presence updates are reflected in the members panel.

## 6) Feature breakdown (what the code actually does)

### 6.1) Servers
- Create server with name/description.
- Default channels are auto-created.
- Invite codes are auto-generated and stored in the Server model.
- Join by invite code or direct join endpoint.
- Leave is blocked for owners.

### 6.2) Channels
- Text and announcement channels supported.
- Permissions enforced for creating/deleting channels.
- Pinned messages stored per channel.
- Read receipts tracked per channel per user.

### 6.3) Messages
- Messages are paginated (limit 50) and reversed before returning.
- Supports mentions, replies, threads, edit history, soft delete.
- Reactions are stored per emoji with list of user IDs.
- Link previews are fetched and stored when sending.
- Scheduled messages are stored and later emitted.

### 6.4) Search
- Messages use MongoDB text index.
- Search supports filters: query, author, has attachment, has link, time range.

### 6.5) Typing
- Typing uses socket events and a 2s timeout in the UI.

### 6.6) Presence
- Presence uses socket connection state and explicit updates.
- Frontend sets user to away on inactivity or tab hidden.

### 6.7) Direct messages
- DMs are stored as a channel of type `dm` with two participants.
- If a DM already exists, it is reused.

### 6.8) Uploads
- Attachments accept images, video, audio, PDFs, text, zip, docs.
- Stored in Cloudinary with folder prefixes.
- Returned URL is saved in message attachments.

### 6.9) Notifications
- Mentions/replies/reactions create notifications in DB.
- Socket.IO delivers real-time notifications.
- Web Push delivers when subscribed.

### 6.10) Admin
- Stats endpoints count members/channels/messages.
- Role updates and member kicks are logged to AuditLog.

### 6.11) Calls
- Calls are per channel (room name `call:<channelId>`).
- WebRTC uses a STUN server for ICE candidate discovery.
- Socket.IO transports SDP and ICE candidates.
- Media is peer-to-peer and not relayed by backend.

## 7) Computer networks concepts used

### 7.1) HTTP and REST
- All CRUD operations use HTTP verbs.
- JSON payloads for requests and responses.
- Token-based auth via `Authorization` header.

### 7.2) WebSockets via Socket.IO
- Socket.IO starts with HTTP handshake, then upgrades to WebSocket.
- Long-lived connection avoids polling for chat updates.
- Rooms act like multicast groups for channels/servers/calls.

### 7.3) NAT traversal and WebRTC
- WebRTC requires ICE candidates to find routes.
- STUN helps clients discover public addresses.
- No TURN means no fallback relay; some strict NATs fail.

### 7.4) Push notifications
- Uses the Web Push protocol and service workers.
- Requires VAPID public/private keys.

### 7.5) CORS and proxies
- Backend allows cross-origin requests with credentials.
- Vite proxy forwards `/api` to backend during dev.

### 7.6) TLS (production expectation)
- In production, HTTPS is required for Push and WebRTC.
- Socket.IO and REST should run over HTTPS/WSS.

### 7.7) Rate limiting and security headers
- `express-rate-limit` limits API traffic.
- `helmet` sets safe HTTP headers.

## 8) DSA (data structures and algorithms) in use

### 8.1) Map and Set for presence
- `onlineUsers` is a Map of userId to Set of socket IDs.
- This allows fast add/remove and multiple tabs per user.

### 8.2) Arrays for collections
- Members, channels, messages, reactions are arrays.
- Sorting uses array sort with custom comparators.

### 8.3) Hashing and indexing
- Passwords are hashed using bcrypt (salted hash).
- MongoDB uses B-tree indexes for fast lookup.
- Text indexes enable full-text search.

### 8.4) Pagination
- Messages use skip/limit for pagination.
- Search results are limited and filtered.

### 8.5) Regex parsing
- Mentions and URLs are parsed with regex.
- Link preview extractor finds HTTP/HTTPS links.

### 8.6) Time-based algorithms
- Cron job runs every minute to publish scheduled messages.
- Read receipts use timestamps to compare against message time.

## 9) Tools and libraries used

### 9.1) Backend
- Node.js + Express
- MongoDB + Mongoose
- Socket.IO
- JWT for auth
- bcrypt for password hashing
- multer for uploads
- cloudinary for storage
- node-cron for scheduled messages
- web-push for push notifications
- helmet, cors, morgan, express-rate-limit

### 9.2) Frontend
- React + React Router
- Zustand for state
- Tailwind CSS
- Vite build system
- socket.io-client
- react-markdown + remark-gfm
- emoji-picker-react
- react-dropzone
- react-hot-toast

## 10) Error handling strategy
- API returns JSON error messages with status codes.
- Frontend shows toast messages for failures.
- 401 triggers logout and redirect to login.

## 11) Security and privacy notes
- JWT tokens are stored in localStorage (fast, but XSS sensitive).
- Uploaded files are validated by mime type and size.
- Link previews check for private IPs to avoid SSRF.
- Admin actions are logged.

## 12) Deployment assumptions
- Backend expects environment variables for DB, JWT, Cloudinary, and VAPID.
- Frontend expects Vite environment variables for API and socket URL.

## 13) Example sequence: sending a message
1) User types a message.
2) Client sends POST `/api/messages/:channelId`.
3) Server validates and saves message.
4) Server emits `message:new` to the channel room.
5) All connected clients render the message.
6) Notifications are created and sent to mentions.

## 14) Example sequence: starting a call
1) User clicks audio/video in the channel header.
2) UI opens CallModal and gets camera/mic.
3) Client emits `call:join` to server.
4) Server notifies others with `call:user-joined`.
5) Peers exchange SDP offers and answers.
6) ICE candidates are exchanged to find routes.
7) WebRTC media flows directly between peers.

## 15) Known limitations in the current code
- No TURN server for WebRTC, so some calls can fail on strict NATs.
- LocalStorage tokens are vulnerable if XSS occurs.
- Invite code sharing is manual and not time-limited.

## 16) Glossary (plain language)
- REST: HTTP endpoints that do CRUD actions.
- Socket.IO: real-time messaging over a WebSocket-like channel.
- WebRTC: browser-to-browser media streaming.
- STUN: helper server to find a public network address.
- ICE: negotiation process to find a working network path.
- JWT: signed token used for login sessions.
- CORS: browser rule that controls cross-site requests.

If you want this expanded to a full 1000-line version or want specific sections deepened, tell me which sections to expand.
