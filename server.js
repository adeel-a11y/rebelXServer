// server.js / index.js
const express = require("express");
const app = express();
const http = require("http");
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

// (Optional) avoid 304-caching weirdness during dev
// app.set("etag", false);
// app.use((req,res,next)=>{ res.set("Cache-Control","no-store"); next(); });

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


if (require.main === module && !process.env.VERCEL) {
  const server = http.createServer(app);

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server is running on port ${PORT}`);

    // Prefer env, else derive from Render's external URL, else localhost:
    const baseFromRender =
      (process.env.RENDER_EXTERNAL_URL || "").replace(/\/$/, "");
    const PING_URL =
      process.env.PING_URL ||
      (baseFromRender ? `${baseFromRender}/api/ping` : `http://localhost:${PORT}/api/ping`);

    // 10 minutes (override via KEEPALIVE_INTERVAL_MS if you want)
    const intervalMs = Number(process.env.KEEPALIVE_INTERVAL_MS || 10 * 60 * 1000);

    console.log(`[AutoPing] Using ${PING_URL} every ${intervalMs / 60000} min`);

    setInterval(async () => {
      try {
        await axios.get(PING_URL, { timeout: 10_000 });
        console.log(`[AutoPing] ok @ ${new Date().toISOString()}`);
      } catch (err) {
        console.error(`[AutoPing] failed: ${err?.message || err}`);
      }
    }, intervalMs);
  });
}

// app.listen(PORT, () => {
//   console.log(`Server is running on port ${PORT}`);
// });
