-- Seed default Operating Cost categories (run once after migration)
-- Administrative group (sortOrder 10..190, step 10)
INSERT INTO OperatingCostCategory (id, name, groupName, sortOrder, createdAt, updatedAt) VALUES
  (UUID(), 'Tel, Fax, H/P and Internet', 'Administrative', 10,  NOW(3), NOW(3)),
  (UUID(), 'Printing & Stationery',      'Administrative', 20,  NOW(3), NOW(3)),
  (UUID(), 'Postage & Courier',          'Administrative', 30,  NOW(3), NOW(3)),
  (UUID(), 'Toll & Parking',             'Administrative', 40,  NOW(3), NOW(3)),
  (UUID(), 'Petrol',                     'Administrative', 50,  NOW(3), NOW(3)),
  (UUID(), 'Upkeep of Motor Vehicle',    'Administrative', 60,  NOW(3), NOW(3)),
  (UUID(), 'Upkeep of Office Equipment', 'Administrative', 70,  NOW(3), NOW(3)),
  (UUID(), 'Upkeep of Office',           'Administrative', 80,  NOW(3), NOW(3)),
  (UUID(), 'Rental',                     'Administrative', 90,  NOW(3), NOW(3)),
  (UUID(), 'Water Filter',               'Administrative', 100, NOW(3), NOW(3)),
  (UUID(), 'Road Tax & Insurance',       'Administrative', 110, NOW(3), NOW(3)),
  (UUID(), 'Assessment & Quit Rent',     'Administrative', 120, NOW(3), NOW(3)),
  (UUID(), 'License Fee / Stamping Fee', 'Administrative', 130, NOW(3), NOW(3)),
  (UUID(), 'Waste Collection',           'Administrative', 140, NOW(3), NOW(3)),
  (UUID(), 'Bank Charges',               'Administrative', 150, NOW(3), NOW(3)),
  (UUID(), 'Depreciation of Fixed Assets','Administrative',160, NOW(3), NOW(3)),
  (UUID(), 'Secretary Fee',              'Administrative', 170, NOW(3), NOW(3)),
  (UUID(), 'Cleaning Expenses',          'Administrative', 180, NOW(3), NOW(3)),
  (UUID(), 'Bank Interest',              'Administrative', 190, NOW(3), NOW(3));

INSERT INTO OperatingCostCategory (id, name, groupName, sortOrder, createdAt, updatedAt) VALUES
  (UUID(), 'Event Fee',        'Sales & Distribution', 10, NOW(3), NOW(3)),
  (UUID(), 'Training Fee',     'Sales & Distribution', 20, NOW(3), NOW(3)),
  (UUID(), 'Advertisement',    'Sales & Distribution', 30, NOW(3), NOW(3)),
  (UUID(), 'Travelling',       'Sales & Distribution', 40, NOW(3), NOW(3)),
  (UUID(), 'Transportation',   'Sales & Distribution', 50, NOW(3), NOW(3)),
  (UUID(), 'Subscription Fee', 'Sales & Distribution', 60, NOW(3), NOW(3)),
  (UUID(), 'Photoshoot',       'Sales & Distribution', 70, NOW(3), NOW(3));
