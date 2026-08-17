SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRAN;

DELETE FROM dbo.CustomerReward;
DELETE FROM dbo.ExpPointLedger;
DELETE FROM dbo.Attendance;
DELETE FROM dbo.StaffQrCode;
DELETE FROM dbo.CustomerProgress;

DBCC CHECKIDENT ('dbo.CustomerReward', RESEED, 0);
DBCC CHECKIDENT ('dbo.ExpPointLedger', RESEED, 0);
DBCC CHECKIDENT ('dbo.Attendance', RESEED, 0);
DBCC CHECKIDENT ('dbo.StaffQrCode', RESEED, 0);

COMMIT;
