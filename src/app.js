import stoatClient from './modules/stoatclient.js';
import discordClient from './modules/discordclient.js';
import checkpoint from './modules/checkpoint.js';
import messageCache from './modules/messagecache.js';

// Helper function to deduplicate messages by ID and sort chronologically
function deduplicateMessages(messages) {
    const seen = new Set();
    const unique = [];

    for (const msg of messages) {
        if (!seen.has(msg.Id)) {
            seen.add(msg.Id);
            unique.push(msg);
        }
    }

    // Sort by timestamp (oldest first)
    unique.sort((a, b) => new Date(a.Timestamp) - new Date(b.Timestamp));

    return unique;
}

async function importDiscordToStoat() {
    // Build user cache first
    await discordClient.buildUserCache();

    // PHASE 1: Ensure message cache is complete
    console.log('\n=== PHASE 1: Fetching Discord messages ===');

    const cacheExists = await messageCache.exists();
    let allMessages = [];

    if (cacheExists) {
        console.log('Found existing message cache');
        const cachedMessages = await messageCache.load();

        if (cachedMessages && cachedMessages.length > 0) {
            allMessages = cachedMessages;
            console.log(`Cache has ${cachedMessages.length} messages`);

            // Step 1: Fetch NEW messages (newer than cache)
            const newestCachedMessageId = cachedMessages[cachedMessages.length - 1].Id;
            console.log('Fetching newer messages...');

            const newMessages = await discordClient.fetchAllMessages(null, newestCachedMessageId);

            if (newMessages.length > 0) {
                console.log(`Found ${newMessages.length} new messages`);
                allMessages = deduplicateMessages([...cachedMessages, ...newMessages]);
                console.log(`After deduplication: ${allMessages.length} messages`);
                await messageCache.save(allMessages);
            } else {
                console.log('No new messages found');
            }

            // Step 2: Fetch OLDER messages (older than cache)
            const oldestCachedMessageId = allMessages[0].Id;
            console.log('Fetching older messages...');

            // Callback to save cache every 1000 messages during fetch
            const saveBatchCallback = async (olderMessages) => {
                // Prepend older messages to the cache and deduplicate
                const merged = deduplicateMessages([...olderMessages, ...allMessages]);
                allMessages = merged;
                await messageCache.save(merged);
                console.log(`Cached ${merged.length} total messages (deduplicated)`);
            };

            const olderMessages = await discordClient.fetchAllMessages(null, null, saveBatchCallback, oldestCachedMessageId);

            if (olderMessages.length > 0) {
                console.log(`Found ${olderMessages.length} older messages`);
                allMessages = deduplicateMessages([...olderMessages, ...allMessages]);
                console.log(`After deduplication: ${allMessages.length} messages`);
                await messageCache.save(allMessages);
            } else {
                console.log('No older messages found');
            }
        }
    } else {
        console.log('No cache found, fetching all messages from Discord...');

        // Callback to save cache every 1000 messages during fetch
        const saveBatchCallback = async (messages) => {
            const deduplicated = deduplicateMessages(messages);
            await messageCache.save(deduplicated);
            console.log(`Cached ${deduplicated.length} messages (deduplicated)`);
        };

        // First time - fetch all messages from Discord
        allMessages = await discordClient.fetchAllMessages(null, null, saveBatchCallback);

        if (allMessages.length > 0) {
            allMessages = deduplicateMessages(allMessages);
            await messageCache.save(allMessages);
            console.log(`Initial cache complete: ${allMessages.length} messages`);
        }
    }

    console.log(`\nTotal messages in cache: ${allMessages.length}`);

    if (allMessages.length === 0) {
        console.log('No messages in cache!');
        return;
    }

    // PHASE 2: Send messages to Stoat
    console.log('\n=== PHASE 2: Sending messages to Stoat ===');

    // Load checkpoint to see where we left off sending
    const checkpointData = await checkpoint.load();

    let lastAuthor = checkpointData?.lastAuthor || null;
    let lastTimestamp = checkpointData?.lastTimestamp ? new Date(checkpointData.lastTimestamp) : null;

    // Restore message ID map from checkpoint
    const messageIdMap = new Map();
    if (checkpointData?.messageIdMap) {
        Object.entries(checkpointData.messageIdMap).forEach(([discordId, stoatId]) => {
            messageIdMap.set(discordId, stoatId);
        });
    }

    // Find starting index based on checkpoint
    let startIndex = 0;
    if (checkpointData?.lastDiscordMessageId) {
        startIndex = allMessages.findIndex(m => m.Id === checkpointData.lastDiscordMessageId);
        if (startIndex !== -1) {
            startIndex++;
            console.log(`Resuming sending from message ${startIndex + 1}/${allMessages.length}`);
        } else {
            console.log('Could not find checkpoint in cache, starting from beginning');
            startIndex = 0;
        }
    } else {
        console.log('No checkpoint found, starting from first message');
    }

    // Process messages starting from checkpoint
    for (let i = startIndex; i < allMessages.length; i++) {
        const msg = allMessages[i];

        try {
            // Determine if we should include timestamp
            let includeTimestamp = true;

            if (lastAuthor === msg.Author && lastTimestamp) {
                const currentTimestamp = new Date(msg.Timestamp);
                const timeDiff = (currentTimestamp - lastTimestamp) / 1000 / 60;
                if (timeDiff < 30) {
                    includeTimestamp = false;
                }
            }

            let replyToStoatId = null;
            if (msg.ReplyTo && msg.ReplyTo.MessageId) {
                replyToStoatId = messageIdMap.get(msg.ReplyTo.MessageId) || null;
            }

            let sentMessage;
            let attempts = 0;
            const maxAttempts = 3;

            while (attempts < maxAttempts) {
                try {
                    sentMessage = await stoatClient.sendDiscordMessage(
                        msg,
                        replyToStoatId,
                        includeTimestamp,
                        discordClient.replaceMentions
                    );
                    break; // Success, exit retry loop
                } catch (sendError) {
                    attempts++;

                    // Check if it's a rate limit error
                    if (sendError.retry_after) {
                        const waitMs = sendError.retry_after;
                        console.log(`Rate limited! Waiting ${waitMs}ms before retry (attempt ${attempts}/${maxAttempts})...`);
                        await new Promise(resolve => setTimeout(resolve, waitMs));
                        continue; // Retry
                    }

                    // Check if error object has retry_after property
                    if (typeof sendError === 'object' && sendError !== null) {
                        try {
                            const errorObj = typeof sendError === 'string' ? JSON.parse(sendError) : sendError;
                            if (errorObj.retry_after) {
                                const waitMs = errorObj.retry_after;
                                console.log(`Rate limited! Waiting ${waitMs}ms before retry (attempt ${attempts}/${maxAttempts})...`);
                                await new Promise(resolve => setTimeout(resolve, waitMs));
                                continue; // Retry
                            }
                        } catch (parseError) {
                            // Not a JSON error, continue to reaction retry
                        }
                    }

                    // If it's not a rate limit, try without reactions
                    if (attempts >= maxAttempts && msg.Reactions && msg.Reactions.length > 0) {
                        console.log('Retrying without reactions...');
                        const msgWithoutReactions = { ...msg, Reactions: [] };
                        sentMessage = await stoatClient.sendDiscordMessage(
                            msgWithoutReactions,
                            replyToStoatId,
                            includeTimestamp,
                            discordClient.replaceMentions
                        );
                        console.log('Success without reactions!');
                        break;
                    }

                    // If all retries failed, throw the error
                    if (attempts >= maxAttempts) {
                        throw sendError;
                    }
                }
            }

            messageIdMap.set(msg.Id, sentMessage.id);

            lastAuthor = msg.Author;
            lastTimestamp = new Date(msg.Timestamp);

            await checkpoint.save({
                lastDiscordMessageId: msg.Id,
                lastAuthor: lastAuthor,
                lastTimestamp: msg.Timestamp,
                messageIdMap: Object.fromEntries(messageIdMap)
            });

            if ((i + 1) % 10 === 0) {
                console.log(`Sending progress: ${i + 1}/${allMessages.length} (${((i + 1) / allMessages.length * 100).toFixed(1)}%)`);
            }

            await new Promise(resolve => setTimeout(resolve, 50));

        } catch (error) {
            console.error(`Failed to import message ${msg.Id} after all retries:`, error);
            throw error;
        }
    }

    console.log('\n=== All messages sent successfully! ===');
}

async function main() {
    try {
        await stoatClient.init();
        await discordClient.init();

        console.log('Both clients ready!');

        await importDiscordToStoat();

        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        console.log('\nProgress saved. Run the script again to resume.');
        process.exit(1);
    }
}

main();