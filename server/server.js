const WebSocket = require("ws");
const { randomUUID } = require("crypto");

const port = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port });

const sockets = new Map();    // uuid -> ws
const profiles = new Map();   // uuid -> profile

console.log("WS server running on port", port);

wss.on("connection", ws => {
    console.log("Client connected");

    ws.on("message", raw => {
        let data;
        try { data = JSON.parse(raw); } catch { return; }

        const type = data.type;

        // REGISTER / LOGIN
        if (type === "register" || type === "login") {
            let profile = profiles.get(data.profile.uuid);
            if (!profile) {
                profile = {
                    uuid: data.profile.uuid,
                    name: data.profile.name,
                    image: data.profile.image || 'images/avatar.png',
                    friends: [],
                    pending: [],
                    online: true
                };
                profiles.set(profile.uuid, profile);
            } else {
                profile.online = true;
            }
            sockets.set(profile.uuid, ws);
            ws.send(JSON.stringify({ type: "loginSuccess", profile }));
            broadcastOnlineUsers();
            return;
        }

        if (type === "chat") {
            // pošalji svim online prijateljima
            const fromProfile = profiles.get(data.from);
            if (!fromProfile) return;

            // Ako želiš da ide samo prijatelju
            const toProfile = profiles.get(data.to); // u data.to treba biti uuid primatelja
            if (toProfile) {
                const targetWs = sockets.get(toProfile.uuid);
                if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                    targetWs.send(JSON.stringify(data)); // šalje poruku primatelju
                }
            }
        
            // Opcionalno: dodaj poruku i sebi (ako hoćeš da se prikaže odmah)
            const senderWs = sockets.get(data.from);
            if (senderWs && senderWs.readyState === WebSocket.OPEN) {
                senderWs.send(JSON.stringify(data));
            }        
        }


        // FRIEND REQUEST
        if (type === "friendRequest") {
            const from = profiles.get(data.fromProfile.uuid);
            const to = profiles.get(data.to);
            if (!from || !to) return;

            if (!to.pending.includes(from.uuid)) to.pending.push(from.uuid);

            const targetWs = sockets.get(to.uuid);
            if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                targetWs.send(JSON.stringify({
                    type: "friendRequest",
                    fromProfile: from
                }));
            }
            return;
        }

        // FRIEND ACCEPT / REJECT
        if (type === "friendAccept" || type === "friendReject") {
            const from = profiles.get(data.fromProfile.uuid); // primalac
            const to = profiles.get(data.to);                // posiljalac
            if (!from || !to) return;

            // ukloni iz pending
            from.pending = from.pending.filter(u => u !== to.uuid);
            to.pending = to.pending.filter(u => u !== from.uuid);

            if (type === "friendAccept") {
                // dodaj prijatelje (full profile)
                if (!from.friends.some(f => f.uuid === to.uuid)) {
                    from.friends.push({ uuid: to.uuid, name: to.name, image: to.image });
                }
                if (!to.friends.some(f => f.uuid === from.uuid)) {
                    to.friends.push({ uuid: from.uuid, name: from.name, image: from.image });
                }
            }

            // signal za pošiljaoca
            const wsTo = sockets.get(to.uuid);
            if (wsTo && wsTo.readyState === WebSocket.OPEN) {
                wsTo.send(JSON.stringify({
                    type: type === "friendAccept" ? "friendAccepted" : "friendRejected",
                    friend: { uuid: from.uuid, name: from.name, image: from.image || "images/avatar.png" }
                }));
            }

            // signal za primalca (dodaj friend)
            const wsFrom = sockets.get(from.uuid);
            if (wsFrom && wsFrom.readyState === WebSocket.OPEN) {
                wsFrom.send(JSON.stringify({
                    type: type === "friendAccept" ? "friendAdded" : "friendRejectedLocal",
                    friend: { uuid: to.uuid, name: to.name, image: to.image || "images/avatar.png" }
                }));
            }
            return;
        }

    }); // kraj ws.on("message")

    ws.on("close", () => {
        const profileEntry = [...sockets.entries()].find(([uuid, sock]) => sock === ws);
        if (profileEntry) {
            const [uuid] = profileEntry;
            const profile = profiles.get(uuid);
            if (profile) profile.online = false;
            sockets.delete(uuid);
        }
        console.log("Client disconnected");
        broadcastOnlineUsers();
    });
}); // kraj wss.on("connection")

function broadcastOnlineUsers() {
    const onlineList = Array.from(profiles.values())
        .filter(p => p.online)
        .map(p => ({ uuid: p.uuid, name: p.name, image: p.image || 'images/avatar.png', online: true }));

    sockets.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "onlineUsers", users: onlineList }));
        }
    });
}


