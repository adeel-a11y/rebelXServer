const express = require("express");
const {
  getActivitiesLists,
  getActivitiesListById,
  createActivityList,
  updateActivityList,
  deleteActivityList,
} = require("../controllers/activities.controller");

const router = express.Router();

// GET
router.get("/lists", getActivitiesLists);
router.get("/lists/:id", getActivitiesListById);

// POST
router.post("/", createActivityList);

// PUT
router.put("/update/:id", updateActivityList);

// DELETE
router.delete("/delete/:id", deleteActivityList);

module.exports = router;
