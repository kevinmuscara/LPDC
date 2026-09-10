const getUniqueUsers = (rows = []) => {
  const uniqueUsers = new Map();

  for (const user of rows) {
    const staffId = String(user["Staff ID#"] || "").trim();

    if (!staffId) {
      continue;
    }

    if (!uniqueUsers.has(staffId)) {
      uniqueUsers.set(staffId, {
        firstName: user["First Name"] || "",
        lastName: user["Last Name"] || "",
        staffId,
        emailAddress: user["Email Address"] || "",
        buildings: [],
      });
    }

    const existingUser = uniqueUsers.get(staffId);
    const buildingValue = String(user["Building"] || "").trim();

    if (buildingValue && !existingUser.buildings.includes(buildingValue)) {
      existingUser.buildings.push(buildingValue);
    }

    existingUser.firstName = existingUser.firstName || user["First Name"] || "";
    existingUser.lastName = existingUser.lastName || user["Last Name"] || "";
    existingUser.emailAddress = existingUser.emailAddress || user["Email Address"] || "";
  }

  return Array.from(uniqueUsers.values()).map(({ buildings, ...user }) => ({
    firstName: user.firstName,
    lastName: user.lastName,
    building: buildings.join(", "),
    staffId: user.staffId,
    emailAddress: user.emailAddress,
  }));
};

const getReviewStatusColumnName = () => {
  return String(process.env.PD_REVIEW_STATUS_COLUMN || "PD Review Status").trim() || "PD Review Status";
};

const getApproverColumnName = () => {
  return String(process.env.PD_APPROVER_COLUMN || "Approver").trim() || "Approver";
};

const getDenialReasonColumnName = () => {
  return String(process.env.PD_DENIAL_REASON_COLUMN || "Denial Reason").trim() || "Denial Reason";
};

const parseSheetRows = (values = []) => {
  if (!values || values.length === 0) {
    return [];
  }

  const [headerRow, ...dataRows] = values;
  const headers = headerRow.map((header) => String(header || "").trim());

  return dataRows
    .filter((row) => row.some((cell) => String(cell || "").trim() !== ""))
    .map((row, index) => {
      const entry = {
        __headers: headers,
        __sheetRowNumber: index + 2,
      };

      headers.forEach((header, headerIndex) => {
        entry[header] = row[headerIndex] ?? "";
      });

      return entry;
    });
};

