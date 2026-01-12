const WebSocket = require("ws");

const port = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port });

const sockets = new Map();          // uuid -> ws
const profiles = new Map();         // uuid -> profile
const offlineMessages = new Map();  // uuid -> [messages]

console.log("WS server running on port", port);

wss.on("connection", ws => {
    console.log("Client connected");

    ws.on("message", raw => {
        let data;
        try { data = JSON.parse(raw); } catch { return; }

        const type = data.type;

        /* ================= LOGIN / REGISTER ================= */
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

            ws.send(JSON.stringify({
                type: "loginSuccess",
                profile
            }));

            // 🔥 pošalji offline poruke ako postoje
            if (offlineMessages.has(profile.uuid)) {
                ws.send(JSON.stringify({
                    type: "offlineMessages",
                    messages: offlineMessages.get(profile.uuid)
                }));
                offlineMessages.delete(profile.uuid);
            }

            broadcastOnlineUsers();
            return;
        }

        if (type === "sync") {
          const msgs = messages.filter(m =>
            m.to === data.uuid && m.time > data.lastSync
          );
        
          const pending = pendingRequests.get(data.uuid) || [];
        
          ws.send(JSON.stringify({
            type: "syncData",
            messages: msgs,
            friendRequests: pending,
            serverTime: Date.now()
          }));
        
          pendingRequests.delete(data.uuid);
        }


        /* ================= CHAT ================= */
        if (type === "chat") {
            const fromProfile = profiles.get(data.from);
            const toProfile = profiles.get(data.to);
            if (!fromProfile || !toProfile) return;

            const message = {
                type: "chat",
                from: data.from,
                to: data.to,
                text: data.text,
                time: Date.now()
            };

            // ➜ pošalji primatelju ako je online
            const targetWs = sockets.get(toProfile.uuid);
            if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                targetWs.send(JSON.stringify(message));
            } else {
                // 📴 spremi offline poruku
                if (!offlineMessages.has(toProfile.uuid)) {
                    offlineMessages.set(toProfile.uuid, []);
                }
                offlineMessages.get(toProfile.uuid).push(message);
            }

            // ➜ pošalji i pošiljaocu (instant prikaz)
            const senderWs = sockets.get(fromProfile.uuid);
            if (senderWs && senderWs.readyState === WebSocket.OPEN) {
                senderWs.send(JSON.stringify(message));
            }

            return;
        }

        /* ================= FRIEND REQUEST ================= */
        if (type === "friendRequest") {
            const from = profiles.get(data.fromProfile.uuid);
            const to = profiles.get(data.to);
            if (!from || !to) return;

            if (!to.pending.includes(from.uuid)) {
                to.pending.push(from.uuid);
            }

            const targetWs = sockets.get(to.uuid);
            if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                targetWs.send(JSON.stringify({
                    type: "friendRequest",
                    fromProfile: from
                }));
            }
            return;
        }

        /* ================= FRIEND ACCEPT / REJECT ================= */
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
    });

    ws.on("close", () => {
        const entry = [...sockets.entries()].find(([_, sock]) => sock === ws);
        if (entry) {
            const [uuid] = entry;
            const profile = profiles.get(uuid);
            if (profile) profile.online = false;
            sockets.delete(uuid);
        }
        broadcastOnlineUsers();
        console.log("Client disconnected");
    });
});

/* ================= ONLINE USERS ================= */
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

