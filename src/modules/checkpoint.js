import fs from 'fs/promises';
import 'dotenv/config';

const STOAT_CHANNEL_ID = process.env.STOAT_CHANNEL_ID;
const CACHE_FILE = `./discord_messages_cache_${STOAT_CHANNEL_ID}.json`;

const messageCache = {
    save: async (messages) => {
        try {
            await fs.writeFile(CACHE_FILE, JSON.stringify(messages, null, 2));
        } catch (error) {
            console.error('Failed to save message cache:', error);
        }
    },

    load: async () => {
        try {
            const data = await fs.readFile(CACHE_FILE, 'utf-8');
            const messages = JSON.parse(data);
            console.log(`Loaded ${messages.length} cached messages from disk`);
            return messages;
        } catch (error) {
            if (error.code === 'ENOENT') {
                console.log('No message cache found');
                return null;
            }
            console.error('Failed to load message cache:', error);
            return null;
        }
    },

    exists: async () => {
        try {
            await fs.access(CACHE_FILE);
            return true;
        } catch {
            return false;
        }
    }
};

export default messageCache;