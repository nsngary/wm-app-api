SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @subjectID VARCHAR(50) = 'EP00821121';

BEGIN TRANSACTION;

IF NOT EXISTS (
  SELECT 1
  FROM dbo.Employee
  WHERE EmployeeID = @subjectID
)
BEGIN
  ROLLBACK TRANSACTION;
  THROW 51000, 'Bootstrap admin is not a valid employee.', 1;
END;

IF EXISTS (
  SELECT 1
  FROM dbo.StaffAccess
  WHERE subjectID = @subjectID
    AND accessLevel = N'admin'
)
BEGIN
  COMMIT TRANSACTION;
  RETURN;
END;

IF EXISTS (
  SELECT 1
  FROM dbo.StaffAccess
  WHERE accessLevel = N'admin'
)
BEGIN
  ROLLBACK TRANSACTION;
  THROW 51001, 'An admin already exists; bootstrap refused.', 1;
END;

MERGE dbo.StaffAccess WITH (HOLDLOCK) AS target
USING (SELECT @subjectID AS subjectID) AS source
ON target.subjectID = source.subjectID
WHEN MATCHED THEN
  UPDATE SET
    accessLevel = N'admin',
    grantedBySubjectID = @subjectID,
    grantedAt = SYSDATETIMEOFFSET(),
    updatedAt = SYSDATETIMEOFFSET()
WHEN NOT MATCHED THEN
  INSERT (subjectID, accessLevel, grantedBySubjectID)
  VALUES (@subjectID, N'admin', @subjectID);

COMMIT TRANSACTION;
