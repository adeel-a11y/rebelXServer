const express = require("express");
const {
  getClientsLists,
  getClientsSummary,
  getClientsListById,
  createClientList,
  updateClientList,
  updateClientStatus,
  deleteClientList,
} = require("../controllers/clients.controller");

const router = express.Router();

// GET
router.get("/lists", getClientsLists);
router.get("/lists/summary", getClientsSummary);
router.get("/lists/:id", getClientsListById);

// POST
router.post("/", createClientList);

// PUT
router.put("/update/:id", updateClientList);
router.put("/update-status/:id", updateClientStatus);

// DELETE
router.delete("/delete/:id", deleteClientList);

module.exports = router;
