SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @subjectID VARCHAR(50) = 'EP00821121';
DECLARE @wmDatabase SYSNAME = N'WM';
DECLARE @employeeExists BIT = 0;
DECLARE @employeeSql NVARCHAR(MAX);

IF DB_ID(@wmDatabase) IS NULL
  THROW 51000, 'WM database not found. Set @wmDatabase before running.', 1;

SET @employeeSql = N'
  IF EXISTS (
    SELECT 1 FROM ' + QUOTENAME(@wmDatabase) + N'.dbo.Employee
    WHERE EmployeeID = @subjectID
  ) SET @employeeExists = 1;';

EXEC sys.sp_executesql
  @employeeSql,
  N'@subjectID VARCHAR(50), @employeeExists BIT OUTPUT',
  @subjectID,
  @employeeExists OUTPUT;

IF @employeeExists = 0
  THROW 51000, 'Bootstrap admin is not a valid employee.', 1;

BEGIN TRANSACTION;

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
