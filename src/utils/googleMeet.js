async function createMeet({ summary, description, startISO, endISO, attendees = [] }) {
  const { GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY, GOOGLE_IMPERSONATE } = process.env;
  if (!GOOGLE_CLIENT_EMAIL || !GOOGLE_PRIVATE_KEY || !GOOGLE_IMPERSONATE) {
    return { meetLink: null, eventId: null, configured: false };
  }
  try {
    const { google } = require('googleapis');
    const jwt = new google.auth.JWT(
      GOOGLE_CLIENT_EMAIL,
      null,
      GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      ['https://www.googleapis.com/auth/calendar.events'],
      GOOGLE_IMPERSONATE
    );
    const calendar = google.calendar({ version: 'v3', auth: jwt });
    const { data } = await calendar.events.insert({
      calendarId: 'primary',
      conferenceDataVersion: 1,
      requestBody: {
        summary,
        description,
        start: { dateTime: startISO },
        end: { dateTime: endISO },
        attendees: attendees.map((email) => ({ email })),
        conferenceData: {
          createRequest: { requestId: `mock-${Date.now()}`, conferenceSolutionKey: { type: 'hangoutsMeet' } },
        },
      },
    });
    const meetLink = data.hangoutLink
      || data.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')?.uri
      || null;
    return { meetLink, eventId: data.id, configured: true };
  } catch (e) {
    return { meetLink: null, eventId: null, configured: true, error: e.message };
  }
}
module.exports = { createMeet };
