const WebSocket = require("ws");
const { randomUUID } = require("crypto");

const wss = new WebSocket.Server({ port: 8080 });

const sockets = new Map();   // uuid -> ws
const profiles = new Map();  // uuid -> profile

function send(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

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
}

wss.on("connection", ws => {
  console.log("Client connected");

  ws.on("message", raw => {
    let data;
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

      sockets.set(profile.uuid, ws);
      send(ws, { type: "loginSuccess", profile });
      broadcastOnline();
    }

    // --------------------------------
    // 2️⃣ FRIEND REQUEST
    // --------------------------------
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
    }

    // --------------------------------
    // 3️⃣ FRIEND ACCEPT
    // --------------------------------
    if (data.type === "friendAccept") {
      const from = profiles.get(data.fromProfile.uuid);
      const to = profiles.get(data.to);
      if (!from || !to) return;

      // dodaj u friends ako već nije
      if (!from.friends.includes(to.uuid)) from.friends.push(to.uuid);
      if (!to.friends.includes(from.uuid)) to.friends.push(from.uuid);

      // ukloni iz pending
      from.pending = from.pending.filter(u => u !== to.uuid);
      to.pending = to.pending.filter(u => u !== from.uuid);

      send(sockets.get(from.uuid), { type: "friendAccept", fromProfile: to });
      send(sockets.get(to.uuid), { type: "friendAccept", fromProfile: from });
    }

    // --------------------------------
    // 4️⃣ FRIEND REJECT
    // --------------------------------
    if (data.type === "friendReject") {
      const from = profiles.get(data.fromProfile.uuid);
      const to = profiles.get(data.to);
      if (!from || !to) return;

      to.pending = to.pending.filter(u => u !== from.uuid);

      send(sockets.get(from.uuid), { type: "friendReject", fromProfile: to });
    }

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
      });
    }

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
    }
    broadcastOnline();
    console.log("Client disconnected");
  });
});

console.log("WS server running on :8080");
