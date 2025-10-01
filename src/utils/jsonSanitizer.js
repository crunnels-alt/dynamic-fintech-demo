/**
 * JSON Sanitizer Utility
 * Safely sanitizes objects before JSON.stringify to prevent "invalid high surrogate" errors
 */

/**
 * Remove invalid Unicode characters that cause JSON encoding errors
 * @param {string} str - String to sanitize
 * @returns {string} - Sanitized string
 */
function sanitizeString(str) {
    if (typeof str !== 'string') return str;

    // Replace unpaired surrogates and other invalid Unicode with replacement character
    return str.replace(/[\uD800-\uDFFF]/g, (match) => {
        // Check if it's a valid surrogate pair
        const code = match.charCodeAt(0);
        if (code >= 0xD800 && code <= 0xDBFF) {
            // High surrogate - should be followed by low surrogate
            return '\uFFFD'; // Unicode replacement character
        }
        return match;
    });
}

/**
 * Recursively sanitize an object for safe JSON stringification
 * @param {any} obj - Object to sanitize
 * @param {number} depth - Current recursion depth (prevents infinite loops)
 * @returns {any} - Sanitized object
 */
function sanitizeObject(obj, depth = 0) {
    // Prevent infinite recursion
    if (depth > 10) return '[Max Depth Exceeded]';

    // Handle null/undefined
    if (obj === null || obj === undefined) return obj;

    // Handle primitives
    if (typeof obj === 'string') return sanitizeString(obj);
    if (typeof obj === 'number' || typeof obj === 'boolean') return obj;

    // Handle arrays
    if (Array.isArray(obj)) {
        return obj.map(item => sanitizeObject(item, depth + 1));
    }

    // Handle objects
    if (typeof obj === 'object') {
        const sanitized = {};
        for (const key in obj) {
            if (obj.hasOwnProperty(key)) {
                try {
                    sanitized[key] = sanitizeObject(obj[key], depth + 1);
                } catch (error) {
                    console.warn(`Failed to sanitize key "${key}":`, error.message);
                    sanitized[key] = '[Sanitization Error]';
                }
            }
        }
        return sanitized;
    }

    // For functions, symbols, etc., convert to string representation
    return String(obj);
}

/**
 * Safely stringify an object to JSON, handling invalid Unicode characters
 * @param {any} obj - Object to stringify
 * @param {number} space - Indentation spaces (optional)
 * @returns {string} - JSON string or error message
 */
function safeStringify(obj, space = 0) {
    try {
        const sanitized = sanitizeObject(obj);
        return JSON.stringify(sanitized, null, space);
    } catch (error) {
        console.error('JSON stringify error:', error);
        return JSON.stringify({
            error: 'Failed to serialize object',
            message: error.message
        });
    }
}

module.exports = {
    sanitizeString,
    sanitizeObject,
    safeStringify
};
