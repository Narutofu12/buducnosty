const WebSocket = require("ws");
const port = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port });

const clients = new Map(); // ws -> user
const users = new Map();   // ws -> profile
const sockets = new Map(); // uuid -> ws
const pendingRequests = new Map(); // uuid -> [ { type, fromProfile } ]

// ------------------- BROADCAST ONLINE USERS -------------------
function broadcastOnlineUsers() {
    const onlineList = Array.from(users.values());
    const msg = JSON.stringify({ type: "onlineUsers", users: onlineList });
    users.forEach((_, ws) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    });
}

// ------------------- CONNECTION -------------------
wss.on("connection", ws => {
    console.log("Client connected");

    ws.on("message", raw => {
        let data;
        try { data = JSON.parse(raw); } catch { return; }

        const type = data.type;
        const profile = users.get(ws) || data.profile;

        // ------------------- REGISTER -------------------
        if (type === "register") {
            users.set(ws, profile);
            sockets.set(profile.uuid, ws);

            // Pošalji sve pending zahtjeve ako ih ima
            if (pendingRequests.has(profile.uuid)) {
                const inbox = pendingRequests.get(profile.uuid);
                inbox.forEach(req => {
                    ws.send(JSON.stringify(req));
                });
                pendingRequests.delete(profile.uuid);
            }

            broadcastOnlineUsers();
        }

        // ------------------- FRIEND REQUEST -------------------
        if (type === "friendRequest") {
            const targetWs = sockets.get(data.to);

            // Provjeri da li već postoji u pending ili friends
            const senderUuid = data.fromProfile.uuid;
            const targetProfile = users.get(targetWs);
            let alreadyFriend = false;
            let alreadyPending = false;

            if (targetProfile) {
                alreadyFriend = targetProfile.friends?.some(f => f.uuid === senderUuid);
                alreadyPending = targetProfile.pending?.some(f => f.uuid === senderUuid);
            }

            if (alreadyFriend || alreadyPending) return; // ignoriraj duplikat

            // Ako je online → pošalji direktno
            if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                targetWs.send(JSON.stringify({
                    type: "friendRequest",
                    fromProfile: data.fromProfile
                }));
            } else {
                // ako nije online → spremi u pending
                if (!pendingRequests.has(data.to)) pendingRequests.set(data.to, []);
                pendingRequests.get(data.to).push({
                    type: "friendRequest",
                    fromProfile: data.fromProfile
                });
            }
        }

        // ------------------- FRIEND ACCEPT -------------------
        if (type === "friendAccept" || type === "friendReject") {
            const targetWs = sockets.get(data.to); // onaj koji je poslao zahtjev
            const responder = data.fromProfile;    // osoba koja prihvaća ili odbija

            // Pošalji alert pošiljaocu (onaj koji je inicirao zahtjev)
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

            // Pošalji alert onome koji je odgovorio
            if (clients.has(ws) && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: type === "friendAccept" ? "friendAcceptedByYou" : "friendRejectedByYou",
                    fromProfile: responder
                }));
            }
        }
    });

    ws.on("close", () => {
        const user = users.get(ws);
        if (user) {
            users.delete(ws);
            sockets.delete(user.uuid);
            clients.delete(ws);
            broadcastOnlineUsers();
        }
        console.log("Client disconnected");
    });
});

console.log("Server running on port", port);
