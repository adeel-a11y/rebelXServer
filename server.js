// server.js / index.js
const express = require("express");
const app = express();
const axios = require("axios");
require("dotenv").config();
const cors = require("cors");
const { dbConnection } = require("./config/config");

const PORT = 3000;

// --- CORS ---
const allowedOrigins = [
  "http://localhost:5173", // Localhost (development)
  "https://rebel-x-client.vercel.app"
];

// middleware
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like Postman) or if origin is in allowed list
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  })
);

// Body parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", require("./routes/ping_routes"));

// DB
dbConnection();

// Routes
const userRoutes = require("./routes/users.route");
const activityRoutes = require("./routes/activities.route");
const clientRoutes = require("./routes/clients.route");

app.get("/", (_req, res) => {
  res.status(200).json({ message: "Welcome Back ReblEx Server" });
});
app.use("/api/users", userRoutes);
app.use("/api/activities", activityRoutes);
app.use("/api/clients", clientRoutes);


app.listen(PORT, '0.0.0.0', () => {
    setInterval(async () => {
        try {
            await axios.get('https://rebelxserver.onrender.com/api/ping');
            console.log(`[AutoPing] Successful at ${new Date().toISOString()}`);
        } catch (err) {
            console.error('[AutoPing] Failed:', err.message);
        }
    }, 10 * 60 * 1000);
});