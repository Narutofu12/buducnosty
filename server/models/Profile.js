const mongoose = require("mongoose");

const profileSchema = new mongoose.Schema({
  uuid: String,
  name: String,
  image: String,
  friends: [{ uuid: String, name: String, image: String }],
  pending: [String],
  online: Boolean
});

module.exports = mongoose.model("Profile", profileSchema);
