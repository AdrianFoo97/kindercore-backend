-- Seed the Position.description column with job-scope copy taken from
-- the org chart. Matches on `name` (case-insensitive) so it works
-- regardless of what positionId the admin assigned. Run once; idempotent.

UPDATE Position
SET description = 'Overall School Management:\nOversee all school operations, make strategic decisions, set policies, and ensure alignment with the school''s vision and goals.'
WHERE LOWER(name) = 'principal';

UPDATE Position
SET description = 'School Management Support:\nAssist the Principal, handle significant decisions, consult the principal for major strategic issues, and support policy implementation.'
WHERE LOWER(name) = 'shadow principal';

UPDATE Position
SET description = 'Daily Operations Oversight:\nManage daily school operations, make decisions on operational issues and staff management, and inform the Principal or Shadow Principal about significant actions.'
WHERE LOWER(name) = 'supervisor';

UPDATE Position
SET description = 'Instructional Leadership:\nLead instructional practices, make decisions on lesson planning and curriculum, and ensure alignment with school standards.'
WHERE LOWER(name) IN ('senior teacher', 'senior ei');

UPDATE Position
SET description = 'Classroom Instruction:\nHandle classroom instruction, seek approval from Supervisor or Principal for significant decisions, and implement approved strategies.'
WHERE LOWER(name) IN ('junior teacher', 'junior ei');

UPDATE Position
SET description = 'Classroom Support:\nSupport classroom activities, follow authority structure of Junior Teacher, and require approval for actions affecting classroom operations.'
WHERE LOWER(name) IN ('assistant teacher', 'assistant ei');

-- Verify
SELECT positionId, name, LEFT(description, 60) AS preview
FROM Position
ORDER BY sortOrder;
