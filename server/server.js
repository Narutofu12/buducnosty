const WebSocket = require("ws");
const port = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port });

const users = new Map(); // ws -> profile
const sockets = new Map(); // uuid -> ws
const pendingRequests = new Map(); // uuid -> [ { type, fromProfile } ]

function broadcastOnlineUsers() {
    const onlineList = Array.from(users.values());
    const msg = JSON.stringify({ type: "onlineUsers", users: onlineList });
    users.forEach((_, ws) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    });
}

wss.on("connection", ws => {
    console.log("Client connected");

    ws.on("message", raw => {
        let data;
        try { data = JSON.parse(raw); } catch { return; }

        const type = data.type;
        const profile = users.get(ws) || data.profile;

        // REGISTER
        if (type === "register") {
            users.set(ws, profile);
            sockets.set(profile.uuid, ws);

            // Pošalji sve pending zahtjeve
            if (pendingRequests.has(profile.uuid)) {
                pendingRequests.get(profile.uuid).forEach(req => {
                    ws.send(JSON.stringify(req));
                });
                pendingRequests.delete(profile.uuid);
            }

            broadcastOnlineUsers();
        }

        // FRIEND REQUEST
        if (type === "friendRequest") {
            const targetWs = sockets.get(data.to);
            const senderUuid = data.fromProfile.uuid;

            // Spriječi duplikat u pending ili friends
            let alreadyFriend = false;
            let alreadyPending = false;
            if (targetWs && users.has(targetWs)) {
                const targetProfile = users.get(targetWs);
                alreadyFriend = targetProfile.friends?.some(f => f.uuid === senderUuid);
                alreadyPending = pendingRequests.get(targetProfile.uuid)?.some(f => f.fromProfile.uuid === senderUuid);
            }

            if (alreadyFriend || alreadyPending) return;

            const payload = { type: "friendRequest", fromProfile: data.fromProfile };
            if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                targetWs.send(JSON.stringify(payload));
            } else {
                if (!pendingRequests.has(data.to)) pendingRequests.set(data.to, []);
                pendingRequests.get(data.to).push(payload);
            }
        }

        // FRIEND ACCEPT / REJECT
        if (type === "friendAccept" || type === "friendReject") {
            const targetWs = sockets.get(data.to); // originalni posiljalac
            const responder = data.fromProfile;    // osoba koja odgovara

            // Posalji pošiljaocu
            if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                targetWs.send(JSON.stringify({
                    type: type,
                    fromProfile: responder
                }));
            } else {
                if (!pendingRequests.has(data.to)) pendingRequests.set(data.to, []);
                pendingRequests.get(data.to).push({
                    type: type,
                    fromProfile: responder
                });
            }

            // Posalji onome ko odgovara
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: type === "friendAccept" ? "friendAcceptedByYou" : "friendRejectedByYou",
                    fromProfile: responder,
                    toProfile: data.toProfile // dodano za alert
                }));
            }
        }
    });

    ws.on("close", () => {
        const profile = users.get(ws);
        if (profile) {
            users.delete(ws);
            sockets.delete(profile.uuid);
            broadcastOnlineUsers();
        }
        console.log("Client disconnected");
    });
});

console.log("Server running on port", port);
