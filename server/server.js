const WebSocket = require("ws");
const { randomUUID } = require("crypto");

const port = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port });
const wss = new WebSocket.Server({ port: 8080 });

const sockets = new Map();   // uuid -> ws
const profiles = new Map();  // uuid -> profile
const clients = new Map(); // ws -> user
const rooms = { lobby: new Set() };
// ----------------------- MAPE -----------------------
const users = new Map();    // ws -> profile
const sockets = new Map();  // uuid -> ws
const pendingRequests = new Map(); // uuid -> [ { fromProfile } ]

function send(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}
// ------------------- FUNKCIJA BROADCAST -------------------
function broadcastOnlineUsers() {
  const onlineList = Array.from(users.values());
  const msg = JSON.stringify({ type: "onlineUsers", users: onlineList });

// Pošalji svim klijentima listu online korisnika
function broadcastOnline() {
  const list = Array.from(profiles.values())
    .filter(p => p.online)
    .map(p => ({
      uuid: p.uuid,
      name: p.name,
      avatar: p.avatar || 'images/avatar.png',
      online: p.online
    }));

  sockets.forEach(ws => send(ws, {
    type: "onlineUsers",
    users: list
  }));
  users.forEach((_, ws) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  });
}

// ------------------- NEW CONNECTION -------------------
wss.on("connection", ws => {
  console.log("Client connected");

  ws.on("message", raw => {
    let data;
console.log("Client connected");

ws.on("message", raw => {
let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
try { data = JSON.parse(raw); } catch { return; }

    // --------------------------------
    // 1️⃣ REGISTER / LOGIN
    // --------------------------------
    if (data.type === "register" || data.type === "login") {
      let profile = profiles.get(data.profile.uuid);

      if (!profile) {
        // kreiraj novi profil
        profile = {
          uuid: data.profile.uuid,
          name: data.profile.name,
          avatar: data.profile.image || 'images/avatar.png',
          friends: [],
          pending: [],
          online: true
        };
        profiles.set(profile.uuid, profile);
      } else {
        profile.online = true;
      }
    // 🔹 JOIN LOBBY
    if (data.type === "joinLobby") {
      clients.set(ws, {
        uuid: data.profile.uuid,
        name: data.profile.name,
        image: data.profile.image,
        room: "lobby"
      });
    const { type } = data;

      sockets.set(profile.uuid, ws);
      send(ws, { type: "loginSuccess", profile });
      broadcastOnline();
      rooms.lobby.add(data.profile.uuid);
      broadcastLobby();
}
    // ------------------- REGISTER USER -------------------
    if (type === "register") {
      const profile = data.profile;
      users.set(ws, profile);
      sockets.set(profile.uuid, ws);

    // --------------------------------
    // 2️⃣ FRIEND REQUEST
    // --------------------------------
    // 🔹 FRIEND REQUEST
if (data.type === "friendRequest") {
      const from = profiles.get(data.fromProfile.uuid);
      const to = profiles.get(data.to);
      if (!from || !to) return;

      // dodaj u pending ako nije već tu
      if (!to.pending.includes(from.uuid)) to.pending.push(from.uuid);

      send(sockets.get(to.uuid), {
        type: "friendRequest",
        fromProfile: from
      });
      const target = [...clients.entries()]
        .find(([_, u]) => u.uuid === data.to);

      if (target) {
        target[0].send(JSON.stringify(data));
      // Ako postoje pending zahtjevi → pošalji ih u inbox
      if (pendingRequests.has(profile.uuid)) {
        const inbox = pendingRequests.get(profile.uuid);
        ws.send(JSON.stringify({ type: "inbox", requests: inbox }));
        pendingRequests.delete(profile.uuid);
}
}

    // --------------------------------
    // 3️⃣ FRIEND ACCEPT
    // --------------------------------
    // 🔹 FRIEND ACCEPT
if (data.type === "friendAccept") {
      const from = profiles.get(data.fromProfile.uuid);
      const to = profiles.get(data.to);
      if (!from || !to) return;

      // dodaj u friends ako već nije
      if (!from.friends.includes(to.uuid)) from.friends.push(to.uuid);
      if (!to.friends.includes(from.uuid)) to.friends.push(from.uuid);
      const target = [...clients.entries()]
        .find(([_, u]) => u.uuid === data.to);
      broadcastOnlineUsers();
      console.log("Registered:", profile.name);
    }

      // ukloni iz pending
      from.pending = from.pending.filter(u => u !== to.uuid);
      to.pending = to.pending.filter(u => u !== from.uuid);
      if (target) {
        target[0].send(JSON.stringify(data));
    // ------------------- FRIEND REQUEST -------------------
    if (type === "friendRequest") {
      const targetWs = sockets.get(data.to);

      send(sockets.get(from.uuid), { type: "friendAccept", fromProfile: to });
      send(sockets.get(to.uuid), { type: "friendAccept", fromProfile: from });
    }
      if (targetWs && targetWs.readyState === WebSocket.OPEN) {
        // odmah šalje ako je online
        targetWs.send(JSON.stringify({ ...data, type: "friendRequest" }));
      } else {
        // ako nije online → spremi u pending
        if (!pendingRequests.has(data.to)) pendingRequests.set(data.to, []);
        pendingRequests.get(data.to).push({
          from: data.fromProfile
        });
}
}

    // --------------------------------
    // 4️⃣ FRIEND REJECT
    // --------------------------------
    if (data.type === "friendReject") {
      const from = profiles.get(data.fromProfile.uuid);
      const to = profiles.get(data.to);
      if (!from || !to) return;
    // 🔹 SIGNAL (offer/answer/ice)
    if (data.offer || data.answer || data.ice) {
      broadcastExcept(ws, raw);
    // ------------------- FRIEND ACCEPT -------------------
    if (type === "friendAccept" || type === "friendReject") {
      const targetWs = sockets.get(data.to);
      if (targetWs && targetWs.readyState === WebSocket.OPEN) {
        targetWs.send(JSON.stringify(data));
      }
}
});

      to.pending = to.pending.filter(u => u !== from.uuid);
ws.on("close", () => {
    const user = clients.get(ws);
    if (user) {
      rooms.lobby.delete(user.uuid);
      clients.delete(ws);
      broadcastLobby();
    const profile = users.get(ws);
    if (profile) {
      users.delete(ws);
      sockets.delete(profile.uuid);
      console.log("Client disconnected:", profile.name);
      broadcastOnlineUsers();
}
    console.log("Client disconnected");
});
});

      send(sockets.get(from.uuid), { type: "friendReject", fromProfile: to });
    }
function broadcastLobby() {
  const users = [];

    // --------------------------------
    // 5️⃣ CHAT MESSAGE
    // --------------------------------
    if (data.type === "sendMessage") {
      const to = profiles.get(data.to);
      if (!to) return;

      const msg = {
        from: data.from,
        to: data.to,
        text: data.text,
        time: Date.now()
      };

      send(sockets.get(data.to), {
        type: "message",
        message: msg
  for (let u of clients.values()) {
    if (u.room === "lobby") {
      users.push({
        uuid: u.uuid,
        name: u.name,
        image: u.image
});
}
  }

  const msg = JSON.stringify({
    type: "roomUsersUpdate",
    users
});

  ws.on("close", () => {
    // pronađi profil po ws i markiraj offline
    for (const [uuid, sock] of sockets.entries()) {
      if (sock === ws) {
        const profile = profiles.get(uuid);
        if (profile) profile.online = false;
        sockets.delete(uuid);
        break;
      }
  for (let ws of clients.keys()) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
}
    broadcastOnline();
    console.log("Client disconnected");
  });
});
  }
}

function broadcastExcept(sender, msg) {
  for (let ws of clients.keys()) {
    if (ws !== sender && ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  }
}

console.log("WS server running on :8080");
console.log("Server running on port", port);
