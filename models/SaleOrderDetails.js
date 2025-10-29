const mongoose = require("mongoose");

const saleOrderDetailsSchema = new mongoose.Schema(
  {
    // RecordID: "ea464694"
    RecordID: {
      type: String,
      required: true,
      trim: true,
    },

    // OrderID: "1610bel2"
    OrderID: {
      type: String,
      required: true,
      trim: true,
    },

    // Warehouse: "Rebel (MAIN)"
    Warehouse: {
      type: String,
      trim: true,
    },

    // SKU: "79775012-FKKQF1000"
    SKU: {
      type: String,
      trim: true,
    },

    // Description: "Green Malaysian/6 1kg Powder Brown Bag"
    Description: {
      type: String,
      trim: true,
    },

    // LotNumber: "Lot# 6576-031824"
    LotNumber: {
      type: String,
      trim: true,
    },

    // QtyShipped: "1.00"
    QtyShipped: {
      type: String,
      trim: true,
    },

    // UOM: "ea"
    UOM: {
      type: String,
      trim: true,
    },

    // Price: "$50.00"
    Price: {
      type: String,
      trim: true,
    },

    // Total: "$50.00"
    Total: {
      type: String,
      trim: true,
    },

    // TimeStamp: "5/20/2024 14:01:49"
    TimeStamp: {
      type: Date,
    },
  },
  {
    timestamps: true, // createdAt / updatedAt
  }
);

// avoid model overwrite in dev
module.exports = mongoose.model("SaleOrderDetail", saleOrderDetailsSchema, "SaleOrderDetails");
