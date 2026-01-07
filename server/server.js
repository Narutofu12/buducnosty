const WebSocket = require("ws");
const wss = new WebSocket.Server({ port: 8080 });

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
    try { data = JSON.parse(raw); } catch { return; }

    const { type } = data;

    // ------------------- REGISTER USER -------------------
    if (type === "register") {
      const profile = data.profile;
      users.set(ws, profile);
      sockets.set(profile.uuid, ws);

      // Ako postoje pending zahtjevi → pošalji ih u inbox
      if (pendingRequests.has(profile.uuid)) {
        const inbox = pendingRequests.get(profile.uuid);
        ws.send(JSON.stringify({ type: "inbox", requests: inbox }));
        pendingRequests.delete(profile.uuid);
      }

      broadcastOnlineUsers();
      console.log("Registered:", profile.name);
    }

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

    // ------------------- FRIEND ACCEPT -------------------
    if (type === "friendAccept" || type === "friendReject") {
      const targetWs = sockets.get(data.to);
      if (targetWs && targetWs.readyState === WebSocket.OPEN) {
        targetWs.send(JSON.stringify(data));
      }
    }
  });

  ws.on("close", () => {
    const profile = users.get(ws);
    if (profile) {
      users.delete(ws);
      sockets.delete(profile.uuid);
      console.log("Client disconnected:", profile.name);
      broadcastOnlineUsers();
    }
  });
});
