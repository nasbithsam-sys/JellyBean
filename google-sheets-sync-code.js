/**
 * =========================================================================
 * JELLYBEAN CRM -> GOOGLE SHEETS LIVE SYNC SCRIPT
 * Target Spreadsheet: https://docs.google.com/spreadsheets/d/1JOW5XGEsDa-ewm7Xh4BIzru8_QU_z4MFFXTZ9ZvZodE/edit
 * =========================================================================
 * 
 * COLUMNS STRUCTURE:
 * 1.  Lead Created Date & Time (Column A - VERY FIRST)
 * 2.  Customer Name
 * 3.  Customer Phone No
 * 4.  Area
 * 5.  Service
 * 6.  Status
 * 7.  Number Name
 * 8.  Context
 * 9.  Exact Customer Requirement
 * 10. Compose
 * 11. Assigned To              (Column K - THIRD LAST COLUMN)
 * 12. Important                (Column L - SECOND LAST COLUMN)
 * 13. Lead ID                  (Column M - LAST COLUMN / Hidden)
 */

const CONFIG = {
  SUPABASE_URL: "YOUR_SUPABASE_URL",
  SUPABASE_KEY: "YOUR_SUPABASE_SERVICE_ROLE_OR_ANON_KEY",
  
  SHEET_NEW_TO_CONTACT: "New to Contact",
  SHEET_PINNED_IMPORTANT: "Pinned Important",
  
  HEADERS: [
    "Lead Created Date & Time", // 1 (Column A)
    "Customer Name",            // 2 (Column B)
    "Customer Phone No",        // 3 (Column C)
    "Area",                     // 4 (Column D)
    "Service",                  // 5 (Column E)
    "Status",                   // 6 (Column F)
    "Number Name",              // 7 (Column G)
    "Context",                  // 8 (Column H)
    "Exact Customer Requirement",// 9 (Column I)
    "Compose",                  // 10 (Column J)
    "Assigned To",              // 11 (Column K - THIRD LAST COLUMN)
    "Important",                // 12 (Column L - SECOND LAST COLUMN)
    "Lead ID"                   // 13 (Column M - LAST COLUMN)
  ]
};

/**
 * Creates custom CRM menu in Google Sheets
 */
function onOpen() {
  SpreadsheetApp.getUi().createMenu("⚡ Jellybean CRM")
    .addItem("Format & Setup Sheets", "setupSheets")
    .addItem("Pull All Leads from Supabase", "syncAllLeadsFromSupabase")
    .addToUi();
}

/**
 * Creates and formats the two required sheets
 */
function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const targetSheets = [CONFIG.SHEET_NEW_TO_CONTACT, CONFIG.SHEET_PINNED_IMPORTANT];

  targetSheets.forEach((name, idx) => {
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name, idx);
    }
    
    // Set headers
    sheet.getRange(1, 1, 1, CONFIG.HEADERS.length).setValues([CONFIG.HEADERS]);
    
    // Style headers
    const headerRange = sheet.getRange(1, 1, 1, CONFIG.HEADERS.length);
    headerRange.setFontWeight("bold");
    headerRange.setFontSize(10);
    headerRange.setBackground(name === CONFIG.SHEET_PINNED_IMPORTANT ? "#fee2e2" : "#e0e7ff");
    headerRange.setFontColor("#0f172a");
    headerRange.setVerticalAlignment("middle");
    sheet.setRowHeight(1, 38);
    sheet.setFrozenRows(1);
    
    // Column widths
    sheet.setColumnWidth(1, 175); // Lead Created Date & Time (Column A)
    sheet.setColumnWidth(2, 180); // Customer Name
    sheet.setColumnWidth(3, 160); // Customer Phone No
    sheet.setColumnWidth(4, 140); // Area
    sheet.setColumnWidth(5, 130); // Service
    sheet.setColumnWidth(6, 130); // Status
    sheet.setColumnWidth(7, 140); // Number Name
    sheet.setColumnWidth(8, 220); // Context
    sheet.setColumnWidth(9, 240); // Exact Customer Requirement
    sheet.setColumnWidth(10, 220); // Compose
    sheet.setColumnWidth(11, 160); // Assigned To (Third last column)
    sheet.setColumnWidth(12, 130); // Important (Second last column)
    sheet.setColumnWidth(13, 110); // Lead ID (Last column)
  });

  const defaultSheet = ss.getSheetByName("Sheet1");
  if (defaultSheet && ss.getSheets().length > 1) {
    try { ss.deleteSheet(defaultSheet); } catch (e) {}
  }

  SpreadsheetApp.getActiveSpreadsheet().toast("Sheets formatted! Third last column is 'Assigned To'", "Jellybean CRM");
}

/**
 * Fetches staff profile names for assigned_to UUIDs
 */
