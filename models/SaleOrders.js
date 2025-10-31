const mongoose = require("mongoose");

const PAYMENT_METHODS = [
  "",               // keep empty as valid default
  "CARD",           // credit/debit card (generic)
  "CASH",
  "CHECK",
  "PAYPAL",
  "VENMO",
  "SQUARE",
  "BANK_TRANSFER",
  "ACH",
  "WIRE",
  "OTHER",
];

const SHIPPING_METHODS = [
  "",
  "PICKUP",
  "LOCAL_COURIER",
  "UPS",
  "FEDEX",
  "USPS",
  "DHL",
  "LTL_FREIGHT",
  "DELIVERY",
  "OTHER",
];

const saleOrderSchema = new mongoose.Schema(
  {
    // OrderID: "15694"
    OrderID: {
      type: String,
      required: true,
      trim: true,
    },

    // Label: "15694"
    Label: {
      type: String,
      trim: true,
    },

    // ClientID: "6EG7046"
    ClientID: {
      type: String,
      trim: true,
    },

    // TimeStamp: "01/02/2024 00:00:00"
    // stored as Date in DB (recommended)
    TimeStamp: {
      type: Date,
    },

    // SalesRep: "victor@grassrootsharvest.com"
    SalesRep: {
      type: String,
      trim: true,
      lowercase: true,
    },

    // Discount: ""
    Discount: {
      type: String,
      default: "",
      trim: true,
    },

    // PaymentMethod: ""
    PaymentMethod: {
      type: String,
      enum: PAYMENT_METHODS,
      default: "",
      trim: true,
      set: (v) => (v ?? "").toString().trim().toUpperCase(),
    },

    // ShippedDate: ""
    ShippedDate: {
      type: String,
      default: "",
      trim: true,
    },

    // ShippingMethod: ""
    ShippingMethod: {
      type: String,
      enum: SHIPPING_METHODS,
      default: "",
      trim: true,
      set: (v) => (v ?? "").toString().trim().toUpperCase(),
    },

    // Tracking: ""
    Tracking: {
      type: String,
      default: "",
      trim: true,
    },

    // ShippingCost: ""
    ShippingCost: {
      type: String,
      default: "",
      trim: true,
    },

    // Tax: ""
    Tax: {
      type: String,
      default: "",
      trim: true,
    },

    // Paid: ""
    Paid: {
      type: String,
      default: "",
      trim: true,
    },

    // ShiptoAddress: ""
    ShiptoAddress: {
      type: String,
      default: "",
      trim: true,
    },

    // City: "Phoenix"
    City: {
      type: String,
      default: "",
      trim: true,
    },

    // State: "Arizona"
    State: {
      type: String,
      default: "",
      trim: true,
    },

    // PaymentDate: ""
    PaymentDate: {
      type: String,
      default: "",
      trim: true,
    },

    // PaymentAmount: ""
    PaymentAmount: {
      type: String,
      default: "",
      trim: true,
    },

    // LockPrices: "FALSE"
    LockPrices: {
      type: String,
      default: "",
      trim: true,
    },

    // OrderStatus: "Completed"
    OrderStatus: {
      type: String,
      enum: ["Pending", "Confirmed", "Processing", "Shipping", "Delivered", "Completed", "Issued", "Pending Payment", "Cancelled", "Returned"],
      trim: true,
    },
  },
  {
    timestamps: true, // adds createdAt / updatedAt
  }
);

// optional: prevent model overwrite in dev reload
module.exports = mongoose.model("SaleOrder", saleOrderSchema, "SaleOrders");
