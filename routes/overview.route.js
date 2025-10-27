const express = require("express");

const { overviewAnalytics } = require("../controllers/analytics.controller");

const router = express.Router();

router.get("/", overviewAnalytics);

module.exports = router;
