-- Convert every existing Friend Referral lead into Word of Mouth.
-- Run after backing up the leads table. Preview first, then commit.
--
-- Different vintages of the data carry different referral labels —
-- newer submissions use 'Friend Referral', older Google-Forms-routed
-- ones store the bilingual label 'Friend 通过朋友介绍', and a handful
-- of fully-Chinese rows just say '朋友介绍'. We catch all three plus
-- any future variant that contains the marker substring.

-- 1. Preview rows that will be touched.
SELECT id, childName, howDidYouKnow, notes
FROM leads
WHERE howDidYouKnow IN ('Friend Referral', 'Friend 通过朋友介绍', '朋友介绍')
   OR howDidYouKnow LIKE '%朋友介绍%'
   OR howDidYouKnow LIKE '%Friend%Referral%';

-- 2. Reassign the source.
UPDATE leads
SET howDidYouKnow = 'Word of Mouth'
WHERE howDidYouKnow IN ('Friend Referral', 'Friend 通过朋友介绍', '朋友介绍')
   OR howDidYouKnow LIKE '%朋友介绍%'
   OR howDidYouKnow LIKE '%Friend%Referral%';

-- 3. Verify — these old labels should now return zero rows.
SELECT howDidYouKnow, COUNT(*) AS n
FROM leads
WHERE howDidYouKnow IN ('Friend Referral', 'Friend 通过朋友介绍', '朋友介绍')
GROUP BY howDidYouKnow;

-- 4. Sample the converted rows.
SELECT id, childName, howDidYouKnow, notes
FROM leads
WHERE howDidYouKnow = 'Word of Mouth'
ORDER BY submittedAt DESC
LIMIT 50;
