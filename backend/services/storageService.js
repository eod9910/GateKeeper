/**
 * Pattern Storage Service
 * 
 * Stores pattern candidates and user labels in JSON files.
 * Inspired by the corrections workflow in FlashRAG's handwriting system.
 */

const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CANDIDATES_DIR = path.join(DATA_DIR, 'candidates');
const LABELS_DIR = path.join(DATA_DIR, 'labels');

/**
 * Ensure data directories exist
 */
async function ensureDirectories() {
  await fs.mkdir(CANDIDATES_DIR, { recursive: true });
  await fs.mkdir(LABELS_DIR, { recursive: true });
}

/**
 * Save a pattern candidate
 * @param {Object} candidate - The pattern candidate to save
 * @returns {Promise<string>} - The candidate ID
 */
async function saveCandidate(candidate) {
  await ensureDirectories();
  
  const id = candidate.id || uuidv4();
  const filepath = path.join(CANDIDATES_DIR, `${id}.json`);
  
  const data = {
    ...candidate,
    id,
    savedAt: new Date().toISOString()
  };
  
  await fs.writeFile(filepath, JSON.stringify(data, null, 2));
  return id;
}

/**
 * Get a candidate by ID
 * @param {string} id - Candidate ID
 * @returns {Promise<Object|null>}
 */
async function getCandidate(id) {
  const filepath = path.join(CANDIDATES_DIR, `${id}.json`);
  
  try {
    const content = await fs.readFile(filepath, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Get all candidates
 * @returns {Promise<Object[]>}
 */
async function getAllCandidates() {
  await ensureDirectories();
  
  const files = await fs.readdir(CANDIDATES_DIR);
  const candidates = [];
  
  for (const file of files) {
    if (file.endsWith('.json')) {
      const filepath = path.join(CANDIDATES_DIR, file);
      const content = await fs.readFile(filepath, 'utf-8');
      candidates.push(JSON.parse(content));
    }
  }
  
  return candidates;
}

/**
 * Save a user label for a candidate
 * @param {string} candidateId - The candidate being labeled
 * @param {string} userId - User ID (for future multi-user support)
 * @param {string} label - 'yes' | 'no' | 'close'
 * @param {string} notes - Optional notes
 * @returns {Promise<string>} - The label ID
 */
async function saveLabel(candidateId, userId, label, notes = '') {
  await ensureDirectories();
  
  const id = uuidv4();
  const filepath = path.join(LABELS_DIR, `${id}.json`);
  
  const data = {
    id,
    candidateId,
    userId,
    label,  // 'yes' | 'no' | 'close'
    notes,
    timestamp: new Date().toISOString()
  };
  
  await fs.writeFile(filepath, JSON.stringify(data, null, 2));
  return id;
}

/**
 * Get all labels
 * @param {string} userId - Optional filter by user
 * @returns {Promise<Object[]>}
 */
async function getAllLabels(userId = null) {
  await ensureDirectories();
  
  const files = await fs.readdir(LABELS_DIR);
  const labels = [];
  
  for (const file of files) {
    if (file.endsWith('.json')) {
      const filepath = path.join(LABELS_DIR, file);
      const content = await fs.readFile(filepath, 'utf-8');
      const label = JSON.parse(content);
      
      if (!userId || label.userId === userId) {
        labels.push(label);
      }
    }
  }
  
  return labels;
}

/**
 * Get labels for a specific candidate
 * @param {string} candidateId 
 * @returns {Promise<Object[]>}
 */
async function getLabelsForCandidate(candidateId) {
  const allLabels = await getAllLabels();
  return allLabels.filter(l => l.candidateId === candidateId);
}

/**
 * Delete a label
 * @param {string} id - Label ID
 * @returns {Promise<boolean>}
 */
async function deleteLabel(id) {
  const filepath = path.join(LABELS_DIR, `${id}.json`);
  
  try {
    await fs.unlink(filepath);
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
}

/**
 * Get unlabeled candidates (for the labeling queue)
 * @param {string} userId 
 * @returns {Promise<Object[]>}
 */
async function getUnlabeledCandidates(userId) {
  const candidates = await getAllCandidates();
  const labels = await getAllLabels(userId);
  
  const labeledIds = new Set(labels.map(l => l.candidateId));
  
  return candidates.filter(c => !labeledIds.has(c.id));
}

/**
 * Get training data (labeled candidates with their labels)
 * @param {string} userId 
 * @returns {Promise<Object[]>}
 */
async function getTrainingData(userId) {
  const candidates = await getAllCandidates();
  const labels = await getAllLabels(userId);
  
  const candidateMap = new Map(candidates.map(c => [c.id, c]));
  
  return labels.map(label => ({
    ...label,
    candidate: candidateMap.get(label.candidateId) || null
  })).filter(item => item.candidate !== null);
}

/**
 * Get labeling statistics
 * @param {string} userId 
 * @returns {Promise<Object>}
 */
async function getStats(userId) {
  const labels = await getAllLabels(userId);
  const candidates = await getAllCandidates();
  
  const yesCount = labels.filter(l => l.label === 'yes').length;
  const noCount = labels.filter(l => l.label === 'no').length;
  const closeCount = labels.filter(l => l.label === 'close').length;
  
  return {
    totalCandidates: candidates.length,
    totalLabels: labels.length,
    yesCount,
    noCount,
    closeCount,
    unlabeled: candidates.length - labels.length
  };
}

module.exports = {
  saveCandidate,
  getCandidate,
  getAllCandidates,
  saveLabel,
  getAllLabels,
  getLabelsForCandidate,
  deleteLabel,
  getUnlabeledCandidates,
  getTrainingData,
  getStats
};
