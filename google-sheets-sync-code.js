/**
 * =========================================================================
 * JELLYBEAN CRM -> GOOGLE SHEETS LIVE SYNC SCRIPT
 * Target Spreadsheet: https://docs.google.com/spreadsheets/d/1JOW5XGEsDa-ewm7Xh4BIzru8_QU_z4MFFXTZ9ZvZodE/edit
 * =========================================================================
 * 
 * INSTRUCTIONS:
 * 1. In your Google Sheet, open: Extensions -> Apps Script.
 * 2. Delete any existing code, paste this ENTIRE code, and click Save (Floppy icon).
 * 3. Update the SUPABASE_URL and SUPABASE_ANON_OR_SERVICE_KEY below (from your CRM .env).
 * 4. Click 'Deploy' -> 'New deployment' -> Select type 'Web app'.
 *    - Execute as: "Me"
 *    - Who has access: "Anyone"
 *    - Copy the Web App URL!
 * 5. In your Google Sheet, reload the page. You will see a new menu: "Jellybean CRM".
 *    Click: "Jellybean CRM" -> "Setup Sheets & Run Initial Sync" to pull all existing leads!
 * 6. Set up a Supabase Database Webhook (or CRM hook) to the Web App URL for live auto-updates.
 */

// --- CONFIGURATION ---
const CONFIG = {
  // Replace these with your CRM Supabase credentials (from your .env file)
  SUPABASE_URL: "YOUR_SUPABASE_URL", // e.g. "https://xyzcompany.supabase.co"
  SUPABASE_KEY: "YOUR_SUPABASE_SERVICE_ROLE_OR_ANON_KEY",
  
  SHEET_NEW_TO_CONTACT: "New to Contact",
  SHEET_PINNED_IMPORTANT: "Pinned Important",
  
  HEADERS: [
    "Customer Name",
    "Customer Phone No",
    "Area",
    "Service",
    "Status",
    "Number Name",
    "Context",
    "Exact Customer Requirement",
    "Compose",
    "Assigned To",
    "Lead Created Date & Time",
    "Important",
    "Lead ID" // Hidden or reference column for precise updates/deletes
  ]
};

/**
 * Creates custom menu in Google Sheets on open
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu("Jellybean CRM")
    .addItem("Format / Setup Sheets", "setupSheets")
    .addItem("Pull All Current Leads from Supabase", "syncAllLeadsFromSupabase")
    .addToUi();
}

/**
 * Setup the two requested sheets with exact formatting and headers
 */
function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  const sheetNames = [CONFIG.SHEET_NEW_TO_CONTACT, CONFIG.SHEET_PINNED_IMPORTANT];
  
  sheetNames.forEach((name, idx) => {
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
    headerRange.setFontColor("#1e293b");
    headerRange.setVerticalAlignment("middle");
    sheet.setRowHeight(1, 36);
    
    // Freeze top row
    sheet.setFrozenRows(1);
    
    // Set column widths
    sheet.setColumnWidth(1, 180); // Customer Name
    sheet.setColumnWidth(2, 160); // Customer Phone No
    sheet.setColumnWidth(3, 140); // Area
    sheet.setColumnWidth(4, 140); // Service
    sheet.setColumnWidth(5, 130); // Status
    sheet.setColumnWidth(6, 140); // Number Name
    sheet.setColumnWidth(7, 220); // Context
    sheet.setColumnWidth(8, 220); // Exact Requirement
    sheet.setColumnWidth(9, 220); // Compose
    sheet.setColumnWidth(10, 150); // Assigned To
    sheet.setColumnWidth(11, 170); // Date & Time
    sheet.setColumnWidth(12, 120); // Important
    sheet.setColumnWidth(13, 110); // Lead ID (Column M)
  });
  
  // Remove or hide default 'Sheet1' if present so only the two requested sheets exist
  const defaultSheet = ss.getSheetByName("Sheet1");
  if (defaultSheet && ss.getSheets().length > 1) {
    try { ss.deleteSheet(defaultSheet); } catch (e) {}
  }
  
  SpreadsheetApp.getActiveSpreadsheet().toast("Sheets formatted successfully!", "Jellybean CRM");
}

