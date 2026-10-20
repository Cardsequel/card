const mongoose = require('mongoose');
const { paymentWallets } = require('../utils/payment-wallets');

const addressesSchema = Object.fromEntries(paymentWallets.map(({ key, defaultAddress }) => [
  key,
  {
    type: String,
    required: true,
    maxlength: 200,
    default: defaultAddress
  }
]));

const PaymentWalletSettingsSchema = new mongoose.Schema({
  _id: {
    type: String,
    default: 'primary'
  },
  addresses: addressesSchema
}, {
  timestamps: true
});

module.exports = mongoose.model('PaymentWalletSettings', PaymentWalletSettingsSchema);
