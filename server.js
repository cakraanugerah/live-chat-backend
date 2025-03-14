const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const cors = require("cors");

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*", // Izinkan akses dari semua domain
  },
});

// Middleware
app.use(cors());
app.use(express.json());

// Endpoint sederhana
app.get("/", (req, res) => {
  res.send("Live Chat Backend is Running!");
});

// Socket.io handling
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("sendMessage", (data) => {
    io.emit("receiveMessage", data);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

// Jalankan server di port Railway (atau 3000 untuk lokal)
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
