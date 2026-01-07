const WebSocket = require("ws");
const { randomUUID } = require("crypto");

const wss = new WebSocket.Server({ port: 8080 });

const sockets = new Map();   // uuid -> ws
const profiles = new Map();  // uuid -> profile
const messages = [];         // { from, to, text, time }

function send(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function broadcastOnline() {
  const list = Array.from(profiles.values()).map(p => ({
    uuid: p.uuid,
    name: p.name,
    avatar: p.avatar,
    online: p.online
  }));

  sockets.forEach(ws => send(ws, {
    type: "onlineUsers",
    users: list
  }));
}

wss.on("connection", ws => {
  console.log("Client connected");

  ws.on("message", raw => {
    let data;
    try { data = JSON.parse(raw); } catch { return; }

    // 1️⃣ CREATE PROFILE
    if (data.type === "createProfile") {
      const uuid = randomUUID();

      const profile = {
        uuid,
        name: data.name,
        avatar: data.avatar || null,
        friends: [],
        pending: [],
        online: true
      };

      profiles.set(uuid, profile);
      sockets.set(uuid, ws);

      send(ws, { type: "profileCreated", profile });
      broadcastOnline();
    }

    // 2️⃣ LOGIN (POSTOJEĆI PROFIL)
    if (data.type === "login") {
      const profile = profiles.get(data.uuid);
      if (!profile) return;

      profile.online = true;
      sockets.set(profile.uuid, ws);

      send(ws, { type: "loginSuccess", profile });
      broadcastOnline();
    }

    // 3️⃣ GET ALL USERS
    if (data.type === "getUsers") {
      send(ws, {
        type: "onlineUsers",
        users: Array.from(profiles.values())
      });
    }

    // 4️⃣ FRIEND REQUEST
    if (data.type === "friendRequest") {
      const from = profiles.get(data.from);
      const to = profiles.get(data.to);
      if (!from || !to) return;

      if (!to.pending.includes(from.uuid)) {
        to.pending.push(from.uuid);
      }

      send(sockets.get(to.uuid), {
        type: "friendRequest",
        from: from.uuid,
        name: from.name,
        avatar: from.avatar
      });
    }

    // 5️⃣ FRIEND ACCEPT
    if (data.type === "friendAccept") {
      const from = profiles.get(data.from);
      const to = profiles.get(data.to);
      if (!from || !to) return;

      from.friends.push(to.uuid);
      to.friends.push(from.uuid);

      from.pending = from.pending.filter(u => u !== to.uuid);
      to.pending = to.pending.filter(u => u !== from.uuid);

      send(sockets.get(from.uuid), { type: "friendAdded", user: to });
      send(sockets.get(to.uuid), { type: "friendAdded", user: from });
    }

    // 6️⃣ SEND MESSAGE
    if (data.type === "sendMessage") {
      const msg = {
        from: data.from,
        to: data.to,
        text: data.text,
        time: Date.now()
      };

      messages.push(msg);

      send(sockets.get(data.to), {
        type: "message",
        message: msg
      });
    }

    // 7️⃣ GET CHAT HISTORY
    if (data.type === "getMessages") {
      const chat = messages.filter(m =>
        (m.from === data.me && m.to === data.with) ||
        (m.from === data.with && m.to === data.me)
      );

      send(ws, { type: "messages", chat });
    }
  });

  ws.on("close", () => {
    for (const [uuid, sock] of sockets.entries()) {
      if (sock === ws) {
        const profile = profiles.get(uuid);
        if (profile) profile.online = false;
        sockets.delete(uuid);
        break;
      }
    }
    broadcastOnline();
    console.log("Client disconnected");
  });
});

console.log("WS server running on :8080");
