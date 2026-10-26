// One-shot scrape runner for scheduled CI jobs (no HTTP server needed)
import { connectToDatabase, closeConnection } from '../server/models/index.js';
import { syncAllMccCourseData } from '../server/services/mccCourseScraper.js';

const courseCode = process.env.SCRAPE_COURSE_CODE || 'CSC';
const currentYear = new Date().getFullYear();
// Default to last year, this year, and next year so upcoming/older semesters stay in sync
const defaultYears = [currentYear - 1, currentYear, currentYear + 1].join(',');
const years = (process.env.SCRAPE_YEARS || defaultYears)
  .split(',')
  .map(value => Number(value.trim()))
  .filter(Number.isInteger);

try {
  await connectToDatabase();
  const results = await syncAllMccCourseData({ courseCode, years });
  console.log('Scrape complete:', JSON.stringify({ courseCode, years, results }));
  process.exitCode = 0;
} catch (error) {
  console.error('Scrape failed:', error);
  process.exitCode = 1;
} finally {
  await closeConnection();
}