function fetchAssigneeMap() {
  if (!CONFIG.SUPABASE_URL || CONFIG.SUPABASE_URL === "YOUR_SUPABASE_URL") return {};
  try {
    const url = `${CONFIG.SUPABASE_URL}/rest/v1/profiles?select=user_id,full_name,email`;
    const response = UrlFetchApp.fetch(url, {
      method: "GET",
      headers: {
        "apikey": CONFIG.SUPABASE_KEY,
        "Authorization": `Bearer ${CONFIG.SUPABASE_KEY}`
      },
      muteHttpExceptions: true
    });
    const profiles = JSON.parse(response.getContentText());
    const map = {};
    if (Array.isArray(profiles)) {
      profiles.forEach(p => {
        map[p.user_id] = p.full_name || p.email || "Staff";
      });
    }
    return map;
  } catch (e) {
    return {};
  }
}

/**
 * Transforms a CRM Lead object into 13 columns array
 */
function leadToRow(lead, assigneeMap) {
  // Resolve staff name cleanly for "Assigned To"
  let assignedName = "Unassigned";
  if (lead.assigned_to_name && lead.assigned_to_name !== "Unassigned") {
    assignedName = lead.assigned_to_name;
  } else if (lead.assigned_to && assigneeMap && assigneeMap[lead.assigned_to]) {
    assignedName = assigneeMap[lead.assigned_to];
  } else if (lead.assigned_to && typeof lead.assigned_to === "string" && !lead.assigned_to.includes("-")) {
    assignedName = lead.assigned_to;
  }

  const area = lead.main_area || lead.sub_area || lead.area || "";
  const phone = lead.customer_number_2 
    ? `${lead.customer_number || ''}, ${lead.customer_number_2}` 
    : (lead.customer_number || '');
    
  const exactRequirement = lead.requirement_1 || lead.requirement_2 || lead.post_text || lead.context || lead.exact_requirement || "";
  
  let createdDate = lead.created_at || lead.assigned_at || "";
  if (createdDate && !isNaN(Date.parse(createdDate))) {
    createdDate = Utilities.formatDate(new Date(createdDate), Session.getScriptTimeZone() || "GMT+5", "yyyy-MM-dd HH:mm:ss");
  }

  let importantStatus = "No";
  if (lead.pinned_important === true) {
    importantStatus = "Pinned Important";
  } else if (lead.is_important === true) {
    importantStatus = "Important";
  }

  return [
    createdDate,                  // 1. Lead Created Date & Time (Column A)
    lead.customer_name || "",     // 2. Customer Name
    phone,                        // 3. Customer Phone No
    area,                         // 4. Area
    lead.service || "",           // 5. Service
    lead.cs_status === "new" ? "New to contact" : (lead.cs_status || "New to contact"), // 6. Status
    lead.number_name || "",       // 7. Number Name
    lead.context || "",           // 8. Context
    exactRequirement,             // 9. Exact Customer Requirement
    lead.marketing_notes || "",   // 10. Compose
    assignedName,                 // 11. Assigned To (THIRD LAST COLUMN)
    importantStatus,              // 12. Important (SECOND LAST COLUMN)
    lead.id || ""                 // 13. Lead ID (LAST COLUMN)
  ];
}

/**
 * Initial bulk sync from Supabase
 */
function syncAllLeadsFromSupabase() {
  if (!CONFIG.SUPABASE_URL || CONFIG.SUPABASE_URL === "YOUR_SUPABASE_URL") {
    SpreadsheetApp.getUi().alert("Please fill in your SUPABASE_URL and SUPABASE_KEY at the top of the script.");
    return;
  }

  setupSheets();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetNew = ss.getSheetByName(CONFIG.SHEET_NEW_TO_CONTACT);
  const sheetPinned = ss.getSheetByName(CONFIG.SHEET_PINNED_IMPORTANT);
  
  const assigneeMap = fetchAssigneeMap();

  const url = `${CONFIG.SUPABASE_URL}/rest/v1/qualified_leads?cs_status=eq.new&order=created_at.desc&select=*`;
  const response = UrlFetchApp.fetch(url, {
    method: "GET",
    headers: {
      "apikey": CONFIG.SUPABASE_KEY,
      "Authorization": `Bearer ${CONFIG.SUPABASE_KEY}`
    },
    muteHttpExceptions: true
  });
  
  const leads = JSON.parse(response.getContentText());
  if (!Array.isArray(leads)) {
    SpreadsheetApp.getUi().alert("Error connecting to Supabase: " + response.getContentText());
    return;
  }

  if (sheetNew.getLastRow() > 1) {
    sheetNew.getRange(2, 1, sheetNew.getLastRow() - 1, CONFIG.HEADERS.length).clearContent();
  }
  if (sheetPinned.getLastRow() > 1) {
    sheetPinned.getRange(2, 1, sheetPinned.getLastRow() - 1, CONFIG.HEADERS.length).clearContent();
  }

  const unpinnedNewRows = [];
  const pinnedRows = [];

  leads.forEach(lead => {
    const row = leadToRow(lead, assigneeMap);
    if (lead.pinned_important === true) {
      pinnedRows.push(row);
    } else {
      unpinnedNewRows.push(row);
    }
  });

  if (unpinnedNewRows.length > 0) {
    sheetNew.getRange(2, 1, unpinnedNewRows.length, CONFIG.HEADERS.length).setValues(unpinnedNewRows);
  }
  if (pinnedRows.length > 0) {
    sheetPinned.getRange(2, 1, pinnedRows.length, CONFIG.HEADERS.length).setValues(pinnedRows);
  }

  SpreadsheetApp.getActiveSpreadsheet().toast(
    `Synced ${unpinnedNewRows.length} unpinned 'New to Contact' leads and ${pinnedRows.length} 'Pinned Important' leads!`,
    "Success"
  );
}

