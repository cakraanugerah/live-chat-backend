// server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const multer = require('multer');
const path = require('path');
const sharp = require('sharp');
const fs = require('fs');
const webpush = require('web-push');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const port = 3000;

// Konfigurasi VAPID untuk notifikasi push
// Ganti dengan kunci VAPID milikmu (generate dengan web-push)
const vapidKeys = {
  publicKey: 'YOUR_PUBLIC_VAPID_KEY',
  privateKey: 'YOUR_PRIVATE_VAPID_KEY'
};
webpush.setVapidDetails('mailto:example@example.com', vapidKeys.publicKey, vapidKeys.privateKey);

// Serve static file dari folder public
app.use(express.static('public'));
app.use(express.json());

// Dummy endpoint untuk cek login (integrasikan dengan WooCommerce di produksi)
app.get('/api/check-login', (req, res) => {
  if (req.query.user) {
    res.json({ loggedIn: true, user: req.query.user });
  } else {
    res.json({ loggedIn: false });
  }
});

// Simpan subscription push di memori (di produksi, simpan di database)
let pushSubscriptions = [];

// Endpoint untuk menerima push subscription
app.post('/api/subscribe', (req, res) => {
  const subscription = req.body;
  pushSubscriptions.push(subscription);
  res.status(201).json({});
});

// Konfigurasi Multer untuk file upload
const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function(req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 } // Batas 10MB
});

// Endpoint upload file (gambar atau video)
app.post('/api/upload', upload.single('file'), async (req, res) => {
  const filePath = req.file.path;
  const fileMime = req.file.mimetype;
  if (fileMime.startsWith('image/')) {
    const outputPath = 'uploads/compressed-' + req.file.filename;
    try {
      await sharp(filePath)
        .resize(800) // Ubah ukuran lebar gambar menjadi 800px, mempertahankan aspek rasio
        .jpeg({ quality: 80 })
        .toFile(outputPath);
      fs.unlinkSync(filePath); // Hapus file asli
      res.json({ fileUrl: '/' + outputPath });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Error compressing image' });
    }
  } else if (fileMime.startsWith('video/')) {
    // Placeholder: di produksi gunakan FFmpeg untuk kompresi video
    res.json({ fileUrl: '/' + filePath });
  } else {
    res.status(400).json({ error: 'Unsupported file type' });
  }
});

// Penyimpanan histori chat (gunakan database di produksi)
let chatHistory = {}; // Format: { roomId: [message, ...] }

// Auto-reply sederhana berdasarkan kata kunci
const autoReplyRules = [
  { keyword: /cara bayar/i, reply: "Untuk cara bayar, silakan pilih transfer bank atau pembayaran online." },
  { keyword: /jam operasional/i, reply: "Jam operasional kami adalah Senin-Jumat, 09:00 - 17:00." }
];

// Socket.io untuk komunikasi real-time
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Gabung ke room chat (gunakan ID user)
  socket.on('joinRoom', (data) => {
    const roomId = data.userId;
    socket.join(roomId);
    // Kirim histori chat jika ada
    if (chatHistory[roomId]) {
      socket.emit('chatHistory', chatHistory[roomId]);
    }
    // Kirim informasi produk (URL atau card produk)
    if (data.product) {
      socket.emit('productInfo', data.product);
    }
  });

  // Terima pesan dari pengguna atau admin
  socket.on('sendMessage', (data) => {
    const roomId = data.roomId;
    const msg = {
      id: Date.now(),
      sender: data.sender,
      message: data.message,
      timestamp: new Date()
    };
    if (!chatHistory[roomId]) chatHistory[roomId] = [];
    chatHistory[roomId].push(msg);
    io.to(roomId).emit('newMessage', msg);

    // Jika pesan dari pengguna, cek auto-reply
    if (data.sender === 'user') {
      autoReplyRules.forEach(rule => {
        if (rule.keyword.test(data.message)) {
          const autoMsg = {
            id: Date.now() + 1,
            sender: 'admin',
            message: rule.reply,
            timestamp: new Date()
          };
          chatHistory[roomId].push(autoMsg);
          io.to(roomId).emit('newMessage', autoMsg);
        }
      });
    }

    // Kirim notifikasi push jika pesan dikirim oleh admin
    if (data.sender === 'admin') {
      const payload = JSON.stringify({
        title: "Pesan Baru dari Admin",
        body: data.message,
        roomId: roomId
      });
      pushSubscriptions.forEach(sub => {
        webpush.sendNotification(sub, payload).catch(err => console.error(err));
      });
    }
  });

  // Indikator mengetik
  socket.on('typing', (data) => {
    socket.to(data.roomId).emit('typing', data);
  });

  // Fitur admin: arsipkan chat
  socket.on('adminArchiveChat', (data) => {
    // Di produksi, update status chat di database
    io.to(data.roomId).emit('chatArchived', { roomId: data.roomId });
  });

  // Fitur admin: hapus pesan tertentu
  socket.on('adminDeleteMessage', (data) => {
    const roomId = data.roomId;
    if (chatHistory[roomId]) {
      chatHistory[roomId] = chatHistory[roomId].filter(msg => msg.id !== data.messageId);
      io.to(roomId).emit('messageDeleted', data.messageId);
    }
  });
});

server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
