const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema({
  from: String,
  to: String,
  text: String,
  time: Number,
  delivered: { type: Boolean, default: false }
});

module.exports = mongoose.model("PendingMessage", messageSchema);
