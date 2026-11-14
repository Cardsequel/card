const mongoose = require('mongoose');

const UnsubscribeTokenSchema = new mongoose.Schema({
  tokenHash: {
    type: String,
    required: true,
    unique: true,
    match: /^[a-f0-9]{64}$/
  },
  email: {
    type: String,
    required: true,
    maxlength: 254
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('UnsubscribeToken', UnsubscribeTokenSchema);
