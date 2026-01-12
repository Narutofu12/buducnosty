const WebSocket = require("ws");

const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

console.log("✅ WS server running on", PORT);

/* ================== STORAGE (RAM) ================== */
const sockets = new Map();        // uuid -> ws
const profiles = new Map();       // uuid -> profile
const messageStore = new Map();   // uuid -> [messages]

/* ================== HEARTBEAT ================== */
function heartbeat() {
  this.isAlive = true;
}

setInterval(() => {
  sockets.forEach((ws, uuid) => {
    if (ws.isAlive === false) {
      sockets.delete(uuid);
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

/* ================== CONNECTION ================== */
wss.on("connection", ws => {
  ws.isAlive = true;
  ws.on("pong", heartbeat);

  ws.on("message", raw => {
    let data;
    try { data = JSON.parse(raw); } catch { return; }

    switch (data.type) {

      /* ============ REGISTER / LOGIN / RECONNECT ============ */
      case "login": {
        let profile = profiles.get(data.profile.uuid);

        if (!profile) {
          profile = {
            uuid: data.profile.uuid,
            name: data.profile.name,
            image: data.profile.image || "images/avatar.png",
            friends: [],
            pending: [],
            online: true
          };
          profiles.set(profile.uuid, profile);
        } else {
          profile.online = true;
        }

        sockets.set(profile.uuid, ws);

        // ➜ pošalji profil
        ws.send(JSON.stringify({
          type: "loginSuccess",
          profile
        }));

        // ➜ sync offline poruka
        const pendingMsgs = messageStore.get(profile.uuid) || [];
        if (pendingMsgs.length) {
          ws.send(JSON.stringify({
            type: "syncMessages",
            messages: pendingMsgs
          }));
          messageStore.set(profile.uuid, []);
        }

        broadcastOnline();
        break;
      }

      /* ================= CHAT ================= */
      case "chat": {
        const from = profiles.get(data.from);
        const to = profiles.get(data.to);
        if (!from || !to) return;

        const msg = {
          type: "chat",
          from: from.uuid,
          to: to.uuid,
          text: data.text,
          time: Date.now()
        };

        // ➜ store offline
        if (!messageStore.has(to.uuid)) {
          messageStore.set(to.uuid, []);
        }
        messageStore.get(to.uuid).push(msg);

        // ➜ send to receiver if online
        const target = sockets.get(to.uuid);
        if (target && target.readyState === WebSocket.OPEN) {
          target.send(JSON.stringify(msg));
        }

        // ➜ echo to sender
        const sender = sockets.get(from.uuid);
        if (sender && sender.readyState === WebSocket.OPEN) {
          sender.send(JSON.stringify(msg));
        }

        break;
      }

      /* ================= FRIEND REQUEST ================= */
      case "friendRequest": {
        const from = profiles.get(data.from);
        const to = profiles.get(data.to);
        if (!from || !to) return;

        if (!to.pending.includes(from.uuid)) {
          to.pending.push(from.uuid);
        }

        const wsTo = sockets.get(to.uuid);
        if (wsTo) {
          wsTo.send(JSON.stringify({
            type: "friendRequest",
            fromProfile: from
          }));
        }
        break;
      }

      /* ================= FRIEND ACCEPT ================= */
      case "friendAccept": {
        const from = profiles.get(data.from);
        const to = profiles.get(data.to);
        if (!from || !to) return;

        from.pending = from.pending.filter(u => u !== to.uuid);
        to.pending = to.pending.filter(u => u !== from.uuid);

        from.friends.push({ uuid: to.uuid, name: to.name, image: to.image });
        to.friends.push({ uuid: from.uuid, name: from.name, image: from.image });

        sendIfOnline(from.uuid, {
          type: "friendAdded",
          friend: to
        });

        sendIfOnline(to.uuid, {
          type: "friendAdded",
          friend: from
        });

        break;
      }
    }
  });

  ws.on("close", () => {
    const entry = [...sockets.entries()].find(e => e[1] === ws);
    if (entry) {
      const uuid = entry[0];
      const profile = profiles.get(uuid);
      if (profile) profile.online = false;
      sockets.delete(uuid);
    }
    broadcastOnline();
  });
});

/* ================== HELPERS ================== */
function sendIfOnline(uuid, payload) {
  const ws = sockets.get(uuid);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcastOnline() {
  const users = [...profiles.values()]
    .filter(p => p.online)
    .map(p => ({
      uuid: p.uuid,
      name: p.name,
      image: p.image,
      online: true
    }));

  sockets.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: "onlineUsers",
        users
      }));
    }
  });
}
