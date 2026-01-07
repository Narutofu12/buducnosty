const WebSocket = require("ws");
const port = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port });
const wss = new WebSocket.Server({ port: 8080 });

const clients = new Map(); // ws -> user
const rooms = { lobby: new Set() };
// ----------------------- MAPE -----------------------
const users = new Map();    // ws -> profile
const sockets = new Map();  // uuid -> ws
const pendingRequests = new Map(); // uuid -> [ { fromProfile } ]

// ------------------- FUNKCIJA BROADCAST -------------------
function broadcastOnlineUsers() {
  const onlineList = Array.from(users.values());
  const msg = JSON.stringify({ type: "onlineUsers", users: onlineList });

  users.forEach((_, ws) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  });
}

// ------------------- NEW CONNECTION -------------------
wss.on("connection", ws => {
console.log("Client connected");

ws.on("message", raw => {
let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    try { data = JSON.parse(raw); } catch { return; }

    // 🔹 JOIN LOBBY
    if (data.type === "joinLobby") {
      clients.set(ws, {
        uuid: data.profile.uuid,
        name: data.profile.name,
        image: data.profile.image,
        room: "lobby"
      });
    const { type } = data;

      rooms.lobby.add(data.profile.uuid);
      broadcastLobby();
    }
    // ------------------- REGISTER USER -------------------
    if (type === "register") {
      const profile = data.profile;
      users.set(ws, profile);
      sockets.set(profile.uuid, ws);

    // 🔹 FRIEND REQUEST
    if (data.type === "friendRequest") {
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

    // 🔹 FRIEND ACCEPT
    if (data.type === "friendAccept") {
      const target = [...clients.entries()]
        .find(([_, u]) => u.uuid === data.to);
      broadcastOnlineUsers();
      console.log("Registered:", profile.name);
    }

      if (target) {
        target[0].send(JSON.stringify(data));
    // ------------------- FRIEND REQUEST -------------------
    if (type === "friendRequest") {
      const targetWs = sockets.get(data.to);

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

function broadcastLobby() {
  const users = [];

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

  for (let ws of clients.keys()) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  }
}

function broadcastExcept(sender, msg) {
  for (let ws of clients.keys()) {
    if (ws !== sender && ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  }
}

console.log("Server running on port", port);
