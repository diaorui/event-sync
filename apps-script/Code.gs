// --- CONFIGURATION ---
var ALLOWED_SLUGS = ['tech', 'food', 'ai', 'arts', 'climate', 'fitness', 'wellness', 'crypto'];
var PAGINATION_LIMIT = 20;

function doPost(e) {
  // Validate Script Properties are set
  try {
    validateConfig();
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({status: 'error', msg: 'Server configuration error: ' + err.message}));
  }

  try {
    var data = JSON.parse(e.postData.contents);
    var config = data.config;

    // 1. VALIDATE SLUG (Security)
    if (ALLOWED_SLUGS.indexOf(config.slug) === -1) {
      throw new Error("Invalid Category. Allowed: " + ALLOWED_SLUGS.join(", "));
    }

    // 2. AUTH EXCHANGE
    if (!data.auth_code) {
      throw new Error("auth_code is required");
    }

    var tokenResponse = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
      method: 'post',
      payload: {
        code: data.auth_code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: data.redirect_uri,
        grant_type: 'authorization_code'
      },
      muteHttpExceptions: true
    });

    var tokens = JSON.parse(tokenResponse.getContentText());
    if (tokens.error) throw new Error(tokens.error_description);

    var accessToken = tokens.access_token;
    var refreshToken = tokens.refresh_token;

    // Identify user from id_token
    var email = "unknown";
    if (tokens.id_token) {
      var parts = tokens.id_token.split('.');
      var decoded = Utilities.base64Decode(parts[1]);
      email = JSON.parse(Utilities.newBlob(decoded).getDataAsString()).email;
    }

    // 4. Acquire per-user lock for entire create/update process
    var userLock = LockService.getUserLock();
    if (!userLock.tryLock(30000)) {
      throw new Error('Could not acquire lock for your account. Please try again.');
    }

    var calName, calendarId, actionTaken;
    try {
      // CHECK DATABASE (COMPOSITE KEY CHECK)
      var sheet = getDbSheet();
      var rows = sheet.getDataRange().getValues();
      var rowIndex = -1;
      var existingCalId = "";

      for (var i = 1; i < rows.length; i++) {
        var rowEmail = rows[i][1];
        var rowConfig = JSON.parse(rows[i][3]); // Parse the stored JSON

        // KEY: Match Email AND Slug
        if (rowEmail === email && rowConfig.slug === config.slug) {
          rowIndex = i + 1;
          existingCalId = rows[i][4];
          break;
        }
      }

      // 5. PREPARE VARS
      calName = "Luma Events (" + config.slug + ")";
      calendarId = existingCalId;
      actionTaken = "";

      // 6. LOGIC: UPDATE vs CREATE
      if (rowIndex > 0) {
        // --- UPDATE EXISTING ROW ---
        actionTaken = "updated";

        // Health Check: Is the specific calendar for THIS slug still alive?
        var isCalendarValid = false;
        if (calendarId) {
          try {
            UrlFetchApp.fetch('https://www.googleapis.com/calendar/v3/calendars/' + calendarId, {
              method: 'patch',
              headers: { Authorization: 'Bearer ' + accessToken },
              contentType: 'application/json',
              payload: JSON.stringify({ summary: calName })
            });
            isCalendarValid = true;
          } catch(e) {
            console.log("Calendar " + calendarId + " is dead.");
          }
        }

        if (!isCalendarValid) {
          calendarId = createSecondaryCalendar(accessToken, calName);
          sheet.getRange(rowIndex, 5).setValue(calendarId);
          actionTaken = "created"; // Force sync repair
        }

        // Update DB
        sheet.getRange(rowIndex, 1).setValue(new Date());
        if (refreshToken) {
          sheet.getRange(rowIndex, 3).setValue(refreshToken);  // Only update if we have new refresh token
        }
        sheet.getRange(rowIndex, 4).setValue(JSON.stringify(config));

      } else {
        // --- NEW ENTRY ---
        actionTaken = "created";
        calendarId = createSecondaryCalendar(accessToken, calName);

        sheet.appendRow([
          new Date(),
          email,
          refreshToken || "",
          JSON.stringify(config),
          calendarId
        ]);
      }

      // 7. CONDITIONAL SYNC (inside lock - ensures atomic operation)
      if (actionTaken === 'created') {
        try {
          var events = fetchLumaEvents(config);
          processEventsForUser(accessToken, calendarId, events);
        } catch(e) {
          console.error("Instant sync failed: " + e.message);
        }
      }
    } finally {
      userLock.releaseLock();
    }

    return ContentService.createTextOutput(JSON.stringify({
      status: 'success',
      action: actionTaken,
      email: email,
      calendarName: calName
    }));

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({status: 'error', msg: err.toString()}));
  }
}

