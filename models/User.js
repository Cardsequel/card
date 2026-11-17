const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
first_name: {
    type: String,
    required: true
  },
  last_name: {
    type: String,
    required: true
  },
  email: {
    type: String,
    required: true
  },
  phone: {
    type: String,
    trim: true,
    match: /^\+[1-9]\d{1,14}$/
  },
  wallet: {
    type: String,
    required: false
  },
  password: {
    type: String,
    required: true
  },
  passwordResetTokenHash: {
    type: String,
    select: false
  },
  passwordResetExpires: {
    type: Date,
    select: false
  },
  unsubscribeTokenHashes: {
    type: [String],
    default: [],
    select: false
  },
  category: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  },
  code:{
    type: String,
    required: false
    
  },
  referalcode: {
    type: String,
    required: false
  },
  availbalance:{
    type: Number,
    default: 0
  },
  activedeposit:{
    type: Number,
    default: 0
  },
  activeinvestment:{
    type: Number,
    default: 0
  },
  cashback:{
    type: Number,
    default: 0
  },
  todaysspending :{
    type: Number,
    default: 0
  },
  cardnumber :{
    type: String,
    default: 'XXXX XXXX XXXX XXXX'
  },
  plan_tpye: {
    type: String,
    trim: true
  },
  CVV :{
    type: String,
    default: 'XXX'
  },
  expirydate :{
    type: String,
    default: 'XX/XX'
  },

  kyc: {
    status: {
      type: String,
      enum: ['not_submitted', 'pending'],
      default: 'not_submitted'
    },
    governmentIdType: String,
    address: {
      line1: String,
      line2: String,
      city: String,
      region: String,
      postalCode: String,
      country: String
    },
    governmentId: {
      storedName: String,
      mimeType: String
    },
    portrait: {
      storedName: String,
      mimeType: String
    },
    submittedAt: Date
  },

  date: {
    type: Date,
    default: Date.now
  }
});

const User = mongoose.model('User', UserSchema);

module.exports = User;
