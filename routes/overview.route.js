const express = require("express");

const {
  overviewAnalytics,
  monthlyNewClients,
  getTopUsersByActivity,
  contactStatusBreakdown,
  companyTypeBreakdown,
  contactTypeBreakdown,
} = require("../controllers/analytics.controller");

const router = express.Router();

router.get("/", overviewAnalytics);
router.get("/clients", monthlyNewClients);
router.get("/top-users", getTopUsersByActivity);
router.get("/contact-status-breakdown", contactStatusBreakdown);
router.get("/company-type-breakdown", companyTypeBreakdown);
router.get("/contact-type-breakdown", contactTypeBreakdown);

module.exports = router;
