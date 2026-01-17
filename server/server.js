// server.js
const WebSocket = require("ws");
require("dotenv").config();
const webpush = require("web-push");
const mongoose = require("mongoose");

// ==== MODELS ====
const Profile = require("./models/Profile");
const PendingMessage = require("./models/Message");
const Subscription = require("./models/Subscription");

// ==== MONGO ====
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log("MongoDB connected"))
.catch(err => console.error("Mongo error:", err));

// ==== WS SERVER ====
const PORT = process.env.PORT || 8080;
const wsServer = new WebSocket.Server({ port: PORT });
const sockets = new Map(); // uuid -> ws

console.log("WS server running on port", PORT);

// ==== VAPID ====
webpush.setVapidDetails(
  "mailto:admin@scchat.app",
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// ==== HEARTBEAT ====
function heartbeat() { this.isAlive = true; }

setInterval(async () => {
  for (const [uuid, ws] of sockets) {
    if (!ws.isAlive) {
      // set offline in DB
      const profile = await Profile.findOne({ uuid });
      if (profile) {
        profile.online = false;
        await profile.save();
      }
      sockets.delete(uuid);
      broadcastOnlineUsers();
      ws.terminate();
    } else {
      ws.isAlive = false;
      ws.ping();
    }
  }
}, 15000);

// ==== CONNECTION ====
wsServer.on("connection", ws => {
  ws.isAlive = true;
  ws.on("pong", heartbeat);
  let currentUuid = null;

  ws.on("message", async raw => {
    let data;
    try { data = JSON.parse(raw); } catch { return; }
    const type = data.type;

    /* ===== REGISTER / LOGIN ===== */
    if (type === "register" || type === "login") {
      let profile = await Profile.findOne({ uuid: data.profile.uuid });
      if (!profile) {
        profile = new Profile({
          uuid: data.profile.uuid,
          name: data.profile.name,
          image: data.profile.image || "images/avatar.png",
          friends: [],
          pending: [],
          online: true
        });
        await profile.save();
      } else {
        profile.online = true;
        await profile.save();
      }

      sockets.set(profile.uuid, ws);
      currentUuid = profile.uuid;

      // Pošalji login success
      ws.send(JSON.stringify({ type: "loginSuccess", profile }));

      // Pošalji offline poruke + pending friend requests
      const messages = await PendingMessage.find({ to: profile.uuid, delivered: false });
      const pendingRequests = profile.pending || [];
      ws.send(JSON.stringify({
        type: "syncData",
        messages,
        friendRequests: pendingRequests,
        serverTime: Date.now()
      }));

      // označi poruke kao isporučene
      await PendingMessage.updateMany({ to: profile.uuid }, { delivered: true });
      profile.pending = [];
      await profile.save();

      broadcastOnlineUsers();
      return;
    }

    /* ===== SYNC REQUEST ===== */
    if (type === "sync") {
      const profile = await Profile.findOne({ uuid: data.uuid });
      if (!profile) return;

      const messages = await PendingMessage.find({ to: profile.uuid, delivered: false });
      const pendingRequests = profile.pending || [];
      ws.send(JSON.stringify({
        type: "syncData",
        messages,
        friendRequests: pendingRequests,
        serverTime: Date.now()
      }));

      await PendingMessage.updateMany({ to: profile.uuid }, { delivered: true });
      profile.pending = [];
      await profile.save();
      return;
    }

    /* ===== CHAT ===== */
    if (type === "chat") {
      const from = await Profile.findOne({ uuid: data.from });
      const to = await Profile.findOne({ uuid: data.to });
      if (!from || !to) return;

      const messageData = {
        from: from.uuid,
        to: to.uuid,
        text: data.text,
        time: Date.now(),
        delivered: false
      };

      // pošalji primatelju ako je online
      const targetWs = sockets.get(to.uuid);
      if (targetWs && targetWs.readyState === WebSocket.OPEN) {
        targetWs.send(JSON.stringify({ type: "chat", ...messageData }));
        messageData.delivered = true;
      } 

      // spremi u DB
      const msg = new PendingMessage(messageData);
      await msg.save();

      // push notification ako offline
      if (!messageData.delivered) {
        const subDoc = await Subscription.findOne({ uuid: to.uuid });
        if (subDoc) {
          webpush.sendNotification(subDoc.subscription, JSON.stringify({
            title: `${from.name}`,
            body: data.text
          })).catch(err => console.log("Push error:", err));
        }
      }

      // pošalji i pošiljaocu
      if (sockets.get(from.uuid) && sockets.get(from.uuid).readyState === WebSocket.OPEN) {
        sockets.get(from.uuid).send(JSON.stringify({ type: "chat", ...messageData }));
      }
      return;
    }

    /* ===== FRIEND REQUEST ===== */
    if (type === "friendRequest") {
      const from = await Profile.findOne({ uuid: data.fromProfile.uuid });
      const to = await Profile.findOne({ uuid: data.to });
      if (!from || !to) return;

      if (!to.pending.includes(from.uuid)) {
        to.pending.push(from.uuid);
        await to.save();
      }

      const targetWs = sockets.get(to.uuid);
      if (targetWs && targetWs.readyState === WebSocket.OPEN) {
        targetWs.send(JSON.stringify({ type: "friendRequest", fromProfile: from }));
      }
      return;
    }

    /* ===== FRIEND ACCEPT / REJECT ===== */
    if (type === "friendAccept" || type === "friendReject") {
      const from = await Profile.findOne({ uuid: data.fromProfile.uuid });
      const to = await Profile.findOne({ uuid: data.to });
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

      await from.save();
      await to.save();

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
      if (!currentUuid) return;
      await Subscription.findOneAndUpdate(
        { uuid: currentUuid },
        { subscription: data.subscription },
        { upsert: true, new: true }
      );
      return;
    }
  });

  ws.on("close", async () => {
    if (currentUuid) {      
      const profile = await Profile.findOne({ uuid: currentUuid });
      if (profile) {
        profile.online = false;
        await profile.save();
      }
      sockets.delete(currentUuid);
    }
    broadcastOnlineUsers();
    console.log("Client disconnected");
  });
});

// ==== ONLINE USERS BROADCAST ====
async function broadcastOnlineUsers() {
  const onlineProfiles = await Profile.find({ online: true });
  const onlineList = onlineProfiles.map(p => ({
    uuid: p.uuid,
    name: p.name,
    image: p.image || "images/avatar.png",
    online: true
  }));

  for (const ws of sockets.values()) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "onlineUsers", users: onlineList }));
    }
  }
}
