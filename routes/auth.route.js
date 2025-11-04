const express = require("express");
const {
  loginAccount,
} = require("../controllers/auth.controller");

const router = express.Router();

// POST
router.post("/login", loginAccount);

module.exports = router;