const loadSpreadsheetRows = async (
  accessToken,
  spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID,
  range = process.env.GOOGLE_SHEET_RANGE || "Sheet1"
) => {
  if (!accessToken) {
    throw new Error("Google access token is missing. Please sign in again.");
  }

  if (!spreadsheetId) {
    throw new Error("GOOGLE_SPREADSHEET_ID is not configured in your .env file.");
  }

  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?majorDimension=ROWS`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`Failed to load Google Sheets data: ${response.status} ${responseText}`);
  }

  const payload = await response.json();

  return parseSheetRows(payload.values || []);
};

const getColumnLetter = (columnNumber) => {
  let result = "";
  let current = columnNumber;

  while (current > 0) {
    const remainder = (current - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    current = Math.floor((current - 1) / 26);
  }

  return result;
};

const ensureColumn = async ({
  accessToken,
  spreadsheetId,
  range,
  columnName,
  columnLabel,
}) => {
  if (!accessToken) {
    throw new Error("Google access token is missing. Please sign in again.");
  }

  if (!spreadsheetId) {
    throw new Error("GOOGLE_SPREADSHEET_ID is not configured in your .env file.");
  }

  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?majorDimension=ROWS`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`Failed to inspect Google Sheets headers: ${response.status} ${responseText}`);
  }

  const payload = await response.json();
  const values = payload.values || [];

  if (!values.length) {
    return;
  }

  const headers = (values[0] || []).map((header) => String(header || "").trim());

  if (headers.some((header) => header.toLowerCase() === columnName.toLowerCase())) {
    return;
  }

  const updateResponse = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(`${range}!A1:Z1`)}?valueInputOption=RAW`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        values: [headers.concat(columnLabel)],
      }),
    }
  );

  if (!updateResponse.ok) {
    const responseText = await updateResponse.text();
    throw new Error(`Failed to add ${columnLabel} column: ${updateResponse.status} ${responseText}`);
  }
};

const ensureReviewStatusColumn = async (
  accessToken,
  spreadsheetId,
  range = process.env.GOOGLE_SHEET_RANGE || "Sheet1"
) => {
  const reviewStatusColumnName = getReviewStatusColumnName();

  await ensureColumn({
    accessToken,
    spreadsheetId,
    range,
    columnName: reviewStatusColumnName,
    columnLabel: reviewStatusColumnName,
  });
};

const ensureApproverColumn = async (
  accessToken,
  spreadsheetId,
  range = process.env.GOOGLE_SHEET_RANGE || "Sheet1"
) => {
  const approverColumnName = getApproverColumnName();

  await ensureColumn({
    accessToken,
    spreadsheetId,
    range,
    columnName: approverColumnName,
    columnLabel: approverColumnName,
  });
};

const ensureDenialReasonColumn = async (
  accessToken,
  spreadsheetId,
  range = process.env.GOOGLE_SHEET_RANGE || "Sheet1"
) => {
  const denialReasonColumnName = getDenialReasonColumnName();

  await ensureColumn({
    accessToken,
    spreadsheetId,
    range,
    columnName: denialReasonColumnName,
    columnLabel: denialReasonColumnName,
  });
};

const updateReviewStatus = async ({
  accessToken,
  spreadsheetId,
  range = process.env.GOOGLE_SHEET_RANGE || "Sheet1",
  rowNumber,
  status,
  approverEmail,
  denialReason,
}) => {
  if (!accessToken) {
    throw new Error("Google access token is missing. Please sign in again.");
  }

  if (!spreadsheetId) {
    throw new Error("GOOGLE_SPREADSHEET_ID is not configured in your .env file.");
  }

  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?majorDimension=ROWS`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`Failed to load Google Sheets data: ${response.status} ${responseText}`);
  }

  const payload = await response.json();
  const values = payload.values || [];

  if (!values.length) {
    throw new Error("The spreadsheet is empty and cannot be updated.");
  }

  let headers = (values[0] || []).map((header) => String(header || "").trim());
  let reviewStatusColumnName = getReviewStatusColumnName();
  let reviewStatusColumnIndex = headers.findIndex((header) => header.toLowerCase() === reviewStatusColumnName.toLowerCase());

  if (reviewStatusColumnIndex === -1) {
    await ensureReviewStatusColumn(accessToken, spreadsheetId, range);

    const refreshedResponse = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?majorDimension=ROWS`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!refreshedResponse.ok) {
      const responseText = await refreshedResponse.text();
      throw new Error(`Failed to refresh Google Sheets headers: ${refreshedResponse.status} ${responseText}`);
    }

    const refreshedPayload = await refreshedResponse.json();
    const refreshedValues = refreshedPayload.values || [];

    if (!refreshedValues.length) {
      throw new Error("The spreadsheet is empty and cannot be updated.");
    }

    headers = (refreshedValues[0] || []).map((header) => String(header || "").trim());
    reviewStatusColumnIndex = headers.findIndex((header) => header.toLowerCase() === reviewStatusColumnName.toLowerCase());
  }

  if (reviewStatusColumnIndex === -1) {
    throw new Error(`Could not locate the ${reviewStatusColumnName} column in the sheet.`);
  }

  const statusColumnLetter = getColumnLetter(reviewStatusColumnIndex + 1);
  const statusCell = `${range}!${statusColumnLetter}${Number(rowNumber)}`;
  const normalizedStatus = String(status || "").trim();
  const statusValue = normalizedStatus === "pending" ? "" : normalizedStatus;

  const statusResponse = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(statusCell)}?valueInputOption=RAW`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        values: [[statusValue]],
      }),
    }
  );

  if (!statusResponse.ok) {
    const responseText = await statusResponse.text();
    throw new Error(`Failed to update review status: ${statusResponse.status} ${responseText}`);
  }

  const approverColumnName = getApproverColumnName();
  const approverColumnIndex = headers.findIndex((header) => header.toLowerCase() === approverColumnName.toLowerCase());

  if (approverColumnIndex !== -1) {
    const approverColumnLetter = getColumnLetter(approverColumnIndex + 1);
    const approverCell = `${range}!${approverColumnLetter}${Number(rowNumber)}`;
    const approverValue = ["approved", "denied"].includes(normalizedStatus)
      ? String(approverEmail || "").trim()
      : "";

    const approverResponse = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(approverCell)}?valueInputOption=RAW`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          values: [[approverValue]],
        }),
      }
    );

    if (!approverResponse.ok) {
      const responseText = await approverResponse.text();
      throw new Error(`Failed to update approver column: ${approverResponse.status} ${responseText}`);
    }
  }

  const denialReasonColumnName = getDenialReasonColumnName();
  const denialReasonColumnIndex = headers.findIndex((header) => header.toLowerCase() === denialReasonColumnName.toLowerCase());

  if (denialReasonColumnIndex !== -1) {
    const denialReasonColumnLetter = getColumnLetter(denialReasonColumnIndex + 1);
    const denialReasonCell = `${range}!${denialReasonColumnLetter}${Number(rowNumber)}`;
    const denialReasonValue = normalizedStatus === "denied" ? String(denialReason || "").trim() : "";

    const denialReasonResponse = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(denialReasonCell)}?valueInputOption=RAW`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          values: [[denialReasonValue]],
        }),
      }
    );

    if (!denialReasonResponse.ok) {
      const responseText = await denialReasonResponse.text();
      throw new Error(`Failed to update denial reason column: ${denialReasonResponse.status} ${responseText}`);
    }
  }
};

module.exports = {
  getUniqueUsers,
  loadSpreadsheetRows,
  ensureReviewStatusColumn,
  ensureApproverColumn,
  ensureDenialReasonColumn,
  updateReviewStatus,
  getReviewStatusColumnName,
  getApproverColumnName,
  getDenialReasonColumnName,
};