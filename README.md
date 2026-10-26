# mc-scraper

Scheduled GitHub Actions job that scrapes MCC course data into Firestore.

Required repo settings:
- Secret `FIRESTORE_SA_KEY_BASE64` — base64-encoded service account JSON
- Variables `FIRESTORE_PROJECT_ID`, `FIRESTORE_COLLECTION_PREFIX`, optional `SCRAPE_COURSE_CODE` (default `CSC`)
