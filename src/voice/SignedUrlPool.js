/**
 * SignedUrlPool - Maintains a pool of pre-fetched ElevenLabs signed URLs
 *
 * Purpose: Reduce latency by eliminating the 150ms+ API call on the critical path
 * when establishing ElevenLabs WebSocket connections.
 *
 * Design:
 * - Maintains 3-10 pre-fetched signed URLs
 * - Automatically refills when URLs are consumed
 * - Expires URLs after 5 minutes (configurable)
 * - Fallback to direct API call if pool is empty
 */

class SignedUrlPool {
    constructor(getSignedUrlFn) {
        this.getSignedUrlFn = getSignedUrlFn; // Function to fetch signed URLs
        this.pool = [];
        this.minPoolSize = 3;
        this.maxPoolSize = 10;
        // ElevenLabs signed URLs are typically valid for 5-10 minutes
        // Using 5 minutes to be conservative
        this.urlLifetime = 5 * 60 * 1000; // 5 minutes in milliseconds
        this.refillInterval = 30000; // Check every 30 seconds
        this.isRefilling = false;
        this.intervalId = null;

        console.log('[SignedUrlPool] Initialized with min:', this.minPoolSize, 'max:', this.maxPoolSize);
    }

    /**
     * Start maintaining the pool
     */
    async start() {
        console.log('[SignedUrlPool] Starting pool maintenance...');

        // Initial fill
        await this.refill();

        // Keep pool topped up
        this.intervalId = setInterval(async () => {
            await this.refill();
        }, this.refillInterval);

        console.log('[SignedUrlPool] Pool maintenance started');
    }

    /**
     * Stop maintaining the pool (cleanup)
     */
    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
            console.log('[SignedUrlPool] Pool maintenance stopped');
        }
    }

    /**
     * Refill the pool up to minPoolSize
     */
    async refill() {
        // Prevent concurrent refills
        if (this.isRefilling) {
            return;
        }

        this.isRefilling = true;

        try {
            const now = Date.now();

            // Remove expired URLs
            const beforeCount = this.pool.length;
            this.pool = this.pool.filter(item => item.expiresAt > now);
            const expiredCount = beforeCount - this.pool.length;

            if (expiredCount > 0) {
                console.log(`[SignedUrlPool] Removed ${expiredCount} expired URL(s)`);
            }

            // Add new URLs if below minimum
            let addedCount = 0;
            while (this.pool.length < this.minPoolSize && this.pool.length < this.maxPoolSize) {
                try {
                    const url = await this.getSignedUrlFn();
                    this.pool.push({
                        url,
                        createdAt: now,
                        expiresAt: now + this.urlLifetime
                    });
                    addedCount++;
                } catch (error) {
                    console.error('[SignedUrlPool] Failed to fetch signed URL:', error.message);
                    break; // Stop trying if API is failing
                }
            }

            if (addedCount > 0) {
                console.log(`[SignedUrlPool] Added ${addedCount} URL(s) to pool (total: ${this.pool.length})`);
            }
        } finally {
            this.isRefilling = false;
        }
    }

    /**
     * Get a signed URL from the pool
     * @returns {Promise<string>} Signed WebSocket URL
     */
    async get() {
        const now = Date.now();

        // Find first valid (non-expired) URL
        const validUrlIndex = this.pool.findIndex(item => item.expiresAt > now);

        if (validUrlIndex !== -1) {
            // Remove and return the URL
            const { url } = this.pool.splice(validUrlIndex, 1)[0];
            console.log(`[SignedUrlPool] ✅ Retrieved URL from pool (${this.pool.length} remaining)`);

            // Trigger async refill (don't await - non-blocking)
            this.refill().catch(err =>
                console.error('[SignedUrlPool] Background refill error:', err.message)
            );

            return url;
        }

        // Fallback: pool is empty, fetch directly
        console.warn('[SignedUrlPool] ⚠️  Pool empty - fetching URL directly (will add latency)');

        try {
            const url = await this.getSignedUrlFn();

            // Trigger background refill to prevent future misses
            this.refill().catch(err =>
                console.error('[SignedUrlPool] Background refill error:', err.message)
            );

            return url;
        } catch (error) {
            console.error('[SignedUrlPool] ❌ Failed to fetch fallback URL:', error.message);
            throw error;
        }
    }

    /**
     * Get pool statistics (for monitoring/debugging)
     */
    getStats() {
        const now = Date.now();
        const validUrls = this.pool.filter(item => item.expiresAt > now);

        return {
            total: this.pool.length,
            valid: validUrls.length,
            expired: this.pool.length - validUrls.length,
            oldestAge: this.pool.length > 0
                ? Math.floor((now - this.pool[0].createdAt) / 1000)
                : 0,
            minPoolSize: this.minPoolSize,
            maxPoolSize: this.maxPoolSize
        };
    }
}

module.exports = SignedUrlPool;
