const express = require("express");
const {
  getActivitiesLists,
  getActivitiesSummary,
  getActivitiesListByClientId,
  getActivitiesListById,
  createActivityList,
  updateActivityList,
  deleteActivityList,
} = require("../controllers/activities.controller");

const router = express.Router();

// GET
router.get("/lists", getActivitiesLists);
router.get("/lists/summary", getActivitiesSummary);
router.get("/lists/client/:clientId", getActivitiesListByClientId);
router.get("/lists/:id", getActivitiesListById);

// POST
router.post("/", createActivityList);

// PUT
router.put("/update/:id", updateActivityList);

// DELETE
router.delete("/delete/:id", deleteActivityList);

module.exports = router;