/**
 * Main Webhook Receiver
 */
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const eventType = payload.type || payload.action;
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheetNew = ss.getSheetByName(CONFIG.SHEET_NEW_TO_CONTACT) || ss.insertSheet(CONFIG.SHEET_NEW_TO_CONTACT);
    const sheetPinned = ss.getSheetByName(CONFIG.SHEET_PINNED_IMPORTANT) || ss.insertSheet(CONFIG.SHEET_PINNED_IMPORTANT);

    if (eventType === "PING") {
      return jsonResponse({ status: "ok", message: "Connected to Google Sheets successfully!" });
    }

    if (eventType === "BULK_SYNC") {
      setupSheets();
      const leads = payload.leads || [];
      
      if (sheetNew.getLastRow() > 1) {
        sheetNew.getRange(2, 1, sheetNew.getLastRow() - 1, CONFIG.HEADERS.length).clearContent();
      }
      if (sheetPinned.getLastRow() > 1) {
        sheetPinned.getRange(2, 1, sheetPinned.getLastRow() - 1, CONFIG.HEADERS.length).clearContent();
      }

      const unpinnedNewRows = [];
      const pinnedRows = [];

      leads.forEach(l => {
        const row = leadToRow(l);
        if (l.pinned_important === true) {
          pinnedRows.push(row);
        } else {
          unpinnedNewRows.push(row);
        }
      });

      if (unpinnedNewRows.length > 0) {
        sheetNew.getRange(2, 1, unpinnedNewRows.length, CONFIG.HEADERS.length).setValues(unpinnedNewRows);
      }
      if (pinnedRows.length > 0) {
        sheetPinned.getRange(2, 1, pinnedRows.length, CONFIG.HEADERS.length).setValues(pinnedRows);
      }

      return jsonResponse({
        status: "success",
        unpinnedCount: unpinnedNewRows.length,
        pinnedCount: pinnedRows.length
      });
    }

    const rec = payload.record || payload.lead || {};
    const oldRec = payload.old_record || payload.old_lead || {};
    const leadId = rec.id || oldRec.id;

    if (!leadId) {
      return jsonResponse({ error: "Missing lead ID" }, 400);
    }

    if (eventType === "DELETE") {
      deleteLeadRow(sheetNew, leadId);
      deleteLeadRow(sheetPinned, leadId);
      return jsonResponse({ success: true, action: "DELETED", leadId });
    }

    const assigneeMap = fetchAssigneeMap();

    if (eventType === "UPDATE") {
      const isStillNew = (rec.cs_status === "new");

      if (!isStillNew) {
        deleteLeadRow(sheetNew, leadId);
        deleteLeadRow(sheetPinned, leadId);
        return jsonResponse({ success: true, action: "REMOVED_DUE_TO_STATUS_CHANGE" });
      }

      const rowValues = leadToRow(rec, assigneeMap);

      if (rec.pinned_important === true) {
        deleteLeadRow(sheetNew, leadId);
        upsertLeadRow(sheetPinned, leadId, rowValues);
      } else {
        deleteLeadRow(sheetPinned, leadId);
        upsertLeadRow(sheetNew, leadId, rowValues);
      }

      return jsonResponse({ success: true, action: "UPDATED" });
    }

    if (eventType === "INSERT") {
      if (rec.cs_status !== "new") {
        return jsonResponse({ message: "Ignored (not 'new' status)" });
      }

      const rowValues = leadToRow(rec, assigneeMap);

      if (rec.pinned_important === true) {
        insertLeadAtTop(sheetPinned, rowValues);
      } else {
        insertLeadAtTop(sheetNew, rowValues);
      }

      return jsonResponse({ success: true, action: "INSERTED" });
    }

    return jsonResponse({ message: "No action performed" });
  } catch (err) {
    return jsonResponse({ error: err.toString() }, 500);
  }
}

function insertLeadAtTop(sheet, rowValues) {
  sheet.insertRowBefore(2);
  sheet.getRange(2, 1, 1, rowValues.length).setValues([rowValues]);
}

function upsertLeadRow(sheet, leadId, rowValues) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    insertLeadAtTop(sheet, rowValues);
    return;
  }

  const ids = sheet.getRange(2, 13, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(leadId)) {
      const rowIndex = i + 2;
      sheet.getRange(rowIndex, 1, 1, rowValues.length).setValues([rowValues]);
      return;
    }
  }

  insertLeadAtTop(sheet, rowValues);
}

function deleteLeadRow(sheet, leadId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const ids = sheet.getRange(2, 13, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(leadId)) {
      const rowIndex = i + 2;
      sheet.deleteRow(rowIndex);
      return;
    }
  }
}

function jsonResponse(data, code) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
