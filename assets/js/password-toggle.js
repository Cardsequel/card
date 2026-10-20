document.addEventListener('click', event => {
  const toggle = event.target.closest('[data-password-toggle]');
  if (!toggle) return;

  const inputGroup = toggle.closest('.input-group');
  const input = inputGroup && inputGroup.querySelector('input[type="password"], input[type="text"]');
  if (!input) return;

  const isVisible = input.type === 'password';
  input.type = isVisible ? 'text' : 'password';
  toggle.setAttribute('aria-pressed', String(isVisible));
  toggle.setAttribute('aria-label', isVisible ? 'Hide password' : 'Show password');
  toggle.dataset.visible = String(isVisible);
});
