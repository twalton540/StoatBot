import stoatClient from './modules/stoatclient.js';
import discordClient from './modules/discordclient.js';
import checkpoint from './modules/checkpoint.js';

async function importDiscordToStoat(messageLimit = null) {
    // Load checkpoint if exists
    const checkpointData = await checkpoint.load();

    // Track last message author and timestamp for smart timestamping
    let lastAuthor = checkpointData?.lastAuthor || null;
    let lastTimestamp = checkpointData?.lastTimestamp ? new Date(checkpointData.lastTimestamp) : null;

    // Build user cache first
    await discordClient.buildUserCache();

    // Fetch all messages from Discord
    const messages = await discordClient.fetchAllMessages(messageLimit);
    console.log(`Total messages to process: ${messages.length}`);

    // Restore message ID map from checkpoint
    const messageIdMap = new Map();
    if (checkpointData?.messageIdMap) {
        Object.entries(checkpointData.messageIdMap).forEach(([discordId, stoatId]) => {
            messageIdMap.set(discordId, stoatId);
        });
    }

    // Determine starting index
    const startIndex = checkpointData?.lastProcessedIndex !== undefined
        ? checkpointData.lastProcessedIndex + 1
        : 0;

    if (startIndex > 0) {
        console.log(`Resuming from message ${startIndex + 1}...`);
    }

    // Process messages starting from checkpoint
    for (let i = startIndex; i < messages.length; i++) {
        const msg = messages[i];

        try {
            // Determine if we should include timestamp
            let includeTimestamp = true;

            if (lastAuthor === msg.Author && lastTimestamp) {
                const timeDiff = (msg.Timestamp - lastTimestamp) / 1000 / 60;
                if (timeDiff < 30) {
                    includeTimestamp = false;
                }
            }

            // Find the Stoat message ID to reply to
            let replyToStoatId = null;
            if (msg.ReplyTo && msg.ReplyTo.MessageId) {
                replyToStoatId = messageIdMap.get(msg.ReplyTo.MessageId) || null;
            }

            // Send to Stoat with mention replacement
            const sentMessage = await stoatClient.sendDiscordMessage(
                msg,
                replyToStoatId,
                includeTimestamp,
                discordClient.replaceMentions
            );

            // Store the Stoat message ID
            messageIdMap.set(msg.Id, sentMessage.id);

            // Update last author and timestamp
            lastAuthor = msg.Author;
            lastTimestamp = msg.Timestamp;

            // Save checkpoint after EVERY message
            await checkpoint.save({
                lastProcessedIndex: i,
                lastAuthor: lastAuthor,
                lastTimestamp: lastTimestamp.toISOString(),
                messageIdMap: Object.fromEntries(messageIdMap),
                totalMessages: messages.length
            });

            // Progress indicator
            if ((i + 1) % 10 === 0) {
                console.log(`Progress: ${i + 1}/${messages.length} (${((i + 1) / messages.length * 100).toFixed(1)}%)`);
            }

            // Rate limit
            await new Promise(resolve => setTimeout(resolve, 100));

        } catch (error) {
            console.error(`Failed to import message ${msg.Id} (index ${i}):`, error);
            throw error; // Checkpoint already saved, just exit
        }
    }

    console.log('\nImport complete!');
    await checkpoint.clear(); // Clear checkpoint when fully done
}

async function main() {
    try {
        // Initialize both clients
        await stoatClient.init();
        await discordClient.init();

        console.log('Both clients ready!');

        // Import messages with limit
        await importDiscordToStoat(1000);

        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        console.log('\nCheckpoint saved. Run the script again to resume from where it left off.');
        process.exit(1);
    }
}

main();