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

    // Pass the last processed message ID so we stop fetching when we reach it
    const lastProcessedMessageId = checkpointData?.lastDiscordMessageId || null;
    const messages = await discordClient.fetchAllMessages(messageLimit, lastProcessedMessageId);

    console.log(`Total messages to process: ${messages.length}`);

    if (messages.length === 0) {
        console.log('No new messages to process!');
        return;
    }

    // Restore message ID map from checkpoint
    const messageIdMap = new Map();
    if (checkpointData?.messageIdMap) {
        Object.entries(checkpointData.messageIdMap).forEach(([discordId, stoatId]) => {
            messageIdMap.set(discordId, stoatId);
        });
    }

    // Process all messages (no index tracking needed now)
    for (let i = 0; i < messages.length; i++) {
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
                lastDiscordMessageId: msg.Id,
                lastAuthor: lastAuthor,
                lastTimestamp: lastTimestamp.toISOString(),
                messageIdMap: Object.fromEntries(messageIdMap)
            });

            // Progress indicator
            if ((i + 1) % 10 === 0) {
                console.log(`Progress: ${i + 1}/${messages.length}`);
            }

            // Rate limit
            await new Promise(resolve => setTimeout(resolve, 100));

        } catch (error) {
            console.error(`Failed to import message ${msg.Id}:`, error);
            throw error; // Checkpoint already saved, just exit
        }
    }

    console.log('\nBatch complete!');
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