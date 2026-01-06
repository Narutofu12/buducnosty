const WebSocket = require("ws");
const port = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port });

const clients = new Map(); // ws -> user
const rooms = { lobby: new Set() };

wss.on("connection", ws => {
  console.log("Client connected");

  ws.on("message", raw => {
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }

    // 🔹 JOIN LOBBY
    if (data.type === "joinLobby") {
      clients.set(ws, {
        uuid: data.profile.uuid,
        name: data.profile.name,
        image: data.profile.image,
        room: "lobby"
      });

      rooms.lobby.add(data.profile.uuid);
      broadcastLobby();
    }

    // 🔹 FRIEND REQUEST
    if (data.type === "friendRequest") {
      const target = [...clients.entries()]
        .find(([_, u]) => u.uuid === data.to);

      if (target) {
        target[0].send(JSON.stringify(data));
      }
    }

    // 🔹 FRIEND ACCEPT
    if (data.type === "friendAccept") {
      const target = [...clients.entries()]
        .find(([_, u]) => u.uuid === data.to);

      if (target) {
        target[0].send(JSON.stringify(data));
      }
    }

    // 🔹 SIGNAL (offer/answer/ice)
    if (data.offer || data.answer || data.ice) {
      broadcastExcept(ws, raw);
    }
  });

  ws.on("close", () => {
    const user = clients.get(ws);
    if (user) {
      rooms.lobby.delete(user.uuid);
      clients.delete(ws);
      broadcastLobby();
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
