import { ClassRepository } from '../models/classRepository.js';
import { RoomRepository } from '../models/roomRepository.js';
import { EnrollmentSnapshotRepository } from '../models/enrollmentSnapshotRepository.js';
import { getCollection } from '../models/index.js';
import { readSnapshot, writeSnapshot } from '../models/fileSnapshot.js';
import { contactHoursForClass } from '../data/courseContactHours.js';

const CATALOG_URL = 'https://middlesexcollege-ss.colleague.elluciancloud.com';
const ACADEMIC_CALENDAR_URL = 'https://middlesexcollege.edu/academics/academic-calendar/';
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const decodeHtml = (value) => value
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&ndash;|&#8211;/gi, '-')
  .replace(/&mdash;|&#8212;/gi, '-')
  .replace(/\u2013|\u2014/g, '-')
  .replace(/&amp;/gi, '&')
  .trim();

// Identifies a class by its catalog code (e.g. "CSC-111-1") regardless of professor/room/time.
const classKey = (courseCode, courseNumber, section) =>
  [courseCode, courseNumber, section].map(value => String(value || '').trim().toUpperCase()).join('-');

/**
 * Picks the most common start date and most common end date across a term's sections, instead of
 * the overall min/max. A handful of "combined"/full-summer sections are sometimes catalogued under
 * just one of Summer I/II's term codes but span the whole summer — using min/max for the semester's
 * own displayed range would let that one outlier section drag Summer I and Summer II into overlapping.
 */
const pickModeDateRange = (ranges) => {
  if (ranges.length === 0) {
    return { startDate: '', endDate: '' };
  }
  const startCounts = new Map();
  const endCounts = new Map();
  for (const { start, end } of ranges) {
    startCounts.set(start, (startCounts.get(start) || 0) + 1);
    endCounts.set(end, (endCounts.get(end) || 0) + 1);
  }
  const pickMode = (counts) => {
    let best = null;
    let bestCount = -1;
    for (const [value, count] of counts) {
      if (count > bestCount || (count === bestCount && value < best)) {
        best = value;
        bestCount = count;
      }
    }
    return best;
  };
  return { startDate: pickMode(startCounts), endDate: pickMode(endCounts) };
};

// Groups every currently-known SCRAPED class by semester + course + the class's own start/end
// date range (not just course) and records today's total enrollment per group, so the Overview
// page can compare a specific semester's enrollment across two dates *and* filter that
// historical comparison down to a specific class date range (e.g. a compressed sub-term vs. the
// full semester). Manually-added classes are excluded so the historical trend only reflects real
// MCC catalog data.
const recordEnrollmentSnapshot = async (allClasses, fileOnly) => {
  const date = new Date().toISOString().slice(0, 10);
  const totals = new Map();
  for (const item of allClasses) {
    if (!item.scraped) continue;
    const courseKey = [item.courseCode, item.courseNumber].map(value => String(value || '').trim().toUpperCase()).join('-');
    if (courseKey === '-' || !courseKey || !item.semesterId) continue;
    const startDate = item.startDate || '';
    const endDate = item.endDate || '';
    const key = `${item.semesterId}::${courseKey}::${startDate}::${endDate}`;
    const existing = totals.get(key) || {
      semesterId: item.semesterId,
      courseCode: item.courseCode,
      courseNumber: item.courseNumber,
      className: item.className,
      startDate,
      endDate,
      totalEnrolled: 0,
      sectionCount: 0,
      totalCapacity: 0,
    };
    existing.totalEnrolled += Number(item.studentCount) || 0;
    existing.sectionCount += 1;
    existing.totalCapacity += Number(item.capacity) || 0;
    if (!existing.className) existing.className = item.className;
    totals.set(key, existing);
  }

  const recordId = (totalsForGroup) =>
    `${date}_${totalsForGroup.semesterId}_${totalsForGroup.courseCode}-${totalsForGroup.courseNumber}_${totalsForGroup.startDate}_${totalsForGroup.endDate}`;

  if (fileOnly) {
    const snapshot = readSnapshot();
    const ids = new Set();
    const records = [];
    for (const totalsForGroup of totals.values()) {
      const id = recordId(totalsForGroup);
      ids.add(id);
      records.push({ id, date, ...totalsForGroup });
    }
    writeSnapshot({
      ...snapshot,
      enrollmentSnapshots: [...(snapshot.enrollmentSnapshots || []).filter(item => !ids.has(item.id)), ...records],
    });
    return;
  }

  await Promise.all([...totals.values()].map((totalsForGroup) =>
    EnrollmentSnapshotRepository.upsert(recordId(totalsForGroup), { date, ...totalsForGroup })
  ));
};

export const parseAcademicCalendarEntries = (html, season, year) => {
  const headingPattern = /<h2[^>]*>([^<]+)<\/h2>\s*<ul[^>]*>([\s\S]*?)<\/ul>/gi;
  const monthPattern = /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:\s*-\s*(\d{1,2}))?(.*)$/i;
  const dates = new Set();
  const reasons = new Map();
  let section;

  while ((section = headingPattern.exec(html))) {
    const heading = decodeHtml(section[1]);
    const headingSeason = season.startsWith('SUMMER') ? 'SUMMER' : season;
    if (!heading.toUpperCase().includes(headingSeason) || !heading.includes(String(year))) continue;
    const itemPattern = /<li[^>]*>([\s\S]*?)<\/li>/gi;
    let item;
    while ((item = itemPattern.exec(section[2]))) {
      const itemHtml = item[1];
      const itemText = decodeHtml(itemHtml).replace(/\s+/g, ' ');
      if (!/no\s+classes/i.test(itemText)) continue;
      const strong = itemHtml.match(/<strong[^>]*>([\s\S]*):\s*<\/strong>/i);
      const dateText = strong ? decodeHtml(strong[1]).replace(/\s+/g, ' ') : '';
      const dateMatch = dateText.match(monthPattern);
      if (!dateMatch) continue;
      const month = new Date(`${dateMatch[1]} 1, ${year}`).getMonth();
      const firstDay = Number(dateMatch[2]);
      const lastDay = Number(dateMatch[3] || firstDay);
      const sourceReason = itemText.replace(dateText, '').replace(/^:\s*/, '').replace(/\s*-\s*No Classes.*$/i, '').trim();
      for (let day = firstDay; day <= lastDay; day += 1) {
        const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        dates.add(date);
        reasons.set(date, sourceReason && sourceReason !== 'Holiday' ? sourceReason : ((month === 11 && day === 24) ? 'Christmas Eve' : (month === 11 && day === 25) ? 'Christmas Day' : 'Holiday'));
      }
      const additionalDays = dateMatch[4].match(/,\s*(\d{1,2})/g) || [];
      additionalDays.forEach(value => {
        const day = Number(value.replace(',', '').trim());
        const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        dates.add(date);
        reasons.set(date, sourceReason && sourceReason !== 'Holiday' ? sourceReason : ((month === 11 && day === 24) ? 'Christmas Eve' : (month === 11 && day === 25) ? 'Christmas Day' : 'Holiday'));
      });
    }
  }

  return [...dates].sort().map(date => ({ date, reason: reasons.get(date) || 'Holiday' }));
};