// --- 2. CRON JOB: SYNC EVERYONE ---
function syncAllUsers() {
  var sheet = getDbSheet();
  var data = sheet.getDataRange().getValues();
  
  // Skip header, loop users
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var email = row[1];
    var refreshToken = row[2];
    var config = JSON.parse(row[3]);
    var storedCalId = row[4];
    
    Logger.log("Processing user: " + email);
    
    try {
      // A. Get Access Token for this user
      var accessToken = getAccessToken(refreshToken);
      if (!accessToken) continue; // Token expired/revoked
      
      // B. Ensure calendar exists
      var calendarId = storedCalId;
      if (!calendarId) {
        calendarId = createSecondaryCalendar(accessToken, "Luma Events (" + config.slug + ")");
        sheet.getRange(i + 1, 5).setValue(calendarId);
      } else {
        // Quick check: verify calendar still exists (lightweight operation)
        try {
          UrlFetchApp.fetch('https://www.googleapis.com/calendar/v3/calendars/' + calendarId, {
            method: 'get',
            headers: { Authorization: 'Bearer ' + accessToken }
          });
        } catch (e) {
          Logger.log("Calendar no longer exists for " + email + ", skipping");
          continue;  // Skip this user, don't recreate or sync
        }
      }

      // C. Fetch Luma Events (heavy operation - only after confirming calendar exists)
      var events = fetchLumaEvents(config);

      // D. Push to User's Calendar
      processEventsForUser(accessToken, calendarId, events);
      
    } catch (e) {
      Logger.log("Error for " + email + ": " + e.message);
    }
  }
}

// --- 3. HELPER: EXCHANGE REFRESH TOKEN FOR ACCESS TOKEN ---
function getAccessToken(refreshToken) {
  try {
    var response = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
      method: 'post',
      payload: {
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: 'refresh_token'
      },
      muteHttpExceptions: true
    });
    var json = JSON.parse(response.getContentText());
    return json.access_token;
  } catch (e) {
    Logger.log("Failed to refresh token");
    return null;
  }
}

// --- 4. YOUR ORIGINAL LUMA FETCH (Keep this mostly as is) ---
function fetchLumaEvents(config) {
  // Directly using your URL structure
  const url = 'https://api2.luma.com/discover/get-paginated-events?' +
    `east=${config.east}&north=${config.north}&south=${config.south}&west=${config.west}` +
    `&pagination_limit=${PAGINATION_LIMIT}&slug=${config.slug || 'ai'}`;
  Logger.log("Luma URL: " + url);
  try {
    const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const data = JSON.parse(response.getContentText());
    return data.entries || [];
  } catch (e) { return []; }
}

// --- 5. THE NEW "ADD TO CALENDAR" (REST API VERSION) ---
function createSecondaryCalendar(accessToken, name) {
  var url = 'https://www.googleapis.com/calendar/v3/calendars';
  var response = UrlFetchApp.fetch(url, {
    method: 'post',
    headers: { Authorization: 'Bearer ' + accessToken },
    contentType: 'application/json',
    payload: JSON.stringify({ summary: name })
  });
  return JSON.parse(response.getContentText()).id;
}

