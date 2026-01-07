const WebSocket = require("ws");
const wss = new WebSocket.Server({ port: 8080 });

// ----------------------- MAPE -----------------------
const users = new Map();           // ws -> profile
const sockets = new Map();         // uuid -> ws
const pendingRequests = new Map(); // uuid -> [ { fromProfile } ]

// ------------------- BROADCAST ONLINE USERS -------------------
function broadcastOnlineUsers() {
  const onlineList = Array.from(users.values());
  const msg = JSON.stringify({ type: "roomUsersUpdate", users: onlineList });
  users.forEach((_, ws) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  });
}

// ------------------- HANDLE NEW CONNECTION -------------------
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

      // Pošalji pending zahtjeve ako postoje
      if (pendingRequests.has(profile.uuid)) {
        const inbox = pendingRequests.get(profile.uuid);
        ws.send(JSON.stringify({ type: "inbox", requests: inbox }));
        pendingRequests.delete(profile.uuid);
      }

      broadcastOnlineUsers();
      console.log("Registered:", profile.name);
      return;
    }

    // ------------------- FRIEND REQUEST -------------------
    if (type === "friendRequest") {
      const targetWs = sockets.get(data.to);

      if (targetWs && targetWs.readyState === WebSocket.OPEN) {
        // odmah šalje ako je online
        targetWs.send(JSON.stringify({ 
          type: "friendRequest",
          from: data.fromProfile.uuid,
          fromName: data.fromProfile.name,
          fromImage: data.fromProfile.image
        }));
      } else {
        // ako nije online → spremi u pending
        if (!pendingRequests.has(data.to)) pendingRequests.set(data.to, []);
        pendingRequests.get(data.to).push({
          fromProfile: data.fromProfile
        });
      }
      return;
    }

    // ------------------- FRIEND ACCEPT / REJECT -------------------
    if (type === "friendAccept" || type === "friendReject") {
      const targetWs = sockets.get(data.to);
      if (targetWs && targetWs.readyState === WebSocket.OPEN) {
        targetWs.send(JSON.stringify({
          type: type,
          fromProfile: data.fromProfile
        }));
      }
      return;
    }

    // ------------------- CHAT MESSAGE -------------------
    if (type === "chat") {
      // Broadcast svima
      users.forEach((_, clientWs) => {
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify(data));
        }
      });
      return;
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