export const parseAcademicCalendarDates = (html, season, year) =>
  parseAcademicCalendarEntries(html, season, year).map(entry => entry.date);

const fetchNoClassDates = async (season, year) => {
  const response = await fetch(ACADEMIC_CALENDAR_URL);
  if (!response.ok) throw new Error(`Academic calendar request failed with status ${response.status}`);
  return parseAcademicCalendarEntries(await response.text(), season, year);
};

const extractSearchCriteria = (html) => {
  const match = html.match(/Ellucian\.Course\.SearchResult\.jsonData = (\{.*?\});/);
  if (!match) {
    throw new Error('Unable to read course search criteria from Middlesex College');
  }
  return JSON.parse(match[1]);
};

const normalizeTime = (time) => {
  if (!time) return '';
  const [hoursText, minutesText] = time.split(':');
  const hours = Number(hoursText);
  const minutes = minutesText || '00';
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;
  return `${displayHours}:${minutes}${suffix}`;
};

const normalizeDate = (date) => date ? date.slice(0, 10) : '';

const parseCredits = (...values) => {
  const value = values.find(candidate => candidate !== null && candidate !== undefined && String(candidate).trim() !== '');
  if (value === undefined) return undefined;
  const credits = Number(value);
  return Number.isFinite(credits) ? credits : undefined;
};

const parseRoomNumber = (meeting) => {
  const room = String(meeting.RoomDisplay || meeting.Room || '').trim();
  const building = String(meeting.BuildingDisplay || '').trim();
  if (meeting.IsOnline || !room || meeting.ShowTBD || ['TBA', 'TBD', '*', 'ONLINE'].includes(room.toUpperCase()) || /\bonline\b/i.test(room)) return '';
  return building && !room.toUpperCase().startsWith(building.toUpperCase())
    ? `${building} ${room}`
    : room;
};

const parseDays = (meetings) => {
  const days = meetings.flatMap(meeting => (meeting.Days || []).map(day => DAY_NAMES[day]));
  return [...new Set(days.filter(Boolean))];
};

