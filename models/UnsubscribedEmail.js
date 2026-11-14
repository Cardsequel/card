const mongoose = require('mongoose');

const UnsubscribedEmailSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    maxlength: 254
  },
  normalizedEmail: {
    type: String,
    required: true,
    maxlength: 254,
    unique: true
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('UnsubscribedEmail', UnsubscribedEmailSchema);
