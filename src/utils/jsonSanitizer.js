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
    let result = '';
    for (let i = 0; i < str.length; i++) {
        const code = str.charCodeAt(i);

        // Check for high surrogate (0xD800-0xDBFF)
        if (code >= 0xD800 && code <= 0xDBFF) {
            // High surrogate should be followed by low surrogate
            if (i + 1 < str.length) {
                const nextCode = str.charCodeAt(i + 1);
                if (nextCode >= 0xDC00 && nextCode <= 0xDFFF) {
                    // Valid surrogate pair - keep both characters
                    result += str[i] + str[i + 1];
                    i++; // Skip the next character
                    continue;
                }
            }
            // Unpaired high surrogate - replace with replacement character
            result += '\uFFFD';
        } else if (code >= 0xDC00 && code <= 0xDFFF) {
            // Unpaired low surrogate - replace with replacement character
            result += '\uFFFD';
        } else {
            // Normal character
            result += str[i];
        }
    }

    return result;
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
