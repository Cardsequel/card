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
  password2:{
    type: String,
    required: true
  },
  code:{
    type: String,
    required: false
    
  },
  availbalance:{
    type: String,
    default: '00.00'
  },
  activedeposit:{
    type: String,
    default: '00.00'
  },
  activeinvestment:{
    type: String,
    default: '00.00'
  },
  cashback:{
    type: String,
    default: '00.00'
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
