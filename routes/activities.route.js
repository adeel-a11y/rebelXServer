const express = require("express");
const {
  getActivitiesLists,
  getActivitiesSummary,
  getActivitiesListByClientId,
  getActivitiesListById,
  getActivitiesListByUserPerMonth,
  getActivitySummaryByUser,
  getRecentActivitiesByUser,
  createActivityList,
  updateActivityList,
  deleteActivityList,
} = require("../controllers/activities.controller");

const router = express.Router();

// GET
router.get("/lists", getActivitiesLists);
router.get("/lists/summary", getActivitiesSummary);
router.get("/lists/client/:clientId", getActivitiesListByClientId);
router.get("/lists/user/:userId", getActivitiesListByClientId);
router.get("/lists/:id", getActivitiesListById);
router.get(
  "/lists/user-activities-per-month/:id",
  getActivitiesListByUserPerMonth
);
router.get("/lists/user-activity-summary/:id", getActivitySummaryByUser);
router.get("/lists/user-recent-activities/:id", getRecentActivitiesByUser);

// POST
router.post("/", createActivityList);

// PUT
router.put("/update/:id", updateActivityList);

// DELETE
router.delete("/delete/:id", deleteActivityList);

module.exports = router;
