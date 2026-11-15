document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('register-form');
  const submitButton = document.getElementById('form_submit');
  if (!form || !submitButton) return;

  const phoneInput = document.getElementById('phone');
  const phoneCountry = document.getElementById('phone_country');
  const phoneDetectionStatus = document.getElementById('phone-detection-status');
  let phoneField;

  if (phoneInput && phoneCountry && window.intlTelInput) {
    const countries = window.intlTelInput.getAllCountries();
    const supportedCountries = new Set(countries.map(country => country.iso2));
    const existingCountry = supportedCountries.has(phoneCountry.value.toLowerCase())
      ? phoneCountry.value.toLowerCase()
      : '';
    const browserCountry = (() => {
      try {
        const region = new Intl.Locale(navigator.language).region?.toLowerCase();
        return supportedCountries.has(region) ? region : 'us';
      } catch (error) {
        return 'us';
      }
    })();

    phoneField = window.intlTelInput(phoneInput, {
      initialCountry: existingCountry,
      initialCountryLookup: async () => {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 5000);
        try {
          const response = await fetch('https://ipapi.co/json/', {
            signal: controller.signal
          });
          if (!response.ok) throw new Error(`IP lookup failed with status ${response.status}`);

          const location = await response.json();
          const countryCode = (location.country_code || '').toLowerCase();
          if (!supportedCountries.has(countryCode)) {
            throw new Error('IP lookup returned no valid country code');
          }

          phoneDetectionStatus.textContent = 'Country detected from your IP. Choose another country if needed.';
          return countryCode;
        } catch (error) {
          phoneDetectionStatus.textContent = 'Could not detect your country by IP. Confirm the selected country before continuing.';
          return browserCountry;
        } finally {
          window.clearTimeout(timeout);
        }
      }
    });

    phoneInput.addEventListener('input', () => {
      phoneInput.setCustomValidity('');
    });
  }

  const updateSubmitState = () => {
    submitButton.disabled = !form.checkValidity();
  };

  form.addEventListener('input', updateSubmitState);
  form.addEventListener('change', () => {
    if (phoneInput) phoneInput.setCustomValidity('');
    updateSubmitState();
  });
  form.addEventListener('submit', event => {
    if (phoneField) {
      const selectedCountry = phoneField.getSelectedCountry();
      if (phoneField.isValidNumber() !== true || !selectedCountry) {
        event.preventDefault();
        phoneInput.setCustomValidity('Enter a valid phone number for the selected country.');
        phoneInput.reportValidity();
        return;
      }

      phoneInput.setCustomValidity('');
      phoneCountry.value = selectedCountry.iso2;
      phoneInput.value = phoneField.getNumber();
    }
  });
  updateSubmitState();
});
