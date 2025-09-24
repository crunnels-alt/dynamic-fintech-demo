-- Sample users with realistic fintech demo data
INSERT INTO users (phone_number, name, company_name, fake_account_balance, fake_account_number, loan_application_status, fraud_scenario) VALUES
('+12345678901', 'Sarah Johnson', 'Johnson Tech Solutions', 125000.50, 'ACC-2024-001', 'approved', false),
('+12345678902', 'Michael Chen', 'Chen Digital Marketing', 75000.25, 'ACC-2024-002', 'pending', false),
('+12345678903', 'Emma Rodriguez', 'Rodriguez Consulting', 200000.00, 'ACC-2024-003', 'under_review', false),
('+12345678904', 'James Wilson', 'Wilson Enterprises', 50000.75, 'ACC-2024-004', 'approved', false),
('+12345678905', 'Lisa Thompson', 'Thompson Creative Agency', 15000.00, 'ACC-2024-005', 'rejected', true),
('+12345678906', 'David Lee', 'Lee Manufacturing', 300000.45, 'ACC-2024-006', 'approved', false),
('+12345678907', 'Maria Garcia', 'Garcia Import/Export', 85000.30, 'ACC-2024-007', 'pending', false),
('+12345678908', 'Robert Brown', 'Brown Construction', 175000.80, 'ACC-2024-008', 'approved', false),
('+12345678909', 'Jennifer Davis', 'Davis Financial Planning', 95000.60, 'ACC-2024-009', 'under_review', false),
('+12345678910', 'Thomas Miller', 'Miller Logistics', 45000.20, 'ACC-2024-010', 'rejected', true);

-- Sample loan applications
INSERT INTO loan_applications (user_id, loan_type, loan_amount, status, next_step, assigned_officer) VALUES
(1, 'equipment_purchase', 50000.00, 'approved', 'Funding disbursement scheduled', 'Alex Rodriguez'),
(2, 'working_capital', 25000.00, 'pending', 'Awaiting credit verification', 'Jessica Chang'),
(3, 'business_expansion', 100000.00, 'under_review', 'Financial document review in progress', 'Marcus Johnson'),
(4, 'inventory_financing', 30000.00, 'approved', 'Final approval pending', 'Alex Rodriguez'),
(5, 'marketing_loan', 15000.00, 'rejected', 'Credit score insufficient - reapply in 90 days', 'Emily Davis'),
(6, 'real_estate', 150000.00, 'approved', 'Collateral verification complete', 'Ryan Thompson'),
(7, 'technology_upgrade', 40000.00, 'pending', 'Business plan assessment required', 'Jessica Chang'),
(8, 'vehicle_purchase', 75000.00, 'approved', 'Insurance documentation needed', 'Alex Rodriguez'),
(9, 'working_capital', 35000.00, 'under_review', 'Risk assessment in progress', 'Marcus Johnson'),
(10, 'equipment_repair', 20000.00, 'rejected', 'Fraud risk detected - account flagged', 'Emily Davis');

-- Sample transactions
INSERT INTO transactions (user_id, transaction_id, description, amount, transaction_type, merchant, category) VALUES
(1, 'TXN-2024-001', 'Office rent payment', -2500.00, 'debit', 'Downtown Properties LLC', 'rent'),
(1, 'TXN-2024-002', 'Client payment - Project Alpha', 15000.00, 'credit', 'TechCorp Industries', 'income'),
(1, 'TXN-2024-003', 'Software licenses', -850.00, 'debit', 'Microsoft Corporation', 'software'),
(2, 'TXN-2024-004', 'Marketing campaign costs', -1200.00, 'debit', 'Google Ads', 'marketing'),
(2, 'TXN-2024-005', 'Marketing services revenue', 8500.00, 'credit', 'Local Business Group', 'income'),
(3, 'TXN-2024-006', 'Consultant fees', -5000.00, 'debit', 'Strategy Plus Consulting', 'consulting'),
(3, 'TXN-2024-007', 'Consulting project payment', 25000.00, 'credit', 'Enterprise Solutions Inc', 'income'),
(4, 'TXN-2024-008', 'Inventory purchase', -3200.00, 'debit', 'Wholesale Supply Co', 'inventory'),
(4, 'TXN-2024-009', 'Product sales', 12000.00, 'credit', 'Regional Retailers', 'income'),
(5, 'TXN-2024-010', 'Bank fees', -150.00, 'debit', 'First National Bank', 'fees'),
(5, 'TXN-2024-011', 'Freelance project', 2500.00, 'credit', 'Creative Studios LLC', 'income'),
(6, 'TXN-2024-012', 'Equipment maintenance', -8000.00, 'debit', 'Industrial Maintenance Pro', 'maintenance'),
(6, 'TXN-2024-013', 'Manufacturing order', 45000.00, 'credit', 'Global Manufacturing Corp', 'income'),
(7, 'TXN-2024-014', 'Shipping costs', -2200.00, 'debit', 'International Freight LLC', 'shipping'),
(7, 'TXN-2024-015', 'Export sales', 18000.00, 'credit', 'European Distributors', 'income'),
(8, 'TXN-2024-016', 'Material costs', -4500.00, 'debit', 'Building Materials Direct', 'materials'),
(8, 'TXN-2024-017', 'Construction project payment', 28000.00, 'credit', 'City Development Authority', 'income'),
(9, 'TXN-2024-018', 'Professional development', -800.00, 'debit', 'Financial Training Institute', 'education'),
(9, 'TXN-2024-019', 'Financial planning fees', 9500.00, 'credit', 'Retirement Solutions Group', 'income'),
(10, 'TXN-2024-020', 'Fuel and maintenance', -1800.00, 'debit', 'Fleet Services Plus', 'vehicle'),
(10, 'TXN-2024-021', 'Delivery services', 7200.00, 'credit', 'Regional Commerce Network', 'income');

-- Sample officers for loan processing
INSERT INTO officers (name, phone_number, department, email, specialization) VALUES
('Alex Rodriguez', '+15551234567', 'underwriting', 'alex.rodriguez@dynamicfintech.com', 'business_loans'),
('Jessica Chang', '+15551234568', 'underwriting', 'jessica.chang@dynamicfintech.com', 'small_business'),
('Marcus Johnson', '+15551234569', 'risk_assessment', 'marcus.johnson@dynamicfintech.com', 'fraud_detection'),
('Emily Davis', '+15551234570', 'fraud_prevention', 'emily.davis@dynamicfintech.com', 'compliance'),
('Ryan Thompson', '+15551234571', 'underwriting', 'ryan.thompson@dynamicfintech.com', 'real_estate');