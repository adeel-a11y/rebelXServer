const express = require("express");
const {
  getSaleOrderDetailsLists,
  getSaleOrderDetailById,
  createSaleOrderDetail,
  updateSaleOrderDetail,
  deleteSaleOrderDetail,
} = require("../controllers/saleOrderDetail.controller");

const router = express.Router();

// GET
router.get("/lists", getSaleOrderDetailsLists);
router.get("/lists/:id", getSaleOrderDetailById);

// POST
router.post("/", createSaleOrderDetail);

// PUT
router.put("/update/:id", updateSaleOrderDetail);

// DELETE
router.delete("/delete/:id", deleteSaleOrderDetail);

module.exports = router;
