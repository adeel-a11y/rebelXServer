const mongoose = require('mongoose');

const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true }, // e.g., "saleOrderLabel"
  seq: { type: Number, default: 52747 },
});

module.exports = mongoose.model('Counter', counterSchema);
