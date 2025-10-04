// server.js / index.js
const express = require("express");
const app = express();
require("dotenv").config();
const cors = require("cors");
const { dbConnection } = require("./config/config");

const PORT = 3000;

// --- CORS ---
const allowedOrigins = [
  "http://localhost:5173", // Localhost (development)
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

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
