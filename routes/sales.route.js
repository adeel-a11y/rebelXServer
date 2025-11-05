const express = require("express");
const {
  getSaleOrdersLists,
  getSaleOrdersByClient,
  getSaleOrdersListById,
  getLatestOrderPerClient,
  getOrdersCountByStatus,
  createSaleOrder,
  updateSaleOrder,
  deleteSaleOrder,
} = require("../controllers/sales.controller");

const router = express.Router();

// GET
router.get("/lists", getSaleOrdersLists);
router.get("/lists/client/:externalId", getSaleOrdersByClient);
router.get("/lists/:id", getSaleOrdersListById);
router.get("/latest-order-per-client", getLatestOrderPerClient);
router.get("/orders-count-by-status", getOrdersCountByStatus);

// POST
router.post("/", createSaleOrder);

// PUT
router.put("/update/:id", updateSaleOrder);

// DELETE
router.delete("/delete/:id", deleteSaleOrder);

module.exports = router;