/**
 * Format a lead object into the 13 columns array
 */
function leadToRow(lead, assigneeMap) {
  const assignedName = lead.assigned_to 
    ? (assigneeMap && assigneeMap[lead.assigned_to] ? assigneeMap[lead.assigned_to] : lead.assigned_to)
    : "Unassigned";

  const area = lead.main_area || lead.sub_area || "";
  const phone = lead.customer_number_2 
    ? `${lead.customer_number || ''}, ${lead.customer_number_2}` 
    : (lead.customer_number || '');
    
  const exactRequirement = lead.requirement_1 || lead.requirement_2 || lead.post_text || lead.context || "";
  
  const createdDate = lead.created_at || lead.assigned_at
    ? Utilities.formatDate(new Date(lead.created_at || lead.assigned_at), Session.getScriptTimeZone() || "GMT+5", "yyyy-MM-dd HH:mm:ss")
    : "";

  let importantStatus = "No";
  if (lead.pinned_important) {
    importantStatus = "Pinned Important";
  } else if (lead.is_important) {
    importantStatus = "Important";
  }

  return [
    lead.customer_name || "",
    phone,
    area,
    lead.service || "",
    lead.cs_status === "new" ? "New to contact" : (lead.cs_status || "New to contact"),
    lead.number_name || "",
    lead.context || "",
    exactRequirement,
    lead.marketing_notes || "",
    assignedName,
    createdDate,
    importantStatus,
    lead.id || ""
  ];
}

/**
 * Helper to fetch profiles/users for assignee name resolution
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
 * Initial bulk sync: fetches all "New to Contact" leads from Supabase and populates both sheets
 */
function syncAllLeadsFromSupabase() {
  if (!CONFIG.SUPABASE_URL || CONFIG.SUPABASE_URL === "YOUR_SUPABASE_URL") {
    SpreadsheetApp.getUi().alert("Please set your SUPABASE_URL and SUPABASE_KEY at the top of the script first.");
    return;
  }

  setupSheets();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetNew = ss.getSheetByName(CONFIG.SHEET_NEW_TO_CONTACT);
  const sheetPinned = ss.getSheetByName(CONFIG.SHEET_PINNED_IMPORTANT);
  
  // Fetch profiles for names
  const assigneeMap = fetchAssigneeMap();

  // Fetch leads with status = 'new' (New to contact), ordered by created_at DESC (recent at top)
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
    SpreadsheetApp.getUi().alert("Error fetching leads from Supabase: " + response.getContentText());
    return;
  }

  // Clear existing content (keep header)
  if (sheetNew.getLastRow() > 1) {
    sheetNew.getRange(2, 1, sheetNew.getLastRow() - 1, CONFIG.HEADERS.length).clearContent();
  }
  if (sheetPinned.getLastRow() > 1) {
    sheetPinned.getRange(2, 1, sheetPinned.getLastRow() - 1, CONFIG.HEADERS.length).clearContent();
  }

  const newRows = [];
  const pinnedRows = [];

  leads.forEach(lead => {
    const row = leadToRow(lead, assigneeMap);
    newRows.push(row);
    if (lead.pinned_important === true) {
      pinnedRows.push(row);
    }
  });

  if (newRows.length > 0) {
    sheetNew.getRange(2, 1, newRows.length, CONFIG.HEADERS.length).setValues(newRows);
  }
  if (pinnedRows.length > 0) {
    sheetPinned.getRange(2, 1, pinnedRows.length, CONFIG.HEADERS.length).setValues(pinnedRows);
  }

  SpreadsheetApp.getActiveSpreadsheet().toast(`Synced ${newRows.length} 'New to Contact' leads and ${pinnedRows.length} 'Pinned Important' leads!`, "Success");
}

