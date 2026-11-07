import fs from 'node:fs';
import path from 'node:path';

const MAX_JOBS = 200;

/**
 * Creates an in-memory job store whose logs live on disk under `dataDir/logs`.
 * Records are also appended to `dataDir/jobs.jsonl` so there is an audit trail across restarts.
 * @param dataDir - directory for logs and the audit file
 */
export function createJobRepository(dataDir) {
  const logDir = path.join(dataDir, 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  /** @type {Map<string, import('../models/types.js').JobRecord>} */
  const jobs = new Map();

  /**
   * Stores a new job record, evicting the oldest when the store is full.
   * @param record - job to save
   */
  function insert(record) {
    jobs.set(record.id, record);
    if (jobs.size > MAX_JOBS) jobs.delete(jobs.keys().next().value);
    return record;
  }

  /**
   * Applies a partial update to a job and appends finished jobs to the audit file.
   * @param id - job id
   * @param changes - fields to merge
   */
  function update(id, changes) {
    const record = jobs.get(id);
    if (!record) return null;
    Object.assign(record, changes);
    if (record.finishedAt) fs.appendFileSync(path.join(dataDir, 'jobs.jsonl'), JSON.stringify(record) + '\n');
    return record;
  }

  /**
   * Returns a job by id, or null.
   * @param id - job id
   */
  function get(id) {
    return jobs.get(id) || null;
  }

  /**
   * Lists jobs, newest first.
   */
  function list() {
    return [...jobs.values()].reverse();
  }

  /**
   * Path where a job's combined stdout/stderr is written.
   * @param id - job id
   */
  function logPathFor(id) {
    return path.join(logDir, `${id}.log`);
  }

  /**
   * Reads a job's log from a byte offset so clients can tail it incrementally.
   * @param id - job id
   * @param offset - byte offset to start from
   */
  function readLog(id, offset = 0) {
    const record = jobs.get(id);
    if (!record || !fs.existsSync(record.logPath)) return { text: '', nextOffset: offset };
    const size = fs.statSync(record.logPath).size;
    if (offset >= size) return { text: '', nextOffset: size };
    const fd = fs.openSync(record.logPath, 'r');
    try {
      const buffer = Buffer.alloc(size - offset);
      fs.readSync(fd, buffer, 0, buffer.length, offset);
      return { text: buffer.toString('utf8'), nextOffset: size };
    } finally {
      fs.closeSync(fd);
    }
  }

  return { insert, update, get, list, logPathFor, readLog };
}
