document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('crypto-withdrawal-form');
  const assetInput = document.getElementById('asset');
  const networkGroup = document.getElementById('network-group');
  const networkInput = document.getElementById('network');
  const walletInput = document.getElementById('walletAddress');
  const feedback = document.getElementById('walletAddressFeedback');
  if (!form || !assetInput || !networkGroup || !networkInput || !walletInput || !feedback) return;

  const nativeNetworkInput = document.createElement('input');
  nativeNetworkInput.type = 'hidden';
  nativeNetworkInput.name = 'network';
  form.appendChild(nativeNetworkInput);

  const updateNetworkOptions = () => {
    const selectedAsset = assetInput.value;
    const assetOption = assetInput.options[assetInput.selectedIndex];
    const defaultNetwork = assetOption ? assetOption.dataset.defaultNetwork : '';
    const networkOptions = Array.from(networkInput.options).slice(1);
    const supportedOptions = networkOptions.filter(option => option.dataset.asset === selectedAsset);
    const hasNetworkChoice = supportedOptions.length > 1;

    networkGroup.hidden = !hasNetworkChoice;
    networkInput.required = hasNetworkChoice;
    networkInput.disabled = !hasNetworkChoice;
    networkInput.name = hasNetworkChoice ? 'network' : '';
    nativeNetworkInput.disabled = hasNetworkChoice || !defaultNetwork;
    nativeNetworkInput.name = hasNetworkChoice ? '' : 'network';
    nativeNetworkInput.value = hasNetworkChoice ? '' : defaultNetwork;

    for (const option of networkOptions) {
      option.hidden = option.dataset.asset !== selectedAsset;
      option.disabled = option.hidden;
    }
    networkInput.value = '';
    walletInput.setCustomValidity('');
    feedback.textContent = hasNetworkChoice
      ? 'Choose a network before entering the matching wallet address.'
      : 'Enter a valid address for the selected cryptocurrency.';
    feedback.className = 'form-text text-muted';
  };

  const validateWallet = async () => {
    const asset = assetInput.value;
    const network = networkInput.disabled ? nativeNetworkInput.value : networkInput.value;
    const address = walletInput.value.trim();
    if (!asset || !network || !address) {
      walletInput.setCustomValidity('');
      return false;
    }

    feedback.textContent = 'Checking wallet address…';
    feedback.className = 'form-text text-muted';
    const valid = await window.cryptoAddressValidation.isValidWalletAddress(asset, network, address);
    walletInput.setCustomValidity(valid ? '' : 'Enter a valid wallet address for the selected asset and network.');
    feedback.textContent = valid
      ? 'Wallet address is valid for the selected asset and network.'
      : 'This address does not match the selected cryptocurrency and network.';
    feedback.className = valid ? 'form-text text-success' : 'form-text text-danger';
    return valid;
  };

  assetInput.addEventListener('change', updateNetworkOptions);
  networkInput.addEventListener('change', () => {
    walletInput.setCustomValidity('');
    feedback.textContent = 'Enter a valid address for the selected cryptocurrency and network.';
    feedback.className = 'form-text text-muted';
  });
  walletInput.addEventListener('input', () => {
    walletInput.setCustomValidity('');
    feedback.textContent = 'Wallet address will be checked before submission.';
    feedback.className = 'form-text text-muted';
  });
  walletInput.addEventListener('blur', () => {
    validateWallet().catch(() => {
      walletInput.setCustomValidity('The wallet address could not be verified. Please check it and try again.');
      feedback.textContent = 'The wallet address could not be verified.';
      feedback.className = 'form-text text-danger';
    });
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    validateWallet()
      .then(valid => {
        if (valid) HTMLFormElement.prototype.submit.call(form);
        else walletInput.reportValidity();
      })
      .catch(() => {
        walletInput.setCustomValidity('The wallet address could not be verified. Please check it and try again.');
        feedback.textContent = 'The wallet address could not be verified.';
        feedback.className = 'form-text text-danger';
        walletInput.reportValidity();
      });
  });

  updateNetworkOptions();
});
