// frontend/src/utils/localStorageUtils.js

const CLASS_PREFIX = "classReportDraft_";

/**
 * Save a draft for a specific class
 * @param {string} classId - The class ID
 * @param {object} data - The form data
 */
export const saveDraft = (classId, data) => {
  if (!classId) return;
  try {
    localStorage.setItem(`${CLASS_PREFIX}${classId}`, JSON.stringify(data));
  } catch (error) {
    console.error("Failed to save draft:", error);
  }
};

/**
 * Load a draft for a specific class
 * @param {string} classId - The class ID
 * @returns {object|null}
 */
export const loadDraft = (classId) => {
  if (!classId) return null;
  try {
    const data = localStorage.getItem(`${CLASS_PREFIX}${classId}`);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.error("Failed to load draft:", error);
    return null;
  }
};


/**
 * Clear draft for a specific class
 * @param {string} classId - The class ID
 */
export const clearDraft = (classId) => {
  if (!classId) return;
  try {
    localStorage.removeItem(`${CLASS_PREFIX}${classId}`);
  } catch (error) {
    console.error("Failed to clear draft:", error);
  }
};
