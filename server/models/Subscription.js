const mongoose = require("mongoose");

const subscriptionSchema = new mongoose.Schema({
  uuid: String,
  subscription: Object
});

module.exports = mongoose.model("Subscription", subscriptionSchema);
