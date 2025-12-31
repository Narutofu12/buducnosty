const WebSocket = require("ws");

const port = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port });
let clients = [];

wss.on("connection", ws => {
  clients.push(ws);
  console.log("Client connected, total:", clients.length);

  ws.on("message", message => {
    console.log("Signal received:", message);

    for (let client of clients) {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(message);
        console.log("Forwarded to client");
      }
    }
  });

  ws.on("close", () => {
    clients = clients.filter(c => c !== ws);
    console.log("Client disconnected, total:", clients.length);
  });
});

console.log("Signaling server running on port", port);
