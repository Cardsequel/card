document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('register-form');
  const submitButton = document.getElementById('form_submit');
  if (!form || !submitButton) return;

  const updateSubmitState = () => {
    submitButton.disabled = !form.checkValidity();
  };

  form.addEventListener('input', updateSubmitState);
  form.addEventListener('change', updateSubmitState);
  updateSubmitState();
});