/**
 * Webhook handler for Realtime updates, inserts, and deletes
 * Handles Supabase Webhook payload format as well as custom JSON
 */
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const eventType = payload.type || payload.action; // 'INSERT', 'UPDATE', 'DELETE'
    const record = payload.record || payload.lead || payload.data;
    const oldRecord = payload.old_record || payload.old_lead;
    
    const leadId = (record && record.id) || (oldRecord && oldRecord.id);
    if (!leadId && eventType !== "FULL_SYNC") {
      return jsonResponse({ error: "Missing lead ID" }, 400);
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheetNew = ss.getSheetByName(CONFIG.SHEET_NEW_TO_CONTACT) || ss.insertSheet(CONFIG.SHEET_NEW_TO_CONTACT);
    const sheetPinned = ss.getSheetByName(CONFIG.SHEET_PINNED_IMPORTANT) || ss.insertSheet(CONFIG.SHEET_PINNED_IMPORTANT);
    
    const assigneeMap = fetchAssigneeMap();

    // -------------------------------------------------------------
    // ACTION: DELETE
    // -------------------------------------------------------------
    if (eventType === "DELETE") {
      deleteLeadRow(sheetNew, leadId);
      deleteLeadRow(sheetPinned, leadId);
      return jsonResponse({ success: true, action: "DELETED", leadId });
    }

    // -------------------------------------------------------------
    // ACTION: UPDATE
    // -------------------------------------------------------------
    if (eventType === "UPDATE") {
      const isStillNew = record.cs_status === "new";
      
      if (!isStillNew) {
        // Status changed to something else (e.g. called, converted, closed).
        // Remove from both "New to Contact" and "Pinned Important" sheets!
        deleteLeadRow(sheetNew, leadId);
        deleteLeadRow(sheetPinned, leadId);
        return jsonResponse({ success: true, action: "REMOVED_DUE_TO_STATUS_CHANGE", leadId });
      }

      const rowValues = leadToRow(record, assigneeMap);

      // 1. Update in "New to Contact"
      upsertLeadRow(sheetNew, leadId, rowValues);

      // 2. Handle "Pinned Important"
      if (record.pinned_important === true) {
        upsertLeadRow(sheetPinned, leadId, rowValues);
      } else {
        // Unpinned -> delete from pinned sheet
        deleteLeadRow(sheetPinned, leadId);
      }

      return jsonResponse({ success: true, action: "UPDATED", leadId });
    }

    // -------------------------------------------------------------
    // ACTION: INSERT
    // -------------------------------------------------------------
    if (eventType === "INSERT") {
      if (record.cs_status !== "new") {
        return jsonResponse({ message: "Ignored (not 'new' status)" });
      }

      const rowValues = leadToRow(record, assigneeMap);

      // Insert at Row 2 (TOP of the sheet, recent on top!)
      insertLeadAtTop(sheetNew, rowValues);

      if (record.pinned_important === true) {
        insertLeadAtTop(sheetPinned, rowValues);
      }

      return jsonResponse({ success: true, action: "INSERTED", leadId });
    }

    return jsonResponse({ message: "No action performed" });
  } catch (err) {
    return jsonResponse({ error: err.toString() }, 500);
  }
}

/**
 * Inserts a lead row immediately below the header (Row 2), shifting existing rows down
 */
function insertLeadAtTop(sheet, rowValues) {
  sheet.insertRowBefore(2);
  sheet.getRange(2, 1, 1, rowValues.length).setValues([rowValues]);
}

/**
 * Finds and updates an existing row by Lead ID (Column 13 / M), or inserts at top if not found
 */
function upsertLeadRow(sheet, leadId, rowValues) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    insertLeadAtTop(sheet, rowValues);
    return;
  }

  // Column 13 is "Lead ID"
  const ids = sheet.getRange(2, 13, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(leadId)) {
      const rowIndex = i + 2;
      sheet.getRange(rowIndex, 1, 1, rowValues.length).setValues([rowValues]);
      return;
    }
  }

  // If not found in sheet, insert at top
  insertLeadAtTop(sheet, rowValues);
}

/**
 * Deletes a row completely from the sheet, automatically moving below rows UP
 */
function deleteLeadRow(sheet, leadId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const ids = sheet.getRange(2, 13, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(leadId)) {
      const rowIndex = i + 2;
      // deleteRow removes the row and moves all rows below it up!
      sheet.deleteRow(rowIndex);
      return;
    }
  }
}

function jsonResponse(data, code) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
