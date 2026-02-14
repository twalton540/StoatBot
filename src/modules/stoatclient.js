import { Client } from "stoat.js";
import 'dotenv/config';

const STOAT_TOKEN = process.env.STOAT_TOKEN;
const STOAT_CHANNEL_ID = process.env.STOAT_CHANNEL_ID;

const client = new Client();

const stoatClient = {
    client: client,
    channelId: STOAT_CHANNEL_ID,

    init: () => {
        return new Promise((resolve, reject) => {
            client.on("ready", async () => {
                console.info(`Stoat logged in as ${client.user.username}!`);
                resolve(client);
            });

            client.on("error", (error) => {
                reject(error);
            });

            client.loginBot(STOAT_TOKEN);
        });
    },

    getChannel: () => {
        return client.channels.get(STOAT_CHANNEL_ID);
    },

    replaceCustomEmojis: (content) => {
        // Replace Discord custom emoji format <:name:id> or <a:name:id> with CDN URL
        return content.replace(/<a?:(\w+):(\d+)>/g, (match, name, id) => {
            return `https://cdn.discordapp.com/emojis/${id}.webp?size=96`;
        });
    },

    sendDiscordMessage: async (discordMsg, replyToStoatId = null, includeTimestamp = true, replaceMentionsFn) => {
        const channel = stoatClient.getChannel();

        // Build content
        let content = discordMsg.Content || '';

        // Replace custom emojis
        content = stoatClient.replaceCustomEmojis(content);

        // Replace mentions
        if (replaceMentionsFn) {
            content = replaceMentionsFn(content);
        }

        // Add timestamp only if requested
        if (includeTimestamp) {
            const timestamp = discordMsg.Timestamp.toLocaleString('en-US', {
                timeZone: 'America/Chicago',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
            content = `(${timestamp})\n${content}`;
        }

        // Prepare masquerade with avatar and role color
        const masquerade = {
            name: discordMsg.Author
        };

        if (discordMsg.AvatarUrl) {
            masquerade.avatar = discordMsg.AvatarUrl;
        }

        if (discordMsg.RoleColor) {
            masquerade.colour = discordMsg.RoleColor;
        }

        // Prepare message payload
        const payload = {
            content: content.trim(),
            masquerade: masquerade
        };

        // Add replies if this is a reply
        if (replyToStoatId) {
            payload.replies = [{
                id: replyToStoatId,
                mention: false
            }];
        }

        // Add embeds
        if (discordMsg.Embeds && discordMsg.Embeds.length > 0) {
            payload.embeds = discordMsg.Embeds.map(embed => {
                // Replace custom emojis and mentions in embed fields
                let processedEmbed = {
                    title: embed.Title || null,
                    description: embed.Description || null,
                    url: embed.Url || null,
                    media: embed.ImageUrl || null,
                    icon_url: embed.ThumbnailUrl || null
                };

                if (processedEmbed.title) {
                    processedEmbed.title = stoatClient.replaceCustomEmojis(processedEmbed.title);
                    if (replaceMentionsFn) {
                        processedEmbed.title = replaceMentionsFn(processedEmbed.title);
                    }
                }

                if (processedEmbed.description) {
                    processedEmbed.description = stoatClient.replaceCustomEmojis(processedEmbed.description);
                    if (replaceMentionsFn) {
                        processedEmbed.description = replaceMentionsFn(processedEmbed.description);
                    }
                }

                return processedEmbed;
            }).filter(e => e.title || e.description || e.url || e.media);
        }

        // Add attachments as part of content
        if (discordMsg.Attachments && discordMsg.Attachments.length > 0) {
            discordMsg.Attachments.forEach(att => {
                payload.content += `\n[${att.Filename}](${att.Url})`;
            });
        }

        // Send the message
        const sentMessage = await channel.sendMessage(payload);

        // Add reactions if any
        if (discordMsg.Reactions && discordMsg.Reactions.length > 0) {
            for (const reaction of discordMsg.Reactions) {
                try {
                    await sentMessage.react(reaction.Emoji);
                } catch (error) {
                    console.warn(`Could not add reaction ${reaction.Emoji}:`, error.message);
                }
            }
        }

        return sentMessage;
    }
};

export default stoatClient;