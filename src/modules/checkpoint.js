import fs from 'fs/promises';

const CHECKPOINT_FILE = './import_checkpoint.json';

const checkpoint = {
    save: async (data) => {
        try {
            await fs.writeFile(CHECKPOINT_FILE, JSON.stringify(data, null, 2));
        } catch (error) {
            console.error('Failed to save checkpoint:', error);
        }
    },

    load: async () => {
        try {
            const data = await fs.readFile(CHECKPOINT_FILE, 'utf-8');
            const parsed = JSON.parse(data);
            console.log(`Resuming from checkpoint: ${parsed.lastProcessedIndex + 1} messages already processed`);
            return parsed;
        } catch (error) {
            if (error.code === 'ENOENT') {
                console.log('No checkpoint found, starting fresh');
                return null;
            }
            console.error('Failed to load checkpoint:', error);
            return null;
        }
    },

    clear: async () => {
        try {
            await fs.unlink(CHECKPOINT_FILE);
            console.log('Checkpoint file cleared');
        } catch (error) {
            if (error.code !== 'ENOENT') {
                console.error('Failed to clear checkpoint:', error);
            }
        }
    }
};

export default checkpoint;