function processEventsForUser(accessToken, calendarId, lumaEvents) {
  var now = new Date();
  var timeMin = now.toISOString();
  
  // 1. Fetch existing events that end after Now (Includes ongoing events)
  var listUrl = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?timeMin=${timeMin}&singleEvents=true&maxResults=2500`;
  
  var response = UrlFetchApp.fetch(listUrl, {
    headers: { Authorization: 'Bearer ' + accessToken },
    muteHttpExceptions: true
  });
  
  if (response.getResponseCode() !== 200) return;
  
  var googleEvents = JSON.parse(response.getContentText()).items || [];

  // 2. Map Existing Events
  var googleEventMap = {};
  googleEvents.forEach(gEvent => {
    var desc = gEvent.description || "";
    var match = desc.match(/https:\/\/lu\.ma\/[\w-]+/);
    if (match) googleEventMap[match[0]] = gEvent;
  });

  // 3. Set of Valid New URLs
  var validLumaUrls = new Set();
  lumaEvents.forEach(entry => {
    if (entry.event && entry.event.url) validLumaUrls.add(`https://lu.ma/${entry.event.url}`);
  });

  // --- PHASE A: CLEANUP (SAFE DELETE) ---
  Object.keys(googleEventMap).forEach(url => {
    if (!validLumaUrls.has(url)) {
      var gEvent = googleEventMap[url];
      
      // SAFETY CHECK: Only delete if start time is in the FUTURE
      var eventStart = new Date(gEvent.start.dateTime || gEvent.start.date).getTime();
      var nowTime = new Date().getTime();

      if (eventStart > nowTime) {
        try {
          UrlFetchApp.fetch(`https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${gEvent.id}`, {
            method: 'delete',
            headers: { Authorization: 'Bearer ' + accessToken }
          });
          Logger.log("Deleted outdated future event: " + gEvent.summary);
        } catch(e) { console.log(e.message); }
      }
    }
  });

  // --- PHASE B: UPSERT (CREATE OR UPDATE) ---
  lumaEvents.forEach(entry => {
    var evt = entry.event;
    if (!evt || !evt.start_at) return;
    
    var eventUrl = `https://lu.ma/${evt.url}`;
    var existingEvent = googleEventMap[eventUrl];
    
    var descriptionParts = ["Event URL: " + eventUrl];
    if (entry.calendar && entry.calendar.description_short && entry.calendar.description_short.length > 0) {
      descriptionParts.push(entry.calendar.description_short);
    }
    descriptionParts.push("📅 Synced by https://eventsync.ruidiao.dev");

    var payload = {
      summary: evt.name,
      description: descriptionParts.join("\n\n"),
      location: evt.geo_address_info.full_address ? evt.geo_address_info.full_address : evt.geo_address_info.city_state,
      start: { dateTime: evt.start_at },
      end: { dateTime: evt.end_at }
    };

    if (existingEvent) {
      // Dirty Check Update
      var isDirty = false;
      if (existingEvent.summary !== payload.summary) isDirty = true;
      if (existingEvent.description !== payload.description) isDirty = true;
      if (existingEvent.location !== payload.location) isDirty = true;
      if (new Date(existingEvent.start.dateTime).getTime() !== new Date(payload.start.dateTime).getTime()) isDirty = true;
      if (new Date(existingEvent.end.dateTime).getTime() !== new Date(payload.end.dateTime).getTime()) isDirty = true;

      if (isDirty) {
        try {
          UrlFetchApp.fetch(`https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${existingEvent.id}`, {
            method: 'patch',
            headers: { Authorization: 'Bearer ' + accessToken },
            contentType: 'application/json',
            payload: JSON.stringify(payload)
          });
        } catch (e) {}
      }
    } else {
      // Create New
      try {
        UrlFetchApp.fetch(`https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`, {
          method: 'post',
          headers: { Authorization: 'Bearer ' + accessToken },
          contentType: 'application/json',
          payload: JSON.stringify(payload)
        });
      } catch (e) {}
    }
  });
}
