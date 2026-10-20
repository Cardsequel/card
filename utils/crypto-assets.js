const cryptoAssets = [
  {
    symbol: 'BTC',
    name: 'Bitcoin',
    defaultNetwork: 'Bitcoin',
    networks: [{ value: 'Bitcoin', label: 'Bitcoin' }]
  },
  {
    symbol: 'ETH',
    name: 'Ethereum',
    defaultNetwork: 'Ethereum',
    networks: [{ value: 'Ethereum', label: 'Ethereum' }]
  },
  {
    symbol: 'USDT',
    name: 'Tether',
    networks: [
      { value: 'TRON', label: 'TRON (TRC-20)' },
      { value: 'Ethereum', label: 'Ethereum (ERC-20)' },
      { value: 'BNB Smart Chain', label: 'BNB Smart Chain (BEP-20)' }
    ]
  },
  {
    symbol: 'USDC',
    name: 'USD Coin',
    networks: [
      { value: 'Ethereum', label: 'Ethereum (ERC-20)' },
      { value: 'BNB Smart Chain', label: 'BNB Smart Chain (BEP-20)' },
      { value: 'Solana', label: 'Solana (SPL)' }
    ]
  },
  {
    symbol: 'BNB',
    name: 'BNB',
    defaultNetwork: 'BNB Smart Chain',
    networks: [{ value: 'BNB Smart Chain', label: 'BNB Smart Chain' }]
  },
  {
    symbol: 'XRP',
    name: 'XRP',
    defaultNetwork: 'XRP Ledger',
    networks: [{ value: 'XRP Ledger', label: 'XRP Ledger' }]
  }
];

module.exports = cryptoAssets;
