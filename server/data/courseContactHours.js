const COURSE_CONTACT_HOURS = {
  'CSC-105': 3,
  'CSC-106': 5,
  'CSC-107': 2,
  'CSC-110': 4,
  'CSC-112': 5,
  'CSC-116': 3,
  'CSC-118': 5,
  'CSC-119': 4,
  'CSC-125': 4,
  'CSC-126': 3,
  'CSC-133': 6,
  'CSC-135': 6,
  'CSC-161': 6,
  'CSC-162': 6,
  'CSC-166': 4,
  'CSC-200': 3,
  'CSC-205': 13,
  'CSC-206': 13,
  'CSC-225': 5,
  'CSC-236': 6,
  'CSC-239': 5,
  'CSC-241': 6,
  'CSC-245': 6,
  'CSC-246': 5,
  'CSC-248': 4,
  'CSC-251': 4,
  'CSC-252': 4,
  'CSC-258': 3,
  'CSC-261': 3,
  'CSC-263': 4,
  'CSC-264': 4,
  'CSC-266': 6,
  'CSC-267': 6,
  'CSC-268': 6,
  'CSC-269': 6,
  'CSC-270': 5,
  'CSC-273': 6,
  'CSC-275': 4,
  'DSA-110': 4,
  'DSA-120': 4,
  'DSA-210': 6,
  'DSA-220': 6,
  'DSA-230': 4,
  'DSA-240': 4,
};

export function contactHoursForClass(classItem) {
  const key = `${String(classItem.courseCode || '').trim().toUpperCase()}-${String(classItem.courseNumber || '').trim()}`;
  return COURSE_CONTACT_HOURS[key] || 0;
}

export function withContactHours(classItem) {
  const contactHours = Number(classItem.contactHours) || contactHoursForClass(classItem);
  return { ...classItem, contactHours };
}
