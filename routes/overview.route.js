const express = require("express");

const { overviewAnalytics, monthlyNewClients, getTopUsersByActivity } = require("../controllers/analytics.controller");

const router = express.Router();

router.get("/", overviewAnalytics);
router.get("/clients", monthlyNewClients);
router.get("/top-users", getTopUsersByActivity);

module.exports = router;