const parseMeetingDays = (meeting) => (meeting.Days || [])
  .map(day => DAY_NAMES[day])
  .filter(Boolean);

const parseDeliveryMode = (section, meetings) => {
  const location = String(section.LocationDisplay || '').trim();
  if (meetings.some(meeting => meeting.IsOnline) || /online/i.test(location)) return 'Online';
  if (/hybrid/i.test(location)) return 'Hybrid';
  if (/remote live/i.test(location)) return 'Remote Live';
  return '';
};

const fetchSections = async (course) => {
  const response = await fetch(`${CATALOG_URL}/Student/Courses/Sections`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ courseId: course.Id, sectionIds: course.MatchingSectionIds })
  });
  if (!response.ok) throw new Error(`Section request failed with status ${response.status}`);
  return response.json();
};

export const syncMccCourseData = async ({ semesterId, courseCode = 'CSC' }) => {
  const semesterMatch = String(semesterId).match(/^(SPRING|FALL|SUMMER(?:-?I|-?II)?|WINTER)-?(\d{4})$/i);
  if (!semesterMatch) throw new Error(`Unsupported semester ID: ${semesterId}`);

  const season = semesterMatch[1].toUpperCase();
  const year = semesterMatch[2];
  // MCC uses distinct catalog term codes for the two summer sessions: Summer I is "PS",
  // Summer II is "SM" — they are NOT the same term, unlike Spring/Fall which have one code each.
  const seasonCode = season === 'FALL' ? 'FA' : season === 'SPRING' ? 'SP' : season === 'WINTER' ? 'WN' : season.includes('II') ? 'SM' : 'PS';
  const term = `${year.slice(-2)}/${seasonCode}`;
  const keyword = String(courseCode).trim().toUpperCase();
  const noClassEntries = await fetchNoClassDates(season, year);
  const noClassDates = noClassEntries.map(entry => entry.date);

  const pageResponse = await fetch(`${CATALOG_URL}/Student/Student/Courses/Search?keyword=${encodeURIComponent(keyword)}`);
  if (!pageResponse.ok) throw new Error(`Course search failed with status ${pageResponse.status}`);
  const criteria = extractSearchCriteria(await pageResponse.text());
  criteria.keyword = keyword;
  criteria.terms = [term];
  criteria.pageNumber = 1;
  criteria.quantityPerPage = 100;

  const searchResponse = await fetch(`${CATALOG_URL}/Student/Courses/PostSearchCriteria`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(criteria)
  });
  if (!searchResponse.ok) throw new Error(`Course search failed with status ${searchResponse.status}`);

  const searchData = await searchResponse.json();
  const courses = (searchData.CourseFullModels || []).filter(course =>
    String(course.SubjectCode || '').toUpperCase().startsWith(keyword)
  );
  let existingClasses = [];
  let existingRooms = [];
  let fileOnly = process.env.DATA_SOURCE === 'file';
  try {
    if (fileOnly) throw new Error('File data source selected');
    [existingClasses, existingRooms] = await Promise.all([
      ClassRepository.findAll(),
      RoomRepository.findAll()
    ]);
  } catch (error) {
    if (!fileOnly && process.env.NODE_ENV === 'firestore') {
      throw new Error(`Firestore read failed; refusing to write scraped data locally: ${error.message}`);
    }
    console.warn('Firestore unavailable; writing scraped data to local snapshot:', error.message);
    const snapshot = readSnapshot();
    existingClasses = snapshot.classes || [];
    existingRooms = snapshot.rooms || [];
    fileOnly = true;
  }
  const existingSectionIds = new Set(existingClasses
    .filter(item => item.semesterId === semesterId)
    .map(item => item.scrapedSectionId)
    .filter(Boolean));
  const roomsByNumber = new Map(
    existingRooms
      .filter(room => room.semesterId === semesterId)
      .map(room => [room.roomNumber.toUpperCase(), room])
  );
  // Manually-added classes (not scraped) in this semester, keyed by course code so a
  // scraped section with the same code always supersedes a hand-entered duplicate.
  const manualClassesByKey = new Map();
  for (const item of existingClasses) {
    if (item.semesterId === semesterId && !item.scraped) {
      manualClassesByKey.set(classKey(item.courseCode, item.courseNumber, item.section), item);
    }
  }

  let classesCreated = 0;
  let classesUpdated = 0;
  let classesDeleted = 0;
  let roomsCreated = 0;
  let sectionsFound = 0;
  const scrapedSectionIds = new Set();
  /** One {start, end} pair per section found this run, used to derive the semester's own date range. */
  const sectionDateRanges = [];
  const snapshotClasses = [...existingClasses];
  const snapshotRooms = [...existingRooms];

  for (const course of courses) {
    const sectionData = await fetchSections(course);
    const termSections = sectionData.SectionsRetrieved?.TermsAndSections?.find(item => item.Term?.Code === term);
    for (const item of (termSections?.Sections || [])) {
      const section = item.Section;
      sectionsFound += 1;
      scrapedSectionIds.add(section.Id);
      const sectionStartDate = normalizeDate(section.StartDate);
      const sectionEndDate = normalizeDate(section.EndDate);
      if (sectionStartDate && sectionEndDate) {
        sectionDateRanges.push({ start: sectionStartDate, end: sectionEndDate });
      }
      const meetings = section.FormattedMeetingTimes || [];
      const instructionalMethod = [...new Set(meetings.map(meeting => meeting.InstructionalMethodDisplay).filter(Boolean))].join(', ');
      const deliveryMode = parseDeliveryMode(section, meetings);
      const meetingRows = meetings.map(meeting => ({
        days: parseMeetingDays(meeting),
        startTime: normalizeTime(meeting.StartTime),
        endTime: normalizeTime(meeting.EndTime),
        instructionalMethod: meeting.InstructionalMethodDisplay || ''
      }));
      const primaryMeeting = meetings[0] || {};
      const roomNumber = parseRoomNumber(primaryMeeting);
      let room = roomNumber ? roomsByNumber.get(roomNumber.toUpperCase()) : undefined;

      if (roomNumber && !room) {
        const roomData = {
          semesterId,
          roomNumber,
          capacity: Number(section.Capacity) || 0,
          scraped: true
        };
        room = fileOnly
          ? { ...roomData, id: `ROOM-${semesterId.replace(/-/g, '')}-${roomNumber.replace(/\s+/g, '')}` }
          : await RoomRepository.create(roomData);
        roomsByNumber.set(roomNumber.toUpperCase(), room);
        snapshotRooms.push(room);
        roomsCreated += 1;
      }

      const sectionCapacity = Number(section.Capacity) || 0;
      if (room && sectionCapacity > (Number(room.capacity) || 0)) {
        room.capacity = sectionCapacity;
        if (fileOnly) {
          const cachedRoom = snapshotRooms.find(roomItem => roomItem.id === room.id);
          if (cachedRoom) cachedRoom.capacity = sectionCapacity;
        } else {
          await RoomRepository.update(room.id, { capacity: sectionCapacity });
        }
      }

      // Built every scrape, for both brand-new sections and ones already on file — capacity,
      // enrollment, instructor, room, and meeting times can all change after a section is first seen.
      const classData = {
        semesterId,
        roomId: room?.id || '',
        courseCode: course.SubjectCode || keyword,
        courseNumber: String(course.Number || section.CourseName?.split('-')[1] || ''),
        section: String(section.Number || section.SectionNameDisplay?.split('-').pop() || ''),
        instructor: sectionData.SectionsRetrieved?.TermsAndSections ?
          (item.FacultyDisplay || '') : '',
        startTime: normalizeTime(primaryMeeting.StartTime),
        endTime: normalizeTime(primaryMeeting.EndTime),
        days: parseDays(meetings),
        studentCount: String(section.Enrolled || 0),
        capacity: sectionCapacity,
        className: section.Title || course.Title || '',
        classCode: section.SectionNameDisplay || '',
        ...(parseCredits(section.MinimumCredits, section.Credits, section.CreditHours, section.CreditsDisplay, course.MinimumCredits, course.Credits, course.CreditHours, course.CreditsDisplay) === undefined
          ? {}
          : { credits: parseCredits(section.MinimumCredits, section.Credits, section.CreditHours, section.CreditsDisplay, course.MinimumCredits, course.Credits, course.CreditHours, course.CreditsDisplay) }),
        contactHours: contactHoursForClass({ courseCode: course.SubjectCode || keyword, courseNumber: String(course.Number || section.CourseName?.split('-')[1] || '') }),
        instructionalMethod,
        deliveryMode,
        meetings: meetingRows,
        startDate: normalizeDate(section.StartDate),
        endDate: normalizeDate(section.EndDate),
        scrapedSectionId: section.Id,
        scraped: true
      };

      if (!existingSectionIds.has(section.Id)) {
        // A manually-added class with the same course code is now covered by the scraped
        // catalog data, so drop the manual duplicate regardless of its professor/time/room.
        const key = classKey(classData.courseCode, classData.courseNumber, classData.section);
        const manualDuplicate = manualClassesByKey.get(key);
        if (manualDuplicate) {
          if (fileOnly) {
            const idx = snapshotClasses.findIndex(item => item.id === manualDuplicate.id);
            if (idx !== -1) snapshotClasses.splice(idx, 1);
          } else {
            await ClassRepository.delete(manualDuplicate.id);
          }
          manualClassesByKey.delete(key);
          classesDeleted += 1;
        }

        if (fileOnly) {
          snapshotClasses.push({ ...classData, id: `CLASS-${semesterId.replace(/-/g, '')}-${section.Id}` });
        } else {
          await ClassRepository.create(classData);
        }
        existingSectionIds.add(section.Id);
        classesCreated += 1;
      } else {
        // Section already on file — refresh it so capacity/enrollment/instructor/room changes
        // in the catalog aren't frozen at whatever they were the first time it was scraped.
        if (fileOnly) {
          const cachedClass = snapshotClasses.find(classItem => classItem.scrapedSectionId === section.Id);
          if (cachedClass) {
            Object.assign(cachedClass, classData);
          }
        } else {
          const existingClass = existingClasses.find(
            classItem => classItem.semesterId === semesterId && classItem.scrapedSectionId === section.Id,
          );
          if (existingClass) {
            await ClassRepository.update(existingClass.id, classData);
          }
        }
        classesUpdated += 1;
      }
    }
  }

  const semesterName = season === 'FALL' ? 'Fall' : season === 'SPRING' ? 'Spring' : season === 'WINTER' ? 'Winter' : season.includes('II') ? 'Summer II' : 'Summer I';

  if (fileOnly) {
    const snapshot = readSnapshot();
    const currentClasses = snapshotClasses.filter(item =>
      item.semesterId === semesterId && (!item.scraped || scrapedSectionIds.has(item.scrapedSectionId))
    );
    // Mirrors the Firestore branch below: only create/update the semester record when courses were
    // actually found this run, so terms with no catalog data yet (e.g. far-future/past years) don't
    // spawn empty placeholder semesters that the production (Firestore) path never creates.
    let nextSemesters = snapshot.semesters || [];
    if (courses.length > 0) {
      const { startDate, endDate } = pickModeDateRange(sectionDateRanges);
      const semesterRecord = {
        id: semesterId,
        name: semesterName,
        year: Number(year),
        startDate,
        endDate,
        isStarred: false,
        noClassDates,
        noClassEntries
      };
      nextSemesters = [...nextSemesters.filter(item => item.id !== semesterId), semesterRecord];
    }
    writeSnapshot({
      ...snapshot,
      semesters: nextSemesters,
      rooms: [...(snapshot.rooms || []).filter(room => room.semesterId !== semesterId), ...snapshotRooms.filter(room => room.semesterId === semesterId)],
      classes: [...(snapshot.classes || []).filter(item => item.semesterId !== semesterId), ...currentClasses]
    });
  } else if (courses.length > 0) {
    // Ensure a Semester document exists so scraped rooms/classes are visible in the UI.
    // Use semesterId directly as the document ID to stay consistent with rooms/classes.
    const semestersCollection = getCollection('semesters');
    const existingSemesterDoc = await semestersCollection.doc(semesterId).get();
    const { startDate, endDate } = pickModeDateRange(sectionDateRanges);
    const semesterData = {
      name: semesterName,
      year: Number(year),
      startDate,
      endDate,
      isStarred: false,
      noClassDates,
      noClassEntries,
      customId: semesterId
    };
    if (!existingSemesterDoc.exists) {
      await semestersCollection.doc(semesterId).set(semesterData);
    } else {
      await semestersCollection.doc(semesterId).set(semesterData, { merge: true });
    }
  }

  // Record today's total enrollment per course (across every semester) so the Overview
  // page can compare enrollment on two dates.
  if (fileOnly) {
    await recordEnrollmentSnapshot(readSnapshot().classes || [], true);
  } else {
    await recordEnrollmentSnapshot(await ClassRepository.findAll(), false);
  }

  return { semesterId, term, courseCode: keyword, coursesFound: courses.length, sectionsFound, roomsCreated, classesCreated, classesUpdated, classesDeleted };
};

export const syncAllMccCourseData = async ({ courseCode = 'CSC', years = [2026] } = {}) => {
  const results = [];
  for (const year of years) {
    for (const term of [`SPRING-${year}`, `SUMMER-I-${year}`, `SUMMER-II-${year}`, `FALL-${year}`, `WINTER-${year}`]) {
      try {
        results.push(await syncMccCourseData({ semesterId: term, courseCode }));
      } catch (error) {
        results.push({ semesterId: term, courseCode, error: error.message });
      }
    }
  }
  return results;
};
