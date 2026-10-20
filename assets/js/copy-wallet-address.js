document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-copy-wallet]').forEach(button => {
    button.addEventListener('click', async () => {
      const feedback = button.parentElement.querySelector('[data-copy-feedback]');
      const address = button.dataset.copyWallet;
      if (!address || !feedback) return;

      if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
        feedback.textContent = 'Copy is unavailable in this browser. Select and copy the address shown above.';
        feedback.className = 'form-text text-warning';
        return;
      }

      button.disabled = true;
      try {
        await navigator.clipboard.writeText(address);
        feedback.textContent = 'Wallet address copied.';
        feedback.className = 'form-text text-success';
      } catch (error) {
        feedback.textContent = 'Could not copy the address. Select and copy the address shown above.';
        feedback.className = 'form-text text-danger';
      } finally {
        button.disabled = false;
      }
    });
  });
});
