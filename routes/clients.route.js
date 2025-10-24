const express = require("express");
const {
  getClientsLists,
  getClientsNames,
  getClientsSummary,
  getClientsListById,
  getActivitiesByClient,
  createClientList,
  updateClientList,
  updateClientStatus,
  deleteClientList,
} = require("../controllers/clients.controller");

const router = express.Router();

// GET
router.get("/lists", getClientsLists);
router.get("/lists/names", getClientsNames);
router.get("/lists/summary", getClientsSummary);
router.get("/lists/activities/:id", getActivitiesByClient);
router.get("/lists/:id", getClientsListById);

// POST
router.post("/", createClientList);

// PUT
router.put("/update/:id", updateClientList);
router.put("/update-status/:id", updateClientStatus);

// DELETE
router.delete("/delete/:id", deleteClientList);

module.exports = router;
