document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('registrationForm');
    const submitBtn = document.getElementById('submitBtn');
    const loadingSpinner = document.getElementById('loadingSpinner');
    const successMessage = document.getElementById('successMessage');
    const errorMessage = document.getElementById('errorMessage');
    const successContent = document.getElementById('successContent');
    const errorContent = document.getElementById('errorContent');

    // Form submission handler
    form.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        // Show loading state
        showLoading();
        
        // Get form data
        const formData = new FormData(form);
        const data = {
            phoneNumber: formData.get('phoneNumber').trim(),
            name: formData.get('name').trim(),
            companyName: formData.get('companyName').trim(),
            fakeAccountBalance: parseFloat(formData.get('fakeAccountBalance') || '2500.00'),
            loanApplicationStatus: formData.get('loanApplicationStatus') || 'None',
            fraudScenario: formData.get('fraudScenario') === 'on'
        };

        // Validate phone number format
        if (!validatePhoneNumber(data.phoneNumber)) {
            showError('Please enter a valid phone number with country code (e.g., +1234567890)');
            return;
        }

        try {
            // Submit registration
            const response = await fetch('/api/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data)
            });

            const result = await response.json();

            if (response.ok) {
                showSuccess(result);
            } else {
                showError(result.error || 'Registration failed. Please try again.');
            }
        } catch (error) {
            console.error('Registration error:', error);
            showError('Network error. Please check your connection and try again.');
        }
    });

    // Enhanced phone number formatting for North American numbers
    const phoneInput = document.getElementById('phoneNumber');
    
    phoneInput.addEventListener('input', function(e) {
        let value = e.target.value;
        
        // Remove all non-digit characters except +, (, ), -, and spaces
        let digitsOnly = value.replace(/[^\d]/g, '');
        
        // Auto-format as user types
        if (digitsOnly.length <= 3) {
            e.target.value = digitsOnly;
        } else if (digitsOnly.length <= 6) {
            e.target.value = `(${digitsOnly.slice(0, 3)}) ${digitsOnly.slice(3)}`;
        } else if (digitsOnly.length <= 10) {
            e.target.value = `(${digitsOnly.slice(0, 3)}) ${digitsOnly.slice(3, 6)}-${digitsOnly.slice(6)}`;
        } else if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) {
            // Handle 11-digit number starting with 1
            const areaCode = digitsOnly.slice(1, 4);
            const exchange = digitsOnly.slice(4, 7);
            const number = digitsOnly.slice(7, 11);
            e.target.value = `+1 (${areaCode}) ${exchange}-${number}`;
        } else {
            // Truncate if too long
            digitsOnly = digitsOnly.slice(0, 10);
            e.target.value = `(${digitsOnly.slice(0, 3)}) ${digitsOnly.slice(3, 6)}-${digitsOnly.slice(6)}`;
        }
    });
    
    // Show helpful placeholder and examples
    phoneInput.setAttribute('placeholder', '(555) 123-4567');
    
    // Add phone number validation feedback
    phoneInput.addEventListener('blur', function(e) {
        const value = e.target.value;
        if (value && !validatePhoneNumber(value)) {
            e.target.style.borderColor = '#e74c3c';
            showPhoneError('Please enter a valid North American phone number');
        } else {
            e.target.style.borderColor = value ? '#27ae60' : '#e1e8ed';
            hidePhoneError();
        }
    });

    // Real-time balance formatting
    const balanceInput = document.getElementById('fakeAccountBalance');
    balanceInput.addEventListener('input', function(e) {
        let value = parseFloat(e.target.value);
        if (isNaN(value) || value < 0) {
            value = 0;
        } else if (value > 1000000) {
            value = 1000000;
        }
        e.target.value = value.toFixed(2);
    });

    function validatePhoneNumber(phone) {
        if (!phone) return false;
        
        // Extract digits only
        const digitsOnly = phone.replace(/\D/g, '');
        
        // Valid North American patterns:
        // 10 digits: 5551234567
        // 11 digits starting with 1: 15551234567
        if (digitsOnly.length === 10) {
            // Must not start with 0 or 1 (area code and exchange rules)
            return /^[2-9]\d{2}[2-9]\d{6}$/.test(digitsOnly);
        } else if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) {
            // Remove the leading 1 and validate the remaining 10 digits
            const withoutCountryCode = digitsOnly.slice(1);
            return /^[2-9]\d{2}[2-9]\d{6}$/.test(withoutCountryCode);
        }
        
        return false;
    }
    
    function showPhoneError(message) {
        hidePhoneError(); // Remove existing error first
        
        const phoneGroup = phoneInput.closest('.form-group');
        const errorDiv = document.createElement('div');
        errorDiv.className = 'phone-error';
        errorDiv.style.cssText = `
            color: #e74c3c;
            font-size: 0.85rem;
            margin-top: 5px;
            padding: 5px 10px;
            background: rgba(231, 76, 60, 0.1);
            border-radius: 4px;
            border-left: 3px solid #e74c3c;
        `;
        errorDiv.textContent = message;
        phoneGroup.appendChild(errorDiv);
    }
    
    function hidePhoneError() {
        const existingError = document.querySelector('.phone-error');
        if (existingError) {
            existingError.remove();
        }
    }

    function showLoading() {
        form.style.display = 'none';
        loadingSpinner.style.display = 'block';
        successMessage.style.display = 'none';
        errorMessage.style.display = 'none';
    }

    function showSuccess(result) {
        loadingSpinner.style.display = 'none';
        successMessage.style.display = 'block';
        
        successContent.innerHTML = `
            <div class="success-details">
                <p><strong>Welcome, ${result.user.name}!</strong></p>
                <p><strong>Account Number:</strong> ${result.user.fakeAccountNumber}</p>
                <p><strong>Demo Balance:</strong> $${parseFloat(result.user.fakeAccountBalance).toLocaleString()}</p>
                <p><strong>Phone:</strong> ${result.user.phoneNumber}</p>
                ${result.user.loanApplicationStatus !== 'None' ? `<p><strong>Loan Status:</strong> ${result.user.loanApplicationStatus}</p>` : ''}
                ${result.user.fraudScenario ? '<p><strong>Fraud Scenario:</strong> ✅ Enabled</p>' : ''}
            </div>
            <div class="demo-number">
                <p><strong>📞 Demo Call Number:</strong> <a href="tel:${result.demoNumber || '+1-XXX-XXX-XXXX'}">${result.demoNumber || 'Will be provided via SMS'}</a></p>
            </div>
        `;
    }

    function showError(message) {
        loadingSpinner.style.display = 'none';
        errorMessage.style.display = 'block';
        errorContent.textContent = message;
    }

    // Function to show the form again (called by retry button)
    window.showForm = function() {
        form.style.display = 'block';
        loadingSpinner.style.display = 'none';
        successMessage.style.display = 'none';
        errorMessage.style.display = 'none';
    };

    // Form validation styling
    const inputs = form.querySelectorAll('input[required]');
    inputs.forEach(input => {
        input.addEventListener('blur', function() {
            if (this.value.trim() === '') {
                this.style.borderColor = '#e74c3c';
            } else {
                this.style.borderColor = '#27ae60';
            }
        });

        input.addEventListener('input', function() {
            if (this.style.borderColor === '#e74c3c' && this.value.trim() !== '') {
                this.style.borderColor = '#27ae60';
            }
        });
    });

    // Add some interactive feedback
    const scenarios = document.querySelectorAll('.scenario');
    scenarios.forEach(scenario => {
        scenario.addEventListener('click', function() {
            // Highlight the scenario briefly
            this.style.background = 'rgba(255, 255, 255, 0.2)';
            setTimeout(() => {
                this.style.background = 'rgba(255, 255, 255, 0.1)';
            }, 200);
        });
    });

    // Auto-focus first input
    setTimeout(() => {
        const firstInput = document.getElementById('phoneNumber');
        if (firstInput) {
            firstInput.focus();
        }
    }, 500);
});

// Utility functions for demo
function formatCurrency(amount) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD'
    }).format(amount);
}

function formatPhoneNumber(phone) {
    // Format phone number for display
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length === 11 && cleaned.startsWith('1')) {
        return `+1 (${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7)}`;
    }
    return phone;
}
