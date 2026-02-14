import stoatClient from './modules/stoatclient.js';
import discordClient from './modules/discordclient.js';

async function importDiscordToStoat(messageLimit = null) {
    // Track last message author and timestamp for smart timestamping
    let lastAuthor = null;
    let lastTimestamp = null;

    // Build user cache first
    await discordClient.buildUserCache();

    // Fetch all messages from Discord
    const messages = await discordClient.fetchAllMessages(messageLimit);
    console.log(`Starting import of ${messages.length} messages to Stoat...`);

    // Import each message
    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];

        try {
            // Determine if we should include timestamp
            let includeTimestamp = true;

            if (lastAuthor === msg.Author && lastTimestamp) {
                // Calculate time difference in minutes
                const timeDiff = (msg.Timestamp - lastTimestamp) / 1000 / 60;

                // Don't include timestamp if same author and less than 30 minutes
                if (timeDiff < 30) {
                    includeTimestamp = false;
                }
            }

            // Find the Stoat message ID to reply to
            let replyToStoatId = null;
            if (msg.ReplyTo && msg.ReplyTo.MessageId) {
                // Find the original message in our array that has the matching Discord ID
                const originalMsg = messages.find(m => m.Id === msg.ReplyTo.MessageId);
                if (originalMsg && originalMsg.StoatMessageId) {
                    replyToStoatId = originalMsg.StoatMessageId;
                }
            }

            // Send to Stoat with mention replacement
            const sentMessage = await stoatClient.sendDiscordMessage(
                msg,
                replyToStoatId,
                includeTimestamp,
                discordClient.replaceMentions
            );

            // Store the Stoat message ID in the Discord message object
            msg.StoatMessageId = sentMessage.id;

            // Update last author and timestamp
            lastAuthor = msg.Author;
            lastTimestamp = msg.Timestamp;

            console.log(`Imported message ${i + 1}/${messages.length}`);

            // Rate limit
            await new Promise(resolve => setTimeout(resolve, 1000));

        } catch (error) {
            console.error(`Failed to import message ${msg.Id}:`, error);
        }
    }

    console.log('Import complete!');
}

async function main() {
    try {
        // Initialize both clients
        await stoatClient.init();
        await discordClient.init();

        console.log('Both clients ready!');

        // Import first 100 messages (or remove limit for all)
        await importDiscordToStoat(100);

        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

main();