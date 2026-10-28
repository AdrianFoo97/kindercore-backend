
/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `AllowanceType` (
  `id` varchar(36) NOT NULL,
  `name` varchar(191) NOT NULL,
  `sortOrder` int NOT NULL DEFAULT '0',
  `createdAt` datetime(3) NOT NULL,
  `isDefault` tinyint(1) NOT NULL DEFAULT '0',
  `icon` varchar(50) NOT NULL DEFAULT 'gift',
  `isGuaranteed` tinyint(1) NOT NULL DEFAULT '1',
  `parentId` varchar(36) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `AuthRole` (
  `id` varchar(36) NOT NULL,
  `name` varchar(191) NOT NULL,
  `description` text,
  `sortOrder` int NOT NULL DEFAULT '0',
  `createdAt` datetime(3) NOT NULL,
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `AuthRoleModule` (
  `id` varchar(36) NOT NULL,
  `authRoleId` varchar(36) NOT NULL,
  `module` varchar(50) NOT NULL,
  `createdAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `AuthRoleModule_authRoleId_idx` (`authRoleId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `AuthRoleView` (
  `id` varchar(36) NOT NULL,
  `authRoleId` varchar(36) NOT NULL,
  `view` varchar(50) NOT NULL,
  `createdAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `AuthRoleView_authRoleId_idx` (`authRoleId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `AuthView` (
  `id` varchar(36) NOT NULL,
  `key` varchar(50) NOT NULL,
  `label` varchar(191) NOT NULL,
  `description` text,
  `createdAt` datetime(3) NOT NULL,
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `AuthView_key_uq` (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `AuthViewModule` (
  `id` varchar(36) NOT NULL,
  `authViewId` varchar(36) NOT NULL,
  `module` varchar(50) NOT NULL,
  `createdAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `AuthViewModule_authViewId_idx` (`authViewId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `BugReport` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `message` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `pageUrl` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `appVersion` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `reportedByUserId` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `reportedByName` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('OPEN','RESOLVED') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'OPEN',
  `createdAt` datetime(3) NOT NULL,
  `updatedAt` datetime(3) NOT NULL,
  `photoUrls` json DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `Candidate` (
  `id` varchar(36) NOT NULL,
  `submittedAt` datetime(3) NOT NULL,
  `fullName` varchar(191) NOT NULL,
  `phone` varchar(50) NOT NULL,
  `email` varchar(191) DEFAULT NULL,
  `dob` datetime(3) DEFAULT NULL,
  `gender` enum('MALE','FEMALE') DEFAULT NULL,
  `addressLocation` varchar(191) DEFAULT NULL,
  `positionId` varchar(10) DEFAULT NULL,
  `expectedSalary` float DEFAULT NULL,
  `availableFrom` datetime(3) DEFAULT NULL,
  `yearsExperience` int DEFAULT NULL,
  `currentEmployment` varchar(191) DEFAULT NULL,
  `qualification` text,
  `howDidYouKnow` varchar(191) DEFAULT NULL,
  `status` enum('NEW','CONTACTED','INTERVIEWING','PENDING_DECISION','OFFER_SENT','HIRED','REJECTED','TALENT_BANK') NOT NULL DEFAULT 'NEW',
  `statusChangedAt` datetime(3) DEFAULT NULL,
  `interviewStart` datetime(3) DEFAULT NULL,
  `interviewEnd` datetime(3) DEFAULT NULL,
  `interviewLocation` varchar(191) DEFAULT NULL,
  `interviewNotes` text,
  `interviewEventId` varchar(191) DEFAULT NULL,
  `interviewEventLink` text,
  `interviewCalendarId` varchar(191) DEFAULT NULL,
  `rejectionReason` text,
  `hiredAt` datetime(3) DEFAULT NULL,
  `notes` text,
  `adminNotes` text,
  `deletedAt` datetime(3) DEFAULT NULL,
  `commuteTime` enum('UNDER_15','MIN_15_30','MIN_30_45','MIN_45_60','OVER_60','WILL_MOVE') DEFAULT NULL,
  `desiredPosition` varchar(191) DEFAULT NULL,
  `preferredStartDate` datetime(3) DEFAULT NULL,
  `experienceRange` varchar(191) DEFAULT NULL,
  `qualificationOther` varchar(191) DEFAULT NULL,
  `resumePath` varchar(500) DEFAULT NULL,
  `resumeOriginalName` varchar(255) DEFAULT NULL,
  `careerGoals` text,
  `whyKindergartenTeacher` text,
  `salaryJustification` text,
  `isShortlisted` tinyint(1) NOT NULL DEFAULT '0',
  `submissionSource` varchar(32) DEFAULT NULL,
  `utmSource` varchar(191) DEFAULT NULL,
  `resumeUrl` text,
  `expectedSalaryMax` float DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_candidate_status` (`status`),
  KEY `idx_candidate_positionId` (`positionId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `CareerMission` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `positionId` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `title` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `category` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `difficulty` enum('BASIC','INTERMEDIATE','ADVANCED') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'BASIC',
  `evidenceRequirements` text COLLATE utf8mb4_unicode_ci,
  `required` tinyint(1) NOT NULL DEFAULT '1',
  `requiresApproval` tinyint(1) NOT NULL DEFAULT '1',
  `displayOrder` int NOT NULL DEFAULT '0',
  `deletedAt` datetime(3) DEFAULT NULL,
  `createdAt` datetime(3) NOT NULL,
  `updatedAt` datetime(3) NOT NULL,
  `whyItMatters` text COLLATE utf8mb4_unicode_ci,
  `highPriority` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `CareerMission_positionId_idx` (`positionId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `CareerRecord` (
  `id` varchar(36) NOT NULL,
  `teacherId` varchar(36) NOT NULL,
  `positionId` varchar(10) NOT NULL,
  `level` int NOT NULL DEFAULT '0',
  `effectiveDate` datetime(3) NOT NULL,
  `notes` text,
  `createdAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_teacher` (`teacherId`),
  KEY `idx_effective` (`teacherId`,`effectiveDate`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `Classroom` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `capacity` int DEFAULT NULL,
  `isActive` tinyint(1) NOT NULL DEFAULT '1',
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL,
  `startMinute` int DEFAULT NULL,
  `endMinute` int DEFAULT NULL,
  `daysOfWeek` json DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `Department` (
  `departmentId` varchar(20) NOT NULL,
  `name` varchar(191) NOT NULL,
  `sortOrder` int NOT NULL DEFAULT '0',
  `createdAt` datetime(3) NOT NULL,
  `updatedAt` datetime(3) NOT NULL,
  `hasCareerPath` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`departmentId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `GoogleConnection` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `accessToken` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `refreshToken` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `expiryDate` bigint NOT NULL,
  `scope` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `Lead` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `submittedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `childName` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `parentPhone` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `childDob` datetime(3) NOT NULL,
  `enrolmentYear` int NOT NULL,
  `status` enum('NEW','CONTACTED','APPOINTMENT_BOOKED','FOLLOW_UP','ENROLLED','LOST','REJECTED') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'NEW',
  `notes` text COLLATE utf8mb4_unicode_ci,
  `appointmentStart` datetime(3) DEFAULT NULL,
  `appointmentEnd` datetime(3) DEFAULT NULL,
  `googleEventId` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `googleEventLink` text COLLATE utf8mb4_unicode_ci,
  `appointmentCreatedByUserId` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `appointmentIsPlaceholder` tinyint(1) NOT NULL DEFAULT '0',
  `lostReason` text COLLATE utf8mb4_unicode_ci,
  `relationship` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `programme` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `preferredAppointmentTime` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `addressLocation` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `needsTransport` tinyint(1) DEFAULT NULL,
  `howDidYouKnow` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ctaSource` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `utmSource` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `leadTemperature` enum('COOL','WARM','HOT') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `deletedAt` datetime(3) DEFAULT NULL,
  `statusChangedAt` datetime(3) DEFAULT NULL,
  `attended` tinyint(1) NOT NULL DEFAULT '0',
  `isQualified` tinyint(1) NOT NULL DEFAULT '1',
  `visitOutcome` enum('ATTENDED','NO_SHOW') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `promoCode` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `Lead_submittedAt_idx` (`submittedAt`),
  KEY `Lead_parentPhone_idx` (`parentPhone`),
  KEY `Lead_status_idx` (`status`),
  KEY `Lead_appointmentCreatedByUserId_fkey` (`appointmentCreatedByUserId`),
  CONSTRAINT `Lead_appointmentCreatedByUserId_fkey` FOREIGN KEY (`appointmentCreatedByUserId`) REFERENCES `User` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `LeadLabel` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `color` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `createdAt` datetime(3) NOT NULL,
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `LeadLabel_name_uq` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `LeadLabelAssignment` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `leadId` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `labelId` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `createdAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `LeadLabelAssignment_lead_label_uq` (`leadId`,`labelId`),
  KEY `LeadLabelAssignment_labelId_idx` (`labelId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `LevelIncentive` (
  `id` varchar(36) NOT NULL,
  `positionId` varchar(10) NOT NULL,
  `level` int NOT NULL,
  `amount` float NOT NULL DEFAULT '0',
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_position_level` (`positionId`,`level`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `MarketingCampaign` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `code` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `startDate` datetime(3) NOT NULL,
  `endDate` datetime(3) NOT NULL,
  `createdAt` datetime(3) NOT NULL,
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `MarketingCampaign_code_uq` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `MissionCategory` (
  `code` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `achievementName` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `icon` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `color` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `sortOrder` int NOT NULL DEFAULT '0',
  `createdAt` datetime(3) NOT NULL,
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `OperatingCost` (
  `id` varchar(36) NOT NULL,
  `year` int NOT NULL,
  `month` int NOT NULL,
  `categoryId` varchar(36) NOT NULL,
  `amount` float NOT NULL DEFAULT '0',
  `notes` text,
  `createdAt` datetime(3) NOT NULL,
  `updatedAt` datetime(3) NOT NULL,
  `includeInOperatingCostSum` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_oc_year_month_category` (`year`,`month`,`categoryId`),
  KEY `idx_oc_year` (`year`),
  KEY `idx_oc_categoryId` (`categoryId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `OperatingCostCategory` (
  `id` varchar(36) NOT NULL,
  `name` varchar(191) NOT NULL,
  `groupId` varchar(36) NOT NULL,
  `sortOrder` int NOT NULL DEFAULT '0',
  `defaultAmount` float DEFAULT NULL,
  `monthlyBudget` float DEFAULT NULL,
  `createdAt` datetime(3) NOT NULL,
  `updatedAt` datetime(3) NOT NULL,
  `includeInOperatingCostSum` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`),
  KEY `idx_oc_cat_groupId` (`groupId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `OperatingCostCategoryGroup` (
  `id` varchar(36) NOT NULL,
  `name` varchar(191) NOT NULL,
  `sortOrder` int NOT NULL DEFAULT '0',
  `createdAt` datetime(3) NOT NULL,
  `updatedAt` datetime(3) NOT NULL,
  `isProtected` tinyint(1) NOT NULL DEFAULT '0',
  `includeInOperatingCostSum` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ocg_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `Package` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `year` int NOT NULL,
  `programme` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `age` int NOT NULL,
  `name` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `price` double DEFAULT NULL,
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `Package_year_programme_age_key` (`year`,`programme`,`age`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `PlannerTask` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `category` enum('TEACHING','ADMIN','DUTY','BREAK','OTHER') COLLATE utf8mb4_unicode_ci NOT NULL,
  `color` varchar(7) COLLATE utf8mb4_unicode_ci NOT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `defaultDuration` int NOT NULL DEFAULT '30',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `PointsEarningRule` (
  `id` varchar(36) NOT NULL,
  `icon` varchar(40) NOT NULL,
  `label` varchar(191) NOT NULL,
  `description` text,
  `amount` int NOT NULL,
  `category` varchar(20) NOT NULL DEFAULT 'other',
  `active` tinyint(1) NOT NULL DEFAULT '1',
  `createdAt` datetime(3) NOT NULL,
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `PointsRewardItem` (
  `id` varchar(36) NOT NULL,
  `icon` varchar(40) NOT NULL,
  `label` varchar(191) NOT NULL,
  `sub` varchar(191) DEFAULT NULL,
  `cost` int NOT NULL,
  `stock` enum('in','limited','out') NOT NULL DEFAULT 'in',
  `category` varchar(20) NOT NULL DEFAULT 'other',
  `active` tinyint(1) NOT NULL DEFAULT '1',
  `createdAt` datetime(3) NOT NULL,
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `PointsTransaction` (
  `id` varchar(36) NOT NULL,
  `teacherId` varchar(36) NOT NULL,
  `kind` enum('earned','redeemed') NOT NULL,
  `label` varchar(191) NOT NULL,
  `delta` int NOT NULL,
  `balanceAfter` int NOT NULL,
  `date` varchar(10) NOT NULL,
  `ruleId` varchar(36) DEFAULT NULL,
  `redemptionId` varchar(36) DEFAULT NULL,
  `note` text,
  `createdBy` varchar(191) DEFAULT NULL,
  `createdAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_pt_teacher` (`teacherId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `Position` (
  `positionId` varchar(10) NOT NULL,
  `name` varchar(191) NOT NULL,
  `titleWeight` int NOT NULL DEFAULT '0',
  `basicSalary` float NOT NULL DEFAULT '0',
  `maxLevel` int NOT NULL DEFAULT '5',
  `sortOrder` int NOT NULL DEFAULT '0',
  `createdAt` datetime(3) NOT NULL,
  `updatedAt` datetime(3) NOT NULL,
  `inCareerProgression` tinyint(1) NOT NULL DEFAULT '1',
  `badgeUrl` varchar(500) DEFAULT NULL,
  `starColor` varchar(20) DEFAULT NULL,
  `description` text,
  `roleFocus` varchar(191) DEFAULT NULL,
  `maxSalary` float DEFAULT NULL,
  `departmentId` varchar(20) DEFAULT NULL,
  `authRoleId` varchar(36) DEFAULT NULL,
  PRIMARY KEY (`positionId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `RewardRedemption` (
  `id` varchar(36) NOT NULL,
  `teacherId` varchar(36) NOT NULL,
  `rewardId` varchar(36) NOT NULL,
  `label` varchar(191) NOT NULL,
  `icon` varchar(40) NOT NULL,
  `pointsSpent` int NOT NULL,
  `status` enum('redeemed','pending','delivered') NOT NULL DEFAULT 'redeemed',
  `voucherCode` varchar(60) DEFAULT NULL,
  `redemptionCode` varchar(40) NOT NULL,
  `instructions` text,
  `redeemedDate` varchar(10) NOT NULL,
  `createdAt` datetime(3) NOT NULL,
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_rr_teacher` (`teacherId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `SavedTimetable` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `blocks` json NOT NULL,
  `createdAt` datetime(3) NOT NULL,
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ScheduleBlock` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `weekDate` datetime(3) NOT NULL,
  `dayOfWeek` int NOT NULL,
  `startMinute` int NOT NULL,
  `durationMinutes` int NOT NULL DEFAULT '30',
  `teacherId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `subjectId` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `taskId` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `classroomId` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `notes` text COLLATE utf8mb4_unicode_ci,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL,
  `assignedTeacherIds` json DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `ScheduleBlock_weekDate_idx` (`weekDate`),
  KEY `ScheduleBlock_teacherId_idx` (`teacherId`),
  KEY `ScheduleBlock_subjectId_fkey` (`subjectId`),
  KEY `ScheduleBlock_taskId_fkey` (`taskId`),
  KEY `ScheduleBlock_classroomId_fkey` (`classroomId`),
  CONSTRAINT `ScheduleBlock_classroomId_fkey` FOREIGN KEY (`classroomId`) REFERENCES `Classroom` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `ScheduleBlock_subjectId_fkey` FOREIGN KEY (`subjectId`) REFERENCES `Subject` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `ScheduleBlock_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `PlannerTask` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `SopCategory` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `color` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `displayOrder` int NOT NULL DEFAULT '0',
  `deletedAt` datetime(3) DEFAULT NULL,
  `createdAt` datetime(3) NOT NULL,
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `SopObservation` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `teacherId` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `sopTemplateId` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('PENDING_TRAINER','PENDING_ASSESSOR','CERTIFIED') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PENDING_TRAINER',
  `trainerName` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `trainerAt` datetime(3) DEFAULT NULL,
  `assessorName` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `assessorAt` datetime(3) DEFAULT NULL,
  `notes` text COLLATE utf8mb4_unicode_ci,
  `createdAt` datetime(3) NOT NULL,
  `updatedAt` datetime(3) NOT NULL,
  `trainerId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `SopObservation_teacherId_idx` (`teacherId`),
  KEY `SopObservation_sopTemplateId_idx` (`sopTemplateId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `SopObservationStepResult` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `observationId` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `sopStepId` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `passed` enum('PASS','FAIL','NA') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'NA',
  `note` text COLLATE utf8mb4_unicode_ci,
  `createdAt` datetime(3) NOT NULL,
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `SopObservationStepResult_observationId_idx` (`observationId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `SopSection` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `displayOrder` int NOT NULL DEFAULT '0',
  `deletedAt` datetime(3) DEFAULT NULL,
  `createdAt` datetime(3) NOT NULL,
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `SopStep` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `sopTemplateId` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `section` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `title` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `detail` text COLLATE utf8mb4_unicode_ci,
  `displayOrder` int NOT NULL DEFAULT '0',
  `deletedAt` datetime(3) DEFAULT NULL,
  `createdAt` datetime(3) NOT NULL,
  `updatedAt` datetime(3) NOT NULL,
  `linkedTemplateId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `SopStep_sopTemplateId_idx` (`sopTemplateId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `SopTemplate` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `title` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `goal` text COLLATE utf8mb4_unicode_ci,
  `displayOrder` int NOT NULL DEFAULT '0',
  `deletedAt` datetime(3) DEFAULT NULL,
  `createdAt` datetime(3) NOT NULL,
  `updatedAt` datetime(3) NOT NULL,
  `videoUrl` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `currentVersion` int NOT NULL DEFAULT '1',
  `icon` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'faClipboardCheck',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `SopTemplateCategory` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `sopTemplateId` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `categoryId` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `createdAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `SopTemplateCategory_sopTemplateId_idx` (`sopTemplateId`),
  KEY `SopTemplateCategory_categoryId_idx` (`categoryId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `SopTemplateRevision` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `sopTemplateId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `title` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `goal` text COLLATE utf8mb4_unicode_ci,
  `videoUrl` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `stepsJson` json NOT NULL,
  `categoryIdsJson` json DEFAULT NULL,
  `status` enum('DRAFT','PENDING','APPROVED','REJECTED') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PENDING',
  `versionNumber` int DEFAULT NULL,
  `proposedByUserId` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `proposedByName` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `reviewedByUserId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `reviewedByName` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `reviewedAt` datetime(3) DEFAULT NULL,
  `reviewNote` text COLLATE utf8mb4_unicode_ci,
  `createdAt` datetime(3) NOT NULL,
  `updatedAt` datetime(3) NOT NULL,
  `icon` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `SopTemplateRevision_sopTemplateId_idx` (`sopTemplateId`),
  KEY `SopTemplateRevision_status_idx` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `SpeechClip` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `studentId` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `text` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `voiceId` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `filePath` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `sampleRate` int NOT NULL DEFAULT '16000',
  `createdAt` datetime(3) NOT NULL,
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `SpeechClip_studentId_uq` (`studentId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `Student` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `leadId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `enrolmentYear` int NOT NULL,
  `enrolmentMonth` int NOT NULL,
  `packageId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `enrolledAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `startDate` datetime(3) DEFAULT NULL,
  `notes` text COLLATE utf8mb4_unicode_ci,
  `monthlyFee` float DEFAULT NULL,
  `feeOverridden` tinyint(1) NOT NULL DEFAULT '0',
  `ageOffset` int NOT NULL DEFAULT '0',
  `onboardingProgress` json DEFAULT NULL,
  `onboardingCompleted` tinyint(1) NOT NULL DEFAULT '0',
  `withdrawnAt` datetime(3) DEFAULT NULL,
  `withdrawReason` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `childName` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `childDob` datetime(3) DEFAULT NULL,
  `rfid` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `Student_rfid_uq` (`rfid`),
  KEY `Student_packageId_fkey` (`packageId`),
  KEY `Student_leadId_idx` (`leadId`),
  CONSTRAINT `Student_leadId_fkey` FOREIGN KEY (`leadId`) REFERENCES `Lead` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `Student_packageId_fkey` FOREIGN KEY (`packageId`) REFERENCES `Package` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `StudentAttendance` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `studentId` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `scannedAt` datetime(3) NOT NULL,
  `source` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'rfid',
  `notes` text COLLATE utf8mb4_unicode_ci,
  `createdAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `StudentAttendance_studentId_idx` (`studentId`),
  KEY `StudentAttendance_scannedAt_idx` (`scannedAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `StudentEnrollment` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `studentId` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `packageId` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `monthlyFee` float NOT NULL,
  `feeOverridden` tinyint(1) NOT NULL DEFAULT '0',
  `startDate` datetime(3) NOT NULL,
  `endDate` datetime(3) DEFAULT NULL,
  `reason` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `createdAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `StudentEnrollment_studentId_idx` (`studentId`),
  KEY `StudentEnrollment_period_idx` (`studentId`,`startDate`,`endDate`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `Subject` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `color` varchar(7) COLLATE utf8mb4_unicode_ci NOT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `lessonsPerWeek` int DEFAULT NULL,
  `defaultDuration` int DEFAULT '60',
  `classLessons` json DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `SystemSetting` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `key` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `value` json NOT NULL,
  `description` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `SystemSetting_key_key` (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `Teacher` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `color` varchar(7) COLLATE utf8mb4_unicode_ci NOT NULL,
  `isActive` tinyint(1) NOT NULL DEFAULT '1',
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL,
  `allowedSubjectIds` json DEFAULT NULL,
  `allowedClassroomIds` json DEFAULT NULL,
  `workStartMinute` int DEFAULT NULL,
  `workEndMinute` int DEFAULT NULL,
  `workDays` json DEFAULT NULL,
  `positionId` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `level` int DEFAULT '0',
  `attendanceAllowance` float DEFAULT '0',
  `kpiAllowance` float DEFAULT '0',
  `isFixedSalary` tinyint(1) NOT NULL DEFAULT '0',
  `fixedSalaryAmount` float DEFAULT NULL,
  `resignedAt` datetime(3) DEFAULT NULL,
  `phone` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `employmentType` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT 'full-time',
  `otherAllowance` float DEFAULT '0',
  `qualificationAllowance` float DEFAULT '0',
  `salaryType` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT 'formula',
  `hourlyRate` float DEFAULT NULL,
  `excludeFromProfitShare` tinyint(1) NOT NULL DEFAULT '0',
  `overrideProfitShareWeight` tinyint(1) NOT NULL DEFAULT '0',
  `customProfitShareWeight` float DEFAULT NULL,
  `hasEpf` tinyint(1) NOT NULL DEFAULT '1',
  `hasSocso` tinyint(1) NOT NULL DEFAULT '1',
  `hasEis` tinyint(1) NOT NULL DEFAULT '1',
  `pointsLastSeenAt` datetime(3) DEFAULT NULL,
  `excludeFromStaffCost` tinyint(1) NOT NULL DEFAULT '0',
  `dob` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `TeacherAllowance` (
  `id` varchar(36) NOT NULL,
  `teacherId` varchar(36) NOT NULL,
  `allowanceTypeId` varchar(36) NOT NULL,
  `amount` float NOT NULL DEFAULT '0',
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_teacher_type` (`teacherId`,`allowanceTypeId`),
  KEY `idx_teacher` (`teacherId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `TeacherAppraisal` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `teacherId` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `year` int NOT NULL,
  `month` int NOT NULL,
  `score` float NOT NULL,
  `notes` text COLLATE utf8mb4_unicode_ci,
  `evaluatedBy` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `createdAt` datetime(3) NOT NULL,
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `TeacherAppraisal_period_uq` (`teacherId`,`year`,`month`),
  KEY `TeacherAppraisal_teacherId_idx` (`teacherId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `TeacherMissionFocus` (
  `teacherId` varchar(36) NOT NULL,
  `missionId` varchar(36) NOT NULL,
  `setAt` varchar(10) NOT NULL,
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`teacherId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `TeacherMissionProgress` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `teacherId` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `missionId` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('PENDING','IN_PROGRESS','UNDER_REVIEW','COMPLETED') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PENDING',
  `evidenceCount` int NOT NULL DEFAULT '0',
  `evidenceTotal` int NOT NULL DEFAULT '0',
  `notes` text COLLATE utf8mb4_unicode_ci,
  `startedAt` datetime(3) DEFAULT NULL,
  `submittedAt` datetime(3) DEFAULT NULL,
  `approvedAt` datetime(3) DEFAULT NULL,
  `approvedBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `createdAt` datetime(3) NOT NULL,
  `updatedAt` datetime(3) NOT NULL,
  `isTargeted` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `TMP_teacher_mission_uq` (`teacherId`,`missionId`),
  KEY `TMP_teacherId_idx` (`teacherId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `TeacherRewardGoal` (
  `teacherId` varchar(36) NOT NULL,
  `rewardId` varchar(36) NOT NULL,
  `setAt` varchar(10) NOT NULL,
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`teacherId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `User` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `email` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `passwordHash` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `role` enum('SUPERADMIN','ADMIN','USER') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'USER',
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL,
  `inviteToken` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `inviteExpiresAt` datetime(3) DEFAULT NULL,
  `activated` tinyint(1) NOT NULL DEFAULT '1',
  `teacherId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `authRoleId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `User_email_key` (`email`),
  UNIQUE KEY `User_teacherId_uq` (`teacherId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

