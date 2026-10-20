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
  wallet: {
    type: String,
    required: false
  },
  password: {
    type: String,
    required: true
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
  CVV :{
    type: String,
    default: 'XXX'
  },
  expirydate :{
    type: String,
    default: 'XX/XX'
  },


  date: {
    type: Date,
    default: Date.now
  }
});

const User = mongoose.model('User', UserSchema);

module.exports = User;
