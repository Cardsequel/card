const mongoose = require('mongoose');
const cryptoAssets = require('../utils/crypto-assets');

const CryptoWithdrawalRequestSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0.01
  },
  asset: {
    type: String,
    enum: cryptoAssets.map(({ symbol }) => symbol),
    required: true
  },
  network: {
    type: String,
    enum: [...new Set(cryptoAssets.flatMap(({ networks }) => networks.map(({ value }) => value)))],
    required: true,
    maxlength: 60
  },
  walletAddress: {
    type: String,
    required: true,
    maxlength: 200
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
    index: true
  },
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  reviewedAt: Date
}, {
  timestamps: true
});

module.exports = mongoose.model('CryptoWithdrawalRequest', CryptoWithdrawalRequestSchema);
