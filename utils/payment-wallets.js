const paymentWallets = [
  {
    key: 'cardActivationBitcoin',
    label: 'Bitcoin — card activation',
    defaultAddress: '1HBLLhU1rd39ieM3Y26KbN8WFtM74eYXm5'
  },
  {
    key: 'bitcoin',
    label: 'Bitcoin',
    defaultAddress: 'bc1q6fqm88wzlp5z6tqyaz3whg8xxhh96xq3l36psh'
  },
  {
    key: 'ethereum',
    label: 'Ethereum / USDT ERC-20',
    defaultAddress: '0xf682c5b8c33aea456aa8cd281eb240e44de875cb'
  },
  {
    key: 'usdtTron',
    label: 'USDT TRC-20',
    defaultAddress: 'TAv58pjfvgKDzPbK7cssTb4uYSbk1PMFuE'
  },
  {
    key: 'litecoin',
    label: 'Litecoin',
    defaultAddress: 'LQ1RmhUEw3tJZzmxyAbz4MExFZ24i2V84z'
  }
];

const defaultPaymentWalletAddresses = Object.freeze(
  Object.fromEntries(paymentWallets.map(({ key, defaultAddress }) => [key, defaultAddress]))
);

module.exports = { paymentWallets, defaultPaymentWalletAddresses };
