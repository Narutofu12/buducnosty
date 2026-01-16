const WebSocket = require("ws");
require("dotenv").config();
const webpush = require("web-push");

const PORT = process.env.PORT || 8080;
const ws = new WebSocket.Server({ port: PORT });

const sockets = new Map();          // uuid -> ws
const profiles = new Map();         // uuid -> profile
const offlineMessages = new Map();  // uuid -> [messages]

const fs = require("fs");
const path = require("path");

const subscriptionsFile = path.join(__dirname, "subscriptions.json");
let subscriptions = new Map();

// Učitaj postojeće subscriptions sa fajla na startu servera
if (fs.existsSync(subscriptionsFile)) {
  const raw = fs.readFileSync(subscriptionsFile);
  const obj = JSON.parse(raw);
  Object.keys(obj).forEach(uuid => subscriptions.set(uuid, obj[uuid]));
}


console.log("WS server running on port", PORT);

// Setup VAPID
webpush.setVapidDetails(
  "mailto:admin@scchat.app",
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

/* ===== HEARTBEAT (PING/PONG) ===== */
function heartbeat() { this.isAlive = true; }

setInterval(() => {
  sockets.forEach((ws, uuid) => {
    if (!ws.isAlive) {
      const profile = profiles.get(uuid);
      if (profile) profile.online = false;
      sockets.delete(uuid);
      broadcastOnlineUsers();
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 15000);

/* ===== CONNECTION ===== */
ws.on("connection", ws => {
  ws.isAlive = true;
  ws.on("pong", heartbeat);

  let currentUuid = null; // track who this ws belongs to

  ws.on("message", raw => {
    let data;
    try { data = JSON.parse(raw); } catch { return; }
    const type = data.type;

    /* ===== REGISTER / LOGIN ===== */
    if (type === "register" || type === "login") {
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
      currentUuid = profile.uuid;

      ws.send(JSON.stringify({ type: "loginSuccess", profile }));

      // 🔥 Pošalji offline poruke + pending friend requestove
      const messages = offlineMessages.get(profile.uuid) || [];
      const pendingRequests = profile.pending || [];
      ws.send(JSON.stringify({
        type: "syncData",
        messages,
        friendRequests: pendingRequests,
        serverTime: Date.now()
      }));

      offlineMessages.delete(profile.uuid);
      profile.pending = [];

      broadcastOnlineUsers();
      return;
    }

    /* ===== SYNC REQUEST (manualni) ===== */
    if (type === "sync") {
      const profile = profiles.get(data.uuid);
      if (!profile) return;

      const messages = offlineMessages.get(profile.uuid) || [];
      const pendingRequests = profile.pending || [];
      ws.send(JSON.stringify({
        type: "syncData",
        messages,
        friendRequests: pendingRequests,
        serverTime: Date.now()
      }));

      offlineMessages.set(profile.uuid, []);
      profile.pending = [];
      return;
    }

    /* ===== CHAT ===== */
    if (type === "chat") {
      const from = profiles.get(data.from);
      const to = profiles.get(data.to);
      if (!from || !to) return;

      const message = {
        type: "chat",
        from: from.uuid,
        to: to.uuid,
        text: data.text,
        time: Date.now()
      };

      // pošalji primatelju ako je online
      const targetWs = sockets.get(to.uuid);
      if (targetWs && targetWs.readyState === WebSocket.OPEN) {
        targetWs.send(JSON.stringify(message));
      } else {
        // 📴 spremi offline poruku
        if (!offlineMessages.has(to.uuid)) offlineMessages.set(to.uuid, []);
        offlineMessages.get(to.uuid).push(message);

        // 🔔 pošalji push notifikaciju
        const sub = subscriptions.get(to.uuid);
        if (sub && sub.endpoint) {
          webpush.sendNotification(
            sub,
            JSON.stringify({ 
              title: `${from.name}`,
              body: data.text
             })
          ).catch(err => console.log("Push error:", err));
        }
      }

      // pošalji i pošiljaocu
      const senderWs = sockets.get(from.uuid);
      if (senderWs && senderWs.readyState === WebSocket.OPEN) {
        senderWs.send(JSON.stringify(message));
      }

      return;
    }

    /* ===== FRIEND REQUEST ===== */
    if (type === "friendRequest") {
      const from = profiles.get(data.fromProfile.uuid);
      const to = profiles.get(data.to);
      if (!from || !to) return;

      if (!to.pending.includes(from.uuid)) to.pending.push(from.uuid);

      const targetWs = sockets.get(to.uuid);
      if (targetWs && targetWs.readyState === WebSocket.OPEN) {
        targetWs.send(JSON.stringify({ type: "friendRequest", fromProfile: from }));
      }
      return;
    }

    /* ===== FRIEND ACCEPT / REJECT ===== */
    if (type === "friendAccept" || type === "friendReject") {
      const from = profiles.get(data.fromProfile.uuid);
      const to = profiles.get(data.to);
      if (!from || !to) return;

      from.pending = from.pending.filter(u => u !== to.uuid);
      to.pending = to.pending.filter(u => u !== from.uuid);

      if (type === "friendAccept") {
        if (!from.friends.some(f => f.uuid === to.uuid)) {
          from.friends.push({ uuid: to.uuid, name: to.name, image: to.image });
        }
        if (!to.friends.some(f => f.uuid === from.uuid)) {
          to.friends.push({ uuid: from.uuid, name: from.name, image: from.image });
        }
      }

      const wsTo = sockets.get(to.uuid);
      if (wsTo && wsTo.readyState === WebSocket.OPEN) {
        wsTo.send(JSON.stringify({
          type: type === "friendAccept" ? "friendAccepted" : "friendRejected",
          friend: { uuid: from.uuid, name: from.name, image: from.image }
        }));
      }

      const wsFrom = sockets.get(from.uuid);
      if (wsFrom && wsFrom.readyState === WebSocket.OPEN) {
        wsFrom.send(JSON.stringify({
          type: type === "friendAccept" ? "friendAdded" : "friendRejectedLocal",
          friend: { uuid: to.uuid, name: to.name, image: to.image }
        }));
      }
      return;
    }

    /* ===== PUSH SUBSCRIPTION ===== */
    if (type === "pushSubscribe") {
      if (!currentUuid) return; // ne može se pohraniti ako nije login
      subscriptions.set(currentUuid, data.subscription);
      saveSubscriptions();  // trajno pohranjeno
      return;
    }
  });

  ws.on("close", () => {
    const entry = [...sockets.entries()].find(([_, sock]) => sock === ws);
    if (currentUuid) {
      const [uuid] = entry;
      const profile = profiles.get(currentUuid);
      if (profile) profile.online = false;
      sockets.delete(currentUuid);
    }
    broadcastOnlineUsers();
    console.log("Client disconnected");
  });
});

/* ===== ONLINE USERS ===== */
function broadcastOnlineUsers() {
  const onlineList = Array.from(profiles.values())
    .filter(p => p.online)
    .map(p => ({
      uuid: p.uuid,
      name: p.name,
      image: p.image || "images/avatar.png",
      online: true 
    }));

  sockets.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: "onlineUsers",
        users: onlineList
      }));
    }
  });
}

function saveSubscriptions() {
  const obj = Object.fromEntries(subscriptions);
  fs.writeFile(subscriptionsFile, JSON.stringify(obj, null, 2), err => {
    if (err) console.error("Greška pri spremanju subscriptions:", err);
  });
}
