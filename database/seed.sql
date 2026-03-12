-- ── Users ────────────────────────────────────────────────────────
INSERT INTO `User` (`id`, `email`, `name`, `passwordHash`, `role`, `createdAt`, `updatedAt`) VALUES
  (UUID(), 'admin@kinderCore.local', 'Admin', '$2b$10$uszdSztnMT1.7fsxuDr5G.cOCR5PB1.DfMQ.hSGVeTYf2lwI4ysCO', 'ADMIN', NOW(), NOW()),
  (UUID(), 'staff@kinderCore.local', 'Staff', '$2b$10$AcjygauFsSurMWmPX//DsOGh/9nyI6w01tD6la/uj.zGsxMcue5x6', 'STAFF', NOW(), NOW());

-- ── System Settings ───────────────────────────────────────────────
INSERT INTO `SystemSetting` (`id`, `key`, `value`, `description`, `updatedAt`) VALUES
  (UUID(), 'whatsapp_template', '"Hi, this is Ten Toes Preschool. Thanks for your enquiry for {{childName}}. Would you like to arrange a school visit?"', 'WhatsApp message template. Use {{childName}} as placeholder.', NOW()),
  (UUID(), 'appointment_duration_minutes', '30', 'Default appointment duration in minutes.', NOW()),
  (UUID(), 'appointment_lead_time_hours', '2', 'Hours ahead to schedule appointment from now.', NOW()),
  (UUID(), 'kinder_address', '"Bukit Indah, Johor Bahru"', 'Kindergarten address used in Google Calendar events.', NOW()),
  (UUID(), 'lost_reasons', '["Transportation","Operating Hours","Distance","Enrolled other school","Fee too expensive","Special Need","Class Full","Didn\'t reply","Under Age","Didn\'t attend the enquiry"]', 'Dropdown options for marking a lead as Lost.', NOW()),
  (UUID(), 'onboarding_tasks', '["Create parents group (format: Year_ClassName_ChildrenName)","Send welcome message (shortcut: newparentswelcome)","Send registration link (shortcut: newparentsregistration)","Enroll student to app (New enrollment => raw lead => enrolled)","Send Checklist for Completed Registration (shortcut: newparentsregdone)","Assign student to a class and add tag","Send App Invitation Link","Ask Parents to Set Up the Ten Toes App (shortcut: newparentsapp)","Send Checklist for Completed App Setup (shortcut: newparentsappdone)","Send invoice to new parents","Ask Parents to Join the Facebook Group (shortcut: newparentsfb)","Add Parents to the Facebook Group"]', 'Checklist of tasks to complete when onboarding a new student.', NOW());

-- ── Packages ──────────────────────────────────────────────────────
INSERT INTO `Package` (`id`, `year`, `programme`, `age`, `name`, `price`, `updatedAt`) VALUES
  (UUID(), 2026, 'Half Day', 2, '2026 Half Day (2Y)', NULL, NOW()),
  (UUID(), 2026, 'Half Day', 3, '2026 Half Day (3Y)', NULL, NOW()),
  (UUID(), 2026, 'Half Day', 4, '2026 Half Day (4Y)', NULL, NOW()),
  (UUID(), 2026, 'Half Day', 5, '2026 Half Day (5Y)', NULL, NOW()),
  (UUID(), 2026, 'Half Day', 6, '2026 Half Day (6Y)', NULL, NOW()),
  (UUID(), 2026, 'Full Day', 2, '2026 Full Day (2Y)', NULL, NOW()),
  (UUID(), 2026, 'Full Day', 3, '2026 Full Day (3Y)', NULL, NOW()),
  (UUID(), 2026, 'Full Day', 4, '2026 Full Day (4Y)', NULL, NOW()),
  (UUID(), 2026, 'Full Day', 5, '2026 Full Day (5Y)', NULL, NOW()),
  (UUID(), 2026, 'Full Day', 6, '2026 Full Day (6Y)', NULL, NOW()),
  (UUID(), 2026, 'Half Day + Enrichment', 2, '2026 Half Day + Enrichment (2Y)', NULL, NOW()),
  (UUID(), 2026, 'Half Day + Enrichment', 3, '2026 Half Day + Enrichment (3Y)', NULL, NOW()),
  (UUID(), 2026, 'Half Day + Enrichment', 4, '2026 Half Day + Enrichment (4Y)', NULL, NOW()),
  (UUID(), 2026, 'Half Day + Enrichment', 5, '2026 Half Day + Enrichment (5Y)', NULL, NOW()),
  (UUID(), 2026, 'Half Day + Enrichment', 6, '2026 Half Day + Enrichment (6Y)', NULL, NOW()),
  (UUID(), 2027, 'Half Day', 2, '2027 Half Day (2Y)', NULL, NOW()),
  (UUID(), 2027, 'Half Day', 3, '2027 Half Day (3Y)', NULL, NOW()),
  (UUID(), 2027, 'Half Day', 4, '2027 Half Day (4Y)', NULL, NOW()),
  (UUID(), 2027, 'Half Day', 5, '2027 Half Day (5Y)', NULL, NOW()),
  (UUID(), 2027, 'Half Day', 6, '2027 Half Day (6Y)', NULL, NOW()),
  (UUID(), 2027, 'Full Day', 2, '2027 Full Day (2Y)', NULL, NOW()),
  (UUID(), 2027, 'Full Day', 3, '2027 Full Day (3Y)', NULL, NOW()),
  (UUID(), 2027, 'Full Day', 4, '2027 Full Day (4Y)', NULL, NOW()),
  (UUID(), 2027, 'Full Day', 5, '2027 Full Day (5Y)', NULL, NOW()),
  (UUID(), 2027, 'Full Day', 6, '2027 Full Day (6Y)', NULL, NOW()),
  (UUID(), 2027, 'Half Day + Enrichment', 2, '2027 Half Day + Enrichment (2Y)', NULL, NOW()),
  (UUID(), 2027, 'Half Day + Enrichment', 3, '2027 Half Day + Enrichment (3Y)', NULL, NOW()),
  (UUID(), 2027, 'Half Day + Enrichment', 4, '2027 Half Day + Enrichment (4Y)', NULL, NOW()),
  (UUID(), 2027, 'Half Day + Enrichment', 5, '2027 Half Day + Enrichment (5Y)', NULL, NOW()),
  (UUID(), 2027, 'Half Day + Enrichment', 6, '2027 Half Day + Enrichment (6Y)', NULL, NOW());
